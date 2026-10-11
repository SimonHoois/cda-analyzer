"""
Physics shared by the analysis, the quality check and the charts.

Power balance for one sample (Chung virtual-elevation method):

    P·η = ½·ρ·CdA·v_air²·v + Crr·m·g·v + m_eff·v·a + m·g·v·(dh/dt)

Everything except the aero term is independent of CdA, so the virtual-elevation
change of a leg is *linear* in CdA:  ΔVE(leg) = base − CdA·aero.
That lets us solve CdA exactly (least squares) instead of grid searching.
"""
from dataclasses import dataclass, asdict

import numpy as np

G = 9.81
WHEEL_INERTIA_KG = 0.14      # effective mass of the two rotating wheels
CDA_MIN, CDA_MAX = 0.05, 0.80

# two-sided 95 % Student-t critical values by degrees of freedom
_T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
        8: 2.306, 9: 2.262, 10: 2.228, 15: 2.131, 20: 2.086, 30: 2.042}


def t_crit_95(df: int) -> float:
    if df < 1:
        return float("nan")
    if df in _T95:
        return _T95[df]
    keys = sorted(_T95)
    for k in keys:
        if df < k:
            return _T95[k]
    return 1.96


@dataclass(frozen=True)
class Params:
    mass: float = 75.0            # rider + bike + kit (kg)
    crr: float = 0.0031
    rho: float = 1.225            # air density (kg/m³)
    wind_ms: float = 0.0          # + = headwind on the outbound leg
    drivetrain_eff: float = 0.977  # 1.0 for hub-based power meters
    speed_source: str = "sensor"  # sensor | gps
    speed_scale: float = 1.0      # speed sensor calibration factor

    def as_dict(self) -> dict:
        return asdict(self)

    @property
    def load_key(self) -> tuple:
        """Parameters that change how the FIT file is read."""
        return (self.speed_source, round(self.speed_scale, 5))


def leg_arrays(leg, p: Params, wind: float):
    """Per-sample (base, aero) elevation increments for one leg."""
    v = leg["speed"].to_numpy(float)
    P = leg["power"].to_numpy(float)
    t = leg["time"].to_numpy(float)
    acc = np.gradient(v, t)
    dt = np.diff(t, prepend=t[0])
    v_s = np.maximum(v, 0.5)
    v_air = np.maximum(v + wind, 0.1)
    denom = p.mass * G * v_s
    base = (P * p.drivetrain_eff - p.crr * p.mass * G * v
            - (p.mass + WHEEL_INERTIA_KG) * v * acc) / denom * dt
    aero = 0.5 * p.rho * v_air ** 2 * v / denom * dt
    return base, aero


def leg_ve(leg, cda: float, p: Params, wind: float):
    """Cumulative virtual elevation of a leg, starting at 0."""
    base, aero = leg_arrays(leg, p, wind)
    ve = np.cumsum(base - cda * aero)
    return ve - ve[0]


def pair_sums(pairs, p: Params):
    """(A, B) per pair such that closure(CdA) = A − CdA·B."""
    out = []
    for o, b in pairs:
        bo, ao = leg_arrays(o, p, +p.wind_ms)
        bb, ab = leg_arrays(b, p, -p.wind_ms)
        out.append((float(bo.sum() + bb.sum()), float(ao.sum() + ab.sum())))
    return out


def solve_cda(sums, clip: bool = False):
    """Return (pooled CdA, per-pair CdA list). Pooled = least squares over pairs."""
    A = np.array([s[0] for s in sums])
    B = np.array([s[1] for s in sums])
    pooled = float((A * B).sum() / (B * B).sum())
    pair = (A / B).tolist()
    if clip:
        pooled = float(np.clip(pooled, CDA_MIN, CDA_MAX))
        pair = [float(np.clip(x, CDA_MIN, CDA_MAX)) for x in pair]
    return pooled, pair


MIN_PAIRS_USED = 3


def check_exclusion(n_pairs: int, excluded) -> list[int]:
    """Validate a set of excluded pairs (1-based). Keeps at least 3 pairs and drops at most 1 in 4."""
    ex = sorted({int(i) for i in excluded})
    if any(i < 1 or i > n_pairs for i in ex):
        raise ValueError("That pair does not exist.")
    if ex and (n_pairs - len(ex) < MIN_PAIRS_USED or len(ex) > n_pairs // 4):
        raise ValueError(
            f"Too many pairs excluded. This ride has {n_pairs} pairs: keep at least {MIN_PAIRS_USED} "
            f"and exclude at most 1 in 4 (here {n_pairs // 4 if n_pairs - n_pairs // 4 >= MIN_PAIRS_USED else 0}).")
    return ex


def closures_at(sums, cda: float):
    return [a - cda * b for a, b in sums]


# ── Performance model (time savings, compare) ───────────────────────────────

def solve_speed(power_w, cda, mass, crr, rho):
    lo, hi = 0.1, 30.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if 0.5 * rho * cda * mid ** 3 + crr * mass * G * mid < power_w:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def time_savings(cda, p: Params, power_w: float = 250.0):
    pw = power_w * p.drivetrain_eff
    rows = []
    for km in (10, 25, 40):
        v0 = solve_speed(pw, cda, p.mass, p.crr, p.rho)
        t0 = km * 1000 / v0
        sv = {}
        for d in (0.01, 0.02, 0.05):
            v1 = solve_speed(pw, cda - d, p.mass, p.crr, p.rho)
            sv[f"delta_{int(round(d * 100)):02d}"] = round(t0 - km * 1000 / v1, 1)
        rows.append({"distance_km": km, "speed_kmh": round(v0 * 3.6, 1),
                     "time_min": round(t0 / 60, 2), "savings_s": sv})
    return rows


def tt_time_s(cda, p: Params, power_w: float, distance_m: float = 40000.0):
    v = solve_speed(power_w * p.drivetrain_eff, cda, p.mass, p.crr, p.rho)
    return distance_m / v


# ── Air density from the FIT temperature ───────────────────────────────────

def air_density(temp_c: float, altitude_m: float = 0.0) -> float:
    """Dry-air density from temperature and altitude (standard atmosphere pressure)."""
    pressure = 101325.0 * (1.0 - 2.25577e-5 * altitude_m) ** 5.25588
    return pressure / (287.058 * (temp_c + 273.15))
