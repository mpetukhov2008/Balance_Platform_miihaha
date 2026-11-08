import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi, type ApiClient } from "../../api";
import type { CheckExecution, CheckResult, CheckResultsPage } from "../../api/types";
import { Icon } from "../../components/Icon";
import { JsonParams } from "../../components/JsonParams";
import { Async, ErrorAlert, Pager, SourceBadge } from "../../components/ui";
import { num } from "../../lib/format";
import { useAsync, useTrackedJob } from "../../lib/hooks";
import { fetchAllPages } from "../../lib/pages";
import { useRun } from "./RunPage";
import { useTerms } from "../../lib/mode";

/** Весь отчёт проверок постранично; итоги FAIL/PASS считаются только по полному набору. */
export function loadAllChecks(api: ApiClient, runId: string) {
  return fetchAllPages<CheckResult, CheckResultsPage>((p, ps) => api.checkResults(runId, p, ps), { revision: (r) => r.reportRevision });
}

/** Каталог проверок целиком, а не только первая страница. */
export function loadAllCheckScripts(api: ApiClient) {
  return fetchAllPages((p, ps) => api.scripts("CHECK", p, ps));
}

const TABLE_PAGE = 50;

/** METRIC без метаданных не форматируется как процент: выводим как вернул сервер. */
function Metric({ v }: { v: CheckResult["METRIC"] }) {
  if (v === null || v === undefined) return <span className="muted">—</span>;
  return <span className="metric">{typeof v === "number" ? String(Math.round(v * 10000) / 10000) : v}</span>;
}

