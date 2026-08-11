import app from './app';
import { connectDB } from './config/db';

const PORT = process.env.PORT || 5000;

// Start the server only on a long-lived host (local dev / VPS / Render / Railway).
// On Vercel the app is served through the api/index.ts serverless function instead.
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 TaskFlow Pro Express API Server running on port http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to start server due to DB connection error:', err);
  });