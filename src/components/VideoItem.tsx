import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Heart,
  MessageCircle,
  Share2,
  Repeat2,
  Bookmark,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Check,
  Music,
  Eye,
  Download,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Flag,
  UserX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoPost } from '../types';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ShareModal } from './ShareModal';
import { ReportModal } from './ReportModal';
import { BlockConfirmModal } from './BlockConfirmModal';
import { useAuth } from '../hooks/useAuth';
import * as videosService from '../services/videosService';
import * as usersService from '../services/usersService';
import * as rewardsService from '../services/rewardsService';
import { downloadReelVideo, isReelDownloading } from '../services/reelDownloadService';
import { cn, getOptimizedCloudinaryVideoUrl, getOptimizedPosterUrl, formatNumber, useRelativeTime } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { perf } from '../utils/perfLogger';

// Session-level cache of Reel URLs that have already buffered playable frames
const bufferedReelUrls = new Set<string>();

export interface VideoItemProps {
  video: VideoPost;
  isActive: boolean;
  isMuted: boolean;
  preloadMode?: 'auto' | 'metadata' | 'none';
  onReadyToPlay?: (videoId: string) => void;
  onToggleMute: () => void;
  onUserClick: (userId: string, videoId?: string) => void;
  onCommentClick: (video: VideoPost) => void;
  onVideoUpdated?: (video: VideoPost) => void;
  onVideoDeleted?: (videoId: string) => void;
}

