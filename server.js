const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path'); // Add path module

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const messages = new Map();
const users = new Map();
const roomCreators = new Map();

const memeTerms = ['Doge', 'Rickroll', 'Pepe', 'Trollface', 'YOLO', 'GrumpyCat', 'Nyan', 'SpongeBob', 'Shiba', 'Lad', 'MoonMoon', 'Bloop'];

function generateRoomName() {
  const term = memeTerms[Math.floor(Math.random() * memeTerms.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${term}${num}`;
}

// Serve static files from the "client" directory
app.use(express.static(path.join(__dirname, 'client')));

app.use(express.json());

// Serve index.html as the default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.post('/create-room', (req, res) => {
  const roomId = generateRoomName();
  rooms.set(roomId, new Set());
  messages.set(roomId, []);
  res.json({ roomId });
});

app.get('/rooms', (req, res) => {
  res.json(Array.from(rooms.keys()));
});

io.on('connection', (socket) => {
  let roomId;
  let userId;

  socket.on('join-room', (rId, uId) => {
    roomId = rId;
    userId = uId;
    if (!rooms.has(roomId)) {
      socket.emit('room-not-found');
      return;
    }
    const currentRoom = users.get(userId);
    if (currentRoom && currentRoom !== roomId) {
      socket.emit('already-in-room', currentRoom);
      return;
    }

    const room = rooms.get(roomId);
    if (room.size >= 13) {
      socket.emit('room-full');
      return;
    }

    if (currentRoom) {
      rooms.get(currentRoom).delete(userId);
      io.to(currentRoom).emit('user-disconnected', userId);
      io.to(currentRoom).emit('participants-update', Array.from(rooms.get(currentRoom)));
    }

    room.add(userId);
    users.set(userId, roomId);
    socket.join(roomId);

    if (!roomCreators.has(roomId) && room.size === 1) {
      roomCreators.set(roomId, userId);
      socket.emit('set-room-creator', true);
    } else {
      socket.emit('set-room-creator', userId === roomCreators.get(roomId));
    }

    io.to(roomId).emit('user-connected', userId);
    io.to(roomId).emit('participants-update', Array.from(room));
    socket.emit('message-update', messages.get(roomId) || []);
  });

  socket.on('fetch-messages', (rId) => {
    socket.emit('message-update', messages.get(rId) || []);
  });

  socket.on('fetch-participants', (rId) => {
    socket.emit('participants-update', Array.from(rooms.get(rId) || []));
  });

  socket.on('disconnect', () => {
    if (userId && roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.delete(userId);
        users.delete(userId);
        io.to(roomId).emit('user-disconnected', userId);
        io.to(roomId).emit('participants-update', Array.from(room));
        if (roomCreators.get(roomId) === userId && room.size > 0) {
          const newCreator = Array.from(room)[0];
          roomCreators.set(roomId, newCreator);
          io.to(roomId).emit('set-room-creator', false);
          io.to(newCreator).emit('set-room-creator', true);
        }
      }
    }
  });

  socket.on('chat-message', (roomId, userId, message, parentId = null) => {
    console.log(`Received chat-message: roomId=${roomId}, userId=${userId}, message=${message}, parentId=${parentId}`);
    try {
      const timestamp = new Date().toLocaleTimeString();
      const msg = {
        id: crypto.randomBytes(8).toString('hex'),
        userId,
        message,
        timestamp,
        score: 0,
        votes: new Set(),
        parentId,
        replies: []
      };
      const roomMessages = messages.get(roomId) || [];
      if (parentId) {
        const parent = findMessage(roomMessages, parentId);
        if (parent) {
          parent.replies.push(msg);
          console.log(`Added reply to parentId: ${parentId}`);
        } else {
          console.warn(`Parent message not found for parentId: ${parentId}`);
        }
      } else {
        roomMessages.push(msg);
        console.log('Added top-level message');
      }
      messages.set(roomId, roomMessages);
      io.to(roomId).emit('message-update', roomMessages);
    } catch (error) {
      console.error('Error processing chat-message:', error);
    }
  });

  socket.on('vote', (roomId, msgId, userId, direction) => {
    const roomMessages = messages.get(roomId) || [];
    const msg = findMessage(roomMessages, msgId);
    if (msg && !msg.votes.has(userId)) {
      msg.score += direction === 'up' ? 1 : -1;
      msg.votes.add(userId);
      messages.set(roomId, roomMessages);
      io.to(roomId).emit('message-update', roomMessages);
    }
  });

  socket.on('mute-user', (roomId, peerId) => {
    const room = rooms.get(roomId);
    if (room && roomCreators.get(roomId) === userId) {
      io.to(roomId).emit('mute-user', peerId);
    }
  });

  socket.on('offer', (roomId, offer) => socket.to(roomId).emit('offer', offer));
  socket.on('answer', (roomId, answer) => socket.to(roomId).emit('answer', answer));
  socket.on('ice-candidate', (roomId, candidate) => socket.to(roomId).emit('ice-candidate', candidate));
});

function findMessage(messages, id) {
  for (const msg of messages) {
    if (msg.id === id) return msg;
    const found = findMessage(msg.replies || [], id);
    if (found) return found;
  }
  return null;
}

// Use environment variable for port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));