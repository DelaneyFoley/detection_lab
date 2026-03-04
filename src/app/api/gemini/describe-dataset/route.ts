import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildImagePart } from "@/lib/gemini";
import { datasetRepository } from "@/lib/repositories";

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

    const dataset = datasetRepository.getDatasetById(datasetId) as { dataset_id: string } | undefined;
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const allItems = datasetRepository.getDatasetWithItems(datasetId).items as Array<{
      item_id: string;
      image_id: string;
      image_uri: string;
      image_description: string;
    }>;
    const items = itemIds.length > 0 ? allItems.filter((item) => itemIds.includes(item.item_id)) : allItems;

    if (items.length === 0) return NextResponse.json({ updated: 0, total: 0, items: [] });

    const targetItems = overwrite
      ? items
      : items.filter((item) => !String(item.image_description || "").trim());

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: 120,
      },
    });

    const updatedItems: Array<{ item_id: string; image_id: string; image_description: string }> = [];

    for (const item of targetItems) {
      let description = "";
      try {
        const imageParts = await buildImagePart(item.image_uri);
        const result = await model.generateContent([
          "Describe this image in exactly one complete sentence (about 10-25 words). Focus only on visible content. Do not infer risk or labels. Return plain text only, ending with a period.",
          ...imageParts,
        ]);
        description = normalizeDescription(result.response.text());
      } catch {
        description = "";
      }

      if (!description) continue;
      datasetRepository.updateDatasetItemDescription(item.item_id, description);
      updatedItems.push({
        item_id: item.item_id,
        image_id: item.image_id,
        image_description: description,
      });
    }

    datasetRepository.touchDataset(datasetId, new Date().toISOString());

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
  const firstSentenceMatch = singleLine.match(/.+?[.!?](?=\s|$)/);
  let oneSentence = firstSentenceMatch ? firstSentenceMatch[0].trim() : singleLine;
  if (!/[.!?]$/.test(oneSentence)) oneSentence = `${oneSentence}.`;
  return oneSentence;
}
