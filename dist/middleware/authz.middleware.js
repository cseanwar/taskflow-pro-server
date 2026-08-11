"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireGlobalRole = exports.requireGlobalMinLevel = exports.levelOf = exports.LEVEL = exports.INVITABLE_ROLES = exports.ROLE_LEVEL = void 0;
exports.workspaceRoleLevelFor = workspaceRoleLevelFor;
exports.workspaceRoleNameFor = workspaceRoleNameFor;
exports.effectiveWorkspaceLevel = effectiveWorkspaceLevel;
exports.requireWorkspaceAccess = requireWorkspaceAccess;
exports.requireProjectAccess = requireProjectAccess;
exports.requireTaskAccess = requireTaskAccess;
exports.requireSprintAccess = requireSprintAccess;
exports.requireGlobalOrAnyWorkspaceMinLevel = requireGlobalOrAnyWorkspaceMinLevel;
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
/**
 * Role hierarchy (higher = more privileges).
 * Effective level for a user within a workspace is max(global role, workspace role).
 */
exports.ROLE_LEVEL = {
    'Guest User': 1,
    'Team Member': 2,
    'Project Manager': 3,
    'Workspace Owner': 4,
    Administrator: 5,
};
/**
 * Roles a workspace owner may assign when inviting a member.
 * Administrator is platform-level and cannot be granted at the workspace level.
 */
exports.INVITABLE_ROLES = ['Project Manager', 'Team Member', 'Guest User'];
// Minimum levels per capability, mirroring the shared role model.
exports.LEVEL = {
    read: 1, // Guest + — any member can read
    contribute: 2, // Team Member + — update status, comment
    manage: 3, // Project Manager + — create/edit projects, tasks, sprints, reports
    admin: 4, // Workspace Owner + — workspace/member management
    platform: 5, // Administrator — user/suspension management
};
const levelOf = (role) => (role ? (exports.ROLE_LEVEL[role] ?? 0) : 0);
exports.levelOf = levelOf;
const forbidden = (res, message = 'Forbidden: you do not have permission to perform this action.') => res.status(403).json({ success: false, message });
const notFound = (res, message = 'Resource not found.') => res.status(404).json({ success: false, message });
const toOid = (value) => {
    if (!value)
        return null;
    try {
        return new mongodb_1.ObjectId(value);
    }
    catch {
        return null;
    }
};
// -------------------------------
// Global (JWT role) gates
// -------------------------------
/** Require the caller's global role level to be >= min. No DB lookup. */
const requireGlobalMinLevel = (min) => (req, res, next) => {
    if ((0, exports.levelOf)(req.user?.role) < min)
        return forbidden(res);
    next();
};
exports.requireGlobalMinLevel = requireGlobalMinLevel;
/** Require the caller's global role to be one of the given roles. */
const requireGlobalRole = (...roles) => (req, res, next) => {
    if (!roles.includes((req.user?.role ?? '')))
        return forbidden(res);
    next();
};
exports.requireGlobalRole = requireGlobalRole;
// -------------------------------
// Role resolution helpers
// -------------------------------
/** Workspace role level for a user (ownerId implies 'Workspace Owner'). */
function workspaceRoleLevelFor(userId, workspace) {
    if (!userId)
        return 0;
    if (workspace.ownerId?.toString() === userId)
        return exports.ROLE_LEVEL['Workspace Owner'];
    const member = workspace.members?.find(m => m.userId?.toString() === userId);
    return member ? (0, exports.levelOf)(member.role) : 0;
}
/** Workspace role string (used for messaging). Falls back to the owner title for ownerId. */
function workspaceRoleNameFor(userId, workspace) {
    if (!userId)
        return null;
    if (workspace.ownerId?.toString() === userId)
        return 'Workspace Owner';
    return workspace.members?.find(m => m.userId?.toString() === userId)?.role || null;
}
/** max(global role, workspace role) — a workspace role never overrides 'Administrator'. */
function effectiveWorkspaceLevel(globalRole, userId, workspace) {
    return Math.max((0, exports.levelOf)(globalRole), workspaceRoleLevelFor(userId, workspace));
}
const readLocator = (req, { source, key }) => {
    if (source === 'body')
        return req.body?.[key];
    const param = req.params?.[key];
    return Array.isArray(param) ? param[0] : param;
};
/**
 * Require the caller to be a member of a workspace with an effective level >= min.
 * On success attaches `req.workspace`.
 */
function requireWorkspaceAccess(opts = {}) {
    const { locator = { source: 'params', key: 'id' }, min = exports.LEVEL.read } = opts;
    return async (req, res, next) => {
        try {
            const oid = toOid(readLocator(req, locator));
            if (!oid)
                return res.status(400).json({ success: false, message: 'Invalid workspace reference.' });
            const db = await (0, db_1.connectDB)();
            const ws = await db.collection('workspaces').findOne({ _id: oid });
            if (!ws)
                return notFound(res, 'Workspace not found.');
            if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
                return forbidden(res);
            }
            req.workspace = ws;
            next();
        }
        catch (error) {
            console.error('Workspace authorization error:', error);
            res.status(500).json({ success: false, message: 'Authorization check failed.' });
        }
    };
}
/**
 * Require the caller to have an effective level >= min in the workspace of a project.
 * On success attaches `req.project` and `req.workspace`.
 */
