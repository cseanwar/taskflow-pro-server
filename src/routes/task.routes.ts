import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { ITask, IComment, IActivityLog, IProject, IUser } from '../types';
import { logActivity, COLUMN_TITLES } from '../lib/activity';

const router = Router();

// Compute the next sequential task key for a project, e.g. "TF-1", "TF-2"...
async function nextTaskKey(tasksCollection: any, projectsCollection: any, projectId: string): Promise<string> {
  const project = await projectsCollection.findOne({ _id: new ObjectId(projectId) });
  const prefix = (project?.code || 'TSK').toUpperCase();

  const existing = await tasksCollection
    .find({ projectId: new ObjectId(projectId), key: { $exists: true, $ne: null } })
    .project({ key: 1 })
    .toArray();

  let maxNumber = 0;
  existing.forEach((t: any) => {
    if (!t.key) return;
    const match = String(t.key).match(/(\d+)$/);
    if (match) maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
  });

  return `${prefix}-${maxNumber + 1}`;
}

// Get Tasks by Project (Supports filter by Sprint, Assignee, Priority, Status/Column)
router.get('/project/:projectId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const { sprintId, priority, columnId, assigneeId } = req.query;

    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');
    const usersCollection = db.collection<IUser>('users');

    const filter: any = { projectId: new ObjectId(projectId) };

    if (sprintId) filter.sprintId = sprintId === 'null' ? null : new ObjectId(sprintId as string);
    if (priority) filter.priority = priority as string;
    if (columnId) filter.columnId = columnId as string;
    if (assigneeId) filter.assigneeIds = new ObjectId(assigneeId as string);

    const tasks = await tasksCollection.find(filter).sort({ order: 1, createdAt: -1 }).toArray();

    // Fetch user info for assignees & reporter
    const allUserIds = new Set<string>();
    tasks.forEach(t => {
      if (t.reporterId) allUserIds.add(t.reporterId.toString());
      t.assigneeIds?.forEach(id => allUserIds.add(id.toString()));
    });

    const users = await usersCollection
      .find({ _id: { $in: Array.from(allUserIds).map(id => new ObjectId(id)) } }, { projection: { password: 0 } })
      .toArray();

    const userMap = new Map(users.map(u => [u._id?.toString(), { id: u._id?.toString(), name: u.name, avatar: u.avatar, email: u.email }]));

    const formattedTasks = tasks.map(t => ({
      ...t,
      _id: t._id?.toString(),
      projectId: t.projectId.toString(),
      sprintId: t.sprintId ? t.sprintId.toString() : null,
      reporter: userMap.get(t.reporterId.toString()) || null,
      assignees: t.assigneeIds?.map(id => userMap.get(id.toString())).filter(Boolean) || [],
      reporterId: t.reporterId.toString(),
      assigneeIds: t.assigneeIds?.map(id => id.toString()) || [],
    }));

    res.status(200).json({ success: true, tasks: formattedTasks });
  } catch (error) {
    console.error('Fetch tasks error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tasks.' });
  }
});

