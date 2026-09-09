import { getProviderConnectionById } from "@/lib/db/providers";
import { parseSAFromApiKey, isExpressApiKey, getAccessToken } from "../../executors/vertex";

export interface GcpCreditAutoConfig {
  enabled?: boolean;
  queryProjectId?: string;
  datasetId?: string;
  tableId?: string;
  creditId?: string;
  creditNameContains?: string;
  baseline?: {
    remaining?: number;
    asOf?: string;
  };
}

export async function fetchBigQueryCreditDelta(
  connectionId: string,
  autoConfig: GcpCreditAutoConfig
): Promise<number | null> {
  if (
    !autoConfig.enabled ||
    !autoConfig.queryProjectId ||
    !autoConfig.datasetId ||
    !autoConfig.tableId ||
    !autoConfig.baseline?.asOf
  ) {
    return null; // Missing required config
  }

  try {
    const connection = (await getProviderConnectionById(connectionId)) as Record<string, unknown>;
    if (!connection || !connection.apiKey || isExpressApiKey(connection.apiKey)) {
      return null;
    }

    const sa = parseSAFromApiKey(connection.apiKey);
    const accessToken = await getAccessToken(sa);

    // Validate identifiers to prevent basic injection
    const isValidIdentifier = (id: string) => /^[a-zA-Z0-9_.-]+$/.test(id);
    if (
      !isValidIdentifier(autoConfig.queryProjectId) ||
      !isValidIdentifier(autoConfig.datasetId) ||
      !isValidIdentifier(autoConfig.tableId)
    ) {
      console.warn("[Vertex BigQuery] Invalid dataset/table identifiers");
      return null;
    }

    // Build query
    let creditFilter = "c.type = 'PROMOTION'";
    const queryParams: Record<string, unknown>[] = [
      {
        name: "asOf",
        parameterType: { type: "TIMESTAMP" },
        parameterValue: { value: autoConfig.baseline.asOf },
      },
    ];

    if (autoConfig.creditId && autoConfig.creditId.trim().length > 0) {
      creditFilter += " AND c.id = @creditId";
      queryParams.push({
        name: "creditId",
        parameterType: { type: "STRING" },
        parameterValue: { value: autoConfig.creditId.trim() },
      });
    } else if (autoConfig.creditNameContains && autoConfig.creditNameContains.trim().length > 0) {
      creditFilter += " AND c.full_name LIKE @creditName";
      queryParams.push({
        name: "creditName",
        parameterType: { type: "STRING" },
        parameterValue: { value: `%${autoConfig.creditNameContains.trim()}%` },
      });
    }

    const sql = `
      SELECT SUM(c.amount) as applied_credit
      FROM \`${autoConfig.queryProjectId}.${autoConfig.datasetId}.${autoConfig.tableId}\`,
      UNNEST(credits) AS c
      WHERE ${creditFilter}
      AND usage_start_time >= @asOf
    `;

    const requestBody = {
      query: sql,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters: queryParams,
    };

    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${autoConfig.queryProjectId}/queries`;

    // Add simple timeout using AbortController (fetch API standard)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Vertex BigQuery] API error ${res.status}: ${errText}`);
      return null; // Fallback to baseline
    }

    const data = await res.json();

    if (!data.rows || data.rows.length === 0 || !data.rows[0].f || data.rows[0].f.length === 0) {
      // Null sum (no credits matching found)
      return 0;
    }

    const sumVal = data.rows[0].f[0].v;
    if (sumVal === null) return 0;

    const sumNumber = Number(sumVal);
    if (!Number.isFinite(sumNumber)) return 0;

    // In BigQuery billing, credits offset costs and are NEGATIVE amounts.
    // E.g. -$10.00. So we take Math.abs() to get the positive applied amount.
    return Math.abs(sumNumber);
  } catch (error: unknown) {
    console.warn(`[Vertex BigQuery] Fetch error: ${error?.message}`);
    return null;
  }
}
