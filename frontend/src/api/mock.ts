// Демонстрационная реализация ApiClient. Включается только VITE_USE_MOCK_API=true.
// Все данные искусственные; интерфейс подписывает режим баннером «Демонстрационные данные».
import { ApiError, type ApiClient } from "./client";
import { DEMO_APPS, DEMO_CHECKS, DEMO_ROWS, DEMO_SEGMENTS, demoRaw } from "./mockData";
import type { CheckResult, Configuration, Filter, Run, Script, Stage } from "./types";
import { STAGE_KEYS } from "./types";

type C = ApiClient;
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 1;
const id = (p: string) => `${p}-${String(seq++).padStart(4, "0")}`;
const page = <T,>(all: T[], p = 1, ps = 50) => ({ items: all.slice((p - 1) * ps, p * ps), total: all.length, page: p, pageSize: ps });
const notFound = () => new ApiError(404, "NOT_FOUND", "Объект не найден");

const CHECK_TEMPLATE = `def run(mart, params):
    total = mart.total_apps()
    changed = mart.app_ids(diff_flag=1)
    return [{"LABEL": "Заявки с отличиями", "SOURCE": "AFTER", "ARGUMENT": "",
             "CNT": len(changed), "TOTAL": total, "METRIC": round(len(changed) / total, 4) if total else 0,
             "APP_IDS": changed[:params.get("app_ids_limit", 20)], "RESULT": "PASS", "CONFIDENCE": "HIGH"}]

CHECK = {"id": "custom_check", "label": "Заявки с отличиями", "params": {"app_ids_limit": 20}, "entrypoint": run}
`;

function builtin(idv: string, kind: Script["kind"], filename: string, params: Record<string, unknown> = {}, checkId: string | null = null): Script {
  return { id: idv, name: checkId ?? kind, kind, sourceType: "FILE", filename, params, updatedAt: now(), contractId: kind.toLowerCase() + "-v1", checkId, code: `# Демо: содержимое ${filename}\n# Реальный код отдаёт сервер.\n\ndef run(*args, **kwargs):\n    ...\n` };
}

export class MockApiClient implements ApiClient {
  registrationOptions: C["registrationOptions"] = async () => ({ registrationEnabled: true, passwordMinLength: 15 });
  register: C["register"] = async () => ({ ok: true });
  limits: C["limits"] = async () => ({ aiRequestsUsed: 0, aiRequestsLimit: 10, aiTokensUsed: 0, aiTokensLimit: 30000, resetTimezone: "UTC" });
  readonly mode = "mock" as const;
  onUnauthorized?: () => void;
  private user: { id: string; username: string } | null = null;
  private scriptsDb: Script[] = [
    builtin("builtin-normalize", "NORMALIZE", "normalize.py", { exclude: ["appData.request_id"], arrays: {}, buckets: {} }),
    builtin("builtin-compare", "COMPARE", "compare.py"),
    builtin("builtin-aggregate", "AGGREGATE", "aggregate.py"),
    ...DEMO_CHECKS.map((c) => builtin(`file-check_${c.checkId}`, "CHECK", `check_${c.checkId}.py`, { low_confidence_cnt: 5, app_ids_limit: 20 }, c.checkId)),
  ];
  private configs: Configuration[] = [];
  private runsDb: (Run & { ticks: number; fail: boolean })[] = [];
  private checks = new Map<string, CheckResult[]>();
  private revisions = new Map<string, number>();
  private executions = new Map<string, { status: Run["status"]; at: number; fail: boolean; runId?: string; scriptId: string }>();
  private tokens = new Map<string, { runId: string; preds: Record<string, unknown> }>();

  /** Демонстрация истёкшей сессии (кнопка в баннере демо-режима). */
  expireSession() {
    this.user = null;
  }

  private auth() {
    if (!this.user) {
      const e = new ApiError(401, "UNAUTHENTICATED", "Сессия истекла. Войдите снова (демо).");
      this.onUnauthorized?.();
      throw e;
    }
  }

