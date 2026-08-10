"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
// Normalize a dueDate value to a YYYY-MM-DD key (timezone-safe for date-only strings).
function dateKey(due) {
    if (due === null || due === undefined || due === '')
        return null;
    if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due))
        return due;
    const d = new Date(due);
    if (isNaN(d.getTime()))
        return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function daysUntil(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const target = new Date(y, m - 1, d).getTime();
    const now = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    return Math.round((target - now) / 86400000);
}
async function formatActivity(logs, projects) {
    const db = await (0, db_1.connectDB)();
    const usersCollection = db.collection('users');
    const actorIds = logs.map(l => new mongodb_1.ObjectId(l.actorId.toString()));
    const actors = await usersCollection
        .find({ _id: { $in: actorIds } }, { projection: { password: 0 } })
        .toArray();
    const actorMap = new Map(actors.map(a => [a._id?.toString(), { name: a.name, avatar: a.avatar }]));
    const projectMap = new Map(projects.map(p => [p._id?.toString(), { name: p.name, code: p.code }]));
    return logs.map(l => ({
        _id: l._id?.toString(),
        action: l.action,
        details: l.details,
        createdAt: l.createdAt,
        actorId: l.actorId.toString(),
        actor: actorMap.get(l.actorId.toString()) || { name: 'Unknown User', avatar: '' },
        projectId: l.projectId ? l.projectId.toString() : null,
        project: l.projectId ? projectMap.get(l.projectId.toString()) || null : null,
        taskId: l.taskId ? l.taskId.toString() : null,
    }));
}
// Get Personal Dashboard Data (recent projects, upcoming tasks, due-today, recent activity)
router.get('/user-dashboard', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        const projectsCollection = db.collection('projects');
        const tasksCollection = db.collection('tasks');
        const logsCollection = db.collection('activity_logs');
        const userWorkspaces = await workspacesCollection
            .find({ $or: [{ ownerId: new mongodb_1.ObjectId(userId) }, { 'members.userId': new mongodb_1.ObjectId(userId) }] })
            .toArray();
        const workspaceIds = userWorkspaces.map(w => w._id);
        const activeProjects = await projectsCollection
            .find({ workspaceId: { $in: workspaceIds }, status: 'active' })
            .toArray();
        const projectIds = activeProjects.map(p => p._id);
        const tasks = await tasksCollection.find({ projectId: { $in: projectIds } }).toArray();
        const completedTasks = tasks.filter(t => t.columnId === 'done');
        const totalTasks = tasks.length;
        const completionRate = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;
        const tKey = todayKey();
        const tasksDueToday = tasks.filter(t => dateKey(t.dueDate) === tKey);
        const assignedTasks = tasks.filter(t => (t.assigneeIds || []).some(id => id.toString() === userId));
        // Recent Projects with progress + nearest upcoming due date
        const projectTaskMap = new Map();
        tasks.forEach(t => {
            const pid = t.projectId.toString();
            if (!projectTaskMap.has(pid))
                projectTaskMap.set(pid, []);
            projectTaskMap.get(pid).push(t);
        });
        const recentProjects = activeProjects
            .map(p => {
            const pTasks = projectTaskMap.get(p._id?.toString()) || [];
            const done = pTasks.filter(t => t.columnId === 'done').length;
            const progress = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
            const openWithDue = pTasks
                .filter(t => t.columnId !== 'done' && dateKey(t.dueDate))
                .map(t => dateKey(t.dueDate))
                .sort();
            return {
                _id: p._id?.toString(),
                name: p.name,
                code: p.code,
                category: p.category || 'Software',
                description: p.description || '',
                progress,
                totalTasks: pTasks.length,
                openTasks: pTasks.length - done,
                nextDueDate: openWithDue[0] || null,
                daysLeft: openWithDue[0] ? daysUntil(openWithDue[0]) : null,
                updatedAt: p.updatedAt,
            };
        })
            .sort((a, b) => (b.updatedAt?.getTime?.() || 0) - (a.updatedAt?.getTime?.() || 0))
            .slice(0, 6);
        // Upcoming Tasks (not done, due today or later)
        const projectNameMap = new Map(activeProjects.map(p => [p._id?.toString(), p]));
        const upcomingTasks = tasks
            .filter(t => {
            const dk = dateKey(t.dueDate);
            return t.columnId !== 'done' && dk && dk >= tKey;
        })
            .sort((a, b) => {
            const dkA = dateKey(a.dueDate);
            const dkB = dateKey(b.dueDate);
            if (dkA !== dkB)
                return dkA < dkB ? -1 : 1;
            return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
        })
            .slice(0, 8)
            .map(t => {
            const p = projectNameMap.get(t.projectId.toString());
            return {
                _id: t._id?.toString(),
                key: t.key,
                title: t.title,
                priority: t.priority,
                columnId: t.columnId,
                dueDate: t.dueDate,
                dueLabel: dateKey(t.dueDate),
                projectId: t.projectId.toString(),
                projectName: p?.name || '',
                projectCode: p?.code || '',
            };
        });
        // Recent Activity across user's projects + authored by user
        const userActivity = await logsCollection
            .find({
            $or: [{ projectId: { $in: projectIds } }, { actorId: new mongodb_1.ObjectId(userId) }],
        })
            .sort({ createdAt: -1 })
            .limit(15)
            .toArray();
        const recentActivity = await formatActivity(userActivity, activeProjects);
        res.status(200).json({
            success: true,
            dashboard: {
                activeProjects: activeProjects.length,
                totalTasks,
                completedTasks: completedTasks.length,
                completionRate,
                tasksDueToday: tasksDueToday.length,
                assignedTasks: assignedTasks.length,
                recentProjects,
                upcomingTasks,
                recentActivity,
            },
        });
    }
    catch (error) {
        console.error('User dashboard analytics error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch user dashboard.' });
    }
});
// Get Project Overview Analytics (completion, velocity, team workload, activity)
router.get('/project/:id', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const tasksCollection = db.collection('tasks');
        const sprintsCollection = db.collection('sprints');
        const logsCollection = db.collection('activity_logs');
        const usersCollection = db.collection('users');
        const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!project) {
            return res.status(404).json({ success: false, message: 'Project not found.' });
        }
        const tasks = await tasksCollection.find({ projectId: new mongodb_1.ObjectId(id) }).toArray();
        const sprints = await sprintsCollection.find({ projectId: new mongodb_1.ObjectId(id) }).sort({ createdAt: 1 }).toArray();
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.columnId === 'done').length;
        const openTasks = totalTasks - completedTasks;
        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const tKey = todayKey();
        const tasksDueSoon = tasks.filter(t => {
            const dk = dateKey(t.dueDate);
            return t.columnId !== 'done' && dk && dk >= tKey && daysUntil(dk) <= 7;
        });
        const statusStats = tasks.reduce((acc, t) => {
            acc[t.columnId] = (acc[t.columnId] || 0) + 1;
            return acc;
        }, {});
        // Velocity: committed vs completed per sprint
        const velocity = sprints.map(s => {
            const sprintTasks = tasks.filter(t => t.sprintId?.toString() === s._id?.toString());
            return {
                sprintId: s._id?.toString(),
                name: s.name,
                status: s.status,
                committed: sprintTasks.length,
                completed: sprintTasks.filter(t => t.columnId === 'done').length,
            };
        });
        // Team workload: per assignee counts
        const userMap = new Map();
        const assigneeIds = new Set();
        tasks.forEach(t => (t.assigneeIds || []).forEach(aid => assigneeIds.add(aid.toString())));
        const users = await usersCollection
            .find({ _id: { $in: Array.from(assigneeIds).map(a => new mongodb_1.ObjectId(a)) } }, { projection: { password: 0 } })
            .toArray();
        users.forEach(u => userMap.set(u._id?.toString(), u));
        const workloadMap = new Map();
        tasks.forEach(t => {
            (t.assigneeIds || []).forEach(aid => {
                const id = aid.toString();
                const entry = workloadMap.get(id) || { totalTasks: 0, completedTasks: 0, openTasks: 0 };
                entry.totalTasks += 1;
                if (t.columnId === 'done')
                    entry.completedTasks += 1;
                else
                    entry.openTasks += 1;
                workloadMap.set(id, entry);
            });
        });
        const teamWorkload = Array.from(workloadMap.entries())
            .map(([userId, counts]) => ({
            userId,
            name: userMap.get(userId)?.name || 'Unknown User',
            avatar: userMap.get(userId)?.avatar || '',
            ...counts,
            progress: counts.totalTasks > 0 ? Math.round((counts.completedTasks / counts.totalTasks) * 100) : 0,
        }))
            .sort((a, b) => b.openTasks - a.openTasks);
        // Active sprint + time remaining
        const activeSprint = sprints.find(s => s.status === 'Active') || null;
        let timeRemainingDays = null;
        let timeRemainingLabel = null;
        if (activeSprint?.endDate) {
            const dk = dateKey(activeSprint.endDate);
            if (dk) {
                timeRemainingDays = daysUntil(dk);
                timeRemainingLabel = `${timeRemainingDays} day${timeRemainingDays === 1 ? '' : 's'} until "${activeSprint.name}" ends`;
            }
        }
        else {
            const nearestDue = tasks
                .filter(t => {
                const dk = dateKey(t.dueDate);
                return t.columnId !== 'done' && dk && dk >= tKey;
            })
                .map(t => dateKey(t.dueDate))
                .sort()[0];
            if (nearestDue) {
                timeRemainingDays = daysUntil(nearestDue);
                timeRemainingLabel = `${timeRemainingDays} day${timeRemainingDays === 1 ? '' : 's'} until next deadline`;
            }
        }
        const projectLogs = await logsCollection
            .find({ projectId: new mongodb_1.ObjectId(id) })
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray();
        const recentActivity = await formatActivity(projectLogs, [project]);
        res.status(200).json({
            success: true,
            overview: {
                projectId: id,
                totalTasks,
                completedTasks,
                openTasks,
                completionRate,
                tasksDueSoon: tasksDueSoon.length,
                statusStats,
                velocity,
                teamWorkload,
                activeSprint: activeSprint
                    ? { id: activeSprint._id?.toString(), name: activeSprint.name, startDate: activeSprint.startDate, endDate: activeSprint.endDate }
                    : null,
                timeRemainingDays,
                timeRemainingLabel,
                recentActivity,
            },
        });
    }
    catch (error) {
        console.error('Project overview analytics error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch project overview.' });
    }
});
// Get Dashboard Overview Statistics
router.get('/dashboard-stats', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const tasksCollection = db.collection('tasks');
        const workspacesCollection = db.collection('workspaces');
        // Fetch user's workspaces
        const userWorkspaces = await workspacesCollection
            .find({
            $or: [
                { ownerId: new mongodb_1.ObjectId(userId) },
                { 'members.userId': new mongodb_1.ObjectId(userId) },
            ],
        })
            .toArray();
        const workspaceIds = userWorkspaces.map(w => w._id);
        // Fetch active projects in these workspaces
        const activeProjects = await projectsCollection
            .find({ workspaceId: { $in: workspaceIds }, status: 'active' })
            .toArray();
        const projectIds = activeProjects.map(p => p._id);
        // Fetch tasks assigned to the user or in user's active projects
        const totalTasks = await tasksCollection.countDocuments({ projectId: { $in: projectIds } });
        const assignedTasks = await tasksCollection.countDocuments({ assigneeIds: new mongodb_1.ObjectId(userId) });
        const completedTasksCount = await tasksCollection.countDocuments({
            projectId: { $in: projectIds },
            columnId: 'done',
        });
        const pendingTasksCount = totalTasks - completedTasksCount;
        // Fetch task count by priority
        const priorityStats = await tasksCollection
            .aggregate([
            { $match: { projectId: { $in: projectIds } } },
            { $group: { _id: '$priority', count: { $sum: 1 } } },
        ])
            .toArray();
        // Fetch task count by column/status
        const columnStats = await tasksCollection
            .aggregate([
            { $match: { projectId: { $in: projectIds } } },
            { $group: { _id: '$columnId', count: { $sum: 1 } } },
        ])
            .toArray();
        res.status(200).json({
            success: true,
            stats: {
                activeWorkspaces: userWorkspaces.length,
                activeProjects: activeProjects.length,
                totalTasks,
                assignedTasks,
                completedTasks: completedTasksCount,
                pendingTasks: pendingTasksCount,
                completionRate: totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0,
                priorityStats: priorityStats.map(p => ({ priority: p._id || 'Medium', count: p.count })),
                statusStats: columnStats.map(c => ({ status: c._id || 'todo', count: c.count })),
            },
        });
    }
    catch (error) {
        console.error('Analytics stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics.' });
    }
});
exports.default = router;
