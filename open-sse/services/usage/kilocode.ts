/** usage/kilocode.ts Kilo Code balance usage fetcher (Provider Limits). GET
 * `{KILO_API_URL|https://api.kilo.ai}/api/profile/balance` with the existing
 * kilocode OAuth access token; personal (non-organization) balance only, no
 * KiloPass/subscription data. Surfaces the USD balance as a single credits-style
 * `quotas.balance` entry (remaining = exact dollar amount, isCredits-style
 * display), mirroring the AgentRouter/DeepSeek balance conventions.
 *
 * Design notes:
 * - No separate organization scope: uses the token's default (personal) scope.
 * - Anonymous/no-auth kilocode connections (`Bearer anonymous` free tier) have no
 *   balance endpoint access; those are reported with a clear message and never
 *   issue an upstream balance request.
 * - Failures (no credential, HTTP error, timeout, network, malformed body,
 *   missing/non-numeric balance) return `{ message }` so the dashboard renders a
 *   graceful per-row status instead of crashing.
 */
import type { UsageQuota } from "./quota.ts";
import { toRecord, toNumber, roundCurrency } from "./scalars.ts";

/** Upstream API base. Environment override mirrors sibling fetchers. */
const KILO_API_BASE: string = process.env.KILO_API_URL || "https://api.kilo.ai";
const BALANCE_PATH = "/api/profile/balance";
const BALANCE_URL = `${KILO_API_BASE}${BALANCE_PATH}`;

const KILO_EDITOR_NAME = "OmniRoute";

/** Fallback token used by Kilo's anonymous free tier (registry anonymousApiKey).
 * Balance is only available to authenticated accounts, so this value is
 * rejected before any request is made. */
const KILO_ANONYMOUS_TOKEN = "anonymous";

function readAccessToken(connection: Record<string, unknown>): string | null {
  const value = connection["accessToken"];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function isAnonymousToken(token: string): boolean {
  return token.trim() === KILO_ANONYMOUS_TOKEN;
}

/** Extract a non-negative USD balance from the upstream JSON body. Returns null
 * when the value is missing, null, negative, or not numeric. */
export function parseKilocodeBalance(data: unknown): number | null {
  const obj = toRecord(data);
  if (obj.balance === undefined || obj.balance === null) {
    return null;
  }
  const balance = toNumber(obj.balance, Number.NaN);
  if (!Number.isFinite(balance) || balance < 0) {
    return null;
  }
  return roundCurrency(balance);
}

/** Build the normalized usage response for a successful balance fetch. */
export function buildKilocodeUsageResult(balance: number): {
  plan: string;
  quotas: Record<string, UsageQuota>;
} {
  const balanceQuota: UsageQuota = {
    used: 0,
    total: 0,
    remaining: balance,
    remainingPercentage: balance > 0 ? 100 : 0,
    resetAt: null,
    unlimited: true,
    currency: "USD",
    displayName: "Balance (USD)",
  };
  return {
    plan: "Kilo Code",
    quotas: { balance: balanceQuota },
  };
}

/** Fetch and normalize Kilo Code balance usage for a connection. */
export async function getKilocodeUsage(
  _connectionId: string | undefined,
  connection?: Record<string, unknown>
): Promise<
  { plan: string; quotas: Record<string, UsageQuota> } | { plan: string; message: string }
> {
  const token = connection ? readAccessToken(connection) : null;
  if (connection?.["apiKey"] !== undefined && !token) {
    return {
      plan: "Kilo Code",
      message:
        "Kilo Code balance uses the Kilo Code OAuth account; a separate API key is not supported.",
    };
  }
  if (!token) {
    return {
      plan: "Kilo Code",
      message: "Kilo Code balance not available. Add a Kilo Code account to view usage.",
    };
  }
  if (isAnonymousToken(token)) {
    return {
      plan: "Kilo Code",
      message:
        "Kilo Code balance is only available for authenticated accounts. Free anonymous usage has no balance.",
    };
  }

  try {
    const response = await fetch(BALANCE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-KILOCODE-EDITORNAME": KILO_EDITOR_NAME,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status === 401 || response.status === 403) {
      return {
        plan: "Kilo Code",
        message: "Kilo Code token expired or access denied. Please re-authenticate the connection.",
      };
    }
    if (response.status === 429) {
      return {
        plan: "Kilo Code",
        message: "Kilo Code balance request was rate limited. Try again later.",
      };
    }
    if (!response.ok) {
      return {
        plan: "Kilo Code",
        message: `Kilo Code balance request failed with HTTP ${response.status}.`,
      };
    }

    const data: unknown = await response.json();
    const balance = parseKilocodeBalance(data);
    if (balance === null) {
      return {
        plan: "Kilo Code",
        message: "Kilo Code balance response was invalid or missing a balance value.",
      };
    }
    return buildKilocodeUsageResult(balance);
  } catch (error) {
    return {
      plan: "Kilo Code",
      message: `Kilo Code balance error: ${(error as Error).message}`,
    };
  }
}
