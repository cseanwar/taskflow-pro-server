import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { verifyToken, AuthRequest } from '../middleware/auth.middleware';
import { IUser } from '../types';

const router = Router();

// Register / Sign up
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const db = await connectDB();
    const usersCollection = db.collection<IUser>('users');

    const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: IUser = {
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      role: role || 'Team Member',
      isVerified: true,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser as any);
    const userId = result.insertedId.toString();

    const secret = process.env.JWT_SECRET || 'miPrhyQM7eb6vqpcyr6xbqbPxj7eEhPg';
    const token = jwt.sign({ id: userId, email: newUser.email, role: newUser.role }, secret, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Account registered successfully',
      token,
      user: {
        id: userId,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        avatar: newUser.avatar,
        status: newUser.status,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Failed to register user.' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const db = await connectDB();
    const usersCollection = db.collection<IUser>('users');

    const user = await usersCollection.findOne({ email: email.toLowerCase() });
    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const userId = user._id?.toString();
    const secret = process.env.JWT_SECRET || 'miPrhyQM7eb6vqpcyr6xbqbPxj7eEhPg';
    const token = jwt.sign({ id: userId, email: user.email, role: user.role }, secret, { expiresIn: '7d' });

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: {
        id: userId,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Failed to login.' });
  }
});

// Get Current User Profile
router.get('/me', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = await connectDB();
    const usersCollection = db.collection<IUser>('users');

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user?.id) });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id?.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch user profile.' });
  }
});

// Get All Users (for workspace/project member selector & admin management)
router.get('/users', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = await connectDB();
    const usersCollection = db.collection<IUser>('users');

    const users = await usersCollection.find({}, { projection: { password: 0 } }).toArray();

    const formattedUsers = users.map(u => ({
      id: u._id?.toString(),
      name: u.name,
      email: u.email,
      role: u.role,
      avatar: u.avatar,
      status: u.status,
    }));

    res.status(200).json({ success: true, users: formattedUsers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// Admin Update User Status (active / suspended)
router.patch('/users/:id/status', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    const db = await connectDB();
    const usersCollection = db.collection<IUser>('users');

    const idStr = req.params.id as string;
    await usersCollection.updateOne(
      { _id: new ObjectId(idStr) },
      { $set: { status, updatedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: `User status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update user status.' });
  }
});

export default router;
