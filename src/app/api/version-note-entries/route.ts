import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { versionNoteEntryRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const promptVersionId = req.nextUrl.searchParams.get("prompt_version_id");
    if (!promptVersionId) {
      return NextResponse.json({ error: "prompt_version_id is required" }, { status: 400 });
    }
    const entries = versionNoteEntryRepository.listByVersion(promptVersionId);
    return NextResponse.json({ entries });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/version-note-entries");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to list version note entries", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "version-note-entries:write", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const body = await req.json();
    const promptVersionId = String(body?.prompt_version_id || "").trim();
    const bodyText = String(body?.body ?? "");
    const createdBy = String(body?.created_by || "user").trim() || "user";
    if (!promptVersionId) {
      return NextResponse.json({ error: "prompt_version_id is required" }, { status: 400 });
    }
    const entry = versionNoteEntryRepository.createEntry({
      entryId: uuid(),
      promptVersionId,
      origin: "user",
      eventType: null,
      body: bodyText,
      metadata: null,
      createdBy,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ entry });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/version-note-entries");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create version note entry", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "version-note-entries:update", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const body = await req.json();
    const entryId = String(body?.entry_id || "").trim();
    const bodyText = String(body?.body ?? "");
    if (!entryId) {
      return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
    }
    const existing = versionNoteEntryRepository.getById(entryId);
    if (!existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    versionNoteEntryRepository.updateEntryBody(entryId, bodyText);
    const updated = versionNoteEntryRepository.getById(entryId);
    return NextResponse.json({ entry: updated });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/version-note-entries");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update version note entry", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "version-note-entries:delete", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const entryId = req.nextUrl.searchParams.get("entry_id");
    if (!entryId) {
      return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
    }
    const existing = versionNoteEntryRepository.getById(entryId);
    if (!existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    versionNoteEntryRepository.deleteEntry(entryId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/version-note-entries");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete version note entry", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