function AddCheck({ runId, onDone }: { runId: string; onDone: () => void }) {
  const api = useApi();
  const scripts = useAsync(() => loadAllCheckScripts(api), []);
  const [scriptId, setScriptId] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [valid, setValid] = useState(true);
  const [execId, setExecId] = useState<string>();
  const [error, setError] = useState<unknown>();
  const tracked = useTrackedJob((id) => api.checkExecution(runId, id), execId, (j) => j.status === "SUCCEEDED" && onDone());
  const exec: CheckExecution | undefined = tracked.job ?? (execId ? { id: execId, status: "QUEUED", error: null, reportRevision: null } : undefined);
  const cur = scripts.data?.items.find((s) => s.id === scriptId);
  const running = tracked.active;

  useEffect(() => {
    if (!scriptId && scripts.data?.items.length) {
      const ws = scripts.data.items.find((s) => s.sourceType === "WORKSPACE") ?? scripts.data.items[0];
      setScriptId(ws.id);
      setParams({ ...ws.params });
    }
  }, [scripts.data, scriptId]);

  async function submit() {
    setError(undefined);
    try {
      const { executionId } = await api.executeCheck(runId, { scriptId, params });
      setExecId(executionId);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="card card-pad stack" data-testid="add-check">
      <div className="row spread">
        <h2>Добавить проверку в отчёт</h2>
        <Link className="small" to={`/workspace?kind=CHECK&runId=${encodeURIComponent(runId)}`}><Icon name="code" size={13} /> Написать новую в рабочей области</Link>
      </div>
      <div className="muted small">Проверка исполняется сервером на готовой витрине без повторной нормализации. Повторный запуск того же CHECK.id заменяет его строки.</div>
      {scripts.error ? <ErrorAlert error={scripts.error} compact /> : (
        <div className="grid cols-2">
          <label className="field">
            <span>Проверка</span>
            <select className="select" value={scriptId} onChange={(e) => { setScriptId(e.target.value); setParams({ ...(scripts.data?.items.find((s) => s.id === e.target.value)?.params ?? {}) }); }}>
              <optgroup label="Рабочая область">
                {scripts.data?.items.filter((s) => s.sourceType === "WORKSPACE").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
              <optgroup label="Размещённые .py">
                {scripts.data?.items.filter((s) => s.sourceType === "FILE").map((s) => <option key={s.id} value={s.id}>{s.filename}</option>)}
              </optgroup>
            </select>
            {cur && <span className="muted small">CHECK.id: {cur.checkId ?? "определит сервер"}</span>}
          </label>
          <JsonParams value={params} onChange={setParams} onValidity={setValid} resetKey={scriptId} rows={3} />
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" disabled={!scriptId || !valid || running} onClick={submit}>
          <Icon name="play" /> {running ? "Выполняется на сервере…" : "Выполнить и добавить в отчёт"}
        </button>
        {exec?.status === "SUCCEEDED" && <span className="badge b-ok"><Icon name="check" size={13} /> Отчёт пересобран, ревизия {exec.reportRevision}</span>}
      </div>
      {exec?.status === "FAILED" && (
        <div className="alert alert-bad" role="alert">
          <Icon name="alert" />
          <div><b>Ошибка исполнения проверки</b> — это не PASS и не FAIL; отчёт не изменён.<pre style={{ marginTop: 6 }}>{exec.error}</pre></div>
        </div>
      )}
      {tracked.error !== undefined && (
        <div className="stack" style={{ gap: 4 }}>
          <ErrorAlert error={tracked.error} compact />
          <span className="muted small">{tracked.gaveUp ? "Статус не удалось получить. Проверка могла завершиться — обновите отчёт." : "Не удалось получить статус, повторяем запрос…"}</span>
        </div>
      )}
      {error !== undefined && <ErrorAlert error={error} compact />}
    </section>
  );
}

export function ChecksView() {
  const { run } = useRun();
  const t = useTerms();
  const api = useApi();
  const [search] = useSearchParams();
  const focus = search.get("rowId");
  const res = useAsync(() => loadAllChecks(api, run.id), [run.id]);
  const [onlyFail, setOnlyFail] = useState(false);
  const [hideLow, setHideLow] = useState(false);
  const [page, setPage] = useState(1);
  const focusRef = useRef<HTMLTableRowElement>(null);
  const all = res.data?.items ?? [];
  const items = all.filter((c) => (!onlyFail || c.RESULT === "FAIL") && (!hideLow || c.CONFIDENCE === "HIGH"));
  const focusIndex = focus ? items.findIndex((c) => c.rowId === focus) : -1;

  // Переход по ?rowId= открывает страницу, на которой находится строка, даже если она не первая.
  useEffect(() => {
    if (focusIndex >= 0) setPage(Math.floor(focusIndex / TABLE_PAGE) + 1);
  }, [focusIndex, res.data]);
  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: "center" });
  }, [page, res.data]);
  useEffect(() => {
    setPage(1);
  }, [onlyFail, hideLow]);

  const pageItems = items.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE);
  const focusMissing = !!focus && !!res.data && res.data.complete && all.every((c) => c.rowId !== focus);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <Async state={res} label="Загружаем отчёт проверок…">
          {(d) => {
            const fails = d.items.filter((c) => c.RESULT === "FAIL").length;
            const passes = d.items.length - fails;
            return (
              <>
                <div className="card-head">
                  <div>
                    <h2>Единый отчёт проверок</h2>
                    <div className="hint" data-testid="checks-totals">
                      {num(d.total)} строк · {t.result("FAIL")} {d.complete ? fails : "—"} · {t.result("PASS")} {d.complete ? passes : "—"} · ревизия отчёта {d.reportRevision}. {t.simple ? "Строки, где данных мало, показаны бледно — это сигнал, а не точный вывод." : "LOW — мало срабатываний, показано бледно."}
                    </div>
                  </div>
                  <div className="row">
                    <label className="check small"><input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> {t.simple ? "только проблемы" : "только FAIL"}</label>
                    <label className="check small"><input type="checkbox" checked={hideLow} onChange={(e) => setHideLow(e.target.checked)} /> {t.simple ? "скрыть строки с малым числом данных" : "скрыть LOW"}</label>
                  </div>
                </div>
                {!d.complete && (
                  <div className="alert alert-warn" style={{ margin: 12 }}>
                    <Icon name="info" />
                    <div>Загружено {num(d.items.length)} из {num(d.total)} строк — итоги FAIL/PASS не показываются, пока отчёт не загружен полностью.</div>
                  </div>
                )}
                {focusMissing && (
                  <div className="alert alert-warn" style={{ margin: 12 }}>
                    <Icon name="info" />
                    <div>Строка из ссылки не найдена: отчёт мог быть пересобран после новой проверки.</div>
                  </div>
                )}
                {focus && focusIndex < 0 && !focusMissing && (onlyFail || hideLow) && (
                  <div className="muted small" style={{ padding: "8px 20px" }}>Строка из ссылки скрыта текущими фильтрами.</div>
                )}
                <div className="table-wrap" style={{ maxHeight: "65vh" }}>
                  <table className="t" data-testid="checks-table">
                    <thead>
                      <tr><th>{t.field("LABEL")}</th><th>{t.field("SOURCE")}</th><th>{t.field("ARGUMENT")}</th><th className="num">{t.field("CNT")}</th><th className="num">{t.field("TOTAL")}</th><th className="num">{t.field("METRIC")}</th><th>{t.field("RESULT")}</th><th>{t.field("CONFIDENCE")}</th><th>Заявки</th></tr>
                    </thead>
                    <tbody>
                      {pageItems.map((c) => (
                        <tr key={c.rowId} ref={c.rowId === focus ? focusRef : undefined} className={`${c.CONFIDENCE === "LOW" ? "low" : ""} ${c.rowId === focus ? "selected" : ""}`}>
                          <td style={{ fontWeight: 550 }}>{c.LABEL}</td>
                          <td><SourceBadge source={c.SOURCE} /></td>
                          <td className="mono small" style={{ overflowWrap: "anywhere", maxWidth: 320 }}>{c.ARGUMENT || <span className="muted">—</span>}</td>
                          <td className="num">{num(c.CNT)}</td>
                          <td className="num">{num(c.TOTAL)}</td>
                          <td className="num"><Metric v={c.METRIC} /></td>
                          <td className={`result-${c.RESULT}`} title={t.simple ? c.RESULT : undefined}>{t.result(c.RESULT)}</td>
                          <td>{c.CONFIDENCE === "LOW" ? <span className="badge">{t.confidence("LOW")}</span> : <span className="badge b-info">{t.confidence("HIGH")}</span>}</td>
                          <td className="nowrap">
                            {c.APP_IDS.length ? (
                              <Link to={`../apps?checkRow=${encodeURIComponent(c.rowId)}`}>
                                {c.CNT > c.APP_IDS.length ? `показано ${c.APP_IDS.length} из ${num(c.CNT)}` : `${c.APP_IDS.length} шт.`}
                              </Link>
                            ) : <span className="muted">—</span>}
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>Нет строк под выбранные фильтры</td></tr>}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pageSize={TABLE_PAGE} total={items.length} onPage={setPage} />
              </>
            );
          }}
        </Async>
      </section>
      <AddCheck runId={run.id} onDone={res.reload} />
    </div>
  );
}
