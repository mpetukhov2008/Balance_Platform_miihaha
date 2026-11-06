import type { ComparisonRow } from "../../api/types";
import { ChangeBadge, SourceBadge } from "../../components/ui";
import { SideValue } from "../../components/Value";
import { CHANGE_LABEL } from "../../lib/format";

const EXPLAIN: Record<string, string> = {
  SAME: "Атрибут есть в обоих срезах, значения совпадают.",
  VALUE_CHANGED: "Атрибут есть в обоих срезах, значение изменилось. DIFF_FLAG считается по VALUE, а не по бакету.",
  ATTRIBUTE_NEW: "Атрибута не было в BEFORE, он появился в AFTER — например, новое правило в стратегии.",
  ATTRIBUTE_LOST: "Атрибут был в BEFORE и пропал в AFTER — например, правило убрали из стратегии.",
};

/** Подробности выбранного атрибута (PATH + ARRAY_KEY). */
export function AttributeDetail({ row, onClose }: { row: ComparisonRow; onClose: () => void }) {
  return (
    <section className="card attr-detail" data-testid="attribute-detail">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="muted small">Выбранный атрибут</div>
          <h2 className="mono" style={{ fontSize: 14, overflowWrap: "anywhere" }}>{row.PATH}</h2>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Снять выбор</button>
      </div>
      <div className="card-pad stack">
        <div className="row">
          <ChangeBadge type={row.CHANGE_TYPE} /> <span>{CHANGE_LABEL[row.CHANGE_TYPE]}</span>
          <span className={`badge ${row.DIFF_FLAG ? "b-warn" : ""}`}>DIFF_FLAG = {row.DIFF_FLAG}</span>
        </div>
        <div className="muted small">{EXPLAIN[row.CHANGE_TYPE]}</div>
        <dl className="kv">
          <dt>ARRAY_KEY</dt><dd className="mono">{row.ARRAY_KEY === "" ? <span className="muted">— нет массивов на пути</span> : row.ARRAY_KEY}</dd>
          <dt>PREFIX</dt><dd className="mono">{row.PREFIX || <span className="muted">∅</span>}</dd>
          <dt>CLASS</dt><dd className="mono">{row.CLASS || <span className="muted">∅</span>}</dd>
          <dt>SUFFIX</dt><dd className="mono">{row.SUFFIX || <span className="muted">∅</span>}</dd>
          <dt>KEY</dt><dd className="mono">{row.KEY}</dd>
        </dl>
        <div className="vs">
          {(["BEFORE", "AFTER"] as const).map((s) => (
            <div key={s} className={`vs-side vs-${s}`}>
              <SourceBadge source={s} />
              <div className="vs-label">Значение</div>
              <div className="vs-value"><SideValue row={row} side={s} /></div>
              <div className="vs-label">После бакетизации</div>
              <div className="vs-value small"><SideValue row={row} side={s} adjusted /></div>
              {(s === "BEFORE" ? row.valueTypeBefore : row.valueTypeAfter) && (
                <div className="muted small">тип: {s === "BEFORE" ? row.valueTypeBefore : row.valueTypeAfter}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
