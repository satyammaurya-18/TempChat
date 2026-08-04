// script.js
// UI + Socket.IO only. All cipher logic lives in encryption.js.

// Socket.IO Connection
const socket = io();

// -- Join Room --
function joinRoom() {
    const code = document.getElementById('room-code').value.toUpperCase();
    const password = document.getElementById('room-password').value;
    const username = document.getElementById('username').value || 'Anonymous';

    if (!code || !password) {
        alert('Please enter room code and password');
        return;
    }

    fetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, password })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // The mapping is delivered ONLY after the server verified code + password
                sessionStorage.setItem('roomCode', code);
                sessionStorage.setItem('roomPassword', password);
                sessionStorage.setItem('roomMapping', JSON.stringify(data.mapping));
                sessionStorage.setItem('username', username);
                window.location.href = '/chat.html';
            } else {
                alert(data.error || 'Failed to join room');
            }
        })
        .catch(err => alert('Connection error'));
}

// -- Create Room --
// The creator joins through the Join Room form with the generated credentials,
// so they receive the mapping exactly like every other participant.
function createRoom() {
    fetch('/api/rooms', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            document.getElementById('room-credentials').style.display = 'block';
            document.getElementById('new-code').textContent = data.room_code;
            document.getElementById('new-password').textContent = data.room_password;
        });
}

function copyCredentials() {
    const code = document.getElementById('new-code').textContent;
    const password = document.getElementById('new-password').textContent;
    navigator.clipboard.writeText(`Room: ${code}\nPassword: ${password}`);
    alert('Copied!');
}

// -- Chat Page Logic --
if (window.location.pathname === '/chat.html') {
    const roomCode = sessionStorage.getItem('roomCode');
    const roomPassword = sessionStorage.getItem('roomPassword');
    const roomMappingRaw = sessionStorage.getItem('roomMapping');
    const username = sessionStorage.getItem('username');

    if (!roomCode || !roomPassword || !roomMappingRaw) {
        window.location.href = '/';
    }

    // Initialize this room's cipher BEFORE any message is sent or received
    try {
        setRoomMapping(JSON.parse(roomMappingRaw));
    } catch (e) {
        alert('Room mapping is missing or invalid — please join again.');
        window.location.href = '/';
    }

    document.getElementById('room-display').textContent = `${roomCode}`;
    document.getElementById('password-display').textContent = `${roomPassword}`;
    document.getElementById('user-display').textContent = `${username}`;

    // Join socket room
    socket.emit('join-room', { roomCode, username });

    // Send message
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    function sendMessage() {
        const input = document.getElementById('message-input');
        const plaintext = input.value.trim();
        if (!plaintext) return;

        const ciphertext = encryptMessage(plaintext);   // sync, room-specific
        socket.emit('send-message', { roomCode, ciphertext });

        input.value = '';
    }

    // Receive message
    socket.on('new-message', (data) => {
        const plaintext = decryptMessage(data.ciphertext); // sync, room-specific
        displayMessage(
            data.sender,
            plaintext,
            data.sender === username
        );
    });

    function displayMessage(sender, text, isOwn) {
        const container = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own' : 'other'}`;
        div.innerHTML = `
            <strong>${escapeHtml(sender)}</strong>
            <p>${escapeHtml(text)}</p>
            <small>${new Date().toLocaleTimeString()}</small>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // User joined/left notifications
    socket.on('user-joined', (data) => {
        addSystemMessage(`${data.username} joined the room`);
        updateUserList(data.users);
    });

    socket.on('user-left', (data) => {
        addSystemMessage(`${data.username} left the room`);
        updateUserList(data.users);
    });

    socket.on('room-destroyed', (data) => {
        addSystemMessage(data.message);
        document.getElementById('message-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
    });

    function addSystemMessage(text) {
        const container = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = 'system-message';
        div.textContent = text;
        container.appendChild(div);
    }

    function updateUserList(users) {
        const list = document.getElementById('user-list');
        list.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username;
            list.appendChild(li);
        });
    }

    // Handle page close
    window.addEventListener('beforeunload', () => {
        socket.emit('leave-room', { roomCode });
    });
}