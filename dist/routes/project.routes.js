"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const authz_middleware_1 = require("../middleware/authz.middleware");
const router = (0, express_1.Router)();
// Create Project (Project Manager / Workspace Owner / Administrator in the target workspace)
router.post('/', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireWorkspaceAccess)({ locator: { source: 'body', key: 'workspaceId' }, min: 3 }), async (req, res) => {
    try {
        const { workspaceId, name, code, description, category } = req.body;
        if (!workspaceId || !name) {
            return res.status(400).json({ success: false, message: 'Workspace ID and project name are required.' });
        }
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const boardsCollection = db.collection('boards');
        const projectCode = code || name.substring(0, 3).toUpperCase();
        const newProject = {
            workspaceId: new mongodb_1.ObjectId(workspaceId),
            name,
            code: projectCode,
            description: description || '',
            category: category || 'Software',
            status: 'active',
            managerId: new mongodb_1.ObjectId(userId),
            members: [new mongodb_1.ObjectId(userId)],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await projectsCollection.insertOne(newProject);
        const projectId = result.insertedId;
        // Initialize Default Kanban Board & Columns
        const defaultBoard = {
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
        await boardsCollection.insertOne(defaultBoard);
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
    }
    catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ success: false, message: 'Failed to create project.' });
    }
});
// List Projects by Workspace (any workspace member, including guests, can read)
router.get('/workspace/:workspaceId', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireWorkspaceAccess)({ locator: { source: 'params', key: 'workspaceId' }, min: 1 }), async (req, res) => {
    try {
        const workspaceId = req.params.workspaceId;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const projects = await projectsCollection
            .find({ workspaceId: new mongodb_1.ObjectId(workspaceId) })
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch projects.' });
    }
});
// Get Single Project Details (read for any workspace member / guest)
router.get('/:id', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 1 }), async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const boardsCollection = db.collection('boards');
        const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!project) {
            return res.status(404).json({ success: false, message: 'Project not found.' });
        }
        const board = await boardsCollection.findOne({ projectId: new mongodb_1.ObjectId(id) });
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch project details.' });
    }
});
// Update Project (Project Manager / Workspace Owner / Administrator)
router.put('/:id', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 3 }), async (req, res) => {
    try {
        const id = req.params.id;
        const { name, code, description, category, status, features } = req.body;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const updateFields = { updatedAt: new Date() };
        if (name)
            updateFields.name = name;
        if (code)
            updateFields.code = code;
        if (description !== undefined)
            updateFields.description = description;
        if (category)
            updateFields.category = category;
        if (status)
            updateFields.status = status;
        if (features && typeof features === 'object')
            updateFields.features = features;
        await projectsCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: updateFields });
        res.status(200).json({ success: true, message: 'Project updated successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update project.' });
    }
});
// Add or Set Project Member Role (Project Manager+)
router.post('/:id/members', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 3 }), async (req, res) => {
    try {
        const id = req.params.id;
        const { userId, role } = req.body;
        const allowedRoles = ['Project Manager', 'Team Member', 'Guest User', 'Workspace Owner'];
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User is required.' });
        }
        if (!role || !allowedRoles.includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role.' });
        }
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const usersCollection = db.collection('users');
        const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!project)
            return res.status(404).json({ success: false, message: 'Project not found.' });
        const targetUser = await usersCollection.findOne({ _id: new mongodb_1.ObjectId(userId) });
        if (!targetUser)
            return res.status(400).json({ success: false, message: 'User not found.' });
        // Keep the id-based members list in sync and store the granted role.
        const memberId = new mongodb_1.ObjectId(userId);
        const members = project.members.some(m => m.toString() === userId)
            ? project.members
            : [...project.members, memberId];
        const memberRoles = (project.memberRoles || []).filter(mr => mr.userId.toString() !== userId);
        memberRoles.push({ userId: memberId, role: role });
        await projectsCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { members, memberRoles, updatedAt: new Date() } });
        res.status(200).json({
            success: true,
            message: 'Project member added.',
            member: { userId, role },
        });
    }
    catch (error) {
        console.error('Add project member error:', error);
        res.status(500).json({ success: false, message: 'Failed to add project member.' });
    }
});
// Change Project Member Role (Project Manager+)
router.patch('/:id/members/:userId/role', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 3 }), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.params.userId;
        const { role } = req.body;
        const allowedRoles = ['Project Manager', 'Team Member', 'Guest User', 'Workspace Owner'];
        if (!role || !allowedRoles.includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role.' });
        }
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!project)
            return res.status(404).json({ success: false, message: 'Project not found.' });
        if (project.managerId?.toString() === userId) {
            return res.status(400).json({ success: false, message: 'The project lead role cannot be changed.' });
        }
        const memberRoles = [
            ...(project.memberRoles || []).filter(mr => mr.userId.toString() !== userId),
            { userId: new mongodb_1.ObjectId(userId), role: role },
        ];
        await projectsCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { memberRoles, updatedAt: new Date() } });
        res.status(200).json({ success: true, message: 'Project member role updated.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update project member role.' });
    }
});
// Remove Project Member (Project Manager+)
router.delete('/:id/members/:userId', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 3 }), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.params.userId;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const project = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!project)
            return res.status(404).json({ success: false, message: 'Project not found.' });
        if (project.managerId?.toString() === userId) {
            return res.status(400).json({ success: false, message: 'The project lead cannot be removed.' });
        }
        await projectsCollection.updateOne({ _id: new mongodb_1.ObjectId(id) }, {
            $set: {
                members: project.members.filter(m => m.toString() !== userId),
                memberRoles: (project.memberRoles || []).filter(mr => mr.userId.toString() !== userId),
                updatedAt: new Date(),
            },
        });
        res.status(200).json({ success: true, message: 'Project member removed.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove project member.' });
    }
});
// Delete Project (Project Manager / Workspace Owner / Administrator)
router.delete('/:id', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 3 }), async (req, res) => {
    try {
        const id = req.params.id;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const tasksCollection = db.collection('tasks');
        const boardsCollection = db.collection('boards');
        await projectsCollection.deleteOne({ _id: new mongodb_1.ObjectId(id) });
        await tasksCollection.deleteMany({ projectId: new mongodb_1.ObjectId(id) });
        await boardsCollection.deleteMany({ projectId: new mongodb_1.ObjectId(id) });
        res.status(200).json({ success: true, message: 'Project deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete project.' });
    }
});
// Duplicate Project (Project Manager / Workspace Owner / Administrator)
router.post('/:id/duplicate', auth_middleware_1.verifyToken, (0, authz_middleware_1.requireProjectAccess)({ min: 3 }), async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id;
        const db = await (0, db_1.connectDB)();
        const projectsCollection = db.collection('projects');
        const boardsCollection = db.collection('boards');
        const original = await projectsCollection.findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!original) {
            return res.status(404).json({ success: false, message: 'Original project not found.' });
        }
        const duplicatedProject = {
            workspaceId: original.workspaceId,
            name: `${original.name} (Copy)`,
            code: `${original.code}2`,
            description: original.description,
            category: original.category,
            status: 'active',
            managerId: new mongodb_1.ObjectId(userId),
            members: original.members,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await projectsCollection.insertOne(duplicatedProject);
        const newProjectId = result.insertedId;
        const originalBoard = await boardsCollection.findOne({ projectId: new mongodb_1.ObjectId(id) });
        if (originalBoard) {
            await boardsCollection.insertOne({
                projectId: newProjectId,
                name: `${duplicatedProject.name} Board`,
                columns: originalBoard.columns,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        }
        res.status(201).json({ success: true, message: 'Project duplicated successfully.', projectId: newProjectId.toString() });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to duplicate project.' });
    }
});
exports.default = router;
