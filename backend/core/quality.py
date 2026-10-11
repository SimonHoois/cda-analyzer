"""
Data-quality gate. Thresholds and scoring are unchanged from the prototype:
11 fixed checks, score = (2·pass + warn) / 22, GPS and turnarounds are hard blockers.

The one fix: every check now looks at the *trimmed segment* the analysis will use
(the prototype re-evaluated the whole ride, so cropping had no effect on the verdict).
Call `analyzer.prepare(...)` first.
"""
import numpy as np
import pandas as pd

from core import physics
from core.analyzer import circular_mean, angle_diff
from core.physics import Params

FIXED_TOTAL = 11            # keeps scores comparable across files
HARD_BLOCKERS = ("gps", "turnarounds")


def _chk(key, label, ok, warn, detail):
    return {"key": key, "label": label, "pass": bool(ok),
            "warning": bool((not ok) and warn), "detail": detail}


def _closures(analyzer, p: Params):
    try:
        if not analyzer.pairs:
            return None
        sums = physics.pair_sums(analyzer.pairs, p)
        pooled, _ = physics.solve_cda(sums, clip=True)
        return physics.closures_at(sums, pooled)
    except Exception:
        return None


def check_data_quality(analyzer, p: Params) -> dict:
    df = analyzer.segment_data if analyzer.segment_data is not None else analyzer.raw_data
    checks = []

    # 1 duration
    dur = float(df["time"].iloc[-1] - df["time"].iloc[0])
    checks.append(_chk("duration", f"Ride duration: {dur / 60:.1f} min", dur >= 300, 180 <= dur < 300,
                       "Minimum 5 minutes recommended for a valid CdA test."))

    # 2 power
    pv = float((df["power"].notna() & (df["power"] > 0)).sum() / len(df) * 100)
    checks.append(_chk("power_quality", f"Valid power data: {pv:.1f}%", pv >= 90, 70 <= pv < 90,
                       "Power meter required with >90% valid (non-zero) data."))

    # 3 average speed
    moving = df[df["speed"] > 2.0]
    avg = float(moving["speed"].mean() * 3.6) if len(moving) else 0.0
    checks.append(_chk("avg_speed", f"Avg moving speed: {avg:.1f} km/h", avg >= 25.0, 20.0 <= avg < 25.0,
                       "CdA test requires sustained speed ≥ 25 km/h. Below that, rolling resistance noise masks aerodynamic drag."))

    # 4 speed consistency
    cv = float(moving["speed"].std() / moving["speed"].mean()) if len(moving) > 10 else 1.0
    checks.append(_chk("speed_consistency", f"Speed consistency (CV): {cv:.3f}", cv <= 0.30, 0.30 < cv <= 0.50,
                       "CV < 0.30 = steady pacing. High CV = braking/surging = unreliable CdA."))

    # 5 GPS
    has_gps = "latitude" in df.columns and bool(df["latitude"].notna().any())
    checks.append(_chk("gps", "GPS data: " + ("available" if has_gps else "not found"), has_gps, False,
                       "GPS required for turnaround detection and route validation."))

    # 6 turnarounds
    n_turns = len(analyzer.turnaround_indices)
    checks.append(_chk("turnarounds", f"Turnarounds detected: {n_turns}", n_turns >= 1, False,
                       "At least 1 turnaround required for out-and-back (Chung) method."))

    # 6b closure
    if n_turns >= 1:
        clo = _closures(analyzer, p)
        if clo:
            mx = max(abs(c) for c in clo)
            strs = ", ".join(f"{c:+.3f}m" for c in clo)
            checks.append(_chk("ve_closure", f"VE loop closures: {strs}", mx < 0.05, 0.05 <= mx < 0.10,
                               f"Max closure = {mx:.3f} m. Values < 0.05 m = excellent. 0.05–0.10 m = acceptable. "
                               ">0.10 m = poor conditions, re-test recommended."))
        else:
            checks.append(_chk("ve_closure", "VE closure check: could not run (not enough legs)", False, True,
                               "Background CdA fit failed. Verify turnaround detection."))
    else:
        checks.append(_chk("ve_closure", "VE closure check: skipped (no turnarounds)", False, False,
                           "Cannot evaluate VE closures without at least 1 out-and-back pair."))

    # 7 power steadiness
    pcv = float(df["power"].std() / (df["power"].mean() + 1e-6))
    checks.append(_chk("power_steadiness", f"Power steadiness (CV): {pcv:.3f}", pcv <= 0.60, 0.60 < pcv <= 0.90,
                       "Very erratic power (CV > 0.90) reduces CdA accuracy."))

    # 8 heading antiparallel
    legs = analyzer.legs
    if has_gps and n_turns >= 1 and "heading" in df.columns:
        if len(legs) >= 2:
            diffs = []
            for k in range(0, len(legs) - 1, 2):
                a = circular_mean(legs[k]["heading"].dropna().values)
                b = circular_mean(legs[k + 1]["heading"].dropna().values)
                diffs.append(angle_diff(a, b))
            worst = min(diffs) if diffs else 0.0     # the *least* opposite pair decides
            ok = worst >= 135
            checks.append(_chk("heading_antiparallel", f"Out/back heading diff: {worst:.0f}°  (need ≥135°)",
                               ok, (not ok) and worst >= 100,
                               "Out and back legs must go in opposite directions. Figure-8 or lollipop routes give unreliable CdA."))
        else:
            checks.append(_chk("heading_antiparallel", "Heading check: not enough legs to evaluate", False, True,
                               "Could not verify out/back heading — need at least 2 legs."))
    else:
        checks.append(_chk("heading_antiparallel", "Heading check: skipped (no GPS or no turns)", False, True,
                           "GPS heading required to verify out-and-back geometry."))

    # 9 pairs
    npairs = len(analyzer.pairs)
    checks.append(_chk("pair_count", f"Out-and-back pairs: {npairs}  (recommended ≥ 3)", npairs >= 3, npairs == 2,
                       "More pairs = more reliable CdA average. 1 pair is very sensitive to a single gust or power spike."))

    # 10 flatness
    if has_gps and "altitude" in df.columns and df["altitude"].notna().any():
        drifts = []
        for o, b in analyzer.pairs:
            a0, a1 = o["altitude"].iloc[0], b["altitude"].iloc[-1]
            if not pd.isna(a0) and not pd.isna(a1):
                drifts.append(abs(a1 - a0))
        if drifts:
            mx = max(drifts)
            checks.append(_chk("route_flatness", f"Max altitude drift per pair: {mx:.1f} m  (need < 10 m)",
                               mx < 10.0, 10.0 <= mx < 20.0,
                               "Start and end of each out-and-back pair must be at the same altitude. "
                               "Large drift = route is not flat = VE closure error is structural."))
        else:
            checks.append(_chk("route_flatness", "Route flatness: altitude data missing in legs", False, True,
                               "Could not evaluate altitude balance — check altitude data."))
    else:
        checks.append(_chk("route_flatness", "Route flatness: no altitude data available", False, True,
                           "GPS altitude required to verify route flatness."))

    assert len(checks) == FIXED_TOTAL
    hard_fail = any(not c["pass"] for c in checks if c["key"] in HARD_BLOCKERS)
    n_pass = sum(c["pass"] for c in checks)
    n_warn = sum((not c["pass"]) and c["warning"] for c in checks)
    n_fail = len(checks) - n_pass - n_warn
    score = (n_pass * 2 + n_warn) / (FIXED_TOTAL * 2) * 100
    overall = "FAIL" if hard_fail else "PASS" if n_fail == 0 else "WARNING" if n_fail == 1 else "FAIL"
    return {"checks": checks, "n_pass": int(n_pass), "n_warn": int(n_warn), "n_fail": int(n_fail),
            "score": round(float(score), 1), "overall": overall}