// Create Task
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, columnId, sprintId, title, description, priority, estimate, dueDate, assigneeIds, labels, attachments, checklist } = req.body;

    if (!projectId || !title) {
      return res.status(400).json({ success: false, message: 'Project ID and title are required.' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');
    const projectsCollection = db.collection<IProject>('projects');

    // Calculate next order in column
    const highestTask = await tasksCollection
      .find({ projectId: new ObjectId(projectId), columnId: columnId || 'todo' })
      .sort({ order: -1 })
      .limit(1)
      .toArray();

    const nextOrder = highestTask.length > 0 ? highestTask[0].order + 1 : 0;
    const key = await nextTaskKey(tasksCollection, projectsCollection, projectId);

    const project = await projectsCollection.findOne({ _id: new ObjectId(projectId) });

    const newTask: ITask = {
      projectId: new ObjectId(projectId),
      key,
      columnId: columnId || 'todo',
      sprintId: sprintId ? new ObjectId(sprintId) : null,
      title,
      description: description || '',
      priority: priority || 'Medium',
      estimate: typeof estimate === 'number' ? estimate : null,
      dueDate: dueDate || null,
      assigneeIds: assigneeIds?.map((id: string) => new ObjectId(id)) || [new ObjectId(userId)],
      reporterId: new ObjectId(userId),
      labels: labels || [],
      attachments: attachments || [],
      checklist: checklist || [],
      order: nextOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await tasksCollection.insertOne(newTask as any);
    const taskId = result.insertedId;

    // Log Activity
    await logActivity({
      workspaceId: project?.workspaceId,
      projectId,
      taskId: taskId,
      actorId: userId,
      action: `Created task "${title}"`,
    });

    res.status(201).json({
      success: true,
      task: {
        ...newTask,
        _id: taskId.toString(),
        projectId: projectId,
        sprintId: sprintId || null,
        reporterId: userId,
        assigneeIds: newTask.assigneeIds.map(id => id.toString()),
      },
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ success: false, message: 'Failed to create task.' });
  }
});

// Move / Reorder Task (Drag and drop)
router.patch('/:id/move', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { columnId, order, sprintId } = req.body;

    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');

    const current = await tasksCollection.findOne({ _id: new ObjectId(id) });

    const updateFields: any = { updatedAt: new Date() };
    if (columnId !== undefined) {
      updateFields.columnId = columnId;
      updateFields.completedAt = columnId === 'done' ? new Date() : null;
    }
    if (order !== undefined) updateFields.order = order;
    if (sprintId !== undefined) updateFields.sprintId = sprintId ? new ObjectId(sprintId) : null;

    await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    if (columnId !== undefined) {
      const task = current || (await tasksCollection.findOne({ _id: new ObjectId(id) }));
      await logActivity({
        projectId: task?.projectId,
        taskId: id,
        actorId: req.user?.id,
        action: `Moved task "${task?.title || id}" to ${COLUMN_TITLES[columnId] || columnId}`,
      });
    }

    res.status(200).json({ success: true, message: 'Task position updated.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to move task.' });
  }
});

// Update Task Details
router.put('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { title, description, priority, estimate, dueDate, assigneeIds, labels, checklist, attachments, columnId } = req.body;

    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');

    const current = await tasksCollection.findOne({ _id: new ObjectId(id) });
    if (!current) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    const updateFields: any = { updatedAt: new Date() };
    if (title !== undefined) updateFields.title = title;
    if (description !== undefined) updateFields.description = description;
    if (priority !== undefined) updateFields.priority = priority;
    if (estimate !== undefined) updateFields.estimate = typeof estimate === 'number' ? estimate : null;
    if (dueDate !== undefined) updateFields.dueDate = dueDate;
    if (assigneeIds !== undefined) updateFields.assigneeIds = assigneeIds.map((aid: string) => new ObjectId(aid));
    if (labels !== undefined) updateFields.labels = labels;
    if (checklist !== undefined) updateFields.checklist = checklist;
    if (attachments !== undefined) updateFields.attachments = attachments;
    if (columnId !== undefined) {
      updateFields.columnId = columnId;
      updateFields.completedAt = columnId === 'done' ? new Date() : null;
    }

    await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    // Log meaningful field changes
    const events: string[] = [];
    if (title !== undefined && title !== current.title) events.push(`Updated title to "${title}"`);
    if (priority !== undefined && priority !== current.priority) events.push(`Changed priority to ${priority}`);
    if (estimate !== undefined && estimate !== current.estimate) {
      events.push(estimate ? `Set estimate to ${estimate} points` : 'Cleared estimate');
    }
    if (dueDate !== undefined && String(dueDate) !== String(current.dueDate || '')) {
      events.push(dueDate ? `Set due date to ${String(dueDate).slice(0, 10)}` : 'Cleared due date');
    }
    if (columnId !== undefined && columnId !== current.columnId) {
      events.push(`Moved task to ${COLUMN_TITLES[columnId] || columnId}`);
    }
    if (labels !== undefined) {
      const added = labels.filter((l: string) => !current.labels?.includes(l));
      const removed = current.labels?.filter((l: string) => !labels.includes(l)) || [];
      added.forEach((l: string) => events.push(`Added label "${l}"`));
      removed.forEach((l: string) => events.push(`Removed label "${l}"`));
    }
    if (checklist !== undefined) {
      const oldItems = new Map((current.checklist || []).map(c => [c.id, c]));
      checklist.forEach((item: any) => {
        const old = oldItems.get(item.id);
        if (old && old.completed !== item.completed) {
          events.push(item.completed ? `Completed checklist item "${item.text}"` : `Reopened checklist item "${item.text}"`);
        }
      });
    }
    if (assigneeIds !== undefined) events.push('Updated assignees');

    if (events.length > 0) {
      await logActivity({
        projectId: current.projectId,
        taskId: id,
        actorId: req.user?.id,
        action: `Updated task "${current.title}"`,
        details: events.join(' • '),
      });
    }

    res.status(200).json({ success: true, message: 'Task updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update task.' });
  }
});

