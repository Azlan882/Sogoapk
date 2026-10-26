import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  Film,
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  Eye,
  Volume2,
  VolumeX,
  Play,
  Download,
  Loader2,
  Check,
  AlertCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Share2,
  Flag,
  UserX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoPost } from '../types';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ShareModal } from './ShareModal';
import { VideoCommentsDrawer } from './VideoCommentsDrawer';
import { ReportModal } from './ReportModal';
import { BlockConfirmModal } from './BlockConfirmModal';
import { useAuth } from '../hooks/useAuth';
import * as videosService from '../services/videosService';
import * as usersService from '../services/usersService';
import * as rewardsService from '../services/rewardsService';
import * as postsService from '../services/postsService';
import { downloadReelVideo, isReelDownloading } from '../services/reelDownloadService';
import { perf } from '../utils/perfLogger';
import { VerifiedBadge } from './VerifiedBadge';
import {
  cn,
  formatNumber,
  getOptimizedCloudinaryVideoUrl,
  getOptimizedPosterUrl,
  useRelativeTime,
} from '../lib/utils';

// Session-level set of video stream URLs that have already buffered playable frames.
// Allows instant reuse when scrolling back or returning to Home without re-fetching.
const bufferedHomeReelUrls = new Set<string>();

export interface HomeFeedReelCardProps {
  video: VideoPost;
  isActive: boolean;
  isMuted: boolean;
  preloadHint?: 'auto' | 'metadata' | 'none';
  onToggleMute: () => void;
  onVisibilityChange: (videoId: string, isVisible: boolean, ratio: number) => void;
  onPreloadZoneChange?: (videoId: string, inPreloadZone: boolean) => void;
  onOpenReel: (videoId: string) => void;
  onUserClick: (userId: string) => void;
  onVideoUpdated?: (updated: VideoPost) => void;
  onVideoDeleted?: (videoId: string) => void;
}

