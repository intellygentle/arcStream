// src/app/page.tsx

'use client';

import { useEffect, useState } from 'react';
import WalletAuth from '@/components/WalletAuth';
import { videoAPI } from '@/lib/api';
import { Search, AlertCircle, RefreshCw, Trash2, Loader2, Play, Clock, DollarSign, Menu, X } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useWallet } from '@/components/WalletAuth';

interface Video {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  chunkDuration: number;
  pricePerChunk: number;
  creatorWallet: string;
  videoUrl: string;
  createdAt: string;
}

export default function Home() {
  const { eoa: viewerWallet } = useWallet();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchVideos = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await videoAPI.list(q);
      const videosData = res.data?.data || res.data || [];
      setVideos(Array.isArray(videosData) ? videosData : []);
    } catch (err: any) {
      console.error('Fetch error:', err);
      setError('Could not connect to backend. Is it running?');
      setVideos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchVideos(); 
  }, [q]);

  const handleDelete = async (videoId: string) => {
    if (!viewerWallet) {
      toast.error('Please connect your wallet first');
      return;
    }
    
    setDeletingId(videoId);
    try {
      const res = await videoAPI.delete(videoId, viewerWallet);
      toast.success(res.data.data.message || 'Video deleted successfully');
      setVideos(prev => prev.filter(v => v.id !== videoId));
      setShowDeleteConfirm(null);
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error(err.response?.data?.error || 'Failed to delete video');
    } finally {
      setDeletingId(null);
    }
  };

  const isCreator = (video: Video) => {
    return viewerWallet && video.creatorWallet.toLowerCase() === viewerWallet.toLowerCase();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <main className="min-h-screen bg-[#1F1A31] retro-grid-bg pb-safe">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-4 space-y-4 sm:space-y-6">
        {/* Header - Mobile Responsive */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-[#8656EF] to-[#00C8B3] bg-clip-text text-transparent">
                🎬 Arc-Watch-Worthy
              </h1>
              <p className="text-gray-400 text-xs sm:text-sm mt-0.5">Pay only for content that earns it</p>
            </div>
            
            {/* Mobile menu button */}
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="sm:hidden p-2 text-gray-300 hover:text-white"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
          
          {/* Desktop upload button */}
          <Link 
            href="/upload" 
            className="hidden sm:flex glow-button px-4 sm:px-5 py-2 sm:py-2.5 text-white rounded-xl font-medium transition items-center gap-2 text-sm sm:text-base"
          >
            + List Video
          </Link>
        </header>
        
        {/* Mobile upload button (when menu open) */}
        {mobileMenuOpen && (
          <div className="sm:hidden">
            <Link 
              href="/upload" 
              className="flex glow-button px-4 py-2.5 text-white rounded-xl font-medium transition items-center justify-center gap-2 text-sm w-full"
              onClick={() => setMobileMenuOpen(false)}
            >
              + List Video
            </Link>
          </div>
        )}
        
        <WalletAuth />

        {/* Search Bar - Mobile Optimized */}
        <div className="relative">
          <Search className="absolute left-3 sm:left-4 top-3 sm:top-3.5 text-[#8656EF]" size={18} />
          <input 
            value={q} 
            onChange={e => setQ(e.target.value)} 
            placeholder="Search videos..." 
            className="w-full pl-10 sm:pl-12 p-3 sm:p-3.5 bg-[#2D2440]/50 backdrop-blur-sm border border-[#3D3458] rounded-xl focus:ring-2 ring-[#8656EF] text-white placeholder-gray-400 outline-none transition text-sm sm:text-base"
          />
        </div>

        {/* Error / Retry State */}
        {error && (
          <div className="p-3 sm:p-4 bg-red-900/30 border border-red-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-red-200">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
            <button 
              onClick={fetchVideos} 
              className="flex items-center gap-2 bg-[#2D2440] px-4 py-2 rounded-lg hover:bg-[#3D3458] transition text-sm w-full sm:w-auto justify-center"
            >
              <RefreshCw size={14}/> Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && !error && (
          <div className="text-center py-12 sm:py-16">
            <div className="inline-block p-4 rounded-full bg-[#2D2440]">
              <Loader2 className="animate-spin text-[#8656EF]" size={28} />
            </div>
            <p className="text-gray-400 mt-4 text-sm">Discovering watch-worthy content...</p>
          </div>
        )}

        {/* Video Grid - Fully Responsive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-5">
          {videos.map(v => (
            <div key={v.id} className="relative group">
              <Link 
                href={`/watch/${v.id}`} 
                className="block glass-card rounded-xl sm:rounded-2xl overflow-hidden hover:border-[#8656EF]/40 transition-all duration-300 active:scale-[0.99]"
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-gradient-to-br from-[#8656EF]/20 to-[#00C8B3]/20 flex items-center justify-center">
                  <Play size={32} className="text-[#8656EF]/60 group-hover:text-[#8656EF] transition sm:group-hover:scale-110" />
                </div>
                
                <div className="p-3 sm:p-4">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-semibold text-base sm:text-lg text-white line-clamp-1 flex-1">{v.title}</h3>
                    {isCreator(v) && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowDeleteConfirm(v.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex-shrink-0"
                        title="Delete video"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <p className="text-gray-400 text-xs sm:text-sm mt-1 line-clamp-2">{v.description}</p>
                  
                  <div className="mt-3 sm:mt-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[#00C8B3] font-medium text-xs sm:text-sm">
                        <DollarSign size={12} />
                        {v.pricePerChunk.toFixed(6)}
                      </span>
                      <span className="text-gray-500 text-xs">/ {v.chunkDuration}m</span>
                    </div>
                    <span className="flex items-center gap-1 text-gray-400 text-xs">
                      <Clock size={12} />
                      {formatDuration(v.durationSeconds)}
                    </span>
                  </div>
                  
                  {isCreator(v) && (
                    <div className="mt-3">
                      <span className="bg-[#8656EF]/20 text-[#8656EF] text-[10px] sm:text-xs px-2 py-1 rounded-full">
                        Your Content
                      </span>
                    </div>
                  )}
                </div>
              </Link>
              
              {/* Delete Confirmation Modal - Mobile Optimized */}
              {showDeleteConfirm === v.id && (
                <div className="absolute inset-0 glass-card rounded-xl sm:rounded-2xl p-4 sm:p-5 z-10 flex flex-col">
                  <h4 className="font-semibold text-white text-base sm:text-lg mb-2">Delete Video?</h4>
                  <p className="text-xs sm:text-sm text-gray-300 mb-4 flex-1">
                    Permanently delete "{v.title.substring(0, 20)}{v.title.length > 20 ? '...' : ''}"?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(v.id)}
                      disabled={deletingId === v.id}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs sm:text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {deletingId === v.id ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          <span className="hidden sm:inline">Deleting...</span>
                        </>
                      ) : 'Delete'}
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="flex-1 py-2 bg-[#2D2440] hover:bg-[#3D3458] text-white rounded-lg text-xs sm:text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        
        {/* Empty State */}
        {!loading && !error && videos.length === 0 && (
          <div className="text-center py-12 sm:py-16 glass-card rounded-2xl px-4">
            <Play size={40} className="mx-auto mb-4 text-[#8656EF]/40" />
            <p className="text-gray-300 text-base sm:text-lg mb-2">No videos yet</p>
            <p className="text-gray-400 text-sm mb-4">Be the first to share watch-worthy content!</p>
            <Link 
              href="/upload" 
              className="glow-button px-5 py-2.5 text-white rounded-xl font-medium inline-flex items-center gap-2 text-sm"
            >
              + List Video
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}