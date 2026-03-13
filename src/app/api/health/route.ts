import { NextResponse } from "next/server";
import { systemRepository } from "@/lib/repositories";

const bootedAt = Date.now();

export async function GET() {
  const started = Date.now();
  try {
    systemRepository.ping();
    const storage = systemRepository.getStorageStatus();
    return NextResponse.json({
      status: "ok",
      uptime_ms: Date.now() - bootedAt,
      checks: {
        db: "ok",
        storage: storage.ok ? "ok" : "error",
      },
      latency_ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        status: "error",
        checks: {
          db: "down",
          storage: "unknown",
        },
        error: errMsg,
        latency_ms: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
