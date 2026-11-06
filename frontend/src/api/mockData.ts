// Искусственный согласованный набор для демонстрационного режима.
// Это НЕ результат реального нормализатора: значения придуманы, чтобы показать
// все четыре CHANGE_TYPE, null/false/0/отсутствие, длинные значения и CNT > APP_IDS.length.
import type { CheckResult, ComparisonRow } from "./types";

export const DEMO_APPS = ["DEMO-0001", "DEMO-0002", "DEMO-0003"] as const;

type R = [app: string, path: string, arrayKey: string, before: string, after: string, type: ComparisonRow["CHANGE_TYPE"]];

const LONG = "Очень длинное значение атрибута, которое не помещается в ячейку таблицы и должно переноситься аккуратно, не ломая раскладку: " + "x".repeat(160);

const RAW: R[] = [
  ["DEMO-0001", "decisionResult.decision", "", "APPROVE", "REJECT", "VALUE_CHANGED"],
  ["DEMO-0001", "characteristics.score_okb", "", "760", "620", "VALUE_CHANGED"],
  ["DEMO-0001", "decisionResult.product_trials.cutOff.name", "751", "MFO_2026", "MFO_2026_MID", "VALUE_CHANGED"],
  ["DEMO-0001", "decisionResult.available_offers.product_id", "751~standard", "751", "", "ATTRIBUTE_LOST"],
  ["DEMO-0001", "decisionResult.product_trials.rules.hit", "751|AGE_LOW", "false", "false", "SAME"],
  ["DEMO-0002", "decisionResult.decision", "", "REJECT", "APPROVE", "VALUE_CHANGED"],
  ["DEMO-0002", "decisionResult.product_trials.rules.hit", "751|STOP_FRAUD", "true", "", "ATTRIBUTE_LOST"],
  ["DEMO-0002", "decisionResult.available_offers.product_id", "751~standard", "", "751", "ATTRIBUTE_NEW"],
  ["DEMO-0002", "decisionResult.product_trials.scoring.pd.value", "751", "0", "0.12", "VALUE_CHANGED"],
  ["DEMO-0002", "characteristics.comment", "", LONG, LONG + " (изменено)", "VALUE_CHANGED"],
  ["DEMO-0003", "decisionResult.decision", "", "APPROVE", "APPROVE", "SAME"],
  ["DEMO-0003", "characteristics.score_okb", "", "null", "false", "VALUE_CHANGED"],
  ["DEMO-0003", "decisionResult.product_trials.rules.hit", "751|AGE_LOW", "", "", "SAME"],
];

export const DEMO_ROWS: ComparisonRow[] = RAW.map(([APP_ID, PATH, ARRAY_KEY, b, a, CHANGE_TYPE]) => {
  const parts = PATH.split(".");
  const isNull = (v: string) => v === "null";
  return {
    APP_ID,
    PATH,
    ARRAY_KEY,
    PREFIX: parts[0],
    CLASS: parts.length > 2 ? parts[1] : "",
    SUFFIX: parts.length > 3 ? parts.slice(2, -1).join(".") : "",
    KEY: parts[parts.length - 1],
    VALUE_BEFORE: isNull(b) ? "" : b,
    VALUE_AFTER: isNull(a) ? "" : a,
    ADJUSTED_BEFORE: isNull(b) ? "" : b,
    ADJUSTED_AFTER: isNull(a) ? "" : a,
    DIFF_FLAG: CHANGE_TYPE === "SAME" ? 0 : 1,
    CHANGE_TYPE,
    presentBefore: CHANGE_TYPE !== "ATTRIBUTE_NEW",
    presentAfter: CHANGE_TYPE !== "ATTRIBUTE_LOST",
    valueTypeBefore: CHANGE_TYPE === "ATTRIBUTE_NEW" ? null : isNull(b) ? "null" : typeOf(b),
    valueTypeAfter: CHANGE_TYPE === "ATTRIBUTE_LOST" ? null : isNull(a) ? "null" : typeOf(a),
  };
});

function typeOf(v: string) {
  if (v === "true" || v === "false") return "bool";
  if (v !== "" && !Number.isNaN(Number(v))) return v.includes(".") ? "float" : "int";
  return "str";
}

export const DEMO_SEGMENTS: Record<string, Record<string, unknown>> = {
  "DEMO-0001": { DECISION_BEFORE: "APPROVE", DECISION_AFTER: "REJECT", DECISION_CHANGED: 1, PRODUCTS: "751", PARTNER_TYPE: "CURRENT", ROUTING_METHOD: "api", SCORE_OKB_BEFORE: 760, SCORE_OKB_AFTER: 620 },
  "DEMO-0002": { DECISION_BEFORE: "REJECT", DECISION_AFTER: "APPROVE", DECISION_CHANGED: 1, PRODUCTS: "751;91741", PARTNER_TYPE: "NEW_PARTNER", ROUTING_METHOD: "web", SCORE_OKB_BEFORE: 700, SCORE_OKB_AFTER: 700 },
  "DEMO-0003": { DECISION_BEFORE: "APPROVE", DECISION_AFTER: "APPROVE", DECISION_CHANGED: 0, PRODUCTS: "91741", PARTNER_TYPE: "CURRENT", ROUTING_METHOD: "api", SCORE_OKB_BEFORE: null, SCORE_OKB_AFTER: false },
};

export const DEMO_CHECKS: Omit<CheckResult, "rowId">[] = [
  { checkId: "stop_factor_disappeared", LABEL: "Стоп-фактор перестал работать", SOURCE: "AFTER", ARGUMENT: "STOP_FRAUD", CNT: 1, TOTAL: 3, METRIC: 0.3333, APP_IDS: ["DEMO-0002"], RESULT: "FAIL", CONFIDENCE: "LOW" },
  { checkId: "external_score_drift", LABEL: "Сместились внешние данные", SOURCE: "AFTER", ARGUMENT: "score_okb", CNT: 12, TOTAL: 300, METRIC: 0.04, APP_IDS: ["DEMO-0001", "DEMO-0003"], RESULT: "FAIL", CONFIDENCE: "HIGH" },
  { checkId: "attribute_new_loss", LABEL: "Изменился состав атрибутов", SOURCE: "BEFORE", ARGUMENT: "decisionResult.available_offers.product_id", CNT: 0, TOTAL: 3, METRIC: 0, APP_IDS: [], RESULT: "PASS", CONFIDENCE: "HIGH" },
  { checkId: "ar_drop_by_product", LABEL: "Approval Rate по продукту упал", SOURCE: "AFTER", ARGUMENT: "751", CNT: 1, TOTAL: 2, METRIC: "−50 п.п.", APP_IDS: ["DEMO-0001"], RESULT: "FAIL", CONFIDENCE: "LOW" },
];

export function demoRaw(appId: string, source: "BEFORE" | "AFTER") {
  const doc: Record<string, unknown> = {};
  for (const r of DEMO_ROWS.filter((x) => x.APP_ID === appId)) {
    const present = source === "BEFORE" ? r.presentBefore : r.presentAfter;
    if (!present) continue;
    const v = source === "BEFORE" ? r.VALUE_BEFORE : r.VALUE_AFTER;
    doc[r.PATH + (r.ARRAY_KEY ? `[${r.ARRAY_KEY}]` : "")] = v;
  }
  return { _demo: "Искусственный документ демо-режима", appData: { application_id: appId }, flat: doc };
}
