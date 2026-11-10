declare module "node:sqlite" {
  export type SqlValue = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    all(...params: SqlValue[]): Record<string, SqlValue>[];
    get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
    run(...params: SqlValue[]): {
      lastInsertRowid: number | bigint;
      changes: number | bigint;
    };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
