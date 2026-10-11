"""Shared request helpers: owner, physics parameters, record lookup, summaries."""
import numpy as np
from fastapi import Form, HTTPException, Query, Request

import store
from core.physics import Params


def owner_of(request: Request) -> str:
    return request.state.owner


def params_form(
    mass: float = Form(75.0, ge=30, le=250),
    crr: float = Form(0.0031, ge=0.0005, le=0.02),
    rho: float = Form(1.225, ge=0.9, le=1.5),
    wind_ms: float = Form(0.0, ge=-20, le=20),
    drivetrain_eff: float = Form(0.977, ge=0.90, le=1.0),
    speed_source: str = Form("sensor", pattern="^(sensor|gps)$"),
    speed_scale: float = Form(1.0, ge=0.90, le=1.10),
) -> Params:
    return Params(mass=mass, crr=crr, rho=rho, wind_ms=wind_ms, drivetrain_eff=drivetrain_eff,
                  speed_source=speed_source, speed_scale=speed_scale)


def params_query(
    mass: float = Query(75.0, ge=30, le=250),
    crr: float = Query(0.0031, ge=0.0005, le=0.02),
    rho: float = Query(1.225, ge=0.9, le=1.5),
    wind_ms: float = Query(0.0, ge=-20, le=20),
    drivetrain_eff: float = Query(0.977, ge=0.90, le=1.0),
    speed_source: str = Query("sensor", pattern="^(sensor|gps)$"),
    speed_scale: float = Query(1.0, ge=0.90, le=1.10),
) -> Params:
    return Params(mass=mass, crr=crr, rho=rho, wind_ms=wind_ms, drivetrain_eff=drivetrain_eff,
                  speed_source=speed_source, speed_scale=speed_scale)


def get_record(request: Request, file_id: str):
    try:
        return store.get(owner_of(request), file_id)
    except store.NotFound:
        raise HTTPException(
            404, "File not found. It may have expired, so please upload it again.")


def refresh_info(rec, az):
    """Cache cheap, display-only numbers about the current segment."""
    seg, full = az.segment_data, az.raw_data
    info = rec["info"] or {}
    info.update({
        "full_duration_min": round(float(full["time"].iloc[-1]) / 60, 1),
        "duration_min": round(float(seg["time"].iloc[-1] - seg["time"].iloc[0]) / 60, 1),
        "avg_speed_kmh": round(float(seg["speed"].mean()) * 3.6, 1),
        "avg_power_w": round(float(seg["power"].mean())),
        "trimmed": rec["crop_start"] is not None or rec["crop_end"] is not None,
        "manual_turns": rec["manual_turns"] is not None,
        "temp_c": az.temp_c, "suggested_rho": az.suggested_rho,
        "speed_calibration": az.speed_calibration,
        "max_gap_s": round(az.max_gap_s, 1),
    })
    rec["info"] = info


def summary(rec) -> dict:
    res = rec["result"]
    info = rec["info"] or {}
    return {
        "file_id": rec.id, "name": rec["name"], "loaded_at": rec["loaded_at"],
        "duration_min": info.get("duration_min"), "avg_speed_kmh": info.get("avg_speed_kmh"),
        "avg_power_w": info.get("avg_power_w"), "trimmed": info.get("trimmed", False),
        "manual_turns": info.get("manual_turns", False),
        "temp_c": info.get("temp_c"), "suggested_rho": info.get("suggested_rho"),
        "speed_calibration": info.get("speed_calibration"),
        "quality": rec["quality"], "cda": res["cda"] if res else None,
        "cda_se": res.get("cda_se") if res else None, "n_pairs": res.get("n_pairs") if res else None,
        "result_params": res.get("params") if res else None,
        "label": res["label"] if res else (rec["label"] or ""),
        "notes": res["notes"] if res else (rec["notes"] or ""),
        "stale": bool(res and rec["result_params"] and rec["result_params"] != rec["quality_params"]),
    }


def downsample(arr, n: int):
    a = np.asarray(arr)
    if len(a) <= n:
        return a
    idx = np.linspace(0, len(a) - 1, n).round().astype(int)
    return a[idx]
