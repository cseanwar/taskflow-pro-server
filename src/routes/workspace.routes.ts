import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { INVITABLE_ROLES, requireWorkspaceAccess } from '../middleware/authz.middleware';
import { IWorkspace, IInvitation, IUser, IActivityLog, UserRole } from '../types';

const router = Router();

async function logWorkspaceActivity(
  workspaceId: string | ObjectId,
  actorId: string | undefined,
  action: string
): Promise<void> {
  if (!actorId) return;
  const db = await connectDB();
  await db.collection<IActivityLog>('activity_logs').insertOne({
    workspaceId: new ObjectId(workspaceId.toString()),
    actorId: new ObjectId(actorId),
    action,
    createdAt: new Date(),
  } as any);
}

// Create Workspace
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, logo, slug, industry, features } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Workspace name is required.' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const derivedSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const requestedSlug = slug ? slug.toLowerCase().replace(/[^a-z0-9-]+/g, '').replace(/(^-|-$)+/g, '') : '';
    const slugValue = requestedSlug || derivedSlug;

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');

    // A user-managed URL must be unique; fall back to a name-derived slug on collision.
    let uniqueSlug = slugValue;
    if (requestedSlug) {
      const existing = await workspacesCollection.findOne({ slug: uniqueSlug });
      if (existing) uniqueSlug = derivedSlug;
    }

    const newWorkspace: IWorkspace = {
      name,
      slug: uniqueSlug,
      description: description || '',
      logo: logo || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`,
      industry: industry || '',
      features: features && typeof features === 'object' ? features : undefined,
      ownerId: new ObjectId(userId),
      members: [
        {
          userId: new ObjectId(userId),
          role: 'Workspace Owner',
          joinedAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await workspacesCollection.insertOne(newWorkspace as any);
    const createdWorkspace = { ...newWorkspace, _id: result.insertedId.toString() };

    res.status(201).json({ success: true, workspace: createdWorkspace });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ success: false, message: 'Failed to create workspace.' });
  }
});

// Update Workspace (features, description, industry — Workspace Owner / Administrator)
router.patch('/:id', verifyToken, requireWorkspaceAccess({ min: 4 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, description, industry, features } = req.body;

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');

    const updateFields: any = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (description !== undefined) updateFields.description = description;
    if (industry !== undefined) updateFields.industry = industry;
    if (features !== undefined && typeof features === 'object') updateFields.features = features;

    const result = await workspacesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Workspace not found.' });
    }

    await logWorkspaceActivity(id, req.user?.id, 'Updated workspace settings');

    res.status(200).json({ success: true, message: 'Workspace updated.' });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({ success: false, message: 'Failed to update workspace.' });
  }
});

// Get User's Workspaces
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');

    const workspaces = await workspacesCollection
      .find({
        $or: [
          { ownerId: new ObjectId(userId) },
          { 'members.userId': new ObjectId(userId) },
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
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch workspaces.' });
  }
});

// Get Workspace Details with Member Details
router.get('/:id', verifyToken, requireWorkspaceAccess({ min: 1 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');
    const usersCollection = db.collection<IUser>('users');

    const workspace = await workspacesCollection.findOne({ _id: new ObjectId(id) });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found.' });
    }

    const memberUserIds = workspace.members.map(m => new ObjectId(m.userId.toString()));
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
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch workspace details.' });
  }
});

// Invite Member to Workspace (Workspace Owner / Administrator only)
router.post('/:id/invite', verifyToken, requireWorkspaceAccess({ min: 4 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Member email is required.' });
    }

    // Only workspace-grantable roles may be assigned. 'Administrator' is
    // platform-level and is never assignable via invitation.
    if (role && !INVITABLE_ROLES.includes(role as UserRole)) {
      return res.status(400).json({
        success: false,
        message: 'Role is not assignable. Choose Project Manager, Team Member, or Guest User.',
      });
    }

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');
    const usersCollection = db.collection<IUser>('users');

    const workspace = await workspacesCollection.findOne({ _id: new ObjectId(id) });
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
      await workspacesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $push: {
            members: {
              userId: existingUser._id as ObjectId,
              role: role || 'Team Member',
              joinedAt: new Date(),
            },
          },
          $set: { updatedAt: new Date() },
        }
      );

      await logWorkspaceActivity(id, req.user?.id, `Added ${email}`);

      return res.status(200).json({ success: true, message: 'User added to workspace.' });
    }

    // Save invitation record
    const invitationsCollection = db.collection<IInvitation>('invitations');
    const newInvite: IInvitation = {
      workspaceId: new ObjectId(id),
      email: email.toLowerCase(),
      role: role || 'Team Member',
      token: new ObjectId().toString(),
      invitedBy: new ObjectId(req.user?.id),
      status: 'pending',
      createdAt: new Date(),
    };

    await invitationsCollection.insertOne(newInvite as any);

    await logWorkspaceActivity(id, req.user?.id, `Invited ${email} (${role || 'Team Member'})`);

    res.status(200).json({ success: true, message: 'Invitation sent successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to invite member.' });
  }
});

// Remove Member from Workspace (Workspace Owner / Administrator only)
router.delete(
  '/:id/members/:userId',
  verifyToken,
  requireWorkspaceAccess({ min: 4 }),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const userId = req.params.userId as string;
      const db = await connectDB();
      const workspacesCollection = db.collection<IWorkspace>('workspaces');

      if (req.workspace?.ownerId?.toString() === userId) {
        return res.status(400).json({ success: false, message: 'The workspace owner cannot be removed.' });
      }
      if (userId === req.user?.id) {
        return res.status(400).json({ success: false, message: 'You cannot remove yourself from the workspace.' });
      }

      await workspacesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $pull: { members: { userId: new ObjectId(userId) } } as any,
          $set: { updatedAt: new Date() },
        }
      );

      await logWorkspaceActivity(id, req.user?.id, `Removed a member`);

      res.status(200).json({ success: true, message: 'Member removed from workspace.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to remove member.' });
    }
  }
);

// Change Member Role (Workspace Owner / Administrator only)
router.patch(
  '/:id/members/:userId/role',
  verifyToken,
  requireWorkspaceAccess({ min: 4 }),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const userId = req.params.userId as string;
      const { role } = req.body;

      if (!role || !INVITABLE_ROLES.includes(role as UserRole)) {
        return res.status(400).json({
          success: false,
          message: 'Role is not assignable. Choose Project Manager, Team Member, or Guest User.',
        });
      }

      const db = await connectDB();
      const workspacesCollection = db.collection<IWorkspace>('workspaces');

      // Guardrails: cannot alter the owner, and an owner/admin cannot demote themselves.
      const workspace = await workspacesCollection.findOne({ _id: new ObjectId(id) });
      if (!workspace) {
        return res.status(404).json({ success: false, message: 'Workspace not found.' });
      }
      if (workspace.ownerId?.toString() === userId) {
        return res.status(400).json({ success: false, message: 'The workspace owner role cannot be changed.' });
      }
      const isMember = workspace.members.some(m => m.userId.toString() === userId);
      if (!isMember) {
        return res.status(404).json({ success: false, message: 'User is not a member of this workspace.' });
      }

      await workspacesCollection.updateOne(
        { _id: new ObjectId(id), 'members.userId': new ObjectId(userId) },
        { $set: { 'members.$.role': role, updatedAt: new Date() } }
      );

      await logWorkspaceActivity(id, req.user?.id, `Changed member role to ${role}`);

      res.status(200).json({ success: true, message: 'Member role updated.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update member role.' });
    }
  }
);

// Workspace Activity / Access Log (any member can view)
router.get('/:id/activity', verifyToken, requireWorkspaceAccess({ min: 1 }), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const db = await connectDB();
    const logsCollection = db.collection<IActivityLog>('activity_logs');
    const usersCollection = db.collection<IUser>('users');

    const logs = await logsCollection
      .find({ workspaceId: new ObjectId(id) })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const actorIds = logs.map(l => new ObjectId(l.actorId.toString()));
    const actors = await usersCollection
      .find({ _id: { $in: actorIds } }, { projection: { password: 0 } })
      .toArray();
    const actorMap = new Map(actors.map(a => [a._id?.toString(), { name: a.name, avatar: a.avatar }]));

    const formattedLogs = logs.map(l => ({
      ...l,
      _id: l._id?.toString(),
      actorId: l.actorId.toString(),
      actor: actorMap.get(l.actorId.toString()) || { name: 'Unknown User', avatar: '' },
    }));

    res.status(200).json({ success: true, activity: formattedLogs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch workspace activity.' });
  }
});

export default router;
