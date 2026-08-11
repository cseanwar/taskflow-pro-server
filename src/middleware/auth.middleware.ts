import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { connectDB } from '../config/db';
import { IProject, ISprint, ITask, IUser, IWorkspace } from '../types';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'suspended';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  workspace?: IWorkspace;
  project?: IProject;
  task?: ITask;
  sprint?: ISprint;
}

export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized access. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET || 'miPrhyQM7eb6vqpcyr6xbqbPxj7eEhPg';
    const decoded = jwt.verify(token, secret) as { id: string; email: string; role: string };

    const id = new ObjectId(decoded.id);

    // Always resolve the freshest user record so role changes and suspensions
    // take effect immediately without forcing a re-login.
    const db = await connectDB();
    const user = await db
      .collection<IUser>('users')
      .findOne({ _id: id }, { projection: { name: 1, email: 1, role: 1, status: 1 } });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Account no longer exists.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
    }

    req.user = {
      id: user._id?.toString() || decoded.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};