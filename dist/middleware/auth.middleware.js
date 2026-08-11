"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized access. No token provided.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const secret = process.env.JWT_SECRET || 'miPrhyQM7eb6vqpcyr6xbqbPxj7eEhPg';
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        const id = new mongodb_1.ObjectId(decoded.id);
        // Always resolve the freshest user record so role changes and suspensions
        // take effect immediately without forcing a re-login.
        const db = await (0, db_1.connectDB)();
        const user = await db
            .collection('users')
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
    }
    catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
};
exports.verifyToken = verifyToken;
