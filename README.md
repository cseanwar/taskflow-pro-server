# TaskFlow Pro — Backend API Server

<div align="center">

**High-Performance REST API for TaskFlow Pro built with Express 5, Native MongoDB Driver, and TypeScript.**

[![Express.js](https://img.shields.io/badge/Express.js-5.0-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Native_Driver-47A248?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![JWT](https://img.shields.io/badge/JWT-Authorization-black?style=for-the-badge&logo=json-web-tokens)](https://jwt.io/)

[Quick Start](#getting-started) • [Architecture](#architecture) • [API Routes](#api-routes) • [RBAC Middleware](#authorization--rbac-middleware) • [Deployment](#deployment)

</div>

---

## 📌 Overview

The **TaskFlow Pro Backend API** provides a REST service powering Kanban board manipulation, sprint scheduling, team collaboration, live notifications, workload analytics, and security policies. It is designed to run both as a long-lived Node.js server and as a Vercel serverless function (`api/index.ts`).

### Key Highlights
* **Zero-ORM Native MongoDB Driver**: Optimized connection pooling and raw aggregation pipelines for analytics without ORM overhead.
* **Live Status Verification**: Real-time account status checks on every request via `verifyToken` middleware.
* **Hierarchical RBAC**: Granular role-level authorization middleware (`requireWorkspaceAccess`, `requireProjectAccess`, `requireTaskAccess`, etc.).
* **Cascade Operations**: Clean project deletions cascading through boards, tasks, comments, and activity logs.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** `>= 18.0.0`
* **MongoDB Atlas** database connection string (or local MongoDB)

### 1. Installation
```bash
# Navigate to server directory
git clone https://github.com/cseanwar/taskflow-pro-server.git
cd taskflow-pro-server

# Install dependencies
npm install
```

### 2. Configure Environment Variables
Create `.env` in `taskflow-pro-server/`:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/
DB_NAME=taskflow_pro
CLIENT_URL=http://localhost:3000
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com # Optional
```

### 3. Run Development Server
```bash
npm run dev
# Server running on http://localhost:5000 (Health Check: GET /health)
```

---

## 🛠 Available Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| **Development** | `npm run dev` | Starts server with `tsx watch` for auto-reloading |
| **Build** | `npm run build` | Compiles TypeScript into CommonJS `dist/` |
| **Start** | `npm run start` | Runs compiled production server `node dist/index.js` |

---

## 🏛 Architecture & Code Structure

```
src/
├── app.ts                  # Express application configuration & route mounting
├── index.ts                # Standalone Node.js listener (Port 5000)
│
├── config/
│   └── db.ts               # MongoDB MongoClient connection singleton
│
├── middleware/
│   ├── auth.middleware.ts  # verifyToken JWT authentication & account status check
│   └── authz.middleware.ts # 5-tier RBAC authorization middleware factories
│
├── routes/                 # Express route controllers
│   ├── auth.routes.ts      # Authentication, user management, profile updates
│   ├── workspace.routes.ts # Workspaces, member invites, member roles
│   ├── project.routes.ts   # Project lifecycle, boards, duplication
│   ├── task.routes.ts      # Tasks, moves, checklists, comments, attachments
│   ├── sprint.routes.ts    # Sprint creation, activation, completion
│   ├── analytics.routes.ts # Velocity, workload capacity, KPIs (MongoDB aggregation)
│   ├── notification.routes.ts # Notification feeds and read receipts
│   └── search.routes.ts    # Multi-collection global search
│
├── lib/
│   ├── notify.ts           # Async notification dispatcher helper
│   └── activity.ts         # Audit log creation helper
│
└── types/
    └── index.ts            # Definitive domain entity interfaces & schemas
```

---

## 📡 API Routes

All endpoints are mounted under `/api` and respond with `{ success, message, ...data }`:

| Route Prefix | Resource Scope | Key Capabilities |
| :--- | :--- | :--- |
| `/api/auth` | Authentication & Users | Register, login, Google sign-in, profile updates, account suspension |
| `/api/workspaces` | Workspaces & Teams | Workspaces CRUD, member invitations, role updates, audit logs |
| `/api/projects` | Projects & Boards | Project CRUD, board initialization, project cloning |
| `/api/tasks` | Tasks & Collaboration | Task CRUD, column movement, checklists, comments, attachments |
| `/api/sprints` | Sprint Cycles | Sprint planning, activation, burndown, velocity |
| `/api/analytics` | Analytics & Reports | Workload capacity, sprint velocity, completion rate, cycle time |
| `/api/notifications` | User Notifications | Notification inbox, unread counts, mark-as-read, archive |
| `/api/search` | Search | Multi-entity global search across tasks, projects, and members |

---

## 🔒 Authorization & RBAC Middleware

Endpoints are protected by hierarchical middleware factories that resolve effective user permissions:

* `requireWorkspaceAccess({ min: LEVEL })`
* `requireProjectAccess({ min: LEVEL })`
* `requireTaskAccess({ min: LEVEL })`
* `requireSprintAccess({ min: LEVEL })`
* `requireGlobalRole(roleName)`

---

## 🚢 Deployment

### Deploying to Vercel
1. Set up a new project on **Vercel** pointing to `project-management-server/`.
2. Configure Environment Variables: `MONGODB_URI`, `DB_NAME`, `CLIENT_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`.
3. Vercel automatically routes requests through `api/index.ts` using the provided `vercel.json` rewrite rules.