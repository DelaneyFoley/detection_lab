import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { settingsRepository } from "@/lib/repositories";

const execFileAsync = promisify(execFile);

const CATALOG_KEY = "production_context_catalog";
const FETCHED_AT_KEY = "production_context_catalog_fetched_at";

export type CompiledContextMember = {
  role: "detection" | "ic_correct" | "ic_incorrect";
  label: string;
  description: string;
  position: number;
};

export type CompiledContext = {
  name: string;
  has_vlm: boolean;
  google_model: string;
  thinking_level: string;
  detection_count: number;
  members: CompiledContextMember[];
  built_prompt: string;
  response_schema: Record<string, unknown>;
  checksum: string;
};

export type ContextCatalog = {
  source_revision: string;
  context_count: number;
  contexts: CompiledContext[];
  fetched_at?: string;
};

/** Absolute path to the read-only `ai-services` checkout (env override + sibling default). */
export function resolveAiServicesPath(): string {
  const env = process.env.AI_SERVICES_PATH?.trim();
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), "..", "ai-services");
}

/**
 * Compile the production context aggregate by running the real production
 * assembly via a read-only Python import of `ai-services`. Zero drift; never
 * mutates the reference repository.
 */
export async function compileContextCatalog(): Promise<ContextCatalog> {
  const python = process.env.PYTHON_BIN?.trim() || "python3";
  const scriptPath = path.resolve(process.cwd(), "scripts", "compile-contexts.py");
  const aiServicesPath = resolveAiServicesPath();

  const { stdout } = await execFileAsync(python, [scriptPath, aiServicesPath], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });

  let parsed: ContextCatalog & { error?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Failed to parse context compiler output as JSON.");
  }
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

export function getCachedCatalog(): ContextCatalog | null {
  const row = settingsRepository.getByKey(CATALOG_KEY);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as ContextCatalog;
  } catch {
    return null;
  }
}

export function getCatalogFetchedAt(): string | null {
  return settingsRepository.getByKey(FETCHED_AT_KEY)?.value ?? null;
}

/** Look up one compiled context from the cached catalog by name. */
export function getCachedContext(name: string): CompiledContext | null {
  const catalog = getCachedCatalog();
  if (!catalog) return null;
  return catalog.contexts.find((c) => c.name === name) ?? null;
}

/**
 * Recompile the catalog from the live `ai-services` source and cache it. Never
 * mutates previously frozen snapshots or saved versions — only refreshes the
 * live catalog used for NEW version creation.
 */
export async function refreshContextCatalog(): Promise<ContextCatalog> {
  const catalog = await compileContextCatalog();
  const now = new Date().toISOString();
  const withMeta: ContextCatalog = { ...catalog, fetched_at: now };
  settingsRepository.upsertMany([
    { key: CATALOG_KEY, value: JSON.stringify(withMeta), updatedAt: now },
    { key: FETCHED_AT_KEY, value: now, updatedAt: now },
  ]);
  return withMeta;
}
