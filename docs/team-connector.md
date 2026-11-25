# Team connector API (`/api/portal/team`)

Server side of the car connector MCP (`tools/car-connector-mcp`). See that README for tools.

- Auth: `Authorization: Bearer <PORTAL_TEAM_TOKEN>` (Pages secret, 32+ chars; unset = 404)
  and `X-Agent-Name` (1-80 chars, percent-encoded). Cookie sessions never reach these
  routes, and the token never opens `/api/portal/admin/*`.
- Read-only token (optional): `Authorization: Bearer <PORTAL_TEAM_READ_TOKEN>` (Pages secret,
  32+ chars). It opens every `GET` route below. Any other method answers
  `403 {"error":"read_only_token"}` before any D1 read or `team_write_log` row. Unset, empty
  or short means it never matches (a blank Bearer is a 401). Both tokens are compared in
  constant time on every request. The full token is unchanged, and the API still needs
  `PORTAL_TEAM_TOKEN` set to be enabled at all. `/whoami` reports `tokenScope`
  (`full` or `read`) and the matching `scope` list.
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
| GET | `/whoami` | agent name, `tokenScope` (`full`/`read`) and scope list |
| GET | `/cars` | owner email removed |
| GET, PATCH | `/cars/:id` | PATCH: year, make, model, color, licensePlate, vin. No ownerId. No DELETE. |
| GET, POST | `/cars/:id/expenses` | `?month=YYYY-MM`. No `commission`; no emails or phone numbers in notes. |
| GET, PATCH, DELETE | `/cars/:id/expenses/:eid` | DELETE only for connector-created rows |
| GET, POST | `/cars/:id/income` | POST adds manual income (platform `manual`): startDate, endDate, payoutCents (platform net payout), optional grossCents, platformFeesCents, taxCents |
| GET, PATCH, DELETE | `/cars/:id/income/:tid` | manual rows only; DELETE only for connector-created rows |
| GET | `/cars/:id/statement` | read-only; the fee, carry-forward and payout due come from `statement.ts` |
| GET | `/write-log` | `?carId=&limit=` (max 200), newest first |
| GET | `/cars/:id/manager` | read-only; today's manager (America/New_York) or `null`, plus `owner_type`; 404 for an unknown car |
| GET | `/managers/assignments` | read-only; the same item for every car, in car-id order |

Manager lookup item: `{car_id, manager: {id, name, since, contact_ref: "manager:<id>", has_portal_account} | null, owner_type: "company" | "client"}`. Single-car reads add `as_of` at the top level; the list is `{as_of, assignments: [...]}`. The current assignment covers today with `start_date` inclusive and `end_date` exclusive. `owner_type` is `company` when the car's owner is an admin account (stored `is_admin` or `ADMIN_EMAILS`), else `client`. It never returns owner names, emails, or phone numbers, and writes nothing (no `team_write_log` row).

There are no payout, period-close, owner, import, or car create/delete routes.

## Admin docs page

`/admin/connector/` shows what the connector can and can't do. The static page is only a loader. After the admin session check it fetches `GET /api/portal/admin/connector-capabilities`, which goes through the same server-side admin check as the other admin APIs: 401 when signed out (the team token does not count), 403 for non-admins.

`lib/portal/connector-capabilities.ts` is the one list to edit when a tool or rule changes. It is server-only: only `lib/portal/handler.ts` imports it.

- `tests/portal/connector-capabilities.test.ts` (in `npm test`) fails if the list drifts from the tools registered in `tools/car-connector-mcp/panam_car_mcp.py`, the per-entry cap, or the expense categories; if a page, component, or client module imports it; or if the endpoint answers without an admin session.
- `tests/build/connector-bundle.test.ts` (`npm run test:bundle`, run in CI right after `npm run build`) greps every file under `out/` for the tool names, summaries, can't-do lines, rules, and the cap, and fails on any hit. Only the `/admin/` link label and the page title are allow-listed.

A small link at the bottom of `/admin/` points to the page.
