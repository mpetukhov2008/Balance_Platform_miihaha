const nf = new Intl.NumberFormat("ru-RU");

/** null/undefined → «нет данных», 0 остаётся 0. */
export function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : nf.format(v);
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function timeOnly(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function duration(from: string | null, to: string | null): string {
  if (!from) return "—";
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} мс`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} с`;
  return `${Math.floor(s / 60)} мин ${Math.round(s % 60)} с`;
}

export function ms(v: number | undefined): string {
  if (v === undefined) return "—";
  return v < 1000 ? `${Math.round(v)} мс` : `${(v / 1000).toFixed(2)} с`;
}

/** Ключ pivot-заголовка: пустая строка и null различимы. */
export function keyLabel(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v === "") return "∅";
  return String(v);
}

export const SOURCE_LABEL: Record<string, string> = { BEFORE: "BEFORE (MASTER)", AFTER: "AFTER (BETA)" };

export const CHANGE_LABEL: Record<string, string> = {
  SAME: "Без изменений",
  VALUE_CHANGED: "Значение изменилось",
  ATTRIBUTE_NEW: "Новый атрибут",
  ATTRIBUTE_LOST: "Атрибут пропал",
};

export const STAGE_LABEL: Record<string, string> = {
  NORMALIZE: "Нормализация",
  UNION: "Объединение",
  COMPARE: "Сравнение",
  AGGREGATE: "Факты",
  CHECKS: "Проверки",
  AI_REVIEW: "Мнение ИИ",
  PUBLISH: "Публикация",
};

export const KIND_LABEL: Record<string, string> = {
  NORMALIZE: "Нормализация",
  COMPARE: "Сравнение",
  AGGREGATE: "Подготовка фактов",
  CHECK: "Проверка",
};
