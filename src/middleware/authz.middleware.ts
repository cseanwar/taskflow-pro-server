import { Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { AuthRequest } from './auth.middleware';
import { IProject, ISprint, ITask, IWorkspace, UserRole } from '../types';

/**
 * Role hierarchy (higher = more privileges).
 * Effective level for a user within a workspace is max(global role, workspace role).
 */
export const ROLE_LEVEL: Record<UserRole, number> = {
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
export const INVITABLE_ROLES: UserRole[] = ['Project Manager', 'Team Member', 'Guest User'];

// Minimum levels per capability, mirroring the shared role model.
export const LEVEL = {
  read: 1, // Guest + — any member can read
  contribute: 2, // Team Member + — update status, comment
  manage: 3, // Project Manager + — create/edit projects, tasks, sprints, reports
  admin: 4, // Workspace Owner + — workspace/member management
  platform: 5, // Administrator — user/suspension management
} as const;

export const levelOf = (role?: string): number => (role ? (ROLE_LEVEL[role as UserRole] ?? 0) : 0);

const forbidden = (res: Response, message = 'Forbidden: you do not have permission to perform this action.') =>
  res.status(403).json({ success: false, message });

const notFound = (res: Response, message = 'Resource not found.') =>
  res.status(404).json({ success: false, message });

const toOid = (value?: string | null): ObjectId | null => {
  if (!value) return null;
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
};

// -------------------------------
// Global (JWT role) gates
// -------------------------------

/** Require the caller's global role level to be >= min. No DB lookup. */
export const requireGlobalMinLevel = (min: number) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (levelOf(req.user?.role) < min) return forbidden(res);
    next();
  };

/** Require the caller's global role to be one of the given roles. */
export const requireGlobalRole = (...roles: UserRole[]) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!roles.includes((req.user?.role ?? '') as UserRole)) return forbidden(res);
    next();
  };

// -------------------------------
// Role resolution helpers
// -------------------------------

/** Workspace role level for a user (ownerId implies 'Workspace Owner'). */
export function workspaceRoleLevelFor(userId: string | undefined, workspace: IWorkspace): number {
  if (!userId) return 0;
  if (workspace.ownerId?.toString() === userId) return ROLE_LEVEL['Workspace Owner'];
  const member = workspace.members?.find(m => m.userId?.toString() === userId);
  return member ? levelOf(member.role) : 0;
}

/** Workspace role string (used for messaging). Falls back to the owner title for ownerId. */
export function workspaceRoleNameFor(userId: string | undefined, workspace: IWorkspace): UserRole | null {
  if (!userId) return null;
  if (workspace.ownerId?.toString() === userId) return 'Workspace Owner';
  return workspace.members?.find(m => m.userId?.toString() === userId)?.role || null;
}

/** max(global role, workspace role) — a workspace role never overrides 'Administrator'. */
export function effectiveWorkspaceLevel(
  globalRole: string | undefined,
  userId: string | undefined,
  workspace: IWorkspace
): number {
  return Math.max(levelOf(globalRole), workspaceRoleLevelFor(userId, workspace));
}

// -------------------------------
// Resource-loading gates
// -------------------------------

type Locator = { source: 'params' | 'body'; key: string };

const readLocator = (req: AuthRequest, { source, key }: Locator): string | undefined => {
  if (source === 'body') return req.body?.[key] as string | undefined;
  const param = req.params?.[key];
  return Array.isArray(param) ? param[0] : (param as string | undefined);
};

/**
 * Require the caller to be a member of a workspace with an effective level >= min.
 * On success attaches `req.workspace`.
 */
export function requireWorkspaceAccess(opts: { locator?: Locator; min?: number } = {}) {
  const { locator = { source: 'params', key: 'id' }, min = LEVEL.read } = opts;
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const oid = toOid(readLocator(req, locator));
      if (!oid) return res.status(400).json({ success: false, message: 'Invalid workspace reference.' });

      const db = await connectDB();
      const ws = await db.collection<IWorkspace>('workspaces').findOne({ _id: oid });
      if (!ws) return notFound(res, 'Workspace not found.');

      if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
        return forbidden(res);
      }

      req.workspace = ws;
      next();
    } catch (error) {
      console.error('Workspace authorization error:', error);
      res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
}

/**
 * Require the caller to have an effective level >= min in the workspace of a project.
 * On success attaches `req.project` and `req.workspace`.
 */
