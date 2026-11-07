import { useState } from "react";
import { useApi } from "../../api";
import type { AiReview } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Async, Badge, ErrorAlert } from "../../components/ui";
import { dateTime } from "../../lib/format";
import { useAsync, usePolling } from "../../lib/hooks";
import { useRun } from "./RunPage";

const AI_STATUS: Record<AiReview["status"], [string, string, string]> = {
  READY: ["ok", "Готово", "Мнение сформировано по агрегатам отчёта."],
  PENDING: ["info", "Формируется", "Модель обрабатывает запрос."],
  DISABLED: ["", "Выключено", "Мнение ИИ отключено в конфигурации."],
  UNAVAILABLE: ["warn", "Недоступно", "Модель не подключена или не ответила. Вычисленный отчёт от этого не зависит."],
  FAILED: ["bad", "Ошибка", "Запрос к модели завершился ошибкой."],
  STALE: ["warn", "Устарело", "Отчёт изменился после генерации: мнение относится к прошлой ревизии."],
};

function AiBlock({ runId }: { runId: string }) {
  const api = useApi();
  const ai = useAsync(() => api.aiReview(runId), [runId]);
  const limits = useAsync(() => api.limits(), [runId, ai.data?.generatedAt, ai.data?.status]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>();
  usePolling(ai.reload, ai.data?.status === "PENDING");
  async function generate() {
    setStarting(true);
    setError(undefined);
    try {
      await api.regenerateAiReview(runId);
      ai.reload();
    } catch (e) {
      setError(e);
    } finally {
      setStarting(false);
    }
  }
  return (
    <section className="card ai-card" data-testid="ai-review">
      <div className="card-head">
        <div className="row"><Icon name="spark" size={18} /> <h2>Независимое мнение ИИ</h2></div>
        <button className="btn btn-sm btn-ghost" onClick={generate} disabled={starting || ai.data?.status === "PENDING"}>
          <Icon name="refresh" /> {starting || ai.data?.status === "PENDING" ? "Формируется…" : "Сформировать мнение"}
        </button>
      </div>
      <div className="card-pad stack">
        {limits.data && <div className="hint">Ваш суточный лимит: запросы {limits.data.aiRequestsUsed} / {limits.data.aiRequestsLimit}, токены {limits.data.aiTokensUsed} / {limits.data.aiTokensLimit}. Сброс в 00:00 UTC. Также действует общий лимит сервера.</div>}
        {error !== undefined && <ErrorAlert error={error} />}
        <Async state={ai}>
          {(a) => {
            const [tone, label, hint] = AI_STATUS[a.status] ?? ["", a.status, ""];
            return (
              <>
                <div className="row">
                  <Badge tone={tone} pulse={a.status === "PENDING" ? true : undefined}>{label}</Badge>
                  <span className="muted small">{hint}</span>
                </div>
                {a.text && a.status !== "STALE" && <div className="ai-text">{a.text}</div>}
                {a.text && a.status === "STALE" && (
                  <details>
                    <summary className="small muted">Показать прошлое мнение (ревизия {a.reportRevision})</summary>
                    <div className="ai-text muted" style={{ marginTop: 8 }}>{a.text}</div>
                  </details>
                )}
                {a.error && <div className="alert alert-warn"><Icon name="info" /><div>{a.error}</div></div>}
                <div className="muted small">
                  Это мнение модели по агрегатам, а не доказанная причина и не результат проверки PASS/FAIL.
                  {a.generatedAt && <> Сформировано {dateTime(a.generatedAt)}.</>}
                  {a.reportRevision !== null && <> Ревизия отчёта: {a.reportRevision}.</>}
                </div>
              </>
            );
          }}
        </Async>
      </div>
    </section>
  );
}

export function ReportView() {
  const { run } = useRun();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState(false);

  async function download() {
    setBusy(true);
    setError(undefined);
    setDone(false);
    try {
      // Статус проверяется в клиенте до создания Blob: ошибка не сохраняется как report.html.
      const blob = await api.downloadReport(run.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${run.id}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      <AiBlock runId={run.id} />
      <section className="card">
        <div className="card-head"><div className="row"><Icon name="file" size={18} /> <h2>HTML-документ отчёта</h2></div></div>
        <div className="card-pad stack">
          <div className="muted">
            Документ формирует сервер: сводка, единая таблица проверок, статус ИИ и ссылки обратно в приложение. Ссылки из скачанного файла могут потребовать входа.
          </div>
          <div className="row">
            {api.mode === "real" ? (
              <a className="btn" href={api.reportUrl(run.id)} target="_blank" rel="noopener noreferrer"><Icon name="ext" /> Открыть по ссылке</a>
            ) : (
              <button className="btn" disabled title="В демо-режиме серверного документа нет"><Icon name="ext" /> Открыть по ссылке</button>
            )}
            <button className="btn btn-primary" onClick={download} disabled={busy}><Icon name="download" /> {busy ? "Скачиваем…" : "Скачать HTML"}</button>
          </div>
          {done && <span className="badge b-ok"><Icon name="check" size={13} /> Файл сохранён</span>}
          {error !== undefined && <ErrorAlert error={error} />}
        </div>
      </section>
    </div>
  );
}
