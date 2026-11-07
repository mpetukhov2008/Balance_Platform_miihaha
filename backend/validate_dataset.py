"""Run actual configured worker pipeline and measure SQL reports without printing raw data."""
import argparse
import json
import os
import threading
import time
from pathlib import Path
from backend.catalog import scripts
from backend.store import Store,uid
from backend.service import Service
from backend import queries

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dataset",choices=["samples","full"],default="full")
    p.add_argument("--trusted-local",action="store_true")
    args=p.parse_args()
    if args.trusted_local:
        os.environ["EXECUTION_MODE"]="trusted-local"
    Path("runtime").mkdir(exist_ok=True)
    id=uid()
    db=Store("sqlite:///runtime/validation-"+id+".db")
    svc=Service(db)
    config=dict(id=uid(),name="Validation",datasetId=args.dataset,
        normalizer=dict(scriptId="builtin-normalize",params={}),comparator=dict(scriptId="builtin-compare",params={}),
        aggregator=dict(scriptId="builtin-aggregate",params={}),checks=[dict(scriptId=s["id"],params={}) for s in scripts() if s["kind"]=="CHECK"],aiReviewEnabled=False)
    run=svc.start_run("validation",config)
    job=db.claim()
    start=time.perf_counter()
    worker=threading.Thread(target=svc.process_job,args=(job,))
    worker.start()
    previous=None
    while worker.is_alive():
        current=db.get("run","validation",run["id"])
        stages=[s["key"] for s in current["stages"] if s["status"]=="RUNNING"]
        state=(current["status"],stages)
        if state!=previous:
            print(json.dumps({"elapsedSeconds":round(time.perf_counter()-start,2),"status":state},ensure_ascii=False),flush=True)
            previous=state
        worker.join(timeout=0.5)
    elapsed=round(time.perf_counter()-start,2)
    run=db.get("run","validation",run["id"])
    result=dict(runId=run["id"],status=run["status"],error=run["error"],elapsedSeconds=elapsed,stages=run["stages"])
    if run["reportReady"]:
        data=db.get("result","validation",run["id"],sections=("checks",))
        result["summary"]=data["summary"]
        result["checks"]=[{k:r[k] for k in ("checkId","LABEL","SOURCE","ARGUMENT","CNT","TOTAL","METRIC","RESULT","CONFIDENCE")} for r in data["checks"]]
        result["queriesMs"]={}
        for label,fn in (("pivot",lambda:queries.pivot(db.engine,"validation",run["id"],["PATH"],["SOURCE","DIFF_FLAG"],[],1,50)),
            ("applications",lambda:queries.applications(db.engine,"validation",run["id"],[{"field":"DIFF_FLAG","op":"eq","value":1}],None,1,50))):
            times=[]
            for _ in range(5):
                q=time.perf_counter();fn();times.append(round((time.perf_counter()-q)*1000,2))
            result["queriesMs"][label]=times
    path=Path("runtime/validation-"+id+".json")
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"status":run["status"],"error":run["error"],"seconds":elapsed,"report":str(path),"summary":result.get("summary"),"queriesMs":result.get("queriesMs")},ensure_ascii=False),flush=True)
    if run["status"]!="SUCCEEDED":
        raise SystemExit(1)

if __name__=="__main__":
    main()
