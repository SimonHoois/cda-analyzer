"""JSON data for the interactive charts (the browser draws them, no images)."""
import numpy as np
from fastapi import APIRouter, HTTPException, Request

import store
from core import physics
from core.physics import Params
from routes.deps import downsample, get_record

router = APIRouter(prefix="/api/files")


def _r(a, nd=2):
    return np.round(np.asarray(a, float), nd).tolist()


def trace_payload(az, n: int = 900) -> dict:
    df = az.raw_data
    idx = np.unique(np.linspace(0, len(df) - 1, min(n, len(df))).round().astype(int))
    return {"time": _r(df["time"].to_numpy()[idx], 1),
            "speed": _r(df["speed"].to_numpy()[idx] * 3.6, 1),
            "power": _r(df["power"].to_numpy()[idx], 0)}


def _params_for(rec) -> Params:
    res = rec["result"]
    if not res:
        raise HTTPException(422, "No CdA result yet. Run the analysis first.")
    return Params(**res["params"])


@router.get("/{file_id}/charts/overview")
def overview(request: Request, file_id: str):
    rec = get_record(request, file_id)
    with rec.lock:
        az = store.analyzer_for(rec, Params(**(rec["quality_params"] or {})))
        out = trace_payload(az)
        out["total_time_s"] = round(float(az.raw_data["time"].iloc[-1]), 1)
        return out


@router.get("/{file_id}/charts/segment")
def segment(request: Request, file_id: str):
    """Legs, crop zones, turnarounds and the GPS track of the current segment."""
    rec = get_record(request, file_id)
    with rec.lock:
        p = Params(**(rec["quality_params"] or {}))
        az = store.analyzer_for(rec, p)
        seg = az.segment_data
        t = seg["time"].to_numpy(float)
        legs = []
        for k, lg in enumerate(az.legs):
            v, tt = lg["speed"].to_numpy(float), lg["time"].to_numpy(float)
            legs.append({"k": k, "tag": "out" if k % 2 == 0 else "back",
                         "t0": round(float(tt[0]), 1), "t1": round(float(tt[-1]), 1),
                         "dist_m": round(float(np.sum(v * np.diff(tt, prepend=tt[0]))), 1)})
        crops, cursor = [], float(t[0])
        for lg in legs:
            if lg["t0"] > cursor + 0.5:
                crops.append([round(cursor, 1), lg["t0"]])
            cursor = lg["t1"]
        if legs and t[-1] > cursor + 0.5:
            crops.append([round(cursor, 1), round(float(t[-1]), 1)])

        track = None
        if seg["latitude"].notna().any():
            idx = np.unique(np.linspace(0, len(seg) - 1, min(700, len(seg))).round().astype(int))
            label = np.full(len(seg), "t")
            for lg in legs:
                label[(t >= lg["t0"]) & (t <= lg["t1"])] = "o" if lg["tag"] == "out" else "b"
            track = {"lat": np.round(seg["latitude"].to_numpy()[idx], 6).tolist(),
                     "lon": np.round(seg["longitude"].to_numpy()[idx], 6).tolist(),
                     "dir": label[idx].tolist(),
                     "turns": [[round(float(seg["latitude"].iloc[i]), 6),
                                round(float(seg["longitude"].iloc[i]), 6)] for i in az.turnaround_indices]}
        return {"t0": round(float(t[0]), 1), "t1": round(float(t[-1]), 1),
                "turns": az.turn_times(), "legs": legs, "crops": crops, "track": track,
                "pair_balance_m": [round(float(x), 1) for x in az.pair_dist_balance]}


@router.get("/{file_id}/charts/results")
def results(request: Request, file_id: str):
    """Virtual elevation per pair and the CdA sensitivity curves."""
    rec = get_record(request, file_id)
    with rec.lock:
        p = _params_for(rec)
        az = store.analyzer_for(rec, p)
        store.reprepare(rec, az)
        cda = az.calculate_cda(p, rec["excluded_pairs"] or [])
        grid = np.linspace(0, 100, 121)

        def ve_curve(leg, wind):
            ve = physics.leg_ve(leg, cda, p, wind)
            pct = np.linspace(0, 100, len(ve))
            return _r(np.interp(grid, pct, ve), 3), float(ve[-1])

        pairs = []
        for k, (o, b) in enumerate(az.pairs):
            vo, eo = ve_curve(o, +p.wind_ms)
            vb, eb = ve_curve(b, -p.wind_ms)
            pairs.append({"pair": k + 1, "out": vo, "back": vb, "closure": round(eo + eb, 4),
                          "used": (k + 1) not in az.excluded})

        sens = []
        for delta in (-0.03, 0.0, 0.03):
            test, off, legs_out = cda + delta, 0.0, []
            for k, lg in enumerate(az.legs):
                w = +p.wind_ms if k % 2 == 0 else -p.wind_ms
                ve = physics.leg_ve(lg, test, p, w)
                d = lg["distance"].to_numpy(float)
                dist = d - d[0] + off
                sel = np.unique(np.linspace(0, len(ve) - 1, min(60, len(ve))).round().astype(int))
                legs_out.append({"dist": _r(dist[sel], 1), "ve": _r(ve[sel], 3)})
                off += float(d[-1] - d[0]) + 80
            sens.append({"delta": delta, "cda": round(test, 4), "legs": legs_out})
        return {"cda": round(cda, 5), "grid": grid.tolist(), "pairs": pairs, "sensitivity": sens,
                "wind_ms": p.wind_ms}
