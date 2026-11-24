# Team connector API (`/api/portal/team`)

Server side of the car connector MCP (`tools/car-connector-mcp`). See that README for tools.

- Auth: `Authorization: Bearer <PORTAL_TEAM_TOKEN>` (Pages secret, 32+ chars; unset = 404)
  and `X-Agent-Name` (1-80 chars, percent-encoded). Cookie sessions never reach these
  routes, and the token never opens `/api/portal/admin/*`.
- `X-Agent-Name` is self-asserted: a label for the write log, never an authorization input.
- Every write and its `team_write_log` row (migration 0007: agent name, action, car id,
  entity id, before/after JSON) run in one D1 batch, so a write never lands unlogged.
  Car JSON (reads and log) carries `ownerId` only: no owner name or email.
- Per-entry cap: 5,000,000 cents ($50,000) on expense amounts and every income field
  (`MAX_ENTRY_CENTS`).
- Commission expense rows are admin-only: the connector cannot create, edit,
  recategorize, or delete them.
- Basic per-isolate rate limit: 120 requests/min per client IP, and 10 bad-token
  attempts/min lock that IP out for the rest of the window (429).
- An admin car delete is refused with `car_has_connector_history` once the connector
  has written to that car (the log keeps a foreign key to the car).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/whoami` | agent name and scope |
| GET | `/cars` | owner email removed |
| GET, PATCH | `/cars/:id` | PATCH: year, make, model, color, licensePlate, vin. No ownerId. No DELETE. |
| GET, POST | `/cars/:id/expenses` | `?month=YYYY-MM`. No `commission`; no emails or phone numbers in notes. |
| GET, PATCH, DELETE | `/cars/:id/expenses/:eid` | DELETE only for connector-created rows |
| GET, POST | `/cars/:id/income` | POST adds manual income (platform `manual`): startDate, endDate, payoutCents (platform net payout), optional grossCents, platformFeesCents, taxCents |
| GET, PATCH, DELETE | `/cars/:id/income/:tid` | manual rows only; DELETE only for connector-created rows |
| GET | `/cars/:id/statement` | read-only; the fee, carry-forward and payout due come from `statement.ts` |
| GET | `/write-log` | `?carId=&limit=` (max 200), newest first |

There are no payout, period-close, owner, import, or car create/delete routes.

## Admin docs page

`/admin/connector/` (admin sign-in required) shows what the connector can and can't do. It renders from `lib/portal/connector-capabilities.ts`, the one list to edit when a tool or rule changes. `tests/portal/connector-capabilities.test.ts` fails if that list drifts from the tools registered in `tools/car-connector-mcp/panam_car_mcp.py`, the per-entry cap, or the expense categories. A small link at the bottom of `/admin/` points to it.