  login: C["login"] = async (username, password) => {
    await wait();
    if (!username || !password) throw new ApiError(401, "INVALID_CREDENTIALS", "Неверное имя пользователя или пароль");
    this.user = { id: "u-" + username, username };
    return { user: this.user, csrfToken: "demo" };
  };
  session: C["session"] = async () => {
    await wait(100);
    if (!this.user) throw new ApiError(401, "UNAUTHENTICATED", "Войдите в приложение");
    return { user: this.user, csrfToken: "demo" };
  };
  logout: C["logout"] = async () => {
    this.user = null;
  };

  datasets: C["datasets"] = async () => {
    this.auth();
    return page([
      { id: "demo", name: "Демо: три искусственные заявки", kind: "CUSTOM" as const, status: "READY" as const, appCount: 3, description: "Не реальный датасет" },
      { id: "full", name: "Полный датасет", kind: "FULL" as const, status: "UNAVAILABLE" as const, appCount: null, description: "В демо-режиме недоступен" },
    ]);
  };
  datasetUploadOptions: C["datasetUploadOptions"] = async () => ({ maxArchiveBytes: 33554432, maxExpandedBytes: 67108864, maxPairs: 20000, maxDatasets: 5 });
  uploadDataset: C["uploadDataset"] = async () => {
    this.auth();
    throw new ApiError(422, "DEMO_ONLY", "Для загрузки своего датасета откройте приложение с работающим сервером. Демо использует искусственные данные.");
  };
  scripts: C["scripts"] = async (kind, p, ps) => {
    this.auth();
    return page(this.scriptsDb.filter((s) => !kind || s.kind === kind), p, ps ?? 200);
  };
  script: C["script"] = async (sid) => {
    this.auth();
    const s = this.scriptsDb.find((x) => x.id === sid);
    if (!s) throw notFound();
    return s;
  };
  scriptContracts: C["scriptContracts"] = async () => {
    this.auth();
    const generic = (k: string, inp: string, out: string) => ({ id: k.toLowerCase() + "-v1", kind: k as Script["kind"], description: k, inputDescription: inp, outputDescription: out, template: `def run(${inp}):\n    return []\n` });
    return {
      items: [
        generic("NORMALIZE", "document, app_id, source, params", "list нормализованных строк"),
        generic("COMPARE", "rows, params", "list строк сравнения"),
        generic("AGGREGATE", "rows, segments, params", "list facts с CNT и APP_IDS"),
        { id: "check-v1", kind: "CHECK", description: "CHECK", inputDescription: "mart, params через CHECK.entrypoint", outputDescription: "list строк PASS/FAIL", template: CHECK_TEMPLATE },
      ],
    };
  };
  createScript: C["createScript"] = async (body) => {
    this.auth();
    await wait();
    const s: Script = { ...body, id: id("ws"), filename: null, updatedAt: now(), checkId: body.kind === "CHECK" ? /"id"\s*:\s*"([^"]+)"/.exec(body.code)?.[1] ?? null : null };
    this.scriptsDb.push(s);
    return s;
  };
  updateScript: C["updateScript"] = async (sid, body) => {
    const s = await this.script(sid);
    if (s.sourceType === "FILE") throw new ApiError(422, "READ_ONLY", "FILE-скрипт не редактируется");
    Object.assign(s, body, { updatedAt: now() });
    return s;
  };
  executeScript: C["executeScript"] = async (body) => {
    const s = await this.script(body.scriptId);
    const eid = id("ex");
    this.executions.set(eid, { status: "RUNNING", at: Date.now(), fail: /raise|1\s*\/\s*0/.test(s.code), runId: body.runId, scriptId: s.id });
    return { executionId: eid };
  };
  scriptExecution: C["scriptExecution"] = async (eid) => {
    this.auth();
    const e = this.executions.get(eid);
    if (!e) throw notFound();
    const done = Date.now() - e.at > 1200;
    const base = { id: eid, diagnostics: [], truncated: false, stdout: "", stderr: "", previewRows: [] as Record<string, unknown>[], error: null as string | null };
    if (!done) return { ...base, status: "RUNNING" as const };
    if (e.fail) return { ...base, status: "FAILED" as const, stderr: 'Traceback (most recent call last):\n  File "check.py", line 3, in run\nZeroDivisionError: division by zero', error: "ZeroDivisionError: division by zero (демо)" };
    return { ...base, status: "SUCCEEDED" as const, stdout: "демо: выполнено на искусственных данных\n", previewRows: [{ LABEL: "Заявки с отличиями", SOURCE: "AFTER", CNT: 3, TOTAL: 3, RESULT: "PASS", CONFIDENCE: "HIGH" }] };
  };

  configurations: C["configurations"] = async (p, ps) => {
    this.auth();
    return page([...this.configs].reverse(), p, ps);
  };
  configuration: C["configuration"] = async (cid) => {
    this.auth();
    const c = this.configs.find((x) => x.id === cid);
    if (!c) throw notFound();
    return c;
  };
  createConfiguration: C["createConfiguration"] = async (body) => {
    this.auth();
    await wait();
    if (!body.name.trim()) throw new ApiError(422, "VALIDATION_ERROR", "Укажите название конфигурации", { fields: { name: "Обязательное поле" } });
    const c: Configuration = { ...body, id: id("cfg"), createdAt: now(), updatedAt: now() };
    this.configs.push(c);
    return c;
  };
  updateConfiguration: C["updateConfiguration"] = async (cid, body) => {
    const c = await this.configuration(cid);
    Object.assign(c, body, { updatedAt: now() });
    return c;
  };

  startRun: C["startRun"] = async (configurationId) => {
    const c = await this.configuration(configurationId);
    const r = {
      id: id("run"), configurationId, datasetId: c.datasetId, datasetName: "Демо: три искусственные заявки",
      status: "QUEUED" as const, reportReady: false, createdAt: now(), startedAt: null, finishedAt: null, error: null,
      stages: STAGE_KEYS.map((key): Stage => ({ key, status: "PENDING", processed: null, total: null, scriptId: null, startedAt: null, finishedAt: null, error: null })),
      ticks: 0, fail: /fail|ошиб/i.test(c.name),
    };
    this.runsDb.push(r);
    return { id: r.id, status: "QUEUED" };
  };
  /** Каждый опрос продвигает демо-запуск на шаг: QUEUED → этапы → SUCCEEDED/FAILED. */
  private advance(r: MockApiClient["runsDb"][number]) {
    if (r.status === "SUCCEEDED" || r.status === "FAILED") return;
    r.ticks++;
    if (r.ticks < 2) return;
    const idx = Math.floor((r.ticks - 2) / 2);
    r.status = "RUNNING";
    r.startedAt ??= now();
    const scriptFor: Record<string, string> = { NORMALIZE: "builtin-normalize", COMPARE: "builtin-compare", AGGREGATE: "builtin-aggregate" };
    r.stages.forEach((s, i) => {
      if (i < idx && s.status === "RUNNING") Object.assign(s, { status: "SUCCEEDED", finishedAt: now(), processed: s.total });
      if (i === idx && s.status === "PENDING") Object.assign(s, { status: "RUNNING", startedAt: now(), scriptId: scriptFor[s.key] ?? null, total: s.key === "NORMALIZE" ? 6 : null, processed: s.key === "NORMALIZE" ? 3 : null });
    });
    const cur = r.stages[idx];
    if (r.fail && cur?.key === "COMPARE") {
      Object.assign(cur, { status: "FAILED", finishedAt: now(), error: "KeyError: 'PATH' (демо-ошибка этапа)" });
      r.stages.slice(idx + 1).forEach((s) => (s.status = "SKIPPED"));
      Object.assign(r, { status: "FAILED", finishedAt: now(), error: "Этап COMPARE завершился ошибкой" });
    } else if (idx >= r.stages.length) {
      r.stages.forEach((s) => s.status === "RUNNING" && Object.assign(s, { status: "SUCCEEDED", finishedAt: now() }));
      Object.assign(r, { status: "SUCCEEDED", reportReady: true, finishedAt: now() });
      this.checks.set(r.id, DEMO_CHECKS.map((c) => ({ ...c, rowId: id("row") })));
      this.revisions.set(r.id, 1);
    }
  }
  runs: C["runs"] = async (p, ps) => {
    this.auth();
    this.runsDb.forEach((r) => this.advance(r));
    return page([...this.runsDb].reverse(), p, ps);
  };
  run: C["run"] = async (rid) => {
    this.auth();
    const r = this.runsDb.find((x) => x.id === rid);
    if (!r) throw notFound();
    this.advance(r);
    const { ticks: _t, fail: _f, ...rest } = r;
    return structuredClone(rest);
  };
  runLogs: C["runLogs"] = async (rid, after) => {
    const r = await this.run(rid);
    const items = r.stages.flatMap((s) => {
      const out = [];
      if (s.startedAt) out.push({ stageKey: s.key, level: "INFO" as const, message: "Этап начат", scriptId: s.scriptId, time: s.startedAt });
      if (s.status === "SUCCEEDED") out.push({ stageKey: s.key, level: "INFO" as const, message: "Этап завершён", scriptId: s.scriptId, time: s.finishedAt ?? now() });
      if (s.status === "FAILED") out.push({ stageKey: s.key, level: "ERROR" as const, message: s.error ?? "Ошибка", scriptId: s.scriptId, time: s.finishedAt ?? now() });
      return out;
    }).map((e, i) => ({ ...e, cursor: i + 1 }));
    const fresh = items.filter((e) => e.cursor > after);
    return { items: fresh, nextCursor: items.length, hasMore: false };
  };

  private async ready(rid: string) {
    const r = await this.run(rid);
    if (!r.reportReady) throw new ApiError(409, "REPORT_NOT_READY", "Отчёт ещё не готов");
    return r;
  }
  summary: C["summary"] = async (rid) => {
    await this.ready(rid);
    const changed = new Set(DEMO_ROWS.filter((r) => r.DIFF_FLAG).map((r) => r.APP_ID));
    const byPath = new Map<string, Set<string>>();
    DEMO_ROWS.filter((r) => r.DIFF_FLAG).forEach((r) => byPath.set(r.PATH, (byPath.get(r.PATH) ?? new Set()).add(r.APP_ID)));
    return {
      totalApps: 3, changedApps: changed.size, decisionChangedApps: 2,
      decisionTransitions: [{ before: "APPROVE", after: "REJECT", count: 1 }, { before: "REJECT", after: "APPROVE", count: 1 }, { before: "APPROVE", after: "APPROVE", count: 1 }],
      topChangedAttributes: [...byPath].map(([PATH, s]) => ({ PATH, changedApps: s.size })).sort((a, b) => b.changedApps - a.changedApps),
      externalDriftDecisionApps: null, timingsMs: { NORMALIZE: 12, COMPARE: 8, AGGREGATE: 5, CHECKS: 20 }, computedAt: now(),
    };
  };
  dimensions: C["dimensions"] = async (rid) => {
    await this.ready(rid);
    const f = (name: string, type: "string" | "number" = "string") => ({ name, label: name, type, canGroup: true, canFilter: true });
    return { items: [f("PREFIX"), f("CLASS"), f("SUFFIX"), f("ARRAY_KEY"), f("KEY"), f("PATH"), f("VALUE_ADJUSTED"), f("DIFF_FLAG", "number"), f("CHANGE_TYPE"), f("SOURCE"), f("PRODUCTS"), f("PARTNER_TYPE"), f("DECISION_CHANGED", "number")] };
  };

  /** Демо-факты: по строке на (атрибут, SOURCE) из искусственного набора. Не нормализатор. */
  private facts() {
    return DEMO_ROWS.flatMap((r) => {
      const seg = DEMO_SEGMENTS[r.APP_ID];
      const base = { ...r, PRODUCTS: seg.PRODUCTS, PARTNER_TYPE: seg.PARTNER_TYPE, DECISION_CHANGED: seg.DECISION_CHANGED };
      const out = [];
      if (r.presentBefore) out.push({ ...base, SOURCE: "BEFORE", VALUE_ADJUSTED: r.ADJUSTED_BEFORE });
      if (r.presentAfter) out.push({ ...base, SOURCE: "AFTER", VALUE_ADJUSTED: r.ADJUSTED_AFTER });
      return out;
    }) as Record<string, unknown>[];
  }
  private match(f: Record<string, unknown>, filters: Filter[]) {
    return filters.every((x) => {
      const v = f[x.field];
      const vals = Array.isArray(x.value) ? x.value : [x.value];
      if (x.field === "PRODUCTS") return vals.some((p) => String(v).split(";").includes(String(p)));
      return vals.some((p) => String(p) === String(v));
    });
  }
  pivot: C["pivot"] = async (rid, q) => {
    await this.ready(rid);
    await wait(200);
    const facts = this.facts().filter((f) => this.match(f, q.filters));
    const key = (f: Record<string, unknown>, fields: string[]) => fields.map((n) => f[n] as string | number);
    const rowMap = new Map<string, (string | number)[]>(), colMap = new Map<string, (string | number)[]>();
    facts.forEach((f) => { rowMap.set(JSON.stringify(key(f, q.rows)), key(f, q.rows)); colMap.set(JSON.stringify(key(f, q.columns)), key(f, q.columns)); });
    const sortK = (a: [string, unknown], b: [string, unknown]) => a[0].localeCompare(b[0]);
    const allRows = [...rowMap].sort(sortK), cols = [...colMap].sort(sortK);
    if (cols.length > 40) throw new ApiError(422, "PIVOT_TOO_WIDE", "Слишком много колонок; уменьшите разрез или добавьте фильтр");
    const rows = allRows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const cells = rows.flatMap(([rk], ri) => cols.flatMap(([ck], ci) => {
      const inCell = facts.filter((f) => JSON.stringify(key(f, q.rows)) === rk && JSON.stringify(key(f, q.columns)) === ck);
      if (!inCell.length) return [];
      const t = id("tok");
      this.tokens.set(t, { runId: rid, preds: { rows: q.rows, rk, columns: q.columns, ck, filters: q.filters } });
      return [{ rowIndex: ri, columnIndex: ci, value: inCell.length, drilldownToken: t }];
    }));
    return { rowFields: q.rows, columnFields: q.columns, rowKeys: rows.map((r) => r[1]), columnKeys: cols.map((c) => c[1]), cells, totalRows: allRows.length, page: q.page, pageSize: q.pageSize, measure: { id: "SUM_CNT", label: "Участия заявок в группах", additive: true }, uniqueApps: new Set(facts.map((f) => f.APP_ID)).size };
  };
  private tokenFacts(rid: string, token: string) {
    const t = this.tokens.get(token);
    if (!t || t.runId !== rid) throw new ApiError(409, "DRILLDOWN_EXPIRED", "Обновите сводную");
    const p = t.preds as { rows: string[]; rk: string; columns: string[]; ck: string; filters: Filter[] };
    return this.facts().filter((f) => this.match(f, p.filters) && JSON.stringify(p.rows.map((n) => f[n])) === p.rk && JSON.stringify(p.columns.map((n) => f[n])) === p.ck);
  }
  applications: C["applications"] = async (rid, q) => {
    await this.ready(rid);
    let ids: string[];
    let scope: "FULL_GROUP" | "CHECK_SAMPLE" | "FILTER" = "FILTER";
    if (q.drilldownToken) { ids = [...new Set(this.tokenFacts(rid, q.drilldownToken).map((f) => f.APP_ID as string))]; scope = "FULL_GROUP"; }
    else if (q.checkRowId) {
      const row = (this.checks.get(rid) ?? []).find((c) => c.rowId === q.checkRowId);
      if (!row) throw notFound();
      ids = row.APP_IDS; scope = "CHECK_SAMPLE";
    } else ids = [...DEMO_APPS];
    if (q.filters?.length) ids = ids.filter((a) => this.match({ ...DEMO_SEGMENTS[a], APP_ID: a }, q.filters!));
    const items = ids.sort().map((a) => {
      const s = DEMO_SEGMENTS[a];
      return { APP_ID: a, DECISION_BEFORE: s.DECISION_BEFORE as string, DECISION_AFTER: s.DECISION_AFTER as string, DECISION_CHANGED: s.DECISION_CHANGED as 0 | 1, changedAttributes: DEMO_ROWS.filter((r) => r.APP_ID === a && r.DIFF_FLAG).length };
    });
    return { ...page(items, q.page, q.pageSize), scope, matchedAttributes: null };
  };
  application: C["application"] = async (rid, appId) => {
    await this.ready(rid);
    if (!DEMO_SEGMENTS[appId]) throw notFound();
    return {
      APP_ID: appId, segments: { APP_ID: appId, ...DEMO_SEGMENTS[appId] },
      decisionEvidence: DEMO_ROWS.filter((r) => r.APP_ID === appId && r.DIFF_FLAG).map((r) => ({ kind: r.CHANGE_TYPE, text: `${r.PATH}: ${r.VALUE_BEFORE} → ${r.VALUE_AFTER}`, PATH: r.PATH, ARRAY_KEY: r.ARRAY_KEY })),
      evidenceNote: "Демо: наблюдаемые изменения, не доказанная причина.",
    };
  };
  attributes: C["attributes"] = async (rid, appId, q) => {
    await this.ready(rid);
    let rows = DEMO_ROWS.filter((r) => r.APP_ID === appId);
    if (q.diffOnly) rows = rows.filter((r) => r.DIFF_FLAG === 1);
    if (q.path !== undefined) rows = rows.filter((r) => r.PATH === q.path && (q.arrayKey === undefined || r.ARRAY_KEY === q.arrayKey));
    if (q.drilldownToken) {
      const fs = this.tokenFacts(rid, q.drilldownToken).filter((f) => f.APP_ID === appId);
      rows = rows.filter((r) => fs.some((f) => f.PATH === r.PATH && f.ARRAY_KEY === r.ARRAY_KEY));
    }
    return page(rows, q.page, q.pageSize);
  };
  raw: C["raw"] = async (rid, appId, source) => {
    await this.ready(rid);
    await wait(300);
    return { APP_ID: appId, SOURCE: source, document: demoRaw(appId, source) };
  };

  checkResults: C["checkResults"] = async (rid, p, ps) => {
    await this.ready(rid);
    return { ...page(this.checks.get(rid) ?? [], p, ps ?? 200), reportRevision: this.revisions.get(rid) ?? 1 };
  };
  executeCheck: C["executeCheck"] = async (rid, body) => {
    await this.ready(rid);
    const r = await this.executeScript({ ...body, runId: rid });
    return r;
  };
  checkExecution: C["checkExecution"] = async (rid, eid) => {
    const ex = await this.scriptExecution(eid);
    const meta = this.executions.get(eid)!;
    if (ex.status === "SUCCEEDED" && meta.status !== "SUCCEEDED") {
      meta.status = "SUCCEEDED";
      const s = this.scriptsDb.find((x) => x.id === meta.scriptId)!;
      const checkId = s.checkId ?? s.id;
      const kept = (this.checks.get(rid) ?? []).filter((c) => c.checkId !== checkId);
      kept.push({ rowId: id("row"), checkId, LABEL: s.name, SOURCE: "AFTER", ARGUMENT: "", CNT: 3, TOTAL: 3, METRIC: 1, APP_IDS: [...DEMO_APPS], RESULT: "PASS", CONFIDENCE: "HIGH" });
      this.checks.set(rid, kept);
      this.revisions.set(rid, (this.revisions.get(rid) ?? 1) + 1);
    }
    return { id: eid, status: ex.status, error: ex.error, reportRevision: ex.status === "SUCCEEDED" ? this.revisions.get(rid) ?? null : null };
  };
  aiReview: C["aiReview"] = async (rid) => {
    await this.ready(rid);
    const rev = this.revisions.get(rid) ?? 1;
    return { status: rev > 1 ? "STALE" : "UNAVAILABLE", text: null, error: rev > 1 ? null : "Демо: модель не подключена", generatedAt: null, reportRevision: 1 };
  };

  reportUrl: C["reportUrl"] = () => "about:blank";
  regenerateAiReview: C["regenerateAiReview"] = async (rid) => {
    await this.ready(rid);
    return { executionId: "demo-ai-unavailable" };
  };
  downloadReport: C["downloadReport"] = async (rid) => {
    await this.ready(rid);
    const rows = (this.checks.get(rid) ?? []).map((c) => `<tr><td>${esc(c.LABEL)}</td><td>${c.SOURCE}</td><td>${esc(c.ARGUMENT)}</td><td>${c.CNT}/${c.TOTAL}</td><td>${c.RESULT}</td></tr>`).join("");
    return new Blob([`<!doctype html><meta charset="utf-8"><title>Демо-отчёт</title><h1>Демонстрационный отчёт — не результат сервера</h1><table border=1>${rows}</table>`], { type: "text/html" });
  };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
