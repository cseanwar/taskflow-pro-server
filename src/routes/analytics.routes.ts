import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { requireGlobalOrAnyWorkspaceMinLevel, requireProjectAccess } from '../middleware/authz.middleware';
import { ITask, IProject, IWorkspace, ISprint, IActivityLog, IUser } from '../types';

const router = Router();

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

// Normalize a dueDate value to a YYYY-MM-DD key (timezone-safe for date-only strings).
function dateKey(due: any): string | null {
  if (due === null || due === undefined || due === '') return null;
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const d = new Date(due);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysUntil(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  return Math.round((target - now) / 86400000);
}

async function formatActivity(logs: IActivityLog[], projects: IProject[]) {
  const db = await connectDB();
  const usersCollection = db.collection<IUser>('users');
  const actorIds = logs.map(l => new ObjectId(l.actorId.toString()));
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
router.get('/user-dashboard', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');
    const projectsCollection = db.collection<IProject>('projects');
    const tasksCollection = db.collection<ITask>('tasks');
    const logsCollection = db.collection<IActivityLog>('activity_logs');

    const userWorkspaces = await workspacesCollection
      .find({ $or: [{ ownerId: new ObjectId(userId) }, { 'members.userId': new ObjectId(userId) }] })
      .toArray();
    const workspaceIds = userWorkspaces.map(w => w._id as ObjectId);

    const activeProjects = await projectsCollection
      .find({ workspaceId: { $in: workspaceIds }, status: 'active' })
      .toArray();
    const projectIds = activeProjects.map(p => p._id as ObjectId);

    const tasks = await tasksCollection.find({ projectId: { $in: projectIds } }).toArray();
    const completedTasks = tasks.filter(t => t.columnId === 'done');
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;

    const tKey = todayKey();
    const tasksDueToday = tasks.filter(t => dateKey(t.dueDate) === tKey);
    const assignedTasks = tasks.filter(t => (t.assigneeIds || []).some(id => id.toString() === userId));

    // Recent Projects with progress + nearest upcoming due date
    const projectTaskMap = new Map<string, ITask[]>();
    tasks.forEach(t => {
      const pid = t.projectId.toString();
      if (!projectTaskMap.has(pid)) projectTaskMap.set(pid, []);
      projectTaskMap.get(pid)!.push(t);
    });

    const recentProjects = activeProjects
      .map(p => {
        const pTasks = projectTaskMap.get(p._id?.toString()) || [];
        const done = pTasks.filter(t => t.columnId === 'done').length;
        const progress = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
        const openWithDue = pTasks
          .filter(t => t.columnId !== 'done' && dateKey(t.dueDate))
          .map(t => dateKey(t.dueDate)!)
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
        const dkA = dateKey(a.dueDate)!;
        const dkB = dateKey(b.dueDate)!;
        if (dkA !== dkB) return dkA < dkB ? -1 : 1;
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
        $or: [{ projectId: { $in: projectIds } }, { actorId: new ObjectId(userId) }],
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
  } catch (error) {
    console.error('User dashboard analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user dashboard.' });
  }
});

// Get Project Overview Analytics (Project Manager / Workspace Owner / Administrator)
router.get('/project/:id', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const tasksCollection = db.collection<ITask>('tasks');
    const sprintsCollection = db.collection<ISprint>('sprints');
    const logsCollection = db.collection<IActivityLog>('activity_logs');
    const usersCollection = db.collection<IUser>('users');

    const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const tasks = await tasksCollection.find({ projectId: new ObjectId(id) }).toArray();
    const sprints = await sprintsCollection.find({ projectId: new ObjectId(id) }).sort({ createdAt: 1 }).toArray();

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.columnId === 'done').length;
    const openTasks = totalTasks - completedTasks;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const tKey = todayKey();
    const tasksDueSoon = tasks.filter(t => {
      const dk = dateKey(t.dueDate);
      return t.columnId !== 'done' && dk && dk >= tKey && daysUntil(dk) <= 7;
    });

    const statusStats = tasks.reduce((acc: Record<string, number>, t) => {
      acc[t.columnId] = (acc[t.columnId] || 0) + 1;
      return acc;
    }, {});

    // Velocity: committed vs completed per sprint (counts + story points)
    const velocity = sprints.map(s => {
      const sprintTasks = tasks.filter(t => t.sprintId?.toString() === s._id?.toString());
      const completed = sprintTasks.filter(t => t.columnId === 'done');
      return {
        sprintId: s._id?.toString(),
        name: s.name,
        status: s.status,
        committed: sprintTasks.length,
        completed: completed.length,
        committedPoints: sprintTasks.reduce((sum, t) => sum + (t.estimate || 0), 0),
        completedPoints: completed.reduce((sum, t) => sum + (t.estimate || 0), 0),
      };
    });

    // Team workload: per assignee counts + column heatmap + capacity %
    const userMap = new Map<string, IUser>();
    const assigneeIds = new Set<string>();
    tasks.forEach(t => (t.assigneeIds || []).forEach(aid => assigneeIds.add(aid.toString())));
    const users = await usersCollection
      .find({ _id: { $in: Array.from(assigneeIds).map(a => new ObjectId(a)) } }, { projection: { password: 0 } })
      .toArray();
    users.forEach(u => userMap.set(u._id?.toString(), u));

    const CAPACITY = 10; // open tasks considered "full" allocation
    const workloadMap = new Map<
      string,
      { totalTasks: number; completedTasks: number; openTasks: number; byColumn: Record<string, number> }
    >();
    tasks.forEach(t => {
      (t.assigneeIds || []).forEach(aid => {
        const id = aid.toString();
        const entry = workloadMap.get(id) || { totalTasks: 0, completedTasks: 0, openTasks: 0, byColumn: {} };
        entry.totalTasks += 1;
        if (t.columnId === 'done') entry.completedTasks += 1;
        else {
          entry.openTasks += 1;
          entry.byColumn[t.columnId] = (entry.byColumn[t.columnId] || 0) + 1;
        }
        workloadMap.set(id, entry);
      });
    });

    const teamWorkload = Array.from(workloadMap.entries())
      .map(([userId, counts]) => {
        const workloadPercent = Math.min(100, Math.round((counts.openTasks / CAPACITY) * 100));
        return {
          userId,
          name: userMap.get(userId)?.name || 'Unknown User',
          avatar: userMap.get(userId)?.avatar || '',
          ...counts,
          progress: counts.totalTasks > 0 ? Math.round((counts.completedTasks / counts.totalTasks) * 100) : 0,
          capacity: CAPACITY,
          workloadPercent,
          allocation:
            workloadPercent > 100 ? 'over' : workloadPercent >= 80 ? 'high' : workloadPercent <= 20 ? 'under' : 'ok',
        };
      })
      .sort((a, b) => b.openTasks - a.openTasks);

    // Team productivity: features vs bugs completed per member
    const isBug = (t: ITask) => (t.labels || []).some(l => /bug/i.test(l));
    const productivityMap = new Map<
      string,
      { completedFeatures: number; completedBugs: number; openFeatures: number; openBugs: number }
    >();
    tasks.forEach(t => {
      const bug = isBug(t);
      (t.assigneeIds || []).forEach(aid => {
        const id = aid.toString();
        const entry =
          productivityMap.get(id) || { completedFeatures: 0, completedBugs: 0, openFeatures: 0, openBugs: 0 };
        if (t.columnId === 'done') {
          if (bug) entry.completedBugs += 1;
          else entry.completedFeatures += 1;
        } else {
          if (bug) entry.openBugs += 1;
          else entry.openFeatures += 1;
        }
        productivityMap.set(id, entry);
      });
    });

    const teamProductivity = Array.from(productivityMap.entries())
      .map(([userId, counts]) => {
        const totalCompleted = counts.completedFeatures + counts.completedBugs;
        const totalOpen = counts.openFeatures + counts.openBugs;
        return {
          userId,
          name: userMap.get(userId)?.name || 'Unknown User',
          avatar: userMap.get(userId)?.avatar || '',
          ...counts,
          totalCompleted,
          totalOpen,
          completionRate: totalCompleted + totalOpen > 0 ? Math.round((totalCompleted / (totalCompleted + totalOpen)) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalCompleted - a.totalCompleted);

    // Cycle time: average days from creation to completion
    const doneTasks = tasks.filter(t => t.columnId === 'done' && t.completedAt);
    const cycleTimeDays =
      doneTasks.length > 0
        ? Math.round(
            (doneTasks.reduce((sum, t) => {
              const start = new Date(t.createdAt).getTime();
              const end = new Date(t.completedAt as Date).getTime();
              return sum + (end > start ? (end - start) / 86400000 : 0);
            }, 0) /
              doneTasks.length) *
              10
          ) / 10
        : 0;

    // Active sprint + time remaining
    const activeSprint = sprints.find(s => s.status === 'Active') || null;
    let timeRemainingDays: number | null = null;
    let timeRemainingLabel: string | null = null;
    if (activeSprint?.endDate) {
      const dk = dateKey(activeSprint.endDate);
      if (dk) {
        timeRemainingDays = daysUntil(dk);
        timeRemainingLabel = `${timeRemainingDays} day${timeRemainingDays === 1 ? '' : 's'} until "${activeSprint.name}" ends`;
      }
    } else {
      const nearestDue = tasks
        .filter(t => {
          const dk = dateKey(t.dueDate);
          return t.columnId !== 'done' && dk && dk >= tKey;
        })
        .map(t => dateKey(t.dueDate)!)
        .sort()[0];
      if (nearestDue) {
        timeRemainingDays = daysUntil(nearestDue);
        timeRemainingLabel = `${timeRemainingDays} day${timeRemainingDays === 1 ? '' : 's'} until next deadline`;
      }
    }

    const projectLogs = await logsCollection
      .find({ projectId: new ObjectId(id) })
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
        teamProductivity,
        cycleTimeDays,
        activeSprint: activeSprint
          ? { id: activeSprint._id?.toString(), name: activeSprint.name, startDate: activeSprint.startDate, endDate: activeSprint.endDate }
          : null,
        timeRemainingDays,
        timeRemainingLabel,
        recentActivity,
      },
    });
  } catch (error) {
    console.error('Project overview analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch project overview.' });
  }
});


// List the user's active projects for the reports selector
// (requires Project Manager level in at least one workspace, or a PM+ global role)
router.get('/projects', verifyToken, requireGlobalOrAnyWorkspaceMinLevel(3), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');
    const projectsCollection = db.collection<IProject>('projects');

    const userWorkspaces = await workspacesCollection
      .find({ $or: [{ ownerId: new ObjectId(userId) }, { 'members.userId': new ObjectId(userId) }] })
      .toArray();
    const workspaceIds = userWorkspaces.map(w => w._id as ObjectId);
    const wsMap = new Map(userWorkspaces.map(w => [w._id?.toString(), w.name]));

    const projects = await projectsCollection
      .find({ workspaceId: { $in: workspaceIds }, status: 'active' })
      .sort({ updatedAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      projects: projects.map(p => ({
        _id: p._id?.toString(),
        name: p.name,
        code: p.code,
        category: p.category || '',
        status: p.status,
        workspaceId: p.workspaceId.toString(),
        workspaceName: wsMap.get(p.workspaceId.toString()) || '',
      })),
    });
  } catch (error) {
    console.error('Report projects error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch projects.' });
  }
});


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
