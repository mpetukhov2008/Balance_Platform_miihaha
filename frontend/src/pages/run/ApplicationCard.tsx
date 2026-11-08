import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ApiError, useApi } from "../../api";
import type { ComparisonRow } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Async, ChangeBadge, DecisionPill, ErrorAlert, Pager } from "../../components/ui";
import { SideValue } from "../../components/Value";
import { num } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { AttributeDetail } from "./AttributeDetail";
import { RawJson } from "./RawJson";
import { useRun } from "./RunPage";
import { useTerms } from "../../lib/mode";

const SEG_PAIRS = ["DECISION", "TOP_OFFER", "PD_MODEL", "CUTOFF", "REJECT_REASON", "SCORE_OKB"];

function segVal(v: unknown) {
  if (v === null) return <span className="v-null">null</span>;
  if (v === undefined) return <span className="muted">—</span>;
  if (v === "") return <span className="v-empty">∅</span>;
  return <span className="mono">{String(v)}</span>;
}

export function ApplicationCard() {
  const t = useTerms();
  const { run } = useRun();
  const { appId = "" } = useParams();
  const api = useApi();
  const loc = useLocation();
  const [search, setSearch] = useSearchParams();
  const token = search.get("token") ?? undefined;
  const checkRow = search.get("checkRow");
  const selPath = search.get("path");
  const selKey = search.get("arrayKey");
  const [scope, setScope] = useState<"group" | "all">(token ? "group" : "all");
  const [diffOnly, setDiffOnly] = useState(true);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [scope, diffOnly]);

  const detail = useAsync(() => api.application(run.id, appId), [run.id, appId]);
  const attrs = useAsync(
    () => api.attributes(run.id, appId, { diffOnly: scope === "group" ? false : diffOnly, drilldownToken: scope === "group" ? token : undefined, page, pageSize: 100 }),
    [run.id, appId, scope, diffOnly, page, token],
  );
  // Выбранный атрибут запрашивается точно по PATH + ARRAY_KEY, независимо от страницы таблицы.
  const selected = useAsync(
    () => (selPath !== null ? api.attributes(run.id, appId, { diffOnly: false, path: selPath, arrayKey: selKey ?? "", page: 1, pageSize: 5 }) : Promise.resolve(null)),
    [run.id, appId, selPath, selKey],
  );
  const selRow = selected.data?.items[0];
  // Если группа соответствует ровно одному атрибуту — выделяем его сразу.
  useEffect(() => {
    if (scope === "group" && selPath === null && attrs.data?.total === 1) select(attrs.data.items[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.data]);

  function select(r: ComparisonRow | null) {
    if (r) {
      search.set("path", r.PATH);
      search.set("arrayKey", r.ARRAY_KEY);
    } else {
      search.delete("path");
      search.delete("arrayKey");
    }
    setSearch(search, { replace: true, state: loc.state });
  }

  const backQ = new URLSearchParams();
  if (token) backQ.set("token", token);
  if (checkRow) backQ.set("checkRow", checkRow);
  const isSel = (r: ComparisonRow) => r.PATH === selPath && r.ARRAY_KEY === (selKey ?? "");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row spread">
        <Link className="btn btn-sm" to={`../apps?${backQ}`} state={loc.state}>
          <Icon name="left" /> К списку заявок
        </Link>
      </div>
      <Async state={detail} label="Загружаем заявку…">
        {(d) => {
          const s = d.segments;
          return (
            <>
              <section className="card app-hero">
                <div>
                  <div className="muted small">Заявка</div>
                  <h1 className="mono">{d.APP_ID}</h1>
                </div>
                <div className="decision-flow">
                  <div><div className="muted small">{t.source("BEFORE")}</div><DecisionPill value={s.DECISION_BEFORE as string} /></div>
                  <Icon name="right" />
                  <div><div className="muted small">{t.source("AFTER")}</div><DecisionPill value={s.DECISION_AFTER as string} /></div>
                  {Number(s.DECISION_CHANGED) === 1 ? <span className="badge b-bad">решение сменилось</span> : <span className="badge">решение то же</span>}
                </div>
              </section>
              <div className="grid cols-2">
                <section className="card">
                  <div className="card-head"><h2>Разрезы</h2></div>
                  <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Поле</th><th>{t.simple ? "Было" : "BEFORE"}</th><th>{t.simple ? "Стало" : "AFTER"}</th></tr></thead>
                    <tbody>
                      {SEG_PAIRS.filter((p) => `${p}_BEFORE` in s || `${p}_AFTER` in s).map((p) => {
                        const b = s[`${p}_BEFORE`], a = s[`${p}_AFTER`];
                        return (
                          <tr key={p} className={b !== a ? "seg-diff" : ""}>
                            <td className={t.simple ? "small" : "mono small"}>{t.field(p)}</td><td>{p === "DECISION" ? <DecisionPill value={b as string} /> : segVal(b)}</td><td>{p === "DECISION" ? <DecisionPill value={a as string} /> : segVal(a)}</td>
                          </tr>
                        );
                      })}
                      {Object.entries(s).filter(([k]) => k !== "APP_ID" && !SEG_PAIRS.some((p) => k.startsWith(p + "_")) && k !== "DECISION_CHANGED").map(([k, v]) => (
                        <tr key={k}><td className={t.simple ? "small" : "mono small"}>{t.field(k)}</td><td colSpan={2}>{segVal(v)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </section>
                <section className="card">
                  <div className="card-head"><h2>Наблюдаемые изменения</h2><span className="hint">{d.decisionEvidence.length}</span></div>
                  <div className="evidence">
                    {d.decisionEvidence.length === 0 && <div className="muted">Нет</div>}
                    {d.decisionEvidence.slice(0, 40).map((e, i) => (
                      <button key={i} className="ev" onClick={() => e.PATH && (search.set("path", e.PATH), search.set("arrayKey", e.ARRAY_KEY ?? ""), setSearch(search, { replace: true, state: loc.state }))}>
                        <ChangeBadge type={e.kind} /> <span className="mono small">{e.text}</span>
                      </button>
                    ))}
                  </div>
                  <div className="muted small" style={{ padding: "8px 20px 14px" }}>{d.evidenceNote || "Наблюдаемые факты, не доказанная причина."}</div>
                </section>
              </div>
            </>
          );
        }}
      </Async>

      {selPath !== null && (selected.error ? <ErrorAlert error={selected.error} /> : selRow ? <AttributeDetail row={selRow} onClose={() => select(null)} /> : selected.data ? <div className="alert alert-warn"><Icon name="info" /> Атрибут {selPath} [{selKey}] не найден в заявке</div> : null)}

      <section className="card">
        <div className="card-head">
          <h2>Атрибуты {attrs.data && <span className="muted">({num(attrs.data.total)})</span>}</h2>
          <div className="row">
            {token && (
              <div className="seg">
                <button className={scope === "group" ? "on" : ""} onClick={() => setScope("group")}>Атрибуты группы сводной</button>
                <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Все атрибуты заявки</button>
              </div>
            )}
            {scope === "all" && (
              <label className="check small"><input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} /> только отличия</label>
            )}
          </div>
        </div>
        {attrs.error instanceof ApiError && attrs.error.isDrilldownExpired ? (
          <div style={{ padding: 16 }}><ErrorAlert error={attrs.error} /><button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setScope("all")}>Показать все атрибуты</button></div>
        ) : (
          <Async state={attrs} label="Загружаем атрибуты…">
            {(p) => (
              <>
                <div className="table-wrap">
                  <table className="t attrs">
                    <thead>
                      <tr><th>{t.simple ? "Поле ответа" : "PATH"}</th><th>{t.simple ? "Элемент списка" : "ARRAY_KEY"}</th><th>{t.simple ? "Что произошло" : "CHANGE_TYPE"}</th><th>{t.source("BEFORE")}</th><th>{t.source("AFTER")}</th><th>{t.simple ? "Группа значений: было → стало" : "Бакет BEFORE → AFTER"}</th></tr>
                    </thead>
                    <tbody>
                      {p.items.map((r) => (
                        <tr key={r.PATH + "\u0000" + r.ARRAY_KEY} className={`clickable ${isSel(r) ? "selected" : ""} ct-${r.CHANGE_TYPE}`} onClick={() => select(isSel(r) ? null : r)}>
                          <td className="mono small" style={{ overflowWrap: "anywhere", minWidth: 220 }}>{r.PATH}</td>
                          <td className="mono small">{r.ARRAY_KEY || <span className="muted">—</span>}</td>
                          <td><ChangeBadge type={r.CHANGE_TYPE} /></td>
                          <td><SideValue row={r} side="BEFORE" /></td>
                          <td><SideValue row={r} side="AFTER" /></td>
                          <td className="small"><SideValue row={r} side="BEFORE" adjusted /> <span className="muted">→</span> <SideValue row={r} side="AFTER" adjusted /></td>
                        </tr>
                      ))}
                      {p.items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>Атрибутов нет</td></tr>}
                    </tbody>
                  </table>
                </div>
                <Pager page={p.page} pageSize={p.pageSize} total={p.total} onPage={setPage} />
              </>
            )}
          </Async>
        )}
      </section>
      <RawJson runId={run.id} appId={appId} />
    </div>
  );
}