export const HomeFeedReelCard: React.FC<HomeFeedReelCardProps> = ({
  video,
  isActive,
  isMuted,
  preloadHint = 'none',
  onToggleMute,
  onVisibilityChange,
  onPreloadZoneChange,
  onOpenReel,
  onUserClick,
  onVideoUpdated,
  onVideoDeleted,
}) => {
  const { currentUser } = useAuth();
  const cardRef = useRef<HTMLElement | null>(null);
  const videoViewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [currentVideo, setCurrentVideo] = useState<VideoPost>(video);
  const [currentVideoSrc, setCurrentVideoSrc] = useState(() =>
    getOptimizedCloudinaryVideoUrl(video.videoUrl)
  );
  const [hasTriedFallback, setHasTriedFallback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isInMetadataZone, setIsInMetadataZone] = useState<boolean>(() =>
    bufferedHomeReelUrls.has(getOptimizedCloudinaryVideoUrl(video.videoUrl))
  );
  const [isInPreloadZone, setIsInPreloadZone] = useState<boolean>(() =>
    bufferedHomeReelUrls.has(getOptimizedCloudinaryVideoUrl(video.videoUrl))
  );
  const [isLiked, setIsLiked] = useState<boolean>(Boolean(video.isLiked));
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    () => videosService.isVideoBookmarkedSync(video.id) || Boolean(video.isBookmarked)
  );
  const [likesCount, setLikesCount] = useState<number>(Number(video.likesCount) || 0);
  const [commentsCount, setCommentsCount] = useState<number>(Number(video.commentsCount) || 0);
  const [viewsCount, setViewsCount] = useState<number>(Number(video.viewsCount) || 0);
  const [repostsCount, setRepostsCount] = useState<number>(Number(video.repostsCount) || 0);
  const [isReposted, setIsReposted] = useState<boolean>(() =>
    currentUser?.id
      ? postsService.hasUserRepostedVideoSync(video.id, currentUser.id)
      : Boolean(video.isReposted)
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
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
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const downloadResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (downloadResetTimerRef.current) {
        clearTimeout(downloadResetTimerRef.current);
      }
    };
  }, []);

  // Refs for coordinating non-overlapping play() calls, single load() trigger, and timing telemetry
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
    visibleAt?: number;
    playingAt?: number;
  }>({});

  const authorId = currentVideo.userId || currentVideo.user?.id;
  const isOwnVideo = Boolean(
    currentUser?.id && currentVideo.userId && currentUser.id === currentVideo.userId
  );

  const handleOpenEdit = () => {
    if (!isOwnVideo) return;
    setEditCaption(currentVideo.caption || '');
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
      const updated = await videosService.updateVideo(currentVideo.id, {
        caption: editCaption.trim(),
      });
      setCurrentVideo(updated);
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
      await videosService.deleteVideo(currentVideo.id);
      setIsDeleteConfirmOpen(false);
      onVideoDeleted?.(currentVideo.id);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete Reel. Please try again.');
      setIsDeleting(false);
    }
  };

  const reelTimestamp =
    (currentVideo as any).timestamp ||
    (currentVideo as any).created_at ||
    currentVideo.createdAt;
  const relativeUploadTime = useRelativeTime(reelTimestamp);
  const optimizedPosterUrl = getOptimizedPosterUrl(
    currentVideo.thumbnailUrl,
    currentVideo.videoUrl
  );

  // Compute effective preload mode:
  // - 'auto' when active, inside the inner approaching preload zone, already buffered in session, or explicitly hinted as 'auto'
  // - 'metadata' when inside the outer approaching zone or hinted as nearby ('metadata')
  // - 'none' for distant off-screen Reels so multiple videos never compete for bandwidth simultaneously
  const effectivePreload: 'auto' | 'metadata' | 'none' =
    isActive || preloadHint === 'auto'
      ? 'auto'
      : isInPreloadZone
      ? 'auto'
      : isInMetadataZone || preloadHint === 'metadata'
      ? 'metadata'
      : 'none';

  // Only attach network media (src & poster) when active or in an active preload zone.
  // Distant off-screen reels release media to conserve bandwidth.
  const shouldAttachMedia = isActive || effectivePreload !== 'none';

  // Sync with updated prop without resetting an already-loaded identical video URL
  useEffect(() => {
    const nextOptimizedSrc = getOptimizedCloudinaryVideoUrl(video.videoUrl);
    setCurrentVideo(video);
    setIsLiked(Boolean(video.isLiked));
    setIsBookmarked(videosService.isVideoBookmarkedSync(video.id) || Boolean(video.isBookmarked));
    setLikesCount(Number(video.likesCount) || 0);
    setCommentsCount(Number(video.commentsCount) || 0);
    setViewsCount(Number(video.viewsCount) || 0);
    setRepostsCount(Number(video.repostsCount) || 0);
    setIsReposted(
      currentUser?.id
        ? postsService.hasUserRepostedVideoSync(video.id, currentUser.id)
        : Boolean(video.isReposted)
    );
    setCurrentVideoSrc((prevSrc) => {
      if (prevSrc !== nextOptimizedSrc && prevSrc !== video.videoUrl) {
        hasInitiatedLoadRef.current = false;
        setHasTriedFallback(false);
        return nextOptimizedSrc;
      }
      return prevSrc;
    });
  }, [video, currentUser?.id]);

  // Listen for profile updates so avatar & displayName stay fresh in Home
  useEffect(() => {
    const handleProfileUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        userId: string;
        displayName?: string;
        avatarUrl?: string;
        user?: { displayName?: string; avatarUrl?: string; username?: string };
      }>;
      const detail = customEvent.detail;
      if (!detail?.userId) return;
      if (detail.userId === authorId) {
        const newName = detail.displayName || detail.user?.displayName;
        const newAvatar = detail.avatarUrl || detail.user?.avatarUrl;
        setCurrentVideo((prev) => ({
          ...prev,
          user: {
            ...prev.user,
            ...(newName ? { displayName: newName } : {}),
            ...(newAvatar ? { avatarUrl: newAvatar } : {}),
          },
        }));
      }
    };

    window.addEventListener('sogo_profile_updated', handleProfileUpdated);
    return () => {
      window.removeEventListener('sogo_profile_updated', handleProfileUpdated);
    };
  }, [authorId]);

  useEffect(() => {
    const handleBookmarkChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string; isBookmarked: boolean }>;
      if (customEvent.detail?.videoId === currentVideo.id) {
        setIsBookmarked(customEvent.detail.isBookmarked);
      }
    };
    window.addEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    return () => {
      window.removeEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    };
  }, [currentVideo.id]);

  // Follow state
  const [isFollowing, setIsFollowing] = useState<boolean>(() => {
    if (!authorId || isOwnVideo) return false;
    return usersService.isFollowingUser(authorId, currentUser?.id);
  });
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  useEffect(() => {
    if (!authorId || isOwnVideo) return;
    setIsFollowing(usersService.isFollowingUser(authorId, currentUser?.id));

    const handleFollowChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetUserId: string; isFollowing: boolean }>;
      if (customEvent.detail && customEvent.detail.targetUserId === authorId) {
        setIsFollowing(customEvent.detail.isFollowing);
      }
    };

    window.addEventListener('sogo_follow_changed', handleFollowChanged);
    return () => {
      window.removeEventListener('sogo_follow_changed', handleFollowChanged);
    };
  }, [authorId, currentUser?.id, isOwnVideo]);

  const handleFollowToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!authorId || isOwnVideo || isFollowLoading) return;

    setIsFollowLoading(true);
    try {
      const nextStatus = await usersService.toggleFollowUser(authorId, currentUser);
      setIsFollowing(nextStatus);
    } catch (err) {
      console.error('Failed to toggle follow on Home Reel:', err);
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Stage 1A: Outer Metadata Warmup Observer (1100px below / 350px above viewport)
  // Fetches lightweight container headers (moov atom, duration, dimensions) early without downloading full video segments.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const metadataObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setIsInMetadataZone(entry.isIntersecting);
      },
      {
        rootMargin: '100px 0px 300px 0px',
        threshold: 0.01,
      }
    );

    metadataObserver.observe(el);
    return () => {
      metadataObserver.disconnect();
    };
  }, [currentVideo.id]);

  // Stage 1B: Inner Approaching-Viewport Preload Observer (580px below / 200px above viewport)
  // Starts buffering playable initial keyframes shortly before the Reel enters the viewport,
  // and releases preload eligibility if the user scrolls away so multiple Reels never compete for bandwidth.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const preloadObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setIsInPreloadZone((prev) => {
            if (!prev) {
              const now = performance.now();
              timingsRef.current.preloadStartAt = now;
              perf.mark('HOME', 'Reel entered preload zone', {
                videoId: currentVideo.id,
                readyState: videoRef.current?.readyState ?? 0,
              });
            }
            return true;
          });
          onPreloadZoneChange?.(currentVideo.id, true);
        } else {
          setIsInPreloadZone(false);
          onPreloadZoneChange?.(currentVideo.id, false);
        }
      },
      {
        rootMargin: '100px 0px 200px 0px',
        threshold: 0.01,
      }
    );

    preloadObserver.observe(el);
    return () => {
      preloadObserver.disconnect();
      onPreloadZoneChange?.(currentVideo.id, false);
    };
  }, [currentVideo.id, onPreloadZoneChange]);

  // Coordinate progressive preload transitions ('none' -> 'metadata' -> 'auto')
  // without aborting an already-active HTTP stream.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // Ensure muted properties & attribute are synchronized early for mobile/WebView autoplay compliance
    const shouldMute = isMutedRef.current;
    el.defaultMuted = shouldMute;
    el.muted = shouldMute;
    if (shouldMute) {
      el.setAttribute('muted', '');
    } else {
      el.removeAttribute('muted');
    }

    if (!shouldAttachMedia) {
      playInFlightRef.current = false;
      hasInitiatedLoadRef.current = false;
      if (!el.paused) {
        el.pause();
      }
      return;
    }

    if (effectivePreload === 'metadata') {
      if (el.preload === 'none') {
        el.preload = 'metadata';
      }
      if (el.readyState === 0 && !hasInitiatedLoadRef.current) {
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

      if (el.readyState === 0 && !hasInitiatedLoadRef.current) {
        hasInitiatedLoadRef.current = true;
        try {
          el.load();
        } catch {
          // Ignore load errors
        }
      }
    }
  }, [shouldAttachMedia, effectivePreload, currentVideoSrc]);

  // Stage 2: Primary Visibility Observer on the 9:16 Video Viewport
  // Observes the video player container (rather than the tall outer article with header/caption/comments)
  // so autoplay triggers promptly as soon as the video player is the primary visible item.
  const isCurrentlyVisibleRef = useRef<boolean>(false);

  useEffect(() => {
    const targetEl = videoViewportRef.current || cardRef.current;
    if (!targetEl || typeof IntersectionObserver === 'undefined') return;

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        // Hysteresis: activate at >= 0.35 visibility of the video player; stay eligible down to 0.25
        const qualifiesAsVisible = entry.isIntersecting
          ? isCurrentlyVisibleRef.current
            ? ratio >= 0.25
            : ratio >= 0.35
          : false;

        isCurrentlyVisibleRef.current = qualifiesAsVisible;
        onVisibilityChange(currentVideo.id, qualifiesAsVisible, qualifiesAsVisible ? ratio : 0);
      },
      {
        rootMargin: '-44px 0px -52px 0px',
        threshold: [0, 0.15, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.75, 0.9],
      }
    );

    visibilityObserver.observe(targetEl);

    return () => {
      visibilityObserver.disconnect();
      isCurrentlyVisibleRef.current = false;
      onVisibilityChange(currentVideo.id, false, 0);
    };
  }, [currentVideo.id, onVisibilityChange]);

  // Safe, non-overlapping muted autoplay helper
  const attemptPlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || !isActiveRef.current) return;
    if (!el.paused) {
      setIsPlaying(true);
      setIsBuffering(false);
      return;
    }
    if (playInFlightRef.current) return;

    // Ensure muted state and preload='auto' are applied synchronously before calling play()
    const shouldMute = isMutedRef.current;
    el.defaultMuted = shouldMute;
    el.muted = shouldMute;
    if (shouldMute) {
      el.setAttribute('muted', '');
    }
    if (el.preload !== 'auto') {
      el.preload = 'auto';
    }

    if (el.readyState === 0 && !hasInitiatedLoadRef.current) {
      hasInitiatedLoadRef.current = true;
      try {
        el.load();
      } catch {
        // Ignore load errors
      }
    }

    if (el.readyState < 2) {
      setIsBuffering(true);
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
            setIsBuffering(false);
            return;
          }
          setIsPlaying(true);
          setIsBuffering(false);
        })
        .catch((err: any) => {
          playInFlightRef.current = false;
          if (!isActiveRef.current) return;

          const errName = err?.name || 'UnknownError';
          perf.mark('HOME', 'Reel play() deferred or rejected', {
            videoId: currentVideo.id,
            reason: errName,
            readyState: el.readyState,
            muted: el.muted,
          });

          // If autoplay was blocked by browser/WebView policy, enforce muted attribute & property and retry once
          if (errName === 'NotAllowedError') {
            el.defaultMuted = true;
            el.muted = true;
            el.setAttribute('muted', '');
            el.play()
              .then(() => {
                if (isActiveRef.current) {
                  setIsPlaying(true);
                  setIsBuffering(false);
                } else {
                  el.pause();
                }
              })
              .catch(() => {
                setIsPlaying(false);
                setIsBuffering(false);
              });
          } else if (el.readyState < 3) {
            // Transient abort while still buffering; onLoadedMetadata / onLoadedData / onCanPlay will start playback when ready
            setIsBuffering(true);
          } else {
            setIsPlaying(false);
            setIsBuffering(false);
          }
        });
    } else {
      playInFlightRef.current = false;
    }
  }, [currentVideo.id]);

  // Autoplay when active in viewport, pause immediately when inactive or unmounted
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (isActive) {
      timingsRef.current.visibleAt = performance.now();
      perf.mark('HOME', 'Reel became primary visible item', {
        videoId: currentVideo.id,
        readyState: el.readyState,
        alreadyBuffered: el.readyState >= 3 || bufferedHomeReelUrls.has(currentVideoSrc),
      });
      attemptPlay();
    } else {
      playInFlightRef.current = false;
      el.pause();
      setIsPlaying(false);
      setIsBuffering(false);
    }

    return () => {
      playInFlightRef.current = false;
      el.pause();
    };
  }, [isActive, attemptPlay, currentVideo.id, currentVideoSrc]);

  // Pause playback when screen/tab is backgrounded or hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.hidden) {
        if (!el.paused) {
          el.pause();
          setIsPlaying(false);
          setIsBuffering(false);
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

  // Sync mute state on the underlying video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.defaultMuted = isMuted;
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Legitimate raw view tracking: only after 3 seconds of continuous active playback
  useEffect(() => {
    if (!isActive || !isPlaying) return;
    const timer = setTimeout(async () => {
      const nextCount = await videosService.incrementVideoViews(currentVideo.id);
      if (nextCount !== null) {
        setViewsCount(nextCount);
        onVideoUpdated?.({ ...currentVideo, viewsCount: nextCount });
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [isActive, isPlaying, currentVideo.id]);

  // Dedicated Creator Rewards qualified view tracking:
  // Preserves strict 5-second watch requirement, self-view exclusion, and 24h cooldown in rewardsService
  const hasSentRewardTelemetryRef = useRef(false);

  useEffect(() => {
    hasSentRewardTelemetryRef.current = false;
  }, [currentVideo.id]);

  useEffect(() => {
    const canQualify = Boolean(
      isActive &&
        isPlaying &&
        currentUser?.id &&
        authorId &&
        currentUser.id !== authorId &&
        !hasSentRewardTelemetryRef.current
    );

    if (!canQualify) return;

    const rewardTimer = setTimeout(() => {
      if (!hasSentRewardTelemetryRef.current && currentUser?.id && authorId) {
        hasSentRewardTelemetryRef.current = true;
        const currentDuration = videoRef.current?.duration || currentVideo.duration || 15;
        rewardsService.recordVideoWatchTelemetry(
          {
            sessionId: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            videoId: currentVideo.id,
            creatorUid: authorId,
            viewerUid: currentUser.id,
            watchDurationSeconds: 5,
            videoDurationSeconds: currentDuration,
            timestamp: new Date().toISOString(),
            isQualifiedCandidate: true,
          },
          currentVideo.caption
        );
      }
    }, 5000);

    return () => clearTimeout(rewardTimer);
  }, [
    isActive,
    isPlaying,
    currentUser?.id,
    authorId,
    currentVideo.id,
    currentVideo.duration,
    currentVideo.caption,
  ]);

  const handleLoadStart = () => {
    const now = performance.now();
    timingsRef.current.loadStartAt = now;
    if (!timingsRef.current.preloadStartAt) {
      timingsRef.current.preloadStartAt = now;
    }
    perf.mark('HOME', 'Reel network loadstart', {
      videoId: currentVideo.id,
      preload: effectivePreload,
    });
  };

  const handleLoadedMetadata = () => {
    const now = performance.now();
    if (!timingsRef.current.metadataLoadedAt) {
      timingsRef.current.metadataLoadedAt = now;
      const preloadStart = timingsRef.current.preloadStartAt || timingsRef.current.loadStartAt || now;
      perf.mark('HOME', 'Reel metadata loaded', {
        videoId: currentVideo.id,
        preloadToMetadataMs: Math.round(now - preloadStart),
      });
    }
    if (isActiveRef.current && videoRef.current && videoRef.current.paused) {
      playInFlightRef.current = false;
      attemptPlay();
    }
  };

  const handleLoadedData = () => {
    const now = performance.now();
    bufferedHomeReelUrls.add(currentVideoSrc);

    if (!timingsRef.current.loadedDataAt) {
      timingsRef.current.loadedDataAt = now;
      const preloadStart = timingsRef.current.preloadStartAt || timingsRef.current.loadStartAt || now;
      perf.mark('HOME', 'Reel first frame decoded (loadeddata)', {
        videoId: currentVideo.id,
        preloadToLoadedDataMs: Math.round(now - preloadStart),
        isActive: isActiveRef.current,
      });
    }

    if (isActiveRef.current) {
      setIsBuffering(false);
      if (videoRef.current && videoRef.current.paused) {
        playInFlightRef.current = false;
        attemptPlay();
      }
    }
  };

  const handleCanPlay = () => {
    const now = performance.now();
    bufferedHomeReelUrls.add(currentVideoSrc);

    if (!timingsRef.current.canPlayAt) {
      timingsRef.current.canPlayAt = now;
      const preloadStart = timingsRef.current.preloadStartAt || timingsRef.current.loadStartAt || now;
      perf.mark('HOME', 'Reel canplay ready', {
        videoId: currentVideo.id,
        preloadToCanPlayMs: Math.round(now - preloadStart),
        isActive: isActiveRef.current,
      });
    }

    if (isActiveRef.current) {
      setIsBuffering(false);
      if (videoRef.current && videoRef.current.paused) {
        playInFlightRef.current = false;
        attemptPlay();
      }
    }
  };

  const handlePlaying = () => {
    const now = performance.now();
    bufferedHomeReelUrls.add(currentVideoSrc);
    setIsPlaying(true);
    setIsBuffering(false);

    timingsRef.current.playingAt = now;
    const visibleAt = timingsRef.current.visibleAt || now;
    const canPlayAt = timingsRef.current.canPlayAt;
    const visibleToPlayStartMs = Math.max(0, Math.round(now - visibleAt));
    const preloadedBeforeVisible = Boolean(canPlayAt && visibleAt && canPlayAt <= visibleAt);

    perf.mark('HOME', 'Reel playback started', {
      videoId: currentVideo.id,
      visibleToPlayStartMs,
      preloadedBeforeVisible,
      readyState: videoRef.current?.readyState ?? 4,
    });
  };

  const handleVideoError = () => {
    if (!hasTriedFallback && currentVideoSrc !== currentVideo.videoUrl) {
      setHasTriedFallback(true);
      hasInitiatedLoadRef.current = true;
      setCurrentVideoSrc(currentVideo.videoUrl);
      if (videoRef.current) {
        videoRef.current.load();
        if (isActiveRef.current) {
          attemptPlay();
        }
      }
      return;
    }
    setIsBuffering(false);
    setIsPlaying(false);
  };

  const handleOpenFullReel = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setIsPlaying(false);
    setIsBuffering(false);
    onOpenReel(currentVideo.id);
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) return;

    const prevLiked = isLiked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    const nextCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);
    setIsLiked(nextLiked);
    setLikesCount(nextCount);
    onVideoUpdated?.({
      ...currentVideo,
      isLiked: nextLiked,
      likesCount: nextCount,
    });

    try {
      const res = await videosService.toggleLikeVideo(
        currentVideo.id,
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
      onVideoUpdated?.({
        ...currentVideo,
        isLiked: res.isLiked,
        likesCount: res.likesCount,
      });
    } catch {
      setIsLiked(prevLiked);
      setLikesCount(prevCount);
      onVideoUpdated?.({
        ...currentVideo,
        isLiked: prevLiked,
        likesCount: prevCount,
      });
    }
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const prevBookmarked = isBookmarked;
    const nextBookmarked = !prevBookmarked;
    setIsBookmarked(nextBookmarked);
    onVideoUpdated?.({
      ...currentVideo,
      isBookmarked: nextBookmarked,
    });

    try {
      const saved = await videosService.toggleBookmarkVideo(currentVideo.id, currentVideo);
      setIsBookmarked(saved);
      onVideoUpdated?.({
        ...currentVideo,
        isBookmarked: saved,
      });
    } catch {
      setIsBookmarked(prevBookmarked);
      onVideoUpdated?.({
        ...currentVideo,
        isBookmarked: prevBookmarked,
      });
    }
  };

  const handleDownloadReel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (downloadStatus === 'downloading' || isReelDownloading(currentVideo.id)) {
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
      await downloadReelVideo(currentVideo, {
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

  return (
    <>
      <article
        ref={cardRef}
        data-home-reel-id={currentVideo.id}
        className="bg-slate-900 rounded-2xl border border-slate-800 shadow-sm overflow-hidden mb-6 transition-all hover:border-slate-700"
      >
        {/* Feed Item Header (matches PostCard header layout) */}
        <div className="flex items-center justify-between p-3.5 sm:p-4">
          <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
            <Avatar
              src={currentVideo.user.avatarUrl}
              alt={currentVideo.user.displayName || currentVideo.user.username || 'User'}
              size="md"
              onClick={() => onUserClick(authorId)}
            />
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onUserClick(authorId)}
                  className="font-bold text-sm text-white hover:underline flex items-center gap-1 focus:outline-none min-w-0 cursor-pointer"
                >
                  <span className="truncate">
                    {currentVideo.user.displayName?.trim() || currentVideo.user.username || 'User'}
                  </span>
                  <VerifiedBadge
                    userId={authorId}
                    username={currentVideo.user.username}
                    isVerified={currentVideo.user.isVerified}
                    size="md"
                  />
                </button>
                {relativeUploadTime && (
                  <>
                    <span className="text-xs text-slate-500 shrink-0" aria-hidden="true">
                      ·
                    </span>
                    <time
                      dateTime={typeof reelTimestamp === 'string' ? reelTimestamp : undefined}
                      className="text-xs text-slate-400 whitespace-nowrap shrink-0"
                    >
                      {relativeUploadTime}
                    </time>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 text-[11px] text-cyan-400/90 font-medium mt-0.5">
                <Film className="w-3 h-3 shrink-0" />
                <span>Reel</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!isOwnVideo && currentUser && (
              <Button
                type="button"
                id={`home-reel-follow-btn-${currentVideo.id}`}
                variant={isFollowing ? 'secondary' : 'primary'}
                size="sm"
                isLoading={isFollowLoading}
                onClick={handleFollowToggle}
                className="shrink-0 text-xs font-semibold px-2.5 py-1 sm:px-3 sm:py-1 rounded-full touch-manipulation"
                aria-label={
                  isFollowing
                    ? `Unfollow @${currentVideo.user.username}`
                    : `Follow @${currentVideo.user.username}`
                }
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Button>
            )}

            {/* Three-Dot Options Menu Button */}
            <button
              type="button"
              id={`home-reel-menu-btn-${currentVideo.id}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsMenuOpen(true);
              }}
              className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-slate-200 active:text-white rounded-xl hover:bg-slate-800 active:bg-slate-700 transition-colors touch-manipulation focus:outline-none cursor-pointer"
              aria-label="Reel options menu"
              aria-expanded={isMenuOpen}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Video Viewport Area — Tapping opens the full-screen Reels viewer starting at this exact Reel */}
        <div
          ref={videoViewportRef}
          onClick={handleOpenFullReel}
          role="button"
          tabIndex={0}
          aria-label={`Open Reel by @${currentVideo.user.username}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpenFullReel();
            }
          }}
          className="relative w-full aspect-9/16 max-h-[68vh] bg-slate-950 cursor-pointer select-none overflow-hidden flex items-center justify-center group"
        >
          <video
            ref={videoRef}
            src={shouldAttachMedia ? currentVideoSrc : undefined}
            poster={shouldAttachMedia ? optimizedPosterUrl : undefined}
            autoPlay={isActive}
            playsInline
            webkit-playsinline="true"
            x5-playsinline="true"
            loop
            muted={isMuted}
            preload={effectivePreload}
            onLoadStart={handleLoadStart}
            onLoadedMetadata={handleLoadedMetadata}
            onLoadedData={handleLoadedData}
            onCanPlay={handleCanPlay}
            onPlaying={handlePlaying}
            onWaiting={() => {
              if (isActiveRef.current) {
                setIsBuffering(true);
                perf.mark('HOME', 'Reel waiting/buffering next segment', {
                  videoId: currentVideo.id,
                  readyState: videoRef.current?.readyState ?? 0,
                });
              }
            }}
            onPause={() => {
              setIsPlaying(false);
              setIsBuffering(false);
            }}
            onError={handleVideoError}
            className="w-full h-full object-contain bg-black"
          />

          {/* Subtle gradient overlay for controls clarity */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20 pointer-events-none" />

          {/* Lightweight buffering indicator when active Reel is waiting on network */}
          {isActive && isBuffering && !isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-xs border border-cyan-400/25 flex items-center justify-center shadow-lg">
                <div className="w-6 h-6 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
              </div>
            </div>
          )}

          {/* Play indicator when paused / inactive */}
          {!isPlaying && !(isActive && isBuffering) && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-xs border border-white/15 text-white flex items-center justify-center shadow-xl group-hover:scale-105 transition-transform">
                <Play className="w-6 h-6 fill-white ml-0.5" />
              </div>
            </div>
          )}

          {/* Mute / Unmute Toggle Control */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            className="absolute bottom-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/15 flex items-center justify-center text-white transition-transform active:scale-95 cursor-pointer"
            aria-label={isMuted ? 'Unmute Reel' : 'Mute Reel'}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-white/90" />
            ) : (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            )}
          </button>
        </div>

        {/* Interactive Actions & Metadata Footer */}
        <div className="px-3.5 sm:px-4 pt-1 pb-3">
          <div className="flex items-center justify-between py-2 px-1">
            <div className="flex items-center gap-4">
              {/* Like Button */}
              <button
                type="button"
                onClick={handleLike}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white group focus:outline-none transition-transform active:scale-90 cursor-pointer"
                aria-label={isLiked ? 'Unlike Reel' : 'Like Reel'}
              >
                <Heart
                  className={cn(
                    'w-6 h-6 transition-colors duration-150',
                    isLiked ? 'fill-rose-500 text-rose-500' : 'group-hover:text-rose-400'
                  )}
                />
                <span
                  className={cn(
                    'text-xs font-semibold',
                    isLiked ? 'text-rose-400' : 'text-slate-300'
                  )}
                >
                  {formatNumber(likesCount)}
                </span>
              </button>

              {/* Comment Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCommentsOpen(true);
                }}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white group focus:outline-none transition-transform active:scale-90 cursor-pointer"
                aria-label="Reel comments"
              >
                <MessageCircle className="w-6 h-6 group-hover:text-cyan-400 transition-colors" />
                <span className="text-xs font-semibold text-slate-300">
                  {formatNumber(commentsCount)}
                </span>
              </button>

              {/* Download Button */}
              <button
                type="button"
                onClick={handleDownloadReel}
                disabled={downloadStatus === 'downloading'}
                className="flex items-center gap-1.5 text-slate-300 hover:text-cyan-400 group focus:outline-none transition-transform active:scale-90 cursor-pointer disabled:opacity-70"
                aria-label="Download Reel"
              >
                {downloadStatus === 'downloading' ? (
                  <Loader2 className="w-5.5 h-5.5 text-cyan-400 animate-spin" />
                ) : downloadStatus === 'success' ? (
                  <Check className="w-5.5 h-5.5 text-emerald-400" />
                ) : downloadStatus === 'error' ? (
                  <AlertCircle className="w-5.5 h-5.5 text-rose-400" />
                ) : (
                  <Download className="w-5.5 h-5.5 group-hover:text-cyan-400 transition-colors" />
                )}
              </button>

              {/* Bookmark Button */}
              <button
                type="button"
                onClick={handleBookmark}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white group focus:outline-none transition-transform active:scale-90 cursor-pointer"
                aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark post'}
              >
                <Bookmark
                  className={cn(
                    'w-6 h-6 transition-colors duration-150',
                    isBookmarked ? 'fill-amber-400 text-amber-400' : 'group-hover:text-amber-400'
                  )}
                />
              </button>

              {/* Share / Repost Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsShareModalOpen(true);
                }}
                className="flex items-center gap-1.5 text-slate-300 hover:text-emerald-400 group focus:outline-none transition-transform active:scale-90 cursor-pointer"
                aria-label="Share Reel"
              >
                <Repeat2
                  className={cn(
                    'w-6 h-6 transition-colors duration-150',
                    isReposted ? 'text-emerald-400' : 'group-hover:text-emerald-400'
                  )}
                />
              </button>
            </div>

            {/* Canonical Total Views Indicator (matches Home post Total Views display) */}
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-1 text-slate-400 select-none py-1 px-1.5 rounded"
                title={`${Number(viewsCount || 0).toLocaleString()} views`}
                aria-label={`${Number(viewsCount || 0).toLocaleString()} views`}
              >
                <Eye className="w-4 h-4 text-slate-400/80 stroke-[1.8]" />
                <span className="text-xs font-medium text-slate-400 font-mono tracking-tight">
                  {formatNumber(Number(viewsCount) || 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Download Status Feedback Banner */}
          {downloadStatus !== 'idle' && downloadMessage && (
            <div
              className={`mb-2 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                downloadStatus === 'downloading'
                  ? 'bg-cyan-950/50 border-cyan-500/40 text-cyan-300'
                  : downloadStatus === 'success'
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
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
          )}

          {/* Caption & Tags */}
          {currentVideo.caption && (
            <div className="text-sm cursor-pointer" onClick={handleOpenFullReel}>
              <p className="text-slate-300 leading-relaxed">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUserClick(authorId);
                  }}
                  className="font-bold text-white hover:underline mr-1.5 inline-flex items-center gap-1 align-baseline focus:outline-none cursor-pointer"
                >
                  <span>
                    {currentVideo.user.displayName?.trim() || currentVideo.user.username || 'User'}
                  </span>
                  <VerifiedBadge
                    userId={authorId}
                    username={currentVideo.user.username}
                    isVerified={currentVideo.user.isVerified}
                    size="xs"
                  />
                </button>
                {currentVideo.caption.length > 120 && !isExpanded ? (
                  <>
                    <span>{currentVideo.caption.slice(0, 120)}... </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsExpanded(true);
                      }}
                      className="text-slate-400 font-medium hover:text-cyan-400 text-xs"
                    >
                      more
                    </button>
                  </>
                ) : (
                  <span>{currentVideo.caption}</span>
                )}
              </p>

              {currentVideo.tags && currentVideo.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {currentVideo.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-medium hover:underline"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {commentsCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCommentsOpen(true);
              }}
              className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-200 block focus:outline-none cursor-pointer"
            >
              View all {commentsCount} {commentsCount === 1 ? 'comment' : 'comments'}
            </button>
          )}
        </div>
      </article>

      {/* Existing Video Comments Drawer */}
      <VideoCommentsDrawer
        video={currentVideo}
        isOpen={isCommentsOpen}
        onClose={() => setIsCommentsOpen(false)}
        onCommentAdded={() => {
          const next = commentsCount + 1;
          setCommentsCount(next);
          onVideoUpdated?.({ ...currentVideo, commentsCount: next });
        }}
      />

      {/* Existing Share / Sogo Repost Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        targetType="video"
        video={currentVideo}
        onRepostSuccess={() => {
          const next = repostsCount + 1;
          setRepostsCount(next);
          setIsReposted(true);
          onVideoUpdated?.({
            ...currentVideo,
            repostsCount: next,
            isReposted: true,
          });
        }}
        onRepostRemoved={() => {
          const next = Math.max(0, repostsCount - 1);
          setRepostsCount(next);
          setIsReposted(false);
          onVideoUpdated?.({
            ...currentVideo,
            repostsCount: next,
            isReposted: false,
          });
        }}
      />

      {/* Three-Dot Action Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
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
                    id={`edit-home-reel-btn-${currentVideo.id}`}
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
                    id={`share-home-reel-btn-${currentVideo.id}`}
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
                    id={`delete-home-reel-btn-${currentVideo.id}`}
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
                    id={`share-home-reel-menu-btn-${currentVideo.id}`}
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
                    id={`report-home-reel-btn-${currentVideo.id}`}
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
                    id={`block-user-home-reel-btn-${currentVideo.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsBlockModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                      <UserX className="w-4 h-4" />
                    </div>
                    <span>Block @{currentVideo.user?.username || 'User'}</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                id={`cancel-home-reel-menu-btn-${currentVideo.id}`}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
                      {currentVideo.user.displayName}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      @{currentVideo.user.username}
                    </p>
                    {relativeUploadTime && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Published {relativeUploadTime === 'Just now' ? 'just now' : `${relativeUploadTime} ago`}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`edit-home-reel-caption-${currentVideo.id}`}
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Reel Caption / Description
                  </label>
                  <textarea
                    id={`edit-home-reel-caption-${currentVideo.id}`}
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
                    id={`save-home-reel-edit-btn-${currentVideo.id}`}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
                  id={`confirm-delete-home-reel-btn-${currentVideo.id}`}
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
                  id={`cancel-delete-home-reel-btn-${currentVideo.id}`}
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
        targetId={currentVideo.id}
        targetAuthorId={currentVideo.userId || currentVideo.user?.id || ''}
        targetAuthorUsername={currentVideo.user?.username}
        targetTitleOrCaption={currentVideo.caption}
      />

      <BlockConfirmModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        targetUserId={currentVideo.userId || currentVideo.user?.id || ''}
        targetUsername={currentVideo.user?.username}
        targetDisplayName={currentVideo.user?.displayName}
        targetAvatarUrl={currentVideo.user?.avatarUrl}
        onBlockedSuccess={() => {
          onVideoDeleted?.(currentVideo.id);
        }}
      />
    </>
  );
};
