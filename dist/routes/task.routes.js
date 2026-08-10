"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Get Tasks by Project (Supports filter by Sprint, Assignee, Priority, Status/Column)
router.get('/project/:projectId', auth_middleware_1.verifyToken, async (req, res) => {
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
// Create Task
router.post('/', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const { projectId, columnId, sprintId, title, description, priority, dueDate, assigneeIds, labels, attachments, checklist } = req.body;
        if (!projectId || !title) {
            return res.status(400).json({ success: false, message: 'Project ID and title are required.' });
        }
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const logsCollection = db.collection('activity_logs');
        // Calculate next order in column
        const highestTask = await tasksCollection
            .find({ projectId: new mongodb_1.ObjectId(projectId), columnId: columnId || 'todo' })
            .sort({ order: -1 })
            .limit(1)
            .toArray();
        const nextOrder = highestTask.length > 0 ? highestTask[0].order + 1 : 0;
        const newTask = {
            projectId: new mongodb_1.ObjectId(projectId),
            columnId: columnId || 'todo',
            sprintId: sprintId ? new mongodb_1.ObjectId(sprintId) : null,
            title,
            description: description || '',
            priority: priority || 'Medium',
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
        await logsCollection.insertOne({
            workspaceId: new mongodb_1.ObjectId(), // default fallback or fetch
            projectId: new mongodb_1.ObjectId(projectId),
            taskId: taskId,
            actorId: new mongodb_1.ObjectId(userId),
            action: `Created task "${title}"`,
            createdAt: new Date(),
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
// Move / Reorder Task (Drag and drop)
router.patch('/:id/move', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { columnId, order, sprintId } = req.body;
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const updateFields = { updatedAt: new Date() };
        if (columnId !== undefined)
            updateFields.columnId = columnId;
        if (order !== undefined)
            updateFields.order = order;
        if (sprintId !== undefined)
            updateFields.sprintId = sprintId ? new mongodb_1.ObjectId(sprintId) : null;
        await tasksCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: updateFields });
        res.status(200).json({ success: true, message: 'Task position updated.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to move task.' });
    }
});
// Update Task Details
router.put('/:id', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const { title, description, priority, dueDate, assigneeIds, labels, checklist, attachments } = req.body;
        const db = await (0, db_1.connectDB)();
        const tasksCollection = db.collection('tasks');
        const updateFields = { updatedAt: new Date() };
        if (title !== undefined)
            updateFields.title = title;
        if (description !== undefined)
            updateFields.description = description;
        if (priority !== undefined)
            updateFields.priority = priority;
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
        await tasksCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: updateFields });
        res.status(200).json({ success: true, message: 'Task updated successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update task.' });
    }
});
// Delete Task
router.delete('/:id', auth_middleware_1.verifyToken, async (req, res) => {
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
// Get Task Comments
router.get('/:id/comments', auth_middleware_1.verifyToken, async (req, res) => {
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
// Add Comment to Task
router.post('/:id/comments', auth_middleware_1.verifyToken, async (req, res) => {
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
