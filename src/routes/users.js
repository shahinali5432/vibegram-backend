const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { upload, uploadBufferToCloudinary } = require('../utils/cloudinary');

const router = express.Router();

// Search users
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const users = await prisma.user.findMany({
      where: q ? {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { fullName: { contains: q, mode: 'insensitive' } }
        ]
      } : {},
      take: 25,
      select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true }
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get profile by username
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username.toLowerCase() },
      include: {
        _count: { select: { posts: true, followers: true, following: true } },
        posts: { orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }] }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let followStatus = 'NONE';
    if (req.userId && req.userId !== user.id) {
      const f = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: req.userId, followingId: user.id } }
      });
      if (f) followStatus = f.status;
    }

    const { passwordHash, ...safe } = user;
    res.json({ user: safe, followStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { fullName, username, pronouns, bio, website, gender, isPrivate, isProfessional, proCategory, avatarUrl } = req.body;
    const data = {};
    if (fullName !== undefined) data.fullName = fullName;
    if (username !== undefined) data.username = username.toLowerCase().replace(/[^a-z0-9._]/g, '');
    if (pronouns !== undefined) data.pronouns = pronouns;
    if (bio !== undefined) data.bio = bio;
    if (website !== undefined) data.website = website;
    if (gender !== undefined) data.gender = gender;
    if (isPrivate !== undefined) data.isPrivate = Boolean(isPrivate);
    if (isProfessional !== undefined) data.isProfessional = Boolean(isProfessional);
    if (proCategory !== undefined) data.proCategory = proCategory;
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;

    const updated = await prisma.user.update({ where: { id: req.userId }, data });
    const { passwordHash, ...safe } = updated;
    res.json({ user: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload Avatar to Cloudinary
router.post('/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
    const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'vibegram/avatars', 'image');
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: uploaded.secure_url }
    });
    res.json({ avatarUrl: updated.avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Follow / Unfollow
router.post('/:userId/follow', authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.userId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: req.userId, followingId: targetId } }
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      return res.json({ status: 'NONE' });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const status = target.isPrivate ? 'PENDING' : 'ACCEPTED';
    await prisma.follow.create({ data: { followerId: req.userId, followingId: targetId, status } });

    await prisma.notification.create({
      data: {
        recipientId: targetId,
        actorId: req.userId,
        type: 'FOLLOW',
        text: status === 'PENDING' ? 'requested to follow you.' : 'started following you.'
      }
    });

    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
