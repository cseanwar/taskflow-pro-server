"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mongodb_1 = require("mongodb");
const db_1 = require("../config/db");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Register / Sign up
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
        }
        const db = await (0, db_1.connectDB)();
        const usersCollection = db.collection('users');
        const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User with this email already exists.' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const newUser = {
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
        const result = await usersCollection.insertOne(newUser);
        const userId = result.insertedId.toString();
        const secret = process.env.JWT_SECRET || 'miPrhyQM7eb6vqpcyr6xbqbPxj7eEhPg';
        const token = jsonwebtoken_1.default.sign({ id: userId, email: newUser.email, role: newUser.role }, secret, { expiresIn: '7d' });
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
    }
    catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Failed to register user.' });
    }
});
// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }
        const db = await (0, db_1.connectDB)();
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ email: email.toLowerCase() });
        if (!user || !user.password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
        if (user.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
        }
        const isMatch = await bcryptjs_1.default.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
        const userId = user._id?.toString();
        const secret = process.env.JWT_SECRET || 'miPrhyQM7eb6vqpcyr6xbqbPxj7eEhPg';
        const token = jsonwebtoken_1.default.sign({ id: userId, email: user.email, role: user.role }, secret, { expiresIn: '7d' });
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
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Failed to login.' });
    }
});
// Get Current User Profile
router.get('/me', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const db = await (0, db_1.connectDB)();
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ _id: new mongodb_1.ObjectId(req.user?.id) });
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch user profile.' });
    }
});
// Get All Users (for workspace/project member selector & admin management)
router.get('/users', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const db = await (0, db_1.connectDB)();
        const usersCollection = db.collection('users');
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
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch users.' });
    }
});
// Admin Update User Status (active / suspended)
router.patch('/users/:id/status', auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'suspended'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status value.' });
        }
        const db = await (0, db_1.connectDB)();
        const usersCollection = db.collection('users');
        const idStr = req.params.id;
        await usersCollection.updateOne({ _id: new mongodb_1.ObjectId(idStr) }, { $set: { status, updatedAt: new Date() } });
        res.status(200).json({ success: true, message: `User status updated to ${status}` });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update user status.' });
    }
});
exports.default = router;
