require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const chatRoutes = require('./routes/chat');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.set('io', io);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '15mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'VibeGram API', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/chat', chatRoutes);

// Real-Time Socket.io Events
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('register_user', (userId) => {
    if (userId) {
      onlineUsers.set(userId, socket.id);
      io.emit('online_users', Array.from(onlineUsers.keys()));
    }
  });

  socket.on('join_conversation', (convId) => {
    if (convId) socket.join(convId);
  });

  socket.on('typing', ({ convId, userId, isTyping }) => {
    socket.to(convId).emit('user_typing', { convId, userId, isTyping });
  });

  socket.on('disconnect', () => {
    for (const [uid, sid] of onlineUsers.entries()) {
      if (sid === socket.id) {
        onlineUsers.delete(uid);
        break;
      }
    }
    io.emit('online_users', Array.from(onlineUsers.keys()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 VibeGram Full-Stack Server running on http://localhost:${PORT}`);
});
