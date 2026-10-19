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

  // Thumbnails are opt-out: absent param or any value other than 0/false embeds images.
  const thumbParam = searchParams.get("thumbnails");
  const includeThumbnails = thumbParam !== "0" && thumbParam !== "false";

  const predictions = runRepository.getRunPredictions(runId);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Run Log");
  const IMAGE_COL_WIDTH = 22;
  const IMAGE_ROW_HEIGHT = 120;

  const parseTags = (value: unknown): string[] => {
    try {
      return JSON.parse((value as string) || "[]");
    } catch {
      return [];
    }
  };

  // Multi-label runs score one prediction row per (image, label). Collapse to a
  // single row per image with the arrays of predicted and ground-truth labels,
  // mirroring the single-label export shape.
  const isMultiLabel = predictions.some((p) => !!p.detection_label);

  if (isMultiLabel) {
    sheet.columns = [
      ...(includeThumbnails ? [{ header: "Image", key: "image", width: IMAGE_COL_WIDTH }] : []),
      { header: "Image ID", key: "image_id", width: 16 },
      { header: "Image URL", key: "image_url", width: 40 },
      { header: "Predicted Labels", key: "predicted_labels", width: 40 },
      { header: "Ground Truth Labels", key: "ground_truth_labels", width: 40 },
      { header: "Correct", key: "correct", width: 10 },
      { header: "Attributes", key: "attributes", width: 30 },
      { header: "Notes", key: "notes", width: 40 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    // Group predictions by image, preserving composition (insertion) order.
    const byImage = new Map<string, typeof predictions>();
    for (const p of predictions) {
      const key = String(p.image_id || "");
      const arr = byImage.get(key) ?? [];
      arr.push(p);
      byImage.set(key, arr);
    }

    let rowIndex = 1;
    for (const [imageId, rows] of byImage) {
      rowIndex += 1;
      const predicted = rows
        .filter((r) => r.parse_ok && r.predicted_decision === "DETECTED")
        .map((r) => String(r.detection_label || ""))
        .filter(Boolean);
      const groundTruth = rows
        .filter((r) => (r.corrected_label || r.ground_truth_label) === "DETECTED")
        .map((r) => String(r.detection_label || ""))
        .filter(Boolean);
      const correct =
        JSON.stringify([...predicted].sort()) === JSON.stringify([...groundTruth].sort()) ? "Yes" : "No";
      const first = rows[0];
      const tags = parseTags((first as { segment_tags?: unknown }).segment_tags);

      sheet.addRow({
        image: "",
        image_id: imageId,
        image_url: first.image_uri || "",
        predicted_labels: JSON.stringify(predicted),
        ground_truth_labels: JSON.stringify(groundTruth),
        correct,
        attributes: tags.join(", "),
        notes: first.image_description || first.reviewer_note || "",
      });
      const row = sheet.getRow(rowIndex);
      if (includeThumbnails) row.height = IMAGE_ROW_HEIGHT;
      row.alignment = { vertical: "middle", wrapText: true };

      if (includeThumbnails && first.image_uri) {
        const buffer = await fetchImageBuffer(first.image_uri);
        if (buffer) {
          const ext = getImageExtension(first.image_uri);
          const imageId2 = workbook.addImage({ buffer: buffer as any, extension: ext });
          sheet.addImage(imageId2, {
            tl: { col: 0, row: rowIndex - 1 },
            ext: { width: 150, height: 150 },
          });
        }
      }
    }

    const xlsxBufferML = Buffer.from(await workbook.xlsx.writeBuffer());
    return new NextResponse(xlsxBufferML, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="run_export_${runId.substring(0, 8)}.xlsx"`,
      },
    });
  }

  sheet.columns = [
    ...(includeThumbnails ? [{ header: "Image", key: "image", width: IMAGE_COL_WIDTH }] : []),
    { header: "Image ID", key: "image_id", width: 16 },
    { header: "Image URL", key: "image_url", width: 40 },
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

    const tags: string[] = parseTags((pred as { segment_tags?: unknown }).segment_tags);

    sheet.addRow({
      image: "",
      image_id: pred.image_id,
      image_url: pred.image_uri || "",
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
    if (includeThumbnails) row.height = IMAGE_ROW_HEIGHT;
    row.alignment = { vertical: "middle", wrapText: true };

    if (includeThumbnails && pred.image_uri) {
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
