"""
Ride simulator with a KNOWN CdA, used to test and validate the analyzer.

It integrates the same power balance the analyzer inverts, with measurement
noise, a real turnaround (braking, near-stop, re-acceleration), wind, GPS and
an optional dropout-ridden recording. Writes a genuine .fit file.

    python tools/simulate_ride.py out.fit --cda 0.30 --laps 4 --wind 0
"""
import argparse
import math
import sys
from pathlib import Path

import numpy as np

G = 9.81


def simulate(cda=0.30, mass=75.0, crr=0.0031, rho=1.225, eff=0.977, m_rot=0.14,
             wind=0.0, laps=4, leg_m=1300.0, cruise_w=260.0, seed=1,
             power_noise=7.0, speed_noise=0.03, temp_c=15.0, lead_s=40, tail_s=40):
    """Returns dict of 1 Hz arrays (lat, lon, speed, power, altitude, temperature) + truth."""
    rng = np.random.default_rng(seed)
    dt = 0.1
    x, v, direction, t = 0.0, 6.0, +1, 0.0
    pos, spd, pwr, hdg_dir = [], [], [], []
    n_legs_target = laps * 2
    legs_done, accel_boost = 0, 0.0
    v_turn = 2.6
    total_steps = 0
    started_t = 0.0
    while legs_done < n_legs_target and total_steps < 400000:
        rem = (leg_m - x) if direction > 0 else x
        braking = rem < 85 and legs_done < n_legs_target - 1
        finishing = legs_done == n_legs_target - 1 and rem < 40
        # rider power
        if braking:
            P_rider = 0.0
        elif accel_boost > 0:
            P_rider = 480.0
            accel_boost -= dt
        else:
            P_rider = cruise_w * (1 + 0.04 * math.sin(t / 17.0))
        w_head = wind * direction            # + = headwind on the outbound leg
        v_air = max(v + w_head, 0.0)
        F_drag = 0.5 * rho * cda * v_air ** 2 + crr * mass * G
        F_drive = P_rider * eff / max(v, 1.5)
        a = (F_drive - F_drag) / (mass + m_rot)
        if braking:
            v_target = math.sqrt(v_turn ** 2 + 2 * 2.4 * max(rem - 8, 0.0))
            if v > v_target:
                a = (v_target - v) / dt if (v - v_target) / dt < 6 else -6
        v = max(v + a * dt, 0.5)
        x += direction * v * dt
        t += dt
        total_steps += 1
        pos.append(x)
        spd.append(v)
        pwr.append(P_rider if not braking else 0.0)
        hdg_dir.append(direction)
        if (direction > 0 and x >= leg_m) or (direction < 0 and x <= 0):
            legs_done += 1
            direction *= -1
            v = max(v_turn, min(v, 3.2))
            accel_boost = 14.0
        if finishing and rem < 3:
            break
    pos, spd, pwr, hdg_dir = map(np.array, (pos, spd, pwr, hdg_dir))
    # lead-in and tail (rider already moving; protocol says start recording at speed)
    n = len(pos)
    sec = np.arange(0, int(n * dt), 1.0)
    idx = (sec / dt).astype(int)
    x1, v1, p1, d1 = pos[idx], spd[idx], pwr[idx], hdg_dir[idx]
    lat0, lon0 = 52.0, 5.0
    lat = lat0 + x1 / 111_320.0
    lon = np.full_like(lat, lon0)
    power = np.clip(p1 + rng.normal(0, power_noise, len(p1)), 0, None)
    speed = np.clip(v1 + rng.normal(0, speed_noise, len(v1)), 0, None)
    alt = 4.0 + rng.normal(0, 0.25, len(v1))
    return {"lat": lat, "lon": lon, "speed": speed, "power": power, "altitude": alt,
            "temperature": np.full(len(speed), temp_c), "truth": {
                "cda": cda, "mass": mass, "crr": crr, "rho": rho, "eff": eff, "wind": wind}}


def write_fit(path, sim, drop_every=0, jitter=False, start_ms=1_780_000_000_000):
    from fit_tool.fit_file_builder import FitFileBuilder
    from fit_tool.profile.messages.file_id_message import FileIdMessage
    from fit_tool.profile.messages.record_message import RecordMessage
    from fit_tool.profile.profile_type import FileType, Manufacturer

    b = FitFileBuilder(auto_define=True)
    fid = FileIdMessage()
    fid.type = FileType.ACTIVITY
    fid.manufacturer = Manufacturer.DEVELOPMENT.value
    fid.product = 0
    fid.time_created = start_ms
    fid.serial_number = 12345
    b.add(fid)
    n = len(sim["speed"])
    for i in range(n):
        if drop_every and i % drop_every == drop_every - 1:
            continue                                  # recording dropout
        m = RecordMessage()
        m.timestamp = start_ms + i * 1000 + (int(np.sin(i) * 120) if jitter else 0)
        m.position_lat = float(sim["lat"][i])
        m.position_long = float(sim["lon"][i])
        m.power = int(round(sim["power"][i]))
        m.speed = float(sim["speed"][i])
        m.altitude = float(sim["altitude"][i])
        m.temperature = int(sim["temperature"][i])
        b.add(m)
    b.build().to_file(str(path))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--cda", type=float, default=0.30)
    ap.add_argument("--laps", type=int, default=4)
    ap.add_argument("--wind", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--rho", type=float, default=1.225)
    a = ap.parse_args()
    s = simulate(cda=a.cda, laps=a.laps, wind=a.wind, seed=a.seed, rho=a.rho)
    write_fit(Path(a.out), s)
    print(f"wrote {a.out}: {len(s['speed'])} s, true CdA {a.cda}")
