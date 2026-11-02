// Smoke test with the official MCP SDK client.
//   node test/smoke.mjs                      — stdio package offline: tools, resources, prompts, the no-key error.
//   SNAPEX_E2E_BASE_URL=http://127.0.0.1:8765 node test/smoke.mjs
//                                            — the full agent flow over stdio AND over the remote /mcp (Streamable HTTP):
//                                              no key → create_account → assets → test invoice → payout preview → conversion preview.
// Never point SNAPEX_E2E_BASE_URL at production: it opens accounts.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const e2e = process.env.SNAPEX_E2E_BASE_URL;
const log = (...a) => console.log(...a);
const data = (r) => r.structuredContent?.data;

async function connectStdio(baseUrl) {
  const client = new Client({ name: "snapex-smoke", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
    env: { ...process.env, SNAPEX_BASE_URL: baseUrl, SNAPEX_NO_SAVE: "1", SNAPEX_API_KEY: "" },
  }));
  return client;
}

async function connectHttp(baseUrl) {
  const client = new Client({ name: "snapex-smoke-http", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl + "/mcp")));
  return client;
}

async function basics(client, label) {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 32, `${label}: 32 tools`);
  const payout = tools.find((t) => t.name === "create_payout");
  assert.equal(payout.annotations.destructiveHint, true);
  assert.ok(payout.inputSchema.required.includes("idempotency_key"));
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === "snapex://docs/quickstart"));
  const doc = await client.readResource({ uri: "snapex://docs/quickstart" });
  assert.match(doc.contents[0].text, /create_account/);
  const { prompts } = await client.listPrompts();
  assert.ok(prompts.length >= 2);
  const prompt = await client.getPrompt({ name: "accept_crypto_payment", arguments: { amount_usd: "25" } });
  assert.match(prompt.messages[0].content.text, /25 USD/);
  const noKey = await client.callTool({ name: "get_balances", arguments: {} });
  assert.equal(noKey.isError, true);
  assert.match(noKey.content[0].text, /create_account/);
  log(`${label}: ${tools.length} tools, resources, prompts and the no-key hint — ok`);
}

async function flow(client, label) {
  const assets = await client.callTool({ name: "list_assets", arguments: {} });
  assert.equal(assets.isError, false, assets.content[0].text);
  log(`${label}: list_assets → ${data(assets).map((a) => a.asset_id).join(", ")}`);

  const account = await client.callTool({ name: "create_account", arguments: { agent: `smoke ${label}` } });
  assert.equal(account.isError, false, account.content[0].text);
  log(`${label}: create_account → login ${data(account).login}, key ${data(account).api_key_prefix}…`);
  log(`${label}:   ${account.content[0].text.split("\n")[0]}`);

  const balances = await client.callTool({ name: "get_balances", arguments: {} });
  assert.equal(balances.isError, false, balances.content[0].text);
  log(`${label}: get_balances → ${JSON.stringify(data(balances))}`);

  const me = await client.callTool({ name: "get_account", arguments: {} });
  assert.equal(data(me).login, data(account).login);

  const invoice = await client.callTool({ name: "create_invoice", arguments: { amount_usd: "12", environment: "test", description: "Smoke test" } });
  assert.equal(invoice.isError, false, invoice.content[0].text);
  log(`${label}: create_invoice (test) → ${data(invoice).invoice_id} ${data(invoice).status} ${data(invoice).pay_url}`);
  const got = await client.callTool({ name: "get_invoice", arguments: { invoice_id: data(invoice).invoice_id } });
  assert.equal(data(got).invoice_id, data(invoice).invoice_id);

  const preview = await client.callTool({ name: "preview_payout", arguments: { amount: "15", destination_asset_id: "btc", destination_network: "Bitcoin", destination_address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" } });
  log(`${label}: preview_payout → ${preview.isError ? "error: " + preview.content[0].text.split("\n").join(" | ") : JSON.stringify(data(preview))}`);
  const send = await client.callTool({ name: "create_payout", arguments: { preview_id: "00000000-0000-4000-8000-000000000000", destination_network: "Bitcoin", destination_address: "bc1q" } });
  assert.equal(send.isError, true);
  log(`${label}: create_payout without idempotency_key → ${send.structuredContent.error.code}`);

  const conversion = await client.callTool({ name: "preview_conversion", arguments: { mode: "all_to_usdt" } });
  log(`${label}: preview_conversion → ${conversion.isError ? "error: " + conversion.content[0].text.split("\n")[0] : JSON.stringify(data(conversion))}`);
}

const offline = await connectStdio("http://127.0.0.1:9");
await basics(offline, "stdio (offline)");
await offline.close();

if (e2e) {
  const stdio = await connectStdio(e2e);
  await flow(stdio, "stdio");
  await stdio.close();
  const http = await connectHttp(e2e);
  await basics(http, "http");
  await flow(http, "http");
  await http.close();
}
log("smoke: ok");
