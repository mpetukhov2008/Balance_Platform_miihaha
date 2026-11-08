import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, useApi } from "../api";
import type { Binding, ConfigurationBody, Script, ScriptKind } from "../api/types";
import { Icon } from "../components/Icon";
import { JsonParams } from "../components/JsonParams";
import { DatasetUpload } from "../components/DatasetUpload";
import { ErrorAlert, Loading, PageHead } from "../components/ui";
import { KIND_LABEL } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { fetchAllPages } from "../lib/pages";

const DEFAULT_IDS: Record<string, string> = { NORMALIZE: "builtin-normalize", COMPARE: "builtin-compare", AGGREGATE: "builtin-aggregate" };

function ScriptPicker({ kind, scripts, binding, onChange, onValidity }: { kind: ScriptKind; scripts: Script[]; binding: Binding; onChange: (b: Binding) => void; onValidity: (ok: boolean) => void }) {
  const options = scripts.filter((s) => s.kind === kind);
  const cur = options.find((s) => s.id === binding.scriptId);
  return (
    <div className="proc">
      <div className="row spread">
        <h3>{KIND_LABEL[kind]}</h3>
        {cur && (
          <Link className="small" to={`/workspace/${encodeURIComponent(cur.id)}`}>
            <Icon name="code" size={13} /> открыть код
          </Link>
        )}
      </div>
      <label className="field">
        <span>Процедура</span>
        <select className="select" value={binding.scriptId} onChange={(e) => onChange({ scriptId: e.target.value, params: { ...(options.find((s) => s.id === e.target.value)?.params ?? {}) } })}>
          {!cur && <option value="">— выберите —</option>}
          <optgroup label="Размещённые в системе .py">
            {options.filter((s) => s.sourceType === "FILE").map((s) => <option key={s.id} value={s.id}>{s.filename ?? s.name}</option>)}
          </optgroup>
          <optgroup label="Рабочая область">
            {options.filter((s) => s.sourceType === "WORKSPACE").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        </select>
      </label>
      {cur && <div className="muted small">Источник: {cur.sourceType === "FILE" ? `файл ${cur.filename}` : "рабочая область"} · контракт {cur.contractId}</div>}
      <JsonParams value={binding.params} resetKey={binding.scriptId} onChange={(params) => onChange({ ...binding, params })} onValidity={onValidity} rows={kind === "NORMALIZE" ? 9 : 3} />
    </div>
  );
}

export function ConfigurationEditor() {
  const { configId } = useParams();
  const api = useApi();
  const nav = useNavigate();
  const datasets = useAsync(() => fetchAllPages(api.datasets), []);
  const scripts = useAsync(() => fetchAllPages((p, ps) => api.scripts(undefined, p, ps)), []);
  const existing = useAsync(() => (configId ? api.configuration(configId) : Promise.resolve(null)), [configId]);
  const [form, setForm] = useState<ConfigurationBody | null>(null);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (form || !scripts.data || !datasets.data || existing.data === undefined) return;
    if (existing.data) return setForm(existing.data);
    const all = scripts.data.items;
    const pick = (k: ScriptKind): Binding => {
      const s = all.find((x) => x.id === DEFAULT_IDS[k]) ?? all.find((x) => x.kind === k);
      return { scriptId: s?.id ?? "", params: { ...(s?.params ?? {}) } };
    };
    const ds = datasets.data.items.find((d) => d.status === "READY");
    setForm({
      name: "",
      datasetId: ds?.id ?? "",
      normalizer: pick("NORMALIZE"),
      comparator: pick("COMPARE"),
      aggregator: pick("AGGREGATE"),
      checks: all.filter((s) => s.kind === "CHECK" && s.sourceType === "FILE").map((s) => ({ scriptId: s.id, params: { ...s.params } })),
      aiReviewEnabled: true,
    });
  }, [form, scripts.data, datasets.data, existing.data]);

  const checkScripts = useMemo(() => scripts.data?.items.filter((s) => s.kind === "CHECK") ?? [], [scripts.data]);
  const loadError = datasets.error ?? scripts.error ?? existing.error;
  if (loadError) return <ErrorAlert error={loadError} onRetry={() => (datasets.reload(), scripts.reload(), existing.reload())} />;
  if (!form || !scripts.data || !datasets.data) return <Loading />;

  const set = (patch: Partial<ConfigurationBody>) => (setForm((current) => current ? { ...current, ...patch } : current), setSaved(false));
  const validity = (key: string) => (ok: boolean) => setInvalid((v) => ({ ...v, [key]: !ok }));
  const hasInvalid = Object.values(invalid).some(Boolean);
  const nameMissing = !form.name.trim();

  function toggleCheck(s: Script, on: boolean) {
    set({ checks: on ? [...form!.checks, { scriptId: s.id, params: { ...s.params } }] : form!.checks.filter((c) => c.scriptId !== s.id) });
    // Ошибка JSON отключённой проверки не должна блокировать сохранение.
    if (!on) setInvalid((v) => ({ ...v, ["check:" + s.id]: false }));
  }

  async function save(run: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const body = { ...form!, name: form!.name.trim() };
      const c = configId ? await api.updateConfiguration(configId, body) : await api.createConfiguration(body);
      setForm(c);
      setSaved(true);
      if (run) {
        const r = await api.startRun(c.id);
        return nav(`/runs/${encodeURIComponent(r.id)}`);
      }
      if (!configId) nav(`/configurations/${encodeURIComponent(c.id)}`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        crumbs={<><Link to="/configurations">Конфигурации</Link> <span>/</span></>}
        title={configId ? form.name || "Конфигурация" : "Новая конфигурация"}
        sub="Сохранённая конфигурация запускается повторно; каждый запуск создаёт новый прогон."
        actions={
          <>
            {saved && <span className="badge b-ok"><Icon name="check" size={13} /> Сохранено</span>}
            <button className="btn" disabled={busy || uploading || hasInvalid || nameMissing || !form.datasetId} onClick={() => save(false)}>
              <Icon name="save" /> Сохранить
            </button>
            <button className="btn btn-primary" disabled={busy || uploading || hasInvalid || nameMissing || !form.datasetId} onClick={() => save(true)}>
              <Icon name="play" /> Сохранить и запустить
            </button>
          </>
        }
      />
      {error !== undefined && (
        <div style={{ marginBottom: 14 }}>
          <ErrorAlert error={error} />
          {error instanceof ApiError && error.status === 422 && <div className="muted small" style={{ marginTop: 6 }}>Исправьте поля формы и сохраните снова.</div>}
        </div>
      )}
      <div className="cfg-grid">
        <div className="stack">
          <section className="card card-pad stack">
            <label className="field">
              <span>Название</span>
              <input className={`input ${nameMissing ? "invalid" : ""}`} value={form.name} placeholder="Например: стратегия v42 — полный датасет" onChange={(e) => set({ name: e.target.value })} />
              {nameMissing && <span className="err">Укажите название</span>}
            </label>
            <div className="field">
              <span>Датасет</span>
              <div className="ds-grid">
                {datasets.data.items.map((d) => (
                  <button key={d.id} type="button" disabled={d.status !== "READY"} className={`ds ${form.datasetId === d.id ? "on" : ""}`} onClick={() => set({ datasetId: d.id })}>
                    <div className="row spread">
                      <b>{d.name}</b>
                      {d.status === "READY" ? <span className="badge b-ok">готов</span> : <span className="badge">недоступен</span>}
                    </div>
                    <div className="muted small">{d.appCount === null ? "число заявок неизвестно" : `${d.appCount.toLocaleString("ru-RU")} заявок`} · {d.kind}</div>
                    {d.description && <div className="muted small">{d.description}</div>}
                  </button>
                ))}
              </div>
            </div>
            <DatasetUpload disabled={busy} onBusy={setUploading} onUploaded={(dataset) => {
              datasets.setData({ ...datasets.data!, items: [...datasets.data!.items.filter((d) => d.id !== dataset.id), dataset], total: datasets.data!.total + 1 });
              set({ datasetId: dataset.id });
            }} />
            <label className="check">
              <input type="checkbox" checked={form.aiReviewEnabled} onChange={(e) => set({ aiReviewEnabled: e.target.checked })} />
              Запросить независимое мнение ИИ по агрегатам
            </label>
          </section>
          <section className="card card-pad stack">
            <h2>Процедуры</h2>
            {(["NORMALIZE", "COMPARE", "AGGREGATE"] as const).map((k) => {
              const key = k === "NORMALIZE" ? "normalizer" : k === "COMPARE" ? "comparator" : "aggregator";
              return <ScriptPicker key={k} kind={k} scripts={scripts.data!.items} binding={form[key]} onChange={(b) => set({ [key]: b })} onValidity={validity(key)} />;
            })}
          </section>
        </div>
        <section className="card card-pad stack" style={{ alignSelf: "start" }}>
          <div className="row spread">
            <h2>Проверки</h2>
            <span className="muted small">{form.checks.length} из {checkScripts.length}</span>
          </div>
          {checkScripts.map((s) => {
            const b = form.checks.find((c) => c.scriptId === s.id);
            return (
              <div key={s.id} className={`proc ${b ? "" : "off"}`}>
                <div className="row spread">
                  <label className="check">
                    <input type="checkbox" checked={!!b} onChange={(e) => toggleCheck(s, e.target.checked)} />
                    <b>{s.name}</b>
                  </label>
                  <span className="badge">{s.sourceType === "FILE" ? s.filename : "рабочая область"}</span>
                </div>
                {b && <JsonParams value={b.params} rows={3} onValidity={validity("check:" + s.id)} onChange={(params) => set({ checks: form.checks.map((c) => (c.scriptId === s.id ? { ...c, params } : c)) })} />}
              </div>
            );
          })}
          <Link className="btn btn-sm" to="/workspace?kind=CHECK" style={{ justifySelf: "start" }}>
            <Icon name="plus" /> Написать свою проверку
          </Link>
        </section>
      </div>
    </>
  );
}
