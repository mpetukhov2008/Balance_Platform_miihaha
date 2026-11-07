import type { ComparisonRow } from "../api/types";

/**
 * Отображение значения атрибута в одном срезе. Отсутствие определяется по CHANGE_TYPE
 * (и presentBefore/After, если сервер их прислал), а не по пустоте строки:
 * null, false, 0 и пустая строка показываются как разные значения.
 */
export function SideValue({ row, side, adjusted }: { row: ComparisonRow; side: "BEFORE" | "AFTER"; adjusted?: boolean }) {
  const absentByType = side === "BEFORE" ? row.CHANGE_TYPE === "ATTRIBUTE_NEW" : row.CHANGE_TYPE === "ATTRIBUTE_LOST";
  const presentFlag = side === "BEFORE" ? row.presentBefore : row.presentAfter;
  const absent = presentFlag === undefined ? absentByType : !presentFlag;
  if (absent) return <span className="v-absent">отсутствует</span>;
  const raw = side === "BEFORE" ? (adjusted ? row.ADJUSTED_BEFORE : row.VALUE_BEFORE) : adjusted ? row.ADJUSTED_AFTER : row.VALUE_AFTER;
  const t = side === "BEFORE" ? row.valueTypeBefore : row.valueTypeAfter;
  if (t === "null" || t === "NoneType" || t === "None") return <span className="v-null">null</span>;
  if (raw === "") return <span className="v-empty">«» пустая строка</span>;
  const typeHint = t === "bool" ? "v-bool" : t === "int" || t === "float" ? "v-num" : "";
  return (
    <span className={`cell-val ${typeHint}`} title={t ? `тип: ${t}` : undefined}>
      {raw}
    </span>
  );
}
