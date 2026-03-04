import { getDb } from "@/lib/db";
import type { DataStore } from "@/lib/services/interfaces";

class SQLiteDataStore implements DataStore {
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    const db = getDb();
    return db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    const db = getDb();
    return db.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: unknown[]): void {
    const db = getDb();
    db.prepare(sql).run(...params);
  }

  transaction<TArgs extends unknown[], TResult>(
    fn: (store: DataStore, ...args: TArgs) => TResult
  ): (...args: TArgs) => TResult {
    const db = getDb();
    return db.transaction((...args: TArgs) => fn(this, ...args));
  }
}

export const dataStore: DataStore = new SQLiteDataStore();
