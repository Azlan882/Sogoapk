import React, { useState, useEffect } from 'react';
import {
  Search,
  Play,
  Trash2,
  AlertTriangle,
  Eye,
  Heart,
  MessageCircle,
  Clock,
  DollarSign,
  ExternalLink,
  ShieldAlert,
  Film,
  CheckCircle,
  Sparkles,
} from 'lucide-react';
import { AdminVideoRecord } from '../../types/admin';
import { adminService } from '../../services/adminService';
import { AdminTestingToolsModal } from './AdminTestingToolsModal';
import { registerBackInterceptor } from '../../services/backButtonService';

interface AdminVideosTabProps {
  videos: AdminVideoRecord[];
  loading: boolean;
  onRefresh: () => void;
}

export const AdminVideosTab: React.FC<AdminVideosTabProps> = ({
  videos,
  loading,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'suspicious' | 'high_views'>('all');
  const [activeVideo, setActiveVideo] = useState<AdminVideoRecord | null>(null);
  const [deleteModal, setDeleteModal] = useState<AdminVideoRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testingTarget, setTestingTarget] = useState<AdminVideoRecord | null>(null);

  // Intercept back button for open modals in Admin Videos
  useEffect(() => {
    if (!activeVideo && !deleteModal && !testingTarget) return;

    return registerBackInterceptor(() => {
      if (activeVideo) {
        setActiveVideo(null);
        return true;
      }
      if (deleteModal) {
        setDeleteModal(null);
        return true;
      }
      if (testingTarget) {
        setTestingTarget(null);
        return true;
      }
      return false;
    });
  }, [activeVideo, deleteModal, testingTarget]);

  const filteredVideos = videos.filter((v) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      v.caption?.toLowerCase().includes(term) ||
      v.user?.username?.toLowerCase().includes(term) ||
      v.user?.displayName?.toLowerCase().includes(term) ||
      v.id?.toLowerCase().includes(term);

    if (!matchesSearch) return false;

    if (filter === 'suspicious') return Boolean(v.isSuspicious);
    if (filter === 'high_views') return (Number(v.viewsCount) || 0) >= 100;
    return true;
  });

  const handleDeleteVideo = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await adminService.deleteVideo(
        deleteModal.id,
        deleteReason.trim() || 'Administrative moderation removal'
      );
      setDeleteModal(null);
      setDeleteReason('');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete video.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by caption, creator username, or video ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(['all', 'suspicious', 'high_views'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors cursor-pointer ${
                filter === f
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Summary count */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          Showing <strong className="text-white">{filteredVideos.length}</strong> of{' '}
          <strong className="text-white">{videos.length}</strong> video publications
        </span>
      </div>

      {/* Videos Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 rounded-xl border border-slate-800 bg-slate-900/40">
          Loading video publications...
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="p-12 text-center text-slate-500 rounded-xl border border-slate-800 bg-slate-900/40">
          No videos found matching your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVideos.map((video) => {
            const views = Number(video.viewsCount) || 0;
            const likes = Number(video.likesCount) || 0;
            const comments = Number(video.commentsCount) || 0;
            const rewardEstCents = Math.floor((views / 1000) * 50);

            return (
              <div
                key={video.id}
                className="rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all overflow-hidden flex flex-col justify-between group shadow-sm"
              >
                <div>
                  {/* Video Thumbnail & Duration */}
                  <div className="relative aspect-[9/12] bg-slate-950 overflow-hidden">
                    <img
                      src={video.thumbnailUrl || video.videoUrl}
                      alt={video.caption}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-black/40" />

                    {/* Play Button Overlay */}
                    <button
                      type="button"
                      onClick={() => setActiveVideo(video)}
                      className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-cyan-500/80 hover:bg-cyan-500 text-slate-950 flex items-center justify-center shadow-lg transition-transform hover:scale-110 cursor-pointer"
                      title="Play Video in Preview Modal"
                    >
                      <Play className="w-5 h-5 fill-slate-950 ml-0.5" />
                    </button>

                    {/* Duration badge */}
                    <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded text-[10px] font-bold bg-black/70 text-slate-200 backdrop-blur-sm">
                      {video.duration ? `${Math.round(video.duration)}s` : '0s'}
                    </div>

                    {/* Suspicious Alert */}
                    {video.isSuspicious && (
                      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/90 text-slate-950 backdrop-blur-sm flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Suspicious</span>
                      </div>
                    )}

                    {/* Bottom overlay stats */}
                    <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-xs text-slate-200">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5 text-cyan-400" />
                          <strong className="text-white">{views.toLocaleString()}</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="w-3.5 h-3.5 text-rose-400" />
                          <span>{likes}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
                          <span>{comments}</span>
                        </span>
                      </div>

                      <span className="text-[11px] font-bold text-emerald-400">
                        ${(rewardEstCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Video Metadata */}
                  <div className="p-3.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={video.user?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
                        alt={video.user?.displayName}
                        className="w-6 h-6 rounded-full object-cover border border-slate-700 shrink-0"
                      />
                      <span className="text-xs font-bold text-white truncate">
                        @{video.user?.username || 'creator'}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-auto">
                        {video.createdAt ? new Date(video.createdAt).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2">
                      {video.caption || 'No caption provided.'}
                    </p>

                    {video.suspiciousReason && (
                      <div className="text-[11px] text-amber-400 bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
                        {video.suspiciousReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-slate-500 truncate max-w-[140px]">
                    ID: {video.id}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTestingTarget(video)}
                      className="px-2 py-1 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1"
                      title="Admin Test Tools (Views, Likes, Comments)"
                    >
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span>Test Tools</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveVideo(video)}
                      className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteModal(video)}
                      className="p-1.5 rounded text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
                      title="Moderate / Delete Video"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Video Preview Modal */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-3">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Video Playback Preview</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="text-slate-400 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="px-4">
              <div className="relative aspect-[9/16] max-h-[480px] mx-auto rounded-xl overflow-hidden bg-black flex items-center justify-center">
                <video
                  src={activeVideo.videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            <div className="p-4 space-y-2 bg-slate-950 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">@{activeVideo.user?.username}</span>
                <span className="text-slate-400">{activeVideo.duration ? `${Math.round(activeVideo.duration)}s` : 'Unknown duration'}</span>
              </div>
              <p className="text-slate-300">{activeVideo.caption}</p>
              <div className="font-mono text-[10px] text-slate-500 break-all">
                URL: {activeVideo.videoUrl}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Delete / Moderation Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete & Moderate Video</h3>
                <p className="text-xs text-slate-400">Target ID: {deleteModal.id}</p>
              </div>
            </div>

            <p className="text-xs text-slate-300">
              Removing this video will immediately take it down from the public Reels feed and creator profile.
              The operation is logged in the admin audit history.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Removal Reason (Required for audit log)
              </label>
              <textarea
                rows={3}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="e.g. Copyright infringement, community violation, or fraudulent video views..."
                className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-xs text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteModal(null);
                  setErrorMsg(null);
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteVideo}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete Video'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Admin Testing Tools Modal */}
      {testingTarget && (
        <AdminTestingToolsModal
          isOpen={Boolean(testingTarget)}
          onClose={() => setTestingTarget(null)}
          onRefresh={onRefresh}
          initialTool="views"
          initialTargetType="video"
          initialTargetId={testingTarget.id}
          initialTargetTitle={testingTarget.caption || `Video ${testingTarget.id.slice(0, 8)}`}
          videos={videos}
        />
      )}
    </div>
  );
};
