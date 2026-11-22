const express = require('express');
const prisma = require('../utils/prisma');
const { authMiddleware } = require('../middleware/auth');
const { upload, uploadBufferToCloudinary } = require('../utils/cloudinary');

const router = express.Router();

// List Conversations
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const convs = await prisma.conversation.findMany({
      where: { OR: [{ userAId: req.userId }, { userBId: req.userId }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        userA: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
        userB: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
    res.json({ conversations: convs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get or Create Conversation with target user
router.post('/conversations/:targetUserId', authMiddleware, async (req, res) => {
  try {
    const [u1, u2] = [req.userId, req.params.targetUserId].sort();
    let conv = await prisma.conversation.findUnique({
      where: { userAId_userBId: { userAId: u1, userBId: u2 } },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    if (!conv) {
      conv = await prisma.conversation.create({
        data: { userAId: u1, userBId: u2 },
        include: { messages: true }
      });
    }
    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Message (Text / Media / Voice Note)
router.post('/conversations/:conversationId/messages', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    let mediaUrl = req.body.mediaUrl || '';
    let mediaType = req.body.mediaType || '';

    if (req.file) {
      const isAudio = req.file.mimetype.startsWith('audio');
      const isVideo = req.file.mimetype.startsWith('video');
      const resType = isAudio || isVideo ? 'video' : 'image';
      const up = await uploadBufferToCloudinary(req.file.buffer, 'vibegram/chat', resType);
      mediaUrl = up.secure_url;
      mediaType = isAudio ? 'VOICE' : isVideo ? 'VIDEO' : 'IMAGE';
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: req.params.conversationId,
        senderId: req.userId,
        text: req.body.text || '',
        mediaUrl,
        mediaType,
        voiceDuration: Number(req.body.voiceDuration || 0),
        replyToText: req.body.replyToText || '',
        isVanish: req.body.isVanish === 'true'
      }
    });

    await prisma.conversation.update({
      where: { id: req.params.conversationId },
      data: { updatedAt: new Date() }
    });

    // Broadcast via Socket.io if active
    const io = req.app.get('io');
    if (io) io.to(req.params.conversationId).emit('new_message', msg);

    res.status(201).json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { recipientId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { actor: { select: { id: true, username: true, avatarUrl: true } } }
    });
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
