import { getProviderConnectionById } from "@/lib/db/providers";
import { parseSAFromApiKey, isExpressApiKey, getAccessToken } from "../../executors/vertex";
import logger from "../../utils/logger";

const bqLog = logger("VERTEX-BQ");

export interface GcpCreditAutoConfig {
  enabled?: boolean;
  queryProjectId?: string;
  datasetId?: string;
  tableId?: string;
  creditId?: string;
  creditNameContains?: string;
  location?: string;
  maxBytesBilled?: number;
  baseline?: {
    remaining?: number;
    asOf?: string;
  };
}

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const IDENTIFIER_MAX_LEN = 1024;
const STRING_PARAM_MAX_LEN = 512;

const TOTAL_BUDGET_MS = 8000;
const POLL_INTERVAL_MS = 50;
const MAX_POLLS = 6;
const DEFAULT_MAX_BYTES_BILLED = 100 * 1024 * 1024;

type SafeMetadata = Record<string, unknown>;

function isValidIdentifier(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= IDENTIFIER_MAX_LEN &&
    IDENTIFIER_PATTERN.test(id)
  );
}

function sanitizeStringParam(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > STRING_PARAM_MAX_LEN) {
    return null;
  }
  return trimmed;
}

interface BqQueryResponse {
  jobComplete?: boolean;
  jobReference?: {
    projectId?: string;
    jobId?: string;
    location?: string;
  };
  rows?: Array<{ f?: Array<{ v?: string | null }> }>;
  schema?: unknown;
  errors?: Array<{ message?: string; reason?: string }>;
}

function parseAppliedSum(data: BqQueryResponse): number | null {
  if (!data.rows || data.rows.length === 0) {
    return 0;
  }
  const row = data.rows[0];
  if (!row.f || row.f.length === 0) {
    return 0;
  }
  const v = row.f[0].v;
  if (v === null || v === undefined) {
    return 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

interface BudgetState {
  controller: AbortController;
  startedAt: number;
}

function remainingBudget(state: BudgetState): number {
  return TOTAL_BUDGET_MS - (Date.now() - state.startedAt);
}

async function postJson(
  url: string,
  accessToken: string,
  body: unknown,
  state: BudgetState
): Promise<Response | null> {
  const remaining = remainingBudget(state);
  if (remaining <= 0) {
    return null;
  }
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: state.controller.signal,
    });
  } catch {
    return null;
  }
}

async function getJson(
  url: string,
  accessToken: string,
  state: BudgetState
): Promise<Response | null> {
  const remaining = remainingBudget(state);
  if (remaining <= 0) {
    return null;
  }
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + accessToken,
      },
      signal: state.controller.signal,
    });
  } catch {
    return null;
  }
}

function buildSql(autoConfig: GcpCreditAutoConfig): {
  sql: string;
  queryParameters: Record<string, unknown>[];
  ok: boolean;
} {
  const asOf = sanitizeStringParam(autoConfig.baseline?.asOf);
  if (!asOf) {
    return { sql: "", queryParameters: [], ok: false };
  }

  let creditFilter = "c.type = @promotionType";
  const queryParameters: Record<string, unknown>[] = [
    {
      name: "promotionType",
      parameterType: { type: "STRING" },
      parameterValue: { value: "PROMOTION" },
    },
    {
      name: "asOf",
      parameterType: { type: "TIMESTAMP" },
      parameterValue: { value: asOf },
    },
  ];

  const creditId = sanitizeStringParam(autoConfig.creditId);
  const creditName = sanitizeStringParam(autoConfig.creditNameContains);

  if (creditId) {
    creditFilter += " AND c.id = @creditId";
    queryParameters.push({
      name: "creditId",
      parameterType: { type: "STRING" },
      parameterValue: { value: creditId },
    });
  } else if (creditName) {
    creditFilter += " AND c.full_name LIKE @creditName";
    queryParameters.push({
      name: "creditName",
      parameterType: { type: "STRING" },
      parameterValue: { value: "%" + creditName + "%" },
    });
  } else {
    return { sql: "", queryParameters: [], ok: false };
  }

  const sql =
    "\nSELECT\n  SUM(c.amount) as applied_credit\nFROM\n  \`" +
    autoConfig.queryProjectId +
    "." +
    autoConfig.datasetId +
    "." +
    autoConfig.tableId +
    "\`,\n  UNNEST(credits) as c\nWHERE " +
    creditFilter +
    "\n  AND usage_start_time >= @asOf\n";

  return { sql: sql, queryParameters: queryParameters, ok: true };
}

