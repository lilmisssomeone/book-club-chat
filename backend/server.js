const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
app.get('/', (req, res) => {
  res.send('Welcome to Book Club Chat!');
});
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect('mongodb+srv://imbreonisokumen_db_user:4HuYqB5X1J19IZCA@cluster0.2hlvplp.mongodb.net/book_club?retryWrites=true&w=majority&appName=Cluster0')
.then(() => console.log('Connected to MongoDB Atlas'))
.catch(err => console.error('MongoDB connection error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  profilePicture: String,
  bio: String
});

const messageSchema = new mongoose.Schema({
  room: String,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
  profilePicture: String
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Auth middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  
  jwt.verify(token, 'secret-key', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User created' });
  } catch (error) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user._id, username: user.username }, 'secret-key');
    res.json({ token, user: { id: user._id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/messages/:room', authenticateToken, async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .populate('user', 'username profilePicture')
      .sort({ timestamp: 1 })
      .limit(50);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.io logic
const rooms = new Map();
const typingUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join-room', async ({ room, user }) => {
    socket.join(room);
    socket.user = user;
    
    // Load message history
    const recentMessages = await Message.find({ room })
      .populate('user', 'username profilePicture')
      .sort({ timestamp: -1 })
      .limit(50)
      .sort({ timestamp: 1 });
    
    socket.emit('message-history', recentMessages);
    
    // Notify room users
    socket.to(room).emit('user-joined', { user, room });
    socket.broadcast.to(room).emit('online-users-update', {
      room,
      users: Array.from(rooms.get(room) || []).map(u => u.username)
    });
  });

  // Handle message
  socket.on('send-message', async ({ room, message }) => {
    const msg = new Message({
      room,
      user: socket.user.id,
      username: socket.user.username,
      message,
      profilePicture: socket.user.profilePicture
    });
    await msg.save();
    
    io.to(room).emit('new-message', msg);
  });

  // Typing indicator
  socket.on('typing', ({ room, isTyping }) => {
    socket.to(room).emit('user-typing', { 
      username: socket.user.username, 
      isTyping,
      room 
    });
  });

  socket.on('disconnect', () => {
    if (socket.user && socket.rooms.size > 1) {
      const room = Array.from(socket.rooms).find(r => r !== socket.id);
      socket.to(room).emit('user-left', { username: socket.user.username, room });
    }
  });
});

server.listen(5000, () => {
  console.log('Server running on port 5000');
});
