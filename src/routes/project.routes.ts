import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { IProject, IBoard, ITask } from '../types';

const router = Router();

// Create Project
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
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

// Get Projects by Workspace
router.get('/workspace/:workspaceId', verifyToken, async (req: AuthRequest, res: Response) => {
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
    }));

    res.status(200).json({ success: true, projects: formattedProjects });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch projects.' });
  }
});

// Get Single Project Details
router.get('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
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
      board: board ? { ...board, _id: board._id?.toString(), projectId: board.projectId.toString() } : null,
    };

    res.status(200).json({ success: true, project: formattedProject });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch project details.' });
  }
});

// Update Project
router.put('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, code, description, category, status } = req.body;

    const db = await connectDB();
    const projectsCollection = db.collection<IProject>('projects');

    const updateFields: any = { updatedAt: new Date() };
    if (name) updateFields.name = name;
    if (code) updateFields.code = code;
    if (description !== undefined) updateFields.description = description;
    if (category) updateFields.category = category;
    if (status) updateFields.status = status;

    await projectsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    res.status(200).json({ success: true, message: 'Project updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update project.' });
  }
});

// Delete Project
router.delete('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
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

// Duplicate Project
router.post('/:id/duplicate', verifyToken, async (req: AuthRequest, res: Response) => {
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
