import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { requireProjectAccess, requireWorkspaceAccess } from '../middleware/authz.middleware';
import { IProject, IBoard, ITask, IUser, UserRole } from '../types';

const router = Router();

// Create Project (Project Manager / Workspace Owner / Administrator in the target workspace)
router.post(
  '/',
  verifyToken,
  requireWorkspaceAccess({ locator: { source: 'body', key: 'workspaceId' }, min: 3 }),
  async (req: AuthRequest, res: Response) => {
  try {
    const { workspaceId, name, code, description, category } = req.body;
    if (!workspaceId || !name) {
      return res.status(400).json({ success: false, message: 'Workspace ID and project name are required.' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const boardsCollection = db.collection<IBoard>('boards');

    const projectCode = code || name.substring(0, 3).toUpperCase();

    const newProject: IProject = {
      workspaceId: new ObjectId(workspaceId),
      name,
      code: projectCode,
      description: description || '',
      category: category || 'Software',
      status: 'active',
      managerId: new ObjectId(userId),
      members: [new ObjectId(userId)],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await projectsCollection.insertOne(newProject as any);
    const projectId = result.insertedId;

    // Initialize Default Kanban Board & Columns
    const defaultBoard: IBoard = {
      projectId: projectId,
      name: `${name} Board`,
      columns: [
        { id: 'backlog', title: 'Backlog', order: 0 },
        { id: 'todo', title: 'To Do', order: 1 },
        { id: 'in_progress', title: 'In Progress', order: 2 },
        { id: 'review', title: 'Review', order: 3 },
        { id: 'testing', title: 'Testing', order: 4 },
        { id: 'done', title: 'Done', order: 5 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await boardsCollection.insertOne(defaultBoard as any);

    res.status(201).json({
      success: true,
      project: {
        ...newProject,
        _id: projectId.toString(),
        workspaceId: workspaceId,
        managerId: userId,
        members: [userId],
      },
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ success: false, message: 'Failed to create project.' });
  }
});

// List Projects by Workspace (any workspace member, including guests, can read)
router.get(
  '/workspace/:workspaceId',
  verifyToken,
  requireWorkspaceAccess({ locator: { source: 'params', key: 'workspaceId' }, min: 1 }),
  async (req: AuthRequest, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');

    const projects = await projectsCollection
      .find({ workspaceId: new ObjectId(workspaceId) })
      .toArray();

    const formattedProjects = projects.map(p => ({
      ...p,
      _id: p._id?.toString(),
      workspaceId: p.workspaceId.toString(),
      managerId: p.managerId.toString(),
      members: p.members.map(m => m.toString()),
      memberRoles: (p.memberRoles || []).map(mr => ({ ...mr, userId: mr.userId.toString() })),
      features: p.features || {},
    }));

    res.status(200).json({ success: true, projects: formattedProjects });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch projects.' });
  }
});

// Get Single Project Details (read for any workspace member / guest)
router.get('/:id', verifyToken, requireProjectAccess({ min: 1 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const boardsCollection = db.collection<IBoard>('boards');

    const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const board = await boardsCollection.findOne({ projectId: new ObjectId(id) });

    const formattedProject = {
      ...project,
      _id: project._id?.toString(),
      workspaceId: project.workspaceId.toString(),
      managerId: project.managerId.toString(),
      members: project.members.map(m => m.toString()),
      memberRoles: (project.memberRoles || []).map(mr => ({
        ...mr,
        userId: mr.userId.toString(),
      })),
      features: project.features || {},
      board: board ? { ...board, _id: board._id?.toString(), projectId: board.projectId.toString() } : null,
    };

    res.status(200).json({ success: true, project: formattedProject });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch project details.' });
  }
});

// Update Project (Project Manager / Workspace Owner / Administrator)
router.put('/:id', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, code, description, category, status, features } = req.body;

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');

    const updateFields: any = { updatedAt: new Date() };
    if (name) updateFields.name = name;
    if (code) updateFields.code = code;
    if (description !== undefined) updateFields.description = description;
    if (category) updateFields.category = category;
    if (status) updateFields.status = status;
    if (features && typeof features === 'object') updateFields.features = features;

    await projectsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    res.status(200).json({ success: true, message: 'Project updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update project.' });
  }
});

// Add or Set Project Member Role (Project Manager+)
router.post('/:id/members', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { userId, role } = req.body;
    const allowedRoles: UserRole[] = ['Project Manager', 'Team Member', 'Guest User', 'Workspace Owner'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User is required.' });
    }
    if (!role || !allowedRoles.includes(role as UserRole)) {
      return res.status(400).json({ success: false, message: 'Invalid role.' });
    }

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const usersCollection = db.collection<IUser>('users');

    const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found.' });

    const targetUser = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!targetUser) return res.status(400).json({ success: false, message: 'User not found.' });

    // Keep the id-based members list in sync and store the granted role.
    const memberId = new ObjectId(userId);
    const members = project.members.some(m => m.toString() === userId)
      ? project.members
      : [...project.members, memberId];

    const memberRoles = (project.memberRoles || []).filter(mr => mr.userId.toString() !== userId);
    memberRoles.push({ userId: memberId, role: role as UserRole });

    await projectsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { members, memberRoles, updatedAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: 'Project member added.',
      member: { userId, role },
    });
  } catch (error) {
    console.error('Add project member error:', error);
    res.status(500).json({ success: false, message: 'Failed to add project member.' });
  }
});

