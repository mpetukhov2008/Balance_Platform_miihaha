import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { useApi } from "../api";
import { SCRIPT_KINDS, type Script, type ScriptKind } from "../api/types";
import { Icon } from "../components/Icon";
import { JsonParams } from "../components/JsonParams";
import { ErrorAlert, Loading, PageHead } from "../components/ui";
import { dateTime, KIND_LABEL } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { WorkspaceRun } from "./WorkspaceRun";

type Draft = { name: string; kind: ScriptKind; code: string; params: Record<string, unknown> };

export function WorkspacePage() {
  const { scriptId } = useParams();
  const [search] = useSearchParams();
  const api = useApi();
  const nav = useNavigate();
  const copy = (useLocation().state as { copy?: Draft } | null)?.copy;
  const scripts = useAsync(() => api.scripts(undefined, 1, 200), []);
  const contracts = useAsync(() => api.scriptContracts(), []);
  const script = useAsync(() => (scriptId ? api.script(scriptId) : Promise.resolve(null)), [scriptId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [validParams, setValidParams] = useState(true);
  const [saveError, setSaveError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const dark = typeof window !== "undefined" && (document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches));

  // Новый скрипт: шаблон берётся из каталога контрактов сервера.
  useEffect(() => {
    if (scriptId) {
      if (script.data) setDraft({ name: script.data.name, kind: script.data.kind, code: script.data.code, params: script.data.params });
      setDirty(false);
      return;
    }
    if (copy) {
      setDraft(copy);
      setDirty(true);
      return;
    }
    if (!contracts.data) return;
    const kind = (search.get("kind") as ScriptKind) || "CHECK";
    const c = contracts.data.items.find((x) => x.kind === kind);
    setDraft({ name: kind === "CHECK" ? "Моя проверка" : `Мой ${kind.toLowerCase()}`, kind, code: c?.template ?? "", params: kind === "CHECK" ? { low_confidence_cnt: 5, app_ids_limit: 20 } : {} });
    setDirty(false);
  }, [scriptId, script.data, contracts.data, search, copy]);

  const cur = script.data ?? null;
  const readOnly = cur?.sourceType === "FILE";
  const contract = contracts.data?.items.find((c) => (cur ? c.id === cur.contractId : c.kind === draft?.kind));
  const edit = (p: Partial<Draft>) => (setDraft((d) => (d ? { ...d, ...p } : d)), setDirty(true));

  async function save(): Promise<Script | null> {
    if (!draft) return null;
    if (readOnly) return cur;
    if (!dirty && cur) return cur;
    setSaving(true);
    setSaveError(undefined);
    try {
      const s = cur
        ? await api.updateScript(cur.id, { name: draft.name, code: draft.code, params: draft.params })
        : await api.createScript({ name: draft.name, kind: draft.kind, sourceType: "WORKSPACE", code: draft.code, params: draft.params, contractId: contract?.id ?? draft.kind.toLowerCase() + "-v1" });
      setDirty(false);
      scripts.reload();
      if (!cur) nav(`/workspace/${encodeURIComponent(s.id)}${search.get("runId") ? `?runId=${encodeURIComponent(search.get("runId")!)}` : ""}`, { replace: true });
      else script.setData(s);
      return s;
    } catch (e) {
      setSaveError(e);
      return null;
    } finally {
      setSaving(false);
    }
  }

  function copyToWorkspace() {
    if (!cur) return;
    nav(`/workspace?kind=${cur.kind}`, { state: { copy: { name: `${cur.name} (копия)`, kind: cur.kind, code: cur.code, params: cur.params } } });
  }

  const grouped = SCRIPT_KINDS.map((k) => [k, scripts.data?.items.filter((s) => s.kind === k) ?? []] as const);

  return (
    <>
      <PageHead
        title="Рабочая область Python"
        sub="Код исполняется только на сервере в изолированном исполнителе. Браузер Python не выполняет."
        actions={
          <div className="row">
            <select className="select" style={{ width: "auto" }} value="" onChange={(e) => e.target.value && nav(`/workspace?kind=${e.target.value}`)} aria-label="Создать скрипт">
              <option value="">+ Новый скрипт…</option>
              {SCRIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
        }
      />
      <div className="ws">
        <nav className="card ws-list" aria-label="Скрипты">
          {scripts.error ? <ErrorAlert error={scripts.error} compact /> : grouped.map(([k, list]) => (
            <div key={k}>
              <div className="ws-group">{KIND_LABEL[k]}</div>
              {list.map((s) => (
                <Link key={s.id} to={`/workspace/${encodeURIComponent(s.id)}`} className={`ws-item ${s.id === scriptId ? "on" : ""}`}>
                  <span style={{ fontWeight: 550 }}>{s.sourceType === "FILE" ? s.filename : s.name}</span>
                  <small>{s.sourceType === "FILE" ? "размещённый .py · только чтение" : `рабочая область · ${dateTime(s.updatedAt)}`}</small>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {script.error ? <ErrorAlert error={script.error} onRetry={script.reload} /> : !draft ? <Loading /> : (
            <>
              <section className="card card-pad stack">
                <div className="row spread">
                  <div className="row">
                    <span className="badge b-info">{KIND_LABEL[draft.kind]}</span>
                    <span className="badge">{readOnly ? `файл ${cur?.filename}` : cur ? "рабочая область" : "новый, не сохранён"}</span>
                    {contract && <span className="badge mono">{contract.id}</span>}
                  </div>
                  <div className="row">
                    {readOnly ? (
                      <button className="btn" onClick={copyToWorkspace}><Icon name="code" /> Копировать в рабочую область</button>
                    ) : (
                      <button className="btn btn-primary" disabled={saving || !validParams || !draft.name.trim() || (!dirty && !!cur)} onClick={save}>
                        <Icon name="save" /> {saving ? "Сохраняем…" : dirty || !cur ? "Сохранить" : "Сохранено"}
                      </button>
                    )}
                  </div>
                </div>
                {saveError !== undefined && <ErrorAlert error={saveError} compact />}
                <div className="grid cols-2">
                  <label className="field">
                    <span>Название</span>
                    <input className="input" value={draft.name} disabled={readOnly} onChange={(e) => edit({ name: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Тип скрипта</span>
                    <select className="select" value={draft.kind} disabled={!!cur} onChange={(e) => nav(`/workspace?kind=${e.target.value}`)}>
                      {SCRIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </label>
                </div>
                <div className="editor" data-testid="code-editor">
                  <CodeMirror value={draft.code} height="420px" theme={dark ? "dark" : "light"} extensions={[python()]} readOnly={readOnly} onChange={(code) => edit({ code })} basicSetup={{ tabSize: 4 }} />
                </div>
                <JsonParams value={draft.params} onChange={(params) => edit({ params })} onValidity={setValidParams} rows={4} label={readOnly ? "Параметры по умолчанию (переопределяются при запуске)" : "Параметры (JSON)"} />
              </section>
              {contract && (
                <details className="card card-pad">
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>Контракт {contract.id}: входы, выход и шаблон</summary>
                  <dl className="kv" style={{ marginTop: 12 }}>
                    <dt>Входы</dt><dd className="mono">{contract.inputDescription}</dd>
                    <dt>Выход</dt><dd>{contract.outputDescription}</dd>
                    <dt>Описание</dt><dd>{contract.description}</dd>
                  </dl>
                  {draft.kind === "CHECK" && <div className="muted small" style={{ margin: "10px 0" }}>Строка результата: LABEL, SOURCE (BEFORE|AFTER), ARGUMENT, CNT, TOTAL, METRIC, APP_IDS, RESULT (PASS|FAIL), CONFIDENCE (HIGH|LOW). Фильтры mart: path, path_prefix, key, array_key, diff_flag, change_type, value_before, value_after, app_ids.</div>}
                  <pre className="raw" style={{ marginTop: 10 }}>{contract.template}</pre>
                </details>
              )}
              {cur || !readOnly ? (
                cur ? <WorkspaceRun script={cur} params={draft.params} dirty={dirty} beforeRun={save} initialRunId={search.get("runId") ?? undefined} />
                  : <div className="muted small">Сохраните скрипт, чтобы выполнить его на сервере.</div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
