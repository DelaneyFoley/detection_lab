import fs from "fs/promises";
import path from "path";
import type { FileStore } from "@/lib/services/interfaces";

class LocalFileStore implements FileStore {
  async ensureDatasetUploadDir(datasetId: string): Promise<string> {
    const dir = path.join(process.cwd(), "public", "uploads", "datasets", datasetId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async writeDatasetFile(datasetId: string, fileName: string, content: Buffer): Promise<string> {
    const dir = await this.ensureDatasetUploadDir(datasetId);
    const absPath = path.join(dir, fileName);
    await fs.writeFile(absPath, content);
    return this.absPathToLocalUri(absPath);
  }

  async removeDatasetUploadDir(datasetId: string): Promise<void> {
    const dir = path.join(process.cwd(), "public", "uploads", "datasets", datasetId);
    await fs.rm(dir, { recursive: true, force: true });
  }

  async removeLocalUri(uri: string): Promise<void> {
    const abs = this.localUriToAbsPath(uri);
    if (!abs) return;
    await fs.rm(abs, { force: true });
  }

  async renameLocalUri(oldUri: string, newUri: string): Promise<string> {
    const oldAbs = this.localUriToAbsPath(oldUri);
    const nextAbs = this.localUriToAbsPath(newUri);
    if (!oldAbs || !nextAbs) return newUri;
    await fs.mkdir(path.dirname(nextAbs), { recursive: true });
    await fs.rename(oldAbs, nextAbs);
    return this.absPathToLocalUri(nextAbs);
  }

  localUriToAbsPath(uri: string): string | null {
    if (!uri.startsWith("/uploads/datasets/")) return null;
    return path.join(process.cwd(), "public", uri.replace(/^\//, ""));
  }

  absPathToLocalUri(absPath: string): string {
    const rel = path.relative(path.join(process.cwd(), "public"), absPath);
    return `/${rel.split(path.sep).join("/")}`;
  }
}

export const fileStore: FileStore = new LocalFileStore();
