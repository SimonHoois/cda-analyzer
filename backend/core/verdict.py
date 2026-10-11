"""Is ride A faster than ride B? A plain verdict from two CdA results.

Each ride's uncertainty is the standard error of its pair-to-pair spread, plus a
floor for what that spread cannot see (wind, temperature and rider changes between
rides). The difference is judged against the two combined.
"""
import math

RIDE_FLOOR = 0.003      # m2, about 1% of a typical CdA
SINGLE_PAIR_SE = 0.008  # m2, used when a ride has one pair only (spread unknown)


def _betacf(a, b, x):
    tiny = 1e-30
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 200):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d; d = 1 / (d if abs(d) > tiny else tiny)
        c = 1 + aa / c; c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d; d = 1 / (d if abs(d) > tiny else tiny)
        c = 1 + aa / c; c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-12:
            break
    return h


def _betainc(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1 - front * _betacf(b, a, 1 - x) / b


def t_cdf(t: float, df: float) -> float:
    p = 0.5 * _betainc(df / 2, 0.5, df / (df + t * t))
    return 1 - p if t > 0 else p


def t_quantile(q: float, df: float) -> float:
    lo, hi = 0.0, 200.0
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if t_cdf(mid, df) < q else (lo, mid)
    return (lo + hi) / 2


def _sampling(res: dict):
    """(variance, degrees of freedom) of the pair-to-pair part of a ride; df is None when unknown/fixed."""
    if res.get("n_pairs", 0) < 2 or res.get("cda_se") is None:
        return SINGLE_PAIR_SE ** 2, None
    return res["cda_se"] ** 2, res["n_pairs"] - 1


def compare_verdict(res_a: dict, res_b: dict, info_a: dict, info_b: dict) -> dict:
    ca, cb = res_a["cda"], res_b["cda"]
    parts = [_sampling(res_a), _sampling(res_b)]
    fixed = 2 * RIDE_FLOOR ** 2                       # allowance treated as known
    var = sum(v for v, _ in parts) + fixed
    # Welch-Satterthwaite: few pairs means a wider, t-shaped uncertainty, not a normal one
    den = sum(v * v / df for v, df in parts if df)
    df = (var * var / den) if den else 1000.0
    se = math.sqrt(var)
    diff = cb - ca                           # negative: B has less drag
    prob = t_cdf(abs(diff) / se, df)         # chance the lower-CdA ride really is the faster one
    tq95 = t_quantile(0.975, df)
    faster = None if diff == 0 else ("B" if diff < 0 else "A")
    level = "very_likely" if prob >= 0.95 else "probably" if prob >= 0.80 else "unclear"
    leans = faster
    if level == "unclear":
        faster = None
    pa, pb = res_a["params"], res_b["params"]
    warn = []

    def add(key, text):
        warn.append({"key": key, "text": text})

    for tag, r in (("A", res_a), ("B", res_b)):
        if r.get("n_pairs", 0) < 3:
            add("pairs", f"Ride {tag} has only {r.get('n_pairs', 0)} pair(s). Three or more pairs make the result much more reliable.")
        if r.get("excluded_pairs"):
            add("excluded", f"Ride {tag} uses {r['n_pairs']} of {r.get('n_pairs_total', r['n_pairs'])} pairs. Leaving pairs out can make a result look cleaner than it is.")
    if abs(pa["rho"] - pb["rho"]) / pa["rho"] > 0.015:
        add("rho", f"Air density differs ({pa['rho']} vs {pb['rho']} kg/m³). That alone shifts CdA by about {abs(pa['rho'] - pb['rho']) / pa['rho'] * 100:.0f}%.")
    if abs(pa["mass"] - pb["mass"]) > 1:
        add("mass", f"Total mass differs ({pa['mass']} vs {pb['mass']} kg).")
    for k, name in (("crr", "rolling resistance"), ("speed_source", "speed source"),
                    ("drivetrain_eff", "drivetrain setting"), ("speed_scale", "speed calibration"), ("wind_ms", "wind")):
        if pa.get(k) != pb.get(k):
            add(k, f"The {name} setting differs between the two rides.")
    sa, sb = info_a.get("avg_speed_kmh"), info_b.get("avg_speed_kmh")
    if sa and sb and abs(sa - sb) > 3:
        add("speed", f"Average speed differs ({sa:.0f} vs {sb:.0f} km/h). Errors in Crr and speed calibration act differently at different speeds.")
    wa, wb = info_a.get("avg_power_w"), info_b.get("avg_power_w")
    if wa and wb and abs(wa - wb) / max(wa, wb) > 0.10:
        add("power", f"Average power differs ({wa:.0f} vs {wb:.0f} W). Compare rides at similar effort.")
    return {
        "faster": faster, "leans": leans, "level": level, "probability": round(prob, 3),
        "diff_cda": round(diff, 5), "diff_pct": round(diff / ca * 100, 2) if ca else None,
        "diff_ci95": [round(diff - tq95 * se, 5), round(diff + tq95 * se, 5)],
        "detectable_cda": round(t_quantile(0.95, df) * se, 4),   # smallest gap this pair of rides can reliably show
        "warnings": warn,
    }
