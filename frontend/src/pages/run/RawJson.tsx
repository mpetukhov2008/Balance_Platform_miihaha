import { useState } from "react";
import { useApi } from "../../api";
import type { RawDocument, Source } from "../../api/types";
import { ErrorAlert, SourceBadge } from "../../components/ui";

/** Исходный JSON запрашивается только по кнопке и отображается как текст. */
export function RawJson({ runId, appId }: { runId: string; appId: string }) {
  const api = useApi();
  const [docs, setDocs] = useState<Partial<Record<Source, RawDocument>>>({});
  const [errors, setErrors] = useState<Partial<Record<Source, unknown>>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    setOpen(true);
    setBusy(true);
    await Promise.all(
      (["BEFORE", "AFTER"] as const).map((s) =>
        api.raw(runId, appId, s).then(
          (d) => setDocs((x) => ({ ...x, [s]: d })),
          (e) => setErrors((x) => ({ ...x, [s]: e })),
        ),
      ),
    );
    setBusy(false);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Исходные ответы СПР</h2>
        {!open ? (
          <button className="btn btn-sm" onClick={load}>Показать JSON BEFORE и AFTER</button>
        ) : (
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Свернуть</button>
        )}
      </div>
      {open && (
        <div className="grid cols-2" style={{ padding: 16 }}>
          {(["BEFORE", "AFTER"] as const).map((s) => (
            <div key={s} className="stack" style={{ gap: 8, minWidth: 0 }}>
              <SourceBadge source={s} />
              {errors[s] !== undefined ? (
                <ErrorAlert error={errors[s]} compact />
              ) : docs[s] ? (
                <pre className="raw">{JSON.stringify(docs[s]!.document, null, 2)}</pre>
              ) : (
                <div className="skeleton" style={{ height: 200 }} aria-busy={busy} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
