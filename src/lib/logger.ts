import { NextRequest } from "next/server";
import crypto from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  route?: string;
  method?: string;
  ip?: string;
  [key: string]: unknown;
}

function baseContext(context?: LogContext) {
  return {
    ts: new Date().toISOString(),
    ...context,
  };
}

function write(level: LogLevel, message: string, context?: LogContext) {
  const payload = {
    level,
    message,
    ...baseContext(context),
  };
  const serialized = JSON.stringify(payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

export const logger = {
  debug(message: string, context?: LogContext) {
    write("debug", message, context);
  },
  info(message: string, context?: LogContext) {
    write("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    write("error", message, context);
  },
};

export function getRequestContext(req: NextRequest, fallbackRoute?: string): LogContext {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return {
    requestId,
    route: fallbackRoute || req.nextUrl.pathname,
    method: req.method,
    ip,
  };
}
