import hashlib
import hmac
import html
import json
import os
import secrets
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from fastapi import FastAPI, Request, Response, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel, Field, ConfigDict, model_validator
from backend import catalog, domain, queries
from backend.store import Store, now, uid
from backend.service import Service, STAGES, matches

class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Login(Model):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1000)

class Binding(Model):
    scriptId: str
    params: dict = Field(default_factory=dict)

class Configuration(Model):
    name: str = Field(min_length=1, max_length=200)
    datasetId: str
    normalizer: Binding
    comparator: Binding
    aggregator: Binding
    checks: list[Binding] = Field(default_factory=list)
    aiReviewEnabled: bool = False

class ScriptBody(Model):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["NORMALIZE", "COMPARE", "AGGREGATE", "CHECK"]
    sourceType: Literal["WORKSPACE"] = "WORKSPACE"
    code: str = Field(min_length=1, max_length=200000)
    params: dict = Field(default_factory=dict)
    contractId: str

class ScriptPatch(Model):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    code: str | None = Field(default=None, min_length=1, max_length=200000)
    params: dict | None = None

class Execution(Binding):
    datasetId: str | None = None
    runId: str | None = None

class RunBody(Model):
    configurationId: str

class Filter(Model):
    field: str
    op: Literal["eq", "in"]
    value: Any

    @model_validator(mode="after")
    def validate_filter(self):
        if self.field not in domain.DIMENSIONS:
            raise ValueError("Unknown dimension")
        if self.op == "in" and not isinstance(self.value, list):
            raise ValueError("in expects array")
        values = self.value if self.op == "in" else [self.value]
        if len(values) > 200 or any(isinstance(v, (list, dict)) for v in values):
            raise ValueError("Scalar filters required")
        return self

class PageQuery(Model):
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=50, ge=1, le=200)

class Pivot(PageQuery):
    rows: list[str]
    columns: list[str]
    filters: list[Filter] = Field(default_factory=list, max_length=30)
    measure: Literal["SUM_CNT"] = "SUM_CNT"

    @model_validator(mode="after")
    def fields(self):
        fields = self.rows + self.columns
        if len(fields) > 16 or len(fields) != len(set(fields)) or any(f not in domain.DIMENSIONS for f in fields):
            raise ValueError("Invalid pivot dimensions")
        return self

class Applications(PageQuery):
    drilldownToken: str | None = None
    checkRowId: str | None = None
    filters: list[Filter] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def scope(self):
        if self.drilldownToken and self.checkRowId:
            raise ValueError("Choose one scope")
        return self

class Attributes(PageQuery):
    diffOnly: bool = False
    path: str | None = None
    arrayKey: str | None = None
    drilldownToken: str | None = None

def fail(code, message, status=422):
    raise HTTPException(status, {"code": code, "message": message})

def page(items, page=1, pageSize=50):
    return dict(items=items[(page-1)*pageSize:page*pageSize], total=len(items), page=page, pageSize=pageSize)