export async function fetchBigQueryCreditDelta(
  connectionId: string,
  autoConfig: GcpCreditAutoConfig
): Promise<number | null> {
  if (!autoConfig.enabled || !autoConfig.baseline?.asOf) {
    return null;
  }

  if (
    !isValidIdentifier(autoConfig.queryProjectId) ||
    !isValidIdentifier(autoConfig.datasetId) ||
    !isValidIdentifier(autoConfig.tableId)
  ) {
    bqLog.warn("vertex.bq.invalid_identifier", {
      category: "invalid_identifier",
    } as SafeMetadata);
    return null;
  }

  const configLocation = sanitizeStringParam(autoConfig.location);
  const maxBytesBilled =
    typeof autoConfig.maxBytesBilled === "number" &&
    Number.isFinite(autoConfig.maxBytesBilled) &&
    autoConfig.maxBytesBilled > 0
      ? Math.floor(autoConfig.maxBytesBilled)
      : DEFAULT_MAX_BYTES_BILLED;

  const built = buildSql(autoConfig);
  if (!built.ok) {
    bqLog.warn("vertex.bq.missing_identity", {
      category: "missing_identity",
    } as SafeMetadata);
    return null;
  }

  const state: BudgetState = {
    controller: new AbortController(),
    startedAt: Date.now(),
  };
  const timeoutId = setTimeout(function () {
    state.controller.abort();
  }, TOTAL_BUDGET_MS);
  if (timeoutId.unref) {
    timeoutId.unref();
  }

  let accessToken: string;
  try {
    const connection = (await getProviderConnectionById(connectionId)) as {
      apiKey?: string | null;
    } | null;
    if (!connection?.apiKey || isExpressApiKey(connection.apiKey)) {
      return null;
    }
    const sa = parseSAFromApiKey(connection.apiKey);
    accessToken = await getAccessToken(sa);
  } catch {
    bqLog.warn("vertex.bq.token_failure", {
      category: "token_failure",
    } as SafeMetadata);
    return null;
  }

  try {
    const queryUrl =
      "https://bigquery.googleapis.com/bigquery/v2/projects/" +
      autoConfig.queryProjectId +
      "/queries";
    const queryBody = {
      query: built.sql,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters: built.queryParameters,
      maximumBytesBilled: String(maxBytesBilled),
    };

    const initialRes = await postJson(queryUrl, accessToken, queryBody, state);
    if (!initialRes) {
      bqLog.warn("vertex.bq.initial_request_failed", {
        category: "initial_request_failed",
      } as SafeMetadata);
      return null;
    }

    if (!initialRes.ok) {
      bqLog.warn("vertex.bq.initial_http_error", {
        category: "initial_http_error",
        status: initialRes.status,
      } as SafeMetadata);
      return null;
    }

    let data = (await initialRes.json()) as BqQueryResponse;

    let polls = 0;
    while (data.jobComplete === false && polls < MAX_POLLS) {
      if (remainingBudget(state) <= 0) {
        bqLog.warn("vertex.bq.budget_exhausted", {
          category: "budget_exhausted",
        } as SafeMetadata);
        return null;
      }

      const jobRef = data.jobReference;
      if (!jobRef?.projectId || !jobRef.jobId) {
        bqLog.warn("vertex.bq.malformed_job_reference", {
          category: "malformed_job_reference",
        } as SafeMetadata);
        return null;
      }

      const location = sanitizeStringParam(jobRef.location) ?? configLocation ?? undefined;
      const locationQuery = location ? "?location=" + encodeURIComponent(location) : "";
      const pollUrl =
        "https://bigquery.googleapis.com/bigquery/v2/projects/" +
        encodeURIComponent(jobRef.projectId) +
        "/queries/" +
        encodeURIComponent(jobRef.jobId) +
        locationQuery;

      await new Promise(function (r) {
        const t = setTimeout(r, POLL_INTERVAL_MS);
        if (t.unref) t.unref();
      });

      if (remainingBudget(state) <= 0) {
        return null;
      }

      const pollRes = await getJson(pollUrl, accessToken, state);
      if (!pollRes) {
        bqLog.warn("vertex.bq.poll_request_failed", {
          category: "poll_request_failed",
        } as SafeMetadata);
        return null;
      }

      if (!pollRes.ok) {
        bqLog.warn("vertex.bq.poll_http_error", {
          category: "poll_http_error",
          status: pollRes.status,
        } as SafeMetadata);
        return null;
      }

      data = (await pollRes.json()) as BqQueryResponse;
      polls += 1;
    }

    if (data.jobComplete === false) {
      bqLog.warn("vertex.bq.poll_exhausted", {
        category: "poll_exhausted",
        polls: polls,
      } as SafeMetadata);
      return null;
    }

    const signedSum = parseAppliedSum(data);
    if (signedSum === null) {
      bqLog.warn("vertex.bq.malformed_result", {
        category: "malformed_result",
      } as SafeMetadata);
      return null;
    }

    // Credit rows in Cloud Billing export are stored as negative
    // offsets against cost. A correction/remonetization row can
    // flip the sign within the same credit-id, so the SUM may be
    // negative, positive, or zero. abs(SUM) (rather than SUM(abs))
    // preserves net semantics that match "credit consumed since
    // baseline".
    return Math.abs(signedSum);
  } finally {
    clearTimeout(timeoutId);
  }
}
