import json

import pytest
from fastapi.testclient import TestClient

import config
import store
from main import app


def test_health(client):
    assert client.get("/healthz").text == "ok"


def test_upload_quality_and_analyze_is_accurate(client, upload):
    r = upload()
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["quality"]["overall"] in ("PASS", "WARNING")
    assert len(f["quality"]["checks"]) == 11
    assert f["suggested_rho"] and 1.1 < f["suggested_rho"] < 1.3

    a = client.post(f"/api/files/{f['file_id']}/analyze", data={"label": "Hoods"})
    assert a.status_code == 200, a.text
    res = a.json()
    assert res["cda"] == pytest.approx(0.30, rel=0.02)          # simulator truth = 0.30
    assert res["n_pairs"] >= 3 and res["cda_ci95"][0] < res["cda"] < res["cda_ci95"][1]
    assert res["time_savings"][0]["distance_km"] == 10

    assert client.get(f"/api/files/{f['file_id']}/result").json()["label"] == "Hoods"
    h = client.get("/api/history").json()
    assert len(h) == 1 and h[0]["label"] == "Hoods"
    # re-analysing replaces the row instead of duplicating it
    client.post(f"/api/files/{f['file_id']}/analyze", data={"label": "Hoods v2"})
    h = client.get("/api/history").json()
    assert len(h) == 1 and h[0]["label"] == "Hoods v2"


def test_trim_is_applied_to_quality_and_analysis(client, upload):
    f = upload().json()
    fid = f["file_id"]
    full_pairs = client.get(f"/api/files/{fid}/trim").json()["n_pairs"]
    assert full_pairs >= 3
    t = client.get(f"/api/files/{fid}/trim").json()
    # keep roughly the first two out-and-back pairs
    cut = t["turn_times_s"][3] + 5
    r = client.post(f"/api/files/{fid}/trim", data={"crop_start": 0, "crop_end": cut})
    assert r.status_code == 200, r.text
    assert r.json()["n_pairs"] == 2
    res = client.post(f"/api/files/{fid}/analyze").json()
    assert res["n_pairs"] == 2                     # the analysis really uses the crop
    # reset
    client.post(f"/api/files/{fid}/trim", data={"crop_start": 0, "crop_end": t["total_time_s"],
                                                "reset_turns": "true"})
    assert client.get(f"/api/files/{fid}/trim").json()["n_pairs"] == full_pairs


def test_manual_turnarounds_fix_a_failed_file(client, upload):
    f = upload().json()
    fid = f["file_id"]
    t = client.get(f"/api/files/{fid}/trim").json()
    first_leg_only = client.post(f"/api/files/{fid}/trim", data={
        "crop_start": 5, "crop_end": t["turn_times_s"][0] - 20}).json()
    assert first_leg_only["quality"]["overall"] == "FAIL"
    assert client.post(f"/api/files/{fid}/analyze").status_code == 422     # gate blocks FAIL
    fixed = client.post(f"/api/files/{fid}/trim", data={
        "crop_start": 0, "crop_end": t["total_time_s"],
        "turn_times": json.dumps(t["turn_times_s"])}).json()
    assert fixed["is_manual"] and fixed["quality"]["overall"] != "FAIL"
    assert client.post(f"/api/files/{fid}/analyze").status_code == 200


def test_owner_isolation(client, upload):
    fid = upload().json()["file_id"]
    other = TestClient(app)
    assert other.get("/api/files").json() == []
    assert other.get(f"/api/files/{fid}/result").status_code == 404
    assert client.get("/api/files").json()[0]["file_id"] == fid


def test_survives_restart(client, upload):
    fid = upload().json()["file_id"]
    store._records.clear()
    store._analyzers.clear()                      # simulates a restart: only disk remains
    assert client.get("/api/files").json()[0]["file_id"] == fid
    assert client.post(f"/api/files/{fid}/analyze").status_code == 200


def test_password_mode_shares_workspace(client, upload, monkeypatch):
    monkeypatch.setattr(config, "APP_PASSWORD", "s3cret")
    c1, c2 = TestClient(app), TestClient(app)
    assert c1.get("/api/files").status_code == 401
    assert c1.get("/healthz").status_code == 200
    auth = ("cda", "s3cret")
    assert c1.get("/api/files", auth=("cda", "wrong")).status_code == 401
    c1.auth = auth
    c2.auth = auth
    upload(c1)
    assert len(c2.get("/api/files").json()) == 1       # second device sees the same workspace


def test_rejects_bad_uploads(client, monkeypatch, upload):
    r = client.post("/api/files/upload", files={"file": ("x.fit", b"hello" * 20)})
    assert r.status_code == 422
    monkeypatch.setattr(config, "MAX_UPLOAD_MB", 0)
    assert upload().status_code == 413


