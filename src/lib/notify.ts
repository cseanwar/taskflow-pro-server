import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { INotification } from '../types';

interface NotifyPayload {
  type: INotification['type'];
  title: string;
  message: string;
  actorId?: string;
  link?: string;
}

/**
 * Insert a notification for each target user. Silently ignores empty targets
 * so call sites can pass assignee lists without extra guards.
 */
export async function notifyUsers(userIds: string[], payload: NotifyPayload): Promise<void> {
  if (!userIds || userIds.length === 0) return;

  const unique = Array.from(new Set(userIds.map(id => id?.toString()).filter(Boolean)));
  if (unique.length === 0) return;

  const db = await connectDB();
  const notificationsCollection = db.collection<INotification>('notifications');

  const now = new Date();
  const docs = unique.map(userId => ({
    userId: new ObjectId(userId),
    type: payload.type,
    title: payload.title,
    message: payload.message,
    read: false,
    archived: false,
    actorId: payload.actorId ? new ObjectId(payload.actorId) : undefined,
    link: payload.link,
    createdAt: now,
  }));

  if (docs.length > 0) {
    await notificationsCollection.insertMany(docs as any[]);
  }
}

/** Notification "View" link used when a task notification needs a jump target. */
export function taskNotificationLink(projectId: string | ObjectId, taskId: string | ObjectId): string {
  return `/projects/${projectId.toString()}?task=${taskId.toString()}`;
}