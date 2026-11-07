import os
import secrets
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.api import create_app, password_hash
from backend.store import Store

@pytest.fixture
def setup(tmp_path, monkeypatch):
    if not Path("Исходники/samples/BEFORE").is_dir():
        pytest.skip("Real source samples are not present in this checkout")
    monkeypatch.setenv("EXECUTION_MODE","trusted-local")
    db=Store("sqlite:///"+str(tmp_path/"test.db"))
    for name in ("alice","bob"):
        salt=secrets.token_hex(16)
        db.put("user","system",dict(id=name,username=name,salt=salt,passwordHash=password_hash("test-password",salt)))
    app=create_app(db)
    with TestClient(app) as c:
        r=c.post("/api/v1/auth/login",json={"username":"alice","password":"test-password"})
        assert r.status_code==200,r.text
        c.headers["X-CSRF-Token"]=r.json()["csrfToken"]
        yield c,app

def drain(app):
    while job:=app.state.store.claim():
        app.state.service.process_job(job)

def make_run(c,app):
    config={"name":"samples","datasetId":"samples","normalizer":{"scriptId":"builtin-normalize","params":{}},
        "comparator":{"scriptId":"builtin-compare","params":{}},"aggregator":{"scriptId":"builtin-aggregate","params":{}},
        "checks":[{"scriptId":s["id"],"params":{}} for s in c.get("/api/v1/scripts?kind=CHECK").json()["items"]],"aiReviewEnabled":True}
    r=c.post("/api/v1/configurations",json=config)
    assert r.status_code==201,r.text
    r=c.post("/api/v1/runs",json={"configurationId":r.json()["id"]})
    assert r.status_code==202,r.text
    id=r.json()["id"]
    assert c.get(f"/api/v1/runs/{id}/summary").status_code==409
    drain(app)
    r=c.get(f"/api/v1/runs/{id}")
    assert r.json()["status"]=="SUCCEEDED",r.text
    return id

def test_end_to_end_and_isolation(setup):
    c,app=setup
    id=make_run(c,app)
    base=f"/api/v1/runs/{id}"
    assert c.get(base+"/summary").json()["decisionChangedApps"]==2
    assert c.get(base+"/ai-review").json()["status"]=="UNAVAILABLE"
    checks=c.get(base+"/check-results").json()
    assert len({r["checkId"] for r in checks["items"]})==5
    q=c.post(base+"/pivot/query",json={"rows":["PATH"],"columns":["SOURCE"],"filters":[{"field":"PATH","op":"eq","value":"decisionResult.decision"},{"field":"DIFF_FLAG","op":"eq","value":1}]})
    assert q.status_code==200,q.text
    pivot=q.json()
    assert pivot["uniqueApps"]==2
    token=pivot["cells"][0]["drilldownToken"]
    apps=c.post(base+"/applications/query",json={"drilldownToken":token}).json()
    assert apps["total"]==2
    aid=apps["items"][0]["APP_ID"]
    attrs=c.post(base+f"/applications/{aid}/attributes/query",json={"drilldownToken":token}).json()
    assert attrs["total"]==1
    assert attrs["items"][0]["PATH"]=="decisionResult.decision"
    report=c.get(base+"/report.html")
    assert report.status_code==200
    assert "attachment" in report.headers["content-disposition"]
    assert "http://localhost:5173/runs/" in report.text
    r=c.post("/api/v1/auth/login",json={"username":"bob","password":"test-password"})
    c.headers["X-CSRF-Token"]=r.json()["csrfToken"]
    assert c.get(base).status_code==404
    assert c.get(base+"/report.html").status_code==404
    assert c.get("/api/v1/runs").json()["total"]==0

def test_new_check_replaces_and_html_escapes(setup):
    c,app=setup
    id=make_run(c,app)
    template=c.get("/api/v1/script-contracts").json()["items"][-1]["template"]
    template=template.replace('"Пример"','"<script>alert(1)</script>"')
    r=c.post("/api/v1/scripts",json={"name":"custom","kind":"CHECK","contractId":"check-v1","code":template})
    assert r.status_code==201,r.text
    sid=r.json()["id"]
    for revision in (2,3):
        r=c.post(f"/api/v1/runs/{id}/check-executions",json={"scriptId":sid,"params":{}})
        assert r.status_code==202,r.text
        drain(app)
        execution=c.get(f"/api/v1/runs/{id}/check-executions/"+r.json()["executionId"]).json()
        assert execution["status"]=="SUCCEEDED",execution
        assert execution["reportRevision"]==revision
    report=c.get(f"/api/v1/runs/{id}/report").text
    assert "<script>alert(1)</script>" not in report
    assert "&lt;script&gt;" in report
    rows=c.get(f"/api/v1/runs/{id}/check-results").json()["items"]
    assert sum(r["checkId"]=="custom_check" for r in rows)==1
    # Subsequent check publication must not discard original raw responses.
    raw=c.get(f"/api/v1/runs/{id}/applications/I32554354/raw?source=BEFORE")
    assert raw.json()["document"]["decisionResult"]["decision"]=="REJECT"