// Delete Task
router.delete('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');
    const commentsCollection = db.collection<IComment>('comments');

    await tasksCollection.deleteOne({ _id: new ObjectId(id) });
    await commentsCollection.deleteMany({ taskId: new ObjectId(id) });

    res.status(200).json({ success: true, message: 'Task deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete task.' });
  }
});

// Get Task Activity Log
router.get('/:id/activity', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const logsCollection = db.collection<IActivityLog>('activity_logs');
    const usersCollection = db.collection<IUser>('users');

    const logs = await logsCollection
      .find({ taskId: new ObjectId(id) })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const actorIds = logs.map(l => new ObjectId(l.actorId.toString()));
    const actors = await usersCollection
      .find({ _id: { $in: actorIds } }, { projection: { password: 0 } })
      .toArray();
    const actorMap = new Map(actors.map(a => [a._id?.toString(), { name: a.name, avatar: a.avatar }]));

    const formattedLogs = logs.map(l => ({
      ...l,
      _id: l._id?.toString(),
      actorId: l.actorId.toString(),
      actor: actorMap.get(l.actorId.toString()) || { name: 'Unknown User', avatar: '' },
    }));

    res.status(200).json({ success: true, activity: formattedLogs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch task activity.' });
  }
});

// Get Task Comments
router.get('/:id/comments', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const commentsCollection = db.collection<IComment>('comments');
    const usersCollection = db.collection<IUser>('users');

    const comments = await commentsCollection
      .find({ taskId: new ObjectId(id) })
      .sort({ createdAt: 1 })
      .toArray();

    const authorIds = comments.map(c => new ObjectId(c.authorId.toString()));
    const authors = await usersCollection
      .find({ _id: { $in: authorIds } }, { projection: { password: 0 } })
      .toArray();

    const authorMap = new Map(authors.map(a => [a._id?.toString(), { name: a.name, avatar: a.avatar }]));

    const formattedComments = comments.map(c => ({
      ...c,
      _id: c._id?.toString(),
      taskId: c.taskId.toString(),
      authorId: c.authorId.toString(),
      author: authorMap.get(c.authorId.toString()) || { name: 'Unknown User', avatar: '' },
    }));

    res.status(200).json({ success: true, comments: formattedComments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch comments.' });
  }
});

// Add Comment to Task
router.post('/:id/comments', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { text, attachments } = req.body;
    const userId = req.user?.id;

    if (!text) {
      return res.status(400).json({ success: false, message: 'Comment text is required.' });
    }

    const db = await connectDB();
    const commentsCollection = db.collection<IComment>('comments');
    const usersCollection = db.collection<IUser>('users');

    const newComment: IComment = {
      taskId: new ObjectId(id),
      authorId: new ObjectId(userId),
      text,
      attachments: attachments || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await commentsCollection.insertOne(newComment as any);
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

    const task = await db.collection<ITask>('tasks').findOne({ _id: new ObjectId(id) });
    await logActivity({
      projectId: task?.projectId,
      taskId: id,
      actorId: userId,
      action: `Commented on "${task?.title || 'task'}"`,
    });

    res.status(201).json({
      success: true,
      comment: {
        ...newComment,
        _id: result.insertedId.toString(),
        taskId: id,
        authorId: userId,
        author: { name: user?.name || 'User', avatar: user?.avatar },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add comment.' });
  }
});

export default router;
