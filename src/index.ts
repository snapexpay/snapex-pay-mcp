#!/usr/bin/env node
/**
 * SnapEX Pay MCP server (stdio). A thin client of the SnapEX Pay Merchant API: the same tools as the remote server
 * https://pay.snapex.pro/mcp, taken from tools.json. Env: SNAPEX_API_KEY (optional — create_account makes one),
 * SNAPEX_BASE_URL (default https://pay.snapex.pro), SNAPEX_CREDENTIALS_FILE, SNAPEX_NO_SAVE=1.
 */
import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callApi, Catalog, CatalogTool, credentialsPath, loadSavedKey, saveCredentials } from "./api.js";

const catalog: Catalog = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const baseUrl = (process.env.SNAPEX_BASE_URL || "https://pay.snapex.pro").replace(/\/+$/, "");
let apiKey: string | undefined = process.env.SNAPEX_API_KEY?.trim() || loadSavedKey(baseUrl);
const userAgent = `snapex-pay-mcp/${catalog.version} (node ${process.version})`;

const server = new Server(
  { name: "snapex-pay", title: "SnapEX Pay", version: catalog.version, websiteUrl: `${baseUrl}/mcp` } as any,
  {
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
    instructions: catalog.instructions,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: catalog.tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = catalog.tools.find((t) => t.name === request.params.name);
  if (!tool) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}. Call tools/list.`);
  }
  const given = (request.params.arguments ?? {}) as Record<string, unknown>;
  const known = Object.keys(tool.inputSchema.properties ?? {});
  const args: Record<string, unknown> = {};
  for (const k of known) if (given[k] !== undefined) args[k] = given[k];
  const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined || args[k] === "");
  if (missing.length > 0) {
    return toolError(tool, "validation_error", `Missing required argument(s): ${missing.join(", ")}.`, 422, {});
  }
  if (tool.http.auth && !apiKey) {
    return toolError(tool, "unauthorized", "This tool needs a SnapEX Pay account and SNAPEX_API_KEY is not set.", 401, {});
  }
  if (tool.name === "create_account" && args.agent === undefined) {
    const client = server.getClientVersion();
    args.agent = `MCP stdio${client?.name ? ` (${client.name}${client.version ? "/" + client.version : ""})` : ""}`;
  }

  const result = await callApi(baseUrl, tool, args, tool.http.auth ? apiKey : undefined, userAgent);
  const body = result.body;
  if (result.status === 0 || result.status >= 400 || body.error) {
    const error = body.error ?? {};
    return toolError(tool, String(error.code ?? "request_error"), String(error.message ?? ""), result.status, error.details ?? {}, result.retryAfter, result.requestId);
  }

  let note: string | undefined;
  if (tool.name === "create_account" && typeof body.data?.api_key === "string") {
    apiKey = body.data.api_key;
    const saved = saveCredentials(baseUrl, body.data);
    note = `Account created. Its API key is now used by this server${saved ? ` and saved to ${saved} (next runs pick it up)` : ""}. Save api_key and login/password: they are shown once. To use it elsewhere set SNAPEX_API_KEY.`;
  }
  const unknown = Object.keys(given).filter((k) => !known.includes(k));
  if (unknown.length > 0) note = `${note ? note + " " : ""}Ignored unknown argument(s): ${unknown.join(", ")}.`;

  return {
    content: [{ type: "text" as const, text: (note ? note + "\n" : "") + JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: false,
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: catalog.resources.map(({ uri, name, title, description, mimeType }) => ({ uri, name, title, description, mimeType })),
}));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resource = catalog.resources.find((r) => r.uri === request.params.uri);
  if (!resource) throw new McpError(-32002 as ErrorCode, `Resource not found: ${request.params.uri}.`);
  return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: catalog.prompts }));
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = catalog.prompts.find((p) => p.name === request.params.name);
  if (!prompt) throw new McpError(ErrorCode.InvalidParams, "Unknown prompt. Call prompts/list.");
  let text = catalog.promptTexts[prompt.name] ?? "";
  const args = request.params.arguments ?? {};
  // The exported texts carry <placeholders> for empty arguments; fill the ones the user gave.
  const fill: Record<string, string> = { amount_usd: "<amount>", amount_usdt: "<amount>", coin: "<coin>", address: "<address>" };
  for (const [name, placeholder] of Object.entries(fill)) {
    if (args[name]) text = text.replace(placeholder, String(args[name]));
  }
  if (args.description) text = text.replace(" USD with SnapEX Pay", ` USD for "${args.description}" with SnapEX Pay`);
  return { description: prompt.description, messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
});

function toolError(
  tool: CatalogTool,
  code: string,
  message: string,
  status: number,
  details: Record<string, unknown>,
  retryAfter?: number,
  requestId?: string,
) {
  const hints = catalog.errorHints;
  let hint: string;
  if (code === "unauthorized" && !apiKey) {
    hint = "Call create_account (no captcha) — the new key is used by this server and saved for next runs — or set SNAPEX_API_KEY=smk_… in the MCP server config.";
  } else if (code === "network_error") {
    hint = `Check the network and SNAPEX_BASE_URL (${baseUrl}).`;
  } else {
    hint = hints[code] ?? (status >= 500 ? hints.server_error : hints.default);
  }
  hint = hint.replace("{retry}", String(retryAfter ?? 60)).replace("{support}", `${baseUrl}/#chat`);
  let text = `Error ${code} (HTTP ${status}) in ${tool.name}: ${message}`;
  for (const [field, errors] of Object.entries(details)) {
    text += `\n- ${field}: ${Array.isArray(errors) ? errors.join(" ") : String(errors)}`;
  }
  text += `\nWhat to do: ${hint}`;
  if (requestId) text += `\nRequest id: ${requestId}`;
  const error: Record<string, unknown> = { code, message, http_status: status, what_to_do: hint };
  if (Object.keys(details).length > 0) error.details = details;
  if (retryAfter !== undefined) error.retry_after_seconds = retryAfter;
  if (requestId !== undefined) error.request_id = requestId;

  return { content: [{ type: "text" as const, text }], structuredContent: { error }, isError: true };
}

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${catalog.version}\n`);
    return;
  }
  if (process.argv.includes("--help")) {
    process.stdout.write(
      `snapex-pay-mcp ${catalog.version} — SnapEX Pay MCP server over stdio.\n` +
        `Env: SNAPEX_API_KEY (optional; create_account makes one and saves it to ${credentialsPath()}),\n` +
        `     SNAPEX_BASE_URL (default https://pay.snapex.pro), SNAPEX_CREDENTIALS_FILE, SNAPEX_NO_SAVE=1.\n` +
        `Remote alternative without install: https://pay.snapex.pro/mcp\n`,
    );
    return;
  }
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`snapex-pay-mcp: ${(error as Error).stack ?? error}\n`);
  process.exit(1);
});