def test_cell_drilldown_preserves_per_application_attributes(setup):
    from backend.domain import normalize,compare,aggregate
    c,app=setup
    id=make_run(c,app)
    n=[]
    for aid,doc in (("a",{"x":"Z","y":"other"}),("b",{"x":"other","y":"Z"})):
        for side in ("BEFORE","AFTER"):
            n.extend(normalize(doc,aid,side,{}))
    rows=compare(n)
    seg=[dict(APP_ID=a,PRODUCTS="",PARTNER_TYPE="",ROUTING_METHOD="",DECISION_BEFORE="APPROVE",DECISION_AFTER="APPROVE",DECISION_CHANGED=0) for a in ("a","b")]
    result=app.state.store.get("result","alice",id)
    result.update(rows=rows,segments=seg,facts=aggregate(rows,seg))
    app.state.store.put("result","alice",result)
    r=c.post(f"/api/v1/runs/{id}/pivot/query",json={"rows":[],"columns":[],"filters":[{"field":"VALUE_ADJUSTED","op":"eq","value":"Z"}]}).json()
    token=r["cells"][0]["drilldownToken"]
    for aid,path in (("a","x"),("b","y")):
        attrs=c.post(f"/api/v1/runs/{id}/applications/{aid}/attributes/query",json={"drilldownToken":token}).json()
        assert attrs["total"]==1
        assert attrs["items"][0]["PATH"]==path

def test_csrf_validation_and_script_error(setup):
    c,app=setup
    csrf=c.headers.pop("X-CSRF-Token")
    assert c.post("/api/v1/scripts",json={}).status_code==403
    c.headers["X-CSRF-Token"]=csrf
    assert c.post("/api/v1/configurations",json={}).status_code==422
    r=c.post("/api/v1/scripts",json={"name":"broken","kind":"NORMALIZE","contractId":"normalize-v1","code":"raise ValueError('broken')"})
    job=c.post("/api/v1/script-executions",json={"scriptId":r.json()["id"],"datasetId":"samples","params":{}})
    drain(app)
    r=c.get("/api/v1/script-executions/"+job.json()["executionId"])
    assert r.json()["status"]=="FAILED"
    assert "broken" in r.json()["error"]
    assert "ValueError: broken" in r.json()["stderr"]


def test_regenerate_ai_without_normalization(setup, monkeypatch):
    c, app = setup
    run_id = make_run(c, app)
    base = f"/api/v1/runs/{run_id}"
    monkeypatch.setattr(app.state.service, "ai_review", lambda summary, checks:
                        dict(status="READY", text="Проверенное мнение", error=None, generatedAt="2026-11-07T00:00:00Z"))
    first = c.post(base + "/ai-review")
    assert first.status_code == 202
    assert c.post(base + "/ai-review").json() == first.json()
    assert c.get(base + "/ai-review").json()["status"] == "PENDING"
    drain(app)
    assert c.get(base + "/ai-review").json()["status"] == "READY"
    assert "Проверенное мнение" in c.get(base + "/report").text
    assert c.get(base + "/applications/I32554354/raw?source=BEFORE").json()["document"]


def test_successful_check_preview_keeps_output_without_changing_report(setup):
    c, app = setup
    run_id = make_run(c, app)
    base = f"/api/v1/runs/{run_id}"
    before = c.get(base + "/check-results").json()
    template = c.get("/api/v1/script-contracts").json()["items"][-1]["template"]
    code = "import sys\nprint('check preview stdout')\nprint('check preview stderr', file=sys.stderr)\n" + template
    script = c.post("/api/v1/scripts", json={"name": "Check output", "kind": "CHECK",
                    "contractId": "check-v1", "code": code}).json()
    response = c.post("/api/v1/script-executions", json={"scriptId": script["id"], "runId": run_id})
    assert response.status_code == 202, response.text
    drain(app)
    job = c.get("/api/v1/script-executions/" + response.json()["executionId"]).json()
    assert job["status"] == "SUCCEEDED", job
    assert "check preview stdout" in job["stdout"]
    assert "check preview stderr" in job["stderr"]
    assert len(job["previewRows"]) == 1
    assert c.get(base + "/check-results").json() == before
