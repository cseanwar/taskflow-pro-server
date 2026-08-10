"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
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
