"""Per-owner test history (JSON file, atomic writes, monotonic ids)."""
import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

import store

_lock = threading.Lock()


def _path(owner: str) -> Path:
    return store.owner_dir(owner) / "history.json"


def _load(owner: str) -> dict:
    p = _path(owner)
    if not p.exists():
        return {"next_id": 1, "entries": []}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"next_id": 1, "entries": []}
    if isinstance(data, list):                       # prototype format
        data = {"next_id": max([e.get("id", 0) for e in data] + [0]) + 1, "entries": data}
    return data


def _save(owner: str, data: dict):
    p = _path(owner)
    tmp = p.with_suffix(f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def get_all(owner: str) -> list:
    with _lock:
        return _load(owner)["entries"]


def add(owner: str, *, file_id, file_name, result: dict, params: dict, quality_score,
        label="", notes="") -> dict:
    with _lock:
        data = _load(owner)
        # re-analysing the same upload replaces its row instead of duplicating it
        data["entries"] = [e for e in data["entries"] if e.get("file_id") != file_id]
        entry = {
            "id": data["next_id"], "timestamp": datetime.now().isoformat(timespec="seconds"),
            "file_id": file_id, "file_name": file_name, "label": label, "notes": notes,
            "cda": round(result["cda"], 5),
            "cda_std": round(result["cda_std"], 5) if result.get("cda_std") else None,
            "pair_cda_values": [round(v, 5) for v in result["pair_cda_values"]],
            "n_pairs": result["n_pairs"], "quality_score": round(quality_score, 1),
            "mass": params["mass"], "crr": params["crr"], "rho": params["rho"],
            "wind_ms": params["wind_ms"], "drivetrain_eff": params.get("drivetrain_eff"),
        }
        data["next_id"] += 1
        data["entries"].append(entry)
        _save(owner, data)
        return entry


def update_text(owner: str, file_id, label, notes):
    with _lock:
        data = _load(owner)
        for e in data["entries"]:
            if e.get("file_id") == file_id:
                e["label"], e["notes"] = label, notes
        _save(owner, data)


def delete(owner: str, entry_id: int):
    with _lock:
        data = _load(owner)
        data["entries"] = [e for e in data["entries"] if e.get("id") != entry_id]
        _save(owner, data)


def clear(owner: str):
    with _lock:
        data = _load(owner)
        data["entries"] = []
        _save(owner, data)


def import_entries(owner: str, entries: list) -> int:
    """Merge entries from a prototype cda_history.json (duplicates by file+cda are skipped)."""
    with _lock:
        data = _load(owner)
        seen = {(e.get("file_name"), round(e.get("cda", 0), 5)) for e in data["entries"]}
        added = 0
        for e in entries:
            if not isinstance(e, dict) or "cda" not in e:
                continue
            key = (e.get("file_name"), round(float(e["cda"]), 5))
            if key in seen:
                continue
            seen.add(key)
            clean = {k: e.get(k) for k in (
                "timestamp", "file_name", "label", "notes", "cda", "cda_std", "pair_cda_values",
                "n_pairs", "quality_score", "mass", "crr", "rho", "wind_ms")}
            clean["id"] = data["next_id"]
            data["next_id"] += 1
            data["entries"].append(clean)
            added += 1
        data["entries"].sort(key=lambda x: x.get("timestamp") or "")
        _save(owner, data)
        return added
