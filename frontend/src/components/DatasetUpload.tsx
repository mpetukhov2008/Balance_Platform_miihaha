import { useRef, useState } from "react";
import { useApi } from "../api";
import type { Dataset } from "../api/types";
import { useAsync } from "../lib/hooks";
import { ErrorAlert } from "./ui";

const mib = (bytes: number) => (bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

export function DatasetUpload({ onUploaded, onBusy, disabled = false }: {
  onUploaded: (dataset: Dataset) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const api = useApi();
  const limits = useAsync(() => api.datasetUploadOptions(), []);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [uploaded, setUploaded] = useState<Dataset>();
  const fileError = file && (!file.name.toLowerCase().endsWith(".zip") ? "Выберите ZIP-архив." : limits.data && file.size > limits.data.maxArchiveBytes ? `Архив больше ${mib(limits.data.maxArchiveBytes)} МиБ.` : file.size === 0 ? "Архив пуст." : undefined);

  async function upload() {
    if (!file || !name.trim() || !limits.data || fileError || busy || disabled) return;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    setUploaded(undefined);
    try {
      const dataset = await api.uploadDataset(name.trim(), file);
      onUploaded(dataset);
      setUploaded(dataset);
      setFile(undefined);
      setName("");
      if (input.current) input.current.value = "";
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <section className="stack" aria-label="Загрузка датасета" aria-busy={busy}>
      <h3>Загрузить свой датасет</h3>
      <p className="muted small">Выберите ZIP с двумя папками: <code>BEFORE</code> и <code>AFTER</code> (также подходят <code>BEFORE_MASTER</code> и <code>AFTER_BETA</code>). В каждой — JSON-файлы заявок; имя файла без .json должно совпадать с <code>appData.application_id</code>. Для каждой заявки нужны обе версии.</p>
      {limits.data && <p className="hint">Архив до {mib(limits.data.maxArchiveBytes)} МиБ, после распаковки до {mib(limits.data.maxExpandedBytes)} МиБ; до {limits.data.maxPairs.toLocaleString("ru-RU")} пар. В аккаунте можно хранить до {limits.data.maxDatasets} датасетов. Загруженные данные доступны только вам.</p>}
      {limits.error !== undefined && <ErrorAlert error={limits.error} onRetry={limits.reload} />}
      <label className="field">
        <span>Название датасета</span>
        <input className="input" value={name} maxLength={200} disabled={busy || disabled} placeholder="Например: новая кредитная стратегия" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>ZIP-архив датасета</span>
        <input ref={input} className="input" type="file" accept=".zip,application/zip" disabled={busy || disabled} onChange={(e) => {
          const next = e.target.files?.[0];
          setFile(next);
          setError(undefined);
          setUploaded(undefined);
          if (next && !name.trim()) setName(next.name.replace(/\.zip$/i, "").slice(0, 200));
        }} />
        {fileError && <span className="err" role="alert">{fileError}</span>}
      </label>
      <button type="button" className="btn" style={{ justifySelf: "start" }} disabled={busy || disabled || !file || !name.trim() || !limits.data || !!fileError} onClick={upload}>
        {busy ? "Загружаем и проверяем…" : "Загрузить датасет"}
      </button>
      {error !== undefined && <ErrorAlert error={error} />}
      {uploaded && <p className="hint" role="status">Датасет «{uploaded.name}» загружен: {uploaded.appCount?.toLocaleString("ru-RU")} пар заявок. Он выбран для этой конфигурации. Сохраните конфигурацию или запустите сравнение.</p>}
    </section>
  );
}
