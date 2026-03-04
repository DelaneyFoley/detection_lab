import { dataStore } from "@/lib/services";

export class SystemRepository {
  ping(): boolean {
    const row = dataStore.get<{ ok: number }>("SELECT 1 as ok");
    return Number(row?.ok || 0) === 1;
  }
}

export const systemRepository = new SystemRepository();
