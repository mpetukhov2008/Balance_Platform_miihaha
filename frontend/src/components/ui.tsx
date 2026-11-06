import type { ReactNode } from "react";
import { ApiError } from "../api";
import { Icon } from "./Icon";
import { CHANGE_LABEL, SOURCE_LABEL } from "../lib/format";

export function Badge({ tone, children, pulse, title }: { tone?: string; children: ReactNode; pulse?: boolean; title?: string }) {
  return (
    <span className={`badge ${tone ? "b-" + tone : ""} ${pulse ? "b-pulse" : ""}`} title={title}>
      {pulse !== undefined && <i className="dot" />}
      {children}
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  QUEUED: ["info", "В очереди"],
  PENDING: ["", "Ожидает"],
  RUNNING: ["info", "Выполняется"],
  SUCCEEDED: ["ok", "Готово"],
  FAILED: ["bad", "Ошибка"],
  SKIPPED: ["", "Пропущен"],
};

export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = STATUS[status] ?? ["", status];
  return (
    <Badge tone={tone} pulse={status === "RUNNING" || status === "QUEUED"}>
      {label}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return <Badge tone={source === "BEFORE" ? "before" : "after"}>{SOURCE_LABEL[source] ?? source}</Badge>;
}

const CT_TONE: Record<string, string> = { SAME: "", VALUE_CHANGED: "warn", ATTRIBUTE_NEW: "ok", ATTRIBUTE_LOST: "bad" };
export function ChangeBadge({ type }: { type: string }) {
  return (
    <Badge tone={CT_TONE[type]} title={CHANGE_LABEL[type]}>
      {type}
    </Badge>
  );
}

export function DecisionPill({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  const tone = /APPROVE/i.test(value) ? "ok" : /REJECT/i.test(value) ? "bad" : "warn";
  return <Badge tone={tone}>{value}</Badge>;
}

/** Ошибка сервера. Никогда не подменяется нулями или демо-данными. */
export function ErrorAlert({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  let title = "Не удалось выполнить запрос";
  if (e?.status === 0) title = "Сервер недоступен";
  else if (e?.isNotReady) title = "Результат ещё не готов";
  else if (e?.isDrilldownExpired) title = "Ссылка на группу устарела";
  else if (e?.status === 404) title = "Не найдено";
  else if (e?.status === 403) title = "Доступ запрещён";
  else if (e?.status === 422) title = "Запрос отклонён сервером";
  else if (e && e.status >= 500) title = "Ошибка сервера";
  const msg = e?.message ?? (error instanceof Error ? error.message : String(error));
  return (
    <div className={`alert ${e?.isNotReady ? "alert-warn" : "alert-bad"}`} role="alert" style={compact ? { padding: "8px 12px" } : undefined}>
      <Icon name="alert" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{msg}</div>
        {e && <div className="code">{e.status ? `HTTP ${e.status} · ` : ""}{e.code}</div>}
      </div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh" /> Повторить
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, icon = "inbox" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="state">
      <Icon name={icon} />
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="state" aria-busy="true">
      <div className="spinner" />
      <div>{label}</div>
    </div>
  );
}

/** Единый блок async-состояния: загрузка / ошибка / контент. */
export function Async<T>({ state, children, label }: { state: { data: T | undefined; error: unknown; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; label?: string }) {
  if (state.error) return <ErrorAlert error={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <Loading label={label} />;
  return <>{children(state.data)}</>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return null;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="row spread" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
      <span className="muted small">
        {from}–{Math.min(page * pageSize, total)} из {total.toLocaleString("ru-RU")}
      </span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Предыдущая страница">
          <Icon name="left" />
        </button>
        <span className="small">
          {page} / {pages}
        </span>
        <button className="btn btn-sm btn-icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Следующая страница">
          <Icon name="right" />
        </button>
      </div>
    </div>
  );
}

export function PageHead({ title, sub, crumbs, actions }: { title: ReactNode; sub?: ReactNode; crumbs?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
