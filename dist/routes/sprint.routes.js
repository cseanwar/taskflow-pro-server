"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const authz_middleware_1 = require("../middleware/authz.middleware");
const activity_1 = require("../lib/activity");
const router = (0, express_1.Router)();
// Create Sprint (Project Manager / Workspace Owner / Administrator)
router.post('/', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ locator: { source: 'body', key: 'projectId' }, min: 3 }), async (req, res) => {
    try {
        const { projectId, name, goal, startDate, endDate } = req.body;
        if (!projectId || !name) {
            return res.status(400).json({ success: false, message: 'Project ID and Sprint Name are required.' });
        }
        const db = await (0, db_1.connectDB)();
        const sprintsCollection = db.collection('sprints');
        const newSprint = {
            projectId: new mongodb_1.ObjectId(projectId),
            name,
            goal: goal || '',
            startDate: startDate || null,
            endDate: endDate || null,
            status: 'Planned',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await sprintsCollection.insertOne(newSprint);
        res.status(201).json({
            success: true,
            sprint: {
                ...newSprint,
                _id: result.insertedId.toString(),
                projectId: projectId,
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create sprint.' });
    }
});
// Get Sprints by Project (any workspace member / guest)
router.get('/project/:projectId', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ locator: { source: 'params', key: 'projectId' }, min: 1 }), async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const db = await (0, db_1.connectDB)();
        const sprintsCollection = db.collection('sprints');
        const sprints = await sprintsCollection
            .find({ projectId: new mongodb_1.ObjectId(projectId) })
            .sort({ createdAt: -1 })
            .toArray();
        const formattedSprints = sprints.map(s => ({
            ...s,
            _id: s._id?.toString(),
            projectId: s.projectId.toString(),
        }));
        res.status(200).json({ success: true, sprints: formattedSprints });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch sprints.' });
    }
});
// Start / Complete Sprint (Project Manager / Workspace Owner / Administrator)
router.patch('/:id/status', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireSprintAccess)(3), async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body;
        if (!['Planned', 'Active', 'Completed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid sprint status.' });
        }
        const db = await (0, db_1.connectDB)();
        const sprintsCollection = db.collection('sprints');
        await sprintsCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { status, updatedAt: new Date() } });
        const sprint = await sprintsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (sprint && req.user?.id) {
            await (0, activity_1.logActivity)({
                projectId: sprint.projectId,
                actorId: req.user?.id,
                action: `${status === 'Active' ? 'Started' : status === 'Completed' ? 'Completed' : 'Returned to planned'} sprint "${sprint.name}"`,
            });
        }
        res.status(200).json({ success: true, message: `Sprint marked as ${status}` });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update sprint status.' });
    }
});
exports.default = router;
