"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const FORMAT_KEYS = ['_id', 'userId', 'actorId'];
function formatNotification(n) {
    const formatted = { ...n };
    for (const key of FORMAT_KEYS) {
        const value = n[key];
        formatted[key] = value ? value.toString() : undefined;
    }
    return formatted;
}
// Get User Notifications — ?tab=all | unread | archived
router.get('/', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const tab = req.query.tab === 'unread' || req.query.tab === 'archived' ? req.query.tab : 'all';
        const db = await (0, db_1.connectDB)();
        const notificationsCollection = db.collection('notifications');
        const filter = { userId: new mongodb_1.ObjectId(userId) };
        if (tab === 'unread')
            filter.read = false;
        if (tab === 'archived')
            filter.archived = true;
        else
            filter.archived = { $ne: true };
        const notifications = await notificationsCollection
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(60)
            .toArray();
        res.status(200).json({ success: true, notifications: notifications.map(formatNotification) });
    }
    catch (error) {
        console.error('Fetch notifications error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
    }
});
// Get Unread Notification Count (for the navbar badge)
router.get('/unread-count', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        const count = await db.collection('notifications').countDocuments({
            userId: new mongodb_1.ObjectId(userId),
            read: false,
            archived: { $ne: true },
        });
        res.status(200).json({ success: true, count });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notification count.' });
    }
});
// Mark All Notifications as Read
router.patch('/read-all', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        await db.collection('notifications').updateMany({ userId: new mongodb_1.ObjectId(userId), read: false }, { $set: { read: true } });
        res.status(200).json({ success: true, message: 'All notifications marked as read.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notifications.' });
    }
});
// Mark Notification as Read
router.patch('/:id/read', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        const notificationsCollection = db.collection('notifications');
        await notificationsCollection.updateOne({ _id: new mongodb_1.ObjectId(id), userId: new mongodb_1.ObjectId(userId) }, { $set: { read: true } });
        res.status(200).json({ success: true, message: 'Notification marked as read.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notification.' });
    }
});
// Archive / Unarchive Notification
router.patch('/:id/archive', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        await db.collection('notifications').updateOne({ _id: new mongodb_1.ObjectId(id), userId: new mongodb_1.ObjectId(userId) }, { $set: { archived: true } });
        res.status(200).json({ success: true, message: 'Notification archived.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to archive notification.' });
    }
});
router.patch('/:id/unarchive', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        await db.collection('notifications').updateOne({ _id: new mongodb_1.ObjectId(id), userId: new mongodb_1.ObjectId(userId) }, { $set: { archived: false } });
        res.status(200).json({ success: true, message: 'Notification restored.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to restore notification.' });
    }
});
// Delete Notification
router.delete('/:id', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        await db.collection('notifications').deleteOne({
            _id: new mongodb_1.ObjectId(id),
            userId: new mongodb_1.ObjectId(userId),
        });
        res.status(200).json({ success: true, message: 'Notification deleted.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete notification.' });
    }
});
exports.default = router;
