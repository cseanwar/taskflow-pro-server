import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { ITask, IProject, IWorkspace } from '../types';

const router = Router();

// Get Dashboard Overview Statistics
router.get('/dashboard-stats', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const tasksCollection = db.collection<ITask>('tasks');
    const workspacesCollection = db.collection<IWorkspace>('workspaces');

    // Fetch user's workspaces
    const userWorkspaces = await workspacesCollection
      .find({
        $or: [
          { ownerId: new ObjectId(userId) },
          { 'members.userId': new ObjectId(userId) },
        ],
      })
      .toArray();

    const workspaceIds = userWorkspaces.map(w => w._id as ObjectId);

    // Fetch active projects in these workspaces
    const activeProjects = await projectsCollection
      .find({ workspaceId: { $in: workspaceIds }, status: 'active' })
      .toArray();

    const projectIds = activeProjects.map(p => p._id as ObjectId);

    // Fetch tasks assigned to the user or in user's active projects
    const totalTasks = await tasksCollection.countDocuments({ projectId: { $in: projectIds } });
    const assignedTasks = await tasksCollection.countDocuments({ assigneeIds: new ObjectId(userId) });

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
  } catch (error) {
    console.error('Analytics stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics.' });
  }
});

export default router;
