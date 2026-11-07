import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, useApi } from "../../api";
import type { Filter, PivotResult, Scalar } from "../../api/types";
import { Async, ErrorAlert, Loading, Pager } from "../../components/ui";
import { keyLabel, num } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { effectiveFilters, PivotControls } from "./PivotControls";
import { QuickFilters } from "./QuickFilters";
import { layoutFromSearch, layoutToSearch, type PivotLayout } from "./pivotState";
import { useRun } from "./RunPage";

export function pivotLink(runId: string, l: Partial<PivotLayout>) {
  return `/runs/${encodeURIComponent(runId)}/pivot?${layoutToSearch(l)}`;
}

/** Контекст ячейки для заголовка списка заявок (только подписи; выборку задаёт token). */
export type CellContext = { rows: [string, Scalar][]; columns: [string, Scalar][]; filters: Filter[]; value: number; measure: string };

function KeyCell({ v }: { v: Scalar }) {
  if (v === null) return <span className="ck-null">null</span>;
  if (v === "") return <span className="ck-empty" title="пустое значение">∅</span>;
  return <>{String(v)}</>;
}

function ColumnHeaders({ p, rowSpan }: { p: PivotResult; rowSpan: number }) {
  const levels = Math.max(1, p.columnFields.length);
  return (
    <thead>
      {Array.from({ length: levels }, (_, lvl) => {
        const groups: { key: Scalar; span: number }[] = [];
        p.columnKeys.forEach((ck, i) => {
          const prev = p.columnKeys[i - 1];
          const same = prev && ck.slice(0, lvl + 1).every((v, j) => v === prev[j]);
          if (same) groups[groups.length - 1].span++;
          else groups.push({ key: ck[lvl] ?? "", span: 1 });
        });
        return (
          <tr key={lvl}>
            {lvl === 0 && (
              <th className="corner" colSpan={Math.max(1, rowSpan)} rowSpan={levels} style={{ top: 0 }}>
                {p.rowFields.join(" › ") || "—"}
                <div style={{ fontFamily: "var(--font)", fontWeight: 500 }}>{p.columnFields.length ? `колонки: ${p.columnFields.join(" × ")}` : ""}</div>
              </th>
            )}
            {groups.map((g, i) => (
              <th key={i} colSpan={g.span} style={{ top: lvl * 31 }}>
                {p.columnFields.length ? <><span className="muted">{p.columnFields[lvl]}=</span><KeyCell v={g.key} /></> : p.measure.label}
              </th>
            ))}
          </tr>
        );
      })}
    </thead>
  );
}

