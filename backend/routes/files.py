"""Upload, list, quality, trim and analysis endpoints."""
import json
import logging

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

import config
import history
import store
from core import physics
from core.verdict import compare_verdict
from core.physics import Params
from core.quality import check_data_quality
from routes.deps import get_record, owner_of, params_form, params_query, refresh_info, summary

log = logging.getLogger("cda.files")
router = APIRouter(prefix="/api/files")


# ── helpers ────────────────────────────────────────────────────────────────

def _quality(rec, az, p: Params):
    q = check_data_quality(az, p)
    rec["quality"] = q
    rec["quality_params"] = p.as_dict()
    return q


def _parse_exclude(raw) -> list[int] | None:
    if raw is None:
        return None
    if str(raw).strip().lower() == "none":      # an empty form field reads as missing, so "none" means no exclusions
        return []
    try:
        return [int(x) for x in str(raw).split(",") if x.strip()]
    except ValueError:
        raise HTTPException(422, "exclude_pairs must be a comma separated list of pair numbers.")


def _odd_legs(az, cda):
    """Per pair: which leg ends furthest from the same-direction legs of the other pairs, and is the pair a clear outlier."""
    n = len(az.leg_ends)
    outs = np.array([e[0] for e in az.leg_ends])
    backs = np.array([e[1] for e in az.leg_ends])
    vals = np.array(az.pair_cda_values)
    med = float(np.median(vals))
    mad = float(np.median(np.abs(vals - med))) * 1.4826
    rows = []
    for k in range(n):
        do, db = outs[k] - np.median(outs), backs[k] - np.median(backs)
        leg, dev = ("outbound", do) if abs(do) >= abs(db) else ("return", db)
        # only call a pair an outlier with enough pairs to judge, and when it is clearly out and over 2% off
        suspect = bool(n >= 4 and mad > 0 and abs(vals[k] - med) > 3 * mad and abs(vals[k] - med) / cda > 0.02)
        rows.append({"odd_leg": leg, "odd_leg_dev_m": round(float(dev), 3), "suspect": suspect})
    return rows


def _analyze(rec, az, p: Params, q, label: str, notes: str, owner: str, exclude=None) -> dict:
    if exclude is None:                       # keep an earlier choice while it still fits this ride
        try:
            physics.check_exclusion(len(az.pairs), rec["excluded_pairs"] or [])
            exclude = rec["excluded_pairs"] or []
        except ValueError:
            exclude = []
    cda = az.calculate_cda(p, exclude)
    n = len(az.pairs)
    odd = _odd_legs(az, cda)
    pair_rows = []
    for k, lc in enumerate(az.leg_closures):
        dev = (az.pair_cda_values[k] - cda) / cda * 100      # how far this pair is from the ride's CdA, in %
        pair_rows.append({
            "pair": k + 1,
            "cda": round(az.pair_cda_values[k], 5),
            "ve_closure": round(lc, 5),
            "deviation_pct": round(dev, 2),
            "status": "excellent" if abs(dev) < 1 else "acceptable" if abs(dev) < 3 else "poor",
            "used": (k + 1) not in az.excluded, **odd[k],
        })
    result = {
        "file_id": rec.id, "filename": rec["name"], "label": label, "notes": notes,
        "cda": round(cda, 5),
        "cda_std": round(az.cda_std, 5) if az.cda_std is not None else None,
        "cda_se": round(az.cda_se, 5) if az.cda_se is not None else None,
        "cda_ci95": [round(x, 5) for x in az.cda_ci95] if az.cda_ci95 else None,
        "cda_mean": round(az.cda_mean, 5),
        "pair_cda_values": [round(v, 5) for v in az.pair_cda_values],
        "pair_breakdown": pair_rows, "n_pairs": az.n_used, "n_pairs_total": n,
        "excluded_pairs": az.excluded,
        "quality_score": q["score"], "quality_overall": q["overall"],
        "time_savings": physics.time_savings(cda, p),
        "params": p.as_dict(),
    }
    entry = history.add(owner, file_id=rec.id, file_name=rec["name"], result=result,
                        params=p.as_dict(), quality_score=q["score"], label=label, notes=notes)
    result["history_id"] = entry["id"]
    rec["result"] = result
    rec["excluded_pairs"] = az.excluded
    rec["result_params"] = p.as_dict()
    rec["label"], rec["notes"] = label, notes
    return result


