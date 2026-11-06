import { createContext, useContext, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { useApi } from "../../api";
import type { Configuration, Run } from "../../api/types";
import { Icon } from "../../components/Icon";
import { ErrorAlert, Loading, PageHead, StatusBadge } from "../../components/ui";
import { dateTime, duration } from "../../lib/format";
import { useAsync, usePolling } from "../../lib/hooks";
import { StatusView } from "./StatusView";
import { SummaryView } from "./SummaryView";
import { PivotView } from "./PivotView";
import { ApplicationsView } from "./ApplicationsView";
import { ApplicationCard } from "./ApplicationCard";
import { ChecksView } from "./ChecksView";
import { ReportView } from "./ReportView";

type RunCtx = { run: Run; config: Configuration | undefined; refresh: () => void };
const Ctx = createContext<RunCtx | null>(null);
export const useRun = () => useContext(Ctx)!;

export function RunPage() {
  const { runId = "" } = useParams();
  const api = useApi();
  const run = useAsync(() => api.run(runId), [runId]);
  const config = useAsync(() => (run.data ? api.configuration(run.data.configurationId) : Promise.resolve(undefined)), [run.data?.configurationId]);
  const [pollError, setPollError] = useState<unknown>();
  const active = run.data?.status === "QUEUED" || run.data?.status === "RUNNING";
  usePolling(
    () =>
      api.run(runId).then(
        (r) => (run.setData(r), setPollError(undefined)),
        (e) => setPollError(e),
      ),
    active,
    1000,
  );

  if (run.error) return <ErrorAlert error={run.error} onRetry={run.reload} />;
  if (!run.data) return <Loading label="Загружаем запуск…" />;
  const r = run.data;
  const base = `/runs/${encodeURIComponent(r.id)}`;
  const tab = (to: string, label: string, icon: string, disabled = false) =>
    disabled ? (
      <span className="tab" style={{ opacity: 0.45, cursor: "not-allowed" }} title="Отчёт откроется после публикации">
        <Icon name={icon} size={15} /> {label}
      </span>
    ) : (
      <NavLink to={`${base}/${to}`} className="tab">
        <Icon name={icon} size={15} /> {label}
      </NavLink>
    );

  return (
    <Ctx.Provider value={{ run: r, config: config.data, refresh: run.reload }}>
      <PageHead
        crumbs={<><Link to="/runs">Запуски</Link> <span>/</span> <span className="mono">{r.id}</span></>}
        title={
          <span className="row" style={{ gap: 12 }}>
            {config.data?.name ?? "Запуск"} <StatusBadge status={r.status} />
          </span>
        }
        sub={
          <>
            Датасет «{r.datasetName}» · создан {dateTime(r.createdAt)} · длительность {duration(r.startedAt, r.finishedAt)}
            {config.data && (
              <> · <Link to={`/configurations/${encodeURIComponent(r.configurationId)}`}>конфигурация</Link></>
            )}
          </>
        }
      />
      {pollError !== undefined && (
        <div style={{ marginBottom: 12 }}>
          <ErrorAlert error={pollError} compact />
        </div>
      )}
      <nav className="tabs">
        {tab("status", "Ход выполнения", "runs")}
        {tab("summary", "Сводка", "chart", !r.reportReady)}
        {tab("pivot", "Сводная", "table", !r.reportReady)}
        {tab("checks", "Проверки", "shield", !r.reportReady)}
        {tab("report", "ИИ и HTML", "spark", !r.reportReady)}
      </nav>
      <Routes>
        <Route index element={<Navigate to={r.reportReady ? "summary" : "status"} replace />} />
        <Route path="status" element={<StatusView />} />
        <Route path="summary" element={<Ready><SummaryView /></Ready>} />
        <Route path="pivot" element={<Ready><PivotView /></Ready>} />
        <Route path="checks" element={<Ready><ChecksView /></Ready>} />
        <Route path="report" element={<Ready><ReportView /></Ready>} />
        <Route path="apps" element={<Ready><ApplicationsView /></Ready>} />
        <Route path="apps/:appId" element={<Ready><ApplicationCard /></Ready>} />
      </Routes>
    </Ctx.Provider>
  );
}

/** Отчёт открывается только после публикации сервером (reportReady). */
function Ready({ children }: { children: React.ReactNode }) {
  const { run } = useRun();
  if (run.reportReady) return <>{children}</>;
  return (
    <div className="card">
      <div className="state">
        {run.status === "FAILED" ? <Icon name="alert" /> : <div className="spinner" />}
        <h3>{run.status === "FAILED" ? "Отчёт не опубликован: запуск завершился ошибкой" : "Отчёт ещё не готов"}</h3>
        <div>
          Частичные результаты не показываются. <Link to="../status">Смотреть ход выполнения</Link>
        </div>
      </div>
    </div>
  );
}
