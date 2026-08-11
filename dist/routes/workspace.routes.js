"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const authz_middleware_1 = require("../middleware/authz.middleware");
const router = (0, express_1.Router)();
// Create Workspace
router.post('/', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const { name, description, logo } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Workspace name is required.' });
        }
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        const newWorkspace = {
            name,
            slug,
            description: description || '',
            logo: logo || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`,
            ownerId: new mongodb_1.ObjectId(userId),
            members: [
                {
                    userId: new mongodb_1.ObjectId(userId),
                    role: 'Workspace Owner',
                    joinedAt: new Date(),
                },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await workspacesCollection.insertOne(newWorkspace);
        const createdWorkspace = { ...newWorkspace, _id: result.insertedId.toString() };
        res.status(201).json({ success: true, workspace: createdWorkspace });
    }
    catch (error) {
        console.error('Create workspace error:', error);
        res.status(500).json({ success: false, message: 'Failed to create workspace.' });
    }
});
// Get User's Workspaces
router.get('/', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        const workspaces = await workspacesCollection
            .find({
            $or: [
                { ownerId: new mongodb_1.ObjectId(userId) },
                { 'members.userId': new mongodb_1.ObjectId(userId) },
            ],
        })
            .toArray();
        const formattedWorkspaces = workspaces.map(w => ({
            ...w,
            _id: w._id?.toString(),
            ownerId: w.ownerId.toString(),
            members: w.members.map(m => ({ ...m, userId: m.userId.toString() })),
        }));
        res.status(200).json({ success: true, workspaces: formattedWorkspaces });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch workspaces.' });
    }
});
// Get Workspace Details with Member Details
router.get('/:id', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireWorkspaceAccess)({ min: 1 }), async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        const usersCollection = db.collection('users');
        const workspace = await workspacesCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!workspace) {
            return res.status(404).json({ success: false, message: 'Workspace not found.' });
        }
        const memberUserIds = workspace.members.map(m => new mongodb_1.ObjectId(m.userId.toString()));
        const memberUsers = await usersCollection
            .find({ _id: { $in: memberUserIds } }, { projection: { password: 0 } })
            .toArray();
        const userMap = new Map(memberUsers.map(u => [u._id?.toString(), u]));
        const detailedMembers = workspace.members.map(m => {
            const u = userMap.get(m.userId.toString());
            return {
                userId: m.userId.toString(),
                role: m.role,
                joinedAt: m.joinedAt,
                name: u?.name || 'Unknown User',
                email: u?.email || '',
                avatar: u?.avatar || '',
            };
        });
        const formattedWorkspace = {
            ...workspace,
            _id: workspace._id?.toString(),
            ownerId: workspace.ownerId.toString(),
            members: detailedMembers,
        };
        res.status(200).json({ success: true, workspace: formattedWorkspace });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch workspace details.' });
    }
});
// Invite Member to Workspace (Workspace Owner / Administrator only)
router.post('/:id/invite', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireWorkspaceAccess)({ min: 4 }), async (req, res) => {
    try {
        const id = req.params.id;
        const { email, role } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Member email is required.' });
        }
        // Only workspace-grantable roles may be assigned. 'Administrator' is
        // platform-level and is never assignable via invitation.
        if (role && !authz_middleware_1.INVITABLE_ROLES.includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Role is not assignable. Choose Project Manager, Team Member, or Guest User.',
            });
        }
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        const usersCollection = db.collection('users');
        const workspace = await workspacesCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!workspace) {
            return res.status(404).json({ success: false, message: 'Workspace not found.' });
        }
        const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            const isAlreadyMember = workspace.members.some(m => m.userId.toString() === existingUser._id?.toString());
            if (isAlreadyMember) {
                return res.status(400).json({ success: false, message: 'User is already a member of this workspace.' });
            }
            // Add directly if user exists
            await workspacesCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, {
                $push: {
                    members: {
                        userId: existingUser._id,
                        role: role || 'Team Member',
                        joinedAt: new Date(),
                    },
                },
                $set: { updatedAt: new Date() },
            });
            return res.status(200).json({ success: true, message: 'User added to workspace.' });
        }
        // Save invitation record
        const invitationsCollection = db.collection('invitations');
        const newInvite = {
            workspaceId: new mongodb_1.ObjectId(id),
            email: email.toLowerCase(),
            role: role || 'Team Member',
            token: new mongodb_1.ObjectId().toString(),
            invitedBy: new mongodb_1.ObjectId(req.user?.id),
            status: 'pending',
            createdAt: new Date(),
        };
        await invitationsCollection.insertOne(newInvite);
        res.status(200).json({ success: true, message: 'Invitation sent successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to invite member.' });
    }
});
// Remove Member from Workspace (Workspace Owner / Administrator only)
router.delete('/:id/members/:userId', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireWorkspaceAccess)({ min: 4 }), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.params.userId;
        const db = await (0, db_1.connectDB)();
        const workspacesCollection = db.collection('workspaces');
        if (req.workspace?.ownerId?.toString() === userId) {
            return res.status(400).json({ success: false, message: 'The workspace owner cannot be removed.' });
        }
        if (userId === req.user?.id) {
            return res.status(400).json({ success: false, message: 'You cannot remove yourself from the workspace.' });
        }
        await workspacesCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, {
            $pull: { members: { userId: new mongodb_1.ObjectId(userId) } },
            $set: { updatedAt: new Date() },
        });
        res.status(200).json({ success: true, message: 'Member removed from workspace.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove member.' });
    }
});
exports.default = router;
