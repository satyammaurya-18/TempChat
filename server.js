const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./sql');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Per-room encryption mapping ---

// The complete codebook: 83 unique codes (one per character).
const CODES = [
    '{A7K2}', '{M4P9}', '{Q8D1}', '{R2X5}', '{L9H3}', '{T6N8}', '{B5W7}', '{C1J4}',
    '{F8V2}', '{Y3K6}', '{P7A9}', '{E4R1}', '{H2M5}', '{N8Q3}', '{G6T4}', '{U1Z7}',
    '{D5L8}', '{X9B2}', '{S3F6}', '{J7C1}', '{K4Y9}',
    '{V2P8}', '{R6A3}', '{M1X7}', '{Q5E9}', '{T8H2}', '{B4N6}', '{L7W1}', '{C9J5}',
    '{F3D8}', '{Y6K4}',
    '{P2V7}', '{E8R5}', '{H1M9}', '{N4Q6}', '{G7T2}', '{U3Z8}', '{D9L1}', '{X5B4}',
    '{S8F7}', '{J2C9}', '{K6Y3}', '{V1P5}', '{R9A8}', '{M3X2}', '{Q7E4}', '{T5H1}',
    '{B8N9}', '{L2W6}', '{C4J7}', '{F1D3}', '{Y8K5}', '{P6V4}', '{E2R7}', '{H9M1}',
    '{N5Q8}', '{G3T6}',
    '{U7Z2}', '{D4L9}', '{X1B6}', '{S5F8}', '{J9C3}', '{K2Y7}', '{V4P1}', '{R8A6}',
    '{M5X9}', '{Q3E2}', '{T1H7}', '{B6N4}', '{L8W5}', '{C2J1}', '{F7D9}', '{Y4K8}',
    '{P9V3}', '{E5R6}', '{H7M2}', '{N1Q4}', '{G8T9}', '{U6Z5}', '{D3L7}', '{X8B1}',
    '{S2F9}', '{J5C4}'
];

// One character per code: 21 specials, 10 digits, 26 lowercase, 26 uppercase.
const CHARACTERS = [
    '~', '`', '!', '@', '#', '+', '=', '[', ']', '\\', '{', '}', '|', "'", ':', '"', '.', '/', '<', '>', '?',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

if (CODES.length !== CHARACTERS.length) {
    throw new Error('Codebook mismatch: codes and characters must have equal length');
}

/** Fisher–Yates shuffle on a copy (original untouched). */
function fisherYatesShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1); // cryptographically strong
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Builds one random character->code mapping for a single room. */
function generateRoomMapping() {
    const shuffled = fisherYatesShuffle(CODES);
    const mapping = {};
    for (let i = 0; i < CHARACTERS.length; i++) {
        mapping[CHARACTERS[i]] = shuffled[i];
    }
    return mapping;
}

// --- Helper Functions ---

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function generateRoomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 15; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function cleanupExpiredRooms() {
    const threshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    db.cleanupRooms(threshold);
}

// --- Routes ---

app.post('/api/rooms', async (req, res) => {
    try {
        const code = generateRoomCode();
        const password = generateRoomPassword();
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Generate the room mapping ONCE at creation and persist it with the room.
        const mapping = generateRoomMapping();
        db.createRoom(code, passwordHash, mapping);
        
        res.json({
            room_code: code,
            room_password: password,
            message: 'Save this password! It will not be shown again.'
        });
    } catch (err) {
        console.error('Create room error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rooms/join', async (req, res) => {
    try {
        const code = req.body.code.toUpperCase();
        const password = req.body.password;
        
        if (!code || !password) {
            return res.status(400).json({ error: 'Room code and password required' });
        }
        
        const room = db.getRoom(code);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }
        
        if (!room.is_active) {
            return res.status(410).json({ error: 'Room has expired' });
        }
        
        const passwordValid = await bcrypt.compare(password, room.password_hash);
        
        if (!passwordValid) {
            return res.status(403).json({ error: 'Invalid password' });
        }
        
        db.updateRoomActivity(code);
        
        // The room mapping is ONLY returned after successful authentication.
        const mapping = db.getRoomMapping(code);

        res.json({ success: true, room_code: room.code, mapping });
    } catch (err) {
        console.error('Join room error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Socket.IO ---

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    socket.on('join-room', (data) => {
        const roomCode = data.roomCode;
        const username = data.username || 'Anonymous';
        
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.username = username;
        
        db.addUserToRoom(roomCode, username, socket.id);
        
        const users = db.getRoomUsers(roomCode);
        
        socket.to(roomCode).emit('user-joined', { username, users });
        io.to(roomCode).emit('user-count', users.length);
    });
    
    socket.on('send-message', (data) => {
        const roomCode = data.roomCode;
        const username = socket.data.username || 'Anonymous';
        const ciphertext = data.ciphertext;

        db.saveMessage(roomCode, username, ciphertext);
        db.updateRoomActivity(roomCode);

        io.to(roomCode).emit('new-message', {
            sender: username,
            ciphertext,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('leave-room', (data) => {
        handleDisconnect(socket, data.roomCode);
    });
    
    socket.on('disconnect', () => {
        const roomCode = socket.data.roomCode;
        if (roomCode) {
            handleDisconnect(socket, roomCode);
        }
    });
});

function handleDisconnect(socket, roomCode) {
    const username = socket.data.username;
    
    db.removeUserFromRoom(socket.id);
    socket.leave(roomCode);
    
    const users = db.getRoomUsers(roomCode);
    
    io.to(roomCode).emit('user-left', { username, users });
    io.to(roomCode).emit('user-count', users.length);
    
    if (users.length === 0) {
        setTimeout(() => {
            const remainingUsers = db.getRoomUsers(roomCode);
            if (remainingUsers.length === 0) {
                db.deactivateRoom(roomCode);
                io.to(roomCode).emit('room-destroyed', {
                    message: 'Room destroyed — all users left'
                });
            }
        }, 5000);
    }
}

// --- Start Server ---

async function startServer() {
    await db.initDB();
    
    // Periodic cleanup every 10 minutes
    setInterval(cleanupExpiredRooms, 10 * 60 * 1000);
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`TempChat running on http://localhost:${PORT}`);
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});