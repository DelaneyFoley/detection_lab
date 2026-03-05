import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodType } from "zod";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function parsePositiveInt(value: string | null, fallback: number, min = 1, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function parseSearch(value: string | null): string {
  return String(value || "").trim();
}

export function parsePagination(req: NextRequest, defaults?: { page?: number; pageSize?: number }) {
  const page = parsePositiveInt(req.nextUrl.searchParams.get("page"), defaults?.page ?? 1, 1, 100000);
  const pageSize = parsePositiveInt(req.nextUrl.searchParams.get("page_size"), defaults?.pageSize ?? 50, 1, 250);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

export function validateNonEmptyString(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function validationError(error: ZodError) {
  return NextResponse.json(
    {
      error: "Validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 }
  );
}

export async function parseJsonWithSchema<T>(
  req: NextRequest,
  schema: ZodType<T>
): Promise<{ success: true; data: T } | { success: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { success: false, response: badRequest("Invalid JSON body") };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { success: false, response: validationError(parsed.error) };
  }
  return { success: true, data: parsed.data };
}

export function applyRateLimit(
  req: NextRequest,
  {
    key,
    maxRequests,
    windowMs,
  }: { key: string; maxRequests: number; windowMs: number }
): NextResponse | null {
  // Disabled by default during active development. Re-enable pre-deploy with ENABLE_RATE_LIMIT=true.
  if (process.env.ENABLE_RATE_LIMIT !== "true") {
    return null;
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const bucketKey = `${ip}:${key}`;
  const now = Date.now();
  const bucket = rateBuckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (bucket.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Retry in ${retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
        },
      }
    );
  }

  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  return null;
}

export function toPaginatedResponse<T>(
  items: T[],
  {
    page,
    pageSize,
    total,
  }: {
    page: number;
    pageSize: number;
    total: number;
  }
) {
  return {
    items,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      has_next_page: page * pageSize < total,
    },
  };
}
