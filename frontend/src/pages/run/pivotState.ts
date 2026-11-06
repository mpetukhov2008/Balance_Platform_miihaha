import type { Filter } from "../../api/types";

export type PivotLayout = { rows: string[]; columns: string[]; filters: Filter[]; page: number; pageSize: number };

export const DEFAULT_LAYOUT: PivotLayout = {
  rows: ["PREFIX", "CLASS", "SUFFIX", "KEY"],
  columns: ["DIFF_FLAG", "SOURCE"],
  filters: [],
  page: 1,
  pageSize: 50,
};

/** Раскладка хранится в URL, чтобы «назад» из деталей возвращал ту же сводную. */
export function layoutToSearch(l: Partial<PivotLayout>): string {
  const p = new URLSearchParams();
  const full = { ...DEFAULT_LAYOUT, ...l };
  p.set("rows", full.rows.join(","));
  p.set("cols", full.columns.join(","));
  if (full.filters.length) p.set("f", JSON.stringify(full.filters));
  if (full.page > 1) p.set("page", String(full.page));
  if (full.pageSize !== DEFAULT_LAYOUT.pageSize) p.set("ps", String(full.pageSize));
  return p.toString();
}

export function layoutFromSearch(s: URLSearchParams): PivotLayout {
  const list = (v: string | null, d: string[]) => (v === null ? d : v.split(",").filter(Boolean));
  let filters: Filter[] = [];
  try {
    const f = JSON.parse(s.get("f") ?? "[]");
    if (Array.isArray(f)) filters = f.filter((x) => x && typeof x.field === "string" && (x.op === "eq" || x.op === "in"));
  } catch {
    /* повреждённый URL — без фильтров */
  }
  return {
    rows: list(s.get("rows"), DEFAULT_LAYOUT.rows),
    columns: list(s.get("cols"), DEFAULT_LAYOUT.columns),
    filters,
    page: Math.max(1, Number(s.get("page")) || 1),
    pageSize: Math.min(200, Math.max(10, Number(s.get("ps")) || DEFAULT_LAYOUT.pageSize)),
  };
}

export function filterValues(f: Filter): (string | number | boolean | null)[] {
  return Array.isArray(f.value) ? f.value : [f.value];
}

/** Нормализует фильтр: один элемент → eq, несколько → in (контракт требует массив для in). */
export function makeFilter(field: string, values: (string | number | boolean | null)[]): Filter | null {
  if (!values.length) return null;
  return values.length === 1 ? { field, op: "eq", value: values[0] } : { field, op: "in", value: values };
}
