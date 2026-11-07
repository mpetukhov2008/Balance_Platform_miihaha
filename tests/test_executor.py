import pytest
from backend.executor import execute

def test_timeout_fails_and_process_is_killed(monkeypatch):
    monkeypatch.setenv("EXECUTION_MODE","trusted-local")
    monkeypatch.setenv("SCRIPT_TIMEOUT","1")
    with pytest.raises(TimeoutError):
        execute({"kind":"COMPARE","code":"while True: pass","rows":[],"params":{}})

def test_output_limit(monkeypatch):
    monkeypatch.setenv("EXECUTION_MODE","trusted-local")
    monkeypatch.setenv("SCRIPT_OUTPUT_LIMIT","2000")
    with pytest.raises(RuntimeError,match="too large"):
        execute({"kind":"COMPARE","code":"import sys\nsys.stdout.write('x'*20000)","rows":[],"params":{}})