def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def create_app(store=None):
    Path("runtime").mkdir(exist_ok=True)
    db = store or Store()
    svc = Service(db)
    app = FastAPI(title="Баланс — API", version="0.1.0")
    app.state.store, app.state.service = db, svc
    base = "/api/v1"

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
        return JSONResponse({"error": detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": str(exc)}}, status_code=422)

    def auth(request: Request):
        token = request.cookies.get("balance_session", "")
        session = db.get("session", None, hashlib.sha256(token.encode()).hexdigest()) if token else None
        if not session or session["expires"] < time.time():
            fail("UNAUTHENTICATED", "Войдите в приложение", 401)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), session["csrfToken"]):
                fail("CSRF", "Недействительный CSRF token", 403)
            check_origin(request)
        return session

    def check_origin(request):
        origin = request.headers.get("origin")
        allowed = os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000,http://localhost:5173").split(",")
        if origin and origin not in allowed:
            fail("ORIGIN", "Недопустимый Origin", 403)

    def owned(kind, session, id):
        data = db.get(kind, session["user"]["id"], id)
        if data is None:
            fail("NOT_FOUND", "Объект не найден", 404)
        return data

    def ready(session, id, sections=()):
        run = owned("run", session, id)
        if not run["reportReady"]:
            fail("REPORT_NOT_READY", "Отчёт ещё не готов", 409)
        data = db.get("result", session["user"]["id"], id, sections=sections)
        if data is None:
            fail("NOT_FOUND", "Результат не найден", 404)
        return data

    def script(session, id):
        data = svc.script(session["user"]["id"], id)
        if data is None:
            fail("NOT_FOUND", "Скрипт не найден", 404)
        return data

    def dataset(id):
        d = next((d for d in catalog.datasets() if d["id"] == id), None)
        if not d or d["status"] != "READY":
            fail("DATASET_UNAVAILABLE", "Датасет недоступен")
        return d

    def binding(session, body):
        b = body.model_dump() if isinstance(body, BaseModel) else body
        s = script(session, b["scriptId"])
        return {"scriptId": s["id"], "params": b["params"], "script": s}

    def config_validate(session, data):
        dataset(data["datasetId"])
        for key, kind in (("normalizer", "NORMALIZE"), ("comparator", "COMPARE"), ("aggregator", "AGGREGATE")):
            if script(session, data[key]["scriptId"])["kind"] != kind:
                fail("SCRIPT_KIND", "Неверный тип процедуры")
        for b in data["checks"]:
            if script(session, b["scriptId"])["kind"] != "CHECK":
                fail("SCRIPT_KIND", "Ожидается проверка")

    def token_scope(session, run_id, token):
        t = owned("drill", session, token)
        if t["runId"] != run_id or t["expires"] < time.time():
            fail("DRILLDOWN_EXPIRED", "Обновите сводную", 409)
        return t

    @app.get(base + "/health")
    def health():
        return {"status": "ok", "executionMode": os.environ.get("EXECUTION_MODE", "docker")}

    @app.post(base + "/auth/login")
    def login(body: Login, request: Request, response: Response):
        check_origin(request)
        # Passwords are never stored in the session or source code.
        u = next((u for u in db.all("user", None) if u["username"] == body.username), None)
        if not u or not hmac.compare_digest(u["passwordHash"], password_hash(body.password, u["salt"])):
            fail("INVALID_CREDENTIALS", "Неверный логин или пароль", 401)
        old = request.cookies.get("balance_session")
        if old:
            db.remove(hashlib.sha256(old.encode()).hexdigest())
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        session = {"id": hashlib.sha256(token.encode()).hexdigest(), "user": {"id": u["id"], "username": u["username"]},
                   "csrfToken": csrf, "expires": time.time() + 43200}
        db.put("session", u["id"], session)
        response.set_cookie("balance_session", token, httponly=True, secure=os.environ.get("COOKIE_SECURE") == "true", samesite="lax", max_age=43200)
        return {"user": session["user"], "csrfToken": csrf}

    @app.get(base + "/auth/session")
    def session(s=Depends(auth)):
        return {"user": s["user"], "csrfToken": s["csrfToken"]}

    @app.post(base + "/auth/logout")
    def logout(response: Response, s=Depends(auth)):
        db.remove(s["id"])
        response.delete_cookie("balance_session")
        return {"ok": True}

    @app.get(base + "/datasets")
    def datasets(page_: int = Query(1, alias="page", ge=1), pageSize: int = Query(50, ge=1, le=200), s=Depends(auth)):
        return page(catalog.datasets(), page_, pageSize)

    @app.get(base + "/script-contracts")
    def contracts(s=Depends(auth)):
        descriptions = {"NORMALIZE": ("document, app_id, source, params", "list нормализованных строк"),
            "COMPARE": ("rows, params", "list строк сравнения"), "AGGREGATE": ("rows, segments, params", "list facts с CNT и APP_IDS"),
            "CHECK": ("mart, params через CHECK.entrypoint", "list строк PASS/FAIL")}
        return {"items": [{"id": k.lower()+"-v1", "kind": k, "description": k,
            "inputDescription": descriptions[k][0], "outputDescription": descriptions[k][1], "template": v} for k, v in catalog.TEMPLATES.items()]}

    @app.get(base + "/scripts")
    def scripts(kind: str | None = None, page_: int = Query(1, alias="page", ge=1), pageSize: int = Query(50, ge=1, le=200), s=Depends(auth)):
        items = catalog.scripts() + db.all("script", s["user"]["id"])
        return page(sorted([r for r in items if kind is None or r["kind"] == kind], key=lambda x: x["id"]), page_, pageSize)

    @app.get(base + "/scripts/{id}")
    def get_script(id: str, s=Depends(auth)):
        return script(s, id)

    @app.post(base + "/scripts", status_code=201)
    def create_script(body: ScriptBody, s=Depends(auth)):
        if body.contractId != body.kind.lower() + "-v1":
            fail("CONTRACT", "Неверный contractId")
        return db.put("script", s["user"]["id"], dict(body.model_dump(), id=uid(), updatedAt=now(), filename=None, checkId=None))

    @app.patch(base + "/scripts/{id}")
    def patch_script(id: str, body: ScriptPatch, s=Depends(auth)):
        item = script(s, id)
        if item["sourceType"] != "WORKSPACE":
            fail("READ_ONLY", "Скопируйте файл в рабочую область", 409)
        updates = body.model_dump(exclude_unset=True)
        if any(v is None for v in updates.values()):
            fail("INVALID_PATCH", "Поля не могут быть null")
        item.update(updates, updatedAt=now())
        return db.put("script", s["user"]["id"], item)

    @app.get(base + "/configurations")
    def configs(page_: int = Query(1, alias="page", ge=1), pageSize: int = Query(50, ge=1, le=200), s=Depends(auth)):
        return page(db.all("config", s["user"]["id"]), page_, pageSize)

    @app.get(base + "/configurations/{id}")
    def config(id: str, s=Depends(auth)):
        return owned("config", s, id)

    @app.post(base + "/configurations", status_code=201)
    def create_config(body: Configuration, s=Depends(auth)):
        data = body.model_dump()
        config_validate(s, data)
        return db.put("config", s["user"]["id"], dict(data, id=uid(), createdAt=now(), updatedAt=now()))

    @app.patch(base + "/configurations/{id}")
    def patch_config(id: str, body: dict, s=Depends(auth)):
        old = owned("config", s, id)
        merged = {k: v for k, v in old.items() if k not in ("id", "createdAt", "updatedAt")}
        merged.update(body)
        try:
            data = Configuration.model_validate(merged).model_dump()
        except ValueError as exc:
            fail("VALIDATION_ERROR", str(exc))
        config_validate(s, data)
        return db.put("config", s["user"]["id"], dict(data, id=id, createdAt=old["createdAt"], updatedAt=now()))

    @app.post(base + "/runs", status_code=202)
    def start(body: RunBody, s=Depends(auth)):
        c = owned("config", s, body.configurationId)
        config_validate(s, c)
        r = svc.start_run(s["user"]["id"], c)
        return {"id": r["id"], "status": r["status"]}

    @app.get(base + "/runs")
    def runs(page_: int = Query(1, alias="page", ge=1), pageSize: int = Query(50, ge=1, le=200), s=Depends(auth)):
        return page(db.all("run", s["user"]["id"]), page_, pageSize)

    @app.get(base + "/runs/{id}")
    def run(id: str, s=Depends(auth)):
        return owned("run", s, id)

    @app.get(base + "/runs/{id}/logs")
    def logs(id: str, after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=200), s=Depends(auth)):
        owned("run", s, id)
        rows = [r for r in owned("logs", s, "logs-" + id)["entries"] if r["cursor"] > after]
        items = rows[:limit]
        return {"items": items, "nextCursor": items[-1]["cursor"] if items else after, "hasMore": len(rows) > limit}

    @app.get(base + "/runs/{id}/summary")
    def summary(id: str, s=Depends(auth)):
        return ready(s, id)["summary"]

    @app.get(base + "/runs/{id}/dimensions")
    def dimensions(id: str, s=Depends(auth)):
        ready(s, id)
        return {"items": [{"name": n, "label": n, "type": "number" if n in ("DIFF_FLAG", "DECISION_CHANGED") else "string", "canGroup": True, "canFilter": True} for n in domain.DIMENSIONS]}

    @app.post(base + "/runs/{id}/pivot/query")
    def pivot(id: str, body: Pivot, s=Depends(auth)):
        ready(s, id)
        owner=s["user"]["id"]
        filters=[f.model_dump() for f in body.filters]
        try:
            rows,columns,groups,total,unique=queries.pivot(db.engine,owner,id,body.rows,body.columns,filters,body.page,body.pageSize)
        except ValueError:
            fail("PIVOT_TOO_WIDE","Добавьте фильтры или уменьшите число колонок")
        cells=[]
        for ri,ci,value,cell_filters in groups:
            token=uid()
            db.put("drill",owner,{"id":token,"runId":id,"expires":time.time()+3600,"filters":cell_filters})
            cells.append(dict(rowIndex=ri,columnIndex=ci,value=value,drilldownToken=token))
        return dict(rowFields=body.rows,columnFields=body.columns,rowKeys=rows,columnKeys=columns,
            cells=cells,totalRows=total,page=body.page,pageSize=body.pageSize,
            measure={"id":"SUM_CNT","label":"Участия заявок в группах","additive":True},uniqueApps=unique)

    @app.post(base + "/runs/{id}/applications/query")
    def applications(id: str, body: Applications, s=Depends(auth)):
        ready(s,id)
        filters=[f.model_dump() for f in body.filters]
        scope,apps="FILTER",None
        if body.drilldownToken:
            t=token_scope(s,id,body.drilldownToken)
            filters=t["filters"]+filters
            scope="FULL_GROUP"
        elif body.checkRowId:
            result=ready(s,id,("checks",))
            row=next((r for r in result["checks"] if r["rowId"]==body.checkRowId),None)
            if row is None:
                fail("NOT_FOUND","Строка проверки не найдена",404)
            apps,scope=row["APP_IDS"],"CHECK_SAMPLE"
        return dict(queries.applications(db.engine,s["user"]["id"],id,filters,apps,body.page,body.pageSize),
                    scope=scope,matchedAttributes=None)

    @app.get(base + "/runs/{id}/applications/{app_id}")
    def application(id: str, app_id: str, s=Depends(auth)):
        ready(s,id)
        seg=queries.segment(db.engine,s["user"]["id"],id,app_id)
        if seg is None:
            fail("NOT_FOUND", "Заявка не найдена", 404)
        evidence = [{"kind":row["CHANGE_TYPE"],"text":row["PATH"]+": "+row["VALUE_BEFORE"]+" → "+row["VALUE_AFTER"],
            "PATH":row["PATH"],"ARRAY_KEY":row["ARRAY_KEY"]} for row in db.attributes(s["user"]["id"],id,app_id,diff_only=True)][:100]
        return dict(APP_ID=app_id,segments=seg,decisionEvidence=evidence,evidenceNote="Наблюдаемые изменения не доказывают причинность")

    @app.post(base + "/runs/{id}/applications/{app_id}/attributes/query")
    def attributes(id: str, app_id: str, body: Attributes, s=Depends(auth)):
        r = ready(s, id)
        application(id, app_id, s)
        allowed = None
        if body.drilldownToken:
            t = token_scope(s, id, body.drilldownToken)
            allowed=queries.matching_attributes(db.engine,s["user"]["id"],id,app_id,t["filters"])
            if not allowed:
                fail("NOT_FOUND","Заявка вне выборки",404)
        rows = [r for r in db.attributes(s["user"]["id"],id,app_id,body.path,body.arrayKey,body.diffOnly) if (not body.diffOnly or r["DIFF_FLAG"])
            and (body.path is None or r["PATH"] == body.path) and (body.arrayKey is None or r["ARRAY_KEY"] == body.arrayKey)
            and (allowed is None or (r["PATH"],r["ARRAY_KEY"]) in allowed)]
        return page(rows, body.page, body.pageSize)

    @app.get(base + "/runs/{id}/applications/{app_id}/raw")
    def raw(id: str, app_id: str, source: Literal["BEFORE","AFTER"], s=Depends(auth)):
        application(id, app_id, s)
        return {"APP_ID":app_id,"SOURCE":source,"document":db.raw(s["user"]["id"],id,app_id,source)}

    @app.get(base + "/runs/{id}/check-results")
    def check_results(id: str, page_: int = Query(1, alias="page", ge=1), pageSize: int = Query(50, ge=1, le=200), s=Depends(auth)):
        r = ready(s, id, ("checks",))
        return dict(page(r["checks"], page_, pageSize), reportRevision=r["reportRevision"])

    @app.get(base + "/runs/{id}/ai-review")
    def ai(id: str, s=Depends(auth)):
        return ready(s, id)["ai"]

    @app.post(base + "/script-executions", status_code=202)
    def execute_script(body: Execution, s=Depends(auth)):
        b = binding(s, body.model_dump(include={"scriptId","params"}))
        if b["script"]["kind"] == "CHECK":
            if not body.runId:
                fail("CONTEXT", "Требуется runId")
            ready(s, body.runId)
        else:
            dataset(body.datasetId)
        j = svc.job(s["user"]["id"], "PREVIEW", {"binding":b,"datasetId":body.datasetId,"runId":body.runId})
        return {"executionId":j["id"]}

    @app.get(base + "/script-executions/{id}")
    def execution(id: str, s=Depends(auth)):
        j = owned("job", s, id)
        if j["type"] != "PREVIEW":
            fail("NOT_FOUND", "Исполнение не найдено", 404)
        return {k:j[k] for k in ("id","status","stdout","stderr","diagnostics","previewRows","truncated","error")}

    @app.post(base + "/runs/{id}/check-executions", status_code=202)
    def execute_check(id: str, body: Binding, s=Depends(auth)):
        ready(s, id)
        b = binding(s, body)
        if b["script"]["kind"] != "CHECK":
            fail("SCRIPT_KIND", "Требуется CHECK")
        j = svc.job(s["user"]["id"], "CHECK", {"runId":id,"binding":b})
        return {"executionId":j["id"]}

    @app.get(base + "/runs/{id}/check-executions/{execution_id}")
    def check_execution(id: str, execution_id: str, s=Depends(auth)):
        owned("run", s, id)
        j = owned("job", s, execution_id)
        if j["type"] != "CHECK" or j["payload"]["runId"] != id:
            fail("NOT_FOUND", "Исполнение не найдено", 404)
        return {k:j[k] for k in ("id","status","error","reportRevision")}

    def report_html(id, s):
        r = ready(s, id, ("checks",))
        esc = lambda x: html.escape(str(x), quote=True)
        origin = os.environ.get("APP_PUBLIC_URL", "http://localhost:5173").rstrip("/")
        link = origin + "/runs/" + id
        columns = ["LABEL","SOURCE","ARGUMENT","CNT","TOTAL","METRIC","RESULT","CONFIDENCE"]
        rows = ""
        for row in r["checks"]:
            rows += '<tr class="' + ("low" if row["CONFIDENCE"] == "LOW" else "") + '">' + "".join("<td>"+esc(row[k])+"</td>" for k in columns)
            rows += '<td><a href="'+esc(link+"/checks?rowId="+row["rowId"])+'">'+str(len(row["APP_IDS"]))+" из "+str(row["CNT"])+"</a></td></tr>"
        return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Отчёт СПР</title><style>body{font:16px sans-serif;margin:32px}td,th{border:1px solid #aaa;padding:8px}table{border-collapse:collapse}.low{color:#777;background:#fafafa}</style><h1>Отчёт СПР</h1><a href="'+esc(link)+'">Открыть сводный отчёт</a><pre>'+esc(json.dumps(r["summary"],ensure_ascii=False,indent=2))+'</pre><table><tr>'+"".join("<th>"+k+"</th>" for k in columns)+"<th>Заявки</th></tr>"+rows+'</table><h2>Мнение ИИ</h2><p>'+esc(r["ai"]["status"])+"</p><pre>"+esc(r["ai"].get("text") or r["ai"].get("error") or "—")+"</pre></html>"

    @app.get(base + "/runs/{id}/report", response_class=HTMLResponse)
    def report(id: str, s=Depends(auth)):
        return HTMLResponse(report_html(id, s))

    @app.get(base + "/runs/{id}/report.html", response_class=HTMLResponse)
    def download(id: str, s=Depends(auth)):
        return HTMLResponse(report_html(id, s), headers={"Content-Disposition":'attachment; filename="report.html"'})

    return app

app = create_app()
