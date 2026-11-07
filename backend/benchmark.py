"""Synthetic replay for SQL report queries; not a correctness test of the full data."""
import argparse
import json
import math
import statistics
import tempfile
import time
from pathlib import Path
from backend.catalog import load_dataset
from backend.domain import normalize,compare,aggregate,segments,DEFAULT_PARAMS
from backend.store import Store
from backend import queries

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--apps",type=int,default=2002)
    p.add_argument("--repeats",type=int,default=5)
    p.add_argument("--output",default="runtime/benchmark.json")
    args=p.parse_args()
    if args.apps<1 or args.repeats<1:
        p.error("positive apps/repeats required")
    pairs=load_dataset("samples")
    templates=[]
    for aid,pair in pairs.items():
        n=[r for source,d in pair.items() for r in normalize(d,aid,source,DEFAULT_PARAMS)]
        templates.append((n,segments({aid:pair})[0]))
    start=time.perf_counter()
    normalized,seg=[],[]
    for i in range(args.apps):
        n,s=templates[i%len(templates)]
        aid=f"replay-{i:06}"
        normalized.extend(dict(r,APP_ID=aid) for r in n)
        seg.append(dict(s,APP_ID=aid))
    rows=compare(normalized)
    facts=aggregate(rows,seg)
    build_ms=round((time.perf_counter()-start)*1000,2)
    Path("runtime").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir="runtime") as temp:
        db=Store("sqlite:///"+str(Path(temp)/"bench.db"))
        start=time.perf_counter()
        db.put("result","bench",dict(id="replay",rows=rows,segments=seg,facts=facts,checks=[]))
        persist_ms=round((time.perf_counter()-start)*1000,2)
        def pivot():
            return queries.pivot(db.engine,"bench","replay",["PATH"],["SOURCE","DIFF_FLAG"],[],1,50)
        def apps():
            return queries.applications(db.engine,"bench","replay",[{"field":"DIFF_FLAG","op":"eq","value":1}],None,1,50)
        measures={}
        for name,fn in (("pivot",pivot),("applications",apps)):
            values=[]
            for _ in range(args.repeats):
                start=time.perf_counter()
                fn()
                values.append((time.perf_counter()-start)*1000)
            measures[name]={"medianMs":round(statistics.median(values),2),"p95Ms":round(sorted(values)[math.ceil(.95*len(values))-1],2),"samplesMs":[round(v,2) for v in values]}
        db.engine.dispose()
    result=dict(kind="synthetic sample replay; SQL queries only, not full dataset or HTTP/executor latency",apps=args.apps,
        normalizedRows=len(normalized),comparisonRows=len(rows),facts=len(facts),buildMs=build_ms,persistMs=persist_ms,queries=measures)
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
