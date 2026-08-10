"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLUMN_TITLES = void 0;
exports.logActivity = logActivity;
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
async function logActivity(input) {
    try {
        const db = await (0, db_1.connectDB)();
        const logsCollection = db.collection('activity_logs');
        await logsCollection.insertOne({
            workspaceId: input.workspaceId ? new mongodb_1.ObjectId(input.workspaceId) : undefined,
            projectId: input.projectId ? new mongodb_1.ObjectId(input.projectId) : undefined,
            taskId: input.taskId ? new mongodb_1.ObjectId(input.taskId) : undefined,
            actorId: input.actorId ? new mongodb_1.ObjectId(input.actorId) : undefined,
            action: input.action,
            details: input.details,
            createdAt: new Date(),
        });
    }
    catch (error) {
        console.error('logActivity error:', error);
    }
}
exports.COLUMN_TITLES = {
    backlog: 'Backlog',
    todo: 'To Do',
    in_progress: 'In Progress',
    review: 'Review',
    testing: 'Testing',
    done: 'Done',
};
