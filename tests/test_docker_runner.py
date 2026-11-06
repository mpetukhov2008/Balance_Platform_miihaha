"""Real isolated executor checks. Opt in explicitly on a host with Docker."""
import os
import pytest
from backend.executor import execute

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DOCKER_TESTS") != "1", reason="Docker checks require explicit opt-in")

def test_container_boundaries(monkeypatch):
    monkeypatch.setenv("EXECUTION_MODE", "docker")
    monkeypatch.setenv("SCRIPT_TIMEOUT", "30")
    code = """
import os
import socket
def run(rows, params):
    assert os.getuid() == 65534
    assert not os.environ.get("AI_API_KEY")
    try:
        with open("/app/probe", "w") as f:
            f.write("forbidden")
    except OSError:
        pass
    else:
        raise AssertionError("app filesystem writable")
    with open("/tmp/probe", "w") as f:
        f.write("scratch")
    s = socket.socket()
    s.settimeout(2)
    try:
        s.connect(("1.1.1.1", 443))
    except OSError:
        pass
    else:
        raise AssertionError("external network available")
    finally:
        s.close()
    return [{"isolated": True}]
"""
    result = execute({"kind": "COMPARE", "code": code, "rows": [], "params": {}})
    assert result["result"] == [{"isolated": True}]

def test_container_timeout(monkeypatch):
    monkeypatch.setenv("EXECUTION_MODE", "docker")
    monkeypatch.setenv("SCRIPT_TIMEOUT", "3")
    with pytest.raises(TimeoutError):
        execute({"kind": "COMPARE", "code": "while True: pass", "rows": [], "params": {}})
