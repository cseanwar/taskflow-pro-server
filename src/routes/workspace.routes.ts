import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { IWorkspace, IInvitation, IUser } from '../types';

const router = Router();

// Create Workspace
router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, logo } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Workspace name is required.' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');

    const newWorkspace: IWorkspace = {
      name,
      slug,
      description: description || '',
      logo: logo || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(name)}`,
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
router.get('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
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

// Invite Member to Workspace
router.post('/:id/invite', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Member email is required.' });
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

    res.status(200).json({ success: true, message: 'Invitation sent successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to invite member.' });
  }
});

// Remove Member from Workspace
router.delete('/:id/members/:userId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.params.userId as string;
    const db = await connectDB();
    const workspacesCollection = db.collection<IWorkspace>('workspaces');

    await workspacesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $pull: { members: { userId: new ObjectId(userId) } } as any,
        $set: { updatedAt: new Date() },
      }
    );

    res.status(200).json({ success: true, message: 'Member removed from workspace.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove member.' });
  }
});

export default router;
