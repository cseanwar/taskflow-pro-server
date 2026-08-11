"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const authz_middleware_1 = require("../middleware/authz.middleware");
const activity_1 = require("../lib/activity");
const notify_1 = require("../lib/notify");
const router = (0, express_1.Router)();
// Compute the next sequential task key for a project, e.g. "TF-1", "TF-2"...
async function nextTaskKey(tasksCollection, projectsCollection, projectId) {
    const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(projectId) });
    const prefix = (project?.code || 'TSK').toUpperCase();
    const existing = await tasksCollection
        .find({ projectId: new mongodb_1.ObjectId(projectId), key: { $exists: true, $ne: null } })
        .project({ key: 1 })
        .toArray();
    let maxNumber = 0;
    existing.forEach((t) => {
        if (!t.key)
            return;
        const match = String(t.key).match(/(\d+)$/);
        if (match)
            maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
    });
    return `${prefix}-${maxNumber + 1}`;
}
// Get Tasks by Project (read for any workspace member / guest)
router.get('/project/:projectId', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ locator: { source: 'params', key: 'projectId' }, min: 1 }), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const { sprintId, priority, columnId, assigneeId } = req.query;
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const usersCollection = db.collection('users');
        const filter = { projectId: new mongodb_1.ObjectId(projectId) };
        if (sprintId)
            filter.sprintId = sprintId === 'null' ? null : new mongodb_1.ObjectId(sprintId);
        if (priority)
            filter.priority = priority;
        if (columnId)
            filter.columnId = columnId;
        if (assigneeId)
            filter.assigneeIds = new mongodb_1.ObjectId(assigneeId);
        const tasks = await tasksCollection.find(filter).sort({ order: 1, createdAt: -1 }).toArray();
        // Fetch user info for assignees & reporter
        const allUserIds = new Set();
        tasks.forEach(t => {
            if (t.reporterId)
                allUserIds.add(t.reporterId.toString());
            t.assigneeIds?.forEach(id => allUserIds.add(id.toString()));
        });
        const users = await usersCollection
            .find({ _id: { $in: Array.from(allUserIds).map(id => new mongodb_1.ObjectId(id)) } }, { projection: { password: 0 } })
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
    }
    catch (error) {
        console.error('Fetch tasks error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch tasks.' });
    }
});
// Create Task (Project Manager / Workspace Owner / Administrator)
router.post('/', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ locator: { source: 'body', key: 'projectId' }, min: 3 }), async (req, res) => {
    try {
        const { projectId, columnId, sprintId, title, description, priority, estimate, dueDate, assigneeIds, labels, attachments, checklist } = req.body;
        if (!projectId || !title) {
            return res.status(400).json({ success: false, message: 'Project ID and title are required.' });
        }
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const projectsCollection = db.collection('projects');
        // Calculate next order in column
        const highestTask = await tasksCollection
            .find({ projectId: new mongodb_1.ObjectId(projectId), columnId: columnId || 'todo' })
            .sort({ order: -1 })
            .limit(1)
            .toArray();
        const nextOrder = highestTask.length > 0 ? highestTask[0].order + 1 : 0;
        const key = await nextTaskKey(tasksCollection, projectsCollection, projectId);
        const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(projectId) });
        const newTask = {
            projectId: new mongodb_1.ObjectId(projectId),
            key,
            columnId: columnId || 'todo',
            sprintId: sprintId ? new mongodb_1.ObjectId(sprintId) : null,
            title,
            description: description || '',
            priority: priority || 'Medium',
            estimate: typeof estimate === 'number' ? estimate : null,
            dueDate: dueDate || null,
            assigneeIds: assigneeIds?.map((id) => new mongodb_1.ObjectId(id)) || [new mongodb_1.ObjectId(userId)],
            reporterId: new mongodb_1.ObjectId(userId),
            labels: labels || [],
            attachments: attachments || [],
            checklist: checklist || [],
            order: nextOrder,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await tasksCollection.insertOne(newTask);
        const taskId = result.insertedId;
        // Log Activity
        await (0, activity_1.logActivity)({
            workspaceId: project?.workspaceId,
            projectId,
            taskId: taskId,
            actorId: userId,
            action: `Created task "${title}"`,
        });
        // Notify assignees a new task landed on their board (skip self-assignment).
        const assigneeStrs = newTask.assigneeIds.map(id => id.toString());
        await (0, notify_1.notifyUsers)(assigneeStrs.filter(id => id !== userId), {
            type: 'assignment',
            title: 'New Task Assigned',
            message: `You were assigned to "${title}" (${key})`,
            actorId: userId,
            link: (0, notify_1.taskNotificationLink)(projectId, taskId),
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
    }
    catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({ success: false, message: 'Failed to create task.' });
    }
});
// Move / Reorder Task — drag & drop status change (Team Member and above)
router.patch('/:id/move', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireTaskAccess)(2), async (req, res) => {
    try {
        const id = req.params.id;
        const { columnId, order, sprintId } = req.body;
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const current = await tasksCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        const updateFields = { updatedAt: new Date() };
        if (columnId !== undefined) {
            updateFields.columnId = columnId;
            updateFields.completedAt = columnId === 'done' ? new Date() : null;
        }
        if (order !== undefined)
            updateFields.order = order;
        if (sprintId !== undefined)
            updateFields.sprintId = sprintId ? new mongodb_1.ObjectId(sprintId) : null;
        await tasksCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: updateFields });
        if (columnId !== undefined) {
            const task = current || (await tasksCollection.findOne({ _id: new mongodb_1.ObjectId(id) }));
            await (0, activity_1.logActivity)({
                projectId: task?.projectId,
                taskId: id,
                actorId: req.user?.id,
                action: `Moved task "${task?.title || id}" to ${activity_1.COLUMN_TITLES[columnId] || columnId}`,
            });
        }
        res.status(200).json({ success: true, message: 'Task position updated.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to move task.' });
    }
});
// Update Task Details (Team Member and above — status, checklist, attachments, deadlines)
router.put('/:id', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireTaskAccess)(2), async (req, res) => {
    try {
        const id = req.params.id;
        const { title, description, priority, estimate, dueDate, assigneeIds, labels, checklist, attachments, columnId } = req.body;
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const current = await tasksCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!current) {
            return res.status(404).json({ success: false, message: 'Task not found.' });
        }
        const updateFields = { updatedAt: new Date() };
        if (title !== undefined)
            updateFields.title = title;
        if (description !== undefined)
            updateFields.description = description;
        if (priority !== undefined)
            updateFields.priority = priority;
        if (estimate !== undefined)
            updateFields.estimate = typeof estimate === 'number' ? estimate : null;
        if (dueDate !== undefined)
            updateFields.dueDate = dueDate;
        if (assigneeIds !== undefined)
            updateFields.assigneeIds = assigneeIds.map((aid) => new mongodb_1.ObjectId(aid));
        if (labels !== undefined)
            updateFields.labels = labels;
        if (checklist !== undefined)
            updateFields.checklist = checklist;
        if (attachments !== undefined)
            updateFields.attachments = attachments;
        if (columnId !== undefined) {
            updateFields.columnId = columnId;
            updateFields.completedAt = columnId === 'done' ? new Date() : null;
        }
        // Notify newly assigned users about the change.
        if (assigneeIds !== undefined && Array.isArray(assigneeIds)) {
            const oldIds = new Set((current.assigneeIds || []).map(id => id.toString()));
            const newStr = assigneeIds.map((aid) => aid?.toString());
            const added = newStr.filter(id => id && !oldIds.has(id));
            if (added.length > 0) {
                await (0, notify_1.notifyUsers)(added, {
                    type: 'assignment',
                    title: 'New Task Assigned',
                    message: `You were assigned to "${current.title}" (${current.key || 'task'})`,
                    actorId: req.user?.id,
                    link: (0, notify_1.taskNotificationLink)(current.projectId, id),
                });
            }
        }
        await tasksCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: updateFields });
        // Log meaningful field changes
        const events = [];
        if (title !== undefined && title !== current.title)
            events.push(`Updated title to "${title}"`);
        if (priority !== undefined && priority !== current.priority)
            events.push(`Changed priority to ${priority}`);
        if (estimate !== undefined && estimate !== current.estimate) {
            events.push(estimate ? `Set estimate to ${estimate} points` : 'Cleared estimate');
        }
        if (dueDate !== undefined && String(dueDate) !== String(current.dueDate || '')) {
            events.push(dueDate ? `Set due date to ${String(dueDate).slice(0, 10)}` : 'Cleared due date');
        }
        if (columnId !== undefined && columnId !== current.columnId) {
            events.push(`Moved task to ${activity_1.COLUMN_TITLES[columnId] || columnId}`);
        }
        if (labels !== undefined) {
            const added = labels.filter((l) => !current.labels?.includes(l));
            const removed = current.labels?.filter((l) => !labels.includes(l)) || [];
            added.forEach((l) => events.push(`Added label "${l}"`));
            removed.forEach((l) => events.push(`Removed label "${l}"`));
        }
        if (checklist !== undefined) {
            const oldItems = new Map((current.checklist || []).map(c => [c.id, c]));
            checklist.forEach((item) => {
                const old = oldItems.get(item.id);
                if (old && old.completed !== item.completed) {
                    events.push(item.completed ? `Completed checklist item "${item.text}"` : `Reopened checklist item "${item.text}"`);
                }
            });
        }
        if (assigneeIds !== undefined)
            events.push('Updated assignees');
        if (events.length > 0) {
            await (0, activity_1.logActivity)({
                projectId: current.projectId,
                taskId: id,
                actorId: req.user?.id,
                action: `Updated task "${current.title}"`,
                details: events.join(' • '),
            });
        }
        res.status(200).json({ success: true, message: 'Task updated successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update task.' });
    }
});
// Delete Task (Project Manager / Workspace Owner / Administrator)
router.delete('/:id', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireTaskAccess)(3), async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const commentsCollection = db.collection('comments');
        await tasksCollection.deleteOne({ _id: new mongodb_1.ObjectId(id) });
        await commentsCollection.deleteMany({ taskId: new mongodb_1.ObjectId(id) });
        res.status(200).json({ success: true, message: 'Task deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete task.' });
    }
});
// Get Task Activity Log (any workspace member / guest)
router.get('/:id/activity', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireTaskAccess)(1), async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const logsCollection = db.collection('activity_logs');
        const usersCollection = db.collection('users');
        const logs = await logsCollection
            .find({ taskId: new mongodb_1.ObjectId(id) })
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray();
        const actorIds = logs.map(l => new mongodb_1.ObjectId(l.actorId.toString()));
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch task activity.' });
    }
});
// Get Task Comments (any workspace member / guest)
router.get('/:id/comments', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireTaskAccess)(1), async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const commentsCollection = db.collection('comments');
        const usersCollection = db.collection('users');
        const comments = await commentsCollection
            .find({ taskId: new mongodb_1.ObjectId(id) })
            .sort({ createdAt: 1 })
            .toArray();
        const authorIds = comments.map(c => new mongodb_1.ObjectId(c.authorId.toString()));
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch comments.' });
    }
});
// Add Comment to Task (Team Member and above)
router.post('/:id/comments', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireTaskAccess)(2), async (req, res) => {
    try {
        const id = req.params.id;
        const { text, attachments } = req.body;
        const userId = req.user?.id;
        if (!text) {
            return res.status(400).json({ success: false, message: 'Comment text is required.' });
        }
        const db = await (0, db_1.connectDB)();
        const commentsCollection = db.collection('comments');
        const usersCollection = db.collection('users');
        const newComment = {
            taskId: new mongodb_1.ObjectId(id),
            authorId: new mongodb_1.ObjectId(userId),
            text,
            attachments: attachments || [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await commentsCollection.insertOne(newComment);
        const user = await usersCollection.findOne({ _id: new mongodb_1.ObjectId(userId) });
        const task = await db.collection('tasks').findOne({ _id: new mongodb_1.ObjectId(id) });
        await (0, activity_1.logActivity)({
            projectId: task?.projectId,
            taskId: id,
            actorId: userId,
            action: `Commented on "${task?.title || 'task'}"`,
        });
        // Notify the task's watchers unless they wrote the comment themselves.
        const watcherIds = new Set();
        if (task) {
            if (task.reporterId)
                watcherIds.add(task.reporterId.toString());
            (task.assigneeIds || []).forEach(aid => watcherIds.add(aid.toString()));
        }
        if (userId)
            watcherIds.delete(userId);
        const authorName = user?.name || 'A team member';
        if (task) {
            await (0, notify_1.notifyUsers)(Array.from(watcherIds), {
                type: 'comment',
                title: `Comment on "${task?.title || 'task'}"`,
                message: `"${text}" — ${authorName}`,
                actorId: userId,
                link: (0, notify_1.taskNotificationLink)(task.projectId, id),
            });
        }
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add comment.' });
    }
});
exports.default = router;
