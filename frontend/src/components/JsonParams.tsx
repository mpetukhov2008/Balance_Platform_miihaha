import { useEffect, useState } from "react";

/** JSON-редактор параметров: принимает только объект, ошибку разбора показывает рядом. */
export function JsonParams({ value, onChange, onValidity, rows = 5, label = "Параметры (JSON)" }: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  onValidity?: (ok: boolean) => void;
  rows?: number;
  label?: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);

  // Внешняя смена значения (выбор другого скрипта) перезаписывает текст.
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
  }, [value]);

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
