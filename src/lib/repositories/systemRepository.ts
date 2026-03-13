import { dataStore } from "@/lib/services";
import fs from "fs";
import path from "path";

export class SystemRepository {
  ping(): boolean {
    const row = dataStore.get<{ ok: number }>("SELECT 1 as ok");
    return Number(row?.ok || 0) === 1;
  }

  getStorageStatus(): { ok: boolean; uploadsDir: string } {
    const uploadsDir = path.join(process.cwd(), "public", "uploads", "datasets");
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
    return { ok: true, uploadsDir };
  }
}

export const systemRepository = new SystemRepository();
