const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { upload, uploadBufferToCloudinary } = require('../utils/cloudinary');

const router = express.Router();

// Get Home Feed & Reels
router.get('/', optionalAuth, async (req, res) => {
  try {
    const type = req.query.type; // optional: REEL
    const posts = await prisma.post.findMany({
      where: type ? { mediaType: type } : {},
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: {
        user: { select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true } },
        _count: { select: { likes: true, comments: true } },
        likes: req.userId ? { where: { userId: req.userId }, select: { id: true } } : false,
        savedBy: req.userId ? { where: { userId: req.userId }, select: { id: true } } : false
      }
    });

    const formatted = posts.map(p => ({
      ...p,
      likesCount: p._count.likes,
      commentsCount: p._count.comments,
      liked: Array.isArray(p.likes) && p.likes.length > 0,
      saved: Array.isArray(p.savedBy) && p.savedBy.length > 0
    }));

    res.json({ posts: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Post or Reel (with Cloudinary file upload)
router.post('/', authMiddleware, upload.array('media', 10), async (req, res) => {
  try {
    const { caption, location, mediaType, filter, audioName, ratio } = req.body;
    const urls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const resType = file.mimetype.startsWith('video') ? 'video' : 'image';
        const uploaded = await uploadBufferToCloudinary(file.buffer, 'vibegram/posts', resType);
        urls.push(uploaded.secure_url);
      }
    }

    const post = await prisma.post.create({
      data: {
        userId: req.userId,
        caption: caption || '',
        location: location || '',
        mediaUrls: urls,
        mediaType: mediaType || (urls.length > 1 ? 'CAROUSEL' : 'IMAGE'),
        filter: filter || '',
        audioName: audioName || '',
        ratio: ratio || '4/5'
      },
      include: {
        user: { select: { id: true, username: true, fullName: true, avatarUrl: true, isVerified: true } }
      }
    });

    res.status(201).json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Like
router.post('/:postId/like', authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const existing = await prisma.like.findUnique({
      where: { userId_postId: { userId: req.userId, postId } }
    });

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      return res.json({ liked: false });
    }

    await prisma.like.create({ data: { userId: req.userId, postId } });
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (post && post.userId !== req.userId) {
      await prisma.notification.create({
        data: {
          recipientId: post.userId,
          actorId: req.userId,
          type: 'LIKE',
          postId,
          text: post.mediaType === 'REEL' ? 'liked your reel.' : 'liked your photo.'
        }
      });
    }
    res.json({ liked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Save
router.post('/:postId/save', authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const collection = req.body.collection || 'All Posts';
    const existing = await prisma.savedPost.findUnique({
      where: { userId_postId: { userId: req.userId, postId } }
    });

    if (existing) {
      await prisma.savedPost.delete({ where: { id: existing.id } });
      return res.json({ saved: false });
    }

    await prisma.savedPost.create({ data: { userId: req.userId, postId, collection } });
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get & Add Comments
router.get('/:postId/comments', async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { postId: req.params.postId, parentId: null },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: { select: { id: true, username: true, avatarUrl: true, isVerified: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, username: true, avatarUrl: true, isVerified: true } } }
        }
      }
    });
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:postId/comments', authMiddleware, async (req, res) => {
  try {
    const { text, parentId } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

    const comment = await prisma.comment.create({
      data: {
        userId: req.userId,
        postId: req.params.postId,
        parentId: parentId || null,
        text: text.trim()
      },
      include: { user: { select: { id: true, username: true, avatarUrl: true, isVerified: true } } }
    });

    const post = await prisma.post.findUnique({ where: { id: req.params.postId } });
    if (post && post.userId !== req.userId) {
      await prisma.notification.create({
        data: {
          recipientId: post.userId,
          actorId: req.userId,
          type: parentId ? 'REPLY' : 'COMMENT',
          postId: post.id,
          commentId: comment.id,
          text: `commented: ${text.trim().slice(0, 60)}`
        }
      });
    }

    res.status(201).json({ comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Active Stories (24h window)
router.get('/stories/active', optionalAuth, async (req, res) => {
  try {
    const stories = await prisma.story.findMany({
      where: { expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, username: true, avatarUrl: true } } }
    });
    res.json({ stories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stories', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    let mediaUrl = req.body.mediaUrl || '';
    let mediaType = 'IMAGE';
    if (req.file) {
      mediaType = req.file.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE';
      const up = await uploadBufferToCloudinary(req.file.buffer, 'vibegram/stories', mediaType.toLowerCase());
      mediaUrl = up.secure_url;
    }
    const story = await prisma.story.create({
      data: {
        userId: req.userId,
        mediaUrl,
        mediaType,
        stickersJson: req.body.stickersJson || '[]',
        isCloseFriends: req.body.isCloseFriends === 'true',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    res.status(201).json({ story });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 24h Music Notes
router.get('/notes/active', async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      where: { expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, username: true, avatarUrl: true } } }
    });
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notes', authMiddleware, async (req, res) => {
  try {
    const { text, musicTitle, musicArtist, location } = req.body;
    const note = await prisma.note.upsert({
      where: { userId: req.userId },
      update: { text, musicTitle: musicTitle || '', musicArtist: musicArtist || '', location: location || '', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
      create: { userId: req.userId, text, musicTitle: musicTitle || '', musicArtist: musicArtist || '', location: location || '', expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }
    });
    res.json({ note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
