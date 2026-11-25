"""Panamerica car connector: stdio MCP server over the portal team API.

Team agents read and write car records through /api/portal/team/* with one scoped
service token (PANAM_TEAM_TOKEN or PANAM_TEAM_TOKEN_FILE) and their own name
(PANAM_AGENT_NAME), which the portal stores on every write in its write log.

Scope: list/read cars, edit car details, list/add/edit expenses, list income and
add/edit manual income, read statements and the write log, and remove an entry
the connector itself created (for corrections). No car create or delete, no owner
moves, no payouts, no period close, no guest data. Receipt photos are read by the
caller before calling; this server only takes structured fields.

Env:
  PANAM_TEAM_TOKEN       bearer token (else read from PANAM_TEAM_TOKEN_FILE)
  PANAM_TEAM_TOKEN_FILE  default ~/.config/panam-car-connector/token (mode 600)
  PANAM_AGENT_NAME       required; the calling agent's name, e.g. "Forge"
  PANAM_API_BASE         default https://www.panamericafleet.com
  PANAM_TIMEOUT          seconds, default 20
"""
from __future__ import annotations

import datetime as _dt
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

DEFAULT_BASE = "https://www.panamericafleet.com"
DEFAULT_TOKEN_FILE = "~/.config/panam-car-connector/token"
EXPENSE_CATEGORIES = (
    "maintenance", "cleaning", "tolls", "insurance", "fuel",
    "registration", "parking", "supplies", "other",
)
MAX_ENTRY_CENTS = 5_000_000  # keep equal to lib/portal/team-store.ts and connector-capabilities.ts
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class CarConnectorError(RuntimeError):
    """Error safe to surface to the MCP client (never contains the token)."""


def _base_url() -> str:
    return os.environ.get("PANAM_API_BASE", DEFAULT_BASE).rstrip("/")


def _token() -> str:
    tok = os.environ.get("PANAM_TEAM_TOKEN", "").strip()
    if tok:
        return tok
    path = Path(os.path.expanduser(os.environ.get("PANAM_TEAM_TOKEN_FILE", DEFAULT_TOKEN_FILE)))
    try:
        tok = path.read_text().strip()
    except OSError:
        tok = ""
    if not tok:
        raise CarConnectorError(
            "No team token: set PANAM_TEAM_TOKEN or PANAM_TEAM_TOKEN_FILE"
        )
    return tok


def _agent() -> str:
    name = os.environ.get("PANAM_AGENT_NAME", "").strip()
    if not name or len(name) > 80:
        raise CarConnectorError("Set PANAM_AGENT_NAME to the calling agent's name (1-80 characters)")
    return name


def _check_month(month: str | None) -> dict[str, str] | None:
    if month in (None, ""):
        return None
    if not _MONTH.match(month):
        raise CarConnectorError(f"month must be YYYY-MM, got {month!r}")
    return {"month": month}


def _check_date(name: str, value: str | None) -> None:
    if value is None:
        return
    try:
        _dt.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise CarConnectorError(f"{name} must be YYYY-MM-DD, got {value!r}") from None


def _check_cents(name: str, value: Any, *, positive: bool = True) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, int):
        raise CarConnectorError(f"{name} must be a whole number of cents")
    if value < (1 if positive else 0):
        raise CarConnectorError(f"{name} must be {'positive' if positive else 'zero or more'}")
    if value > MAX_ENTRY_CENTS:
        raise CarConnectorError(f"{name} is over the per-entry cap of {MAX_ENTRY_CENTS} cents")


def _error_code(resp: httpx.Response) -> str | None:
    try:
        body = resp.json()
    except ValueError:
        return None
    return body.get("error") if isinstance(body, dict) else None


