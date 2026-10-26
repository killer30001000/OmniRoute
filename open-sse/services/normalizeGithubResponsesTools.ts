/**
 * Last-mile tool shape guard for GitHub Copilot's /responses endpoint.
 *
 * A Responses request can reach the GitHub executor with mixed function tool
 * definitions after routing/interception. The upstream requires the function
 * name at tools[N].name, never at tools[N].function.name.
 * Preserve flat Responses tools unchanged; convert only nested legacy Chat
 * Completions definitions, without mutating the caller's tool objects.
 */
export function normalizeGithubResponsesTools(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;

  const root = body as Record<string, unknown>;
  if (!Array.isArray(root.tools)) return 0;

  let normalizedCount = 0;
  const normalized = root.tools.map((toolValue: unknown) => {
    if (!toolValue || typeof toolValue !== "object" || Array.isArray(toolValue)) return toolValue;
    const tool = toolValue as Record<string, unknown>;
    if (tool.type !== "function") return toolValue;

    const nestedValue = tool.function;
    if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue))
      return toolValue;
    const nested = nestedValue as Record<string, unknown>;
    const name =
      typeof tool.name === "string" && tool.name.trim()
        ? tool.name
        : typeof nested.name === "string" && nested.name.trim()
          ? nested.name
          : "";

    // Do not invent a function identity when neither representation has a name.
    if (!name) return toolValue;

    const rest = { ...tool };
    delete rest.function;
    normalizedCount++;
    return {
      ...rest,
      name,
      description: rest.description ?? nested.description ?? "",
      parameters: rest.parameters ?? nested.parameters ?? { type: "object", properties: {} },
      // Chat Completions omitted strict means non-strict. Preserve that semantic
      // explicitly so Responses does not auto-require optional arguments.
      strict: rest.strict ?? nested.strict ?? false,
    };
  });

  if (normalizedCount > 0) root.tools = normalized;
  return normalizedCount;
}
