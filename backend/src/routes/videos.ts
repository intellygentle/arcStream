// backend/src/routes/videos.ts

import express, { Request, Response, NextFunction } from 'express';
import { getAddress } from 'viem';
import { createVideo, getAllVideos, getVideoById } from '../services/videoService';
import { createX402Middleware, type X402Options } from '../middleware/x402';
import { generateDemoTransactions } from '../services/nanopaymentsService';
import { getTransactionStats } from '../utils/transactionLogger';
import { prisma } from '../lib/prisma';
import { Readable } from 'stream';
import { signPaymentWithCircle } from '../services/nanopaymentsService';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import path from 'path';

const router = express.Router();

// --- Cloudinary Configuration ---
cloudinary.config({ 
  secure: true 
});

// Multer setup to handle the file in memory (important for Render free tier)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit - adjust as needed
});

// 🔒 Production-safe parameter extractor
const getRouteParam = (param: string | string[] | undefined): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param) && param.length > 0) return param[0];
  return undefined;
};

// 🔐 Auth middleware helper
const getAuthenticatedUser = (req: Request) => {
  const sessionUser = (req as any).session?.user;
  if (sessionUser?.eoaAddress) return sessionUser;
  
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const eoaAddress = authHeader.slice(7);
    return { eoaAddress };
  }
  return null;
};

// --- ROUTES ---

// 1. POST /api/videos - Create new video with Cloudinary Upload
router.post('/', upload.single('video'), async (req: Request, res: Response) => {
  try {
    const authenticatedUser = getAuthenticatedUser(req);
    if (!authenticatedUser?.eoaAddress) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { title, description, durationSeconds, chunkUnit, chunkValue, pricePerChunk } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Upload to Cloudinary using a Buffer Stream
    const streamUpload = (fileBuffer: Buffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "video", folder: "arcstream" },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        Readable.from(fileBuffer).pipe(stream);
      });
    };

    const cloudinaryResult: any = await streamUpload(req.file.buffer);
    const videoUrl = cloudinaryResult.secure_url;

    // Calculate chunk duration
    let chunkDurationSeconds: number;
    const value = parseFloat(chunkValue) || 5;
    if (chunkUnit === 'minutes') {
      chunkDurationSeconds = Math.round(value * 60);
    } else {
      chunkDurationSeconds = Math.round(value);
    }

    // Find User in DB
    const creator = await prisma.user.findUnique({
      where: { eoaAddress: authenticatedUser.eoaAddress }
    });

    if (!creator) return res.status(401).json({ error: 'User not found in database.' });

    // Save to Neon via Prisma
    const video = await createVideo({ 
      title, 
      description, 
      durationSeconds: parseInt(durationSeconds, 10),
      chunkDurationSeconds,
      pricePerChunk: parseFloat(pricePerChunk) || 0.001, 
      creatorWallet: creator.eoaAddress,
      creatorDcw: creator.dcwAddress,
      videoUrl 
    });

    res.status(201).json({ success: true, data: video });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload and create video' });
  }
});

// 2. GET /api/videos - Feed with Search
router.get('/', async (req: Request, res: Response) => {
  let videos = await getAllVideos();
  const { q } = req.query;
  
  if (q && typeof q === 'string') {
    const search = q.toLowerCase();
    videos = videos.filter(v => 
      v.title.toLowerCase().includes(search) || 
      v.id.toLowerCase().includes(search) ||
      v.description?.toLowerCase().includes(search)
    );
  }
  
  res.json({ success: true, data: videos, count: videos.length });
});

// 3. GET /api/videos/:id - Single video metadata
router.get('/:id', async (req: Request, res: Response) => {
  const videoId = getRouteParam(req.params.id);
  if (!videoId) return res.status(400).json({ error: 'Missing video ID' });
  
  const video = await getVideoById(videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  
  res.json({ success: true, data: video });
});

// 4. GET /api/videos/:id/stream - Stream video (Cloudinary Proxy)
router.get('/:id/stream', async (req: Request, res: Response) => {
  const videoId = getRouteParam(req.params.id);
  const video = await getVideoById(videoId!);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  try {
    const fetchOptions: any = {};
    if (req.headers.range) {
      fetchOptions.headers = { Range: req.headers.range };
    }

    const response = await fetch(video.videoUrl, fetchOptions);
    
    if (response.status === 206 || response.status === 200) {
      res.status(response.status);
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      if (response.body) {
        Readable.from(response.body as any).pipe(res);
      } else {
        res.end();
      }
    } else {
      res.status(response.status).json({ error: 'Failed to fetch remote video' });
    }
  } catch (err: any) {
    res.status(502).json({ error: 'Stream proxy failed', details: err.message });
  }
});

// 5. DELETE /api/videos/:id - Delete video record
router.delete('/:id', async (req: Request, res: Response) => {
  const videoId = getRouteParam(req.params.id);
  const authenticatedUser = getAuthenticatedUser(req);
  if (!authenticatedUser?.eoaAddress) return res.status(401).json({ error: 'Auth required' });

  try {
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    if (video.creatorAddress.toLowerCase() !== authenticatedUser.eoaAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.payment.deleteMany({ where: { videoId: videoId } });
    await prisma.video.delete({ where: { id: videoId } });
    
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /api/videos/:id/sign/:chunk - Circle Payment Signing
router.post('/:id/sign/:chunk', async (req: Request, res: Response) => {
  const videoId = getRouteParam(req.params.id);
  const chunkIndex = parseInt(getRouteParam(req.params.chunk) || '0', 10);
  const authenticatedUser = getAuthenticatedUser(req);

  if (!authenticatedUser?.eoaAddress) return res.status(401).json({ error: 'Auth required' });

  try {
    const video = await getVideoById(videoId!);
    const user = await prisma.user.findUnique({ where: { eoaAddress: authenticatedUser.eoaAddress } });
    
    if (!user?.circleWalletId || !video) return res.status(404).json({ error: 'Context missing' });

    const signatureData = await signPaymentWithCircle({
      walletId: user.circleWalletId,
      videoId: video.id,
      chunkIndex,
      priceUSD: video.pricePerChunk.toFixed(6)
    });
    
    res.json({ success: true, data: { ...signatureData, dcwAddress: user.dcwAddress } });
  } catch (err: any) {
    res.status(500).json({ error: 'Signing failed' });
  }
});

// 7. POST /api/videos/:id/stream/:chunk - Protected x402 Chunk Access
router.post('/:id/stream/:chunk', 
  async (req: Request, res: Response, next: NextFunction) => {
    const videoId = getRouteParam(req.params.id) || '';
    const chunkIndex = parseInt(getRouteParam(req.params.chunk) || '0', 10);
    const video = await getVideoById(videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    return createX402Middleware({
      videoId,
      chunkIndex,
      priceUSD: video.pricePerChunk.toFixed(6),
      creatorDcw: video.creatorDcw,
      creatorAddress: video.creatorWallet,
    })(req, res, next);
  },
  (req: Request, res: Response) => {
    res.json({ success: true, unlocked: true, message: 'Chunk unlocked' });
  }
);

// 8. GET /api/videos/stats - Analytics
router.get('/stats', (req: Request, res: Response) => {
  res.json({ success: true, data: getTransactionStats() });
});

module.exports = router;