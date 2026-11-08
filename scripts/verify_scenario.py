"""Exercise a running API + worker; creates a run and disposable workspace checks."""
import argparse
import getpass
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

import httpx

CHECK_CODE = '''import sys
def run(mart, params):
    ids = sorted(s["APP_ID"] for s in mart.segments() if s["DECISION_CHANGED"])
    print("scenario preview stdout")
    print("scenario preview stderr", file=sys.stderr)
    return [{"LABEL":"Смена решения — контроль сценария", "SOURCE":"AFTER", "ARGUMENT":"",
        "CNT":len(ids), "TOTAL":mart.total_apps(), "METRIC":len(ids)/max(1,mart.total_apps()),
        "APP_IDS":ids[:20], "RESULT":"FAIL" if ids else "PASS", "CONFIDENCE":"HIGH"}]
CHECK = {"id":"scenario_decision_check", "label":"Контроль сценария", "params":{}, "entrypoint":run}
'''


def verify(args, password):
    evidence = {"baseUrl": args.base_url, "dataset": args.dataset}
    with httpx.Client(base_url=args.base_url.rstrip("/") + "/api/v1", timeout=90) as client:
        def request(method, path, body=None):
            response = client.request(method, path, json=body) if body is not None else client.request(method, path)
            response.raise_for_status()
            return response.json()

        def poll(path):
            deadline = time.monotonic() + args.timeout
            previous = None
            while time.monotonic() < deadline:
                item = request("GET", path)
                state = (item["status"], tuple(s["key"] for s in item.get("stages", []) if s["status"] == "RUNNING"))
                if state != previous:
                    print(json.dumps({"operation": path, "status": state[0], "stages": state[1]}), flush=True)
                    previous = state
                if item["status"] not in ("QUEUED", "RUNNING", "PENDING"):
                    failed = [s["key"] for s in item.get("stages", []) if s["status"] == "FAILED"]
                    assert item["status"] == "SUCCEEDED", f"{failed}: {item.get('error') or item['status']}"
                    return item
                time.sleep(1)
            raise TimeoutError("Worker did not finish: " + path)

        assert httpx.get(args.base_url, timeout=30).status_code == 200
        session = request("POST", "/auth/login", {"username": args.username, "password": password})
        client.headers["X-CSRF-Token"] = session["csrfToken"]
        dataset = next(d for d in request("GET", "/datasets")["items"] if d["id"] == args.dataset)
        assert dataset["status"] == "READY", dataset
        if args.run_id:
            run_id = args.run_id
        else:
            checks = request("GET", "/scripts?kind=CHECK&pageSize=200")["items"]
            config = request("POST", "/configurations", {"name": "Приёмка сценария", "datasetId": args.dataset,
                "normalizer": {"scriptId": "builtin-normalize", "params": {}},
                "comparator": {"scriptId": "builtin-compare", "params": {}},
                "aggregator": {"scriptId": "builtin-aggregate", "params": {}},
                "checks": [{"scriptId": s["id"], "params": {}} for s in checks if s["sourceType"] == "FILE"],
                "aiReviewEnabled": False})
            run_id = request("POST", "/runs", {"configurationId": config["id"]})["id"]
        base = "/runs/" + run_id
        run = poll(base)
        assert run["reportReady"] and all(s["status"] == "SUCCEEDED" or
            (s["key"] == "AI_REVIEW" and s["status"] == "SKIPPED") for s in run["stages"])
        assert len(request("GET", base + "/logs")["items"]) >= 14
        summary = request("GET", base + "/summary")
        assert summary["totalApps"] == dataset["appCount"]
        if args.dataset == "full":
            assert tuple(summary[k] for k in ("totalApps", "changedApps", "decisionChangedApps", "externalDriftDecisionApps")) == (2002, 502, 385, 167)
        evidence.update(runId=run_id, counts={k: summary[k] for k in ("totalApps", "changedApps", "decisionChangedApps", "externalDriftDecisionApps")})

        types = request("POST", base + "/pivot/query", {"rows": ["CHANGE_TYPE"], "columns": []})
        assert {r[0] for r in types["rowKeys"]} == {"SAME", "VALUE_CHANGED", "ATTRIBUTE_NEW", "ATTRIBUTE_LOST"}
        pivot = request("POST", base + "/pivot/query", {"rows": ["PATH"], "columns": ["SOURCE"], "filters": [
            {"field": "PATH", "op": "eq", "value": "decisionResult.decision"}, {"field": "DIFF_FLAG", "op": "eq", "value": 1}]})
        assert pivot["uniqueApps"] == summary["decisionChangedApps"]
        token = pivot["cells"][0]["drilldownToken"]
        apps = request("POST", base + "/applications/query", {"drilldownToken": token})
        assert apps["total"] == summary["decisionChangedApps"]
        aid = apps["items"][0]["APP_ID"]
        attrs = request("POST", base + f"/applications/{aid}/attributes/query", {"drilldownToken": token})
        assert attrs["total"] == 1 and attrs["items"][0]["PATH"] == "decisionResult.decision"
        assert request("GET", base + f"/applications/{aid}")["APP_ID"] == aid
        evidence["drilldownVerified"] = True

        before = request("GET", base + "/check-results?pageSize=200")
        initial_ai = request("GET", base + "/ai-review")
        script = request("POST", "/scripts", {"name": "Проверка приёмки", "kind": "CHECK", "contractId": "check-v1", "code": CHECK_CODE})
        preview = request("POST", "/script-executions", {"scriptId": script["id"], "runId": run_id})
        result = poll("/script-executions/" + preview["executionId"])
        assert "scenario preview stdout" in result["stdout"] and "scenario preview stderr" in result["stderr"]
        assert result["previewRows"][0]["CNT"] == summary["decisionChangedApps"]
        assert request("GET", base + "/check-results?pageSize=200") == before
        previous_total = None
        for revision in (before["reportRevision"] + 1, before["reportRevision"] + 2):
            execution = request("POST", base + "/check-executions", {"scriptId": script["id"]})
            assert poll(base + "/check-executions/" + execution["executionId"])["reportRevision"] == revision
            current = request("GET", base + "/check-results?pageSize=200")
            own = [r for r in current["items"] if r["checkId"] == "scenario_decision_check"]
            assert len(own) == 1 and own[0]["CNT"] == summary["decisionChangedApps"]
            if previous_total is not None:
                assert current["total"] == previous_total
            previous_total = current["total"]
        assert request("GET", base + "/summary") == summary
        assert request("GET", base + f"/applications/{aid}/raw?source=BEFORE")["document"]
        if initial_ai["status"] == "READY":
            assert request("GET", base + "/ai-review")["status"] == "STALE"
        evidence.update(checkPreviewOutput=True, checkReplacement=True, reportRevision=current["reportRevision"], aiAfterCheck=request("GET", base + "/ai-review")["status"])

        broken = request("POST", "/scripts", {"name": "Контроль ошибки", "kind": "CHECK", "contractId": "check-v1",
            "code": "print('before scenario failure')\nraise ValueError('scenario failure')"})
        execution = request("POST", "/script-executions", {"scriptId": broken["id"], "runId": run_id})
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            failure = request("GET", "/script-executions/" + execution["executionId"])
            if failure["status"] in ("SUCCEEDED", "FAILED"):
                break
            time.sleep(1)
        assert failure["status"] == "FAILED" and "before scenario failure" in failure["stdout"]
        assert "ValueError: scenario failure" in failure["stderr"]
        assert request("GET", base + "/check-results?pageSize=200") == current

        report = client.get(base + "/report.html")
        assert report.status_code == 200 and "attachment" in report.headers["content-disposition"]
        assert args.base_url.rstrip("/") + "/runs/" + run_id in report.text
        assert "/checks?rowId=" + own[0]["rowId"] in report.text
        public = httpx.get(args.base_url.rstrip("/") + "/api/v1" + base + "/report.html", timeout=30)
        assert public.status_code == 401
        if args.other_username:
            with httpx.Client(base_url=args.base_url.rstrip("/") + "/api/v1", timeout=30) as other:
                login = other.post("/auth/login", json={"username": args.other_username, "password": os.environ.get("SCENARIO_OTHER_PASSWORD", password)})
                login.raise_for_status()
                assert other.get(base).status_code == 404
                assert other.get(base + "/report.html").status_code == 404
            evidence["accountIsolation"] = True
        assert request("GET", "/auth/session")["user"]["id"] == session["user"]["id"]
        evidence.update(htmlVerified=True, pythonFailureVerified=True)
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--username", required=True)
    parser.add_argument("--other-username")
    parser.add_argument("--dataset", default="full", help="Built-in or uploaded dataset ID")
    parser.add_argument("--run-id", help="Reuse an existing published run owned by this user")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--output", default="runtime/scenario-verification.json")
    args = parser.parse_args()
    parsed = urlparse(args.base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        parser.error("A valid base URL is required")
    password = os.environ.get("SCENARIO_PASSWORD") or getpass.getpass("Password: ")
    evidence = verify(args, password)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False))


if __name__ == "__main__":
    main()
