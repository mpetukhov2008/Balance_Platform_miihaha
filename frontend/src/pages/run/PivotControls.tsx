import { useState } from "react";
import type { Dimension, Filter, Scalar } from "../../api/types";
import { CHANGE_TYPES } from "../../api/types";
import { Icon } from "../../components/Icon";
import { keyLabel } from "../../lib/format";
import { filterValues, makeFilter, type PivotLayout } from "./pivotState";
import { useTerms } from "../../lib/mode";

export const KNOWN_VALUES: Record<string, Scalar[]> = {
  CHANGE_TYPE: CHANGE_TYPES,
  SOURCE: ["BEFORE", "AFTER"],
  DIFF_FLAG: [0, 1],
  DECISION_CHANGED: [0, 1],
};

type Zone = "rows" | "columns";

function move<T>(arr: T[], i: number, d: number) {
  const a = [...arr];
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function FieldZone({ title, zone, layout, dims, onChange }: { title: string; zone: Zone; layout: PivotLayout; dims: Dimension[]; onChange: (l: PivotLayout) => void }) {
  const list = layout[zone];
  const other: Zone = zone === "rows" ? "columns" : "rows";
  const used = new Set([...layout.rows, ...layout.columns]);
  const free = dims.filter((d) => d.canGroup && !used.has(d.name));
  const set = (next: string[]) => onChange({ ...layout, [zone]: next, page: 1 });
  return (
    <div className="zone" data-testid={`zone-${zone}`}>
      <div className="zone-title">
        <span>{title}</span>
        <select className="select" style={{ height: 26, width: "auto", fontSize: 12, padding: "0 6px" }} value="" aria-label={`Добавить поле в ${title}`} onChange={(e) => e.target.value && set([...list, e.target.value])}>
          <option value="">+ поле</option>
          {free.map((d) => <option key={d.name} value={d.name}>{d.label}</option>)}
        </select>
      </div>
      <div className="zone-list">
        {list.map((f, i) => (
          <div className="chip" key={f}>
            <span className="name" title={f}>{dims.find((d) => d.name === f)?.label ?? f}</span>
            <button disabled={i === 0} onClick={() => set(move(list, i, -1))} aria-label={`Поднять ${f}`} title="Выше"><Icon name="up" /></button>
            <button disabled={i === list.length - 1} onClick={() => set(move(list, i, 1))} aria-label={`Опустить ${f}`} title="Ниже"><Icon name="down" /></button>
            <button onClick={() => onChange({ ...layout, [zone]: list.filter((x) => x !== f), [other]: [...layout[other], f], page: 1 })} aria-label={`Перенести ${f}`} title={zone === "rows" ? "В колонки" : "В строки"}>
              <Icon name={zone === "rows" ? "right" : "left"} />
            </button>
            <button onClick={() => set(list.filter((x) => x !== f))} aria-label={`Убрать ${f}`} title="Убрать"><Icon name="x" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseValue(raw: string, dim: Dimension | undefined): Scalar {
  if (raw === "null") return null;
  if (dim?.type === "number" && raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  if (dim?.type === "boolean") return raw === "true";
  return raw;
}

function FilterChip({ f, dim, onChange, onRemove }: { f: Filter; dim: Dimension | undefined; onChange: (f: Filter | null) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState("");
  const vals = filterValues(f);
  const known = KNOWN_VALUES[f.field];
  const t = useTerms();
  const setVals = (v: Scalar[]) => onChange(makeFilter(f.field, v));
  return (
    <div className="chip filter">
      <div className="row spread">
        <span style={{ fontWeight: 650 }}>{dim?.label ?? t.field(f.field)}</span>
        <button onClick={onRemove} aria-label={`Убрать фильтр ${f.field}`}><Icon name="x" /></button>
      </div>
      {known ? (
        <div className="vals">
          {known.map((k) => (
            <label key={String(k)} className="check small">
              <input type="checkbox" checked={vals.includes(k)} onChange={(e) => setVals(e.target.checked ? [...vals, k] : vals.filter((x) => x !== k))} /> {t.value(f.field, k) ?? keyLabel(k)}
            </label>
          ))}
        </div>
      ) : (
        <>
          <div className="vals">
            {vals.map((v) => (
              <span key={String(v)} className="val-tag">
                {keyLabel(v)}
                <button className="" onClick={() => setVals(vals.filter((x) => x !== v))} aria-label="Убрать значение"><Icon name="x" /></button>
              </span>
            ))}
          </div>
          <input
            className="input"
            style={{ height: 28, fontSize: 12 }}
            placeholder={f.field === "PRODUCTS" ? "id продукта, Enter" : "значение, Enter"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = parseValue(draft.trim(), dim);
                if (!vals.includes(v)) setVals([...vals, v]);
                setDraft("");
              }
            }}
          />
          {f.field === "PRODUCTS" && <span className="muted small">Членство в наборе продуктов заявки</span>}
        </>
      )}
    </div>
  );
}

export function PivotControls({ layout, dims, onChange }: { layout: PivotLayout; dims: Dimension[]; onChange: (l: PivotLayout) => void }) {
  const t = useTerms();
  const filterable = dims.filter((d) => d.canFilter && !layout.filters.some((f) => f.field === d.name));
  const setFilters = (filters: Filter[]) => onChange({ ...layout, filters, page: 1 });
  return (
    <div className="card pv-panel">
      <FieldZone title="Строки" zone="rows" layout={layout} dims={dims} onChange={onChange} />
      <FieldZone title="Колонки" zone="columns" layout={layout} dims={dims} onChange={onChange} />
      <div className="zone">
        <div className="zone-title">
          <span>Фильтры</span>
          <select className="select" style={{ height: 26, width: "auto", fontSize: 12, padding: "0 6px" }} value="" aria-label="Добавить фильтр" onChange={(e) => e.target.value && setFilters([...layout.filters, { field: e.target.value, op: "in", value: [] }])}>
            <option value="">+ фильтр</option>
            {filterable.map((d) => <option key={d.name} value={d.name}>{d.label}</option>)}
          </select>
        </div>
        <div className="zone-list">
          {layout.filters.map((f, i) => (
            <FilterChip
              key={f.field}
              f={f}
              dim={dims.find((d) => d.name === f.field)}
              onRemove={() => setFilters(layout.filters.filter((_, j) => j !== i))}
              onChange={(nf) => setFilters(layout.filters.map((x, j) => (j === i ? nf ?? { field: f.field, op: "in", value: [] } : x)))}
            />
          ))}
        </div>
      </div>
      <div className="muted small">{t.simple ? "Перетаскивать не нужно: стрелками меняйте порядок, кнопкой «→» переносите поле между строками и колонками. Пустое значение показано как ∅." : "Пустой фильтр не применяется. Пустые KEY/SUFFIX показываются как ∅."}</div>
    </div>
  );
}

/** Фильтры без значений не отправляются: in требует непустой массив. */
export function effectiveFilters(fs: Filter[]): Filter[] {
  return fs.filter((f) => !(Array.isArray(f.value) && f.value.length === 0));
}