// Change Project Member Role (Project Manager+)
router.patch('/:id/members/:userId/role', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.params.userId as string;
    const { role } = req.body;
    const allowedRoles: UserRole[] = ['Project Manager', 'Team Member', 'Guest User', 'Workspace Owner'];

    if (!role || !allowedRoles.includes(role as UserRole)) {
      return res.status(400).json({ success: false, message: 'Invalid role.' });
    }

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');

    const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found.' });
    if (project.managerId?.toString() === userId) {
      return res.status(400).json({ success: false, message: 'The project lead role cannot be changed.' });
    }

    const memberRoles = [
      ...(project.memberRoles || []).filter(mr => mr.userId.toString() !== userId),
      { userId: new ObjectId(userId), role: role as UserRole },
    ];

    await projectsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { memberRoles, updatedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: 'Project member role updated.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update project member role.' });
  }
});

// Remove Project Member (Project Manager+)
router.delete('/:id/members/:userId', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.params.userId as string;

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');

    const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found.' });
    if (project.managerId?.toString() === userId) {
      return res.status(400).json({ success: false, message: 'The project lead cannot be removed.' });
    }

    await projectsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          members: project.members.filter(m => m.toString() !== userId),
          memberRoles: (project.memberRoles || []).filter(mr => mr.userId.toString() !== userId),
          updatedAt: new Date(),
        },
      }
    );

    res.status(200).json({ success: true, message: 'Project member removed.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove project member.' });
  }
});

// Delete Project (Project Manager / Workspace Owner / Administrator)
router.delete('/:id', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const tasksCollection = db.collection<ITask>('tasks');
    const boardsCollection = db.collection<IBoard>('boards');

    await projectsCollection.deleteOne({ _id: new ObjectId(id) });
    await tasksCollection.deleteMany({ projectId: new ObjectId(id) });
    await boardsCollection.deleteMany({ projectId: new ObjectId(id) });

    res.status(200).json({ success: true, message: 'Project deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete project.' });
  }
});

// Duplicate Project (Project Manager / Workspace Owner / Administrator)
router.post('/:id/duplicate', verifyToken, requireProjectAccess({ min: 3 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;
    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');
    const boardsCollection = db.collection<IBoard>('boards');

    const original = await projectsCollection.findOne({ _id: new ObjectId(id) });
    if (!original) {
      return res.status(404).json({ success: false, message: 'Original project not found.' });
    }

    const duplicatedProject: IProject = {
      workspaceId: original.workspaceId,
      name: `${original.name} (Copy)`,
      code: `${original.code}2`,
      description: original.description,
      category: original.category,
      status: 'active',
      managerId: new ObjectId(userId),
      members: original.members,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await projectsCollection.insertOne(duplicatedProject as any);
    const newProjectId = result.insertedId;

    const originalBoard = await boardsCollection.findOne({ projectId: new ObjectId(id) });
    if (originalBoard) {
      await boardsCollection.insertOne({
        projectId: newProjectId,
        name: `${duplicatedProject.name} Board`,
        columns: originalBoard.columns,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }

    res.status(201).json({ success: true, message: 'Project duplicated successfully.', projectId: newProjectId.toString() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to duplicate project.' });
  }
});

export default router;
