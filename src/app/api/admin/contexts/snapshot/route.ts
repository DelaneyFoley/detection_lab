import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { snapshotRepository } from "@/lib/repositories";
import { getCachedCatalog, getCachedContext } from "@/lib/services/contextCatalog";
import { toCompositionMember } from "@/lib/productionMirror";

export const runtime = "nodejs";

/** Return a single frozen snapshot by id (for read-only aggregate previews). */
export async function GET(req: NextRequest) {
  try {
    const id = String(req.nextUrl.searchParams.get("snapshot_id") || "").trim();
    if (!id) {
      return NextResponse.json({ error: "snapshot_id is required" }, { status: 400 });
    }
    const snapshot = snapshotRepository.getSnapshotById(id);
    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    return NextResponse.json({ snapshot });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/admin/contexts/snapshot");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch snapshot", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

/**
 * Freeze the current cached composition of a production context into an
 * immutable snapshot bound to a new version. Never mutates existing snapshots.
 */
export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "admin:contexts:snapshot", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => ({}));
    const contextName = String(body?.context_name || "").trim();
    if (!contextName) {
      return NextResponse.json({ error: "context_name is required" }, { status: 400 });
    }

    const compiled = getCachedContext(contextName);
    if (!compiled) {
      return NextResponse.json(
        { error: `Context "${contextName}" is not in the cached catalog. Refresh production contexts in Admin first.` },
        { status: 404 }
      );
    }

    const catalog = getCachedCatalog();
    const snapshotId = uuid();
    const now = new Date().toISOString();
    const orderedMembers = compiled.members.map((m) => toCompositionMember(m));

    snapshotRepository.createSnapshot({
      snapshotId,
      contextName,
      sourceRevision: catalog?.source_revision || "",
      importedAt: now,
      googleModel: compiled.google_model,
      thinkingLevel: compiled.thinking_level,
      orderedMembers,
      builtPrompt: compiled.built_prompt,
      responseSchema: compiled.response_schema,
      rawSource: JSON.stringify(compiled),
      checksum: compiled.checksum,
      importMethod: "local_compile",
    });

    const snapshot = snapshotRepository.getSnapshotById(snapshotId);
    return NextResponse.json({ snapshot });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/admin/contexts/snapshot");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to freeze context snapshot", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
