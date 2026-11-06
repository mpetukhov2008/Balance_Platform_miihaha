import { ApiError, type ApiClient } from "./client";
import type { Session } from "./types";

const enc = encodeURIComponent;

function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText || "Ошибка сервера";
  let details: unknown;
  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* тело не JSON — оставляем статус */
  }
  return new ApiError(res.status, code, message, details);
}

type C = ApiClient;

export class HttpApiClient implements ApiClient {
  readonly mode = "real" as const;
  onUnauthorized?: () => void;
  private csrf: string | null = null;
  private base: string;

  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown, asBlob = false): Promise<T> {
    const headers: Record<string, string> = { Accept: asBlob ? "text/html" : "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && this.csrf) headers["X-CSRF-Token"] = this.csrf;
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        credentials: "include",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "NETWORK", "Сервер недоступен. Проверьте, что backend запущен.");
    }
    if (!res.ok) {
      const err = await toApiError(res);
      if (err.isUnauthorized && path !== "/auth/login") {
        this.csrf = null;
        this.onUnauthorized?.();
      }
      throw err;
    }
    if (asBlob) return (await res.blob()) as T;
    return (await res.json()) as T;
  }

  private keep = (s: Session) => {
    this.csrf = s.csrfToken;
    return s;
  };

  login: C["login"] = (username, password) => this.request<Session>("POST", "/auth/login", { username, password }).then(this.keep);
  session: C["session"] = () => this.request<Session>("GET", "/auth/session").then(this.keep);
  logout: C["logout"] = async () => {
    await this.request("POST", "/auth/logout", {});
    this.csrf = null;
  };

  datasets: C["datasets"] = (page = 1, pageSize = 50) => this.request("GET", `/datasets${qs({ page, pageSize })}`);
  scripts: C["scripts"] = (kind, page = 1, pageSize = 200) => this.request("GET", `/scripts${qs({ kind, page, pageSize })}`);
  script: C["script"] = (id) => this.request("GET", `/scripts/${enc(id)}`);
  scriptContracts: C["scriptContracts"] = () => this.request("GET", "/script-contracts");
  createScript: C["createScript"] = (body) => this.request("POST", "/scripts", body);
  updateScript: C["updateScript"] = (id, body) => this.request("PATCH", `/scripts/${enc(id)}`, body);
  executeScript: C["executeScript"] = (body) => this.request("POST", "/script-executions", body);
  scriptExecution: C["scriptExecution"] = (id) => this.request("GET", `/script-executions/${enc(id)}`);

  configurations: C["configurations"] = (page = 1, pageSize = 50) => this.request("GET", `/configurations${qs({ page, pageSize })}`);
  configuration: C["configuration"] = (id) => this.request("GET", `/configurations/${enc(id)}`);
  createConfiguration: C["createConfiguration"] = (body) => this.request("POST", "/configurations", body);
  updateConfiguration: C["updateConfiguration"] = (id, body) => this.request("PATCH", `/configurations/${enc(id)}`, body);

  startRun: C["startRun"] = (configurationId) => this.request("POST", "/runs", { configurationId });
  runs: C["runs"] = (page = 1, pageSize = 50) => this.request("GET", `/runs${qs({ page, pageSize })}`);
  run: C["run"] = (id) => this.request("GET", `/runs/${enc(id)}`);
  runLogs: C["runLogs"] = (id, after, limit = 200) => this.request("GET", `/runs/${enc(id)}/logs${qs({ after, limit })}`);

  summary: C["summary"] = (id) => this.request("GET", `/runs/${enc(id)}/summary`);
  dimensions: C["dimensions"] = (id) => this.request("GET", `/runs/${enc(id)}/dimensions`);
  pivot: C["pivot"] = (id, q) => this.request("POST", `/runs/${enc(id)}/pivot/query`, q);
  applications: C["applications"] = (id, q) => this.request("POST", `/runs/${enc(id)}/applications/query`, q);
  application: C["application"] = (id, appId) => this.request("GET", `/runs/${enc(id)}/applications/${enc(appId)}`);
  attributes: C["attributes"] = (id, appId, q) =>
    this.request("POST", `/runs/${enc(id)}/applications/${enc(appId)}/attributes/query`, q);
  raw: C["raw"] = (id, appId, source) => this.request("GET", `/runs/${enc(id)}/applications/${enc(appId)}/raw${qs({ source })}`);

  checkResults: C["checkResults"] = (id, page = 1, pageSize = 200) =>
    this.request("GET", `/runs/${enc(id)}/check-results${qs({ page, pageSize })}`);
  executeCheck: C["executeCheck"] = (id, body) => this.request("POST", `/runs/${enc(id)}/check-executions`, body);
  checkExecution: C["checkExecution"] = (id, executionId) =>
    this.request("GET", `/runs/${enc(id)}/check-executions/${enc(executionId)}`);
  aiReview: C["aiReview"] = (id) => this.request("GET", `/runs/${enc(id)}/ai-review`);

  reportUrl: C["reportUrl"] = (id) => `${this.base}/runs/${enc(id)}/report`;
  downloadReport: C["downloadReport"] = (id) => this.request<Blob>("GET", `/runs/${enc(id)}/report.html`, undefined, true);
}
