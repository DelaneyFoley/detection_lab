import { NextRequest, NextResponse } from "next/server";
import { promptRepository, promptGroupMetadataRepository } from "@/lib/repositories";
import { dataStore } from "@/lib/services";
import { parseVersionLabel } from "@/lib/detectionPrompts";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const detectionId = String(body?.detection_id || "").trim();
    const oldBase = String(body?.old_base_name || "").trim();
    const newBase = String(body?.new_base_name || "").trim();
    if (!detectionId || !oldBase || !newBase) {
      return NextResponse.json(
        { error: "detection_id, old_base_name, new_base_name are required" },
        { status: 400 }
      );
    }
    if (oldBase.toLowerCase() === newBase.toLowerCase()) {
      // Case-only or no-op rename: no label rewrites needed. Still refresh metadata casing.
      promptGroupMetadataRepository.rename(detectionId, oldBase, newBase);
      return NextResponse.json({ ok: true, renamed: [] });
    }

    const versions = promptRepository.listByDetection(detectionId);
    const oldBaseLower = oldBase.toLowerCase();

    // Partition: versions in the group being renamed vs. everyone else.
    type V = { prompt_version_id: string; version_label: string; created_at: string };
    const inGroup: V[] = [];
    const others: V[] = [];
    for (const v of versions) {
      const parsed = parseVersionLabel(v.version_label);
      if (parsed.base.toLowerCase() === oldBaseLower) {
        inGroup.push(v);
      } else {
        others.push(v);
      }
    }
    if (inGroup.length === 0) {
      // Metadata-only rename (empty group), still move the metadata row.
      promptGroupMetadataRepository.rename(detectionId, oldBase, newBase);
      return NextResponse.json({ ok: true, renamed: [] });
    }

    // Assign a target number to each in-group version. Keep parsed nums; for
    // null-num versions, assign next-available ints in creation order starting
    // above the max existing num.
    const takenNums = new Set<number>();
    for (const v of inGroup) {
      const n = parseVersionLabel(v.version_label).num;
      if (n != null) takenNums.add(n);
    }
    let nextFree = 1;
    const nextAvailable = (): number => {
      while (takenNums.has(nextFree)) nextFree += 1;
      const n = nextFree;
      takenNums.add(n);
      nextFree += 1;
      return n;
    };

    const targets: Array<{ prompt_version_id: string; old_label: string; new_label: string }> = [];
    for (const v of inGroup) {
      const parsed = parseVersionLabel(v.version_label);
      const n = parsed.num != null ? parsed.num : nextAvailable();
      const newLabel = `${newBase}_V${n}`;
      targets.push({ prompt_version_id: v.prompt_version_id, old_label: v.version_label, new_label: newLabel });
    }

    // Collision check against versions outside the group being renamed.
    const otherLabels = new Set(others.map((v) => v.version_label));
    const collisions = targets.filter((t) => otherLabels.has(t.new_label));
    if (collisions.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot rename: target label(s) already exist in this detection: ${collisions
            .map((c) => c.new_label)
            .join(", ")}`,
          collisions: collisions.map((c) => c.new_label),
        },
        { status: 409 }
      );
    }

    // Two-phase update inside a transaction to avoid UNIQUE(detection_id, version_label)
    // conflicts if any target label temporarily matches another in-group's current label.
    const tx = dataStore.transaction((store) => {
      for (const t of targets) {
        store.run(
          "UPDATE prompt_versions SET version_label = ? WHERE prompt_version_id = ?",
          `__renaming__${t.prompt_version_id}`,
          t.prompt_version_id
        );
      }
      for (const t of targets) {
        store.run(
          "UPDATE prompt_versions SET version_label = ? WHERE prompt_version_id = ?",
          t.new_label,
          t.prompt_version_id
        );
      }
    });
    tx();

    promptGroupMetadataRepository.rename(detectionId, oldBase, newBase);
    return NextResponse.json({ ok: true, renamed: targets });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
