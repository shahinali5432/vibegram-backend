const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const signToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

function sanitizeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

// Check username availability & generate suggestions
router.get('/check-username/:username', async (req, res) => {
  try {
    const raw = String(req.params.username || '').toLowerCase().replace(/[^a-z0-9._]/g, '');
    if (raw.length < 3) return res.json({ available: false, suggestions: [] });
    const existing = await prisma.user.findUnique({ where: { username: raw } });
    const base = raw.slice(0, 12) || 'vibe';
    const candidates = [
      `${base}_${Math.floor(10 + Math.random() * 89)}`,
      `${base}.${Math.floor(100 + Math.random() * 899)}`,
      `the.${base}${Math.floor(Math.random() * 9)}`,
      `${base}_vibes`
    ];
    const taken = await prisma.user.findMany({ where: { username: { in: candidates } }, select: { username: true } });
    const takenSet = new Set(taken.map(t => t.username));
    const suggestions = candidates.filter(c => !takenSet.has(c)).slice(0, 3);
    res.json({ available: !existing, suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sign Up
router.post('/signup', async (req, res) => {
  try {
    const { username, password, fullName, contact, dob, avatarUrl } = req.body;
    const cleanUsername = String(username || '').toLowerCase().replace(/[^a-z0-9._]/g, '');
    if (cleanUsername.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const exists = await prisma.user.findUnique({ where: { username: cleanUsername } });
    if (exists) return res.status(409).json({ error: 'Username is already taken' });

    const cleanContact = String(contact || '').trim();
    const isEmail = cleanContact.includes('@');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        fullName: (fullName || cleanUsername).trim(),
        email: isEmail ? cleanContact.toLowerCase() : null,
        phone: !isEmail && cleanContact ? cleanContact : null,
        passwordHash,
        dob: dob || null,
        avatarUrl: avatarUrl || ''
      }
    });

    const token = signToken(user.id);
    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login (by username, email, or phone)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const idf = String(identifier || '').trim();
    if (!idf || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: idf.toLowerCase() },
          { email: idf.toLowerCase() },
          { phone: idf }
        ]
      }
    });

    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user.id);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { identifier, otp, newPassword } = req.body;
    if (String(otp) !== '123456') return res.status(400).json({ error: 'Invalid OTP code' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });

    const idf = String(identifier || '').trim();
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: idf.toLowerCase() }, { email: idf.toLowerCase() }, { phone: idf }] }
    });
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Current User
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