function requireProjectAccess(opts = {}) {
    const { locator = { source: 'params', key: 'id' }, min = exports.LEVEL.read } = opts;
    return async (req, res, next) => {
        try {
            const oid = toOid(readLocator(req, locator));
            if (!oid)
                return res.status(400).json({ success: false, message: 'Invalid project reference.' });
            const db = await (0, db_1.connectDB)();
            const project = await db.collection('projects').findOne({ _id: oid });
            if (!project)
                return notFound(res, 'Project not found.');
            const wsOid = toOid(project.workspaceId?.toString());
            if (!wsOid)
                return notFound(res, 'Project workspace not found.');
            const ws = await db.collection('workspaces').findOne({ _id: wsOid });
            if (!ws)
                return notFound(res, 'Workspace not found.');
            if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
                return forbidden(res);
            }
            req.project = project;
            req.workspace = ws;
            next();
        }
        catch (error) {
            console.error('Project authorization error:', error);
            res.status(500).json({ success: false, message: 'Authorization check failed.' });
        }
    };
}
/**
 * Require the caller to have an effective level >= min in the workspace of a task
 * (resolved via task -> project -> workspace). Attaches `req.task`, `req.project`, `req.workspace`.
 */
function requireTaskAccess(min) {
    return async (req, res, next) => {
        try {
            const oid = toOid(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
            if (!oid)
                return res.status(400).json({ success: false, message: 'Invalid task reference.' });
            const db = await (0, db_1.connectDB)();
            const task = await db.collection('tasks').findOne({ _id: oid });
            if (!task)
                return notFound(res, 'Task not found.');
            const projectOid = toOid(task.projectId?.toString());
            if (!projectOid)
                return notFound(res, 'Task project not found.');
            const project = await db.collection('projects').findOne({ _id: projectOid });
            if (!project)
                return notFound(res, 'Project not found.');
            const wsOid = toOid(project.workspaceId?.toString());
            if (!wsOid)
                return notFound(res, 'Task workspace not found.');
            const ws = await db.collection('workspaces').findOne({ _id: wsOid });
            if (!ws)
                return notFound(res, 'Workspace not found.');
            if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
                return forbidden(res);
            }
            req.task = task;
            req.project = project;
            req.workspace = ws;
            next();
        }
        catch (error) {
            console.error('Task authorization error:', error);
            res.status(500).json({ success: false, message: 'Authorization check failed.' });
        }
    };
}
/**
 * Require the caller to have an effective level >= min in the workspace of a sprint.
 * Attaches `req.sprint`.
 */
function requireSprintAccess(min) {
    return async (req, res, next) => {
        try {
            const oid = toOid(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
            if (!oid)
                return res.status(400).json({ success: false, message: 'Invalid sprint reference.' });
            const db = await (0, db_1.connectDB)();
            const sprint = await db.collection('sprints').findOne({ _id: oid });
            if (!sprint)
                return notFound(res, 'Sprint not found.');
            const projectOid = toOid(sprint.projectId?.toString());
            if (!projectOid)
                return notFound(res, 'Sprint project not found.');
            const project = await db.collection('projects').findOne({ _id: projectOid });
            if (!project)
                return notFound(res, 'Project not found.');
            const wsOid = toOid(project.workspaceId?.toString());
            if (!wsOid)
                return notFound(res, 'Sprint workspace not found.');
            const ws = await db.collection('workspaces').findOne({ _id: wsOid });
            if (!ws)
                return notFound(res, 'Workspace not found.');
            if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
                return forbidden(res);
            }
            req.sprint = sprint;
            req.project = project;
            req.workspace = ws;
            next();
        }
        catch (error) {
            console.error('Sprint authorization error:', error);
            res.status(500).json({ success: false, message: 'Authorization check failed.' });
        }
    };
}
/**
 * Require an effective level >= min in ANY of the user's workspaces (or via global role).
 * Used for platform-wide surfaces such as Analytics & Reports.
 */
function requireGlobalOrAnyWorkspaceMinLevel(min) {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            let maxLevel = (0, exports.levelOf)(req.user?.role);
            if (userId) {
                const objectId = new mongodb_1.ObjectId(userId);
                const db = await (0, db_1.connectDB)();
                const workspaces = await db
                    .collection('workspaces')
                    .find({ $or: [{ ownerId: objectId }, { 'members.userId': objectId }] })
                    .toArray();
                for (const ws of workspaces) {
                    maxLevel = Math.max(maxLevel, workspaceRoleLevelFor(userId, ws));
                }
            }
            if (maxLevel < min)
                return forbidden(res);
            next();
        }
        catch (error) {
            console.error('Workspace-role authorization error:', error);
            res.status(500).json({ success: false, message: 'Authorization check failed.' });
        }
    };
}
