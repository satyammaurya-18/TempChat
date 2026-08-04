const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'ciphervault.db');
let db = null;

async function initDB() {
    const SQL = await initSqlJs();
    
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }
    
    db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            mapping TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            ciphertext TEXT NOT NULL,
            iv TEXT NOT NULL,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS room_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT NOT NULL,
            username TEXT NOT NULL,
            socket_id TEXT,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
        )
    `);
    
    const columns = getAllRows('PRAGMA table_info(rooms)');
    if (!columns.some((c) => c.name === 'mapping')) {
        db.run("ALTER TABLE rooms ADD COLUMN mapping TEXT NOT NULL DEFAULT '{}'");
        console.log('Added mapping column to rooms table');
    }

    saveDB();
    console.log('Database initialized');
}

function saveDB() {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getFirstRow(sql, params = []) {
    if (!db) return null;
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
    }
    stmt.free();
    return null;
}

function getAllRows(sql, params = []) {
    if (!db) return [];
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function runQuery(sql, params = []) {
    if (!db) return;
    db.run(sql, params);
    saveDB();
}

function createRoom(code, hash, mapping) {
    runQuery(
        'INSERT INTO rooms (code, password_hash, mapping) VALUES (?, ?, ?)',
        [code, hash, JSON.stringify(mapping)]
    );
}

function getRoom(code) {
    return getFirstRow('SELECT * FROM rooms WHERE code = ?', [code]);
}

/** Returns the room's encryption mapping as a parsed object, or null. */
function getRoomMapping(code) {
    const row = getFirstRow('SELECT mapping FROM rooms WHERE code = ?', [code]);
    if (!row) return null;
    try {
        return JSON.parse(row.mapping || '{}');
    } catch (e) {
        return {};
    }
}

function roomExists(code) {
    const result = getFirstRow('SELECT COUNT(*) as count FROM rooms WHERE code = ?', [code]);
    return result && result.count > 0;
}

function updateRoomActivity(code) {
    runQuery("UPDATE rooms SET last_active = datetime('now') WHERE code = ?", [code]);
}

function deactivateRoom(code) {
    runQuery('UPDATE rooms SET is_active = 0 WHERE code = ?', [code]);
}

function addUserToRoom(code, username, socketId) {
    runQuery('INSERT INTO room_users (room_code, username, socket_id) VALUES (?, ?, ?)', [code, username, socketId]);
}

function removeUserFromRoom(socketId) {
    runQuery('DELETE FROM room_users WHERE socket_id = ?', [socketId]);
}

function getRoomUsers(code) {
    return getAllRows('SELECT DISTINCT username, socket_id FROM room_users WHERE room_code = ?', [code]);
}

function saveMessage(code, sender, ciphertext) {
    runQuery(
        'INSERT INTO messages (room_code, sender_name, ciphertext, iv) VALUES (?, ?, ?, ?)',
        [code, sender, ciphertext, '']
    );
}

function cleanupRooms(threshold) {
    runQuery('UPDATE rooms SET is_active = 0 WHERE last_active < ? AND is_active = 1', [threshold]);
}

module.exports = {
    initDB,
    createRoom,
    getRoom,
    getRoomMapping,
    roomExists,
    updateRoomActivity,
    deactivateRoom,
    addUserToRoom,
    removeUserFromRoom,
    getRoomUsers,
    saveMessage,
    cleanupRooms
};