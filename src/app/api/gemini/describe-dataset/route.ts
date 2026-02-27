import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "@/lib/db";
import { buildImagePart } from "@/lib/gemini";

type DescribeRequest = {
  api_key?: string;
  dataset_id?: string;
  item_ids?: string[];
  overwrite?: boolean;
  model_override?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DescribeRequest;
    const apiKey = String(body.api_key || process.env.GEMINI_API_KEY || "").trim();
    const datasetId = String(body.dataset_id || "").trim();
    const overwrite = Boolean(body.overwrite);
    const itemIds = Array.isArray(body.item_ids) ? body.item_ids : [];
    const modelName = String(body.model_override || "gemini-2.5-flash").trim();

    if (!apiKey) {
      return NextResponse.json({ error: "api_key is required (or set GEMINI_API_KEY env)" }, { status: 400 });
    }
    if (!datasetId) return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });

    const db = getDb();
    const dataset = db.prepare("SELECT dataset_id FROM datasets WHERE dataset_id = ?").get(datasetId) as
      | { dataset_id: string }
      | undefined;
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const items = (
      itemIds.length > 0
        ? db
            .prepare(
              `SELECT item_id, image_id, image_uri, image_description
               FROM dataset_items
               WHERE dataset_id = ? AND item_id IN (${itemIds.map(() => "?").join(",")})
               ORDER BY image_id`
            )
            .all(datasetId, ...itemIds)
        : db
            .prepare(
              `SELECT item_id, image_id, image_uri, image_description
               FROM dataset_items
               WHERE dataset_id = ?
               ORDER BY image_id`
            )
            .all(datasetId)
    ) as Array<{ item_id: string; image_id: string; image_uri: string; image_description: string }>;

    if (items.length === 0) return NextResponse.json({ updated: 0, total: 0, items: [] });

    const targetItems = overwrite
      ? items
      : items.filter((item) => !String(item.image_description || "").trim());

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens: 80,
      },
    });

    const updateStmt = db.prepare("UPDATE dataset_items SET image_description = ? WHERE item_id = ?");
    const updatedItems: Array<{ item_id: string; image_id: string; image_description: string }> = [];

    for (const item of targetItems) {
      let description = "";
      try {
        const imageParts = await buildImagePart(item.image_uri);
        const result = await model.generateContent([
          "Describe this image in one concise sentence. Focus only on what is visibly present. Do not infer risk or run detection labels. Return plain text only.",
          ...imageParts,
        ]);
        description = normalizeDescription(result.response.text());
      } catch {
        description = "";
      }

      if (!description) continue;
      updateStmt.run(description, item.item_id);
      updatedItems.push({
        item_id: item.item_id,
        image_id: item.image_id,
        image_description: description,
      });
    }

    db.prepare("UPDATE datasets SET updated_at = ? WHERE dataset_id = ?").run(
      new Date().toISOString(),
      datasetId
    );

    return NextResponse.json({
      updated: updatedItems.length,
      total: targetItems.length,
      items: updatedItems,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function normalizeDescription(text: string): string {
  const singleLine = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!singleLine) return "";
  return singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
}
