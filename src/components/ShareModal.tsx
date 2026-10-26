import React, { useState, useEffect } from 'react';
import { Post, VideoPost } from '../types';
import { Repeat2, Share2, Link2, Check, X, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import * as postsService from '../services/postsService';
import {
  getPostShareUrl,
  getVideoShareUrl,
  sharePost,
  shareVideo,
  copyUrlToClipboard,
} from '../services/shareService';

export interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'post' | 'video';
  post?: Post;
  video?: VideoPost;
  onRepostSuccess?: (repostItem: Post) => void;
  onRepostRemoved?: (repostId: string) => void;
  onCopied?: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  targetType,
  post,
  video,
  onRepostSuccess,
  onRepostRemoved,
  onCopied,
}) => {
  const { currentUser } = useAuth();
  const [isReposting, setIsReposting] = useState(false);
  const [alreadyReposted, setAlreadyReposted] = useState(false);
  const [copiedState, setCopiedState] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const canonicalPostId =
    targetType === 'post' && post ? post.originalPostId || post.id : undefined;
  const canonicalVideoId =
    targetType === 'video'
      ? video?.id
      : post?.repostType === 'video'
      ? post.originalVideoId
      : undefined;

  const effectiveType: 'post' | 'video' = canonicalVideoId ? 'video' : 'post';

  useEffect(() => {
    if (!isOpen) {
      setStatusMessage(null);
      setCopiedState(false);
      setIsReposting(false);
      return;
    }

    if (!currentUser?.id) {
      setAlreadyReposted(false);
      return;
    }

    // 1. Immediate 0ms synchronous check from memory / local cache (no button blocking!)
    if (effectiveType === 'video' && canonicalVideoId) {
      setAlreadyReposted(
        Boolean(video?.isReposted) ||
          postsService.hasUserRepostedVideoSync(canonicalVideoId, currentUser.id)
      );
    } else if (canonicalPostId) {
      setAlreadyReposted(
        Boolean(post?.isReposted) ||
          postsService.hasUserRepostedPostSync(canonicalPostId, currentUser.id)
      );
    }

    // 2. Non-blocking background sync with Firestore if not yet in local cache
    let cancelled = false;
    async function syncRemoteRepostStatus() {
      if (!currentUser?.id) return;
      try {
        if (effectiveType === 'video' && canonicalVideoId) {
          const exists = await postsService.hasUserRepostedVideo(canonicalVideoId, currentUser.id);
          if (!cancelled) setAlreadyReposted(exists);
        } else if (canonicalPostId) {
          const exists = await postsService.hasUserRepostedPost(canonicalPostId, currentUser.id);
          if (!cancelled) setAlreadyReposted(exists);
        }
      } catch {
        // Ignore background check error
      }
    }

    syncRemoteRepostStatus();
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentUser?.id, effectiveType, canonicalPostId, canonicalVideoId, post?.isReposted, video?.isReposted]);

  const handleShareToSogo = async () => {
    if (!currentUser) {
      setStatusMessage({
        type: 'error',
        text: 'Please sign in to share posts and Reels to your Sogo timeline.',
      });
      return;
    }

    if (alreadyReposted) {
      setStatusMessage({
        type: 'error',
        text: 'You have already reposted this to your Sogo timeline.',
      });
      return;
    }

    setIsReposting(true);
    setStatusMessage(null);

    try {
      if (effectiveType === 'video' && canonicalVideoId) {
        const createdRepost = await postsService.repostVideoToSogo(
          canonicalVideoId,
          currentUser,
          video
        );
        // Only mark Reposted AFTER Firestore setDoc has succeeded and returned the confirmed reference
        setAlreadyReposted(true);
        setStatusMessage({
          type: 'success',
          text: 'Reposted',
        });
        onRepostSuccess?.(createdRepost);
        setTimeout(() => {
          onClose();
        }, 450);
      } else if (canonicalPostId) {
        const createdRepost = await postsService.repostPostToSogo(
          canonicalPostId,
          currentUser,
          post
        );
        // Only mark Reposted AFTER Firestore setDoc has succeeded and returned the confirmed reference
        setAlreadyReposted(true);
        setStatusMessage({
          type: 'success',
          text: 'Reposted',
        });
        onRepostSuccess?.(createdRepost);
        setTimeout(() => {
          onClose();
        }, 450);
      }
    } catch (err: any) {
      setAlreadyReposted(false);
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Could not repost to Sogo. Please try again.',
      });
    } finally {
      setIsReposting(false);
    }
  };

  const handleRemoveRepost = async () => {
    if (!currentUser) return;
    setIsReposting(true);
    setStatusMessage(null);
    try {
      const repostId =
        effectiveType === 'video' && canonicalVideoId
          ? `repost_video_${canonicalVideoId}_${currentUser.id}`
          : canonicalPostId
          ? `repost_post_${canonicalPostId}_${currentUser.id}`
          : '';
      if (repostId) {
        await postsService.removeRepostFromSogo(repostId);
        setAlreadyReposted(false);
        setStatusMessage({
          type: 'success',
          text: 'Removed from your Sogo timeline.',
        });
        onRepostRemoved?.(repostId);
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Could not remove repost.',
      });
    } finally {
      setIsReposting(false);
    }
  };

  const handleExternalShare = async () => {
    if (effectiveType === 'video' && canonicalVideoId) {
      const targetVideo = video || {
        id: canonicalVideoId,
        caption: post?.caption || '',
        user: post?.user,
      };
      await shareVideo(targetVideo, {
        onSuccess: () => onClose(),
        onCopied: () => {
          setCopiedState(true);
          onCopied?.();
          setTimeout(() => onClose(), 800);
        },
      });
    } else if (post && canonicalPostId) {
      await sharePost(post, {
        onSuccess: () => onClose(),
        onCopied: () => {
          setCopiedState(true);
          onCopied?.();
          setTimeout(() => onClose(), 800);
        },
      });
    }
  };

  const handleCopyLink = async () => {
    const shareUrl =
      effectiveType === 'video' && canonicalVideoId
        ? getVideoShareUrl(canonicalVideoId)
        : canonicalPostId
        ? getPostShareUrl(canonicalPostId)
        : '';

    if (!shareUrl) return;

    const ok = await copyUrlToClipboard(shareUrl);
    if (ok) {
      setCopiedState(true);
      onCopied?.();
      setStatusMessage({
        type: 'success',
        text: 'Public link copied to clipboard!',
      });
      setTimeout(() => {
        onClose();
      }, 900);
    } else {
      setStatusMessage({
        type: 'error',
        text: 'Failed to copy link.',
      });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
          />

          {/* Modal Sheet */}
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative z-10 w-full sm:max-w-sm bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-2.5"
          >
            {/* Mobile grab handle */}
            <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-2 sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Share {effectiveType === 'video' ? 'Reel' : 'Post'}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none cursor-pointer"
                aria-label="Close share menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {statusMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                {statusMessage.type === 'success' ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              {/* 1. Share to Sogo (Internal Timeline Repost) */}
              <button
                type="button"
                onClick={handleShareToSogo}
                disabled={isReposting || alreadyReposted}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-left transition-colors focus:outline-none min-h-[52px] touch-manipulation cursor-pointer ${
                  alreadyReposted
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 cursor-default'
                    : 'hover:bg-slate-800 active:bg-slate-750 text-white border border-transparent'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    alreadyReposted
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-cyan-500/15 text-cyan-400'
                  }`}
                >
                  {isReposting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : alreadyReposted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Repeat2 className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold leading-tight">
                    {alreadyReposted ? 'Shared to Sogo' : 'Share to Sogo'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {alreadyReposted
                      ? 'Already reposted on your Sogo timeline'
                      : `Repost to your Sogo Home feed`}
                  </div>
                </div>
              </button>

              {/* Option to undo repost if already shared by current user */}
              {alreadyReposted && currentUser && (
                <button
                  type="button"
                  onClick={handleRemoveRepost}
                  disabled={isReposting}
                  className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-left hover:bg-rose-500/10 text-rose-400 transition-colors focus:outline-none cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold leading-tight">Remove Sogo Repost</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      Remove this repost from your Home feed
                    </div>
                  </div>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 transition-colors mt-1 focus:outline-none min-h-[42px] touch-manipulation cursor-pointer"
            >
              Cancel
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
