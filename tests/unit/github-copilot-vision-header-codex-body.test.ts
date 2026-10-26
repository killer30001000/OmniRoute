// GitHub Copilot: the executor sets copilot-vision-request when the turn carries an
// image, an uncatalogued *codex* id gets a Responses body to match its /responses
// URL, and the GHE executor honors the per-request targetFormat threaded by
// chatCore/executionCredentials.ts (same as GithubExecutor.buildUrl).

import test from "node:test";
import assert from "node:assert/strict";

const { GithubExecutor } = await import("../../open-sse/executors/github.ts");
const { GheCopilotExecutor } = await import("../../open-sse/executors/ghe-copilot.ts");
const { getModelTargetFormat } = await import("../../open-sse/config/providerModels.ts");
const { openaiToOpenAIResponsesRequest } = await import("../../open-sse/translator/request/openai-responses/toResponses.ts");
const { supportsMaxTokens } = await import("../../src/lib/modelCapabilities.ts");

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("an uncatalogued codex id gets a Responses body to match its /responses URL", () => {
  const executor = new GithubExecutor();
  assert.match(executor.buildUrl("gpt-7.2-codex", false), /\/responses$/);
  assert.equal(getModelTargetFormat("gh", "gpt-7.2-codex"), "openai-responses");
  assert.equal(getModelTargetFormat("ghe-copilot", "gpt-7.2-codex"), "openai-responses");
});

test("gpt-6-sol uses Responses on GitHub Copilot", () => {
  const executor = new GithubExecutor();
  assert.equal(getModelTargetFormat("gh", "gpt-6-sol"), "openai-responses");
  assert.equal(getModelTargetFormat("github", "gpt-6-sol"), "openai-responses");
  assert.match(executor.buildUrl("gpt-6-sol", false), /\/responses$/);
});

test("Responses translation preserves flat function tool names and Chat function tools", () => {
  const body = {
    messages: [{ role: "user", content: "Call the test tool" }],
    tools: [{
      type: "function",
      name: "flat_test_tool",
      description: "A flat Responses function",
      parameters: { type: "object", properties: {} },
    }],
  };
  const flat = openaiToOpenAIResponsesRequest("gpt-6-sol", body, false, {}) as {
    tools: Array<Record<string, unknown>>;
  };
  assert.equal(flat.tools[0].name, "flat_test_tool");
  assert.equal(flat.tools[0].strict, undefined);

  const nested = openaiToOpenAIResponsesRequest(
    "gpt-6-sol",
    {
      ...body,
      tools: [{ type: "function", function: { name: "nested_test_tool", parameters: { type: "object", properties: {} } } }],
    },
    false,
    {}
  ) as { tools: Array<Record<string, unknown>> };
  assert.equal(nested.tools[0].name, "nested_test_tool");
  assert.equal(nested.tools[0].strict, false);
});

test("GHE honors the per-request targetFormat from the synced catalog", () => {
  const executor = new GheCopilotExecutor();
  const creds = {
    accessToken: "tok",
    providerSpecificData: {
      copilotApiUrl: "https://ghe.example/copilot",
      targetFormat: "openai-responses",
    },
  };
  assert.match(executor.buildUrl("ghe-copilot/gpt-9-nova", true, 0, creds), /\/responses$/);
});

test("copilot-vision-request is set automatically when the turn carries an image", () => {
  const executor = new GithubExecutor();
  const creds = { accessToken: "tok", copilotToken: "cop" };
  const chatBody = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "color?" },
          { type: "image_url", image_url: { url: PNG } },
        ],
      },
    ],
  };
  const responsesBody = {
    input: [{ role: "user", content: [{ type: "input_image", image_url: PNG }] }],
  };
  const textBody = { messages: [{ role: "user", content: "hi" }] };

  const h = (body) => executor.buildHeaders(creds, false, null, "gpt-5.6-luna", undefined, body);
  assert.equal(h(chatBody)["copilot-vision-request"], "true");
  assert.equal(h(responsesBody)["copilot-vision-request"], "true");
  assert.equal(h(textBody)["copilot-vision-request"], undefined);
});

test("gpt-5.6 does not take max_tokens on the chat path", () => {
  assert.equal(supportsMaxTokens("gpt-5.6-terra"), false);
});