def request(method: str, path: str, *, params: dict | None = None, body: dict | None = None,
            transport: httpx.BaseTransport | None = None) -> Any:
    """Call the team API and return the decoded JSON."""
    url = f"{_base_url()}/api/portal/team{path}"
    token = _token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "X-Agent-Name": quote(_agent(), safe=" ._-()"),
    }
    kwargs: dict[str, Any] = {"timeout": float(os.environ.get("PANAM_TIMEOUT", "20"))}
    if transport is not None:
        kwargs["transport"] = transport
    try:
        with httpx.Client(**kwargs) as client:
            resp = client.request(method, url, params=params or None, json=body, headers=headers)
    except httpx.TimeoutException:
        raise CarConnectorError(f"Portal API timed out: {url}") from None
    except (httpx.TransportError, OSError) as exc:
        raise CarConnectorError(
            f"Portal API unreachable at {url} ({type(exc).__name__}); check PANAM_API_BASE"
        ) from None
    if resp.status_code == 401:
        raise CarConnectorError("Portal returned 401 Unauthorized: team token missing, wrong or rotated")
    if resp.status_code == 403 and _error_code(resp) == "read_only_token":
        raise CarConnectorError(
            f"Portal refused {method} {path}: this team token is read-only, so writes are not allowed. "
            "Nothing was saved."
        )
    if resp.status_code == 404 and path in ("/cars", "/whoami"):
        raise CarConnectorError("Portal returned 404: the team connector is not enabled on this deploy")
    if resp.status_code >= 400:
        detail = resp.text[:400].replace(token, "***")
        raise CarConnectorError(f"Portal {method} {path} returned HTTP {resp.status_code}: {detail}")
    try:
        return resp.json()
    except ValueError:
        raise CarConnectorError(f"Portal {method} {path} returned a non-JSON body") from None


