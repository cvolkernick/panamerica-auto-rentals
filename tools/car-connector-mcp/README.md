# Panamerica car connector (MCP)

A thin stdio MCP server over the portal team API (`/api/portal/team/*`), modeled on
the FitDash MCP. Team agents use it to read and write car records. It does not read
receipt photos: the calling agent reads the receipt itself and passes structured
fields (date, category, amount in cents, short note). If anything is unclear, ask
before writing.

| Tool | Endpoint | Access |
|------|----------|--------|
| `panam_list_cars` | `GET /cars` | read |
| `panam_get_car(car_id)` | `GET /cars/:id` | read |
| `panam_update_car(car_id, year?, make?, model?, color?, license_plate?, vin?)` | `PATCH /cars/:id` | write |
| `panam_list_expenses(car_id, month?)` | `GET /cars/:id/expenses` | read |
| `panam_add_expense(car_id, entry_date, category, amount_cents, note?)` | `POST /cars/:id/expenses` | write |
| `panam_update_expense(car_id, expense_id, ...)` | `PATCH /cars/:id/expenses/:eid` | write |
| `panam_delete_expense(car_id, expense_id)` | `DELETE /cars/:id/expenses/:eid` (connector-created rows only) | write |
| `panam_list_income(car_id, month?)` | `GET /cars/:id/income` | read |
| `panam_add_income(car_id, start_date, end_date, payout_cents, ...)` | `POST /cars/:id/income` | write |
| `panam_update_income(car_id, income_id, ...)` | `PATCH /cars/:id/income/:tid` (manual income only) | write |
| `panam_delete_income(car_id, income_id)` | `DELETE /cars/:id/income/:tid` (connector-created manual income only) | write |
| `panam_get_statement(car_id, month?)` | `GET /cars/:id/statement` | read |
| `panam_get_write_log(car_id?, limit?)` | `GET /write-log` | read |
| `panam_get_car_manager(car_id)` | `GET /cars/:id/manager` | read |
| `panam_list_car_managers()` | `GET /managers/assignments` | read |

### Car-to-manager lookup

Read-only. "Today" is the America/New_York date. The current manager is the assignment
with `start_date <= today` and no `end_date` or `end_date > today` (start inclusive, end
exclusive, the same rule as statements). A car with no covering assignment has
`manager: null`.

```json
{
  "as_of": "2026-11-25",
  "car_id": 2,
  "manager": {
    "id": 3,
    "name": "Ana Example",
    "since": "2026-11-01",
    "contact_ref": "manager:3",
    "has_portal_account": true
  },
  "owner_type": "company"
}
```

`GET /managers/assignments` returns `{"as_of": "...", "assignments": [ ...same item without as_of... ]}`,
one item per car in car-id order. `owner_type` is `company` when the car's owner is an admin
account (Panamerica-owned) and `client` otherwise. No owner names, no emails, and no phone
numbers are returned; map `contact_ref` to a contact in your own address book.

Not available, on purpose: creating or deleting cars, moving a car to another owner,
payouts, period close, owner records (car data carries `ownerId` only), guest data,
manager emails or phone numbers, assigning or changing a car's manager,
and `commission` expenses (the management fee is computed by the statement from trip
income; existing commission rows are admin-only). Each entry is capped at 5,000,000
cents ($50,000). `PANAM_AGENT_NAME` is a self-asserted label for the write log, not a
credential.

Money rules stay in the portal: expenses come out of the car's proceeds, a shortfall
carries forward, payouts are due only on a net surplus, and the fee is figured per
trip on the platform's net payout (under 7 days 20%, 7-21 days 15%, over 21 days 10%).
Each car is self-contained.

## Install

```bash
python3 -m venv ~/.venvs/panam-car-mcp
~/.venvs/panam-car-mcp/bin/pip install -r tools/car-connector-mcp/requirements.txt
```

## Configuration (env)

| Var | Default | Notes |
|-----|---------|-------|
| `PANAM_TEAM_TOKEN` | — | Bearer token. Takes precedence over the file. |
| `PANAM_TEAM_TOKEN_FILE` | `~/.config/panam-car-connector/token` | Keep it mode 600. Never commit it. |
| `PANAM_AGENT_NAME` | — | Required. Your agent name; stored on every write. |
| `PANAM_API_BASE` | `https://www.panamericafleet.com` | |
| `PANAM_TIMEOUT` | `20` | seconds |

The server side reads the same secret as `PORTAL_TEAM_TOKEN` (a Pages secret). Unset
or shorter than 32 characters means `/api/portal/team` answers 404.

### Read-only token

An agent that should only read gets the read-only token (`PORTAL_TEAM_READ_TOKEN` on the
server) in its token file instead. It works with every read tool (cars, expenses, income,
statements, write log, manager lookup). A write tool called with it raises
`CarConnectorError` ("this team token is read-only, so writes are not allowed. Nothing was
saved.") from the server's 403 `read_only_token`. The token never appears in the error. Nothing
is written and no log row is added. Check which token a session has with `GET /whoami`
(`tokenScope`: `full` or `read`).

## Register it

```json
{
  "mcpServers": {
    "panam-cars": {
      "command": "/home/you/.venvs/panam-car-mcp/bin/python",
      "args": ["/path/to/panamerica-auto-rentals/tools/car-connector-mcp/panam_car_mcp.py"],
      "env": {
        "PANAM_TEAM_TOKEN_FILE": "/path/to/token",
        "PANAM_AGENT_NAME": "YourAgentName"
      }
    }
  }
}
```

## Tests

```bash
python -m pytest -q tools/car-connector-mcp/tests
```
