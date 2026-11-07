import pytest
from fastapi.testclient import TestClient
from backend.api import create_app
from backend.executor import execute, ExecutionError
from backend.store import Store


def test_sqlite_reader_during_publication(tmp_path):
    db = Store("sqlite:///" + str(tmp_path / "concurrent.db"))
    db.put("probe", "owner", {"id": "one", "value": 1})
    with db.engine.begin() as writer:
        from backend.store import objects
        writer.execute(objects.update().where(objects.c.id == "one").values(data={"id": "one", "value": 2}))
        assert db.get("probe", "owner", "one")["value"] == 1
    assert db.get("probe", "owner", "one")["value"] == 2


def test_python_failure_keeps_output_and_traceback(monkeypatch):
    monkeypatch.setenv("EXECUTION_MODE", "trusted-local")
    with pytest.raises(ExecutionError) as error:
        execute({"kind": "COMPARE", "code": "print('before failure')\nraise ValueError('audit')", "rows": [], "params": {}})
    assert "before failure" in error.value.stdout
    assert 'File "<procedure>", line 2' in error.value.stderr
    assert "ValueError: audit" in error.value.stderr


def test_form_validation_and_built_spa(tmp_path):
    app = create_app(Store("sqlite:///" + str(tmp_path / "api.db")))
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/login", json={"username": "", "password": "x"})
        assert response.status_code == 422
        assert "username" in response.json()["error"]["details"]["fields"]
        assert client.get("/api/v1/not-an-endpoint").status_code == 404
        from pathlib import Path
        if (Path(__file__).resolve().parents[1] / "frontend/dist/index.html").exists():
            response = client.get("/runs/example/checks?rowId=late-row")
            assert response.status_code == 200
            assert 'id="root"' in response.text
