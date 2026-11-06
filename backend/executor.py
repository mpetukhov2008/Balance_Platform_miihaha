import json
import os
import subprocess
import sys
import uuid
import tempfile
import threading
import time

def execute(payload):
    mode = os.environ.get("EXECUTION_MODE", "docker")
    container = "balance-" + uuid.uuid4().hex
    if mode == "trusted-local":
        # Explicitly unsafe development mode, never described as sandboxing.
        cmd = [sys.executable, "-m", "backend.sandbox_entry"]
    elif mode == "docker":
        cmd = ["docker", "run", "--rm", "--name", container, "-i", "--network=none",
               "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
               "--pids-limit=64", "--memory="+os.environ.get("RUNNER_MEMORY","2g"), "--cpus=1", "--user=65534:65534",
               "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m", os.environ.get("RUNNER_IMAGE", "balance-runner:local")]
    else:
        raise RuntimeError("Unknown execution mode")
    try:
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            process = subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=out,stderr=err,
                env={**os.environ,"PYTHONIOENCODING":"utf-8"})
            def feed():
                try:
                    process.stdin.write(json.dumps(payload,ensure_ascii=False).encode("utf-8"))
                    process.stdin.close()
                except (BrokenPipeError,OSError):
                    pass
            writer=threading.Thread(target=feed,daemon=True)
            writer.start()
            deadline=time.monotonic()+int(os.environ.get("SCRIPT_TIMEOUT","60"))
            limit=int(os.environ.get("SCRIPT_OUTPUT_LIMIT","536870912"))
            try:
                while process.poll() is None:
                    if time.monotonic()>deadline:
                        raise TimeoutError("Procedure execution timed out")
                    if os.fstat(out.fileno()).st_size>limit or os.fstat(err.fileno()).st_size>limit:
                        raise RuntimeError("Procedure output too large")
                    time.sleep(0.05)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=10)
                writer.join(timeout=2)
            if os.fstat(out.fileno()).st_size>limit or os.fstat(err.fileno()).st_size>limit:
                raise RuntimeError("Procedure output too large")
            out.seek(0)
            err.seek(0)
            if process.returncode:
                raise RuntimeError("Executor failed: "+err.read(4000).decode("utf-8",errors="replace"))
            result=json.loads(out.read())
        if "error" in result:
            raise RuntimeError(result["error"])
        if not isinstance(result.get("result"), list):
            raise ValueError("Procedure must return a list")
        return result
    finally:
        if mode == "docker":
            try:
                subprocess.run(["docker", "rm", "-f", container], capture_output=True, timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                pass
