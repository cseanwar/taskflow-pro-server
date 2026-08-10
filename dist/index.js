"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./config/db");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const workspace_routes_1 = __importDefault(require("./routes/workspace.routes"));
const project_routes_1 = __importDefault(require("./routes/project.routes"));
const task_routes_1 = __importDefault(require("./routes/task.routes"));
const sprint_routes_1 = __importDefault(require("./routes/sprint.routes"));
const analytics_routes_1 = __importDefault(require("./routes/analytics.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
app.use((0, cors_1.default)({
    origin: [process.env.CLIENT_URL || 'http://localhost:3000', 'http://localhost:3000'],
    credentials: true,
}));
// API Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'TaskFlow Pro Server API is running smoothly.' });
});
// API Routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/workspaces', workspace_routes_1.default);
app.use('/api/projects', project_routes_1.default);
app.use('/api/tasks', task_routes_1.default);
app.use('/api/sprints', sprint_routes_1.default);
app.use('/api/analytics', analytics_routes_1.default);
app.use('/api/notifications', notification_routes_1.default);
// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});
// Connect DB & Start Server
(0, db_1.connectDB)()
    .then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 TaskFlow Pro Express API Server running on port http://localhost:${PORT}`);
    });
})
    .catch(err => {
    console.error('Failed to start server due to DB connection error:', err);
});