def _trim_state(rec, az, q) -> dict:
    seg = az.segment_data
    total = float(az.raw_data["time"].iloc[-1])
    return {
        "total_time_s": round(total, 1),
        "crop_start": round(float(seg["time"].iloc[0]), 1),
        "crop_end": round(float(seg["time"].iloc[-1]), 1),
        "turn_times_s": az.turn_times(),
        "is_manual": rec["manual_turns"] is not None,
        "n_legs": len(az.legs), "n_pairs": len(az.pairs),
        "kept_avg_speed_kmh": round(float(seg["speed"].mean()) * 3.6, 1),
        "kept_avg_power_w": round(float(seg["power"].mean())),
        "quality": q,
    }


# ── upload / list / delete ─────────────────────────────────────────────────

@router.post("/upload")
def upload_file(request: Request, file: UploadFile = File(...), p: Params = Depends(params_form)):
    owner = owner_of(request)
    if len(store.list_records(owner)) >= config.MAX_FILES_PER_OWNER:
        raise HTTPException(429, f"You have {config.MAX_FILES_PER_OWNER} files stored. Remove some first.")
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File is larger than {config.MAX_UPLOAD_MB} MB.")
    if len(data) < 32 or data[8:12] != b".FIT":
        raise HTTPException(422, "This does not look like a .fit file.")

    rec = store.create(owner, file.filename or "ride.fit", data, p)
    try:
        with rec.lock:
            az = store.analyzer_for(rec, p)
            refresh_info(rec, az)
            _quality(rec, az, p)
            rec.save()
    except Exception as e:
        store.remove(owner, rec.id)
        log.info("upload rejected: %s", e)
        raise HTTPException(422, f"Could not read this FIT file: {e}")
    return summary(rec)


@router.get("")
def list_files(request: Request):
    return [summary(r) for r in store.list_records(owner_of(request))]


@router.delete("/{file_id}")
def delete_file(request: Request, file_id: str):
    get_record(request, file_id)
    store.remove(owner_of(request), file_id)
    return {"ok": True}


@router.delete("")
def clear_files(request: Request):
    store.remove_all(owner_of(request))
    return {"ok": True}


# ── quality / recalculation ────────────────────────────────────────────────

@router.post("/{file_id}/recalculate")
def recalculate(request: Request, file_id: str, p: Params = Depends(params_form)):
    rec = get_record(request, file_id)
    with rec.lock:
        az = store.analyzer_for(rec, p)
        store.reprepare(rec, az)
        refresh_info(rec, az)
        q = _quality(rec, az, p)
        had = rec["result"]
        if had and q["overall"] != "FAIL":
            try:
                _analyze(rec, az, p, q, had["label"], had["notes"], owner_of(request))
            except ValueError:
                rec["result"] = None
        elif had:
            rec["result"] = None
        rec.save()
    return summary(rec)


@router.post("/{file_id}/analyze")
def analyze(request: Request, file_id: str, p: Params = Depends(params_form),
            label: str = Form("", max_length=120), notes: str = Form("", max_length=500),
            exclude_pairs: str | None = Form(None)):
    rec = get_record(request, file_id)
    with rec.lock:
        az = store.analyzer_for(rec, p)
        store.reprepare(rec, az)
        refresh_info(rec, az)
        q = _quality(rec, az, p)
        if q["overall"] == "FAIL":
            rec.save()
            raise HTTPException(422, "The quality check failed. Fix the data before calculating CdA.")
        try:
            result = _analyze(rec, az, p, q, label.strip(), notes.strip(), owner_of(request),
                              exclude=_parse_exclude(exclude_pairs))
        except ValueError as e:
            raise HTTPException(422, f"CdA calculation failed: {e}")
        rec.save()
    return result


