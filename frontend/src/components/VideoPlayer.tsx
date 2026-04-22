// frontend/src/components/VideoPlayer.tsx

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Loader2, AlertCircle, RotateCcw, Lock, Zap, ZapOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { videoAPI, x402Utils, type SignedPayment, type PaymentDetails } from '@/lib/api';
import { formatUSDC, calculateVideoChunks, formatDuration } from '@/config/app';

interface VideoPlayerProps {
  videoId: string;
  videoUrl: string;
  durationSeconds: number;
  chunkDurationSeconds: number;
  pricePerChunk: number;
  creatorWallet: string;
  creatorDcw: string;
  viewerWallet: string | null;
  viewerDcw: string | null;
  onPaymentSuccess?: (chunkIndex: number, amount: string) => void;
  onPaymentError?: (error: string) => void;
}

// Circular Chunk Progress Indicator - Nod to "Circle" brand
const CircularChunkProgress: React.FC<{
  current: number;
  total: number;
  unlocked: Set<number>;
}> = ({ current, total }) => {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const progress = ((current + 1) / total) * 100;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="relative w-7 h-7 sm:w-9 sm:h-9">
      <svg className="w-full h-full -rotate-90">
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="#3D3458"
          strokeWidth="2"
        />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="url(#chunkGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="chunk-circle"
        />
        <defs>
          <linearGradient id="chunkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8656EF" />
            <stop offset="100%" stopColor="#00C8B3" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[8px] sm:text-[10px] font-bold text-white">
        {current + 1}/{total}
      </div>
    </div>
  );
};

