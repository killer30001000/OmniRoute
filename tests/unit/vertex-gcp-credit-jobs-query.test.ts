/**
 * Hardening cases 1 + 2: jobs.query returns immediately with a complete
 * result, both with `jobComplete=true` and via a single bounded poll.
 *
 * Kept in its own file so the Node test runner spawns a fresh process and
 * avoids sharing crypto/thread-pool state with sibling suites.
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

test("jobs.query returns a complete result on the first call", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-jobs-complete");
  const restore = installFetchStub([
    {
      match: (u) =>
        typeof u === "string" && u.includes("/bigquery/v2/projects/") && u.endsWith("/queries"),
      respond: () =>
        makeJson({
          jobReference: { projectId: "proj", jobId: "job-1" },
          jobComplete: true,
          rows: [{ f: [{ v: "12.5" }] }],
        }),
    },
  ]);
  try {
    const result = await sut.fetchBigQueryCreditDelta(
      connId,
      defaultBaseline() as Record<string, unknown>
    );
    assert.strictEqual(result, 12.5);
  } finally {
    restore();
  }
});

test("jobs.query with jobComplete=false triggers a single bounded poll", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-jobs-pending");
  let pollCount = 0;
  const restore = installFetchStub([
    {
      match: (u) =>
        typeof u === "string" && u.includes("/bigquery/v2/projects/") && u.endsWith("/queries"),
      respond: () =>
        makeJson({
          jobReference: { projectId: "proj", jobId: "job-2" },
          jobComplete: false,
        }),
    },
    {
      match: (u) => typeof u === "string" && u.includes("/queries/job-2"),
      respond: () => {
        pollCount += 1;
        return makeJson({
          jobReference: { projectId: "proj", jobId: "job-2" },
          jobComplete: true,
          rows: [{ f: [{ v: "3" }] }],
        });
      },
    },
  ]);
  try {
    const result = await sut.fetchBigQueryCreditDelta(
      connId,
      defaultBaseline() as Record<string, unknown>
    );
    assert.strictEqual(result, 3);
    assert.strictEqual(pollCount, 1, "exactly one poll expected");
  } finally {
    restore();
  }
});

// Active interval prevents SUT's `unref`'d timers from letting the event
// loop drain before node:test finishes flushing TAP output.
const _keepAlive = setInterval(() => {
  // intentional noop
}, 50_000);
