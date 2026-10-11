import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="cda-test-")
os.environ["DATA_DIR"] = _tmp
os.environ["FRONTEND_DIR"] = str(Path(_tmp) / "nodist")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest                                    # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

import config                                    # noqa: E402
import store                                     # noqa: E402
from main import app                             # noqa: E402
from tools.simulate_ride import simulate, write_fit   # noqa: E402


@pytest.fixture(scope="session")
def fit_path(tmp_path_factory):
    p = tmp_path_factory.mktemp("fit") / "ride.fit"
    write_fit(p, simulate(cda=0.30, laps=4, seed=3))
    return p


@pytest.fixture()
def client():
    store.wipe_for_tests()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def upload(client, fit_path):
    def _up(c=None, name="ride.fit", **form):
        c = c or client
        with open(fit_path, "rb") as f:
            return c.post("/api/files/upload", files={"file": (name, f, "application/octet-stream")}, data=form)
    return _up
