import { NextRequest, NextResponse } from "next/server";

type GeminiModelsResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const apiKey = String(
    (typeof body?.api_key === "string" ? body.api_key : "") || process.env.GEMINI_API_KEY || ""
  ).trim();

  if (!apiKey) {
    return NextResponse.json({ error: "API key required (request api_key or GEMINI_API_KEY env)" }, { status: 400 });
  }

  try {
    const models: string[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    while (pages < 10) {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const res = await fetch(url.toString(), { method: "GET" });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: text || "Failed to list models" }, { status: res.status });
      }

      const data = (await res.json()) as GeminiModelsResponse;
      for (const m of data.models || []) {
        const rawName = m.name || "";
        const name = rawName.replace(/^models\//, "");
        const supportsGenerateContent = (m.supportedGenerationMethods || []).includes("generateContent");
        if (name.startsWith("gemini") && supportsGenerateContent) {
          models.push(name);
        }
      }

      pageToken = data.nextPageToken;
      pages += 1;
      if (!pageToken) break;
    }

    const uniqueSorted = Array.from(new Set(models)).sort((a, b) => b.localeCompare(a));
    return NextResponse.json({ models: uniqueSorted });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
