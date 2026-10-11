from fastapi import APIRouter, Body, HTTPException, Request

import history
from routes.deps import owner_of

router = APIRouter(prefix="/api/history")


@router.get("")
def read_history(request: Request):
    return history.get_all(owner_of(request))


@router.delete("/{entry_id}")
def remove_entry(request: Request, entry_id: int):
    history.delete(owner_of(request), entry_id)
    return {"ok": True}


@router.delete("")
def wipe(request: Request):
    history.clear(owner_of(request))
    return {"ok": True}


@router.post("/import")
def import_history(request: Request, payload=Body(...)):
    """Accepts the prototype's cda_history.json (a list) or {"entries": [...]}."""
    entries = payload.get("entries") if isinstance(payload, dict) else payload
    if not isinstance(entries, list) or len(entries) > 2000:
        raise HTTPException(422, "Expected a list of history entries.")
    return {"added": history.import_entries(owner_of(request), entries)}
