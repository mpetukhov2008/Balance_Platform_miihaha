import type { ComparisonRow } from "../../api/types";
import { ChangeBadge, SourceBadge } from "../../components/ui";
import { SideValue } from "../../components/Value";
import { CHANGE_LABEL } from "../../lib/format";
import { useTerms } from "../../lib/mode";

const EXPLAIN: Record<string, string> = {
  SAME: "Поле есть в обеих версиях ответа, значение не изменилось.",
  VALUE_CHANGED: "Поле есть в обеих версиях ответа, но значение изменилось. Отличие считается по точному значению, а не по группе.",
  ATTRIBUTE_NEW: "Этого поля не было в старой версии ответа, а в новой оно появилось — например, добавили новое правило.",
  ATTRIBUTE_LOST: "Поле было в старой версии ответа, а в новой пропало — например, правило убрали из стратегии.",
};

/** Подробности выбранного атрибута (PATH + ARRAY_KEY). */
export function AttributeDetail({ row, onClose }: { row: ComparisonRow; onClose: () => void }) {
  const t = useTerms();
  return (
    <section className="card attr-detail" data-testid="attribute-detail">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="muted small">{t.simple ? "Выбранное поле" : "Выбранный атрибут"}</div>
          <h2 className="mono" style={{ fontSize: 14, overflowWrap: "anywhere" }}>{row.PATH}</h2>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Снять выбор</button>
      </div>
      <div className="card-pad stack">
        <div className="row">
          <ChangeBadge type={row.CHANGE_TYPE} /> <span>{CHANGE_LABEL[row.CHANGE_TYPE]}</span>
          <span className={`badge ${row.DIFF_FLAG ? "b-warn" : ""}`}>{t.simple ? (row.DIFF_FLAG ? "есть отличие" : "без отличий") : `DIFF_FLAG = ${row.DIFF_FLAG}`}</span>
        </div>
        <div className="muted small">{EXPLAIN[row.CHANGE_TYPE]}</div>
        <dl className="kv">
          <dt>{t.field("ARRAY_KEY")}</dt><dd className="mono">{row.ARRAY_KEY === "" ? <span className="muted">— нет массивов на пути</span> : row.ARRAY_KEY}</dd>
          <dt>{t.field("PREFIX")}</dt><dd className="mono">{row.PREFIX || <span className="muted">∅</span>}</dd>
          <dt>{t.field("CLASS")}</dt><dd className="mono">{row.CLASS || <span className="muted">∅</span>}</dd>
          <dt>{t.field("SUFFIX")}</dt><dd className="mono">{row.SUFFIX || <span className="muted">∅</span>}</dd>
          <dt>{t.field("KEY")}</dt><dd className="mono">{row.KEY}</dd>
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
