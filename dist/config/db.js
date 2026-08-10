"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.getDB = getDB;
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'project_management_db';
if (!uri) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
}
let client;
let db;
async function connectDB() {
    if (db) {
        return db;
    }
    try {
        client = new mongodb_1.MongoClient(uri);
        await client.connect();
        db = client.db(dbName);
        console.log(`Connected to MongoDB database: ${dbName}`);
        return db;
    }
    catch (error) {
        console.error('Failed to connect to MongoDB', error);
        process.exit(1);
    }
}
function getDB() {
    if (!db) {
        throw new Error('Database not initialized. Call connectDB first.');
    }
    return db;
}
