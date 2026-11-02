import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One tool of tools.json (exported from the SnapEX Pay server: `php artisan mcp:export-tools`). */
export interface CatalogTool {
  name: string;
  group: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations: Record<string, unknown>;
  http: { method: string; path: string; auth: boolean; idempotency?: "auto" | "required" };
}

export interface Catalog {
  version: string;
  instructions: string;
  tools: CatalogTool[];
  resources: { uri: string; name: string; title: string; description: string; mimeType: string; text: string }[];
  prompts: { name: string; title: string; description: string; arguments: { name: string; description: string; required: boolean }[] }[];
  promptTexts: Record<string, string>;
  errorHints: Record<string, string>;
}

export interface ApiResult {
  status: number;
  body: Record<string, any>;
  retryAfter?: number;
  requestId?: string;
}

/** Where a key made by create_account is kept between runs (unless SNAPEX_NO_SAVE=1). */
export function credentialsPath(): string {
  return process.env.SNAPEX_CREDENTIALS_FILE || join(homedir(), ".config", "snapex-pay", "credentials.json");
}

export function loadSavedKey(baseUrl: string): string | undefined {
  try {
    const saved = JSON.parse(readFileSync(credentialsPath(), "utf8"));
    return saved?.base_url === baseUrl && typeof saved?.api_key === "string" ? saved.api_key : undefined;
  } catch {
    return undefined;
  }
}

export function saveCredentials(baseUrl: string, data: Record<string, unknown>): string | undefined {
  if (process.env.SNAPEX_NO_SAVE === "1") return undefined;
  const path = credentialsPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const keep = ["api_key", "login", "password", "cabinet_url", "mcp_personal_url"];
    const record: Record<string, unknown> = { base_url: baseUrl, saved_at: new Date().toISOString() };
    for (const k of keep) if (data[k] !== undefined) record[k] = data[k];
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    return path;
  } catch {
    return undefined;
  }
}

/** The Merchant API call behind a tool: path {params}, GET → query, else JSON body, idempotency_key → Idempotency-Key. */
export async function callApi(
  baseUrl: string,
  tool: CatalogTool,
  rawArgs: Record<string, unknown>,
  apiKey: string | undefined,
  userAgent: string,
): Promise<ApiResult> {
  const args: Record<string, unknown> = { ...rawArgs };
  let path = tool.http.path;
  for (const [, name] of path.matchAll(/\{([a-z_]+)\}/g)) {
    const value = args[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      return localError(`Argument ${name} is required.`, { [name]: [`The ${name} argument is required.`] });
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    delete args[name];
  }
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": userAgent };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let idempotency = args.idempotency_key;
  delete args.idempotency_key;
  if (tool.http.idempotency) {
    if (typeof idempotency !== "string" || idempotency.trim() === "") {
      if (tool.http.idempotency === "required") {
        return localError("idempotency_key is required: pass your own unique key of this operation and reuse it on retries.", { idempotency_key: ["Required."] });
      }
      idempotency = `mcp-${randomUUID()}`;
    }
    headers["Idempotency-Key"] = String(idempotency).trim();
  }

  const method = tool.http.method.toUpperCase();
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  let body: string | undefined;
  if (method === "GET") {
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(args);
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    return {
      status: 0,
      body: { error: { code: "network_error", message: `Could not reach ${baseUrl}: ${(error as Error).message}` } },
    };
  }
  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const retry = Number(response.headers.get("Retry-After"));

  return {
    status: response.status,
    body: parsed && typeof parsed === "object" ? parsed : { error: { code: response.status >= 500 ? "internal_error" : "request_error", message: `HTTP ${response.status}` } },
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    requestId: response.headers.get("X-Request-Id") ?? undefined,
  };
}

function localError(message: string, details: Record<string, string[]>): ApiResult {
  return { status: 422, body: { error: { code: "validation_error", message, details } } };
}
