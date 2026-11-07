import { useEffect, useRef, useState } from "react";

/** JSON-редактор параметров: принимает только объект, ошибку разбора показывает рядом. */
export function JsonParams({ value, onChange, onValidity, resetKey, rows = 5, label = "Параметры (JSON)" }: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  onValidity?: (ok: boolean) => void;
  /** Смена ключа (другой скрипт) сбрасывает невалидный текст, даже если параметры совпадают. */
  resetKey?: string;
  rows?: number;
  label?: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(value);
  const validityRef = useRef(onValidity);
  validityRef.current = onValidity;

  // Внешняя смена значения (выбор другого скрипта) перезаписывает текст и снимает ошибку:
  // родитель тоже должен узнать, что параметры снова валидны.
  useEffect(() => {
    setText((t) => {
      try {
        if (JSON.stringify(JSON.parse(t)) === JSON.stringify(value)) return t;
      } catch {
        /* текст невалиден — заменяем */
      }
      return JSON.stringify(value, null, 2);
    });
    setErr(null);
    validityRef.current?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resetKey]);

  // При удалении редактора (проверку отключили) его ошибка больше не блокирует форму.
  useEffect(() => () => validityRef.current?.(true), []);

  function edit(t: string) {
    setText(t);
    try {
      const v = JSON.parse(t || "{}");
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("Ожидается JSON-объект {…}");
      setErr(null);
      onValidity?.(true);
      onChange(v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Неверный JSON");
      onValidity?.(false);
    }
  }

  return (
    <label className="field">
      <span>{label}</span>
      <textarea className={`textarea ${err ? "invalid" : ""}`} rows={rows} spellCheck={false} value={text} onChange={(e) => edit(e.target.value)} />
      {err && <span className="err">{err}</span>}
    </label>
  );
}
