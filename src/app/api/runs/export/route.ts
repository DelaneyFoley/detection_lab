import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { runRepository } from "@/lib/repositories";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getImageExtension(uri: string): "png" | "jpeg" | "gif" {
  const lower = uri.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (lower.includes(".gif")) return "gif";
  return "jpeg";
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "detection-lab-export" } });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer) as unknown as Buffer;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");
  if (!runId) {
    return NextResponse.json({ error: "run_id required" }, { status: 400 });
  }

  const run = runRepository.getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const predictions = runRepository.getRunPredictions(runId);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Run Log");
  const IMAGE_COL_WIDTH = 22;
  const IMAGE_ROW_HEIGHT = 120;

  sheet.columns = [
    { header: "Image", key: "image", width: IMAGE_COL_WIDTH },
    { header: "Image ID", key: "image_id", width: 16 },
    { header: "Predicted Label", key: "predicted_decision", width: 18 },
    { header: "Ground Truth", key: "ground_truth_label", width: 16 },
    { header: "Corrected Label", key: "corrected_label", width: 16 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Attributes", key: "attributes", width: 30 },
    { header: "Error Tag", key: "error_tag", width: 22 },
    { header: "Evidence", key: "evidence", width: 60 },
    { header: "Notes", key: "notes", width: 40 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const rowIndex = i + 2;

    const tags: string[] = (() => { try { return JSON.parse((pred as any).segment_tags || "[]"); } catch { return []; } })();

    sheet.addRow({
      image: "",
      image_id: pred.image_id,
      predicted_decision: pred.predicted_decision || "N/A",
      ground_truth_label: pred.ground_truth_label || "",
      corrected_label: pred.corrected_label || "",
      confidence: pred.confidence != null ? Math.round(pred.confidence * 100) / 100 : "",
      attributes: tags.join(", "),
      error_tag: pred.error_tag || "",
      evidence: pred.evidence || "",
      notes: pred.image_description || pred.reviewer_note || "",
    });

    const row = sheet.getRow(rowIndex);
    row.height = IMAGE_ROW_HEIGHT;
    row.alignment = { vertical: "middle", wrapText: true };

    if (pred.image_uri) {
      const buffer = await fetchImageBuffer(pred.image_uri);
      if (buffer) {
        const ext = getImageExtension(pred.image_uri);
        const imageId = workbook.addImage({ buffer: buffer as any, extension: ext });
        sheet.addImage(imageId, {
          tl: { col: 0, row: rowIndex - 1 },
          ext: { width: 150, height: 150 },
        });
      }
    }
  }

  const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  return new NextResponse(xlsxBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="run_export_${runId.substring(0, 8)}.xlsx"`,
    },
  });
}
