/** Hardening-test helpers for open-sse/services/usage/vertexGcpCreditBigQuery.ts.

Per-file per-test isolation: every test installs its own globalThis.fetch
stub before invoking the SUT and tears it down in finally. Helpers do
NOT share any mutable state across tests — no queue, no timer ref, no cached
crypto.subtle key. */
import crypto from "node:crypto";
import type { Response } from "node:undici";

export type ScriptedHandler = {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) => Promise<Response>;
};

export type RestoreHandle = () => void;

function raceWithSignal<T>(pending: Promise<T> | T, signal?: AbortSignal): Promise<T> {
  const p = pending instanceof Promise ? pending : Promise.resolve(pending as T);
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

export function installFetchStub(scripted: ScriptedHandler[]): RestoreHandle {
  const globalFetch = globalThis as unknown as { fetch?: typeof fetch };
  const originalFetch = globalFetch.fetch;
  const stub = async (url: string, init?: RequestInit): Promise<Response> => {
    void globalFetch;
    if (typeof url === "string" && url.includes("oauth2.googleapis.com/token")) {
      return makeJson({
        access_token: "stub-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    for (const step of scripted) {
      if (step.match(url, init)) {
        const inner = step.respond(url, init);
        return raceWithSignal(inner, init?.signal);
      }
    }
    throw new Error(`unstubbed fetch: ${String(url)}`);
  };
  (globalThis as { fetch: typeof fetch }).fetch = stub as typeof fetch;
  return () => {
    if (originalFetch) (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    else delete (globalThis as { fetch?: typeof fetch }).fetch;
  };
}

export function makeJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function makeText(body: string, status = 200): Response {
  return new Response(body, { status });
}

export function makeEmpty(status = 204): Response {
  return new Response(null, { status });
}

export function generateSAKeyPair(): string {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

export async function seedSAConnection(name: string): Promise<string> {
  const providersDb = await import("../../../src/lib/db/providers.ts");
  const sa = {
    client_email: `${name}@bqtest.example`,
    private_key: generateSAKeyPair(),
  };
  const conn = await providersDb.createProviderConnection({
    provider: "vertex",
    authType: "service_account",
    name,
    apiKey: JSON.stringify(sa),
    isActive: true,
    testStatus: "active",
    priority: 1,
  });
  return String(conn.id);
}

export async function seedExpressConnection(name: string): Promise<string> {
  const providersDb = await import("../../../src/lib/db/providers.ts");
  const conn = await providersDb.createProviderConnection({
    provider: "vertex",
    authType: "apikey",
    name,
    apiKey: "express-stub-key",
    isActive: true,
    testStatus: "active",
    priority: 1,
  });
  return String(conn.id);
}

export async function loadSUT(): Promise<{
  fetchBigQueryCreditDelta: (
    connectionId: string,
    config: Record<string, unknown>
  ) => Promise<number | null>;
}> {
  return await import("../../../open-sse/services/usage/vertexGcpCreditBigQuery.ts");
}

export function defaultBaseline(asOf = "2026-09-09T00:00:00Z"): unknown {
  return {
    enabled: true,
    queryProjectId: "proj",
    datasetId: "ds",
    tableId: "tb",
    creditId: "welcome-1",
    baseline: { remaining: 100, asOf },
  };
}
