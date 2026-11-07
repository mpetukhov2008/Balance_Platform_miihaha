import copy
import json
import math
import time
from collections import defaultdict
from backend import catalog, domain
from backend.executor import execute, ExecutionError
from backend.store import now, uid
from backend.security import queue_job, reserve, number, LimitExceeded

STAGES = ["NORMALIZE", "UNION", "COMPARE", "AGGREGATE", "CHECKS", "AI_REVIEW", "PUBLISH"]

class Service:
    def __init__(self, store):
        self.store = store

    def script(self, owner, id):
        return self.store.get("script", owner, id) or next((s for s in catalog.scripts() if s["id"] == id), None)

    def job(self, owner, type, payload, run=None, log=None):
        item = dict(id=uid(), owner=owner, type=type, status="QUEUED", payload=payload,
                    stdout="", stderr="", diagnostics=[], previewRows=[], truncated=False, error=None, reportRevision=None)
        if type in ('RUN', 'PREVIEW', 'CHECK'):
            reserve(self.store.engine, [('compute/' + owner, 3600, 1, number('COMPUTE_JOBS_PER_USER_HOUR', 30))])
        queue_job(self.store, item, run=run, log=log)
        return item

    def start_run(self, owner, config):
        id = uid()
        dataset = next(d for d in catalog.datasets() if d["id"] == config["datasetId"])
        snapshot = copy.deepcopy(config)
        for binding in [snapshot["normalizer"], snapshot["comparator"], snapshot["aggregator"], *snapshot["checks"]]:
            binding["script"] = self.script(owner, binding["scriptId"])
        stages = [dict(key=k, status="PENDING", processed=None, total=None, scriptId=None,
                       startedAt=None, finishedAt=None, error=None) for k in STAGES]
        for key, binding in (("NORMALIZE", "normalizer"), ("COMPARE", "comparator"), ("AGGREGATE", "aggregator")):
            next(s for s in stages if s["key"] == key)["scriptId"] = config[binding]["scriptId"]
        run = dict(id=id, configurationId=config["id"], datasetId=dataset["id"], datasetName=dataset["name"],
                   status="QUEUED", reportReady=False, createdAt=now(), startedAt=None, finishedAt=None,
                   stages=stages, error=None)
        self.job(owner, "RUN", {"runId": id, "configuration": snapshot}, run=run,
                 log={"id": "logs-" + id, "entries": []})
        return run

    def log(self, owner, run_id, stage, text, level="INFO", script=None):
        log = self.store.get("logs", owner, "logs-" + run_id)
        log["entries"].append(dict(cursor=len(log["entries"]) + 1, time=now(), stageKey=stage,
                                   level=level, message=text, scriptId=script))
        self.store.put("logs", owner, log)

    def invoke(self, binding, **payload):
        script = binding["script"]
        return execute(dict(payload, code=script["code"], kind=script["kind"],
                            params={**script["params"], **binding.get("params", {})}))

    def checks(self, owner, bindings, rows, seg, with_ids=False, on_output=None):
        result = []
        seen = set()
        for b in bindings:
            output = self.invoke(b, rows=rows, segments=seg)
            if on_output is not None:
                on_output(output)
            check_id = output["checkId"]
            if not isinstance(check_id, str) or not check_id or len(check_id) > 200 or check_id in seen:
                raise ValueError("CHECK.id must be unique and nonempty")
            seen.add(check_id)
            valid_apps = {s["APP_ID"] for s in seg}
            if len(output['result']) > 10000:
                raise ValueError('Too many check rows')
            for row in output["result"]:
                required = {"LABEL", "SOURCE", "ARGUMENT", "CNT", "TOTAL", "METRIC", "APP_IDS", "RESULT", "CONFIDENCE"}
                if not isinstance(row, dict) or not required <= row.keys():
                    raise ValueError("Invalid check row schema")
                if row["SOURCE"] not in ("BEFORE", "AFTER") or row["RESULT"] not in ("PASS", "FAIL") or row["CONFIDENCE"] not in ("HIGH", "LOW"):
                    raise ValueError("Invalid check row enum")
                if (not isinstance(row["APP_IDS"], list) or len(row['APP_IDS']) > 200
                    or any(not isinstance(x, str) for x in row['APP_IDS'])
                    or not set(row["APP_IDS"]) <= valid_apps or len(set(row['APP_IDS'])) != len(row['APP_IDS'])):
                    raise ValueError("Invalid check application IDs")
                if any(type(row[k]) is not int or row[k] < 0 for k in ("CNT", "TOTAL")):
                    raise ValueError("Invalid check counts")
                if row['CNT'] > row['TOTAL'] or row['TOTAL'] > len(valid_apps) or len(row['APP_IDS']) > row['CNT']:
                    raise ValueError('Inconsistent check counts')
                if any(not isinstance(row[k], str) or len(row[k]) > 2000 for k in ('LABEL', 'ARGUMENT')):
                    raise ValueError('Invalid check text')
                if type(row['METRIC']) not in (int, float) or not math.isfinite(row['METRIC']):
                    raise ValueError('Invalid check metric')
                result.append(dict({k: row[k] for k in required}, rowId=uid(), checkId=check_id))
        return (result, seen) if with_ids else result

    def process_run(self, owner, run_id, config):
        run = self.store.get("run", owner, run_id)
        run.update(status="RUNNING", startedAt=now())
        self.store.put("run", owner, run)
        times = {}
        current = None
        try:
            pairs = catalog.load_dataset(config["datasetId"])
            seg = domain.segments(pairs)
            records = [{"APP_ID": id, "SOURCE": side, "document": doc} for id, p in pairs.items() for side, doc in p.items()]
            normalized, compared, facts, checks = [], [], [], []
            ai = dict(status="DISABLED", text=None, error=None, generatedAt=None, reportRevision=None)
            for current in run["stages"]:
                key = current["key"]
                current.update(status="RUNNING", startedAt=now())
                self.store.put("run", owner, run)
                self.log(owner, run_id, key, "Этап начат", script=current["scriptId"])
                start = time.perf_counter()
                if key == "NORMALIZE":
                    normalized = self.invoke(config["normalizer"], records=records)["result"]
                    if not all(isinstance(r, dict) and {"APP_ID", "SOURCE", "PATH", "ARRAY_KEY", "VALUE", "ADJUSTED_VALUE"} <= r.keys() for r in normalized):
                        raise ValueError("Invalid normalized rows")
                    current.update(processed=len(records), total=len(records))
                elif key == "UNION":
                    # Persist vertical rows separately from horizontal comparison.
                    self.store.put("artifact", owner, {"id": "normalized-" + run_id, "rows": normalized})
                elif key == "COMPARE":
                    compared = self.invoke(config["comparator"], rows=normalized)["result"]
                    required = {"APP_ID", "PATH", "ARRAY_KEY", "PREFIX", "CLASS", "SUFFIX", "KEY", "VALUE_BEFORE", "VALUE_AFTER", "ADJUSTED_BEFORE", "ADJUSTED_AFTER", "DIFF_FLAG", "CHANGE_TYPE"}
                    seen = set()
                    for row in compared:
                        if not isinstance(row, dict) or not required <= row.keys():
                            raise ValueError("Invalid comparison schema")
                        identity = row["APP_ID"], row["PATH"], row["ARRAY_KEY"]
                        if identity in seen or row["APP_ID"] not in pairs:
                            raise ValueError("Invalid comparison identity")
                        seen.add(identity)
                        if row["CHANGE_TYPE"] not in ("SAME", "VALUE_CHANGED", "ATTRIBUTE_NEW", "ATTRIBUTE_LOST") or row["DIFF_FLAG"] != int(row["CHANGE_TYPE"] != "SAME"):
                            raise ValueError("Invalid comparison flag")
                        row.setdefault("presentBefore", row["CHANGE_TYPE"] != "ATTRIBUTE_NEW")
                        row.setdefault("presentAfter", row["CHANGE_TYPE"] != "ATTRIBUTE_LOST")
                elif key == "AGGREGATE":
                    facts = self.invoke(config["aggregator"], rows=compared, segments=seg)["result"]
                    for f in facts:
                        if not set(domain.DIMENSIONS + ["CNT", "APP_IDS"]) <= f.keys() or f["CNT"] != len(set(f["APP_IDS"])) or not set(f["APP_IDS"]) <= pairs.keys():
                            raise ValueError("Invalid fact schema or count")
                elif key == "CHECKS":
                    checks = self.checks(owner, config["checks"], compared, seg)
                elif key == "AI_REVIEW":
                    if config["aiReviewEnabled"]:
                        ai = self.ai_review(domain.summary(compared, seg), checks, owner=owner)
                    else:
                        current["status"] = "SKIPPED"
                elif key == "PUBLISH":
                    result_summary = domain.summary(compared, seg)
                    result_summary.update(timingsMs=times.copy(), computedAt=now())
                    self.store.put("result", owner, {"id": run_id, "rows": compared, "segments": seg, "facts": facts,
                        "checks": checks, "raw":records, "reportRevision": 1, "summary": result_summary, "ai": dict(ai, reportRevision=1)})
                times[key] = round((time.perf_counter() - start) * 1000, 2)
                current.update(status="SUCCEEDED" if current["status"] != "SKIPPED" else "SKIPPED", finishedAt=now())
                self.log(owner, run_id, key, "Этап завершён", script=current["scriptId"])
                self.store.put("run", owner, run)
            run.update(status="SUCCEEDED", reportReady=True, finishedAt=now())
        except Exception as exc:
            run.update(status="FAILED", reportReady=False, finishedAt=now(), error=str(exc))
            if current:
                current.update(status="FAILED", error=str(exc), finishedAt=now())
            self.log(owner, run_id, current["key"] if current else None, str(exc), "ERROR")
        self.store.put("run", owner, run)

    def ai_review(self, summary, checks, owner):
        from backend.ai import review
        return review(summary, checks, store=self.store, owner=owner)

    def process_job(self, job):
        owner, p = job["owner"], job["payload"]
        try:
            if job["type"] == "RUN":
                self.process_run(owner, p["runId"], p["configuration"])
                run = self.store.get("run", owner, p["runId"])
                if run["status"] == "FAILED":
                    raise RuntimeError(run["error"])
            elif job["type"] == "AI":
                result = self.store.get("result", owner, p["runId"], sections=("checks",))
                revision = result["reportRevision"]
                opinion = self.ai_review(result["summary"], result["checks"], owner=owner)
                latest = self.store.get("result", owner, p["runId"], sections=())
                if latest["reportRevision"] != revision and opinion["status"] == "READY":
                    opinion["status"] = "STALE"
                latest["ai"] = dict(opinion, reportRevision=revision)
                self.store.put("result", owner, latest)
                job["reportRevision"] = revision
                if opinion["status"] in ("FAILED", "UNAVAILABLE"):
                    raise RuntimeError(opinion["error"])
            else:
                binding = p["binding"]
                if binding["script"]["kind"] == "CHECK":
                    result = self.store.get("result", owner, p["runId"])
                    rows, check_ids = self.checks(owner, [binding], result["rows"], result["segments"], with_ids=True,
                        on_output=lambda output: job.update(stdout=output["stdout"], stderr=output["stderr"]))
                    if job["type"] == "CHECK":
                        # Single worker serializes report changes. Re-read before commit.
                        result = self.store.get("result", owner, p["runId"], sections=("checks",))
                        cid = next(iter(check_ids))
                        result["checks"] = [r for r in result["checks"] if r["checkId"] != cid] + rows
                        result["reportRevision"] += 1
                        if result["ai"]["status"] == "READY":
                            result["ai"]["status"] = "STALE"
                        self.store.put("result", owner, result)
                        job["reportRevision"] = result["reportRevision"]
                    job["previewRows"] = rows[:100]
                    job["truncated"] = len(rows) > 100
                else:
                    pairs = catalog.load_dataset(p["datasetId"])
                    records = [{"APP_ID": id, "SOURCE": side, "document": d} for id, pair in pairs.items() for side, d in pair.items()]
                    builtin = {s["kind"]: dict(script=s, params={}) for s in catalog.scripts() if s["kind"] != "CHECK"}
                    n = binding if binding["script"]["kind"] == "NORMALIZE" else builtin["NORMALIZE"]
                    output = self.invoke(n, records=records)
                    if binding["script"]["kind"] in ("COMPARE", "AGGREGATE"):
                        output = self.invoke(binding if binding["script"]["kind"] == "COMPARE" else builtin["COMPARE"], rows=output["result"])
                    if binding["script"]["kind"] == "AGGREGATE":
                        output = self.invoke(binding, rows=output["result"], segments=domain.segments(pairs))
                    job.update(stdout=output["stdout"], stderr=output["stderr"], previewRows=output["result"][:100], truncated=len(output["result"]) > 100)
            # Preview is for the browser; don't persist arbitrarily large user output.
            preview, size = [], 0
            for row in job.get('previewRows', []):
                size += len(json.dumps(row, ensure_ascii=False).encode())
                if size > 262144:
                    job['truncated'] = True
                    break
                preview.append(row)
            job['previewRows'] = preview
            job["status"] = "SUCCEEDED"
        except Exception as exc:
            job.update(status="FAILED", error=str(exc))
            if isinstance(exc, ExecutionError):
                job.update(stdout=exc.stdout, stderr=exc.stderr)
        self.store.put("job", owner, job)


def matches(row, filters):
    for f in filters:
        field, op, value = f["field"], f["op"], f["value"]
        candidates = value if op == "in" else [value]
        actual = row.get(field)
        vals = str(actual).split(";") if field in ("PRODUCTS", "PARTNER_TYPE", "ROUTING_METHOD") else [actual]
        if not any(v in candidates for v in vals):
            return False
    return True
