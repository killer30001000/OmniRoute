/**
 * Hardening case 3: bounded polling. The SUT must give up after at most
 * MAX_POLLS, even when BigQuery keeps replying jobComplete=false.
 */

import assert from "node:assert";
import test from "node:test";

import {
  defaultBaseline,
  installFetchStub,
  loadSUT,
  makeJson,
  seedSAConnection,
} from "./helpers/vertexGcpCreditTestUtils.ts";

test("polling aborts after the max-poll cap and returns null", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-poll-bound");
  let pollCount = 0;
  const restore = installFetchStub([
    {
      match: (u) =>
        typeof u === "string" && u.includes("/bigquery/v2/projects/") && u.endsWith("/queries"),
      respond: () =>
        makeJson({
          jobReference: { projectId: "proj", jobId: "job-poll-bound" },
          jobComplete: false,
        }),
    },
    {
      match: (u) => typeof u === "string" && u.includes("/queries/job-poll-bound"),
      respond: () => {
        pollCount += 1;
        return makeJson({
          jobReference: { projectId: "proj", jobId: "job-poll-bound" },
          jobComplete: false,
        });
      },
    },
  ]);
  try {
    const result = await sut.fetchBigQueryCreditDelta(
      connId,
      defaultBaseline() as Record<string, unknown>
    );
    assert.strictEqual(result, null);
    assert.ok(pollCount > 0 && pollCount <= 6, `expected 1..6 polls, got ${pollCount}`);
  } finally {
    restore();
  }
});

// Keep the event loop alive while the test runner flushes TAP output.
// SUT unrefs every timer it schedules, which on its own lets Node exit
// mid-subtest under v22.23. This deliberately stays refed.
const _keepAlive = setInterval(() => {
  // intentional noop
}, 50_000);
