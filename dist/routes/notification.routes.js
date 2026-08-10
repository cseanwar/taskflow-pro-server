"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Get User Notifications
router.get('/', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        const notificationsCollection = db.collection('notifications');
        const notifications = await notificationsCollection
            .find({ userId: new mongodb_1.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .limit(30)
            .toArray();
        const formatted = notifications.map(n => ({
            ...n,
            _id: n._id?.toString(),
            userId: n.userId.toString(),
        }));
        res.status(200).json({ success: true, notifications: formatted });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
    }
});
// Mark Notification as Read
router.patch('/:id/read', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const notificationsCollection = db.collection('notifications');
        await notificationsCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { read: true } });
        res.status(200).json({ success: true, message: 'Notification marked as read.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notification.' });
    }
});
exports.default = router;
