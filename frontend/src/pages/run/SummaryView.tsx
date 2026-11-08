import { Link } from "react-router-dom";
import { useApi } from "../../api";
import type { Summary } from "../../api/types";
import { Async, DecisionPill, ErrorAlert } from "../../components/ui";
import { dateTime, ms, num, STAGE_LABEL } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { pivotLink } from "./PivotView";
import { useRun } from "./RunPage";
import { useTerms } from "../../lib/mode";
import { loadAllChecks } from "./ChecksView";

function Kpi({ label, value, of, foot, tone, hero }: { label: string; value: number | null; of?: number | null; foot?: React.ReactNode; tone?: string; hero?: boolean }) {
  const share = value !== null && of ? value / of : null;
  return (
    <div className={`card kpi ${hero ? "hero" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value === null ? <span className="na" title="Сервер не вычислил показатель">нет данных</span> : num(value)}
        {value !== null && of !== undefined && of !== null && <span className="of">из {num(of)}</span>}
      </div>
      {share !== null && (
        <div className="kpi-bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, share * 100)}%`, background: tone ? `var(--${tone})` : undefined }} />
        </div>
      )}
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

function Transitions({ s }: { s: Summary }) {
  const t = useTerms();
  const values = [...new Set(s.decisionTransitions.flatMap((t) => [t.before ?? "—", t.after ?? "—"]))].sort();
  const get = (b: string, a: string) => s.decisionTransitions.find((t) => (t.before ?? "—") === b && (t.after ?? "—") === a)?.count;
  const max = Math.max(1, ...s.decisionTransitions.map((t) => t.count));
  return (
    <div className="table-wrap">
      <table className="t matrix">
        <thead>
          <tr>
            <th>{t.simple ? "Было ↓ / Стало →" : "BEFORE ↓ / AFTER →"}</th>
            {values.map((v) => <th key={v} className="num">{t.decision(v)}</th>)}
          </tr>
        </thead>
        <tbody>
          {values.map((b) => (
            <tr key={b}>
              <td><DecisionPill value={b} /></td>
              {values.map((a) => {
                const c = get(b, a);
                const diag = a === b;
                return (
                  <td key={a} className="num" style={c ? { background: diag ? "var(--muted-soft)" : `rgba(var(--heat), ${0.08 + (0.32 * c) / max})`, fontWeight: diag ? 500 : 700 } : undefined}>
                    {c === undefined ? <span className="muted">·</span> : num(c)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SummaryView() {
  const t = useTerms();
  const { run } = useRun();
  const api = useApi();
  const summary = useAsync(() => api.summary(run.id), [run.id]);
  const checks = useAsync(() => loadAllChecks(api, run.id), [run.id]);

  return (
    <Async state={summary} label="Загружаем сводку…">
      {(s) => {
        const top = s.topChangedAttributes.slice(0, 12);
        const maxTop = Math.max(1, ...top.map((t) => t.changedApps));
        const fails = checks.data?.items.filter((c) => c.RESULT === "FAIL") ?? [];
        const failHigh = fails.filter((c) => c.CONFIDENCE === "HIGH").length;
        return (
          <div className="stack" style={{ gap: 16 }}>
            <div className="kpis">
              <Kpi label="Всего заявок" value={s.totalApps} foot={run.datasetName} hero />
              <Kpi label="С любыми различиями" value={s.changedApps} of={s.totalApps} tone="accent" foot={s.changedApps !== null && s.decisionChangedApps !== null ? `${num(s.changedApps - s.decisionChangedApps)} — различия есть, решение то же` : undefined} />
              <Kpi label="Сменилось решение" value={s.decisionChangedApps} of={s.totalApps} tone="bad" foot={<Link to={pivotLink(run.id, { filters: [{ field: "DECISION_CHANGED", op: "eq", value: 1 }] })}>в сводную →</Link>} />
              <Kpi label="Смена решения при смене внешних данных" value={s.externalDriftDecisionApps} of={s.decisionChangedApps} tone="warn" foot="Может пересекаться с изменениями стратегии" />
            </div>
            <div className="grid cols-2">
              <section className="card">
                <div className="card-head">
                  <h2>Переходы решений</h2>
                  <span className="hint">число заявок</span>
                </div>
                {s.decisionTransitions.length ? <Transitions s={s} /> : <div className="state">Сервер не вернул переходов</div>}
              </section>
              <section className="card">
                <div className="card-head">
                  <h2>Проверки</h2>
                  <Link to="../checks" className="small">единый отчёт →</Link>
                </div>
                <div className="card-pad">
                  {checks.error ? (
                    <ErrorAlert error={checks.error} onRetry={checks.reload} compact />
                  ) : !checks.data ? (
                    <div className="skeleton" style={{ height: 80 }} />
                  ) : !checks.data.complete ? (
                    <div className="muted">Отчёт загружен частично ({num(checks.data.items.length)} из {num(checks.data.total)} строк), итоги FAIL/PASS не показываются.</div>
                  ) : (
                    <div className="stack">
                      <div className="row" style={{ gap: 18 }}>
                        <div><div className="kpi-value" style={{ color: "var(--bad)" }}>{fails.length}</div><div className="muted small">{t.simple ? `проблем, из них уверенных: ${failHigh}` : `FAIL, из них HIGH: ${failHigh}`}</div></div>
                        <div><div className="kpi-value" style={{ color: "var(--ok)" }}>{checks.data.items.length - fails.length}</div><div className="muted small">{t.simple ? "в норме" : "PASS"}</div></div>
                        <div><div className="kpi-value">{checks.data.total}</div><div className="muted small">строк отчёта · ревизия {checks.data.reportRevision}</div></div>
                      </div>
                      {fails.filter((c) => c.CONFIDENCE === "HIGH").slice(0, 4).map((c) => (
                        <div key={c.rowId} className="row small" style={{ gap: 8 }}>
                          <span className="badge b-bad">{t.result("FAIL")}</span> <b>{c.LABEL}</b> <span className="muted mono">{c.ARGUMENT}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
            <section className="card">
              <div className="card-head">
                <h2>Чаще всего меняются</h2>
                <span className="hint">заявок с изменением атрибута · клик — сводная по PATH</span>
              </div>
              {top.length === 0 ? (
                <div className="state">Изменившихся атрибутов нет</div>
              ) : (
                <div className="bars">
                  {top.map((t) => (
                    <Link key={t.PATH} className="bar-row" to={pivotLink(run.id, { rows: ["PATH", "ARRAY_KEY"], columns: ["CHANGE_TYPE", "SOURCE"], filters: [{ field: "PATH", op: "eq", value: t.PATH }, { field: "DIFF_FLAG", op: "eq", value: 1 }] })}>
                      <span className="bar-label mono" title={t.PATH}>{t.PATH}</span>
                      <span className="bar-track"><i style={{ width: `${(100 * t.changedApps) / maxTop}%` }} /></span>
                      <span className="num">{num(t.changedApps)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <div className="row spread muted small">
              <span>
                Время этапов: {Object.entries(s.timingsMs).map(([k, v]) => `${STAGE_LABEL[k] ?? k} ${ms(v)}`).join(" · ") || "—"}
              </span>
              <span>Источник: API сервера · вычислено {dateTime(s.computedAt)}</span>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
