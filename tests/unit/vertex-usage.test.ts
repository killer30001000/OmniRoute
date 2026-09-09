import { describe, it } from "node:test";
import assert from "node:assert";

const { fetchBigQueryCreditDelta } =
  await import("../../open-sse/services/usage/vertexGcpCreditBigQuery.ts");

describe("vertexGcpCreditBigQuery helper", () => {
  it("returns null when missing config", async () => {
    const res = await fetchBigQueryCreditDelta("id", {});
    assert.strictEqual(res, null);
  });

  it("ignores non-sa connections", async () => {
    const res = await fetchBigQueryCreditDelta("nonexistent", {
      enabled: true,
      queryProjectId: "x",
      datasetId: "y",
      tableId: "z",
      baseline: { asOf: "2026-09-09T00:00:00Z" },
    });
    assert.strictEqual(res, null);
  });
});
