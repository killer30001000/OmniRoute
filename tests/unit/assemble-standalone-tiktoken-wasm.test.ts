import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncStandaloneExtraModules } from "../../scripts/build/assembleStandalone.mjs";

const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function writeTiktokenFixture(root: string) {
  const packageDir = join(root, "node_modules", "tiktoken");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "tiktoken", main: "tiktoken.cjs" })
  );
  writeFileSync(
    join(packageDir, "tiktoken.cjs"),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const bytes = fs.readFileSync(path.join(__dirname, "tiktoken_bg.wasm"));',
      "new WebAssembly.Module(bytes);",
      "exports.loaded = true;",
      "",
    ].join("\n")
  );
  writeFileSync(join(packageDir, "tiktoken_bg.wasm"), WASM_HEADER);
}

test("standalone bundles external tiktoken with its WASM at Node's runtime resolution path", async () => {
  const root = mkdtempSync(join(tmpdir(), "omniroute-assemble-tiktoken-"));
  try {
    writeTiktokenFixture(root);
    const standalone = join(root, ".build", "next", "standalone");
    mkdirSync(standalone, { recursive: true });

    await syncStandaloneExtraModules(root, undefined, { log() {} }, standalone);

    const bundledWasm = join(standalone, "node_modules", "tiktoken", "tiktoken_bg.wasm");
    assert.ok(
      existsSync(bundledWasm),
      "standalone must retain tiktoken_bg.wasm beside tiktoken.cjs"
    );

    writeFileSync(
      join(standalone, "tiktoken-runtime-smoke.cjs"),
      'if (!require("tiktoken").loaded) throw new Error("tiktoken did not load");\n'
    );
    execFileSync(process.execPath, ["tiktoken-runtime-smoke.cjs"], {
      cwd: standalone,
      stdio: "pipe",
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("Next externalizes tiktoken instead of embedding its __dirname-based WASM loader", async () => {
  const config = await import("../../next.config.mjs");
  assert.ok(
    config.default.serverExternalPackages.includes("tiktoken"),
    "tiktoken must stay external so its CommonJS loader resolves its sibling WASM from node_modules"
  );
});
