import os
import time
from pathlib import Path
from backend.store import Store
from backend.service import Service

def main():
    Path("runtime").mkdir(exist_ok=True)
    store = Store()
    service = Service(store)
    # One worker in v0.1; fail abandoned RUNNING jobs instead of silently hanging.
    for job in store.all("job", None):
        if job["status"] == "RUNNING":
            job.update(status="FAILED", error="Worker restarted during execution; start a new run")
            store.put("job", job["owner"], job)
            if job["type"] == "RUN":
                run = store.get("run", job["owner"], job["payload"]["runId"])
                run.update(status="FAILED", reportReady=False, error=job["error"])
                store.put("run", job["owner"], run)
    while True:
        job = store.claim()
        if job:
            service.process_job(job)
        else:
            time.sleep(0.5)

if __name__ == "__main__":
    main()
