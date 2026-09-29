const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());
app.use(express.static(__dirname));

// Uploads directory ensure karein
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log(' Connected to MongoDB Atlas Cloud!'))
  .catch(err => console.error(' MongoDB Connection Error:', err));

// Post Schema with Image URL
const postSchema = new mongoose.Schema({
  type: { type: String, default: 'HELP' },
  title: { type: String, required: true },
  desc: { type: String, required: true },
  author: { type: String, default: 'Nearby Resident' },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  imageUrl: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return parseFloat((R * c).toFixed(2));
}

// GET Posts
app.get('/api/posts', async (req, res) => {
  try {
    const { radius = 5.0, category = 'ALL', search = '', userLat, userLng } = req.query;
    const maxRadius = parseFloat(radius);
    const uLat = userLat ? parseFloat(userLat) : null;
    const uLng = userLng ? parseFloat(userLng) : null;

    let query = {};
    if (category !== 'ALL') query.type = category;
    if (search) {
      query.$or = [
        { title: { $regex: search,$options: 'i' } },
        { desc: { $regex: search,$options: 'i' } }
      ];
    }

    const allPosts = await Post.find(query).sort({ createdAt: -1 });
    const postsWithDistance = allPosts.map(post => {
      let dist = 0.1;
      if (uLat && uLng && post.lat && post.lng) {
        dist = calculateDistance(uLat, uLng, post.lat, post.lng);
      }
      return { ...post.toObject(), distance: dist };
    }).filter(post => post.distance <= maxRadius);

    res.json({ success: true, count: postsWithDistance.length, posts: postsWithDistance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST New Post with Multer Image Support
app.post('/api/posts', upload.single('image'), async (req, res) => {
  try {
    const { title, desc, type, author, lat, lng } = req.body;
    if (!title || !desc) return res.status(400).json({ error: 'Title and desc required' });

    let imageUrl = '';
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const newPost = new Post({
      type: type || 'HELP',
      title,
      desc,
      author: author || 'Nearby User',
      lat: lat ? parseFloat(lat) : 28.4744,
      lng: lng ? parseFloat(lng) : 77.5040,
      imageUrl
    });

    await newPost.save();
    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io Real-Time Two-Way Chat
io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => socket.join(roomId));
  socket.on('send_message', (data) => io.to(data.roomId).emit('receive_message', data));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nearzy Server running at http://localhost:${PORT}`);
});