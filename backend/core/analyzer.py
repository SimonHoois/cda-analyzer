"""
FIT loading, turnaround detection, leg building and CdA fitting.

Changes compared with the desktop prototype:
  * the ride is resampled to a uniform 1 Hz grid (irregular recording and
    dropouts no longer break the acceleration term or the sample-based windows)
  * CdA is solved in closed form (see core.physics) instead of a grid search
  * `prepare()` applies crop + manual turnarounds in one place, so trimming
    really is used by the quality check and the analysis
  * the confidence interval uses Student-t on the standard error of the mean
"""
import numpy as np
import pandas as pd

from core import physics
from core.physics import Params

try:
    from fitparse import FitFile
    FITPARSE_AVAILABLE = True
except ImportError:          # pragma: no cover
    FITPARSE_AVAILABLE = False


def circular_mean(angles_deg):
    r = np.radians(np.asarray(angles_deg))
    return float(np.degrees(
        np.arctan2(np.mean(np.sin(r)), np.mean(np.cos(r)))) % 360)


def angle_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def _coalesce(df, names):
    """First non-null value across several alternative FIT field names."""
    out = None
    for n in names:
        if n in df.columns:
            s = pd.to_numeric(df[n], errors="coerce")
            out = s if out is None else out.fillna(s)
    return out


def _haversine(la1, lo1, la2, lo2):
    R = 6_371_000.0
    la1, lo1, la2, lo2 = map(np.radians, (la1, lo1, la2, lo2))
    a = (np.sin((la2 - la1) / 2) ** 2
         + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2)
    return R * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


