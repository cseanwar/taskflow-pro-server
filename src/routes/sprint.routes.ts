import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { ISprint, ITask } from '../types';
import { logActivity } from '../lib/activity';

const router = Router();

// Create Sprint
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, name, goal, startDate, endDate } = req.body;
    if (!projectId || !name) {
      return res.status(400).json({ success: false, message: 'Project ID and Sprint Name are required.' });
    }

    const db = await connectDB();
    const sprintsCollection = db.collection<ISprint>('sprints');

    const newSprint: ISprint = {
      projectId: new ObjectId(projectId),
      name,
      goal: goal || '',
      startDate: startDate || null,
      endDate: endDate || null,
      status: 'Planned',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await sprintsCollection.insertOne(newSprint as any);

    res.status(201).json({
      success: true,
      sprint: {
        ...newSprint,
        _id: result.insertedId.toString(),
        projectId: projectId,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create sprint.' });
  }
});

// Get Sprints by Project
router.get('/project/:projectId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const db = await connectDB();
    const sprintsCollection = db.collection<ISprint>('sprints');

    const sprints = await sprintsCollection
      .find({ projectId: new ObjectId(projectId) })
      .sort({ createdAt: -1 })
      .toArray();

    const formattedSprints = sprints.map(s => ({
      ...s,
      _id: s._id?.toString(),
      projectId: s.projectId.toString(),
    }));

    res.status(200).json({ success: true, sprints: formattedSprints });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch sprints.' });
  }
});

// Start or End Sprint
router.patch('/:id/status', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!['Planned', 'Active', 'Completed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid sprint status.' });
    }

    const db = await connectDB();
    const sprintsCollection = db.collection<ISprint>('sprints');

    await sprintsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    const sprint = await sprintsCollection.findOne({ _id: new ObjectId(id) });
    if (sprint && req.user?.id) {
      await logActivity({
        projectId: sprint.projectId,
        actorId: req.user?.id,
        action: `${status === 'Active' ? 'Started' : status === 'Completed' ? 'Completed' : 'Returned to planned'} sprint "${sprint.name}"`,
      });
    }

    res.status(200).json({ success: true, message: `Sprint marked as ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update sprint status.' });
  }
});

export default router;
