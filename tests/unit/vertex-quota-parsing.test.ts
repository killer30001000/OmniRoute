import { describe, it } from "node:test";
import assert from "node:assert";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaParsing.ts";

describe("parseQuotaData for vertex", () => {
  it("should format google_cloud_credit with total as normal quota entry", () => {
    const data = {
      quotas: {
        google_cloud_credit: {
          total: 300,
          remaining: 100,
          remainingPercentage: 33,
          currency: "USD",
          displayName: "Google Cloud Credit",
        },
        spend: {
          used: 1.23,
          total: 0,
          currency: "USD",
        },
      },
    };

    const parsed = parseQuotaData("vertex", data);

    const gcpQuota = parsed.find((q: Record<string, unknown>) => q.name === "google_cloud_credit");
    assert.ok(gcpQuota);
    assert.strictEqual(gcpQuota.isCredits, undefined); // Falsy
    assert.strictEqual(gcpQuota.total, 300);
    assert.strictEqual(gcpQuota.remainingPercentage, 33);
  });

  it("should format google_cloud_credit without total as credits row", () => {
    const data = {
      quotas: {
        google_cloud_credit: {
          total: 0,
          remaining: 100,
          currency: "USD",
          displayName: "Google Cloud Credit",
        },
      },
    };

    const parsed = parseQuotaData("vertex", data);
    const gcpQuota = parsed.find((q: Record<string, unknown>) => q.name === "google_cloud_credit");

    assert.ok(gcpQuota);
    assert.strictEqual(gcpQuota.isCredits, true);
    assert.strictEqual(gcpQuota.creditCount, 100);
    assert.strictEqual(gcpQuota.remainingPercentage, 100);
    assert.strictEqual(gcpQuota.unlimited, false);
  });
});
