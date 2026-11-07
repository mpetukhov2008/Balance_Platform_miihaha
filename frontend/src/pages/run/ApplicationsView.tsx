import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, useApi } from "../../api";
import { Async, DecisionPill, Empty, ErrorAlert } from "../../components/ui";
import { Pager } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { keyLabel, num } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import type { CellContext } from "./PivotView";
import { useRun } from "./RunPage";
import { loadAllChecks } from "./ChecksView";

export function ApplicationsView() {
  const { run } = useRun();
  const api = useApi();
  const nav = useNavigate();
  const loc = useLocation();
  const [search, setSearch] = useSearchParams();
  const token = search.get("token") ?? undefined;
  const checkRow = search.get("checkRow") ?? undefined;
  const page = Math.max(1, Number(search.get("page")) || 1);
  const cell = (loc.state as { cell?: CellContext; back?: string } | null)?.cell;
  const back = (loc.state as { back?: string } | null)?.back;
  const apps = useAsync(() => api.applications(run.id, { drilldownToken: token, checkRowId: checkRow, page, pageSize: 50 }), [run.id, token, checkRow, page]);
  const checks = useAsync(() => (checkRow ? loadAllChecks(api, run.id) : Promise.resolve(undefined)), [run.id, checkRow]);
  const checkRowData = checks.data?.items.find((c) => c.rowId === checkRow);
  const expired = apps.error instanceof ApiError && apps.error.isDrilldownExpired;

  const openApp = (appId: string) => {
    const q = new URLSearchParams();
    if (token) q.set("token", token);
    if (checkRow) q.set("checkRow", checkRow);
    nav(`${encodeURIComponent(appId)}?${q}`, { state: loc.state });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row spread">
        <Link className="btn btn-sm" to={back ? `../${back}` : checkRow ? "../checks" : "../pivot"}>
          <Icon name="left" /> {checkRow ? "К отчёту проверок" : "К сводной"}
        </Link>
      </div>
      {cell && (
        <section className="card card-pad ctx">
          <div className="muted small">Группа сводной</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {[...cell.rows, ...cell.columns].map(([f, v]) => (
              <span key={f} className="badge b-info mono">{f} = {keyLabel(v)}</span>
            ))}
            {cell.filters.map((f) => (
              <span key={"f" + f.field} className="badge mono"><Icon name="filter" size={11} /> {f.field} {f.op} {Array.isArray(f.value) ? f.value.map(keyLabel).join(", ") : keyLabel(f.value)}</span>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 8 }}>
            {cell.measure}: <b>{num(cell.value)}</b>. Это не обязательно число уникальных заявок — ниже список, вычисленный сервером по токену ячейки.
          </div>
        </section>
      )}
      {checkRow && (
        <section className="card card-pad ctx">
          <div className="muted small">Строка отчёта проверок</div>
          {checkRowData ? (
            <div className="row" style={{ marginTop: 6 }}>
              <b>{checkRowData.LABEL}</b> <span className="mono muted">{checkRowData.ARGUMENT || "—"}</span>
              <span className={`badge ${checkRowData.RESULT === "FAIL" ? "b-bad" : "b-ok"}`}>{checkRowData.RESULT}</span>
              <span className="muted small">CNT {num(checkRowData.CNT)} · в выборке проверки {checkRowData.APP_IDS.length}</span>
            </div>
          ) : checks.error ? <ErrorAlert error={checks.error} compact /> : <div className="skeleton" style={{ height: 20, marginTop: 6 }} />}
        </section>
      )}
      <section className="card">
        {expired ? (
          <div style={{ padding: 16 }}>
            <ErrorAlert error={apps.error} />
            <Link className="btn btn-sm" style={{ marginTop: 10 }} to={back ? `../${back}` : "../pivot"}>Пересчитать сводную</Link>
          </div>
        ) : (
          <Async state={apps} label="Ищем заявки…">
            {(d) => (
              <>
                <div className="card-head">
                  <h2>Заявки <span className="muted">({num(d.total)})</span></h2>
                  <span className="hint">
                    {d.scope === "CHECK_SAMPLE"
                      ? checkRowData && checkRowData.CNT > d.total
                        ? `Показано ${num(d.total)} из ${num(checkRowData.CNT)} — проверка вернула ограниченную выборку`
                        : "Выборка, возвращённая проверкой"
                      : d.scope === "FULL_GROUP"
                        ? "Все уникальные заявки группы"
                        : "По фильтру"}
                  </span>
                </div>
                {d.items.length === 0 ? (
                  <Empty title="Заявок нет" />
                ) : (
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>APP_ID</th>
                          <th>Решение BEFORE</th>
                          <th />
                          <th>Решение AFTER</th>
                          <th>Смена решения</th>
                          <th className="num">Изменённых атрибутов</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.items.map((a) => (
                          <tr key={a.APP_ID} className="clickable" onClick={() => openApp(a.APP_ID)}>
                            <td className="mono" style={{ fontWeight: 600 }}><a href="#" onClick={(e) => e.preventDefault()}>{a.APP_ID}</a></td>
                            <td><DecisionPill value={a.DECISION_BEFORE} /></td>
                            <td className="muted">→</td>
                            <td><DecisionPill value={a.DECISION_AFTER} /></td>
                            <td>{a.DECISION_CHANGED ? <span className="badge b-bad">да</span> : <span className="muted">нет</span>}</td>
                            <td className="num">{num(a.changedAttributes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {d.matchedAttributes && (
                  <div className="muted small" style={{ padding: "8px 16px" }}>
                    Атрибуты группы: {d.matchedAttributes.slice(0, 8).map((m) => `${m.PATH}${m.ARRAY_KEY ? ` [${m.ARRAY_KEY}]` : ""}`).join(", ")}
                    {d.matchedAttributes.length > 8 ? "…" : ""}
                  </div>
                )}
                <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => { search.set("page", String(p)); setSearch(search, { state: loc.state }); }} />
              </>
            )}
          </Async>
        )}
      </section>
    </div>
  );
}