class CyclingDataAnalyzer:
    """Load FIT data, detect turnarounds, split legs, fit CdA."""

    G = physics.G

    def __init__(self):
        self.raw_data = None
        self.segment_data = None
        self.legs = []
        self.pairs = []
        self.turnaround_indices = []
        self.manual_turnaround_indices = None
        self.cda_result = None
        self.leg_closures = []
        self.gps_closures = []
        self.pair_cda_values = []
        self.excluded, self.leg_ends, self.n_used = [], [], 0
        self.pair_dist_balance = []
        self.cda_mean = None
        self.cda_std = None
        self.cda_se = None
        self.cda_ci95 = None
        # file facts, filled by load_fit_file
        self.temp_c = None
        self.suggested_rho = None
        self.speed_calibration = None
        self.max_gap_s = 0.0

    # ── Loading ────────────────────────────────────────────────────────────

    def load_fit_file(self, filepath, speed_source="sensor", speed_scale=1.0):
        if not FITPARSE_AVAILABLE:
            raise ImportError("Install fitparse: pip install fitparse")

        rows = []
        for rec in FitFile(str(filepath)).get_messages("record"):
            rows.append({f.name: f.value for f in rec})
        if not rows:
            raise ValueError("No record data in FIT file.")
        raw = pd.DataFrame(rows)

        if "timestamp" not in raw.columns:
            raise ValueError("No timestamp field.")
        ts = pd.to_datetime(raw["timestamp"], utc=True, errors="coerce")
        keep = ts.notna()
        raw, ts = raw[keep].reset_index(drop=True), ts[keep].reset_index(drop=True)
        order = np.argsort(ts.to_numpy(), kind="stable")
        raw, ts = raw.iloc[order].reset_index(drop=True), ts.iloc[order].reset_index(drop=True)
        first = ~ts.duplicated(keep="first").to_numpy()
        raw, ts = raw[first].reset_index(drop=True), ts[first].reset_index(drop=True)
        if len(ts) < 30:
            raise ValueError("The file has fewer than 30 records.")

        t = (ts - ts.iloc[0]).dt.total_seconds().to_numpy(float)
        self.max_gap_s = float(np.max(np.diff(t))) if len(t) > 1 else 0.0

        lat = _coalesce(raw, ["position_lat", "latitude", "lat"])
        lon = _coalesce(raw, ["position_long", "longitude", "lng"])
        speed = _coalesce(raw, ["enhanced_speed", "speed", "velocity_smooth"])
        power = _coalesce(raw, ["power", "watts"])
        alt = _coalesce(raw, ["enhanced_altitude", "altitude"])
        temp = _coalesce(raw, ["temperature"])

        if power is None or power.notna().sum() < 10:
            raise ValueError("No power data — a power meter is required.")

        has_gps = (lat is not None and lon is not None
                   and lat.notna().sum() > 10 and lon.notna().sum() > 10)
        if has_gps and float(lat.abs().max()) > 180:      # FIT semicircles
            lat = lat * (180.0 / 2 ** 31)
            lon = lon * (180.0 / 2 ** 31)

        grid = np.arange(0.0, np.floor(t[-1]) + 1.0, 1.0)

        def on_grid(s):
            if s is None:
                return np.full(len(grid), np.nan)
            v = s.to_numpy(float)
            m = ~np.isnan(v)
            if m.sum() == 0:
                return np.full(len(grid), np.nan)
            if m.sum() == 1:
                return np.full(len(grid), v[m][0])
            return np.interp(grid, t[m], v[m])

        df = pd.DataFrame({"time": grid})
        df["timestamp"] = ts.iloc[0] + pd.to_timedelta(grid, unit="s")
        df["power"] = np.clip(on_grid(power), 0, None)
        df["altitude"] = on_grid(alt)
        df["latitude"] = on_grid(lat) if has_gps else np.nan
        df["longitude"] = on_grid(lon) if has_gps else np.nan
        gps_ok = has_gps and df["latitude"].notna().any()

        # ── speed ──────────────────────────────────────────────────────────
        def gps_speed():
            la, lo = df["latitude"].to_numpy(), df["longitude"].to_numpy()
            d = np.zeros(len(df))
            d[1:] = _haversine(la[:-1], lo[:-1], la[1:], lo[1:])
            d = np.nan_to_num(d)
            return pd.Series(np.minimum(d, 25.0))

        sensor = on_grid(speed)
        if speed_source == "gps":
            if not gps_ok:
                raise ValueError("GPS speed selected but no GPS data found.")
            df["speed"] = gps_speed().rolling(5, center=True, min_periods=1).mean()
        elif np.isnan(sensor).all():
            if not gps_ok:
                raise ValueError("No speed or GPS data.")
            df["speed"] = gps_speed().rolling(5, center=True, min_periods=1).mean()
        else:
            if np.nanmedian(sensor) > 50:                  # mm/s instead of m/s
                sensor = sensor / 1000.0
            df["speed"] = sensor * float(speed_scale)
        df["speed"] = df["speed"].ffill().bfill().clip(lower=0)

        # ── distance + heading ────────────────────────────────────────────
        df["distance"] = np.concatenate([[0.0], np.cumsum(df["speed"].to_numpy()[1:])])
        if gps_ok:
            la, lo = df["latitude"].to_numpy(), df["longitude"].to_numpy()
            la1, la2 = np.radians(la[:-1]), np.radians(la[1:])
            dlo = np.radians(lo[1:] - lo[:-1])
            x = np.sin(dlo) * np.cos(la2)
            y = np.cos(la1) * np.sin(la2) - np.sin(la1) * np.cos(la2) * np.cos(dlo)
            brg = np.degrees(np.arctan2(x, y)) % 360
            step = _haversine(la[:-1], lo[:-1], la[1:], lo[1:])
            brg = np.where(step < 0.2, np.nan, brg)        # no heading when standing still
            h = pd.Series(np.concatenate([[np.nan], brg])).ffill().bfill()
            df["heading"] = h.fillna(0.0).to_numpy()
        else:
            df["heading"] = np.nan

        # ── file facts for the UI ──────────────────────────────────────────
        if temp is not None and temp.notna().sum() > 5:
            self.temp_c = float(temp.median())
            alt_med = float(np.nanmedian(df["altitude"])) if df["altitude"].notna().any() else 0.0
            self.suggested_rho = round(physics.air_density(self.temp_c, alt_med), 3)
        if gps_ok and speed_source != "gps":
            la, lo = df["latitude"].to_numpy(), df["longitude"].to_numpy()
            d = np.nan_to_num(_haversine(la[:-1], lo[:-1], la[1:], lo[1:]))
            moving = df["speed"].to_numpy()[1:] > 3.0
            gps_m, sensor_m = float(d[moving].sum()), float(df["speed"].to_numpy()[1:][moving].sum())
            if sensor_m > 500:
                self.speed_calibration = {
                    "gps_m": round(gps_m, 1), "sensor_m": round(sensor_m, 1),
                    "ratio": round(gps_m / sensor_m, 4)}

        self.raw_data = df.reset_index(drop=True)
        self.set_segment(0, len(self.raw_data) - 1)
        return self.raw_data

    # ── Segment / leg management ───────────────────────────────────────────

    def set_segment(self, start_idx, end_idx):
        self.segment_data = (self.raw_data
                             .iloc[start_idx:end_idx + 1]
                             .copy()
                             .reset_index(drop=True))
        self.legs = []
        self.pairs = []
        self.turnaround_indices = []
        self.cda_result = None
        self.leg_closures = []
        self.gps_closures = []
        self.pair_cda_values = []
        self.excluded, self.leg_ends, self.n_used = [], [], 0
        self.pair_dist_balance = []
        self.cda_mean = self.cda_std = self.cda_se = self.cda_ci95 = None

    def prepare(self, crop_start=None, crop_end=None, manual_times=None):
        """Apply crop + (optional) manual turnaround times, then build the legs.

        Times are seconds from the start of the file.
        """
        times = self.raw_data["time"].to_numpy()
        cs = times[0] if crop_start is None else float(crop_start)
        ce = times[-1] if crop_end is None else float(crop_end)
        i0 = max(0, int(np.searchsorted(times, cs, side="left")))
        i1 = min(len(times) - 1, int(np.searchsorted(times, ce, side="right")) - 1)
        if i1 - i0 < 20:
            raise ValueError("The selected range is too short (need at least 20 s).")
        self.set_segment(i0, i1)
        if manual_times is None:
            self.manual_turnaround_indices = None
        else:
            seg_t = self.segment_data["time"].to_numpy()
            idx = sorted({int(np.clip(np.searchsorted(seg_t, t), 0, len(seg_t) - 1))
                          for t in manual_times if seg_t[0] < t < seg_t[-1]})
            self.manual_turnaround_indices = idx
        self.detect_turnarounds()
        self.build_legs()
        return self

    def turn_times(self):
        if self.segment_data is None:
            return []
        seg_t = self.segment_data["time"].to_numpy()
        return [round(float(seg_t[i]), 1) for i in self.turnaround_indices]

    # ── Turnaround detection ───────────────────────────────────────────────

    def detect_turnarounds(self, speed_threshold=1.5):
        # ── Manual override: skip auto-detection if user set turnarounds ──
        if self.manual_turnaround_indices is not None:
            self.turnaround_indices = list(self.manual_turnaround_indices)
            return self.turnaround_indices

        if self.segment_data is None:
            return []

        df = self.segment_data

        if 'heading' in df.columns and df['heading'].notna().any():
            hdg   = pd.Series(df['heading'].values)
            hdg_s = hdg.rolling(15, center=True, min_periods=1).mean()
            turns, min_gap = [], 40

            for i in range(30, len(hdg_s) - 30):
                before = hdg_s.iloc[max(0, i-15):i].values
                after  = hdg_s.iloc[i:i+15].values
                if angle_diff(circular_mean(before), circular_mean(after)) > 120:
                    zone_s    = max(0, i-20)
                    zone_e    = min(len(df), i+20)
                    local_min = zone_s + int(
                        np.argmin(df['speed'].values[zone_s:zone_e]))
                    if not turns or local_min - turns[-1] > min_gap:
                        turns.append(local_min)

            if turns:
                self.turnaround_indices = turns
                return turns

        spd            = self.segment_data['speed'].values
        ss             = pd.Series(spd).rolling(5, center=True,
                                                min_periods=1).mean().values
        riding_speed   = np.median(spd[spd > 3.0]) if (spd > 3.0).any() else 5.0
        adap_thr       = max(speed_threshold, riding_speed * 0.40)
        turns          = []

        for i in range(20, len(ss) - 20):
            if ss[max(0, i-10):i].mean() > 4.0 and ss[i] < adap_thr:
                if ss[i] <= ss[max(0, i-5):i+5].min() + 0.3:
                    turns.append(i)

        clean = []
        for t in turns:
            if not clean or t - clean[-1] > 30:
                clean.append(t)

        self.turnaround_indices = clean
        return clean


    def build_legs(self, min_trim: int = 5, balance: bool = True):
        """
        Build out-and-back legs with adaptive, distance-balanced turnaround trimming.

        Three-step improvement over the old fixed trim=10:

        Step 1 – Speed-based turn-zone detection:
            Walk away from each turnaround until speed recovers to ≥70 % of the
            segment median.  This captures the true invalidated zone, which varies
            by corner radius and rider behaviour.

        Step 2 – Distance-symmetric trim:
            The approach end-point and the departure start-point of every turnaround
            are made to lie at the same physical distance from the cone, by
            extending whichever side is shorter.  The two trim edges thus coincide
            geographically, minimising unused road.

        Step 3 – Pair distance balancing (when balance=True):
            Speed × time distance is computed for each (out, back) pair.  Any
            residual imbalance is corrected by trimming from the *far* (outer)
            boundary of the longer leg — the start of the out leg or the end of
            the back leg — leaving the turnaround region untouched.
        """
        if self.segment_data is None:
            return []

        turns = self.turnaround_indices or self.detect_turnarounds()
        bounds = [0] + turns + [len(self.segment_data) - 1]

        df = self.segment_data
        spd = df['speed'].values
        t = df['time'].values
        dt = np.diff(t, prepend=t[0])
        step_d = spd * dt  # metres per sample
        cum_dist = np.cumsum(step_d)
        n = len(df)

        # Segment-wide riding speed (used for recovery threshold)
        riding_spd = np.median(spd[spd > 3.0]) if (spd > 3.0).any() else 5.0
        recovery_thr = riding_spd * 0.90  # 90 % = "back to steady riding"

        # ── Step 1 & 2: adaptive, distance-symmetric trim per turnaround ────────
        def _adaptive_trim(ti: int, max_search: int = 150):
            """
            Return (trim_left, trim_right) with:
              - speed must recover to ≥ 90% of median riding speed
              - acceleration must drop below 0.3 m/s² for 3 consecutive samples
            """
            # Smoothed acceleration (used for stability check)
            acc = np.gradient(
                pd.Series(spd).rolling(5, center=True, min_periods=1).mean().values,
                t
            )

            def _stable(idx):
                """True if acceleration is settled at index idx."""
                if idx < 2 or idx >= n - 2:
                    return False
                window = acc[max(0, idx - 2): idx + 3]
                return np.all(np.abs(window) < 0.3)

            # ── approach side (walk backward from turnaround) ──
            tl = min_trim
            for i in range(ti - 1, max(0, ti - max_search) - 1, -1):
                if spd[i] >= recovery_thr and _stable(i):
                    tl = ti - i
                    break
            tl = max(min_trim, tl)

            # ── departure side (walk forward from turnaround) ──
            tr = min_trim
            for i in range(ti + 1, min(n, ti + max_search)):
                if spd[i] >= recovery_thr and _stable(i):
                    tr = i - ti
                    break
            tr = max(min_trim, tr)

            # ── distance-symmetric trim (Step 2 — unchanged) ──
            d_left = cum_dist[ti] - cum_dist[max(0, ti - tl)]
            d_right = cum_dist[min(n - 1, ti + tr)] - cum_dist[ti]
            target = max(d_left, d_right)

            if d_left < target:
                for i in range(ti - tl - 1, max(0, ti - max_search * 2) - 1, -1):
                    if cum_dist[ti] - cum_dist[max(0, i)] >= target:
                        tl = ti - i
                        break

            if d_right < target:
                for i in range(ti + tr + 1, min(n, ti + max_search * 2)):
                    if cum_dist[i] - cum_dist[ti] >= target:
                        tr = i - ti
                        break

            return max(min_trim, tl), max(min_trim, tr)

        # Trim table: trims[k] = (left_trim, right_trim) at bounds[k]
        # Protocol: rider is at speed at file start/end → minimal boundary trim.
        # Turnarounds get full adaptive trim.
        BOUNDARY_TRIM = 2

        trims = (
                [(0, BOUNDARY_TRIM)]
                + [_adaptive_trim(ti) for ti in turns]
                + [(BOUNDARY_TRIM, 0)]
        )

        # ── Slice legs ──────────────────────────────────────────────────────────
        legs = []
        for k in range(len(bounds) - 1):
            s = bounds[k] + trims[k][1]  # right trim of left boundary
            e = bounds[k + 1] - trims[k + 1][0]  # left  trim of right boundary
            if e - s < 20:
                continue
            leg = df.iloc[s:e + 1].copy().reset_index(drop=True)
            if len(leg) < 20 or leg['speed'].mean() < 2.0:
                continue
            legs.append(leg)

        # ── Step 3: pair distance balancing ─────────────────────────────────────
        def _leg_dist(lg):
            v = lg['speed'].values
            t_l = lg['time'].values
            dt_l = np.diff(t_l, prepend=t_l[0])
            return float(np.sum(v * dt_l))

        def _trim_start(lg, target_cut_m):
            """Remove ~target_cut_m metres from the START of a leg."""
            sd = lg['speed'].values * np.diff(lg['time'].values,
                                              prepend=lg['time'].values[0])
            cut = int(np.searchsorted(np.cumsum(sd), target_cut_m))
            cut = min(cut, len(lg) - 20)
            return lg.iloc[max(0, cut):].reset_index(drop=True)

        def _trim_end(lg, target_cut_m):
            """Remove ~target_cut_m metres from the END of a leg."""
            sd = lg['speed'].values * np.diff(lg['time'].values,
                                              prepend=lg['time'].values[0])
            cut = int(np.searchsorted(np.cumsum(sd[::-1]), target_cut_m))
            cut = min(cut, len(lg) - 20)
            return lg.iloc[:len(lg) - max(0, cut)].reset_index(drop=True)

        if balance and len(legs) >= 2:
            balanced = []
            for ki in range(0, len(legs) - 1, 2):
                out_l = legs[ki]
                back_l = legs[ki + 1]

                d_out = _leg_dist(out_l)
                d_back = _leg_dist(back_l)
                excess = d_out - d_back  # positive → out is longer

                if abs(excess) > 5:
                    # ── Chung method: both legs must cover the same road ──
                    # The turnaround side is the geographic anchor (don't touch).
                    # Trim from the OUTER edge of the LONGER leg only.
                    #   Out leg outer edge  = its START
                    #   Back leg outer edge = its END
                    # The shorter leg stays untouched — it defines the valid road.
                    if excess > 0:
                        # Out is longer → trim from START of out (outer edge)
                        out_l = _trim_start(out_l, abs(excess))
                    else:
                        # Back is longer → trim from END of back (outer edge)
                        back_l = _trim_end(back_l, abs(excess))

                balanced += [out_l, back_l]

            if len(legs) % 2 == 1:
                balanced.append(legs[-1])
            legs = balanced

        # ── Finalise ────────────────────────────────────────────────────────────
        self.legs = legs
        self.pairs = [(legs[k], legs[k + 1]) for k in range(0, len(legs) - 1, 2)]

        # Store distance imbalance per pair as a diagnostic attribute
        self.pair_dist_balance = []
        for out_l, back_l in self.pairs:
            self.pair_dist_balance.append(_leg_dist(out_l) - _leg_dist(back_l))

        # GPS closures (unchanged logic)
        self.gps_closures = []
        for out_leg, back_leg in self.pairs:
            if ('latitude' not in out_leg.columns
                    or out_leg['latitude'].isna().all()):
                self.gps_closures.append(np.nan)
                continue
            lat1, lon1 = out_leg['latitude'].iloc[0], out_leg['longitude'].iloc[0]
            lat2, lon2 = back_leg['latitude'].iloc[-1], back_leg['longitude'].iloc[-1]
            if any(pd.isna([lat1, lon1, lat2, lon2])):
                self.gps_closures.append(np.nan)
                continue
            self.gps_closures.append(_haversine(lat1, lon1, lat2, lon2))

        return legs


    def compute_directions(self, ref_heading=None):
        df = self.segment_data
        if df is None or 'heading' not in df.columns:
            return None, None

        hdg = df['heading'].values
        if ref_heading is None:
            t0   = df['time'].values[0]
            mask = df['time'].values <= t0 + 10
            if mask.sum() == 0:
                mask[:5] = True
            ref_heading = circular_mean(hdg[mask])

        back_hdg   = (ref_heading + 180) % 360
        directions = np.full(len(df), 'turn', dtype=object)
        for i, h in enumerate(hdg):
            if angle_diff(h, ref_heading) <= 90:
                directions[i] = 'out'
            elif angle_diff(h, back_hdg) <= 90:
                directions[i] = 'back'

        return directions, ref_heading


    # ── CdA fitting ────────────────────────────────────────────────────────

    def calculate_cda(self, p: Params, exclude=()):
        """Fit CdA on the prepared legs. Returns a dict with the statistics."""
        if self.segment_data is None or not self.legs:
            raise ValueError("No usable legs. Check the turnarounds.")
        if len(self.legs) < 2:
            raise ValueError(
                f"Only {len(self.legs)} usable leg found. "
                "Include at least one complete out-and-back.")
        if not self.pairs:
            raise ValueError("Could not form any out-and-back pairs.")

        sums = physics.pair_sums(self.pairs, p)
        self.excluded = physics.check_exclusion(len(sums), exclude)
        used = [i for i in range(len(sums)) if (i + 1) not in self.excluded]
        pooled, per_pair = physics.solve_cda([sums[i] for i in used], clip=False)
        per_pair = [a / b for a, b in sums]
        if not (physics.CDA_MIN <= pooled <= physics.CDA_MAX):
            raise ValueError(
                f"CdA solved to {pooled:.3f} m², outside the physical range "
                f"{physics.CDA_MIN}-{physics.CDA_MAX}. Check power data, mass, "
                "wind and the turnarounds.")

        self.cda_result = pooled
        self.pair_cda_values = [float(np.clip(v, physics.CDA_MIN, physics.CDA_MAX)) for v in per_pair]
        self.leg_closures = physics.closures_at(sums, pooled)
        self.leg_ends = [(float(physics.leg_ve(o, pooled, p, +p.wind_ms)[-1]),
                          float(physics.leg_ve(b, pooled, p, -p.wind_ms)[-1])) for o, b in self.pairs]
        self.n_used = len(used)
        vals = [self.pair_cda_values[i] for i in used]
        n = len(vals)
        self.cda_mean = float(np.mean(vals))
        if n > 1:
            self.cda_std = float(np.std(vals, ddof=1))
            self.cda_se = self.cda_std / np.sqrt(n)
            half = physics.t_crit_95(n - 1) * self.cda_se
            self.cda_ci95 = [pooled - half, pooled + half]
        else:
            self.cda_std = self.cda_se = None
            self.cda_ci95 = None
        return pooled