def test_validates_parameters(client, upload):
    assert upload(mass="5").status_code == 422
    assert upload(rho="9").status_code == 422


def test_charts(client, upload):
    fid = upload().json()["file_id"]
    o = client.get(f"/api/files/{fid}/charts/overview").json()
    assert len(o["time"]) == len(o["speed"]) == len(o["power"]) > 100
    s = client.get(f"/api/files/{fid}/charts/segment").json()
    assert len(s["legs"]) >= 6 and s["track"]["lat"]
    assert client.get(f"/api/files/{fid}/charts/results").status_code == 422   # no result yet
    client.post(f"/api/files/{fid}/analyze")
    r = client.get(f"/api/files/{fid}/charts/results").json()
    assert len(r["pairs"]) >= 3 and len(r["pairs"][0]["out"]) == 121
    assert [x["delta"] for x in r["sensitivity"]] == [-0.03, 0.0, 0.03]


def test_compare_and_history_import(client, upload):
    ids = []
    for cda_label in ("A", "B"):
        fid = upload(name=f"{cda_label}.fit").json()["file_id"]
        client.post(f"/api/files/{fid}/analyze", data={"label": cda_label})
        ids.append(fid)
    c = client.post("/api/files/compare", data={"file_id_a": ids[0], "file_id_b": ids[1]})
    assert c.status_code == 200 and len(c.json()["by_power"]) == 4
    legacy = [{"id": 1, "timestamp": "2026-06-16T21:10:34", "file_name": "old.fit", "cda": 0.3367,
               "cda_std": 0.0087, "pair_cda_values": [0.34, 0.33], "n_pairs": 2, "quality_score": 95.5}]
    assert client.post("/api/history/import", json=legacy).json()["added"] == 1
    assert client.post("/api/history/import", json=legacy).json()["added"] == 0   # no duplicates


def test_delete_and_expiry(client, upload):
    fid = upload().json()["file_id"]
    assert client.delete(f"/api/files/{fid}").status_code == 200
    assert client.get(f"/api/files/{fid}/result").status_code == 404
    fid = upload().json()["file_id"]
    assert store.cleanup(now=__import__("time").time() + 40 * 86400) == 1
    assert client.get("/api/files").json() == []


def test_verdict_levels():
    from core.verdict import compare_verdict
    base = {"params": {"rho": 1.2, "mass": 75, "crr": 0.004, "speed_source": "sensor",
                       "drivetrain_eff": 0.977, "speed_scale": 1.0, "wind_ms": 0.0}, "n_pairs": 4, "cda_se": 0.001}

    def res(cda, **kw):
        return {**base, "cda": cda, **kw}
    v = compare_verdict(res(0.31), res(0.27), {}, {})
    assert v["faster"] == "B" and v["level"] == "very_likely" and v["warnings"] == []
    v = compare_verdict(res(0.31), res(0.3085), {}, {})
    assert v["faster"] is None and v["level"] == "unclear"
    v = compare_verdict(res(0.30), res(0.31, n_pairs=1), {"avg_speed_kmh": 30}, {"avg_speed_kmh": 38})
    assert {w["key"] for w in v["warnings"]} == {"pairs", "speed"}


def test_pair_exclusion_rules(client, upload):
    from core import physics
    fid = upload().json()["file_id"]
    full = client.post(f"/api/files/{fid}/analyze").json()
    assert full["n_pairs_total"] == 4 and full["excluded_pairs"] == []
    assert all("odd_leg" in r and "used" in r for r in full["pair_breakdown"])
    # one of four may go, two may not
    one = client.post(f"/api/files/{fid}/analyze", data={"exclude_pairs": "2"})
    assert one.status_code == 200 and one.json()["n_pairs"] == 3 and one.json()["excluded_pairs"] == [2]
    assert one.json()["pair_breakdown"][1]["used"] is False
    assert client.post(f"/api/files/{fid}/analyze", data={"exclude_pairs": "1,2"}).status_code == 422
    assert client.post(f"/api/files/{fid}/analyze", data={"exclude_pairs": "9"}).status_code == 422
    # the choice is kept on recalculation and shown in the charts
    client.post(f"/api/files/{fid}/recalculate")
    assert client.get(f"/api/files/{fid}/result").json()["excluded_pairs"] == [2]
    ch = client.get(f"/api/files/{fid}/charts/results").json()
    assert [p["used"] for p in ch["pairs"]] == [True, False, True, True]
    # an empty list puts everything back
    assert client.post(f"/api/files/{fid}/analyze", data={"exclude_pairs": "none"}).json()["excluded_pairs"] == []
    # three pairs can never lose one
    with pytest.raises(ValueError):
        physics.check_exclusion(3, [1])
    assert physics.check_exclusion(8, [1, 5]) == [1, 5]
