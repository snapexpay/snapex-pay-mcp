# SnapEX Pay MCP server

MCP server for crypto payments: an AI agent opens its own merchant account and accepts, sends and exchanges crypto.

SnapEX Pay MCP server lets an AI agent work with crypto payments without a person in the loop. The agent connects to https://pay.snapex.pro/mcp, opens a SnapEX Pay merchant account by itself (no captcha, no email) and gets an API key. Then it can create invoices with hosted payment pages, receive crypto on permanent deposit addresses, keep a USDT balance, send payouts in many coins and networks, and manage webhooks. Test mode runs the whole flow without real money. Payouts always start with a free preview and use an idempotency key, so a retry never pays twice. Remote server (Streamable HTTP) or local package: npx -y snapex-pay-mcp.

- **Remote server (recommended, nothing to install):** `https://pay.snapex.pro/mcp` — Streamable HTTP.
- **Local stdio package:** `npx -y snapex-pay-mcp` — the same tools, a thin client of the same API.
- **Docker:** `docker build -t snapex-pay-mcp . && docker run -i --rm snapex-pay-mcp`.
- MCP Registry name: `pro.snapex/pay`.
- Docs for people: <https://pay.snapex.pro/mcp> · REST reference: <https://pay.snapex.pro/partner/merchant/docs> ·
  server card: <https://pay.snapex.pro/.well-known/mcp.json> · <https://pay.snapex.pro/llms.txt>
- Privacy policy: <https://pay.snapex.pro/privacy> · Terms: <https://pay.snapex.pro/terms> · Rules for merchants:
  <https://pay.snapex.pro/rules> · Support: <https://pay.snapex.pro/#chat>

## How an agent uses it

1. Connect without a key. The catalogue tools (`list_assets`, `get_fiat_rates`, `get_fees`, `list_static_address_networks`) work at once.
2. Call `create_account`. It returns `api_key` (shown once), a cabinet `login`/`password` for a person, and
   `mcp_personal_url`. The new key is used right away: on the remote server for the rest of the MCP session, in the
   stdio package for the process (and it is saved to `~/.config/snapex-pay/credentials.json` for the next runs).
3. Receive: `create_invoice` → give `pay_url` to the payer → `get_invoice` until `paid`. `environment: "test"` runs the
   whole flow without real money (a test invoice turns paid ~10 s after a coin is selected; the balance does not change).
4. Send: `preview_payout` (free quote) → `create_payout` with the `preview_id` and your own `idempotency_key` (irreversible; a retry with the same key never pays twice).
5. The balance is kept in USDT: to get another coin, pay out in that coin. `preview_conversion` → `create_conversion`
   converts other assets an older account still holds.

Every error answer says what to do next (`what_to_do`), e.g. `unauthorized` → call `create_account`; `rate_limited` → wait `retry_after_seconds`.

## Connect

### Claude Code

```bash
claude mcp add --transport http snapex-pay https://pay.snapex.pro/mcp
# with an existing key:
claude mcp add --transport http snapex-pay https://pay.snapex.pro/mcp --header "Authorization: Bearer smk_…"
```

### Cursor — `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "snapex-pay": { "url": "https://pay.snapex.pro/mcp" }
  }
}
```

Add `"headers": { "Authorization": "Bearer smk_…" }` to keep one account across sessions.

### VS Code — `.vscode/mcp.json`

```json
{
  "servers": {
    "snapex-pay": { "type": "http", "url": "https://pay.snapex.pro/mcp" }
  }
}
```

### Windsurf — `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "snapex-pay": { "serverUrl": "https://pay.snapex.pro/mcp" }
  }
}
```

### Cline — `cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "snapex-pay": { "type": "streamableHttp", "url": "https://pay.snapex.pro/mcp" }
  }
}
```

Step-by-step for AI installers: [`llms-install.md`](llms-install.md).

### Gemini CLI

As an extension (this repository has `gemini-extension.json`):

```bash
gemini extensions install https://github.com/snapexpay/snapex-pay-mcp
```

or in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "snapex-pay": { "httpUrl": "https://pay.snapex.pro/mcp" }
  }
}
```

### Claude Desktop — `claude_desktop_config.json`

Remote server through `mcp-remote`:

```json
{
  "mcpServers": {
    "snapex-pay": { "command": "npx", "args": ["-y", "mcp-remote", "https://pay.snapex.pro/mcp"] }
  }
}
```

or the local package:

```json
{
  "mcpServers": {
    "snapex-pay": {
      "command": "npx",
      "args": ["-y", "snapex-pay-mcp"],
      "env": { "SNAPEX_API_KEY": "smk_…" }
    }
  }
}
```

(`SNAPEX_API_KEY` is optional: without it the agent calls `create_account` and the key is saved for the next runs.)

### claude.ai and ChatGPT connectors

Add a custom connector with the URL `https://pay.snapex.pro/mcp` and no authentication. These clients cannot send
headers, so after `create_account` take `mcp_personal_url` from its answer (also returned by `get_account`) and use it
as the connector URL — every new chat then works with the same account. That URL contains a credential: treat it as a password.

