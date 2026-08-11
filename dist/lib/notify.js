"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUsers = notifyUsers;
exports.taskNotificationLink = taskNotificationLink;
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
/**
 * Insert a notification for each target user. Silently ignores empty targets
 * so call sites can pass assignee lists without extra guards.
 */
async function notifyUsers(userIds, payload) {
    if (!userIds || userIds.length === 0)
        return;
    const unique = Array.from(new Set(userIds.map(id => id?.toString()).filter(Boolean)));
    if (unique.length === 0)
        return;
    const db = await (0, db_1.connectDB)();
    const notificationsCollection = db.collection('notifications');
    const now = new Date();
    const docs = unique.map(userId => ({
        userId: new mongodb_1.ObjectId(userId),
        type: payload.type,
        title: payload.title,
        message: payload.message,
        read: false,
        archived: false,
        actorId: payload.actorId ? new mongodb_1.ObjectId(payload.actorId) : undefined,
        link: payload.link,
        createdAt: now,
    }));
    if (docs.length > 0) {
        await notificationsCollection.insertMany(docs);
    }
}
/** Notification "View" link used when a task notification needs a jump target. */
function taskNotificationLink(projectId, taskId) {
    return `/projects/${projectId.toString()}?task=${taskId.toString()}`;
}
