import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** «Обычный» — простые русские подписи; «продвинутый» — технические обозначения контракта. */
export type Mode = "simple" | "advanced";
const KEY = "bp-mode";

function stored(): Mode {
  try {
    return localStorage.getItem(KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

const SOURCE: Record<string, [string, string]> = {
  BEFORE: ["Было", "BEFORE (MASTER)"],
  AFTER: ["Стало", "AFTER (BETA)"],
};
const CHANGE: Record<string, string> = {
  SAME: "Без изменений",
  VALUE_CHANGED: "Изменилось",
  ATTRIBUTE_NEW: "Появилось",
  ATTRIBUTE_LOST: "Пропало",
};
const DECISION: Record<string, string> = { APPROVE: "Одобрено", REJECT: "Отказ", REVIEW: "На проверку", MANUAL: "На проверку" };
const RESULT: Record<string, string> = { PASS: "Норма", FAIL: "Проблема" };
const CONFIDENCE: Record<string, string> = { HIGH: "Уверенно", LOW: "Мало данных" };
const FIELD: Record<string, string> = {
  PREFIX: "Раздел ответа",
  CLASS: "Блок",
  SUFFIX: "Подблок",
  ARRAY_KEY: "Элемент списка",
  KEY: "Поле",
  PATH: "Полный путь поля",
  VALUE_ADJUSTED: "Значение (группа)",
  DIFF_FLAG: "Есть отличие",
  CHANGE_TYPE: "Что произошло",
  SOURCE: "Версия",
  PRODUCTS: "Продукты",
  PARTNER_TYPE: "Тип партнёра",
  ROUTING_METHOD: "Канал заявки",
  DECISION_CHANGED: "Решение сменилось",
  DECISION_BEFORE: "Решение было",
  DECISION_AFTER: "Решение стало",
  TOP_OFFER: "Первое предложение",
  PD_MODEL: "Модель риска",
  CUTOFF: "Порог",
  REJECT_REASON: "Причина отказа",
  SCORE_OKB: "Балл кредитного бюро",
  DECISION: "Решение",
  LABEL: "Проверка",
  ARGUMENT: "Что проверяли",
  CNT: "Заявок",
  TOTAL: "Из",
  METRIC: "Показатель",
  RESULT: "Итог",
  CONFIDENCE: "Надёжность",
};
const YES_NO_FIELDS = new Set(["DIFF_FLAG", "DECISION_CHANGED"]);

function makeTerms(mode: Mode) {
  const simple = mode === "simple";
  return {
    mode,
    simple,
    source: (s: string) => (SOURCE[s] ? SOURCE[s][simple ? 0 : 1] : s),
    change: (c: string) => (simple ? CHANGE[c] ?? c : c),
    decision: (d: string) => (simple ? DECISION[d] ?? d : d),
    result: (r: string) => (simple ? RESULT[r] ?? r : r),
    confidence: (c: string) => (simple ? CONFIDENCE[c] ?? c : c),
    field: (f: string) => (simple ? FIELD[f] ?? f : f),
    /** Значение ключа сводной в зависимости от поля: 0/1 → нет/да, коды → слова. */
    value: (field: string, v: unknown): string | null => {
      if (!simple || v === null || v === undefined || v === "") return null;
      if (YES_NO_FIELDS.has(field)) return Number(v) === 1 ? "да" : "нет";
      if (field === "SOURCE") return SOURCE[String(v)]?.[0] ?? null;
      if (field === "CHANGE_TYPE") return CHANGE[String(v)] ?? null;
      if (field.startsWith("DECISION")) return DECISION[String(v)] ?? null;
      return null;
    },
  };
}

export type Terms = ReturnType<typeof makeTerms> & { setMode: (m: Mode) => void };

const Ctx = createContext<Terms | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(stored);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* режим — только удобство */
    }
  }, [mode]);
  return <Ctx.Provider value={{ ...makeTerms(mode), setMode }}>{children}</Ctx.Provider>;
}

/** Термины текущего режима. Вне провайдера (например, в тестах) — по сохранённому режиму. */
export function useTerms(): Terms {
  return useContext(Ctx) ?? { ...makeTerms(stored()), setMode: () => {} };
}
