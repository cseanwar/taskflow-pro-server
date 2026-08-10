import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { IActivityLog } from '../types';

interface ActivityInput {
  workspaceId?: string | ObjectId;
  projectId?: string | ObjectId;
  taskId?: string | ObjectId;
  actorId?: string | ObjectId;
  action: string;
  details?: string;
}

export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    const db = await connectDB();
    const logsCollection = db.collection<IActivityLog>('activity_logs');

    await logsCollection.insertOne({
      workspaceId: input.workspaceId ? new ObjectId(input.workspaceId) : undefined,
      projectId: input.projectId ? new ObjectId(input.projectId) : undefined,
      taskId: input.taskId ? new ObjectId(input.taskId) : undefined,
      actorId: input.actorId ? new ObjectId(input.actorId) : undefined,
      action: input.action,
      details: input.details,
      createdAt: new Date(),
    } as any);
  } catch (error) {
    console.error('logActivity error:', error);
  }
}

export const COLUMN_TITLES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  testing: 'Testing',
  done: 'Done',
};
