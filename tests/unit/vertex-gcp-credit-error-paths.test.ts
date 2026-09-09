/**
 * Hardening cases for failure paths the SUT must recognise:
 *   4. malformed_job_reference — initial POST returns a payload without
 *      a jobReference; SUT must short-circuit and return null.
 *   5. invalid_identifier — connection has no usable identity; SUT must
 *      return null without ever calling fetch.
 *   6. initial_http_error — BigQuery answers the initial POST with 500;
 *      SUT must return null without entering the poll loop.
 *   7. budget_exhausted — poll loop runs past the 8s total budget and
 *      gets aborted; SUT must return null.
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

test("malformed jobReference short-circuits to null", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-malformed-jobref");
  let fetchCount = 0;
  const restore = installFetchStub([
    {
      match: () => true,
      respond: () => {
        fetchCount += 1;
        return makeJson({
          // intentionally missing `jobReference`
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
    assert.strictEqual(fetchCount, 1, "only the initial POST should fire");
  } finally {
    restore();
  }
});

test("invalid identifier (no usable identity) yields null without network", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-invalid-id");
  let fetchCount = 0;
  const restore = installFetchStub([
    {
      match: () => true,
      respond: () => {
        fetchCount += 1;
        return makeJson({});
      },
    },
  ]);
  try {
    const result = await sut.fetchBigQueryCreditDelta(connId, {});
    assert.strictEqual(result, null);
    assert.strictEqual(fetchCount, 0, "SUT must not call fetch when the identity is missing");
  } finally {
    restore();
  }
});

test("initial POST returning HTTP 500 yields null without polling", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-initial-500");
  let fetchCount = 0;
  const restore = installFetchStub([
    {
      match: (u) =>
        typeof u === "string" && u.includes("/bigquery/v2/projects/") && u.endsWith("/queries"),
      respond: () => {
        fetchCount += 1;
        return makeJson({}, 500);
      },
    },
    {
      match: (u) => typeof u === "string" && u.includes("/queries/"),
      respond: () => {
        fetchCount += 1;
        return makeJson({
          jobComplete: true,
          rows: [{ f: [{ v: "999" }] }],
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
    assert.strictEqual(fetchCount, 1, "no polls on a 5xx initial POST");
  } finally {
    restore();
  }
});

test("budget exhausted: stalled poll loop returns null", async () => {
  const sut = await loadSUT();
  const connId = await seedSAConnection("bq-budget");
  let fetchCount = 0;
  const restore = installFetchStub([
    {
      match: (u) =>
        typeof u === "string" && u.includes("/bigquery/v2/projects/") && u.endsWith("/queries"),
      respond: () =>
        makeJson({
          jobReference: { projectId: "proj", jobId: "job-budget" },
          jobComplete: false,
        }),
    },
    {
      match: (u) => typeof u === "string" && u.includes("/queries/job-budget"),
      respond: () => {
        fetchCount += 1;
        // Never complete. Hold the connection open longer than the
        // budget timer (8s) so the AbortController signal fires.
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(makeJson({ jobComplete: false })), 60_000);
        });
      },
    },
  ]);
  try {
    const start = Date.now();
    const result = await sut.fetchBigQueryCreditDelta(
      connId,
      defaultBaseline() as Record<string, unknown>
    );
    const elapsed = Date.now() - start;
    assert.strictEqual(result, null);
    assert.ok(fetchCount >= 1, `expected at least one stalled poll, got ${fetchCount}`);
    assert.ok(elapsed < 60_000, "must abort well before the held-open fetch resolves");
  } finally {
    restore();
  }
});

const _keepAlive = setInterval(() => {
  // intentional noop
}, 50_000);