export function requireProjectAccess(opts: { locator?: Locator; min?: number } = {}) {
  const { locator = { source: 'params', key: 'id' }, min = LEVEL.read } = opts;
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const oid = toOid(readLocator(req, locator));
      if (!oid) return res.status(400).json({ success: false, message: 'Invalid project reference.' });

      const db = await connectDB();
      const project = await db.collection<IProject>('projects').findOne({ _id: oid });
      if (!project) return notFound(res, 'Project not found.');

      const wsOid = toOid(project.workspaceId?.toString());
      if (!wsOid) return notFound(res, 'Project workspace not found.');
      const ws = await db.collection<IWorkspace>('workspaces').findOne({ _id: wsOid });
      if (!ws) return notFound(res, 'Workspace not found.');

      if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
        return forbidden(res);
      }

      req.project = project;
      req.workspace = ws;
      next();
    } catch (error) {
      console.error('Project authorization error:', error);
      res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
}

/**
 * Require the caller to have an effective level >= min in the workspace of a task
 * (resolved via task -> project -> workspace). Attaches `req.task`, `req.project`, `req.workspace`.
 */
export function requireTaskAccess(min: number) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const oid = toOid(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      if (!oid) return res.status(400).json({ success: false, message: 'Invalid task reference.' });

      const db = await connectDB();
      const task = await db.collection<ITask>('tasks').findOne({ _id: oid });
      if (!task) return notFound(res, 'Task not found.');

      const projectOid = toOid(task.projectId?.toString());
      if (!projectOid) return notFound(res, 'Task project not found.');
      const project = await db.collection<IProject>('projects').findOne({ _id: projectOid });
      if (!project) return notFound(res, 'Project not found.');

      const wsOid = toOid(project.workspaceId?.toString());
      if (!wsOid) return notFound(res, 'Task workspace not found.');
      const ws = await db.collection<IWorkspace>('workspaces').findOne({ _id: wsOid });
      if (!ws) return notFound(res, 'Workspace not found.');

      if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
        return forbidden(res);
      }

      req.task = task;
      req.project = project;
      req.workspace = ws;
      next();
    } catch (error) {
      console.error('Task authorization error:', error);
      res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
}

/**
 * Require the caller to have an effective level >= min in the workspace of a sprint.
 * Attaches `req.sprint`.
 */
export function requireSprintAccess(min: number) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const oid = toOid(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      if (!oid) return res.status(400).json({ success: false, message: 'Invalid sprint reference.' });

      const db = await connectDB();
      const sprint = await db.collection<ISprint>('sprints').findOne({ _id: oid });
      if (!sprint) return notFound(res, 'Sprint not found.');

      const projectOid = toOid(sprint.projectId?.toString());
      if (!projectOid) return notFound(res, 'Sprint project not found.');
      const project = await db.collection<IProject>('projects').findOne({ _id: projectOid });
      if (!project) return notFound(res, 'Project not found.');

      const wsOid = toOid(project.workspaceId?.toString());
      if (!wsOid) return notFound(res, 'Sprint workspace not found.');
      const ws = await db.collection<IWorkspace>('workspaces').findOne({ _id: wsOid });
      if (!ws) return notFound(res, 'Workspace not found.');

      if (effectiveWorkspaceLevel(req.user?.role, req.user?.id, ws) < min) {
        return forbidden(res);
      }

      req.sprint = sprint;
      req.project = project;
      req.workspace = ws;
      next();
    } catch (error) {
      console.error('Sprint authorization error:', error);
      res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
}

/**
 * Require an effective level >= min in ANY of the user's workspaces (or via global role).
 * Used for platform-wide surfaces such as Analytics & Reports.
 */
export function requireGlobalOrAnyWorkspaceMinLevel(min: number) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      let maxLevel = levelOf(req.user?.role);
      if (userId) {
        const objectId = new ObjectId(userId);
        const db = await connectDB();
        const workspaces = await db
          .collection<IWorkspace>('workspaces')
          .find({ $or: [{ ownerId: objectId }, { 'members.userId': objectId }] })
          .toArray();
        for (const ws of workspaces) {
          maxLevel = Math.max(maxLevel, workspaceRoleLevelFor(userId, ws));
        }
      }
      if (maxLevel < min) return forbidden(res);
      next();
    } catch (error) {
      console.error('Workspace-role authorization error:', error);
      res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
}