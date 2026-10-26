import test from "node:test";
import assert from "node:assert/strict";

import { normalizeGithubResponsesTools } from "../../open-sse/services/normalizeGithubResponsesTools.ts";

test("GitHub Responses guard flattens nested Chat function tools without touching flat tools", () => {
  const flat = {
    type: "function",
    name: "flat_tool",
    parameters: { type: "object", properties: {} },
  };
  const nested = {
    type: "function",
    function: {
      name: "nested_tool",
      description: "Nested Chat function",
      parameters: { type: "object", properties: { optional: { type: "string" } } },
    },
  };
  const body = {
    tools: [flat, nested, { type: "web_search_preview" }],
  };

  assert.equal(normalizeGithubResponsesTools(body), 1);
  assert.strictEqual(body.tools[0], flat);
  assert.deepEqual(body.tools[1], {
    type: "function",
    name: "nested_tool",
    description: "Nested Chat function",
    parameters: nested.function.parameters,
    strict: false,
  });
  assert.equal(nested.function.name, "nested_tool");
  assert.deepEqual(body.tools[2], { type: "web_search_preview" });
  assert.equal(normalizeGithubResponsesTools(body), 0);
});

test("GitHub Responses guard preserves explicit strict settings and top-level name", () => {
  const body = {
    tools: [
      {
        type: "function",
        name: "authoritative_name",
        function: {
          name: "legacy_name",
          parameters: { type: "object", properties: {} },
          strict: true,
        },
        strict: false,
      },
    ],
  };

  assert.equal(normalizeGithubResponsesTools(body), 1);
  assert.deepEqual(body.tools[0], {
    type: "function",
    name: "authoritative_name",
    description: "",
    parameters: { type: "object", properties: {} },
    strict: false,
  });
});

test("GitHub Responses guard leaves function tools without any usable name unchanged", () => {
  const missingName = { type: "function", function: { parameters: {} } };
  const body = { tools: [missingName] };
  assert.equal(normalizeGithubResponsesTools(body), 0);
  assert.strictEqual(body.tools[0], missingName);
});
