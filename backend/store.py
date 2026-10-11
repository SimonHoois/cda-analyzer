"""
Per-owner storage. Uploaded .fit files and their small metadata live on disk
(DATA_DIR), parsed analyzers are cached in memory and rebuilt on demand, so a
server restart or an evicted cache entry never loses a user's files.
"""
import json
import os
import re
import shutil
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path

import config
from core.analyzer import CyclingDataAnalyzer
from core.physics import Params

ID_RE = re.compile(r"^[a-f0-9]{8,32}$")
_lock = threading.RLock()


class NotFound(Exception):
    pass


def safe_owner(owner: str) -> str:
    if owner == "shared" or ID_RE.match(owner or ""):
        return owner
    raise NotFound("bad owner")


def owner_dir(owner: str) -> Path:
    d = config.DATA_DIR / "owners" / safe_owner(owner)
    (d / "files").mkdir(parents=True, exist_ok=True)
    return d


def _atomic_write(path: Path, text: str):
    tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


class Record:
    """Metadata of one uploaded file (JSON on disk) plus a lazily built analyzer."""

    def __init__(self, owner: str, file_id: str, meta: dict):
        self.owner, self.id, self.meta = owner, file_id, meta
        self.lock = threading.RLock()

    # paths
    @property
    def fit_path(self) -> Path:
        return owner_dir(self.owner) / "files" / f"{self.id}.fit"

    @property
    def meta_path(self) -> Path:
        return owner_dir(self.owner) / "files" / f"{self.id}.json"

    def save(self):
        with _lock:
            _atomic_write(self.meta_path, json.dumps(self.meta))

    def __getitem__(self, k):
        return self.meta.get(k)

    def __setitem__(self, k, v):
        self.meta[k] = v


_records: dict[tuple, Record] = {}
_analyzers: "OrderedDict[tuple, tuple]" = OrderedDict()   # key -> (load_key, analyzer)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def create(owner: str, filename: str, data: bytes, params: Params) -> Record:
    file_id = new_id()
    meta = {"name": filename, "loaded_at": time.strftime("%H:%M:%S"),
            "created": time.time(), "crop_start": None, "crop_end": None,
            "manual_turns": None, "quality": None, "result": None, "info": {}}
    rec = Record(owner, file_id, meta)
    rec.fit_path.write_bytes(data)
    rec.save()
    with _lock:
        _records[(owner, file_id)] = rec
    return rec


def get(owner: str, file_id: str) -> Record:
    if not ID_RE.match(file_id or ""):
        raise NotFound(file_id)
    key = (owner, file_id)
    with _lock:
        rec = _records.get(key)
        if rec:
            return rec
        mp = owner_dir(owner) / "files" / f"{file_id}.json"
        if not mp.exists():
            raise NotFound(file_id)
        rec = Record(owner, file_id, json.loads(mp.read_text(encoding="utf-8")))
        _records[key] = rec
        return rec


def list_records(owner: str) -> list[Record]:
    d = owner_dir(owner) / "files"
    out = []
    for mp in d.glob("*.json"):
        try:
            out.append(get(owner, mp.stem))
        except Exception:
            continue
    out.sort(key=lambda r: r["created"] or 0)
    return out


def remove(owner: str, file_id: str):
    rec = get(owner, file_id)
    with _lock:
        for p in (rec.fit_path, rec.meta_path):
            p.unlink(missing_ok=True)
        _records.pop((owner, file_id), None)
        _analyzers.pop((owner, file_id), None)


def remove_all(owner: str):
    for r in list_records(owner):
        remove(owner, r.id)


def analyzer_for(rec: Record, p: Params) -> CyclingDataAnalyzer:
    """Return a prepared analyzer (crop + manual turnarounds applied) for this file."""
    key = (rec.owner, rec.id)
    with _lock:
        cached = _analyzers.get(key)
        if cached and cached[0] == p.load_key:
            _analyzers.move_to_end(key)
            return cached[1]
    az = CyclingDataAnalyzer()
    az.load_fit_file(rec.fit_path, speed_source=p.speed_source, speed_scale=p.speed_scale)
    az.prepare(rec["crop_start"], rec["crop_end"], rec["manual_turns"])
    with _lock:
        _analyzers[key] = (p.load_key, az)
        _analyzers.move_to_end(key)
        while len(_analyzers) > config.MAX_CACHED_ANALYZERS:
            _analyzers.popitem(last=False)
    return az


def reprepare(rec: Record, az: CyclingDataAnalyzer):
    az.prepare(rec["crop_start"], rec["crop_end"], rec["manual_turns"])


def cleanup(now: float | None = None) -> int:
    """Delete uploads older than RETENTION_DAYS (history is kept). Returns files removed."""
    now = now or time.time()
    limit = config.RETENTION_DAYS * 86400
    removed = 0
    root = config.DATA_DIR / "owners"
    if not root.exists():
        return 0
    for mp in root.glob("*/files/*.json"):
        try:
            if now - mp.stat().st_mtime > limit:
                owner, fid = mp.parent.parent.name, mp.stem
                for p in (mp, mp.with_suffix(".fit")):
                    p.unlink(missing_ok=True)
                _records.pop((owner, fid), None)
                _analyzers.pop((owner, fid), None)
                removed += 1
        except OSError:
            continue
    return removed


def wipe_for_tests():
    shutil.rmtree(config.DATA_DIR, ignore_errors=True)
    _records.clear()
    _analyzers.clear()
