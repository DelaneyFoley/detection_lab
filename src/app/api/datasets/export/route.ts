import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import ExcelJS from "exceljs";
import { datasetRepository } from "@/lib/repositories";
import { fileStore } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getImageExtension(uri: string): "png" | "jpeg" | "gif" {
  const lower = uri.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (lower.includes(".gif")) return "gif";
  return "jpeg";
}

async function loadImageBuffer(uri: string): Promise<Buffer | null> {
  if (!uri) return null;
  // Local uploads live on disk; read them directly instead of going over HTTP.
  const localPath = fileStore.localUriToAbsPath(uri);
  if (localPath) {
    try {
      return await fs.readFile(localPath);
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(uri, { headers: { "User-Agent": "detection-lab-export" } });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

function parseSegmentTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "dataset";
}

export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("dataset_id");
  if (!datasetId) {
    return NextResponse.json({ error: "dataset_id required" }, { status: 400 });
  }

  const { dataset, items } = datasetRepository.getDatasetWithItems(datasetId);
  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dataset");
  const IMAGE_COL_WIDTH = 22;
  const IMAGE_ROW_HEIGHT = 120;

  sheet.columns = [
    { header: "Thumbnail", key: "thumbnail", width: IMAGE_COL_WIDTH },
    { header: "Image ID", key: "image_id", width: 24 },
    { header: "Image URL", key: "image_url", width: 40 },
    { header: "Ground Truth Label", key: "ground_truth_label", width: 20 },
    { header: "Attributes", key: "attributes", width: 30 },
    { header: "Image Description", key: "image_description", width: 50 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowIndex = i + 2;
    const tags = parseSegmentTags(item.segment_tags).filter((t) => t !== "Baseline");

    sheet.addRow({
      thumbnail: "",
      image_id: item.image_id || "",
      image_url: item.image_uri || "",
      ground_truth_label: item.ground_truth_label || "",
      attributes: tags.join(", "),
      image_description: item.image_description || "",
    });

    const row = sheet.getRow(rowIndex);
    row.height = IMAGE_ROW_HEIGHT;
    row.alignment = { vertical: "middle", wrapText: true };

    if (item.image_uri) {
      const buffer = await loadImageBuffer(item.image_uri);
      if (buffer) {
        const imageId = workbook.addImage({
          buffer: buffer as unknown as ExcelJS.Buffer,
          extension: getImageExtension(item.image_uri),
        });
        sheet.addImage(imageId, {
          tl: { col: 0, row: rowIndex - 1 },
          ext: { width: 150, height: 150 },
        });
      }
    }
  }

  const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = sanitizeFileName(dataset.name || "dataset");

  return new NextResponse(xlsxBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}.xlsx"`,
    },
  });
}