### OpenAI Responses API

```json
{
  "type": "mcp",
  "server_label": "snapex_pay",
  "server_url": "https://pay.snapex.pro/mcp",
  "headers": { "Authorization": "Bearer smk_…" },
  "require_approval": { "always": { "tool_names": ["create_payout", "create_conversion"] } }
}
```

### Other clients and catalogs

The repository carries the manifests the catalogs read: `server.json` (official MCP Registry), `glama.json` (Glama),
`gemini-extension.json` + `GEMINI.md` (Gemini CLI), `lhm.plugin.json` (LobeHub), `.cursor-plugin/plugin.json` +
`mcp.json` (Cursor Marketplace), `plugin.json` (Agent Plugins / Kiro), `llms-install.md` (Cline).

### Docker

```bash
docker build -t snapex-pay-mcp .
docker run -i --rm -e SNAPEX_API_KEY=smk_… snapex-pay-mcp
```

## Tools

**Account**

| Tool | What it does |
|---|---|
| `create_account` | Open a SnapEX Pay account (no captcha) |
| `get_account` | Show the current account and key |

**Catalogue (no key needed)**

| Tool | What it does |
|---|---|
| `list_assets` | List coins and networks |
| `get_fiat_rates` | Fiat exchange rates |
| `get_fees` | Current route fee quotes |
| `list_static_address_networks` | Networks for permanent addresses |

**Balance**

| Tool | What it does |
|---|---|
| `get_balances` | Account balance |
| `list_transactions` | Balance history |

**Receive**

| Tool | What it does |
|---|---|
| `create_invoice` | Create an invoice (receive crypto) |
| `get_invoice` | Invoice status |
| `list_invoices` | List invoices |
| `get_invoice_payment_methods` | Coins an invoice can be paid with |
| `select_invoice_payment_method` | Pick a coin for an invoice |
| `preview_payment` | Quote a direct payment |
| `create_payment` | Create a direct payment |
| `get_payment` | Payment status |
| `list_payments` | List payments |
| `create_static_address` | Permanent deposit address |
| `list_static_addresses` | List permanent addresses |
| `list_static_address_deposits` | Deposits to a permanent address |

**Send (payouts)**

| Tool | What it does |
|---|---|
| `preview_payout` | Quote a payout (send crypto) |
| `create_payout` | Send a payout (irreversible) ⚠️ irreversible |
| `get_payout` | Payout status |
| `list_payouts` | List payouts |

**Exchange**

| Tool | What it does |
|---|---|
| `preview_conversion` | Quote a conversion (exchange) |
| `create_conversion` | Execute a conversion ⚠️ irreversible |
| `get_conversion` | Conversion status |
| `list_conversions` | List conversions |

**Webhooks**

| Tool | What it does |
|---|---|
| `list_webhooks` | List webhook endpoints |
| `create_webhook` | Add a webhook endpoint |
| `update_webhook` | Change a webhook endpoint |
| `rotate_webhook_secret` | New webhook secret ⚠️ irreversible |

Resources: `snapex://docs/quickstart`, `snapex://docs/webhooks`. Prompts: `accept_crypto_payment`, `send_crypto_payout`.

## Environment (stdio package)

| Variable | Default | Meaning |
|---|---|---|
| `SNAPEX_API_KEY` | — | Merchant API key `smk_…`. Optional: `create_account` makes one. |
| `SNAPEX_BASE_URL` | `https://pay.snapex.pro` | API base URL. |
| `SNAPEX_CREDENTIALS_FILE` | `~/.config/snapex-pay/credentials.json` | Where a key from `create_account` is saved (mode 600). |
| `SNAPEX_NO_SAVE` | — | `1` — do not save credentials to disk. |

## Safety

- An agent moves only its own account's money; a new account starts at zero.
- The key and the generated password are shown once. A person can open the cabinet with the login and password and revoke or rotate keys there.
- Payouts are two-step (quote, then send) and need an `idempotency_key`; `create_payout`, `create_conversion` and
  `rotate_webhook_secret` are marked `destructiveHint`, so clients can ask before running them.
- Limits: a few new accounts per IP per hour; about 120 API calls a minute per key; payouts 5 a minute and 30 an hour.
- Rules for what can be sold: <https://pay.snapex.pro/rules>.

## Development

The tool list is generated from the SnapEX Pay server (`app/Mcp/McpToolCatalog.php`):

```bash
php artisan mcp:export-tools      # writes src/tools.json, syncs the version of the manifests and LobeHub's tools
npm ci && npm test                # build + offline smoke test with the official MCP SDK client
SNAPEX_E2E_BASE_URL=http://127.0.0.1:8765 node test/smoke.mjs   # full flow against a local (never production) server
```

## Support

Chat: <https://pay.snapex.pro/#chat> · Privacy: <https://pay.snapex.pro/privacy> · Terms: <https://pay.snapex.pro/terms>

## License

MIT
