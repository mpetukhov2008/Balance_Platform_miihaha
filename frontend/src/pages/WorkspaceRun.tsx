import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import type { CheckExecution, Script, ScriptExecution } from "../api/types";
import { Icon } from "../components/Icon";
import { ErrorAlert, StatusBadge } from "../components/ui";
import { useAsync, useTrackedJob } from "../lib/hooks";

function Preview({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return (
    <div className="table-wrap" style={{ maxHeight: 320, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
      <table className="t">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c} className="cell-val clamp">{r[c] === null ? <span className="v-null">null</span> : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Запуск скрипта на сервере: предпросмотр на датасете/прогоне и включение CHECK в отчёт. */
export function WorkspaceRun({ script, params, dirty, beforeRun, initialRunId }: { script: Script; params: Record<string, unknown>; dirty: boolean; beforeRun: () => Promise<Script | null>; initialRunId?: string }) {
  const api = useApi();
  const isCheck = script.kind === "CHECK";
  const datasets = useAsync(() => api.datasets(), []);
  const runs = useAsync(() => api.runs(1, 100), []);
  const readyRuns = runs.data?.items.filter((r) => r.reportReady) ?? [];
  const [datasetId, setDatasetId] = useState("");
  const [runId, setRunId] = useState(initialRunId ?? "");
  const [execId, setExecId] = useState<string>();
  const [inclId, setInclId] = useState<string>();
  const [error, setError] = useState<unknown>();
  const ctxRun = runId || readyRuns[0]?.id || "";
  const ctxDs = datasetId || datasets.data?.items.find((d) => d.status === "READY")?.id || "";

  const execT = useTrackedJob(api.scriptExecution, execId);
  const inclT = useTrackedJob((id) => api.checkExecution(ctxRun, id), inclId);
  const exec: ScriptExecution | undefined = execT.job ?? (execId ? { id: execId, status: "QUEUED", stdout: "", stderr: "", diagnostics: [], previewRows: [], truncated: false, error: null } : undefined);
  const incl: CheckExecution | undefined = inclT.job ?? (inclId ? { id: inclId, status: "QUEUED", error: null, reportRevision: null } : undefined);
  const pollError = execT.error ?? inclT.error;

  async function run(include: boolean) {
    setError(undefined);
    try {
      const s = await beforeRun();
      if (!s) return;
      if (include) {
        setInclId(undefined);
        const { executionId } = await api.executeCheck(ctxRun, { scriptId: s.id, params });
        setInclId(executionId);
      } else {
        setExecId(undefined);
        const { executionId } = await api.executeScript(isCheck ? { scriptId: s.id, params, runId: ctxRun } : { scriptId: s.id, params, datasetId: ctxDs });
        setExecId(executionId);
      }
    } catch (e) {
      setError(e);
    }
  }

  const noCtx = isCheck ? !ctxRun : !ctxDs;
  return (
    <section className="card card-pad stack" data-testid="workspace-run">
      <div className="row spread">
        <h2>Выполнение на сервере</h2>
        {dirty && <span className="muted small">несохранённые изменения будут сохранены перед запуском</span>}
      </div>
      <div className="row">
        {isCheck ? (
          <label className="field" style={{ minWidth: 320 }}>
            <span>Завершённый прогон (готовая витрина)</span>
            <select className="select" value={ctxRun} onChange={(e) => setRunId(e.target.value)}>
              {readyRuns.length === 0 && <option value="">нет завершённых прогонов</option>}
              {readyRuns.map((r) => <option key={r.id} value={r.id}>{r.datasetName} · {new Date(r.createdAt).toLocaleString("ru-RU")} · {r.id.slice(0, 8)}</option>)}
            </select>
          </label>
        ) : (
          <label className="field" style={{ minWidth: 320 }}>
            <span>Датасет для предпросмотра</span>
            <select className="select" value={ctxDs} onChange={(e) => setDatasetId(e.target.value)}>
              {datasets.data?.items.map((d) => <option key={d.id} value={d.id} disabled={d.status !== "READY"}>{d.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <button className="btn" disabled={noCtx || execT.active} onClick={() => run(false)}>
          <Icon name="play" /> {execT.active ? "Выполняется…" : isCheck ? "Выполнить (предпросмотр)" : "Выполнить предпросмотр"}
        </button>
        {isCheck && (
          <button className="btn btn-primary" disabled={noCtx || inclT.active} onClick={() => run(true)}>
            <Icon name="shield" /> {inclT.active ? "Добавляем в отчёт…" : "Включить в отчёт прогона"}
          </button>
        )}
        {isCheck && <span className="muted small">Предпросмотр не меняет опубликованный отчёт.</span>}
      </div>
      {error !== undefined && <ErrorAlert error={error} compact />}
      {pollError !== undefined && (
        <div className="stack" style={{ gap: 4 }}>
          <ErrorAlert error={pollError} compact />
          <span className="muted small">{execT.gaveUp || inclT.gaveUp ? "Статус не удалось получить; задача могла завершиться на сервере." : "Не удалось получить статус, повторяем запрос…"}</span>
        </div>
      )}
      {incl && (
        <div className={`alert ${incl.status === "FAILED" ? "alert-bad" : "alert-info"}`}>
          <Icon name={incl.status === "FAILED" ? "alert" : "info"} />
          <div style={{ flex: 1 }}>
            <div className="row"><b>Включение в отчёт</b> <StatusBadge status={incl.status} /></div>
            {incl.status === "SUCCEEDED" && <div>Отчёт пересобран (ревизия {incl.reportRevision}). <Link to={`/runs/${encodeURIComponent(ctxRun)}/checks`}>Открыть отчёт проверок →</Link></div>}
            {incl.status === "FAILED" && <pre>{incl.error}</pre>}
          </div>
        </div>
      )}
      {exec && (
        <div className="out" data-testid="exec-output">
          <div className="row"><b>Результат</b> <StatusBadge status={exec.status} />{exec.truncated && <span className="badge b-warn">вывод обрезан сервером</span>}</div>
          {exec.error && <div className="alert alert-bad" role="alert"><Icon name="alert" /><div><b>Ошибка выполнения</b><pre>{exec.error}</pre></div></div>}
          {exec.stdout && <><div className="muted small">stdout</div><pre>{exec.stdout}</pre></>}
          {exec.stderr && <><div className="muted small">stderr</div><pre className="stderr">{exec.stderr}</pre></>}
          {exec.diagnostics.length > 0 && <><div className="muted small">Диагностика</div><pre>{JSON.stringify(exec.diagnostics, null, 2)}</pre></>}
          {exec.previewRows.length > 0 && <><div className="muted small">Предпросмотр строк ({exec.previewRows.length})</div><Preview rows={exec.previewRows} /></>}
          {exec.status === "SUCCEEDED" && !exec.stdout && !exec.previewRows.length && <div className="muted small">Скрипт завершился без вывода и строк.</div>}
        </div>
      )}
    </section>
  );
}
