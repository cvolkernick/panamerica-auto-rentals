import { readFileSync } from "node:fs";
import { DatabaseSync, type SqlValue } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { D1Prepared, PortalD1 } from "../../lib/portal/d1";

export function migrationPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../migrations/0001_init.sql");
}

export function loadMigrationSql(): string {
  return readFileSync(migrationPath(), "utf8");
}

export function createMemoryD1(sql = loadMigrationSql()): PortalD1 {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(sql);
  return {
    prepare(query: string): D1Prepared {
      const statement = db.prepare(query);
      let bound: SqlValue[] = [];
      const prepared: D1Prepared = {
        bind(...values: unknown[]) {
          bound = values.map((value) => {
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "bigint" ||
              value === null
            ) {
              return value;
            }
            throw new Error("unsupported sql value");
          });
          return prepared;
        },
        async all<T>() {
          return { results: statement.all(...bound) as T[] };
        },
        async first<T>() {
          const row = statement.get(...bound) as T | undefined;
          return row ?? null;
        },
        async run() {
          const info = statement.run(...bound);
          return {
            success: true,
            meta: {
              last_row_id: Number(info.lastInsertRowid),
              changes: Number(info.changes),
            },
          };
        },
      };
      return prepared;
    },
  };
}
