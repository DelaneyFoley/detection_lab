import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { snapshotRepository } from "@/lib/repositories";
import {
  getCachedCatalog,
  getCatalogFetchedAt,
  refreshContextCatalog,
  resolveAiServicesPath,
} from "@/lib/services/contextCatalog";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const catalog = getCachedCatalog();

    // Drift = a frozen snapshot exists whose checksum differs from the current
    // compiled checksum for that context (production changed since it was frozen).
    const frozenByContext = new Map<string, Set<string>>();
    for (const row of snapshotRepository.listContextChecksums()) {
      const set = frozenByContext.get(row.context_name) ?? new Set<string>();
      set.add(row.checksum);
      frozenByContext.set(row.context_name, set);
    }

    const contextsMeta = (catalog?.contexts ?? []).map((c) => {
      const frozen = frozenByContext.get(c.name);
      const drifted = !!frozen && [...frozen].some((chk) => chk !== c.checksum);
      return {
        name: c.name,
        checksum: c.checksum,
        has_vlm: c.has_vlm,
        detection_count: c.detection_count,
        google_model: c.google_model,
        thinking_level: c.thinking_level,
        frozen_count: frozen ? frozen.size : 0,
        drifted,
      };
    });

    return NextResponse.json({
      catalog,
      fetched_at: getCatalogFetchedAt(),
      ai_services_path: resolveAiServicesPath(),
      context_count: catalog?.context_count ?? 0,
      source_revision: catalog?.source_revision ?? null,
      names: (catalog?.contexts ?? []).map((c) => c.name),
      contexts_meta: contextsMeta,
    });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/admin/contexts");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to read context catalog", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "admin:contexts:refresh", maxRequests: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    let action = "refresh";
    try {
      const body = await req.json();
      if (body && typeof body.action === "string") action = body.action;
    } catch {
      // Empty body defaults to refresh.
    }
    if (action !== "refresh") {
      return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const catalog = await refreshContextCatalog();
    return NextResponse.json({
      ok: true,
      fetched_at: catalog.fetched_at,
      source_revision: catalog.source_revision,
      context_count: catalog.context_count,
      names: catalog.contexts.map((c) => c.name),
    });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/admin/contexts");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to refresh context catalog", { ...context, error: errMsg });
    return NextResponse.json(
      {
        error: `Failed to compile production contexts: ${errMsg}`,
        hint: "Verify the ai-services checkout path (AI_SERVICES_PATH) and that python3 with pydantic is available.",
      },
      { status: 500 }
    );
  }
}
