import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../api";
import type { LogEntry } from "../../api/types";
import { Icon } from "../../components/Icon";
import { ErrorAlert, StatusBadge } from "../../components/ui";
import { duration, STAGE_LABEL, timeOnly } from "../../lib/format";
import { usePolling } from "../../lib/hooks";
import { useRun } from "./RunPage";

const codeLink = (scriptId: string) => `/workspace/${encodeURIComponent(scriptId)}`;

export function StatusView() {
  const { run } = useRun();
  const api = useApi();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logError, setLogError] = useState<unknown>();
  const cursor = useRef(0);
  const active = run.status === "QUEUED" || run.status === "RUNNING";
  const [onlyErrors, setOnlyErrors] = useState(false);

  async function pull() {
    try {
      // Дочитываем журнал страницами по курсору.
      for (let i = 0; i < 20; i++) {
        const p = await api.runLogs(run.id, cursor.current, 200);
        if (p.items.length) setLogs((l) => [...l, ...p.items.filter((x) => x.cursor > (l[l.length - 1]?.cursor ?? 0))]);
        cursor.current = Math.max(cursor.current, p.nextCursor);
        if (!p.hasMore) break;
      }
      setLogError(undefined);
    } catch (e) {
      setLogError(e);
    }
  }

  useEffect(() => {
    cursor.current = 0;
    setLogs([]);
    pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);
  // Пока запуск активен — журнал раз в секунду; после завершения — ещё одно дочитывание.
  usePolling(pull, active, 1000);
  useEffect(() => {
    if (!active) pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const failed = run.stages.find((s) => s.status === "FAILED");
  const shown = onlyErrors ? logs.filter((l) => l.level !== "INFO") : logs;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {run.status === "FAILED" && (
        <div className="alert alert-bad" role="alert">
          <Icon name="alert" />
          <div>
            <b>Запуск завершился ошибкой{failed ? ` на этапе ${failed.key}` : ""}.</b> Отчёт не опубликован.
            <pre style={{ marginTop: 6 }}>{failed?.error ?? run.error}</pre>
            {failed?.scriptId && (
              <Link to={codeLink(failed.scriptId)} className="small">
                <Icon name="code" size={13} /> Открыть код этапа
              </Link>
            )}
          </div>
        </div>
      )}
      {run.reportReady && (
        <div className="alert alert-info">
          <Icon name="check" />
          <div style={{ flex: 1 }}>Отчёт опубликован сервером.</div>
          <Link className="btn btn-sm btn-primary" to="../summary">Открыть сводку</Link>
        </div>
      )}
      <div className="stages">
        {run.stages.map((s) => {
          const known = s.total !== null && s.processed !== null && s.total > 0;
          return (
            <div key={s.key} className={`stage s-${s.status}`}>
              <div className="row spread" style={{ gap: 4 }}>
                <span className="stage-key">{s.key}</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{STAGE_LABEL[s.key]}</div>
              <StatusBadge status={s.status} />
              {s.status === "RUNNING" && (
                <div className={`progress ${known ? "" : "indet"}`}>
                  <i style={known ? { width: `${(100 * s.processed!) / s.total!}%` } : undefined} />
                </div>
              )}
              <div className="meta">
                {s.processed !== null && (s.total !== null ? `${s.processed} из ${s.total}` : `${s.processed} обработано`)}
                {s.startedAt && <div>{duration(s.startedAt, s.finishedAt)}</div>}
              </div>
              {s.scriptId && (
                <Link className="small" to={codeLink(s.scriptId)} title={s.scriptId}>
                  <Icon name="code" size={12} /> код этапа
                </Link>
              )}
            </div>
          );
        })}
      </div>
      <section className="card">
        <div className="card-head">
          <h2>Журнал</h2>
          <div className="row">
            {active && <span className="badge b-info b-pulse"><i className="dot" /> обновляется</span>}
            <label className="check small">
              <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> только предупреждения и ошибки
            </label>
          </div>
        </div>
        {logError !== undefined && <div style={{ padding: 12 }}><ErrorAlert error={logError} compact /></div>}
        <div className="log">
          {shown.length === 0 && <div className="muted" style={{ padding: "6px 16px" }}>{active ? "Ожидаем записи журнала…" : "Записей нет"}</div>}
          {shown.map((l) => (
            <div key={l.cursor} className="log-row">
              <span className="muted">{timeOnly(l.time)}</span>
              <span>{l.stageKey ?? "—"}</span>
              <span className={`lv-${l.level}`}>{l.level}</span>
              <span style={{ overflowWrap: "anywhere" }}>{l.message}</span>
              {l.scriptId ? <Link to={codeLink(l.scriptId)}>код</Link> : <span />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