def _id(name: str, value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise CarConnectorError(f"{name} must be a positive integer id")
    return value


def _clean(body: dict) -> dict:
    return {k: v for k, v in body.items() if v is not None}


# ---- operations (plain functions so tests can call them with a mock transport) ----

def list_cars(transport=None):
    return request("GET", "/cars", transport=transport)


def get_car(car_id: int, transport=None):
    return request("GET", f"/cars/{_id('car_id', car_id)}", transport=transport)


def update_car(car_id: int, fields: dict, transport=None):
    allowed = {"year", "make", "model", "color", "licensePlate", "vin"}
    extra = set(fields) - allowed
    if extra:
        raise CarConnectorError(f"cannot set {sorted(extra)}; allowed: {sorted(allowed)}")
    body = _clean(fields)
    if not body:
        raise CarConnectorError("nothing to update")
    return request("PATCH", f"/cars/{_id('car_id', car_id)}", body=body, transport=transport)


def list_expenses(car_id: int, month: str | None = None, transport=None):
    return request("GET", f"/cars/{_id('car_id', car_id)}/expenses", params=_check_month(month), transport=transport)


def _expense_body(entry_date, category, amount_cents, note, *, partial: bool) -> dict:
    if not partial or entry_date is not None:
        _check_date("entry_date", entry_date)
        if entry_date is None:
            raise CarConnectorError("entry_date is required")
    if category is not None or not partial:
        if category not in EXPENSE_CATEGORIES:
            raise CarConnectorError(f"category must be one of {', '.join(EXPENSE_CATEGORIES)}")
    if amount_cents is not None or not partial:
        if amount_cents is None:
            raise CarConnectorError("amount_cents is required")
        _check_cents("amount_cents", amount_cents)
    if note is not None and len(note) > 200:
        raise CarConnectorError("note must be 200 characters or fewer")
    return _clean({"entryDate": entry_date, "category": category, "amountCents": amount_cents, "note": note})


def add_expense(car_id: int, entry_date: str, category: str, amount_cents: int,
                note: str | None = None, transport=None):
    body = _expense_body(entry_date, category, amount_cents, note, partial=False)
    return request("POST", f"/cars/{_id('car_id', car_id)}/expenses", body=body, transport=transport)


def update_expense(car_id: int, expense_id: int, entry_date=None, category=None,
                   amount_cents=None, note=None, transport=None):
    body = _expense_body(entry_date, category, amount_cents, note, partial=True)
    if not body:
        raise CarConnectorError("nothing to update")
    return request("PATCH", f"/cars/{_id('car_id', car_id)}/expenses/{_id('expense_id', expense_id)}",
                   body=body, transport=transport)


def delete_expense(car_id: int, expense_id: int, transport=None):
    return request("DELETE", f"/cars/{_id('car_id', car_id)}/expenses/{_id('expense_id', expense_id)}",
                   transport=transport)


def list_income(car_id: int, month: str | None = None, transport=None):
    return request("GET", f"/cars/{_id('car_id', car_id)}/income", params=_check_month(month), transport=transport)


def _income_body(start_date, end_date, payout_cents, gross_cents, platform_fees_cents, tax_cents, *, partial):
    for name, value in (("start_date", start_date), ("end_date", end_date)):
        if value is None and not partial:
            raise CarConnectorError(f"{name} is required")
        _check_date(name, value)
    if payout_cents is None and not partial:
        raise CarConnectorError("payout_cents is required")
    _check_cents("payout_cents", payout_cents)
    _check_cents("gross_cents", gross_cents)
    _check_cents("platform_fees_cents", platform_fees_cents, positive=False)
    _check_cents("tax_cents", tax_cents, positive=False)
    return _clean({
        "startDate": start_date, "endDate": end_date, "payoutCents": payout_cents,
        "grossCents": gross_cents, "platformFeesCents": platform_fees_cents, "taxCents": tax_cents,
    })


def add_income(car_id: int, start_date: str, end_date: str, payout_cents: int, gross_cents=None,
               platform_fees_cents=None, tax_cents=None, transport=None):
    body = _income_body(start_date, end_date, payout_cents, gross_cents, platform_fees_cents, tax_cents,
                        partial=False)
    return request("POST", f"/cars/{_id('car_id', car_id)}/income", body=body, transport=transport)


def update_income(car_id: int, income_id: int, start_date=None, end_date=None, payout_cents=None,
                  gross_cents=None, platform_fees_cents=None, tax_cents=None, transport=None):
    body = _income_body(start_date, end_date, payout_cents, gross_cents, platform_fees_cents, tax_cents,
                        partial=True)
    if not body:
        raise CarConnectorError("nothing to update")
    return request("PATCH", f"/cars/{_id('car_id', car_id)}/income/{_id('income_id', income_id)}",
                   body=body, transport=transport)


def delete_income(car_id: int, income_id: int, transport=None):
    return request("DELETE", f"/cars/{_id('car_id', car_id)}/income/{_id('income_id', income_id)}",
                   transport=transport)


def get_statement(car_id: int, month: str | None = None, transport=None):
    return request("GET", f"/cars/{_id('car_id', car_id)}/statement", params=_check_month(month),
                   transport=transport)


def get_car_manager(car_id: int, transport=None):
    return request("GET", f"/cars/{_id('car_id', car_id)}/manager", transport=transport)


def list_car_managers(transport=None):
    return request("GET", "/managers/assignments", transport=transport)


def get_write_log(car_id: int | None = None, limit: int = 50, transport=None):
    params: dict[str, str] = {"limit": str(max(1, min(int(limit), 200)))}
    if car_id is not None:
        params["carId"] = str(_id("car_id", car_id))
    return request("GET", "/write-log", params=params, transport=transport)


TOOL_NAMES = (
    "panam_list_cars", "panam_get_car", "panam_update_car",
    "panam_list_expenses", "panam_add_expense", "panam_update_expense", "panam_delete_expense",
    "panam_list_income", "panam_add_income", "panam_update_income", "panam_delete_income",
    "panam_get_statement", "panam_get_write_log",
    "panam_get_car_manager", "panam_list_car_managers",
)


def build_server():
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("panam-cars")

    @mcp.tool()
    def panam_list_cars() -> dict:
        """All fleet cars: id, year, make, model, color, licensePlate, vin, ownerId (no owner name or email)."""
        return list_cars()

    @mcp.tool()
    def panam_get_car(car_id: int) -> dict:
        """One car by id."""
        return get_car(car_id)

    @mcp.tool()
    def panam_update_car(car_id: int, year: int | None = None, make: str | None = None,
                         model: str | None = None, color: str | None = None,
                         license_plate: str | None = None, vin: str | None = None) -> dict:
        """Edit car details. Only the fields you pass change. Cannot move a car to another owner or delete it."""
        return update_car(car_id, {"year": year, "make": make, "model": model, "color": color,
                                   "licensePlate": license_plate, "vin": vin})

    @mcp.tool()
    def panam_list_expenses(car_id: int, month: str | None = None) -> dict:
        """Expenses for one car. month is YYYY-MM (America/New_York); omit for all."""
        return list_expenses(car_id, month)

    @mcp.tool()
    def panam_add_expense(car_id: int, entry_date: str, category: str, amount_cents: int,
                          note: str | None = None) -> dict:
        """Add one expense to one car. Read the receipt yourself first and pass structured fields.

        entry_date YYYY-MM-DD (the receipt date). amount_cents is a positive integer
        (e.g. $45.99 -> 4599). category: maintenance, cleaning, tolls, insurance, fuel,
        registration, parking, supplies, other. note (<=200 chars): vendor and what it was;
        no emails, phone numbers, or guest names. If the car, date, amount or category is
        unclear, ask before calling. Expenses come out of the car's proceeds; any shortfall
        carries forward. The management fee is computed by the statement, never entered here.
        """
        return add_expense(car_id, entry_date, category, amount_cents, note)

    @mcp.tool()
    def panam_update_expense(car_id: int, expense_id: int, entry_date: str | None = None,
                             category: str | None = None, amount_cents: int | None = None,
                             note: str | None = None) -> dict:
        """Correct an expense. Only the fields you pass change."""
        return update_expense(car_id, expense_id, entry_date, category, amount_cents, note)

    @mcp.tool()
    def panam_delete_expense(car_id: int, expense_id: int) -> dict:
        """Remove an expense the connector itself created (a mistaken entry). Admin-entered rows are refused."""
        return delete_expense(car_id, expense_id)

    @mcp.tool()
    def panam_list_income(car_id: int, month: str | None = None) -> dict:
        """Trip income for one car (imported Turo/Wheelbase trips plus manual entries). month is YYYY-MM."""
        return list_income(car_id, month)

    @mcp.tool()
    def panam_add_income(car_id: int, start_date: str, end_date: str, payout_cents: int,
                         gross_cents: int | None = None, platform_fees_cents: int | None = None,
                         tax_cents: int | None = None) -> dict:
        """Add one trip's income by hand (for trips not covered by a platform import).

        payout_cents is the platform's actual net payout for the trip. The trip length
        (start_date to end_date) sets the fee tier: under 7 days 20%, 7-21 days 15%,
        over 21 days 10%; the statement figures the fee. Do not duplicate a trip that a
        Turo or Wheelbase import already has.
        """
        return add_income(car_id, start_date, end_date, payout_cents, gross_cents, platform_fees_cents, tax_cents)

    @mcp.tool()
    def panam_update_income(car_id: int, income_id: int, start_date: str | None = None,
                            end_date: str | None = None, payout_cents: int | None = None,
                            gross_cents: int | None = None, platform_fees_cents: int | None = None,
                            tax_cents: int | None = None) -> dict:
        """Correct a manual income entry. Imported trips are read-only (fix them by re-import)."""
        return update_income(car_id, income_id, start_date, end_date, payout_cents, gross_cents,
                             platform_fees_cents, tax_cents)

    @mcp.tool()
    def panam_delete_income(car_id: int, income_id: int) -> dict:
        """Remove a manual income entry the connector itself created."""
        return delete_income(car_id, income_id)

    @mcp.tool()
    def panam_get_statement(car_id: int, month: str | None = None) -> dict:
        """Read-only monthly statement: income, expenses, management fee, running balance, payout due."""
        return get_statement(car_id, month)

    @mcp.tool()
    def panam_get_write_log(car_id: int | None = None, limit: int = 50) -> dict:
        """Recent connector writes (newest first) with agent name, action, before and after."""
        return get_write_log(car_id, limit)

    @mcp.tool()
    def panam_get_car_manager(car_id: int) -> dict:
        """Read-only: who manages this car today (America/New_York).

        Returns {as_of, car_id, manager, owner_type}. manager is null when nobody is assigned,
        else {id, name, since (assignment start date), contact_ref ("manager:<id>"),
        has_portal_account}. owner_type is "company" (Panamerica-owned) or "client".
        No owner names, emails, or phone numbers: map contact_ref to a contact yourself.
        """
        return get_car_manager(car_id)

    @mcp.tool()
    def panam_list_car_managers() -> dict:
        """Read-only: today's manager for every car. {as_of, assignments: [{car_id, manager, owner_type}]}.

        Same item shape as panam_get_car_manager. Use it to route a car question to the right person.
        """
        return list_car_managers()

    return mcp


def main() -> None:
    build_server().run()  # stdio


if __name__ == "__main__":
    main()
