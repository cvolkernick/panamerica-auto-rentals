import asyncio
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

_spec = importlib.util.spec_from_file_location(
    "panam_car_mcp", Path(__file__).resolve().parents[1] / "panam_car_mcp.py")
pm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pm)

TOKEN = "test-team-token-0123456789abcdefghij"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("PANAM_TEAM_TOKEN", TOKEN)
    monkeypatch.setenv("PANAM_AGENT_NAME", "Forge ⚡")
    monkeypatch.setenv("PANAM_API_BASE", "https://portal.test/")


def _transport(status=200, body=None, seen=None):
    def handler(req):
        if seen is not None:
            seen.append(req)
        return httpx.Response(status, json=body if body is not None else {})
    return httpx.MockTransport(handler)


def test_list_cars_sends_token_and_agent():
    seen = []
    out = pm.list_cars(transport=_transport(body={"cars": []}, seen=seen))
    assert out == {"cars": []}
    req = seen[0]
    assert str(req.url) == "https://portal.test/api/portal/team/cars"
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert req.headers["x-agent-name"] == "Forge %E2%9A%A1"


def test_add_expense_body():
    seen = []
    pm.add_expense(2, "2026-11-20", "maintenance", 4599, "Oil change", transport=_transport(201, {"expense": {}}, seen))
    req = seen[0]
    assert req.method == "POST"
    assert req.url.path == "/api/portal/team/cars/2/expenses"
    assert json.loads(req.content) == {
        "entryDate": "2026-11-20", "category": "maintenance", "amountCents": 4599, "note": "Oil change"}


@pytest.mark.parametrize("kwargs", [
    {"entry_date": "11/20/2026", "category": "maintenance", "amount_cents": 1},
    {"entry_date": "2026-11-20", "category": "commission", "amount_cents": 1},
    {"entry_date": "2026-11-20", "category": "maintenance", "amount_cents": 0},
    {"entry_date": "2026-11-20", "category": "maintenance", "amount_cents": 45.99},
    {"entry_date": "2026-11-20", "category": "maintenance", "amount_cents": 5_000_001},
])
def test_add_expense_rejects_bad_input_before_sending(kwargs):
    seen = []
    with pytest.raises(pm.CarConnectorError):
        pm.add_expense(2, transport=_transport(seen=seen), **kwargs)
    assert seen == []


def test_update_car_refuses_owner_field():
    with pytest.raises(pm.CarConnectorError):
        pm.update_car(1, {"ownerId": 2})


def test_add_income_body_and_month_param():
    seen = []
    pm.add_income(3, "2026-11-01", "2026-11-04", 30000, transport=_transport(201, {}, seen))
    assert json.loads(seen[0].content) == {"startDate": "2026-11-01", "endDate": "2026-11-04", "payoutCents": 30000}
    pm.get_statement(3, "2026-11", transport=_transport(body={}, seen=seen))
    assert seen[1].url.params["month"] == "2026-11"
    with pytest.raises(pm.CarConnectorError):
        pm.get_statement(3, "2026-13")


def test_errors_never_echo_token():
    with pytest.raises(pm.CarConnectorError) as ei:
        pm.list_cars(transport=_transport(401, {"error": "unauthorized"}))
    assert "401" in str(ei.value) and TOKEN not in str(ei.value)

    def echo(req):
        return httpx.Response(400, text="bad " + req.headers["authorization"])
    with pytest.raises(pm.CarConnectorError) as ei:
        pm.get_car(1, transport=httpx.MockTransport(echo))
    assert TOKEN not in str(ei.value)


def test_missing_agent_name(monkeypatch):
    monkeypatch.delenv("PANAM_AGENT_NAME")
    with pytest.raises(pm.CarConnectorError):
        pm.list_cars(transport=_transport())


def test_token_file(monkeypatch, tmp_path):
    monkeypatch.delenv("PANAM_TEAM_TOKEN")
    f = tmp_path / "token"
    f.write_text(TOKEN + "\n")
    monkeypatch.setenv("PANAM_TEAM_TOKEN_FILE", str(f))
    seen = []
    pm.list_cars(transport=_transport(seen=seen))
    assert seen[0].headers["authorization"] == f"Bearer {TOKEN}"


def test_tool_registration_has_no_payout_or_car_delete_tools():
    server = pm.build_server()
    names = {t.name for t in asyncio.run(server.list_tools())}
    assert names == set(pm.TOOL_NAMES)
    assert not any("payout" in n or n == "panam_delete_car" or "close" in n for n in names)


MANAGER_ITEM = {
    "car_id": 2,
    "manager": {"id": 3, "name": "Ana Example", "since": "2026-11-01",
                "contact_ref": "manager:3", "has_portal_account": True},
    "owner_type": "company",
}


def test_get_car_manager_is_a_read_only_get():
    seen = []
    body = {"as_of": "2026-11-25", **MANAGER_ITEM}
    out = pm.get_car_manager(2, transport=_transport(body=body, seen=seen))
    assert out == body
    req = seen[0]
    assert req.method == "GET"
    assert str(req.url) == "https://portal.test/api/portal/team/cars/2/manager"
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert req.content == b""


def test_get_car_manager_rejects_bad_ids_before_sending():
    seen = []
    for bad in (0, -1, "2; drop", None):
        with pytest.raises(pm.CarConnectorError):
            pm.get_car_manager(bad, transport=_transport(seen=seen))
    assert seen == []


def test_get_car_manager_unknown_car_is_a_clear_error():
    with pytest.raises(pm.CarConnectorError, match="404"):
        pm.get_car_manager(999, transport=_transport(404, {"error": "car_not_found"}))


def test_list_car_managers_is_a_read_only_get():
    seen = []
    body = {"as_of": "2026-11-25", "assignments": [MANAGER_ITEM,
            {"car_id": 5, "manager": None, "owner_type": "client"}]}
    out = pm.list_car_managers(transport=_transport(body=body, seen=seen))
    assert out == body
    req = seen[0]
    assert req.method == "GET"
    assert str(req.url) == "https://portal.test/api/portal/team/managers/assignments"
    assert not any("phone" in k or "email" in k for item in out["assignments"] for k in item)


def test_manager_tools_are_registered_and_read_only():
    server = pm.build_server()
    tools = {t.name: t for t in asyncio.run(server.list_tools())}
    assert {"panam_get_car_manager", "panam_list_car_managers"} <= set(tools)
    assert set(tools["panam_get_car_manager"].inputSchema.get("properties", {})) == {"car_id"}
    assert set(tools["panam_list_car_managers"].inputSchema.get("properties", {})) == set()