function PivotTable({ p, onCell, disabled }: { p: PivotResult; onCell: (r: number, c: number, token: string, value: number) => void; disabled: boolean }) {
  const grid = useMemo(() => {
    const m = new Map<string, { value: number; token: string | null }>();
    p.cells.forEach((c) => m.set(`${c.rowIndex}:${c.columnIndex}`, { value: c.value, token: c.drilldownToken }));
    return m;
  }, [p]);
  const max = Math.max(1, ...p.cells.map((c) => c.value));
  return (
    <div className="table-wrap" style={{ maxHeight: "70vh" }}>
      <table className="pv-table" data-testid="pivot-table">
        <ColumnHeaders p={p} rowSpan={p.rowFields.length} />
        <tbody>
          {p.rowKeys.map((rk, ri) => (
            <tr key={ri}>
              {rk.length === 0 && <td className="rh muted">все</td>}
              {rk.map((v, lvl) => {
                const prev = p.rowKeys[ri - 1];
                const rep = !!prev && rk.slice(0, lvl + 1).every((x, j) => x === prev[j]);
                return (
                  <td key={lvl} className={`rh ${rep ? "rep" : ""}`} title={keyLabel(v)}>
                    {!rep && <KeyCell v={v} />}
                  </td>
                );
              })}
              {p.columnKeys.map((_, ci) => {
                const c = grid.get(`${ri}:${ci}`);
                const alpha = c ? 0.06 + 0.4 * Math.sqrt(c.value / max) : 0;
                return (
                  <td key={ci} className="pv-cell" style={c ? { background: `rgba(var(--heat), ${alpha})` } : undefined}>
                    {!c ? (
                      <span className="zero">·</span>
                    ) : c.token ? (
                      <button disabled={disabled} onClick={() => onCell(ri, ci, c.token!, c.value)} title={disabled ? "Сводная пересчитывается" : "Открыть заявки этой ячейки"}>{num(c.value)}</button>
                    ) : (
                      num(c.value)
                    )}
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

export function PivotView() {
  const { run } = useRun();
  const api = useApi();
  const nav = useNavigate();
  const [search, setSearch] = useSearchParams();
  const layout = layoutFromSearch(search);
  const dims = useAsync(() => api.dimensions(run.id), [run.id]);
  const query = { rows: layout.rows, columns: layout.columns, filters: effectiveFilters(layout.filters), measure: "SUM_CNT" as const, page: layout.page, pageSize: layout.pageSize };
  const qKey = JSON.stringify(query);
  // Ответ хранится вместе со снимком своего запроса: подписи и token ячейки всегда из одного ответа.
  const pivot = useAsync(async () => {
    const snap = { query, search: search.toString() };
    return { ...snap, result: await api.pivot(run.id, snap.query) };
  }, [run.id, qKey]);
  const updating = pivot.loading && !!pivot.data;
  const change = (l: PivotLayout) => setSearch(layoutToSearch(l));

  function openCell(snap: { query: typeof query; search: string }, p: PivotResult, ri: number, ci: number, token: string, value: number) {
    if (updating) return;
    const ctx: CellContext = {
      rows: p.rowFields.map((f, i) => [f, p.rowKeys[ri][i]]),
      columns: p.columnFields.map((f, i) => [f, p.columnKeys[ci][i]]),
      filters: snap.query.filters,
      value,
      measure: p.measure.label,
    };
    nav(`../apps?token=${encodeURIComponent(token)}`, { state: { cell: ctx, back: `pivot?${snap.search}` } });
  }

  if (dims.error) return <ErrorAlert error={dims.error} onRetry={dims.reload} />;
  if (!dims.data) return <Loading />;
  const tooWide = pivot.error instanceof ApiError && pivot.error.code === "PIVOT_TOO_WIDE";

  return (
    <div className="pv-layout">
      <PivotControls layout={layout} dims={dims.data.items} onChange={change} />
      <section className="card" style={{ minWidth: 0 }}>
        <QuickFilters runId={run.id} dims={dims.data.items} layout={layout} onChange={change} />
        {tooWide ? (
          <div style={{ padding: 16 }}>
            <ErrorAlert error={pivot.error} />
            <div className="muted small" style={{ marginTop: 8 }}>Слишком много колонок: уберите поле из колонок или добавьте фильтр. Обрезанный результат не показывается.</div>
          </div>
        ) : pivot.error ? (
          <div style={{ padding: 16 }}><ErrorAlert error={pivot.error} onRetry={pivot.reload} /></div>
        ) : (
          <Async state={pivot} label="Считаем сводную на сервере…">
            {({ result: p, ...snap }) => (
              <div aria-busy={updating} className={updating ? "pv-updating" : undefined} data-testid="pivot-result">
                {updating && <div className="pv-updating-note"><div className="spinner" /> Пересчитываем по новой раскладке — ячейки временно недоступны</div>}
                <div className="card-head">
                  <div>
                    <h2>{p.measure.label}</h2>
                    <div className="hint">
                      Сумма CNT {p.measure.additive ? "(аддитивная мера)" : ""}. Уникальных заявок в отфильтрованном наборе: <b>{num(p.uniqueApps)}</b>. Значение ячейки может превышать число уникальных заявок.
                    </div>
                  </div>
                  <span className="muted small nowrap">{num(p.totalRows)} групп строк</span>
                </div>
                {p.cells.length === 0 ? <div className="state">Нет фактов под выбранные фильтры</div> : <PivotTable p={p} disabled={updating} onCell={(r, c, t, v) => openCell(snap, p, r, c, t, v)} />}
                <Pager page={p.page} pageSize={p.pageSize} total={p.totalRows} onPage={(pg) => change({ ...layout, page: pg })} />
              </div>
            )}
          </Async>
        )}
      </section>
    </div>
  );
}
