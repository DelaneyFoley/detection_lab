import { NextResponse } from "next/server";
import { attributeLayoutRepository } from "@/lib/repositories";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const user = searchParams.get("user");
  const taxonomy = searchParams.get("taxonomy");
  if (!user || !taxonomy) {
    return NextResponse.json({ error: "user and taxonomy required" }, { status: 400 });
  }
  const layout = attributeLayoutRepository.getLayout(user, taxonomy);
  return NextResponse.json({ layout: layout ?? [] });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { user, taxonomy, layout } = body as {
    user?: string;
    taxonomy?: string;
    layout?: unknown;
  };
  if (!user || !taxonomy) {
    return NextResponse.json({ error: "user and taxonomy required" }, { status: 400 });
  }
  if (!Array.isArray(layout) || !layout.every((row) => Array.isArray(row) && row.every((v) => typeof v === "string"))) {
    return NextResponse.json({ error: "layout must be an array of string arrays" }, { status: 400 });
  }
  attributeLayoutRepository.saveLayout(user, taxonomy, layout as string[][]);
  return NextResponse.json({ ok: true });
}
