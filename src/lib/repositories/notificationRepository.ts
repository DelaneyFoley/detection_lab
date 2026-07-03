import { dataStore } from "@/lib/services";
import { v4 as uuid } from "uuid";

export class NotificationRepository {
  createNotification(input: {
    recipient: string;
    type: string;
    datasetId: string | null;
    title: string;
    message: string;
  }): string {
    const id = uuid();
    const now = new Date().toISOString();
    dataStore.run(
      "INSERT INTO notifications (notification_id, recipient, type, dataset_id, title, message, dismissed, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      id,
      input.recipient,
      input.type,
      input.datasetId,
      input.title,
      input.message,
      now
    );
    return id;
  }

  getForUser(recipient: string, options: { includeDismissed?: boolean } = {}): any[] {
    if (options.includeDismissed) {
      return dataStore.all<any>(
        "SELECT * FROM notifications WHERE recipient = ? ORDER BY created_at DESC",
        recipient
      );
    }
    return dataStore.all<any>(
      "SELECT * FROM notifications WHERE recipient = ? AND dismissed = 0 ORDER BY created_at DESC",
      recipient
    );
  }

  dismiss(notificationId: string): void {
    dataStore.run(
      "UPDATE notifications SET dismissed = 1 WHERE notification_id = ?",
      notificationId
    );
  }

  dismissAllForUser(recipient: string): void {
    dataStore.run(
      "UPDATE notifications SET dismissed = 1 WHERE recipient = ? AND dismissed = 0",
      recipient
    );
  }

  getUndismissedCount(recipient: string): number {
    const row = dataStore.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM notifications WHERE recipient = ? AND dismissed = 0",
      recipient
    );
    return row?.c ?? 0;
  }
}

export const notificationRepository = new NotificationRepository();
