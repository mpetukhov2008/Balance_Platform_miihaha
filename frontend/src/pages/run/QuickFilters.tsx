import { useState } from "react";
import { useApi } from "../../api";
import type { Dimension, Filter, Scalar } from "../../api/types";
import { useAsync } from "../../lib/hooks";
import { filterValues, type PivotLayout } from "./pivotState";

/** Значения разреза берутся с сервера той же pivot-выборкой (группы по одному полю). */
function useDistinct(runId: string, field: string, enabled: boolean, split = false) {
  const api = useApi();
  return useAsync(async () => {
    if (!enabled) return [] as string[];
    const p = await api.pivot(runId, { rows: [field], columns: [], filters: [], measure: "SUM_CNT", page: 1, pageSize: 200 });
    const vals = p.rowKeys.map((k) => k[0]).filter((v) => v !== null && v !== "").map(String);
    return [...new Set(split ? vals.flatMap((v) => v.split(";")) : vals)].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  }, [runId, field, enabled]);
}

export function QuickFilters({ runId, dims, layout, onChange }: { runId: string; dims: Dimension[]; layout: PivotLayout; onChange: (l: PivotLayout) => void }) {
  const has = (n: string) => dims.some((d) => d.name === n && d.canFilter);
  const one = (field: string): Scalar | undefined => {
    const f = layout.filters.find((x) => x.field === field);
    const v = f ? filterValues(f) : [];
    return v.length === 1 ? v[0] : undefined;
  };
  // Значения грузятся лениво — при первом открытии списка, чтобы не конкурировать с основной выборкой.
  const [want, setWant] = useState<Record<string, boolean>>({});
  const products = useDistinct(runId, "PRODUCTS", has("PRODUCTS") && (!!want.PRODUCTS || one("PRODUCTS") !== undefined), true);
  const partners = useDistinct(runId, "PARTNER_TYPE", has("PARTNER_TYPE") && (!!want.PARTNER_TYPE || one("PARTNER_TYPE") !== undefined));
  const ask = (f: string) => () => !want[f] && setWant((w) => ({ ...w, [f]: true }));
  const setOne = (field: string, value: Scalar | undefined) => {
    const rest = layout.filters.filter((f) => f.field !== field);
    const next: Filter[] = value === undefined ? rest : [...rest, { field, op: "eq", value }];
    onChange({ ...layout, filters: next, page: 1 });
  };
  const dc = one("DECISION_CHANGED");

  return (
    <div className="quick" data-testid="quick-filters">
      {has("DIFF_FLAG") && (
        <label className="check small">
          <input type="checkbox" checked={one("DIFF_FLAG") === 1} onChange={(e) => setOne("DIFF_FLAG", e.target.checked ? 1 : undefined)} /> Только отличия
        </label>
      )}
      {has("DECISION_CHANGED") && (
        <div className="seg" role="group" aria-label="Смена решения">
          <button className={dc === undefined ? "on" : ""} onClick={() => setOne("DECISION_CHANGED", undefined)}>Все заявки</button>
          <button className={dc === 1 ? "on" : ""} onClick={() => setOne("DECISION_CHANGED", 1)}>Решение сменилось</button>
          <button className={dc === 0 ? "on" : ""} onClick={() => setOne("DECISION_CHANGED", 0)}>Решение то же</button>
        </div>
      )}
      {has("PRODUCTS") && (
        <select className="select" style={{ width: "auto", height: 30 }} aria-label="Продукт" onFocus={ask("PRODUCTS")} onMouseDown={ask("PRODUCTS")} value={String(one("PRODUCTS") ?? "")} onChange={(e) => setOne("PRODUCTS", e.target.value || undefined)}>
          <option value="">Продукт: все</option>
          {one("PRODUCTS") !== undefined && !products.data?.includes(String(one("PRODUCTS"))) && <option value={String(one("PRODUCTS"))}>Продукт {String(one("PRODUCTS"))}</option>}
          {products.loading && want.PRODUCTS && <option disabled>загрузка…</option>}
          {(products.data ?? []).map((p) => <option key={p} value={p}>Продукт {p}</option>)}
        </select>
      )}
      {has("PARTNER_TYPE") && (
        <select className="select" style={{ width: "auto", height: 30 }} aria-label="Партнёр" onFocus={ask("PARTNER_TYPE")} onMouseDown={ask("PARTNER_TYPE")} value={String(one("PARTNER_TYPE") ?? "")} onChange={(e) => setOne("PARTNER_TYPE", e.target.value || undefined)}>
          <option value="">Партнёр: все</option>
          {one("PARTNER_TYPE") !== undefined && !partners.data?.includes(String(one("PARTNER_TYPE"))) && <option value={String(one("PARTNER_TYPE"))}>{String(one("PARTNER_TYPE"))}</option>}
          {partners.loading && want.PARTNER_TYPE && <option disabled>загрузка…</option>}
          {(partners.data ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}
      {!!(products.error || partners.error) && <span className="small" style={{ color: "var(--bad)" }}>не удалось загрузить значения разрезов</span>}
    </div>
  );
}
