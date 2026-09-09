import { describe, it } from "node:test";
import assert from "node:assert";
import { getVertexUsage } from "../../open-sse/services/usage/vertex.ts";

describe("getVertexUsage", () => {
  it("should return spend without gcpCredit", async () => {
    const usage = await getVertexUsage("conn-1", "vertex");
    assert.ok(usage.quotas);
    assert.strictEqual(
      (usage.quotas.spend as Record<string, unknown>).used > 0 ||
        (usage.quotas.spend as Record<string, unknown>).used === 0,
      true
    );
    assert.strictEqual(usage.quotas.google_cloud_credit, undefined);
  });

  it("should add google_cloud_credit if providerSpecificData.gcpCredit is provided", async () => {
    const usage = await getVertexUsage("conn-1", "vertex", {
      gcpCredit: {
        total: 300,
        remaining: 200,
        expiresAt: "2026-10-31T00:00:00Z",
      },
    });

    assert.ok(usage.quotas.spend);
    assert.ok(usage.quotas.google_cloud_credit);
    const gcp = usage.quotas.google_cloud_credit as Record<string, unknown>;
    assert.strictEqual(gcp.total, 300);
    assert.strictEqual(gcp.remaining, 200);
    assert.strictEqual(gcp.remainingPercentage, 67); // Math.round(200/300 * 100)
    assert.strictEqual(gcp.displayName, "Google Cloud Credit");
    assert.strictEqual(gcp.unlimited, false);
  });

  it("should handle missing total in gcpCredit", async () => {
    const usage = await getVertexUsage("conn-1", "vertex", {
      gcpCredit: {
        remaining: 150,
      },
    });

    const gcp = usage.quotas.google_cloud_credit as Record<string, unknown>;
    assert.strictEqual(gcp.total, 0);
    assert.strictEqual(gcp.remaining, 150);
    assert.strictEqual(gcp.remainingPercentage, undefined);
  });

  it("should handle negative remaining gracefully", async () => {
    const usage = await getVertexUsage("conn-1", "vertex", {
      gcpCredit: {
        total: 300,
        remaining: -10,
      },
    });

    assert.strictEqual(usage.quotas.google_cloud_credit, undefined);
  });
});
