# SnapEX Pay (MCP)

Crypto payments for this agent: receive (invoices, permanent addresses), send (payouts in many coins) and exchange.

- No API key yet: call `create_account` once — no captcha. The new key works for the rest of the session; tell the user
  to save `api_key` and the cabinet `login`/`password` from the answer (shown once).
- Receive: `create_invoice` (use `environment: "test"` first — no real money) → give `pay_url` → `get_invoice` until `paid`.
- Send: `preview_payout` → show the user `to_amount` and the fee → `create_payout` with the `preview_id` and a new `idempotency_key`.
  A payout is irreversible: confirm the address and amount with the user before `create_payout`.
- Every error has `what_to_do`. Docs: https://pay.snapex.pro/mcp
