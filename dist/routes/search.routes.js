"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// GET /api/search?q=  — search across the user's tasks, projects, and members
router.get('/', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const q = String(req.query.q || '').trim();
        if (!q) {
            return res.status(200).json({ success: true, query: '', results: { tasks: [], projects: [], members: [] } });
        }
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        const projectsCollection = db.collection('projects');
        const tasksCollection = db.collection('tasks');
        const usersCollection = db.collection('users');
        // Scope: workspaces the user belongs to -> their projects
        const userWorkspaces = await workspacesCollection
            .find({ $or: [{ ownerId: new mongodb_1.ObjectId(userId) }, { 'members.userId': new mongodb_1.ObjectId(userId) }] })
            .toArray();
        const workspaceIds = userWorkspaces.map(w => w._id);
        const projectIds = await projectsCollection
            .find({ workspaceId: { $in: workspaceIds } })
            .project({ _id: 1 })
            .toArray();
        const projectIdList = projectIds.map(p => p._id);
        const [projects, tasks, members] = await Promise.all([
            projectIdList.length > 0
                ? projectsCollection
                    .find({ $and: [{ _id: { $in: projectIdList } }, { $or: [{ name: regex }, { code: regex }, { category: regex }] }] })
                    .limit(10)
                    .toArray()
                : Promise.resolve([]),
            projectIdList.length > 0
                ? tasksCollection
                    .find({
                    $and: [
                        { projectId: { $in: projectIdList } },
                        { $or: [{ title: regex }, { description: regex }, { key: regex }] },
                    ],
                })
                    .sort({ updatedAt: -1 })
                    .limit(20)
                    .toArray()
                : Promise.resolve([]),
            usersCollection
                .find({ $or: [{ name: regex }, { email: regex }] }, { projection: { password: 0 } })
                .limit(10)
                .toArray(),
        ]);
        // Only members who belong to the user's workspaces
        const memberIds = new Set();
        userWorkspaces.forEach(w => {
            if (w.ownerId)
                memberIds.add(w.ownerId.toString());
            (w.members || []).forEach(m => memberIds.add(m.userId.toString()));
        });
        const projectMap = new Map(projects.map(p => [p._id?.toString(), { name: p.name, code: p.code }]));
        res.status(200).json({
            success: true,
            query: q,
            results: {
                tasks: tasks.map(t => ({
                    _id: t._id?.toString(),
                    key: t.key,
                    title: t.title,
                    priority: t.priority,
                    columnId: t.columnId,
                    sprintId: t.sprintId ? t.sprintId.toString() : null,
                    dueDate: t.dueDate,
                    estimate: t.estimate ?? null,
                    projectId: t.projectId.toString(),
                    projectName: projectMap.get(t.projectId.toString())?.name || '',
                    projectCode: projectMap.get(t.projectId.toString())?.code || '',
                    assigneeIds: (t.assigneeIds || []).map(id => id.toString()),
                })),
                projects: projects.map(p => ({
                    _id: p._id?.toString(),
                    name: p.name,
                    code: p.code,
                    category: p.category || '',
                    status: p.status,
                })),
                members: members
                    .filter(m => memberIds.has(m._id?.toString() || ''))
                    .map(m => ({
                    id: m._id?.toString(),
                    name: m.name,
                    email: m.email,
                    avatar: m.avatar,
                    role: m.role,
                })),
            },
        });
    }
    catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ success: false, message: 'Failed to perform search.' });
    }
});
exports.default = router;