export default function VideoPlayer({
  videoId,
  videoUrl,
  durationSeconds,
  chunkDurationSeconds,
  pricePerChunk,
  creatorWallet,
  creatorDcw,
  viewerWallet,
  viewerDcw,
  onPaymentSuccess,
  onPaymentError
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [unlockedChunks, setUnlockedChunks] = useState<Set<number>>(new Set([0]));
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [needsPayment, setNeedsPayment] = useState(false);
  const [lastPaidChunk, setLastPaidChunk] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  
  // Auto-pay feature
  const [autoPayEnabled, setAutoPayEnabled] = useState(false);
  const [isAutoPaying, setIsAutoPaying] = useState(false);
  const [autoPayProcessedForChunk, setAutoPayProcessedForChunk] = useState<Set<number>>(new Set());

  const { chunkSeconds, totalChunks } = calculateVideoChunks(durationSeconds, chunkDurationSeconds);
  const streamUrl = `${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3001'}/api/videos/${videoId}/stream`;
  
  const isCurrentChunkPaid = unlockedChunks.has(currentChunk);
  const currentChunkEndTime = Math.min((currentChunk + 1) * chunkSeconds, durationSeconds);
  
  const nextChunk = currentChunk + 1;
  const isNextChunkLocked = nextChunk < totalChunks && !unlockedChunks.has(nextChunk);

  // Detect mobile for responsive behavior
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  console.log('🎬 VideoPlayer:', { 
    videoId, durationSeconds, totalChunks, chunkSeconds,
    currentChunk, nextChunk, isNextChunkLocked, autoPayEnabled,
    unlockedChunks: Array.from(unlockedChunks)
  });

  // Load previously paid chunks on mount
  useEffect(() => {
    const loadPaidChunks = async () => {
      if (!viewerWallet || !videoId) return;
      
      try {
        console.log('📥 Loading paid chunks for user...');
        const res = await videoAPI.getPaidChunks(videoId, viewerWallet);
        
        if (res.data.success) {
          const paidChunks = res.data.data.paidChunks;
          console.log('✅ Previously paid chunks:', paidChunks);
          
          const unlocked = new Set<number>([0]);
          paidChunks.forEach((chunk: number) => unlocked.add(chunk));
          setUnlockedChunks(unlocked);
          
          if (paidChunks.length > 0) {
            setLastPaidChunk(Math.max(...paidChunks));
          }
        }
      } catch (err) {
        console.error('Failed to load paid chunks:', err);
      }
    };
    
    if (viewerWallet) {
      loadPaidChunks();
    }
  }, [videoId, viewerWallet]);

  // Auto-pay immediately when entering a chunk with locked next chunk
  useEffect(() => {
    if (!autoPayEnabled) return;
    if (!playing || !ready || !mounted) return;
    if (currentChunk >= totalChunks - 1) return;
    if (!viewerWallet || !viewerDcw) return;
    if (paymentStatus === 'pending' || isAutoPaying) return;
    
    const nextChunkIdx = currentChunk + 1;
    
    if (unlockedChunks.has(nextChunkIdx)) return;
    if (autoPayProcessedForChunk.has(nextChunkIdx)) return;
    
    console.log(`⚡ Auto-paying for chunk ${nextChunkIdx} immediately`);
    handleAutoPayNext();
  }, [autoPayEnabled, playing, ready, currentChunk, totalChunks, unlockedChunks, 
      autoPayProcessedForChunk, viewerWallet, viewerDcw, paymentStatus, isAutoPaying, mounted]);

  // Reset auto-pay processed flag when chunk changes
  useEffect(() => {
    setAutoPayProcessedForChunk(prev => {
      const next = new Set(prev);
      return next;
    });
  }, [currentChunk]);

  // Auto-pay for next chunk
  const handleAutoPayNext = useCallback(async () => {
    const nextChunkIdx = currentChunk + 1;
    if (nextChunkIdx >= totalChunks) return;
    if (unlockedChunks.has(nextChunkIdx)) return;
    
    setIsAutoPaying(true);
    setAutoPayProcessedForChunk(prev => new Set(prev).add(nextChunkIdx));
    
    try {
      const success = await payForChunk(nextChunkIdx, true);
      
      if (success) {
        toast.success(`⚡ Auto-paid chunk ${nextChunkIdx + 1}`, {
          duration: 1500,
          position: 'bottom-center',
          icon: '⚡',
        });
      }
    } catch (err) {
      console.error('Auto-pay error:', err);
    } finally {
      setIsAutoPaying(false);
    }
  }, [currentChunk, totalChunks, unlockedChunks]);

  // Toggle auto-pay
  const toggleAutoPay = useCallback(() => {
    setAutoPayEnabled(prev => {
      const newState = !prev;
      if (newState) {
        toast.success('⚡ Auto-pay enabled', {
          duration: 1500,
          position: 'bottom-center',
          icon: '⚡',
        });
        setAutoPayProcessedForChunk(new Set());
      } else {
        toast('Auto-pay disabled', {
          duration: 1000,
          position: 'bottom-center',
          icon: '🔕',
        });
      }
      return newState;
    });
  }, []);

  // Ensure all chunks between last paid and current are paid
  const ensureChunksPaid = useCallback(async (targetChunk: number): Promise<boolean> => {
    if (targetChunk === 0) return true;
    if (unlockedChunks.has(targetChunk)) return true;
    
    let highestContiguous = 0;
    for (let i = 0; i <= targetChunk; i++) {
      if (unlockedChunks.has(i)) {
        highestContiguous = i;
      } else {
        break;
      }
    }
    
    const chunksToPay: number[] = [];
    for (let i = highestContiguous + 1; i <= targetChunk; i++) {
      if (!unlockedChunks.has(i)) {
        chunksToPay.push(i);
      }
    }
    
    if (chunksToPay.length === 0) return true;
    
    console.log(`💰 Need to pay for chunks: ${chunksToPay.join(', ')}`);
    
    for (const chunk of chunksToPay) {
      const success = await payForChunk(chunk);
      if (!success) return false;
    }
    
    return true;
  }, [unlockedChunks]);

  // Pay for a specific chunk
  const payForChunk = useCallback(async (chunkIndex: number, isAuto: boolean = false): Promise<boolean> => {
    if (unlockedChunks.has(chunkIndex)) {
      console.log(`✅ Chunk ${chunkIndex} already paid`);
      return true;
    }
    
    console.log(`💰 Paying for chunk ${chunkIndex} ${isAuto ? '(auto)' : '(manual)'}`);
    
    if (!isAuto) {
      setPaymentStatus('pending');
    }
    
    try {
      let paymentDetails: PaymentDetails | null = null;
      
      try {
        await videoAPI.requestChunkAccess(videoId, chunkIndex);
        setUnlockedChunks(prev => new Set(prev).add(chunkIndex));
        setLastPaidChunk(Math.max(lastPaidChunk, chunkIndex));
        onPaymentSuccess?.(chunkIndex, formatUSDC(pricePerChunk));
        return true;
      } catch (err: any) {
        if (err.response?.status === 402) {
          paymentDetails = x402Utils.parsePaymentDetails(err.response);
        } else if (err.response?.status === 200) {
          setUnlockedChunks(prev => new Set(prev).add(chunkIndex));
          setLastPaidChunk(Math.max(lastPaidChunk, chunkIndex));
          return true;
        } else {
          throw err;
        }
      }

      if (!paymentDetails) throw new Error('No payment details');

      const signRes = await videoAPI.signChunk(videoId, chunkIndex, viewerWallet!);
      const { signature, nonce } = signRes.data.data;
      
      const signedPayment: SignedPayment = {
        signature,
        paymentDetails: { ...paymentDetails, nonce },
        payerAddress: viewerDcw!,
      };
      
      console.log('📝 Submitting signed payment:', {
        signature: signature.slice(0, 20) + '...',
        payerAddress: viewerDcw,
        nonce,
        price: paymentDetails.price,
      });
      
      await videoAPI.requestChunkAccess(videoId, chunkIndex, signedPayment);
      
      setUnlockedChunks(prev => new Set(prev).add(chunkIndex));
      setLastPaidChunk(Math.max(lastPaidChunk, chunkIndex));
      onPaymentSuccess?.(chunkIndex, formatUSDC(pricePerChunk));
      
      return true;
      
    } catch (err: any) {
      console.error('❌ Payment error for chunk', chunkIndex, err);
      
      if (err.response?.data?.error?.includes('Unique constraint') || 
          err.message?.includes('Unique constraint')) {
        setUnlockedChunks(prev => new Set(prev).add(chunkIndex));
        setLastPaidChunk(Math.max(lastPaidChunk, chunkIndex));
        return true;
      }
      
      if (!isAuto) {
        toast.error(`Failed to pay for chunk ${chunkIndex + 1}`);
      }
      onPaymentError?.(err.message);
      return false;
    } finally {
      if (!isAuto) {
        setPaymentStatus('idle');
      }
    }
  }, [videoId, pricePerChunk, viewerWallet, viewerDcw, lastPaidChunk, unlockedChunks, onPaymentSuccess, onPaymentError]);

  // Handle play/pause
  const handlePlayPause = useCallback(() => {
    if (!videoRef.current || !ready) {
      toast.error('Video is still loading...');
      return;
    }
    
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
      return;
    }
    
    if (!unlockedChunks.has(currentChunk)) {
      if (!viewerWallet || !viewerDcw) {
        toast.error('Please connect your wallet to continue');
        return;
      }
      setNeedsPayment(true);
      initiatePayment();
      return;
    }
    
    videoRef.current.play().catch(err => {
      console.error('Play error:', err);
      toast.error('Failed to play video: ' + err.message);
    });
    setPlaying(true);
    setNeedsPayment(false);
  }, [playing, ready, currentChunk, unlockedChunks, viewerWallet, viewerDcw]);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current || !mounted || isSeeking) return;
    
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    
    const newChunk = Math.floor(time / chunkSeconds);
    
    if (newChunk !== currentChunk) {
      console.log(`📊 Chunk changed: ${currentChunk} -> ${newChunk}`);
      
      if (!unlockedChunks.has(newChunk)) {
        console.log(`⏸️ Hit unpaid chunk ${newChunk}, pausing`);
        videoRef.current.pause();
        setPlaying(false);
        setCurrentChunk(newChunk);
        setNeedsPayment(true);
        return;
      }
      
      setCurrentChunk(newChunk);
    }
    
    if (time >= currentChunkEndTime - 0.3 && !unlockedChunks.has(currentChunk)) {
      console.log(`⏸️ End of unpaid chunk ${currentChunk}`);
      videoRef.current.pause();
      setPlaying(false);
      setNeedsPayment(true);
    }
  }, [chunkSeconds, currentChunk, currentChunkEndTime, unlockedChunks, mounted, isSeeking]);

  // Initiate payment for current chunk
  const initiatePayment = useCallback(async () => {
    if (!viewerWallet || !viewerDcw) {
      toast.error('Please connect your wallet to continue');
      return;
    }
    
    setNeedsPayment(false);
    const success = await ensureChunksPaid(currentChunk);
    
    if (success) {
      setPaymentStatus('success');
      setNeedsPayment(false);
      videoRef.current?.play();
      setPlaying(true);
      setTimeout(() => setPaymentStatus('idle'), 2000);
    } else {
      setPaymentStatus('error');
      setNeedsPayment(true);
    }
  }, [viewerWallet, viewerDcw, currentChunk, ensureChunksPaid]);

  // Handle seek
  const handleSeek = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    
    const newTime = parseFloat(e.target.value);
    const newChunk = Math.floor(newTime / chunkSeconds);
    
    console.log(`🎯 Seeking to ${newTime}s, chunk ${newChunk}, paid: ${unlockedChunks.has(newChunk)}`);
    
    if (!unlockedChunks.has(newChunk) && newChunk > 0) {
      toast.error(`Chunk ${newChunk + 1} is locked`);
      return;
    }
    
    setIsSeeking(true);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    setCurrentChunk(newChunk);
    
    setAutoPayProcessedForChunk(prev => {
      const next = new Set(prev);
      next.delete(newChunk + 1);
      return next;
    });
    
    setTimeout(() => setIsSeeking(false), 200);
  }, [chunkSeconds, unlockedChunks]);

  const handleSeeking = useCallback(() => setIsSeeking(true), []);
  
  const handleSeeked = useCallback(() => {
    if (!videoRef.current) return;
    
    const newTime = videoRef.current.currentTime;
    const newChunk = Math.floor(newTime / chunkSeconds);
    
    console.log(`🎯 Seeked to ${newTime}s, chunk ${newChunk}`);
    
    if (!unlockedChunks.has(newChunk) && newChunk > 0) {
      let lastPaid = 0;
      for (let i = newChunk - 1; i >= 0; i--) {
        if (unlockedChunks.has(i)) {
          lastPaid = i;
          break;
        }
      }
      
      const seekBackTime = (lastPaid + 1) * chunkSeconds - 0.1;
      videoRef.current.currentTime = Math.max(0, seekBackTime);
      setCurrentTime(seekBackTime);
      setCurrentChunk(lastPaid);
      toast.error('Cannot skip unpaid content');
    } else {
      setCurrentTime(newTime);
      setCurrentChunk(newChunk);
    }
    
    setIsSeeking(false);
  }, [chunkSeconds, unlockedChunks]);

  const handleLoadedData = () => {
    console.log('✅ Video loaded');
    setReady(true);
    setIsLoading(false);
  };

  const handleCanPlay = () => {
    console.log('✅ Video can play');
    setReady(true);
    setIsLoading(false);
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    const error = video.error;
    
    console.error('❌ Video error details:', { code: error?.code, message: error?.message });
    
    let errorMessage = 'Failed to load video';
    if (error) {
      switch (error.code) {
        case 1: errorMessage = 'Video loading aborted'; break;
        case 2: errorMessage = 'Network error'; break;
        case 3: errorMessage = 'Video decoding failed'; break;
        case 4: errorMessage = 'Video not found'; break;
        default: errorMessage = `Video error: ${error.message}`;
      }
    }
    
    setVideoError(errorMessage);
    setIsLoading(false);
  };

  const handleEnded = () => {
    console.log('🏁 Video ended');
    setPlaying(false);
  };

  const handleRetry = () => {
    setVideoError(null);
    setIsLoading(true);
    setReady(false);
    if (videoRef.current) videoRef.current.load();
  };

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = (currentTime / durationSeconds) * 100;
  const maxUnlockedTime = Math.min((lastPaidChunk + 1) * chunkSeconds, durationSeconds);

  return (
    <div className="relative w-full aspect-video bg-[#1F1A31] rounded-xl overflow-hidden shadow-2xl border border-[#3D3458]">
      <video
        ref={videoRef}
        className="w-full h-full"
        onTimeUpdate={handleTimeUpdate}
        onLoadedData={handleLoadedData}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onEnded={handleEnded}
        onSeeking={handleSeeking}
        onSeeked={handleSeeked}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
      >
        <source src={streamUrl} type="video/mp4" />
      </video>
      
      {/* Loading overlay */}
      {isLoading && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1F1A31]/80 backdrop-blur-sm z-10">
          <div className="text-center">
            <Loader2 className="animate-spin text-[#8656EF] mx-auto mb-2" size={isMobile ? 36 : 48} />
            <p className="text-white text-xs sm:text-sm font-medium">Loading watch-worthy content...</p>
          </div>
        </div>
      )}
      
      {/* Error overlay */}
      {videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1F1A31] z-10 p-4">
          <div className="text-center">
            <AlertCircle className="mx-auto mb-3 sm:mb-4 text-red-400" size={isMobile ? 36 : 48} />
            <p className="text-white text-sm sm:text-base mb-4">{videoError}</p>
            <button onClick={handleRetry} className="glow-button px-4 py-2 text-white rounded-lg text-sm">
              <RotateCcw size={14} className="inline mr-2" /> Retry
            </button>
          </div>
        </div>
      )}
      
      {/* Regular payment overlay with glassmorphism */}
      {paymentStatus === 'pending' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1F1A31]/70 backdrop-blur-sm z-30">
          <div className="glass-card rounded-xl p-4 sm:p-6 text-center mx-4">
            <Loader2 className="animate-spin mx-auto mb-2 sm:mb-3 text-[#8656EF]" size={isMobile ? 28 : 32} />
            <p className="text-white text-base sm:text-lg mb-1 font-medium">Processing Payment</p>
            <p className="text-[#00C8B3] font-mono text-sm sm:text-base">{formatUSDC(pricePerChunk)} USDC</p>
          </div>
        </div>
      )}
      
      {/* Auto-pay processing indicator */}
      {isAutoPaying && (
        <div className="absolute top-2 sm:top-4 right-2 sm:right-4 bg-gradient-to-r from-[#8656EF]/90 to-[#00C8B3]/90 text-white px-2 sm:px-3 py-1 sm:py-1.5 rounded-full z-40 shadow-lg flex items-center gap-1 sm:gap-2">
          <Loader2 className="animate-spin" size={12} />
          <span className="text-[10px] sm:text-xs font-medium">Auto-paying...</span>
        </div>
      )}
      
      {/* Locked chunk indicator */}
      {needsPayment && !isCurrentChunkPaid && paymentStatus === 'idle' && (
        <div className="absolute top-2 sm:top-4 left-1/2 -translate-x-1/2 glass-card px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg z-20 shadow-lg flex items-center gap-1 sm:gap-2 whitespace-nowrap">
          <Lock size={12} className="text-[#F59E0B]" />
          <span className="font-medium text-white text-xs sm:text-sm">
            Press play • {formatUSDC(pricePerChunk)} USDC
          </span>
        </div>
      )}
      
      {/* Controls overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 md:p-4 bg-gradient-to-t from-[#1F1A31] via-[#1F1A31]/80 to-transparent">
        {/* Progress bar - larger touch target on mobile */}
        <div className="relative w-full h-2 bg-[#3D3458] rounded-full mb-2 sm:mb-3 overflow-hidden">
          <div 
            className="absolute h-full bg-[#22C55E]/30" 
            style={{ width: `${(maxUnlockedTime / durationSeconds) * 100}%` }}
          />
          <div 
            className="absolute h-full bg-gradient-to-r from-[#8656EF] to-[#00C8B3] transition-all duration-300" 
            style={{ width: `${progressPercent}%` }}
          />
          <input
            type="range"
            min={0}
            max={durationSeconds}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
        
        <div className="flex items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
            <button
              onClick={handlePlayPause}
              disabled={!ready || paymentStatus === 'pending'}
              className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 flex items-center justify-center bg-[#2D2440]/80 hover:bg-[#3D3458] rounded-full text-white disabled:opacity-50 transition shadow-lg"
            >
              {!ready || isLoading ? (
                <Loader2 className="animate-spin" size={isMobile ? 16 : 22} />
              ) : playing ? (
                <Pause size={isMobile ? 16 : 24} />
              ) : (
                <Play size={isMobile ? 16 : 24} />
              )}
            </button>
            
            <span className="text-xs sm:text-sm text-white font-mono font-medium">
              {formatTime(currentTime)} / {formatTime(durationSeconds)}
            </span>
            
            {/* Circular Progress - Nod to Circle brand */}
            <CircularChunkProgress 
              current={currentChunk} 
              total={totalChunks} 
              unlocked={unlockedChunks} 
            />
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
            {/* Auto-Pay Toggle Button - Mobile optimized */}
            <button
              onClick={toggleAutoPay}
              className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-all shadow-lg ${
                autoPayEnabled 
                  ? 'bg-gradient-to-r from-[#8656EF] to-[#00C8B3] text-white' 
                  : 'bg-[#2D2440] text-gray-300 hover:bg-[#3D3458]'
              }`}
              title={autoPayEnabled ? 'Auto-pay enabled' : 'Auto-pay disabled'}
            >
              {autoPayEnabled ? (
                <>
                  <Zap size={10} className="fill-current" />
                  <span className="hidden xs:inline">Auto</span>
                </>
              ) : (
                <>
                  <ZapOff size={10} />
                  <span className="hidden xs:inline">Manual</span>
                </>
              )}
            </button>
            
            <span className="text-[10px] sm:text-xs text-gray-300 bg-[#2D2440] px-2 py-1 rounded-full">
              <span className="hidden sm:inline">{formatDuration(chunkSeconds)}</span>
              <span className="sm:hidden">{Math.floor(chunkSeconds / 60)}m</span>
            </span>
          </div>
        </div>
        
        {/* Chunk status indicators - scrollable on mobile */}
        <div className="flex gap-0.5 sm:gap-1 mt-2 sm:mt-3 overflow-x-auto hide-scrollbar pb-1">
          {Array.from({ length: Math.min(totalChunks, isMobile ? 12 : 30) }, (_, i) => (
            <div
              key={i}
              className={`flex-1 min-w-[6px] sm:min-w-[8px] h-1 sm:h-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                unlockedChunks.has(i) 
                  ? 'bg-gradient-to-r from-[#22C55E] to-[#00C8B3] hover:opacity-80 shadow-sm' 
                  : i === currentChunk 
                    ? 'bg-[#F59E0B] shadow-sm' 
                    : 'bg-[#3D3458] hover:bg-[#4D4468]'
              }`}
              onClick={() => {
                if (unlockedChunks.has(i) && videoRef.current) {
                  videoRef.current.currentTime = i * chunkSeconds;
                } else if (!unlockedChunks.has(i) && i > 0) {
                  toast(`Chunk ${i + 1} is locked. Press play to unlock.`, {
                    icon: '🔒',
                    duration: 2000,
                  });
                }
              }}
              title={`Chunk ${i + 1}: ${unlockedChunks.has(i) ? 'Unlocked' : 'Locked'}`}
            />
          ))}
          {totalChunks > (isMobile ? 12 : 30) && (
            <span className="text-[10px] text-gray-400 ml-1 bg-[#2D2440] px-1.5 py-0.5 rounded-full">
              +{totalChunks - (isMobile ? 12 : 30)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}