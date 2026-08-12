# TaskFlow Pro — Server

REST API for TaskFlow Pro, built with **Express 5**, the **native MongoDB driver**, and **TypeScript** (CommonJS). Runs locally on port 5000 and on Vercel as a serverless function.

<details>
<summary>Project-wide docs</summary>

This API powers the Next.js client in a separate repository. Read the [root README](../README.md) for the full architecture, roles/access model, and deployment guide.
</details>

## Getting Started

```bash
npm install
npm run dev        # tsx watch src/index.ts → http://localhost:5000
```

Create `.env`:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/
DB_NAME=taskflow_pro
CLIENT_URL=http://localhost:3000        # CORS whitelist
JWT_SECRET=change-me-to-a-long-random-string
GOOGLE_CLIENT_ID=                       # optional — Google sign-in
```

Verify the API is up: `GET /health`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` (port 5000) |
| `npm run build` | `tsc` → `dist/` |
| `npm run start` | `node dist/index.js` |

> `npm test` is a stub that exits 1 — no tests exist in this repo.

## Architecture

- **Database**: raw `mongodb` driver (no ORM). Access the DB through the `connectDB()` / `getDB()` singleton in `src/config/db.ts`.
- **Entry points**: `src/index.ts` starts a long-lived listener for local dev / VPS / Render / Railway. On **Vercel**, the app is served through the serverless handler in `api/index.ts` (zero-config `api/` detection + `vercel.json` rewrites).
- **Response envelope**: every endpoint responds with `{ success, message, ...data }`.

### Routes (mounted under `/api` in `src/app.ts`)

| Mount | Purpose |
| --- | --- |
| `/api/auth` | Register, login, Google OAuth, current user, user status (admin) |
| `/api/workspaces` | Workspaces, members, invitations |
| `/api/projects` | Projects, boards, project members, duplicate/delete |
| `/api/tasks` | Tasks, move/reorder, comments, activity |
| `/api/sprints` | Sprints — create, start, complete |
| `/api/analytics` | Dashboard stats & reports |
| `/api/notifications` | User notifications |
| `/api/search` | Global search |

Collections: `users`, `workspaces`, `projects`, `boards`, `tasks`, `sprints`, `comments`, `notifications`, `labels`, `activity_logs`, `invitations`.

### Auth & Authorization

- **Protected routes require `verifyToken`** (`src/middleware/auth.middleware.ts`), which reads `Authorization: Bearer <JWT>` and re-reads the user’s DB record on every request — a role/status change takes effect without re-login. Suspended accounts get `403`.
- **Role gates** live in `src/middleware/authz.middleware.ts` (`requireWorkspaceAccess`, `requireProjectAccess`, `requireTaskAccess`, `requireSprintAccess`, `requireGlobalRole`, …) and attach `req.workspace` / `req.project` / `req.task` / `req.sprint` for downstream use. See the [root README](../README.md#roles--access-control) for the capability floors.
- The first user in an empty DB becomes **Administrator**; everyone else registers as **Team Member**. Workspace invites only accept `Project Manager`, `Team Member`, and `Guest User`.

## Sample / Test Data

`scripts/sample-projects.json` and `scripts/sample-boards.json` contain ten ready-made projects and boards (Extended JSON) you can import into MongoDB Compass to test the app. Replace the `REPLACE_WITH_YOUR_*` ObjectIds with your workspace and user IDs.

## Verification

- Build: `npm run build` (`tsc` to `dist/`). No linter configured.