import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { INotification } from '../types';

const router = Router();

const FORMAT_KEYS = ['_id', 'userId', 'actorId'] as const;

function formatNotification(n: INotification) {
  const formatted: Record<string, unknown> = { ...(n as unknown as object) };
  for (const key of FORMAT_KEYS) {
    const value = (n as unknown as Record<string, unknown>)[key];
    formatted[key] = value ? value.toString() : undefined;
  }
  return formatted;
}

// Get User Notifications — ?tab=all | unread | archived
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const tab = req.query.tab === 'unread' || req.query.tab === 'archived' ? req.query.tab : 'all';
    const db = await connectDB();
    const notificationsCollection = db.collection<INotification>('notifications');

    const filter: Record<string, unknown> = { userId: new ObjectId(userId) };
    if (tab === 'unread') filter.read = false;
    if (tab === 'archived') filter.archived = true;
    else filter.archived = { $ne: true };

    const notifications = await notificationsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(60)
      .toArray();

    res.status(200).json({ success: true, notifications: notifications.map(formatNotification) });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
});

// Get Unread Notification Count (for the navbar badge)
router.get('/unread-count', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const db = await connectDB();
    const count = await db.collection<INotification>('notifications').countDocuments({
      userId: new ObjectId(userId),
      read: false,
      archived: { $ne: true },
    });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch notification count.' });
  }
});

// Mark All Notifications as Read
router.patch('/read-all', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const db = await connectDB();
    await db.collection<INotification>('notifications').updateMany(
      { userId: new ObjectId(userId), read: false },
      { $set: { read: true } }
    );
    res.status(200).json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update notifications.' });
  }
});

// Mark Notification as Read
router.patch('/:id/read', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;
    const db = await connectDB();
    const notificationsCollection = db.collection<INotification>('notifications');

    await notificationsCollection.updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { read: true } }
    );

    res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update notification.' });
  }
});

// Archive / Unarchive Notification
router.patch('/:id/archive', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;
    const db = await connectDB();

    await db.collection<INotification>('notifications').updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { archived: true } }
    );

    res.status(200).json({ success: true, message: 'Notification archived.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to archive notification.' });
  }
});

router.patch('/:id/unarchive', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;
    const db = await connectDB();

    await db.collection<INotification>('notifications').updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(userId) },
      { $set: { archived: false } }
    );

    res.status(200).json({ success: true, message: 'Notification restored.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to restore notification.' });
  }
});

// Delete Notification
router.delete('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.id;
    const db = await connectDB();

    await db.collection<INotification>('notifications').deleteOne({
      _id: new ObjectId(id),
      userId: new ObjectId(userId),
    });

    res.status(200).json({ success: true, message: 'Notification deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete notification.' });
  }
});

export default router;