@router.get("/{file_id}/result")
def get_result(request: Request, file_id: str):
    rec = get_record(request, file_id)
    if not rec["result"]:
        raise HTTPException(404, "No CdA result for this file yet.")
    return rec["result"]


# ── trim + turnarounds ─────────────────────────────────────────────────────

@router.get("/{file_id}/trim")
def get_trim(request: Request, file_id: str, p: Params = Depends(params_query)):
    return _get_trim(request, file_id, p)


def _get_trim(request, file_id, p):
    from routes.charts import trace_payload
    rec = get_record(request, file_id)
    with rec.lock:
        az = store.analyzer_for(rec, p)
        q = rec["quality"] or _quality(rec, az, p)
        out = _trim_state(rec, az, q)
        out["trace"] = trace_payload(az)
        return out


@router.post("/{file_id}/trim")
def apply_trim(request: Request, file_id: str, p: Params = Depends(params_form),
               crop_start: float = Form(0.0), crop_end: float = Form(...),
               turn_times: str | None = Form(None), reset_turns: bool = Form(False)):
    rec = get_record(request, file_id)
    with rec.lock:
        az = store.analyzer_for(rec, p)
        total = float(az.raw_data["time"].iloc[-1])
        crop_start, crop_end = max(0.0, crop_start), min(total, crop_end)
        if crop_end - crop_start < 20:
            raise HTTPException(422, "Keep at least 20 seconds of the ride.")
        old = (rec["crop_start"], rec["crop_end"], rec["manual_turns"])
        rec["crop_start"] = None if crop_start <= 0.5 else crop_start
        rec["crop_end"] = None if crop_end >= total - 0.5 else crop_end
        if reset_turns:
            rec["manual_turns"] = None
        elif turn_times is not None:
            try:
                times = sorted(float(t) for t in json.loads(turn_times))
            except Exception:
                rec["crop_start"], rec["crop_end"], rec["manual_turns"] = old
                raise HTTPException(422, "turn_times must be a JSON array of numbers.")
            if not times:
                rec["crop_start"], rec["crop_end"], rec["manual_turns"] = old
                raise HTTPException(422, "At least one turnaround is required.")
            rec["manual_turns"] = times
        try:
            store.reprepare(rec, az)
        except ValueError as e:
            rec["crop_start"], rec["crop_end"], rec["manual_turns"] = old
            store.reprepare(rec, az)
            raise HTTPException(422, str(e))
        refresh_info(rec, az)
        rec["result"] = None            # a trimmed ride needs a fresh calculation
        q = _quality(rec, az, p)
        rec.save()
        return _trim_state(rec, az, q)


# ── compare ────────────────────────────────────────────────────────────────

@router.post("/compare")
def compare_files(request: Request, file_id_a: str = Form(...), file_id_b: str = Form(...),
                  ref_power: float = Form(250.0, ge=50, le=1000), p: Params = Depends(params_form)):
    a, b = get_record(request, file_id_a), get_record(request, file_id_b)
    for r in (a, b):
        if not r["result"]:
            raise HTTPException(422, f"Calculate CdA for {r['name']} first.")
    ca, cb = a["result"]["cda"], b["result"]["cda"]

    def row(w):
        ta, tb = physics.tt_time_s(ca, p, w), physics.tt_time_s(cb, p, w)
        return {"power": w, "time_a_s": round(ta, 1), "time_b_s": round(tb, 1),
                "delta_s": round(tb - ta, 1)}
    main = row(ref_power)
    return {
        "verdict": compare_verdict(a["result"], b["result"], a["info"] or {}, b["info"] or {}),
        "file_a": {"file_id": a.id, "name": a["name"], "label": a["result"]["label"], "cda": ca},
        "file_b": {"file_id": b.id, "name": b["name"], "label": b["result"]["label"], "cda": cb},
        "delta_cda_cm2": round((cb - ca) * 10000, 1), "ref_power": ref_power,
        **main,
        "speed_a_kmh": round(40000 / main["time_a_s"] * 3.6, 2),
        "speed_b_kmh": round(40000 / main["time_b_s"] * 3.6, 2),
        "by_power": [row(w) for w in (200, 250, 300, 350)],
    }
