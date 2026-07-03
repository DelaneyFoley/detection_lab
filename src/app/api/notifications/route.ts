import { NextResponse } from "next/server";
import { notificationRepository } from "@/lib/repositories";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "list") {
    const recipient = searchParams.get("recipient");
    if (!recipient) {
      return NextResponse.json({ error: "recipient required" }, { status: 400 });
    }
    const includeDismissed = searchParams.get("include_dismissed") === "true";
    const notifications = notificationRepository.getForUser(recipient, { includeDismissed });
    return NextResponse.json({ notifications });
  }

  if (action === "count") {
    const recipient = searchParams.get("recipient");
    if (!recipient) {
      return NextResponse.json({ error: "recipient required" }, { status: 400 });
    }
    const count = notificationRepository.getUndismissedCount(recipient);
    return NextResponse.json({ count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { action } = body;

  if (action === "dismiss") {
    const { notification_id } = body;
    if (!notification_id) {
      return NextResponse.json({ error: "notification_id required" }, { status: 400 });
    }
    notificationRepository.dismiss(notification_id);
    return NextResponse.json({ ok: true });
  }

  if (action === "dismiss_all") {
    const { recipient } = body;
    if (!recipient) {
      return NextResponse.json({ error: "recipient required" }, { status: 400 });
    }
    notificationRepository.dismissAllForUser(recipient);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
