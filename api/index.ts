import type { IncomingMessage, ServerResponse } from 'http';
import app from '../src/app';
import { connectDB } from '../src/config/db';

/**
 * Vercel serverless entry point. Vercel routes every request here (see
 * vercel.json), so we ensure the DB is connected before handing the request
 * to the Express app. The singleton in connectDB() makes this cheap once the
 * function instance is warm.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await connectDB();
  } catch (err) {
    console.error('Database connection failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: 'Database connection failed.' }));
    return;
  }

  return app(req as any, res as any);
}