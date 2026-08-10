import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { ITask, IComment, IActivityLog, IUser } from '../types';

const router = Router();

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
    const { projectId, columnId, sprintId, title, description, priority, dueDate, assigneeIds, labels, attachments, checklist } = req.body;

    if (!projectId || !title) {
      return res.status(400).json({ success: false, message: 'Project ID and title are required.' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');
    const logsCollection = db.collection<IActivityLog>('activity_logs');

    // Calculate next order in column
    const highestTask = await tasksCollection
      .find({ projectId: new ObjectId(projectId), columnId: columnId || 'todo' })
      .sort({ order: -1 })
      .limit(1)
      .toArray();

    const nextOrder = highestTask.length > 0 ? highestTask[0].order + 1 : 0;

    const newTask: ITask = {
      projectId: new ObjectId(projectId),
      columnId: columnId || 'todo',
      sprintId: sprintId ? new ObjectId(sprintId) : null,
      title,
      description: description || '',
      priority: priority || 'Medium',
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
    await logsCollection.insertOne({
      workspaceId: new ObjectId(), // default fallback or fetch
      projectId: new ObjectId(projectId),
      taskId: taskId,
      actorId: new ObjectId(userId),
      action: `Created task "${title}"`,
      createdAt: new Date(),
    } as any);

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

    const updateFields: any = { updatedAt: new Date() };
    if (columnId !== undefined) updateFields.columnId = columnId;
    if (order !== undefined) updateFields.order = order;
    if (sprintId !== undefined) updateFields.sprintId = sprintId ? new ObjectId(sprintId) : null;

    await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    res.status(200).json({ success: true, message: 'Task position updated.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to move task.' });
  }
});

// Update Task Details
router.put('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { title, description, priority, dueDate, assigneeIds, labels, checklist, attachments } = req.body;

    const db = await connectDB();
    const tasksCollection = db.collection<ITask>('tasks');

    const updateFields: any = { updatedAt: new Date() };
    if (title !== undefined) updateFields.title = title;
    if (description !== undefined) updateFields.description = description;
    if (priority !== undefined) updateFields.priority = priority;
    if (dueDate !== undefined) updateFields.dueDate = dueDate;
    if (assigneeIds !== undefined) updateFields.assigneeIds = assigneeIds.map((aid: string) => new ObjectId(aid));
    if (labels !== undefined) updateFields.labels = labels;
    if (checklist !== undefined) updateFields.checklist = checklist;
    if (attachments !== undefined) updateFields.attachments = attachments;

    await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

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
