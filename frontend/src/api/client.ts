import type {
  AiReview,
  ApplicationDetail,
  ApplicationsPage,
  ApplicationsQuery,
  AttributesQuery,
  CheckExecution,
  CheckResultsPage,
  ComparisonRow,
  Configuration,
  ConfigurationBody,
  Dataset,
  Dimension,
  LogPage,
  NewScript,
  Page,
  PivotQuery,
  PivotResult,
  RawDocument,
  Run,
  Script,
  ScriptContract,
  ScriptExecution,
  ScriptKind,
  Session,
  Source,
  Summary,
} from "./types";

/** Ошибка API в форме контракта {error:{code,message,details}}; status=0 — сеть недоступна. */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isNotReady() {
    return this.status === 409 && this.code === "REPORT_NOT_READY";
  }
  get isDrilldownExpired() {
    return this.status === 409 && this.code === "DRILLDOWN_EXPIRED";
  }
}

export type ApiMode = "real" | "mock";

/** Единый интерфейс доступа к серверу. Компоненты не знают, какая реализация используется. */
export interface ApiClient {
  readonly mode: ApiMode;
  /** Вызывается при любом 401, чтобы приложение вернуло пользователя ко входу. */
  onUnauthorized?: () => void;

  login(username: string, password: string): Promise<Session>;
  session(): Promise<Session>;
  logout(): Promise<void>;

  datasets(page?: number, pageSize?: number): Promise<Page<Dataset>>;
  scripts(kind?: ScriptKind, page?: number, pageSize?: number): Promise<Page<Script>>;
  script(id: string): Promise<Script>;
  scriptContracts(): Promise<{ items: ScriptContract[] }>;
  createScript(body: NewScript): Promise<Script>;
  updateScript(id: string, body: Partial<Pick<Script, "name" | "code" | "params">>): Promise<Script>;
  executeScript(body: { scriptId: string; params: Record<string, unknown>; datasetId?: string; runId?: string }): Promise<{ executionId: string }>;
  scriptExecution(id: string): Promise<ScriptExecution>;

  configurations(page?: number, pageSize?: number): Promise<Page<Configuration>>;
  configuration(id: string): Promise<Configuration>;
  createConfiguration(body: ConfigurationBody): Promise<Configuration>;
  updateConfiguration(id: string, body: Partial<ConfigurationBody>): Promise<Configuration>;

  startRun(configurationId: string): Promise<{ id: string; status: "QUEUED" }>;
  runs(page?: number, pageSize?: number): Promise<Page<Run>>;
  run(id: string): Promise<Run>;
  runLogs(id: string, after: number, limit?: number): Promise<LogPage>;

  summary(runId: string): Promise<Summary>;
  dimensions(runId: string): Promise<{ items: Dimension[] }>;
  pivot(runId: string, q: PivotQuery): Promise<PivotResult>;
  applications(runId: string, q: ApplicationsQuery): Promise<ApplicationsPage>;
  application(runId: string, appId: string): Promise<ApplicationDetail>;
  attributes(runId: string, appId: string, q: AttributesQuery): Promise<Page<ComparisonRow>>;
  raw(runId: string, appId: string, source: Source): Promise<RawDocument>;

  checkResults(runId: string, page?: number, pageSize?: number): Promise<CheckResultsPage>;
  executeCheck(runId: string, body: { scriptId: string; params: Record<string, unknown> }): Promise<{ executionId: string }>;
  checkExecution(runId: string, executionId: string): Promise<CheckExecution>;
  aiReview(runId: string): Promise<AiReview>;
  regenerateAiReview(runId: string): Promise<{ executionId: string }>;

  /** URL документа для открытия в новой вкладке (сессия браузера передаётся cookie). */
  reportUrl(runId: string): string;
  /** Скачивает HTML; ошибка HTTP не сохраняется как файл. */
  downloadReport(runId: string): Promise<Blob>;
}
