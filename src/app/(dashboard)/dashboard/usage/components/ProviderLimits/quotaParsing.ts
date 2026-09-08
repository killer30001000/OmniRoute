import { getModelsByProviderId } from "@omniroute/open-sse/config/providerModels.ts";
import { safePercentage } from "@/shared/utils/formatting";

const GLM_QUOTA_ORDER: Record<string, number> = { session: 0, weekly: 1, mcp_monthly: 2 };
const CODEX_QUOTA_ORDER: Record<string, number> = {
  session: 0,
  weekly: 1,
  gpt_5_3_codex_spark_session: 2,
  gpt_5_3_codex_spark_weekly: 3,
  banked_reset_credits: 4,
};
const GLM_FAMILY_PROVIDERS = ["glm", "glm-cn", "glmt", "opencode-go"];
const KIMI_CODING_PROVIDERS = ["kimi-coding", "kimi-coding-apikey"];

/**
 * Providers whose quotas get a deterministic fixed-window order below
 * (Codex, GLM family, Kimi Coding). Display layers (e.g. QuotaCardExpanded)
 * must not re-sort by remaining percentage, undoing the order (#6687).
 */
export function hasFixedQuotaOrder(providerId: string | undefined): boolean {
  const id = String(providerId || "").toLowerCase();
  return id === "codex" || GLM_FAMILY_PROVIDERS.includes(id) || KIMI_CODING_PROVIDERS.includes(id);
}

/**
 * Canonical chronological rank of a rolling usage window, derived from
 * the quota key itself rather than from a provider list.
 *
 * Providers name the same two windows in mutually incompatible ways — e.g.
 * `"session (5h)"` (claude, minimax, kimi), `"5 Hours Quota"` (GLM/zai),
 * `"five_hour"` (command-code, qwen-token-plan), `"code_5h"` (kimi-coding),
 * plain `"session"` (codex) — so matching on the shape of the key is the only
 * thing that generalizes. Returns `null` for anything that is not a recognizable
 * time window (per-model buckets, credit balances, token counters), which is
 * what keeps this from claiming quotas it has no opinion about.
 */
export function quotaWindowRank(name: unknown): number | null {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  // Order matters: "mcp_monthly" must not be caught by the weekly probe, and
  // "5 Hours Quota" must not be caught by anything before the session probe.
  if (/month/.test(key)) return 2;
  if (/week|7\s*d\b|_7d\b|seven[_\s-]?day/.test(key)) return 1;
  if (/session|hour|\b5\s*h\b|_5h\b/.test(key)) return 0;
  return null;
}