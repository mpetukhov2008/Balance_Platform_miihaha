"""End-to-end API test which does not need any user-supplied source files."""
import json
import os
import secrets
from fastapi.testclient import TestClient
from backend import catalog
from backend.api import create_app,password_hash
from backend.store import Store,uid

def test_generated_dataset_pipeline(tmp_path,monkeypatch):
    monkeypatch.setenv("EXECUTION_MODE","trusted-local")
    root=tmp_path/"sources"
    for side in ("BEFORE","AFTER"):
        folder=root/"samples"/side
        folder.mkdir(parents=True)
        for aid in ("generated-a","generated-b"):
            decision="REJECT" if side=="AFTER" and aid=="generated-a" else "APPROVE"
            document={"appData":{"application_id":aid},"decisionResult":{"decision":decision}}
            (folder/(aid+".json")).write_text(json.dumps(document),encoding="utf-8")
    (root/"checks").mkdir()
    (root/"checks"/"check_generated.py").write_text(catalog.TEMPLATES["CHECK"],encoding="utf-8")
    monkeypatch.setattr(catalog,"ROOT",root)
    db=Store(os.environ.get("TEST_POSTGRES_URL") or "sqlite:///"+str(tmp_path/"synthetic.db"))
    owner=uid()
    salt=secrets.token_hex(16)
    db.put("user","system",dict(id=owner,username=owner,salt=salt,passwordHash=password_hash("generated-password",salt)))
    app=create_app(db)
    with TestClient(app) as c:
        login=c.post("/api/v1/auth/login",json={"username":owner,"password":"generated-password"})
        assert login.status_code==200,login.text
        c.headers["X-CSRF-Token"]=login.json()["csrfToken"]
        config=c.post("/api/v1/configurations",json={"name":"generated","datasetId":"samples",
            "normalizer":{"scriptId":"builtin-normalize","params":{}},"comparator":{"scriptId":"builtin-compare","params":{}},
            "aggregator":{"scriptId":"builtin-aggregate","params":{}},"checks":[{"scriptId":"file-check_generated","params":{}}]})
        assert config.status_code==201,config.text
        run=c.post("/api/v1/runs",json={"configurationId":config.json()["id"]}).json()["id"]
        while job:=db.claim():
            app.state.service.process_job(job)
        base=f"/api/v1/runs/{run}"
        status=c.get(base).json()
        assert status["status"]=="SUCCEEDED",status
        summary=c.get(base+"/summary").json()
        assert (summary["totalApps"],summary["changedApps"],summary["decisionChangedApps"])==(2,1,1)
        pivot=c.post(base+"/pivot/query",json={"rows":["PATH"],"columns":["SOURCE"],"filters":[{"field":"DIFF_FLAG","op":"eq","value":1}]}).json()
        assert pivot["uniqueApps"]==1
        token=pivot["cells"][0]["drilldownToken"]
        apps=c.post(base+"/applications/query",json={"drilldownToken":token}).json()
        assert apps["total"]==1 and apps["items"][0]["APP_ID"]=="generated-a"
        rows=c.post(base+"/applications/generated-a/attributes/query",json={"drilldownToken":token}).json()
        assert rows["total"]==1 and rows["items"][0]["PATH"]=="decisionResult.decision"
        assert c.get(base+"/check-results").json()["total"]==1
        assert c.get(base+"/report.html").status_code==200
