# Team connector API (`/api/portal/team`)

Server side of the car connector MCP (`tools/car-connector-mcp`). See that README for tools.

- Auth: `Authorization: Bearer <PORTAL_TEAM_TOKEN>` (Pages secret, 32+ chars; unset = 404)
  and `X-Agent-Name` (1-80 chars, percent-encoded). Cookie sessions never reach these
  routes, and the token never opens `/api/portal/admin/*`.
- Every write adds a `team_write_log` row (migration 0007) with the agent name, action,
  car id, entity id, and before/after JSON.

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
