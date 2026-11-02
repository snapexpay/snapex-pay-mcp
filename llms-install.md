# Installing the SnapEX Pay MCP server (for Cline and other AI installers)

SnapEX Pay is a hosted MCP server — nothing to build or run locally, and no API key is needed to install.

## 1. Add the server

Add this entry to the MCP settings (`cline_mcp_settings.json` in Cline):

```json
{
  "mcpServers": {
    "snapex-pay": {
      "type": "streamableHttp",
      "url": "https://pay.snapex.pro/mcp"
    }
  }
}
```

If the client cannot connect to remote servers, use the local package instead (Node.js 18+):

```json
{
  "mcpServers": {
    "snapex-pay": {
      "command": "npx",
      "args": ["-y", "snapex-pay-mcp"]
    }
  }
}
```

## 2. Check it works

Call the tool `list_assets` — it needs no key and returns the coins and networks.

## 3. Account and key (no captcha)

Call `create_account`. It returns `api_key` (shown once), `login`/`password` for the cabinet and `mcp_personal_url`.
On the remote server the key is used for the rest of the session automatically; with the local package it is kept for
the process and saved to `~/.config/snapex-pay/credentials.json`. To keep the same account in new sessions, add the
header `Authorization: Bearer <api_key>` (remote) or the env `SNAPEX_API_KEY` (local):

```json
{
  "mcpServers": {
    "snapex-pay": {
      "type": "streamableHttp",
      "url": "https://pay.snapex.pro/mcp",
      "headers": { "Authorization": "Bearer smk_..." }
    }
  }
}
```

Ask the user to save `api_key`, `login` and `password` somewhere safe. Payouts (`create_payout`) move real money and are
irreversible: always run `preview_payout` first and confirm the address and amount with the user.

Docs: https://pay.snapex.pro/mcp · Privacy: https://pay.snapex.pro/privacy · Terms: https://pay.snapex.pro/terms ·
Support: https://pay.snapex.pro/#chat
