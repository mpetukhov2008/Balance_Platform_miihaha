// DTO по contracts/API_CONTRACT.md (v0.1). Имена предметных полей — как в контракте.

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export type Session = { user: { id: string; username: string }; csrfToken: string };

export type Dataset = {
  id: string;
  name: string;
  kind: "SAMPLES" | "FULL" | "CUSTOM";
  status: "READY" | "UNAVAILABLE";
  appCount: number | null;
  description: string;
};

export type DatasetUploadOptions = {
  maxArchiveBytes: number;
  maxExpandedBytes: number;
  maxPairs: number;
  maxDatasets: number;
};

export type ScriptKind = "NORMALIZE" | "COMPARE" | "AGGREGATE" | "CHECK";
export const SCRIPT_KINDS: ScriptKind[] = ["NORMALIZE", "COMPARE", "AGGREGATE", "CHECK"];

export type Script = {
  id: string;
  name: string;
  kind: ScriptKind;
  sourceType: "WORKSPACE" | "FILE";
  code: string;
  filename: string | null;
  params: Record<string, unknown>;
  updatedAt: string;
  contractId: string;
  checkId: string | null;
};

export type ScriptContract = {
  id: string;
  kind: ScriptKind;
  description: string;
  inputDescription: string;
  outputDescription: string;
  template: string;
};

export type NewScript = {
  name: string;
  kind: ScriptKind;
  sourceType: "WORKSPACE";
  code: string;
  params: Record<string, unknown>;
  contractId: string;
};

export type ExecStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ScriptExecution = {
  id: string;
  status: ExecStatus;
  stdout: string;
  stderr: string;
  diagnostics: Record<string, unknown>[];
  previewRows: Record<string, unknown>[];
  truncated: boolean;
  error: string | null;
};

export type Binding = { scriptId: string; params: Record<string, unknown> };

export type ConfigurationBody = {
  name: string;
  datasetId: string;
  normalizer: Binding;
  comparator: Binding;
  aggregator: Binding;
  checks: Binding[];
  aiReviewEnabled: boolean;
};

export type Configuration = ConfigurationBody & { id: string; createdAt: string; updatedAt: string };

export type RunStatus = ExecStatus;
export type StageKey = "NORMALIZE" | "UNION" | "COMPARE" | "AGGREGATE" | "CHECKS" | "AI_REVIEW" | "PUBLISH";
export const STAGE_KEYS: StageKey[] = ["NORMALIZE", "UNION", "COMPARE", "AGGREGATE", "CHECKS", "AI_REVIEW", "PUBLISH"];
export type StageStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export type Stage = {
  key: StageKey;
  status: StageStatus;
  processed: number | null;
  total: number | null;
  scriptId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type Run = {
  id: string;
  configurationId: string;
  datasetId: string;
  datasetName: string;
  status: RunStatus;
  reportReady: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stages: Stage[];
  error: string | null;
};

export type LogEntry = {
  cursor: number;
  time: string;
  stageKey: StageKey | null;
  level: "INFO" | "WARNING" | "ERROR";
  message: string;
  scriptId: string | null;
};

export type LogPage = { items: LogEntry[]; nextCursor: number; hasMore: boolean };

export type Summary = {
  totalApps: number | null;
  changedApps: number | null;
  decisionChangedApps: number | null;
  decisionTransitions: { before: string | null; after: string | null; count: number }[];
  topChangedAttributes: { PATH: string; changedApps: number }[];
  externalDriftDecisionApps: number | null;
  timingsMs: Partial<Record<StageKey, number>>;
  computedAt: string;
};

export type Dimension = {
  name: string;
  label: string;
  type: "string" | "number" | "boolean";
  canGroup: boolean;
  canFilter: boolean;
};

export type Scalar = string | number | boolean | null;
export type Filter = { field: string; op: "eq" | "in"; value: Scalar | Scalar[] };

export type PivotQuery = {
  rows: string[];
  columns: string[];
  filters: Filter[];
  measure: "SUM_CNT";
  page: number;
  pageSize: number;
};

export type PivotCell = { rowIndex: number; columnIndex: number; value: number; drilldownToken: string | null };

export type PivotResult = {
  rowFields: string[];
  columnFields: string[];
  rowKeys: Scalar[][];
  columnKeys: Scalar[][];
  cells: PivotCell[];
  totalRows: number;
  page: number;
  pageSize: number;
  measure: { id: string; label: string; additive: boolean };
  uniqueApps: number;
};

export type ApplicationsQuery = {
  drilldownToken?: string;
  checkRowId?: string;
  filters?: Filter[];
  page: number;
  pageSize: number;
};

export type ApplicationItem = {
  APP_ID: string;
  DECISION_BEFORE: string | null;
  DECISION_AFTER: string | null;
  DECISION_CHANGED: 0 | 1;
  changedAttributes: number | null;
};

export type ApplicationsPage = Page<ApplicationItem> & {
  scope: "FULL_GROUP" | "CHECK_SAMPLE" | "FILTER";
  matchedAttributes: { PATH: string; ARRAY_KEY: string }[] | null;
};

export type ApplicationDetail = {
  APP_ID: string;
  segments: Record<string, unknown>;
  decisionEvidence: { kind: string; text: string; PATH: string | null; ARRAY_KEY: string | null }[];
  evidenceNote: string;
};

export type ChangeType = "SAME" | "VALUE_CHANGED" | "ATTRIBUTE_NEW" | "ATTRIBUTE_LOST";
export const CHANGE_TYPES: ChangeType[] = ["SAME", "VALUE_CHANGED", "ATTRIBUTE_NEW", "ATTRIBUTE_LOST"];

export type AttributesQuery = {
  diffOnly: boolean;
  path?: string;
  arrayKey?: string;
  drilldownToken?: string;
  page: number;
  pageSize: number;
};

export type ComparisonRow = {
  APP_ID: string;
  PREFIX: string;
  CLASS: string;
  SUFFIX: string;
  ARRAY_KEY: string;
  KEY: string;
  PATH: string;
  VALUE_BEFORE: string;
  VALUE_AFTER: string;
  ADJUSTED_BEFORE: string;
  ADJUSTED_AFTER: string;
  DIFF_FLAG: 0 | 1;
  CHANGE_TYPE: ChangeType;
  presentBefore?: boolean;
  presentAfter?: boolean;
  valueTypeBefore?: string | null;
  valueTypeAfter?: string | null;
};

export type Source = "BEFORE" | "AFTER";
export type RawDocument = { APP_ID: string; SOURCE: Source; document: unknown };

export type CheckResult = {
  rowId: string;
  checkId: string;
  LABEL: string;
  SOURCE: Source;
  ARGUMENT: string;
  CNT: number;
  TOTAL: number;
  METRIC: number | string | null;
  APP_IDS: string[];
  RESULT: "PASS" | "FAIL";
  CONFIDENCE: "HIGH" | "LOW";
};

export type CheckResultsPage = Page<CheckResult> & { reportRevision: number };

export type CheckExecution = { id: string; status: ExecStatus; error: string | null; reportRevision: number | null };

export type AiReview = {
  status: "DISABLED" | "PENDING" | "READY" | "UNAVAILABLE" | "FAILED" | "STALE";
  text: string | null;
  error: string | null;
  generatedAt: string | null;
  reportRevision: number | null;
};
