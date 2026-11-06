"""Container entrypoint; never import or execute workspace code in the API."""
import contextlib
import io
import json
import sys
from backend.domain import Mart

class LimitedOutput(io.StringIO):
    def write(self, text):
        available = max(0, 64000 - self.tell())
        super().write(text[:available])
        return len(text)

def execute(payload):
    out, err = LimitedOutput(), LimitedOutput()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            namespace = {"__name__": "user_script"}
            exec(compile(payload["code"], "<procedure>", "exec"), namespace)
            kind, params = payload["kind"], payload.get("params", {})
            if kind == "CHECK":
                check = namespace["CHECK"]
                result = check["entrypoint"](Mart(payload["rows"], payload["segments"]), params)
                check_id = check["id"]
            elif kind == "NORMALIZE":
                result = []
                for record in payload["records"]:
                    result.extend(namespace["run"](record["document"], record["APP_ID"], record["SOURCE"], params))
                check_id = None
            elif kind == "COMPARE":
                result = namespace["run"](payload["rows"], params)
                check_id = None
            else:
                result = namespace["run"](payload["rows"], payload["segments"], params)
                check_id = None
        return {"result": result, "checkId": check_id, "stdout": out.getvalue(), "stderr": err.getvalue()}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}", "stdout": out.getvalue(), "stderr": err.getvalue()}

if __name__ == "__main__":
    json.dump(execute(json.load(sys.stdin)), sys.stdout, ensure_ascii=False, allow_nan=False)
