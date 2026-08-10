import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { INotification } from '../types';

const router = Router();

// Get User Notifications
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const db = await connectDB();
    const notificationsCollection = db.collection<INotification>('notifications');

    const notifications = await notificationsCollection
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();

    const formatted = notifications.map(n => ({
      ...n,
      _id: n._id?.toString(),
      userId: n.userId.toString(),
    }));

    res.status(200).json({ success: true, notifications: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
});

// Mark Notification as Read
router.patch('/:id/read', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const notificationsCollection = db.collection<INotification>('notifications');

    await notificationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { read: true } }
    );

    res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update notification.' });
  }
});

export default router;
