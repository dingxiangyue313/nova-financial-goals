# NOVA Banking Sandbox / MCP

The server exposes the same governed tool catalog through:

- `GET /api/banking-tools` — REST discovery
- `POST /api/banking-tools` — REST tool call: `{ "tool": "...", "input": {} }`
- `POST /api/mcp` — MCP JSON-RPC `initialize`, `tools/list`, and `tools/call`

All amounts use the smallest currency unit. All write tools require an approval token or an applicable Mandate and an idempotency key. An `unknown` result is never promoted to success. User identity is supplied by the server session; request-provided user IDs are ignored.

## Included tools

Financial Twin: `get_financial_snapshot`, `list_accounts`, `list_transactions`, `forecast_cashflow`.

Goals and movement: `simulate_goal_plan`, `create_goal`, `prepare_transfer`, `execute_transfer`, `get_operation_status`.

Agent commerce: `create_mandate`, `evaluate_agent_payment`, `execute_agent_payment`, `pause_mandate`, `revoke_mandate`.

Governance: `create_approval_snapshot`, `confirm_approval`, `permission_check`, `risk_check`, `append_audit_event`, `export_audit_report`.

Intelligence and lifestyle: `detect_financial_signals`, `explain_decision`, `compare_scenarios`, `get_goal_progress`, `list_bills`, `list_subscriptions`, `compare_cards`, `quote_fx`, `prepare_fx_order`, `execute_fx_order`.

`confirm_approval` cannot be invoked through MCP. It requires an explicit first-party UI confirmation signaled by the server route, preventing a model or external agent from approving its own action.
