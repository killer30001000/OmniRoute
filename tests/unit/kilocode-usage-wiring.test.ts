/**
 * Kilo Code usage wiring tests: provider visibility (USAGE_SUPPORTED_PROVIDERS),
 * fetcher registration (USAGE_FETCHER_PROVIDERS), dispatcher routing in
 * getUsageForProvider(), and the Dashboard quota parser (kilocode is rendered
 * through the AgentRouter/USD-credit parser so the exact dollar balance is
 * shown instead of a bare percentage).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.ts";
import { supportsProviderQuota } from "../../src/shared/utils/providerQuotaVisibility.ts";
import { USAGE_FETCHER_PROVIDERS, getUsageForProvider } from "../../open-sse/services/usage.ts";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaParsing.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockBalance(status: number, body: unknown) {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

test("kilocode is registered in USAGE_SUPPORTED_PROVIDERS", () => {
  assert.equal(
    USAGE_SUPPORTED_PROVIDERS.includes("kilocode" as (typeof USAGE_SUPPORTED_PROVIDERS)[number]),
    true
  );
});

test("supportsProviderQuota('kilocode') is true", () => {
  assert.equal(supportsProviderQuota("kilocode"), true);
});

test("kilocode is registered in USAGE_FETCHER_PROVIDERS", () => {
  assert.equal(
    USAGE_FETCHER_PROVIDERS.includes("kilocode" as (typeof USAGE_FETCHER_PROVIDERS)[number]),
    true
  );
});

test("getUsageForProvider dispatches kilocode to the Kilo balance fetcher", async () => {
  mockBalance(200, { balance: 12.34 });

  const usage = (await getUsageForProvider({
    id: "conn-kilo",
    provider: "kilocode",
    accessToken: "oauth-token-123",
  })) as {
    plan?: string;
    quotas?: Record<
      string,
      { remaining?: number; currency?: string; displayName?: string; remainingPercentage?: number }
    >;
    message?: string;
  };

  assert.equal(usage.plan, "Kilo Code");
  assert.ok(usage.quotas);
  const balance = usage.quotas.balance;
  assert.ok(balance, "expected a balance quota entry");
  assert.equal(balance.remaining, 12.34);
  assert.equal(balance.currency, "USD");
  assert.equal(balance.displayName, "Balance (USD)");
  assert.equal(usage.message, undefined);
});

test("kilocode balance quota parses as USD credit row in the Dashboard parser", async () => {
  const usage = {
    plan: "Kilo Code",
    quotas: {
      balance: {
        used: 0,
        total: 0,
        remaining: 12.34,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
        currency: "USD",
        displayName: "Balance (USD)",
      },
    },
  };

  const rows = parseQuotaData("kilocode", usage) as Array<{
    isCredits?: boolean;
    currency?: string;
    creditCount?: number;
    remainingPercentage?: number;
  }>;

  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.isCredits, true, "renderer only formats USD when isCredits is true");
  assert.equal(row.currency, "USD", "renderer looks up CURRENCY_SYMBOLS[q.currency]");
  assert.equal(row.creditCount, 12.34, "renderer displays q.creditCount as the dollar amount");
  assert.equal(row.remainingPercentage, 100, "funded wallet must not read as exhausted");
});
