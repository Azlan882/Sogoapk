import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DocumentSnapshot } from 'firebase/firestore';
import { Plus, RefreshCw, Film, ArrowLeft } from 'lucide-react';
import { VideoPost, CreateIntent } from '../types';
import * as videosService from '../services/videosService';
import { VideoItem } from '../components/VideoItem';
import { VideoCommentsDrawer } from '../components/VideoCommentsDrawer';
import { useAuth } from '../hooks/useAuth';
import { registerBackInterceptor } from '../services/backButtonService';
import { perf } from '../utils/perfLogger';

export interface VideosProps {
  onUserClick: (userId: string, videoId?: string) => void;
  onNavigateCreate: (intent?: CreateIntent) => void;
  initialVideoId?: string | null;
  profileUserId?: string | null;
  onBack?: () => void;
}

export const Videos: React.FC<VideosProps> = ({
  onUserClick,
  onNavigateCreate,
  initialVideoId,
  profileUserId,
  onBack,
}) => {
  const { currentUser } = useAuth();
  
  // Instantaneous cache hydration:
  // - When profileUserId is provided (opened from Profile → Reels), scope strictly to that creator's Reels.
  // - Otherwise, use the global Reels feed cache.
  const [videos, setVideos] = useState<VideoPost[]>(() => {
    if (profileUserId) {
      const userCached = videosService.getCachedUserVideos(profileUserId);
      if (initialVideoId) {
        const primed = videosService.getPrimedVideo(initialVideoId);
        const validPrimed =
          primed && (primed.userId === profileUserId || primed.user?.id === profileUserId)
            ? primed
            : null;
        const target = userCached.find((v) => v.id === initialVideoId) || validPrimed;
        if (target) {
          return [target, ...userCached.filter((v) => v.id !== initialVideoId)];
        }
      }
      return userCached;
    }

    const cached = videosService.getCachedVideos();
    if (initialVideoId) {
      const target =
        cached.find((v) => v.id === initialVideoId) ||
        videosService.getPrimedVideo(initialVideoId);
      if (target) {
        return [target, ...cached.filter((v) => v.id !== initialVideoId)];
      }
    }
    return cached;
  });

  const [loading, setLoading] = useState(() => {
    if (profileUserId) {
      const userCached = videosService.getCachedUserVideos(profileUserId);
      if (initialVideoId) {
        const primed = videosService.getPrimedVideo(initialVideoId);
        const hasValidPrimed = Boolean(
          primed && (primed.userId === profileUserId || primed.user?.id === profileUserId)
        );
        return !(userCached.some((v) => v.id === initialVideoId) || hasValidPrimed);
      }
      return userCached.length === 0;
    }

    const cached = videosService.getCachedVideos();
    if (initialVideoId) {
      return !(
        cached.some((v) => v.id === initialVideoId) ||
        Boolean(videosService.getPrimedVideo(initialVideoId))
      );
    }
    return cached.length === 0;
  });

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastCursor, setLastCursor] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [activeIndex, setActiveIndex] = useState(0);
  const [readyActiveVideoId, setReadyActiveVideoId] = useState<string | null>(null);
  const [approachingIndex, setApproachingIndex] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Comments drawer state
  const [selectedVideoForComments, setSelectedVideoForComments] = useState<VideoPost | null>(null);

  // Close comments drawer on Android Back button press before navigating away
  useEffect(() => {
    if (!selectedVideoForComments) return;
    return registerBackInterceptor(() => {
      setSelectedVideoForComments(null);
      return true;
    });
  }, [selectedVideoForComments]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeIndexRef = useRef<number>(0);
  activeIndexRef.current = activeIndex;
  const videosRefState = useRef<VideoPost[]>(videos);
  videosRefState.current = videos;
  const lastCursorRef = useRef<DocumentSnapshot | null>(lastCursor);
  lastCursorRef.current = lastCursor;
  const hasMoreRef = useRef<boolean>(hasMore);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef<boolean>(loadingMore);
  loadingMoreRef.current = loadingMore;

  // Listen for asynchronous background like-status hydration from videosService
  useEffect(() => {
    const handleLikesHydrated = (e: Event) => {
      const customEvent = e as CustomEvent<{ likedMap?: Record<string, boolean> }>;
      const likedMap = customEvent.detail?.likedMap;
      if (!likedMap) return;
      setVideos((prev) => {
        let changed = false;
        const next = prev.map((v) => {
          if (likedMap[v.id] !== undefined && v.isLiked !== likedMap[v.id]) {
            changed = true;
            return { ...v, isLiked: likedMap[v.id] };
          }
          return v;
        });
        return changed ? next : prev;
      });
    };

    const handleBookmarkChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string; isBookmarked: boolean }>;
      const detail = customEvent.detail;
      if (!detail?.videoId) return;
      setVideos((prev) => {
        let changed = false;
        const next = prev.map((v) => {
          if (v.id === detail.videoId && v.isBookmarked !== detail.isBookmarked) {
            changed = true;
            return { ...v, isBookmarked: detail.isBookmarked };
          }
          return v;
        });
        return changed ? next : prev;
      });
    };

    const handleUserBlocked = (e: Event) => {
      const customEvent = e as CustomEvent<{ blockedUserId: string }>;
      const blockedId = customEvent.detail?.blockedUserId;
      if (blockedId) {
        setVideos((prev) =>
          prev.filter((v) => v.userId !== blockedId && v.user?.id !== blockedId)
        );
      }
    };

    window.addEventListener('sogo_video_likes_hydrated', handleLikesHydrated);
    window.addEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    window.addEventListener('sogo_user_blocked', handleUserBlocked);
    return () => {
      window.removeEventListener('sogo_video_likes_hydrated', handleLikesHydrated);
      window.removeEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
      window.removeEventListener('sogo_user_blocked', handleUserBlocked);
    };
  }, []);

  // Load initial videos (strictly creator-scoped when profileUserId is set; global otherwise)
  const fetchInitialVideos = useCallback(async (forceRefresh = false) => {
    perf.start('REELS', 'Reels screen initialization');

    if (profileUserId) {
      const userCached = videosService.getCachedUserVideos(profileUserId);
      const primed = initialVideoId ? videosService.getPrimedVideo(initialVideoId) : null;
      const validPrimed =
        primed && (primed.userId === profileUserId || primed.user?.id === profileUserId)
          ? primed
          : null;
      const hasInitialReady = initialVideoId
        ? userCached.some((v) => v.id === initialVideoId) || Boolean(validPrimed)
        : userCached.length > 0;

      if (!hasInitialReady && !forceRefresh) {
        setLoading(true);
      }

      try {
        const [userVideos, directVideo] = await Promise.all([
          videosService.getUserVideos(profileUserId, currentUser?.id),
          initialVideoId ? videosService.getVideoById(initialVideoId, currentUser?.id) : Promise.resolve(null),
        ]);

        // Filter strictly to profileUserId so no other creator's Reel is ever mixed in
        let loadedVideos = userVideos.filter(
          (v) => v.userId === profileUserId || v.user?.id === profileUserId
        );

        if (initialVideoId) {
          const matchingDirect =
            directVideo &&
            (directVideo.userId === profileUserId || directVideo.user?.id === profileUserId)
              ? directVideo
              : null;
          const targetVideo =
            loadedVideos.find((v) => v.id === initialVideoId) || matchingDirect || validPrimed;
          if (targetVideo) {
            const remaining = loadedVideos.filter((v) => v.id !== initialVideoId);
            loadedVideos = [targetVideo, ...remaining];
          }
        }

        setVideos(loadedVideos);
        lastCursorRef.current = null;
        hasMoreRef.current = false;
        setLastCursor(null);
        setHasMore(false);

        if (forceRefresh || !hasInitialReady) {
          setActiveIndex(0);
          if (containerRef.current) {
            containerRef.current.scrollTo({ top: 0, behavior: 'instant' });
          }
        }

        perf.end('REELS', 'Time until first Reel is rendered', { firstId: loadedVideos[0]?.id, profileUserId });
        perf.end('REELS', 'Total time until initial Reel batch is available', { count: loadedVideos.length, profileUserId });
      } catch (err) {
        console.error('Failed to load profile user videos', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    const cached = videosService.getCachedVideos();
    const hasInitialReady = initialVideoId
      ? cached.some((v) => v.id === initialVideoId) ||
        Boolean(videosService.getPrimedVideo(initialVideoId))
      : cached.length > 0;

    if (!hasInitialReady && !forceRefresh) {
      setLoading(true);
    }

    try {
      // Parallel execution: fetch a lean initial batch of 4 Reels and target video concurrently if initialVideoId is specified
      const [res, directVideo] = await Promise.all([
        videosService.getVideos(null, 4, currentUser?.id, forceRefresh),
        initialVideoId ? videosService.getVideoById(initialVideoId, currentUser?.id) : Promise.resolve(null),
      ]);

      let loadedVideos = res.videos;

      // Ensure that if a specific video was tapped, it is placed at index 0 and plays first
      if (initialVideoId) {
        if (directVideo) {
          const remaining = loadedVideos.filter((v) => v.id !== initialVideoId);
          loadedVideos = [directVideo, ...remaining];
        } else {
          const existingIdx = loadedVideos.findIndex((v) => v.id === initialVideoId);
          if (existingIdx > 0) {
            const targetVideo = loadedVideos[existingIdx];
            const remaining = loadedVideos.filter((v) => v.id !== initialVideoId);
            loadedVideos = [targetVideo, ...remaining];
          }
        }
      }

      setVideos((prev) => {
        // If cached videos were already rendered and playing, keep the active Reel at its current slot
        // so background metadata reconciliation never interrupts an in-progress video stream
        if (!forceRefresh && hasInitialReady && prev.length > 0 && activeIndexRef.current === 0) {
          const activeVid = prev[0];
          if (activeVid && loadedVideos.length > 0 && loadedVideos[0].id !== activeVid.id && !initialVideoId) {
            const updatedActive = loadedVideos.find((v) => v.id === activeVid.id) || activeVid;
            const rest = loadedVideos.filter((v) => v.id !== activeVid.id);
            return [updatedActive, ...rest];
          }
        }
        return loadedVideos;
      });
      lastCursorRef.current = res.nextCursor;
      hasMoreRef.current = !!res.nextCursor;
      setLastCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);

      if (forceRefresh || !hasInitialReady) {
        setActiveIndex(0);
        if (containerRef.current) {
          containerRef.current.scrollTo({ top: 0, behavior: 'instant' });
        }
      }

      perf.end('REELS', 'Time until first Reel is rendered', { firstId: loadedVideos[0]?.id });
      perf.end('REELS', 'Total time until initial Reel batch is available', { count: loadedVideos.length });
    } catch (err) {
      console.error('Failed to load initial videos', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, initialVideoId, profileUserId]);

  useEffect(() => {
    fetchInitialVideos();
  }, [fetchInitialVideos]);

  // Pull / button to refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchInitialVideos(true);
      if (containerRef.current) {
        containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      console.error('Failed to refresh videos', err);
    } finally {
      setRefreshing(false);
    }
  };

  // Load more videos when near the end (only for global Reels feed; never when scoped to profileUserId)
  const loadMoreVideos = useCallback(async () => {
    if (
      profileUserId ||
      loadingMoreRef.current ||
      !hasMoreRef.current ||
      !lastCursorRef.current
    ) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let cursor: DocumentSnapshot | null = lastCursorRef.current;
      const existingIds = new Set(videosRefState.current.map((v) => v.id));
      const collectedNew: VideoPost[] = [];

      // Continue scanning if a batch only contained already-displayed videos (e.g. prepended initialVideoId)
      while (cursor && collectedNew.length === 0) {
        const res = await videosService.getVideos(cursor, 5, currentUser?.id);
        cursor = res.nextCursor;
        if (res.videos.length === 0) {
          break;
        }
        for (const v of res.videos) {
          if (!existingIds.has(v.id)) {
            existingIds.add(v.id);
            collectedNew.push(v);
          }
        }
      }

      if (collectedNew.length > 0) {
        setVideos((prev) => {
          const prevIds = new Set(prev.map((v) => v.id));
          const uniqueNew = collectedNew.filter((v) => !prevIds.has(v.id));
          return uniqueNew.length > 0 ? [...prev, ...uniqueNew] : prev;
        });
      }

      lastCursorRef.current = cursor;
      hasMoreRef.current = Boolean(cursor);
      setLastCursor(cursor);
      setHasMore(Boolean(cursor));
    } catch (err) {
      console.error('Failed to load more videos', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [profileUserId, currentUser?.id]);

  // Trigger pagination whenever user is within 2 Reels of the end and cursor becomes available
  useEffect(() => {
    if (
      !profileUserId &&
      !loading &&
      videos.length > 0 &&
      activeIndex >= videos.length - 2 &&
      hasMore &&
      !loadingMore &&
      lastCursor
    ) {
      loadMoreVideos();
    }
  }, [activeIndex, videos.length, hasMore, loadingMore, lastCursor, profileUserId, loading, loadMoreVideos]);

  // IntersectionObserver to accurately detect which video is currently active in viewport
  // and detect when the next/adjacent Reel begins approaching the viewport during a swipe
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const activeObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const index = Number(entry.target.getAttribute('data-index'));
            if (!isNaN(index)) {
              setActiveIndex(index);
              // If within 2 videos of the end, prefetch more
              if (index >= videosRefState.current.length - 2) {
                loadMoreVideos();
              }
            }
          }
        });
      },
      {
        root: container,
        threshold: 0.5,
      }
    );

    const approachingObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number(entry.target.getAttribute('data-index'));
          if (isNaN(index)) return;
          if (entry.isIntersecting && entry.intersectionRatio > 0.01 && entry.intersectionRatio < 0.5) {
            setApproachingIndex(index);
          }
        });
      },
      {
        root: container,
        rootMargin: '50% 0px 50% 0px',
        threshold: [0.02, 0.15],
      }
    );

    videoRefs.current.forEach((el) => {
      if (el) {
        activeObserver.observe(el);
        approachingObserver.observe(el);
      }
    });

    return () => {
      activeObserver.disconnect();
      approachingObserver.disconnect();
    };
  }, [loading, videos, hasMore, loadingMore, lastCursor, loadMoreVideos]);

  const handleReadyToPlay = useCallback((videoId: string) => {
    setReadyActiveVideoId((prev) => (prev === videoId ? prev : videoId));
  }, []);

  const handleVideoUpdated = useCallback((updatedVideo: VideoPost) => {
    setVideos((prev) =>
      prev.map((v) => (v.id === updatedVideo.id ? updatedVideo : v))
    );
  }, []);

  const handleVideoDeleted = useCallback(
    (deletedVideoId: string) => {
      setSelectedVideoForComments((prev) =>
        prev?.id === deletedVideoId ? null : prev
      );
      setVideos((prev) => {
        const next = prev.filter((v) => v.id !== deletedVideoId);
        setActiveIndex((prevIdx) =>
          next.length === 0 ? 0 : Math.min(prevIdx, next.length - 1)
        );
        if (next.length === 0 && (initialVideoId || profileUserId) && onBack) {
          setTimeout(() => onBack(), 0);
        }
        return next;
      });
    },
    [initialVideoId, profileUserId, onBack]
  );

  useEffect(() => {
    const onExternalVideoUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{ video: VideoPost }>;
      if (customEvent.detail?.video) {
        handleVideoUpdated(customEvent.detail.video);
      }
    };
    const onExternalVideoDeleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string }>;
      if (customEvent.detail?.videoId) {
        handleVideoDeleted(customEvent.detail.videoId);
      }
    };
    window.addEventListener('sogo_video_updated', onExternalVideoUpdated);
    window.addEventListener('sogo_video_deleted', onExternalVideoDeleted);
    return () => {
      window.removeEventListener('sogo_video_updated', onExternalVideoUpdated);
      window.removeEventListener('sogo_video_deleted', onExternalVideoDeleted);
    };
  }, [handleVideoUpdated, handleVideoDeleted]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const handleCommentClick = useCallback((v: VideoPost) => {
    setSelectedVideoForComments(v);
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] sm:h-[calc(100vh-4.5rem)] bg-black overflow-hidden flex flex-col">
      {/* Top Floating Header with SogoSocial branding & Quick Create button */}
      <div className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {(initialVideoId || profileUserId) && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 -ml-1 rounded-full bg-black/40 text-white hover:bg-black/60 backdrop-blur-md transition-colors cursor-pointer"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <Film className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-extrabold text-white tracking-wide drop-shadow-md truncate max-w-[220px]">
            {profileUserId && videos[activeIndex]?.user?.username
              ? `@${videos[activeIndex].user.username}'s Reels`
              : 'Reels'}
          </h1>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-full bg-black/40 text-slate-300 hover:text-white backdrop-blur-md transition-colors cursor-pointer"
            aria-label="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => onNavigateCreate('reel')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white font-bold text-xs rounded-full shadow-lg shadow-cyan-500/25 transition-transform active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5px]" />
            <span>Create</span>
          </button>
        </div>
      </div>

      {/* Main Feed Container */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <div className="w-10 h-10 border-3 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-semibold text-slate-300">Loading videos...</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-[#0B0F1A]">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-500/10 to-blue-600/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4 shadow-xl">
            <Film className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-extrabold text-white">No videos yet</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
            Be the very first to share a short video clip with the SogoSocial community!
          </p>
          <button
            type="button"
            onClick={() => onNavigateCreate('reel')}
            className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-400 to-blue-600 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-cyan-500/25 hover:brightness-110 transition-transform active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3px]" />
            <span>Post First Video</span>
          </button>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 w-full h-full overflow-y-scroll snap-y snap-mandatory scroll-smooth no-scrollbar"
        >
          {videos.map((video, index) => {
            // Only keep the active Reel, 1 previous Reel, and 1 next Reel mounted
            const shouldRender = index >= activeIndex - 1 && index <= activeIndex + 1;
            const isCurrent = activeIndex === index;
            const isNext = index === activeIndex + 1;
            const isCurrentReady = readyActiveVideoId === videos[activeIndex]?.id;
            const isApproaching = approachingIndex === index;

            // Strict mobile-first preload strategy:
            // 1. Active Reel gets 'auto' with 100% of network bandwidth until it starts playing.
            // 2. Next Reel (index + 1) stays at 'none' until the active Reel starts playing, then warms 'metadata'
            //    (and upgrades to 'auto' only when the user begins swiping toward it).
            // 3. Off-screen Reels use 'none' so they never compete for bandwidth.
            const preloadMode: 'auto' | 'metadata' | 'none' = isCurrent
              ? 'auto'
              : isNext
              ? isApproaching
                ? 'auto'
                : isCurrentReady
                ? 'metadata'
                : 'none'
              : isApproaching
              ? 'metadata'
              : 'none';

            return (
              <div
                key={video.id}
                ref={(el) => {
                  videoRefs.current[index] = el;
                }}
                data-index={index}
                className="w-full h-full snap-start snap-always"
              >
                {shouldRender ? (
                  <VideoItem
                    video={video}
                    isActive={isCurrent}
                    isMuted={isMuted}
                    preloadMode={preloadMode}
                    onReadyToPlay={handleReadyToPlay}
                    onToggleMute={handleToggleMute}
                    onUserClick={onUserClick}
                    onCommentClick={handleCommentClick}
                    onVideoUpdated={handleVideoUpdated}
                    onVideoDeleted={handleVideoDeleted}
                  />
                ) : (
                  <div className="w-full h-full bg-black" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Slide-up Comments Drawer */}
      {selectedVideoForComments && (
        <VideoCommentsDrawer
          video={selectedVideoForComments}
          isOpen={!!selectedVideoForComments}
          onClose={() => setSelectedVideoForComments(null)}
          onCommentAdded={() => {
            // Increment comment count locally on the video
            setVideos((prev) =>
              prev.map((v) =>
                v.id === selectedVideoForComments.id
                  ? { ...v, commentsCount: v.commentsCount + 1 }
                  : v
              )
            );
          }}
        />
      )}
    </div>
  );
};