const VideoItemComponent: React.FC<VideoItemProps> = ({
  video,
  isActive,
  isMuted,
  preloadMode,
  onReadyToPlay,
  onToggleMute,
  onUserClick,
  onCommentClick,
  onVideoUpdated,
  onVideoDeleted,
}) => {
  const { currentUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Progressive streaming & auto format/codec URLs
  const initialOptimizedUrl = getOptimizedCloudinaryVideoUrl(video.videoUrl);
  const optimizedPosterUrl = getOptimizedPosterUrl(video.thumbnailUrl, video.videoUrl);

  const [currentVideoSrc, setCurrentVideoSrc] = useState(initialOptimizedUrl);
  const [hasTriedFallback, setHasTriedFallback] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLiked, setIsLiked] = useState(video.isLiked ?? false);
  const [isBookmarked, setIsBookmarked] = useState(
    () => videosService.isVideoBookmarkedSync(video.id) || Boolean(video.isBookmarked)
  );
  const [likesCount, setLikesCount] = useState(video.likesCount);
  const [commentsCount, setCommentsCount] = useState(video.commentsCount);
  const [repostsCount, setRepostsCount] = useState(video.repostsCount ?? 0);
  const [captionText, setCaptionText] = useState(video.caption || '');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [editCaption, setEditCaption] = useState(video.caption || '');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() => !bufferedReelUrls.has(initialOptimizedUrl));
  const [hasError, setHasError] = useState(false);
  const [showPlayIcon, setShowPlayIcon] = useState(false);
  const [showHeartAnim, setShowHeartAnim] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const downloadResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActiveRef = useRef<boolean>(isActive);
  isActiveRef.current = isActive;
  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;
  const hasInitiatedLoadRef = useRef<boolean>(false);
  const playInFlightRef = useRef<boolean>(false);

  const timingsRef = useRef<{
    loadStartAt?: number;
    preloadStartAt?: number;
    metadataLoadedAt?: number;
    loadedDataAt?: number;
    canPlayAt?: number;
    activeAt?: number;
    playingAt?: number;
  }>({});

  const effectivePreload: 'auto' | 'metadata' | 'none' =
    isActive || preloadMode === 'auto'
      ? 'auto'
      : preloadMode === 'metadata'
      ? 'metadata'
      : 'none';

  // Only attach network media (src & poster) when active or explicitly requested to preload ('metadata'/'auto').
  // When off-screen with preloadMode === 'none', do NOT attach media or download bytes.
  const shouldAttachMedia = isActive || effectivePreload !== 'none';

  useEffect(() => {
    return () => {
      if (downloadResetTimerRef.current) {
        clearTimeout(downloadResetTimerRef.current);
      }
    };
  }, []);

  const authorId = video.userId || video.user?.id;
  const reelTimestamp = (video as any).timestamp || (video as any).created_at || video.createdAt;
  const reelRelativeTime = useRelativeTime(reelTimestamp);
  const isOwnVideo = Boolean(
    currentUser?.id && video.userId && currentUser.id === video.userId
  );

  useEffect(() => {
    setCaptionText(video.caption || '');
    setEditCaption(video.caption || '');
  }, [video.id, video.caption]);

  const handleOpenEdit = () => {
    if (!isOwnVideo) return;
    setEditCaption(captionText);
    setSaveError(null);
    setIsMenuOpen(false);
    setIsEditModalOpen(true);
  };

  const handleOpenDelete = () => {
    if (!isOwnVideo) return;
    setDeleteError(null);
    setIsMenuOpen(false);
    setIsDeleteConfirmOpen(true);
  };

  const handleSaveEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isOwnVideo) return;
    if (!editCaption.trim()) {
      setSaveError('Reel caption cannot be empty.');
      return;
    }

    setIsSavingEdit(true);
    setSaveError(null);

    try {
      const updated = await videosService.updateVideo(video.id, {
        caption: editCaption.trim(),
      });
      setCaptionText(updated.caption);
      onVideoUpdated?.(updated);
      setIsEditModalOpen(false);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!isOwnVideo) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      await videosService.deleteVideo(video.id);
      setIsDeleteConfirmOpen(false);
      onVideoDeleted?.(video.id);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete Reel. Please try again.');
      setIsDeleting(false);
    }
  };

  const [isFollowing, setIsFollowing] = useState<boolean>(() => {
    if (!authorId || isOwnVideo) return false;
    return usersService.isFollowingUser(authorId, currentUser?.id);
  });
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  useEffect(() => {
    if (!authorId || isOwnVideo) return;
    setIsFollowing(usersService.isFollowingUser(authorId, currentUser?.id));

    const handleFollowChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetUserId: string; isFollowing: boolean; actorId: string }>;
      if (customEvent.detail && customEvent.detail.targetUserId === authorId) {
        setIsFollowing(customEvent.detail.isFollowing);
      }
    };

    window.addEventListener('sogo_follow_changed', handleFollowChanged);
    return () => {
      window.removeEventListener('sogo_follow_changed', handleFollowChanged);
    };
  }, [authorId, currentUser?.id, isOwnVideo]);

  const handleFollowToggle = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!authorId || isOwnVideo || isFollowLoading) return;

    setIsFollowLoading(true);
    try {
      const newStatus = await usersService.toggleFollowUser(authorId, currentUser);
      setIsFollowing(newStatus);
    } catch (err) {
      console.error('Failed to toggle follow on video:', err);
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Synchronize internal state when video prop updates without resetting an identical stream URL
  useEffect(() => {
    const nextOptimizedSrc = getOptimizedCloudinaryVideoUrl(video.videoUrl);
    setIsLiked(video.isLiked ?? false);
    setIsBookmarked(videosService.isVideoBookmarkedSync(video.id) || Boolean(video.isBookmarked));
    setLikesCount(video.likesCount);
    setCommentsCount(video.commentsCount);
    setCurrentVideoSrc((prevSrc) => {
      if (prevSrc !== nextOptimizedSrc && prevSrc !== video.videoUrl) {
        hasInitiatedLoadRef.current = false;
        setHasTriedFallback(false);
        return nextOptimizedSrc;
      }
      return prevSrc;
    });
  }, [video.id, video.isLiked, video.isBookmarked, video.likesCount, video.commentsCount, video.videoUrl]);

  useEffect(() => {
    const handleBookmarkChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string; isBookmarked: boolean }>;
      if (customEvent.detail?.videoId === video.id) {
        setIsBookmarked(customEvent.detail.isBookmarked);
      }
    };
    window.addEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    return () => {
      window.removeEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    };
  }, [video.id]);

  // Coordinate progressive preload transitions ('none' -> 'metadata' -> 'auto')
  // without aborting an in-flight HTTP request, and release bandwidth when off-screen.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!shouldAttachMedia) {
      playInFlightRef.current = false;
      hasInitiatedLoadRef.current = false;
      if (!el.paused) {
        el.pause();
      }
      if (el.getAttribute('src')) {
        el.removeAttribute('src');
        try {
          el.load();
        } catch {
          // Ignore reset errors
        }
      }
      return;
    }

    if (effectivePreload === 'metadata') {
      if (el.preload === 'none') {
        el.preload = 'metadata';
      }
      if (
        el.readyState === 0 &&
        el.networkState === HTMLMediaElement.NETWORK_EMPTY &&
        !hasInitiatedLoadRef.current
      ) {
        hasInitiatedLoadRef.current = true;
        try {
          el.load();
        } catch {
          // Ignore load errors
        }
      }
      return;
    }

    if (effectivePreload === 'auto') {
      if (!timingsRef.current.preloadStartAt) {
        timingsRef.current.preloadStartAt = performance.now();
      }
      if (el.preload !== 'auto') {
        el.preload = 'auto';
      }

      if (
        el.readyState === 0 &&
        el.networkState === HTMLMediaElement.NETWORK_EMPTY &&
        !hasInitiatedLoadRef.current
      ) {
        hasInitiatedLoadRef.current = true;
        try {
          el.load();
        } catch {
          // Ignore load errors
        }
      }
    }
  }, [shouldAttachMedia, effectivePreload, currentVideoSrc]);

  // Safe, non-overlapping autoplay helper
  const attemptPlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || !isActiveRef.current) return;
    if (!el.paused) {
      setIsPlaying(true);
      setIsLoading(false);
      onReadyToPlay?.(video.id);
      return;
    }
    if (playInFlightRef.current) return;

    const shouldMute = isMutedRef.current;
    el.defaultMuted = shouldMute;
    el.muted = shouldMute;

    if (el.readyState >= 2) {
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    playInFlightRef.current = true;
    const playPromise = el.play();

    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          playInFlightRef.current = false;
          if (!isActiveRef.current) {
            el.pause();
            setIsPlaying(false);
            return;
          }
          setIsPlaying(true);
          setIsLoading(false);
          onReadyToPlay?.(video.id);
        })
        .catch((err: any) => {
          playInFlightRef.current = false;
          if (!isActiveRef.current) return;

          // If unmuted autoplay was blocked by browser policy, fall back to muted autoplay
          if (err?.name === 'NotAllowedError' && !el.muted) {
            el.defaultMuted = true;
            el.muted = true;
            el.play()
              .then(() => {
                if (isActiveRef.current) {
                  setIsPlaying(true);
                  setIsLoading(false);
                  onReadyToPlay?.(video.id);
                } else {
                  el.pause();
                }
              })
              .catch(() => {
                setIsPlaying(false);
              });
          } else if (el.readyState < 3) {
            // Still buffering initial segment; onLoadedData / onCanPlay will re-invoke attemptPlay
            setIsLoading(true);
          } else {
            console.warn('Video playback notice:', err);
            setIsPlaying(false);
          }
        });
    } else {
      playInFlightRef.current = false;
    }
  }, [video.id, onReadyToPlay]);

  // Autoplay or pause based on isActive
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (isActive) {
      setHasError(false);
      setShowPlayIcon(false);
      timingsRef.current.activeAt = performance.now();

      if (el.readyState >= 2 || bufferedReelUrls.has(currentVideoSrc)) {
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }

      if (el.readyState >= 3 && !el.paused) {
        onReadyToPlay?.(video.id);
      }

      attemptPlay();
    } else {
      playInFlightRef.current = false;
      el.pause();
      setIsPlaying(false);
      setShowPlayIcon(false);
    }
  }, [isActive, attemptPlay, currentVideoSrc, video.id, onReadyToPlay]);

  // Stop playback and halt video buffering immediately when app/screen is backgrounded or hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.hidden) {
        if (!el.paused) {
          el.pause();
          setIsPlaying(false);
        }
      } else if (isActiveRef.current) {
        attemptPlay();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [attemptPlay]);

  // Clean up video element and release network streaming on component unmount
  useEffect(() => {
    return () => {
      const el = videoRef.current;
      if (el) {
        if (!el.paused) {
          el.pause();
        }
        if (el.getAttribute('src')) {
          el.removeAttribute('src');
          try {
            el.load();
          } catch {
            // Ignore reset errors
          }
        }
      }
    };
  }, []);

  // Handle Mute state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.defaultMuted = isMuted;
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Conservative raw view tracking: only after 3s of active playback
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && isPlaying) {
      timer = setTimeout(() => {
        videosService.incrementVideoViews(video.id);
      }, 3000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isActive, isPlaying, video.id]);

  // Dedicated Creator Rewards qualified view tracking:
  // Strict rules: Authenticated viewer, not creator's own video, >= 5s continuous watch.
  // Kept strictly separate from raw viewsCount to protect platform monetization.
  const hasSentRewardTelemetryRef = useRef<boolean>(false);

  useEffect(() => {
    hasSentRewardTelemetryRef.current = false;
  }, [video.id]);

  useEffect(() => {
    let rewardTimer: NodeJS.Timeout;

    const canQualify = Boolean(
      isActive &&
      isPlaying &&
      currentUser?.id &&
      authorId &&
      currentUser.id !== authorId &&
      !hasSentRewardTelemetryRef.current
    );

    if (canQualify) {
      // Minimum 5 seconds continuous playback required for reward qualification
      rewardTimer = setTimeout(() => {
        if (!hasSentRewardTelemetryRef.current && currentUser?.id && authorId) {
          hasSentRewardTelemetryRef.current = true;
          const currentDuration = videoRef.current?.duration || video.duration || 15;
          rewardsService.recordVideoWatchTelemetry(
            {
              sessionId: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              videoId: video.id,
              creatorUid: authorId,
              viewerUid: currentUser.id,
              watchDurationSeconds: 5,
              videoDurationSeconds: currentDuration,
              timestamp: new Date().toISOString(),
              isQualifiedCandidate: true,
            },
            video.caption
          );
        }
      }, 5000);
    }

    return () => {
      if (rewardTimer) clearTimeout(rewardTimer);
    };
  }, [isActive, isPlaying, currentUser?.id, authorId, video.id, video.duration, video.caption]);

  // Toggle play/pause by tapping the video
  const togglePlayPause = () => {
    const el = videoRef.current;
    if (!el) return;

    if (el.paused) {
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
      setShowPlayIcon(false);
    } else {
      el.pause();
      setIsPlaying(false);
      setShowPlayIcon(true);
    }
  };

  // Double tap to like
  const lastTapRef = useRef<number>(0);
  const handleContainerClick = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap triggered
      if (!isLiked && currentUser) {
        handleLike();
      }
      setShowHeartAnim(true);
      setTimeout(() => setShowHeartAnim(false), 800);
    } else {
      togglePlayPause();
    }
    lastTapRef.current = now;
  };

  const handleLike = async () => {
    if (!currentUser) return;
    // Optimistic UI update
    const prevLiked = isLiked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    const nextCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);
    setIsLiked(nextLiked);
    setLikesCount(nextCount);
    if (onVideoUpdated) {
      onVideoUpdated({
        ...video,
        isLiked: nextLiked,
        likesCount: nextCount,
      });
    }

    try {
      const res = await videosService.toggleLikeVideo(
        video.id,
        currentUser.id,
        {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          avatarUrl: currentUser.avatarUrl,
        },
        prevLiked
      );
      setIsLiked(res.isLiked);
      setLikesCount(res.likesCount);
      if (onVideoUpdated) {
        onVideoUpdated({
          ...video,
          isLiked: res.isLiked,
          likesCount: res.likesCount,
        });
      }
    } catch (err) {
      // Rollback on error
      setIsLiked(prevLiked);
      setLikesCount(prevCount);
      if (onVideoUpdated) {
        onVideoUpdated({
          ...video,
          isLiked: prevLiked,
          likesCount: prevCount,
        });
      }
    }
  };

  const handleShare = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setIsShareModalOpen(true);
  };

  const handleBookmark = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const prevBookmarked = isBookmarked;
    const nextBookmarked = !prevBookmarked;
    setIsBookmarked(nextBookmarked);
    onVideoUpdated?.({ ...video, isBookmarked: nextBookmarked });

    try {
      const saved = await videosService.toggleBookmarkVideo(video.id, video);
      setIsBookmarked(saved);
      onVideoUpdated?.({ ...video, isBookmarked: saved });
    } catch {
      setIsBookmarked(prevBookmarked);
      onVideoUpdated?.({ ...video, isBookmarked: prevBookmarked });
    }
  };

  const handleDownload = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (downloadStatus === 'downloading' || isReelDownloading(video.id)) {
      return;
    }

    if (downloadResetTimerRef.current) {
      clearTimeout(downloadResetTimerRef.current);
      downloadResetTimerRef.current = null;
    }

    setDownloadStatus('downloading');
    setDownloadProgress(1);
    setDownloadMessage('Downloading Reel...');

    try {
      await downloadReelVideo(video, {
        onProgress: (pct) => {
          setDownloadProgress(pct);
        },
      });
      setDownloadProgress(100);
      setDownloadStatus('success');
      setDownloadMessage('Reel saved to device ✓');
      downloadResetTimerRef.current = setTimeout(() => {
        setDownloadStatus('idle');
        setDownloadProgress(0);
        setDownloadMessage(null);
      }, 3500);
    } catch (err: any) {
      if (err?.message === 'DOWNLOAD_ALREADY_IN_PROGRESS') {
        return;
      }
      setDownloadStatus('error');
      setDownloadMessage(
        err?.message || "Couldn't download Reel. Please check your connection and try again."
      );
      downloadResetTimerRef.current = setTimeout(() => {
        setDownloadStatus('idle');
        setDownloadProgress(0);
        setDownloadMessage(null);
      }, 4500);
    }
  };

  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (el && el.duration) {
      setProgressPercent((el.currentTime / el.duration) * 100);
    }
  };

  const handleVideoError = () => {
    // If the optimized URL failed, fallback to raw original URL
    if (!hasTriedFallback && currentVideoSrc !== video.videoUrl) {
      console.warn('Optimized video stream failed, falling back to original URL');
      setHasTriedFallback(true);
      hasInitiatedLoadRef.current = true;
      setCurrentVideoSrc(video.videoUrl);
      setIsLoading(true);
      setHasError(false);
      if (videoRef.current) {
        videoRef.current.load();
        if (isActiveRef.current) {
          attemptPlay();
        }
      }
      return;
    }

    setIsLoading(false);
    setHasError(true);
  };

  return (
    <div
      className="relative w-full h-full snap-start snap-always flex items-center justify-center bg-black overflow-hidden select-none"
      onClick={handleContainerClick}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={shouldAttachMedia ? currentVideoSrc : undefined}
        poster={shouldAttachMedia ? optimizedPosterUrl : undefined}
        playsInline
        webkit-playsinline="true"
        x5-playsinline="true"
        loop
        muted={isMuted}
        preload={effectivePreload}
        onLoadStart={() => {
          const now = performance.now();
          timingsRef.current.loadStartAt = now;
          if (!timingsRef.current.preloadStartAt) {
            timingsRef.current.preloadStartAt = now;
          }
          if (isActiveRef.current && (!videoRef.current || videoRef.current.readyState < 2)) {
            setIsLoading(true);
          }
        }}
        onLoadedMetadata={() => {
          const now = performance.now();
          if (!timingsRef.current.metadataLoadedAt) {
            timingsRef.current.metadataLoadedAt = now;
            const start = timingsRef.current.preloadStartAt || timingsRef.current.loadStartAt || now;
            perf.mark('REELS', 'Reel metadata loaded', {
              videoId: video.id,
              preloadToMetadataMs: Math.round(now - start),
            });
          }
          if (isActiveRef.current && videoRef.current && videoRef.current.paused && !showPlayIcon && !playInFlightRef.current) {
            attemptPlay();
          }
        }}
        onLoadedData={() => {
          const now = performance.now();
          bufferedReelUrls.add(currentVideoSrc);
          if (!timingsRef.current.loadedDataAt) {
            timingsRef.current.loadedDataAt = now;
            const start = timingsRef.current.preloadStartAt || timingsRef.current.loadStartAt || now;
            perf.mark('REELS', 'Reel first frame decoded (loadeddata)', {
              videoId: video.id,
              preloadToLoadedDataMs: Math.round(now - start),
              isActive: isActiveRef.current,
            });
          }
          if (isActiveRef.current) {
            setIsLoading(false);
            if (videoRef.current && videoRef.current.paused && !showPlayIcon) {
              playInFlightRef.current = false;
              attemptPlay();
            }
          }
        }}
        onCanPlay={() => {
          const now = performance.now();
          bufferedReelUrls.add(currentVideoSrc);
          if (!timingsRef.current.canPlayAt) {
            timingsRef.current.canPlayAt = now;
            const start = timingsRef.current.preloadStartAt || timingsRef.current.loadStartAt || now;
            perf.mark('REELS', 'Reel canplay ready', {
              videoId: video.id,
              preloadToCanPlayMs: Math.round(now - start),
              isActive: isActiveRef.current,
            });
          }
          if (isActiveRef.current) {
            setIsLoading(false);
            if (videoRef.current && !videoRef.current.paused) {
              onReadyToPlay?.(video.id);
            } else if (videoRef.current && videoRef.current.paused && !showPlayIcon) {
              playInFlightRef.current = false;
              attemptPlay();
            }
          }
        }}
        onPlaying={() => {
          const now = performance.now();
          bufferedReelUrls.add(currentVideoSrc);
          setIsLoading(false);
          setIsPlaying(true);
          onReadyToPlay?.(video.id);

          timingsRef.current.playingAt = now;
          const activeAt = timingsRef.current.activeAt || now;
          const canPlayAt = timingsRef.current.canPlayAt;
          perf.mark('REELS', 'Reel playback started', {
            videoId: video.id,
            activeToPlayStartMs: Math.max(0, Math.round(now - activeAt)),
            preloadedBeforeActive: Boolean(canPlayAt && activeAt && canPlayAt <= activeAt),
          });
        }}
        onWaiting={() => {
          if (isActiveRef.current) {
            setIsLoading(true);
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onError={handleVideoError}
        className="w-full h-full object-contain sm:object-cover"
      />

      {/* Lightweight Progressive Buffering / Loading Indicator */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25 backdrop-blur-[1px] pointer-events-none transition-opacity duration-200 z-10">
          <div className="relative flex items-center justify-center">
            <div className="w-11 h-11 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 animate-spin" />
            <div className="absolute w-5 h-5 rounded-full bg-cyan-400/10 animate-pulse" />
          </div>
          <span className="mt-2 text-[11px] font-medium text-slate-200/80 tracking-wide drop-shadow-sm">
            Buffering...
          </span>
        </div>
      )}

      {/* Error / Fallback State */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-center px-6">
          <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mb-3">
            <RotateCcw className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-white">Video unavailable</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            Could not stream the video.
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHasError(false);
              setIsLoading(true);
              videoRef.current?.load();
              videoRef.current?.play().catch(() => {});
            }}
            className="mt-4 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold text-xs rounded-xl cursor-pointer"
          >
            Retry playback
          </button>
        </div>
      )}

      {/* Big Pause Indicator */}
      {showPlayIcon && !isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white scale-110 animate-in fade-in zoom-in-75 duration-150">
            <Play className="w-8 h-8 fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Double Tap Heart Pop */}
      {showHeartAnim && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <Heart className="w-24 h-24 text-red-500 fill-red-500 animate-ping opacity-90 drop-shadow-2xl" />
        </div>
      )}

      {/* Download Status Banner */}
      {downloadStatus !== 'idle' && downloadMessage && (
        <div
          className="absolute top-14 inset-x-4 z-30 flex justify-center pointer-events-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 shadow-xl backdrop-blur-md border ${
              downloadStatus === 'downloading'
                ? 'bg-slate-950/85 border-cyan-500/50 text-cyan-300'
                : downloadStatus === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                : 'bg-rose-950/90 border-rose-500/50 text-rose-300'
            }`}
          >
            {downloadStatus === 'downloading' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                <span>
                  {downloadMessage} {downloadProgress > 0 ? `${downloadProgress}%` : ''}
                </span>
              </>
            ) : downloadStatus === 'success' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{downloadMessage}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>{downloadMessage}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Right Action Bar */}
      <div
        className="reel-action-bar absolute right-3 bottom-20 z-20 flex flex-col items-center gap-3.5 sm:gap-4 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Author Avatar */}
        <div
          className="relative group cursor-pointer"
          onClick={() => {
            videosService.primeVideoInCache(video);
            onUserClick(authorId, video.id);
          }}
        >
          <div className="p-0.5 rounded-full ring-2 ring-cyan-400 shadow-lg shadow-black/50">
            <Avatar
              src={video.user.avatarUrl}
              alt={video.user.displayName}
              size="sm"
            />
          </div>
          {!isOwnVideo && !isFollowing && currentUser && (
            <button
              type="button"
              id={`video-avatar-follow-btn-${video.id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleFollowToggle(e);
              }}
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-full flex items-center justify-center text-[10px] font-black shadow-md transition-transform hover:scale-110 active:scale-95 cursor-pointer"
              aria-label={`Follow @${video.user.username}`}
            >
              +
            </button>
          )}
        </div>

        {/* Like Button */}
        <button
          type="button"
          onClick={handleLike}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer"
          aria-label={isLiked ? 'Unlike' : 'Like'}
        >
          <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 shadow-md shadow-black/30 flex items-center justify-center text-white group-hover:scale-110 active:scale-95 transition-all duration-150">
            <Heart
              className={cn(
                'w-5 h-5 transition-colors duration-150 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]',
                isLiked
                  ? 'text-rose-500 fill-rose-500'
                  : 'text-white stroke-[2px]'
              )}
            />
          </div>
          <span className="text-[11px] font-semibold text-white mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] tracking-tight">
            {formatNumber(likesCount)}
          </span>
        </button>

        {/* Comments Button */}
        <button
          type="button"
          onClick={() => onCommentClick(video)}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer"
          aria-label="Comments"
        >
          <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 shadow-md shadow-black/30 flex items-center justify-center text-white group-hover:scale-110 active:scale-95 transition-all duration-150">
            <MessageCircle className="w-5 h-5 text-white stroke-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
          </div>
          <span className="text-[11px] font-semibold text-white mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] tracking-tight">
            {formatNumber(commentsCount)}
          </span>
        </button>

        {/* Download Button */}
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloadStatus === 'downloading'}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer disabled:opacity-75"
          aria-label="Download Reel"
        >
          <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 shadow-md shadow-black/30 flex items-center justify-center text-white group-hover:scale-110 active:scale-95 transition-all duration-150">
            {downloadStatus === 'downloading' ? (
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            ) : downloadStatus === 'success' ? (
              <Check className="w-5 h-5 text-emerald-400 stroke-[2.2px]" />
            ) : downloadStatus === 'error' ? (
              <AlertCircle className="w-5 h-5 text-rose-400 stroke-[2px]" />
            ) : (
              <Download className="w-5 h-5 text-white stroke-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
            )}
          </div>
        </button>

        {/* Save / Bookmark Button */}
        <button
          type="button"
          onClick={handleBookmark}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer"
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark post'}
        >
          <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 shadow-md shadow-black/30 flex items-center justify-center text-white group-hover:scale-110 active:scale-95 transition-all duration-150">
            <Bookmark
              className={cn(
                'w-5 h-5 transition-colors duration-150 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]',
                isBookmarked
                  ? 'text-amber-400 fill-amber-400 stroke-[2px]'
                  : 'text-white stroke-[2px]'
              )}
            />
          </div>
        </button>

        {/* Share Button */}
        <button
          type="button"
          onClick={handleShare}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer"
          aria-label="Share"
        >
          <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 shadow-md shadow-black/30 flex items-center justify-center text-white group-hover:scale-110 active:scale-95 transition-all duration-150">
            {copiedLink ? (
              <Check className="w-5 h-5 text-emerald-400 stroke-[2.2px]" />
            ) : (
              <Share2 className="w-5 h-5 text-white stroke-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
            )}
          </div>
        </button>

        {/* Mute/Unmute Button */}
        <button
          type="button"
          onClick={onToggleMute}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          <div
            className={cn(
              'w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border flex items-center justify-center group-hover:scale-110 active:scale-95 transition-all duration-150 shadow-md shadow-black/30',
              isMuted
                ? 'border-white/15 text-white/90'
                : 'border-cyan-400/50 text-cyan-400 shadow-cyan-500/20'
            )}
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 stroke-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
            ) : (
              <Volume2 className="w-5 h-5 stroke-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
            )}
          </div>
        </button>

        {/* Three-Dot Options Menu Button */}
        <button
          type="button"
          id={`reel-menu-btn-${video.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(true);
          }}
          className="reel-action-btn flex flex-col items-center group focus:outline-none cursor-pointer"
          aria-label="Reel options menu"
          aria-expanded={isMenuOpen}
        >
          <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 shadow-md shadow-black/30 flex items-center justify-center text-white group-hover:scale-110 active:scale-95 transition-all duration-150">
            <MoreHorizontal className="w-5 h-5 text-white stroke-[2px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
          </div>
        </button>
      </div>

      {/* Bottom Information Overlay */}
      <div
        className="absolute left-0 right-16 bottom-5 z-20 px-4 flex flex-col pointer-events-none"
      >
        <div className="pointer-events-auto">
          {/* Username, Relative Upload Time & Follow Button */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => {
                  videosService.primeVideoInCache(video);
                  onUserClick(authorId, video.id);
                }}
                className="text-sm font-extrabold text-white hover:text-cyan-400 transition-colors drop-shadow-md flex items-center gap-1.5 cursor-pointer text-left truncate"
              >
                <span className="truncate">@{video.user.username}</span>
                <VerifiedBadge
                  userId={video.user.id || video.userId}
                  username={video.user.username}
                  isVerified={video.user.isVerified}
                  size="sm"
                />
              </button>

              {reelRelativeTime && (
                <>
                  <span className="text-xs font-semibold text-slate-300/80 drop-shadow-md shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <time
                    dateTime={typeof reelTimestamp === 'string' ? reelTimestamp : undefined}
                    className="text-xs font-semibold text-slate-200/90 drop-shadow-md whitespace-nowrap shrink-0"
                  >
                    {reelRelativeTime}
                  </time>
                </>
              )}
            </div>

            {!isOwnVideo && currentUser && (
              <Button
                type="button"
                id={`video-follow-btn-${video.id}`}
                variant={isFollowing ? 'secondary' : 'primary'}
                size="sm"
                isLoading={isFollowLoading}
                onClick={handleFollowToggle}
                className="text-xs px-2.5 py-0.5 rounded-full min-h-[26px] h-6 font-semibold shrink-0 shadow-md touch-manipulation"
                aria-label={isFollowing ? `Unfollow @${video.user.username}` : `Follow @${video.user.username}`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Button>
            )}
          </div>

          {/* Caption */}
          {captionText && (
            <p className="text-xs text-slate-100 mt-1 line-clamp-3 leading-relaxed drop-shadow-md font-medium">
              {captionText}
            </p>
          )}

          {/* Audio Track & Total Views Indicator */}
          <div className="flex items-center gap-3 mt-2 flex-wrap drop-shadow-md">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-medium">
              <Music className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="truncate max-w-[180px]">Original audio - {video.user.displayName}</span>
            </div>

            {/* Total Views for Reel */}
            <div
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-300 font-mono tracking-tight bg-black/40 backdrop-blur-xs px-1.5 py-0.5 rounded"
              title={`${Number(video.viewsCount || 0).toLocaleString()} views`}
              aria-label={`${Number(video.viewsCount || 0).toLocaleString()} views`}
            >
              <Eye className="w-3.5 h-3.5 text-cyan-400 stroke-[2]" />
              <span>{formatNumber(Number(video.viewsCount) || 0)} views</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Progress Bar */}
      <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20 z-20 pointer-events-none">
        <div
          className="h-full bg-cyan-400 transition-all duration-100"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Share Menu Modal (Share to Sogo / Share to other apps / Copy link) */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        targetType="video"
        video={{ ...video, caption: captionText }}
        onRepostSuccess={() => {
          const next = repostsCount + 1;
          setRepostsCount(next);
          onVideoUpdated?.({ ...video, caption: captionText, repostsCount: next, isReposted: true });
        }}
        onRepostRemoved={() => {
          const next = Math.max(0, repostsCount - 1);
          setRepostsCount(next);
          onVideoUpdated?.({ ...video, caption: captionText, repostsCount: next, isReposted: false });
        }}
        onCopied={() => {
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2000);
        }}
      />

      {/* Three-Dot Action Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            />

            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative z-10 w-full sm:max-w-sm bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-2 mb-0 sm:mb-auto"
            >
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-3 sm:hidden" />

              <div className="text-center pb-2 border-b border-slate-800/80">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Reel Options
                </span>
              </div>

              {isOwnVideo ? (
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    id={`edit-reel-btn-${video.id}`}
                    onClick={handleOpenEdit}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 shrink-0">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <span>Edit Reel</span>
                  </button>

                  <button
                    type="button"
                    id={`share-own-reel-btn-${video.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsShareModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span>Share Reel</span>
                  </button>

                  <button
                    type="button"
                    id={`delete-reel-btn-${video.id}`}
                    onClick={handleOpenDelete}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <span>Delete Reel</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    id={`share-reel-menu-btn-${video.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsShareModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span>Share Reel</span>
                  </button>

                  <button
                    type="button"
                    id={`report-reel-btn-${video.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsReportModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                      <Flag className="w-4 h-4" />
                    </div>
                    <span>Report Reel</span>
                  </button>

                  <button
                    type="button"
                    id={`block-user-reel-btn-${video.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsBlockModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                      <UserX className="w-4 h-4" />
                    </div>
                    <span>Block @{video.user?.username || 'User'}</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                id={`cancel-reel-menu-btn-${video.id}`}
                onClick={() => setIsMenuOpen(false)}
                className="w-full py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 active:bg-slate-700 transition-colors mt-2 border border-slate-750 focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Reel Modal */}
      <AnimatePresence>
        {isOwnVideo && isEditModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSavingEdit && setIsEditModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-xs"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <Pencil className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-base text-white">Edit Reel</h3>
                </div>
                <button
                  type="button"
                  onClick={() => !isSavingEdit && setIsEditModalOpen(false)}
                  disabled={isSavingEdit}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none disabled:opacity-50"
                  aria-label="Close edit modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="p-4 sm:p-5 space-y-4">
                {saveError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{saveError}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                  {optimizedPosterUrl ? (
                    <img
                      src={optimizedPosterUrl}
                      alt="Reel thumbnail"
                      className="w-12 h-16 object-cover rounded-lg shrink-0 border border-slate-700"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">
                      {video.user.displayName}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      @{video.user.username}
                    </p>
                    {reelRelativeTime && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Published {reelRelativeTime === 'Just now' ? 'just now' : `${reelRelativeTime} ago`}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`edit-reel-caption-${video.id}`}
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Reel Caption / Description
                  </label>
                  <textarea
                    id={`edit-reel-caption-${video.id}`}
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    rows={4}
                    placeholder="Write a caption..."
                    disabled={isSavingEdit}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 transition-colors resize-none"
                  />
                  <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                    <span>Hashtags supported</span>
                    <span>{editCaption.length} characters</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    disabled={isSavingEdit}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 min-h-[44px] touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    id={`save-reel-edit-btn-${video.id}`}
                    disabled={isSavingEdit || !editCaption.trim()}
                    className="px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 active:scale-98 rounded-xl shadow-md shadow-cyan-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] touch-manipulation"
                  >
                    {isSavingEdit ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Reel Confirmation Dialog */}
      <AnimatePresence>
        {isOwnVideo && isDeleteConfirmOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setIsDeleteConfirmOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-xs"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative z-10 w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl text-center"
            >
              <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-3.5 text-rose-400 shadow-inner">
                <Trash2 className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-bold text-white mb-1.5">
                Delete Reel?
              </h3>
              <p className="text-xs text-slate-400 mb-5 leading-relaxed px-2">
                Are you sure you want to permanently delete this Reel? This action will remove it from Sogo and cannot be undone.
              </p>

              {deleteError && (
                <div className="mb-4 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-1.5 text-left">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  id={`confirm-delete-reel-btn-${video.id}`}
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px] touch-manipulation cursor-pointer"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Deleting Reel...</span>
                    </>
                  ) : (
                    <span>Delete Reel</span>
                  )}
                </button>

                <button
                  type="button"
                  id={`cancel-delete-reel-btn-${video.id}`}
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  disabled={isDeleting}
                  className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-750 active:bg-slate-700 text-slate-300 font-medium text-xs rounded-xl transition-colors disabled:opacity-50 min-h-[44px] touch-manipulation cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Moderation & Block Dialogs */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetType="video"
        targetId={video.id}
        targetAuthorId={video.userId || video.user?.id || ''}
        targetAuthorUsername={video.user?.username}
        targetTitleOrCaption={video.caption}
      />

      <BlockConfirmModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        targetUserId={video.userId || video.user?.id || ''}
        targetUsername={video.user?.username}
        targetDisplayName={video.user?.displayName}
        targetAvatarUrl={video.user?.avatarUrl}
        onBlockedSuccess={() => {
          onVideoDeleted?.(video.id);
        }}
      />
    </div>
  );
};

export const VideoItem = React.memo(VideoItemComponent);

