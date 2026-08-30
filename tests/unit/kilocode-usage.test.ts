/**
 * Kilo Code balance usage fetcher tests.
 *
 * Covers: OAuth-only credential resolution (apiKey is never used as a
 * substitute), anonymous-token rejection, custom KILO_API_URL base,
 * success shapes (including an exact $0 balance), HTTP/network/timeout
 * failures, and malformed payloads. Dispatcher/visibility wiring is
 * asserted in tests/unit/kilocode-usage-wiring.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  getKilocodeUsage,
  parseKilocodeBalance,
  buildKilocodeUsageResult,
} from "../../open-sse/services/usage/kilocode.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

type FetchCall = { url: string; init: RequestInit & { headers?: Record<string, string> } };

/** Install a fetch that records each request and replies with a JSON body. */
type UsageQuotaLike = {
  remaining?: number;
  currency?: string;
  remainingPercentage?: number;
  unlimited?: boolean;
  resetAt?: string | null;
};

function recordFetch(body: unknown, status = 200): Array<FetchCall> {
  const calls: Array<FetchCall> = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

function mockJson(status: number, body: unknown) {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function mockNetworkError() {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
}

function mockTimeout() {
  globalThis.fetch = (async () => {
    const err = new Error("This operation was aborted");
    err.name = "TimeoutError";
    throw err;
  }) as typeof fetch;
}

type UsageLike =
  | { plan: string; message: string; quotas?: undefined }
  | {
      plan: string;
      quotas: Record<
        string,
        {
          remaining?: number;
          currency?: string;
          remainingPercentage?: number;
          unlimited?: boolean;
          resetAt?: string | null;
        }
      >;
      message?: undefined;
    };

const baseConnection = { provider: "kilocode", accessToken: "oauth-token-123" };

test("success: balance 12.34 → correct endpoint, Bearer, editor header, USD credits quota", async () => {
  const calls = recordFetch({ balance: 12.34 });

  const usage = (await getKilocodeUsage("conn-1", baseConnection)) as UsageLike & {
    quotas: Record<string, UsageQuotaLike>;
  };

  assert.equal(usage.plan, "Kilo Code");
  const quota = usage.quotas.balance;
  assert.ok(quota, "expected a balance quota entry");
  assert.equal(quota.remaining, 12.34);
  assert.equal(quota.currency, "USD");
  assert.equal(quota.remainingPercentage, 100);
  assert.equal(quota.resetAt, null);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.kilo.ai/api/profile/balance");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers?.Authorization, "Bearer oauth-token-123");
  assert.equal(calls[0].init.headers?.["X-KILOCODE-EDITORNAME"], "OmniRoute");
});

test("success: exact $0 balance is a valid value, not a missing/invalid response", async () => {
  mockJson(200, { balance: 0 });

  const usage = (await getKilocodeUsage("conn-0", baseConnection)) as UsageLike & {
    quotas: Record<string, UsageQuotaLike>;
  };

  assert.equal(usage.quotas.balance.remaining, 0);
  assert.equal(usage.quotas.balance.remainingPercentage, 0);
  assert.equal(usage.quotas.balance.unlimited, true);
  assert.equal(typeof usage.message, "undefined");
});

test("KILO_API_URL override is used as base URL", async () => {
  const calls = recordFetch({ balance: 5 });
  process.env.KILO_API_URL = "https://kilo.example.test";

  try {
    // KILO_API_BASE is captured at module evaluation; load a fresh module
    // instance (cache-busted specifier) so the override takes effect.
    const fresh = await import(`../../open-sse/services/usage/kilocode.ts?kilo=${Date.now()}`);
    await fresh.getKilocodeUsage("conn-url", baseConnection);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://kilo.example.test/api/profile/balance");
  } finally {
    delete process.env.KILO_API_URL;
  }
});

test("no OAuth access token → no fetch, readable message", async () => {
  const calls = recordFetch({ balance: 1 });
  const usage = (await getKilocodeUsage("conn-none", {
    provider: "kilocode",
  })) as UsageLike;

  assert.equal(calls.length, 0);
  assert.equal(typeof usage.message, "string");
  assert.ok(/not available/i.test(usage.message), usage.message);
  assert.equal(usage.quotas, undefined);
});

test("anonymous token → no fetch, readable message", async () => {
  const calls = recordFetch({ balance: 1 });
  const usage = (await getKilocodeUsage("conn-anon", {
    provider: "kilocode",
    accessToken: "anonymous",
  })) as UsageLike;

  assert.equal(calls.length, 0);
  assert.equal(typeof usage.message, "string");
  assert.ok(/authenticated/i.test(usage.message), usage.message);
  assert.equal(usage.quotas, undefined);
});

test("apiKey without OAuth accessToken → no fetch, API key is never used", async () => {
  const calls = recordFetch({ balance: 1 });
  const usage = (await getKilocodeUsage("conn-apikey", {
    provider: "kilocode",
    apiKey: "kilo-pat-999",
  })) as UsageLike;

  assert.equal(calls.length, 0);
  assert.equal(typeof usage.message, "string");
  assert.ok(/OAuth/i.test(usage.message), usage.message);
  assert.equal(usage.quotas, undefined);
});

test("apiKey with OAuth accessToken → OAuth token wins, API key ignored", async () => {
  const calls = recordFetch({ balance: 7.5 });

  await getKilocodeUsage("conn-both", {
    provider: "kilocode",
    accessToken: "oauth-token-123",
    apiKey: "kilo-pat-999",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers?.Authorization, "Bearer oauth-token-123");
});

test("HTTP 401 → no balance, re-auth message", async () => {
  mockJson(401, { error: "unauthorized" });
  const usage = (await getKilocodeUsage("conn-401", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.ok(/expired|denied|re-authenticate/i.test(usage.message), usage.message);
  assert.equal(usage.quotas, undefined);
});

test("HTTP 403 → no balance, re-auth message", async () => {
  mockJson(403, { error: "forbidden" });
  const usage = (await getKilocodeUsage("conn-403", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("HTTP 429 → rate-limit message, no balance", async () => {
  mockJson(429, { error: "too many" });
  const usage = (await getKilocodeUsage("conn-429", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.ok(/rate limit/i.test(usage.message), usage.message);
  assert.equal(usage.quotas, undefined);
});

test("HTTP 500 → generic failure message, no balance", async () => {
  mockJson(500, { error: "boom" });
  const usage = (await getKilocodeUsage("conn-500", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("network error → graceful message, no balance", async () => {
  mockNetworkError();
  const usage = (await getKilocodeUsage("conn-net", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("timeout/abort → graceful message, no balance", async () => {
  mockTimeout();
  const usage = (await getKilocodeUsage("conn-timeout", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("malformed JSON → graceful message, no balance", async () => {
  globalThis.fetch = (async () => {
    return new Response("not-json{", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const usage = (await getKilocodeUsage("conn-badjson", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("payload without balance → invalid, no balance", async () => {
  mockJson(200, { credits: 10 });
  const usage = (await getKilocodeUsage("conn-nobal", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("balance: null → invalid, no balance", async () => {
  mockJson(200, { balance: null });
  const usage = (await getKilocodeUsage("conn-nullbal", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("negative balance → rejected as invalid", async () => {
  mockJson(200, { balance: -1 });
  const usage = (await getKilocodeUsage("conn-neg", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("non-numeric balance (NaN-like) → rejected as invalid", async () => {
  mockJson(200, { balance: "not-a-number" });
  const usage = (await getKilocodeUsage("conn-nan", baseConnection)) as UsageLike;

  assert.equal(typeof usage.message, "string");
  assert.equal(usage.quotas, undefined);
});

test("parseKilocodeBalance: null on missing/null/negative/non-finite, number on valid", () => {
  assert.equal(parseKilocodeBalance(undefined), null);
  assert.equal(parseKilocodeBalance(null), null);
  assert.equal(parseKilocodeBalance({}), null);
  assert.equal(parseKilocodeBalance({ balance: null }), null);
  assert.equal(parseKilocodeBalance({ balance: -1 }), null);
  assert.equal(parseKilocodeBalance({ balance: Number.NaN }), null);
  assert.equal(parseKilocodeBalance({ balance: Number.POSITIVE_INFINITY }), null);
  assert.equal(parseKilocodeBalance({ balance: "12.345" }), 12.35);
  assert.equal(parseKilocodeBalance({ balance: 0 }), 0);
  assert.equal(parseKilocodeBalance({ balance: 12.34 }), 12.34);
});

test("buildKilocodeUsageResult: exact remaining, USD credits shape, no invented reset", () => {
  const result = buildKilocodeUsageResult(12.34);

  assert.equal(result.plan, "Kilo Code");
  assert.equal(result.quotas.balance.remaining, 12.34);
  assert.equal(result.quotas.balance.currency, "USD");
  assert.equal(result.quotas.balance.remainingPercentage, 100);
  assert.equal(result.quotas.balance.resetAt, null);
  assert.equal(result.quotas.balance.unlimited, true);
});
