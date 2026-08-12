import { NextRequest, NextResponse } from "next/server";
import { promptGroupMetadataRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    if (!detectionId) {
      return NextResponse.json({ error: "detection_id is required" }, { status: 400 });
    }
    const groups = promptGroupMetadataRepository.listByDetection(detectionId);
    return NextResponse.json({ groups });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const detectionId = String(body?.detection_id || "").trim();
    const baseName = String(body?.base_name || "").trim();
    const description = String(body?.description ?? "");
    if (!detectionId || !baseName) {
      return NextResponse.json({ error: "detection_id and base_name are required" }, { status: 400 });
    }
    promptGroupMetadataRepository.upsert(detectionId, baseName, description);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const detectionId = String(body?.detection_id || "").trim();
    const baseName = String(body?.base_name || "").trim();
    if (!detectionId || !baseName) {
      return NextResponse.json({ error: "detection_id and base_name are required" }, { status: 400 });
    }
    promptGroupMetadataRepository.remove(detectionId, baseName);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
