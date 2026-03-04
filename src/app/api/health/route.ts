import { NextResponse } from "next/server";
import { systemRepository } from "@/lib/repositories";

const bootedAt = Date.now();

export async function GET() {
  const started = Date.now();
  try {
    systemRepository.ping();
    return NextResponse.json({
      status: "ok",
      uptime_ms: Date.now() - bootedAt,
      db: "ok",
      latency_ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        status: "error",
        db: "down",
        error: errMsg,
        latency_ms: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
