import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { PortalD1 } from "../../lib/portal/d1";
import type { PortalEnv } from "../../lib/portal/env";
import { handlePortal } from "../../lib/portal/handler";
import { resetTeamRateLimit, TEAM_SCOPES } from "../../lib/portal/team";
import { call, devEnv, PANAMERICA, requireDb } from "./support";

const FULL = "f".repeat(24) + "-full-team-token-0123456789";
const READ = "r".repeat(24) + "-read-team-token-0123456789";
const AGENT = "Helm test";

function teamEnv(extra: Partial<PortalEnv> = {}): PortalEnv {
  return devEnv(PANAMERICA, { PORTAL_TEAM_TOKEN: FULL, PORTAL_TEAM_READ_TOKEN: READ, ...extra });
}

async function team(env: PortalEnv, token: string | null, method: string, path: string, body?: unknown) {
  const headers = new Headers({ "x-agent-name": AGENT });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handlePortal(
    new Request(`http://127.0.0.1/api/portal/team${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : null, text };
}

/** Same DB, but counts every prepare/batch so a test can prove a request never touched D1. */
function countingEnv(env: PortalEnv): { env: PortalEnv; touches: () => number } {
  const db = requireDb(env);
  let touches = 0;
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (prop === "prepare" || prop === "batch" || prop === "exec") touches += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as PortalD1;
  return { env: { ...env, DB: wrapped }, touches: () => touches };
}

async function writeLogCount(env: PortalEnv): Promise<number> {
  const row = await requireDb(env).prepare(`SELECT COUNT(*) AS n FROM team_write_log`).first<{ n: number }>();
  return row?.n ?? 0;
}

const expense = { entryDate: "2026-11-20", category: "maintenance", amountCents: 4599, note: "Oil change receipt" };
const income = { startDate: "2026-11-01", endDate: "2026-11-03", payoutCents: 25000 };

async function seed(env: PortalEnv) {
  const created = await call(env, "POST", "/api/portal/admin/cars", {
    ownerId: 1,
    year: 2022,
    make: "Toyota",
    model: "Corolla",
    color: "Silver",
    licensePlate: "READ-001",
    vin: "1READTKN000000001",
  });
  assert.equal(created.status, 201, created.text);
  const carId = (created.data?.car as { id: number }).id;
  const exp = await team(env, FULL, "POST", `/cars/${carId}/expenses`, expense);
  assert.equal(exp.status, 201, exp.text);
  const inc = await team(env, FULL, "POST", `/cars/${carId}/income`, income);
  assert.equal(inc.status, 201, inc.text);
  return {
    carId,
    expenseId: (exp.data?.expense as { id: number }).id,
    incomeId: (inc.data?.income as { id: number }).id,
  };
}

beforeEach(() => resetTeamRateLimit());

describe("team read-only token", () => {
  test("read token gets 200 on every GET route", async () => {
    const env = teamEnv();
    const { carId, expenseId, incomeId } = await seed(env);
    const logBefore = await writeLogCount(env);
    for (const path of [
      "/whoami",
      "/cars",
      `/cars/${carId}`,
      `/cars/${carId}/expenses`,
      `/cars/${carId}/expenses/${expenseId}`,
      `/cars/${carId}/income`,
      `/cars/${carId}/income/${incomeId}`,
      `/cars/${carId}/statement`,
      "/write-log",
      `/cars/${carId}/manager`,
      "/managers/assignments",
    ]) {
      const res = await team(env, READ, "GET", path);
      assert.equal(res.status, 200, `${path}: ${res.text}`);
      assert.ok(!res.text.includes(READ) && !res.text.includes(FULL), `${path} echoed a token`);
    }
    assert.equal(await writeLogCount(env), logBefore);
  });

  test("every write route answers 403 read_only_token before D1, and nothing is logged", async () => {
    const base = teamEnv();
    const { carId, expenseId, incomeId } = await seed(base);
    const logBefore = await writeLogCount(base);
    const { env, touches } = countingEnv(base);
    const writes: Array<[string, string, unknown?]> = [
      ["PATCH", `/cars/${carId}`, { color: "Blue" }],
      ["PUT", `/cars/${carId}`, { color: "Blue" }],
      ["DELETE", `/cars/${carId}`],
      ["POST", "/cars", {}],
      ["POST", `/cars/${carId}/expenses`, expense],
      ["PATCH", `/cars/${carId}/expenses/${expenseId}`, { amountCents: 1 }],
      ["DELETE", `/cars/${carId}/expenses/${expenseId}`],
      ["POST", `/cars/${carId}/income`, income],
      ["PATCH", `/cars/${carId}/income/${incomeId}`, { payoutCents: 1 }],
      ["DELETE", `/cars/${carId}/income/${incomeId}`],
      ["POST", `/cars/${carId}/manager`, {}],
      ["POST", "/managers/assignments", {}],
      ["POST", "/whoami", {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await team(env, READ, method, path, body);
      assert.equal(res.status, 403, `${method} ${path}: ${res.text}`);
      assert.equal(res.data?.error, "read_only_token");
      assert.ok(!res.text.includes(READ), "403 must not echo the token");
    }
    assert.equal(touches(), 0, "read-token writes must not reach D1");
    assert.equal((await team(env, READ, "GET", `/cars/${carId}`)).status, 200);
    assert.ok(touches() > 0, "counter sanity: a read-token GET does reach D1");
    assert.equal(await writeLogCount(base), logBefore);
    const car = await team(base, FULL, "GET", `/cars/${carId}`);
    assert.equal((car.data?.car as { color: string }).color, "Silver");
    assert.equal((await team(base, FULL, "GET", `/cars/${carId}/expenses/${expenseId}`)).status, 200);
    assert.equal((await team(base, FULL, "GET", `/cars/${carId}/income/${incomeId}`)).status, 200);
  });

  test("full token still writes and logs", async () => {
    const env = teamEnv();
    const { carId, expenseId } = await seed(env);
    const before = await writeLogCount(env);
    const edited = await team(env, FULL, "PATCH", `/cars/${carId}`, { color: "Blue" });
    assert.equal(edited.status, 200, edited.text);
    assert.equal((await team(env, FULL, "DELETE", `/cars/${carId}/expenses/${expenseId}`)).status, 200);
    assert.equal(await writeLogCount(env), before + 2);
  });

  test("unset, empty or short read secret never matches", async () => {
    for (const readSecret of [undefined, "", "   ", "short-read-token"]) {
      const env = teamEnv({ PORTAL_TEAM_READ_TOKEN: readSecret });
      resetTeamRateLimit();
      assert.equal((await team(env, READ, "GET", "/cars")).status, 401, `read secret ${JSON.stringify(readSecret)}`);
      if (readSecret !== undefined && readSecret.trim().length > 0) {
        assert.equal((await team(env, readSecret, "GET", "/cars")).status, 401);
      }
      assert.equal((await team(env, FULL, "GET", "/cars")).status, 200);
    }
  });

  test("empty or missing Bearer is 401 even with the read secret blank", async () => {
    for (const env of [teamEnv(), teamEnv({ PORTAL_TEAM_READ_TOKEN: "" })]) {
      resetTeamRateLimit();
      const empty = await handlePortal(
        new Request("http://127.0.0.1/api/portal/team/cars", {
          headers: { authorization: "Bearer ", "x-agent-name": AGENT },
        }),
        env
      );
      assert.equal(empty.status, 401);
      assert.equal((await team(env, null, "GET", "/cars")).status, 401);
      assert.equal((await team(env, "", "GET", "/cars")).status, 401);
    }
  });

  test("read token alone does not enable the API when the full token is unset", async () => {
    const env = devEnv(PANAMERICA, { PORTAL_TEAM_READ_TOKEN: READ });
    assert.equal((await team(env, READ, "GET", "/cars")).status, 404);
  });

  test("whoami reports the token scope", async () => {
    const env = teamEnv();
    const full = await team(env, FULL, "GET", "/whoami");
    assert.equal(full.status, 200);
    assert.deepEqual(full.data, { agentName: AGENT, tokenScope: "full", scope: TEAM_SCOPES.full });
    const read = await team(env, READ, "GET", "/whoami");
    assert.equal(read.status, 200);
    assert.deepEqual(read.data, { agentName: AGENT, tokenScope: "read", scope: TEAM_SCOPES.read });
    assert.doesNotMatch(TEAM_SCOPES.read, /write(?!_log)/);
  });
});
