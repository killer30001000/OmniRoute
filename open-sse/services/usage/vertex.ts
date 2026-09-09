import { parseResetTime, type UsageQuota } from "./quota.ts";

/**
 * usage/vertex.ts — Vertex self-tracked spend usage fetcher.
 *
 * Extracted from services/usage.ts (god-file decomposition) for the Vertex family:
 *   Vertex exposes no usage/quota API for either API key or Service Account, so
 *   OmniRoute self-tracks USD spent through the connection (summed via
 *   `usage_history` by getConnectionSpendUsdSinceAdded) and surfaces a `spend`
 *   quota entry plus a `$X used · N requests` message. Depends only on the
 *   sibling scalar/quota leaves and usageStats (dynamic import) so host
 *   coupling lives at the co-located provider leaf. usage.ts imports
 *   getVertexUsage (dispatcher + __testing). Behavior-preserving move.
 *
 * Private extension (local/vertex-gcp-credit-balance): when the connection
 * carries an explicit `providerSpecificData.gcpCredit` block (private Google
 * Cloud Welcome / promotional credit balance supplied by the operator), an
 * additional `google_cloud_credit` quota entry is emitted alongside `spend`.
 * No Google Cloud Billing API is called — `cloudbilling.googleapis.com` does
 * not expose remaining-credit fields (see PR notes). Operator-supplied values
 * flow through the same meter/credits parser branch as the OpenRouter PAYG
 * fix (#12468), so positive denominators render a percentage bar and missing
 * or non-positive denominators render a USD-only row.
 */

import { fetchBigQueryCreditDelta, type GcpCreditAutoConfig } from "./vertexGcpCreditBigQuery.ts";
type JsonRecord = Record<string, unknown>;
type GcpCreditConfig = {
  total?: unknown;
  remaining?: unknown;
  expiresAt?: unknown;
  currency?: unknown;
  auto?: GcpCreditAutoConfig;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function buildGcpCreditQuota(
  connectionId: string,
  config: GcpCreditConfig | null | undefined
): Promise<UsageQuota | null> {
  if (!config || typeof config !== "object") {
    return null;
  }

  let remaining = asFiniteNumber(config.remaining);
  let source = "config";

  if (config.auto?.enabled && config.auto.baseline?.remaining !== undefined) {
    const baselineRemaining = asFiniteNumber(config.auto.baseline.remaining);
    if (baselineRemaining !== null && baselineRemaining >= 0) {
      const delta = await fetchBigQueryCreditDelta(connectionId, config.auto);
      if (delta !== null) {
        remaining = Math.max(0, baselineRemaining - delta);
        source = "bigquery";
      } else {
        remaining = asFiniteNumber(config.remaining) ?? baselineRemaining;
      }
    }
  }

  if (remaining === null || remaining < 0) {
    return null;
  }

  const totalRaw = asFiniteNumber(config.total);
  const total = totalRaw !== null && totalRaw >= 0 ? totalRaw : 0;
  const used = total > 0 ? Math.max(0, total - remaining) : 0;
  const resetAt = parseResetTime(config.expiresAt);
  const currency =
    typeof config.currency === "string" && config.currency.trim() !== ""
      ? config.currency.trim().toUpperCase()
      : "USD";

  const creditDetails =
    source === "bigquery" ? [{ name: "Source", value: "BigQuery Auto Refresh" }] : undefined;

  return {
    used,
    total,
    remaining,
    ...(total > 0
      ? {
          remainingPercentage: Math.max(0, Math.min(100, Math.round((remaining / total) * 100))),
        }
      : {}),
    resetAt,
    unlimited: false,
    displayName: "Google Cloud Credit",
    quotaSource: "gcpCreditConfig",
    currency,
    details: creditDetails,
  };
}

/**
 * Vertex SELF-TRACKED spend, plus optional operator-supplied GCP credit balance.
 *
 * Vertex exposes no usage/quota API for API key or Service Account (billing/credit
 * balance lives behind Cloud Billing API, which the proxy credential can't reach).
 * Instead, report USD OmniRoute has spent through the connection since the
 * account was added, summed from `usage_history` against the priced backend
 * pricing table. Returns `message` (with the figure) plus a `spend` quota entry
 * so the limits cache persists a non-message-only result (message-only results
 * are treated as transient errors and not cached). When
 * `providerSpecificData.gcpCredit` is present, an additional `google_cloud_credit`
 * quota is emitted with the operator-supplied total/remaining/expiresAt values.
 */
export async function getVertexUsage(
  connectionId: string,
  provider: string,
  providerSpecificData?: Record<string, unknown> | null
) {
  if (!connectionId) return { message: "Vertex connected. Connection unavailable usage tracking." };

  const gcpCreditQuota = await buildGcpCreditQuota(
    connectionId,
    providerSpecificData?.gcpCredit as GcpCreditConfig | undefined
  );

  try {
    const { getConnectionSpendUsdSinceAdded } = await import("@/lib/usage/usageStats");
    const { costUsd, requests } = await getConnectionSpendUsdSinceAdded(provider, connectionId);

    const spend: JsonRecord = {
      used: Number(costUsd.toFixed(6)),
      displayName: "Spend (USD)",
      quotaSource: "localUsageHistory",
      resetAt: null,
      unlimited: false,
    };

    const quotas: Record<string, JsonRecord> = { spend };
    if (gcpCreditQuota) quotas.google_cloud_credit = gcpCreditQuota as JsonRecord;

    if (requests === 0) {
      return {
        plan: "Vertex AI",
        message: "Vertex connected. No usage recorded through OmniRoute account.",
        quotas,
      };
    }

    const costStr = costUsd < 1 ? costUsd.toFixed(4) : costUsd.toFixed(2);
    return {
      plan: "Vertex AI",
      message: `$${costStr} since account added · ${requests} request${requests === 1 ? "" : "s"}`,
      quotas,
    };
  } catch (error) {
    return { message: `Vertex usage tracking error: ${(error as Error).message}` };
  }
}
