
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Post, Story, VideoPost, CreateIntent } from '../types';
import { PostCard } from '../components/PostCard';
import { StoryItem } from '../components/StoryItem';
import { Avatar } from '../components/Avatar';
import { HomeFeedReelCard } from '../components/HomeFeedReelCard';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { useAuth } from '../hooks/useAuth';
import * as postsService from '../services/postsService';
import * as storiesService from '../services/storiesService';
import * as videosService from '../services/videosService';
import { sharePost } from '../services/shareService';
import { Plus, X, Sparkles, RefreshCw, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { perf } from '../utils/perfLogger';
import { scrollFeedToTop, getStoryMediaUrl, isStoryVideoMedia, getOptimizedCloudinaryVideoUrl } from '../lib/utils';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import HomeBannerAd from '../components/HomeBannerAd';
import { NativeFeedAdCard } from '../components/NativeFeedAdCard';
import {
  getOrCreateHomeNativeFeed,
  resumeHomeNativeFeed,
  destroyHomeNativeFeed,
} from '../services/nativeAdService';

// Configurable frequency for inserting individual random Reels into the Home feed
// (e.g., 2 = insert 1 random Reel after every 2 normal posts)
export const HOME_REEL_INSERTION_INTERVAL = 2;

// Frequency for inserting Google AdMob Native ads into the Home feed (1 ad every ~8 posts)
export const HOME_NATIVE_AD_INTERVAL = 8;

export interface HomeProps {
  onPostClick: (post: Post) => void;
  onUserClick: (userId: string) => void;
  onNavigateCreate: (intent?: CreateIntent) => void;
  onVideoClick?: (videoId: string) => void;
  refreshTrigger?: number;
}

export const Home: React.FC<HomeProps> = ({
  onPostClick,
  onUserClick,
  onNavigateCreate,
  onVideoClick,
  refreshTrigger = 0,
}) => {
  const { currentUser } = useAuth();

  // Instantaneous cache hydration: display cached data immediately without waiting on network
  const [posts, setPosts] = useState<Post[]>(() => postsService.getCachedFeedPosts());
  const [stories, setStories] = useState<Story[]>(() => storiesService.getCachedStories());
  const [reels, setReels] = useState<VideoPost[]>(() => videosService.getCachedFeedReels(8));
  const [loading, setLoading] = useState(() => postsService.getCachedFeedPosts().length === 0);
  const [refreshing, setRefreshing] = useState(false);

  // Single-active-Reel autoplay & mute state (starts muted for Android WebView autoplay compliance)
  const [activeReelId, setActiveReelId] = useState<string | null>(null);
  const [lastFocusedReelId, setLastFocusedReelId] = useState<string | null>(null);
  const [isReelMuted, setIsReelMuted] = useState<boolean>(true);
  const visibleReelsMapRef = useRef<Map<string, number>>(new Map());

  // Maintain stable randomized Reel order within the current Home session unless refreshed
  const sessionReelOrderRef = useRef<string[]>([]);
  const homeContainerRef = useRef<HTMLDivElement | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [storyProgress, setStoryProgress] = useState(0);
  const [shareCopiedToast, setShareCopiedToast] = useState(false);

  // Coordinate single-Reel autoplay based on viewport intersection ratios of the video player
  const handleReelVisibilityChange = useCallback(
    (videoId: string, isVisible: boolean, ratio: number) => {
      const map = visibleReelsMapRef.current;
      if (isVisible && ratio >= 0.3) {
        map.set(videoId, ratio);
      } else {
        map.delete(videoId);
      }

      let bestId: string | null = null;
      let bestRatio = 0;
      map.forEach((r, id) => {
        if (r > bestRatio) {
          bestRatio = r;
          bestId = id;
        }
      });

      if (bestId) {
        setLastFocusedReelId((prev) => (prev === bestId ? prev : bestId));
      }
      setActiveReelId((prev) => (prev === bestId ? prev : bestId));
    },
    []
  );

  const handleToggleReelMute = useCallback(() => {
    setIsReelMuted((prev) => !prev);
  }, []);

  const handleOpenReel = useCallback(
    (videoId: string) => {
      setActiveReelId(null);
      visibleReelsMapRef.current.clear();
      onVideoClick?.(videoId);
    },
    [onVideoClick]
  );

  const handleReelUpdated = useCallback((updatedReel: VideoPost) => {
    setReels((prev) => prev.map((r) => (r.id === updatedReel.id ? updatedReel : r)));
  }, []);

  const handleReelDeleted = useCallback((deletedVideoId: string) => {
    visibleReelsMapRef.current.delete(deletedVideoId);
    sessionReelOrderRef.current = sessionReelOrderRef.current.filter(
      (id) => id !== deletedVideoId
    );
    setActiveReelId((prev) => (prev === deletedVideoId ? null : prev));
    setReels((prev) => prev.filter((r) => r.id !== deletedVideoId));
    setPosts((prev) =>
      prev.filter((p) => p.originalVideoId !== deletedVideoId)
    );
  }, []);

  useEffect(() => {
    const onExternalVideoUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{ video: VideoPost }>;
      if (customEvent.detail?.video) {
        handleReelUpdated(customEvent.detail.video);
      }
    };
    const onExternalVideoDeleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string }>;
      if (customEvent.detail?.videoId) {
        handleReelDeleted(customEvent.detail.videoId);
      }
    };
    const onUserBlocked = (e: Event) => {
      const customEvent = e as CustomEvent<{ blockedUserId: string }>;
      const blockedId = customEvent.detail?.blockedUserId;
      if (blockedId) {
        setPosts((prev) =>
          prev.filter(
            (p) =>
              p.userId !== blockedId &&
              p.user?.id !== blockedId &&
              p.originalAuthorId !== blockedId
          )
        );
        setReels((prev) =>
          prev.filter(
            (r) => r.userId !== blockedId && r.user?.id !== blockedId
          )
        );
      }
    };
    window.addEventListener('sogo_video_updated', onExternalVideoUpdated);
    window.addEventListener('sogo_video_deleted', onExternalVideoDeleted);
    window.addEventListener('sogo_user_blocked', onUserBlocked);
    return () => {
      window.removeEventListener('sogo_video_updated', onExternalVideoUpdated);
      window.removeEventListener('sogo_video_deleted', onExternalVideoDeleted);
      window.removeEventListener('sogo_user_blocked', onUserBlocked);
    };
  }, [handleReelUpdated, handleReelDeleted]);

  // Deduplicate and preserve stable randomized Reel order for the current Home session
  const sessionReels = useMemo(() => {
    if (!reels || reels.length === 0) return [];

    const validMap = new Map<string, VideoPost>();
    for (const r of reels) {
      if (r && r.id && r.videoUrl && !validMap.has(r.id)) {
        validMap.set(r.id, r);
      }
    }

    // Keep any already-assigned session Reel IDs in their stable positions, then append new unique IDs
    const existingOrder = sessionReelOrderRef.current.filter((id) => validMap.has(id));
    const existingSet = new Set(existingOrder);
    for (const id of validMap.keys()) {
      if (!existingSet.has(id)) {
        existingOrder.push(id);
        existingSet.add(id);
      }
    }
    sessionReelOrderRef.current = existingOrder;

    return existingOrder
      .map((id) => validMap.get(id))
      .filter((item): item is VideoPost => Boolean(item));
  }, [reels]);

  // Determine network-efficient preload hint for each Home Reel slot
  const getReelPreloadHint = useCallback(
    (slotIndex: number, reelId: string): 'auto' | 'metadata' | 'none' => {
      if (activeReelId === reelId) return 'auto';

      const anchorId = activeReelId || lastFocusedReelId;
      if (!anchorId) {
        return slotIndex === 0 ? 'metadata' : 'none';
      }

      const anchorIndex = sessionReels.findIndex((r) => r.id === anchorId);
      if (anchorIndex === -1) {
        return slotIndex === 0 ? 'metadata' : 'none';
      }

      if (
        slotIndex === anchorIndex + 1 ||
        slotIndex === anchorIndex - 1 ||
        slotIndex === anchorIndex
      ) {
        return 'metadata';
      }

      return 'none';
    },
    [activeReelId, lastFocusedReelId, sessionReels]
  );

  // Progressive loading architecture:
  // 1. Posts load first and render immediately
  // 2. Secondary content (Stories and Reel candidates) loads progressively without blocking posts
  const loadData = async (forceRefresh = false) => {
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;

    perf.start('HOME', 'Home screen initialization');
    perf.milestone('Initial Home data requested', { forceRefresh });
    const cachedPosts = postsService.getCachedFeedPosts();
    const hasCached = cachedPosts.length > 0;

    if (!hasCached && !forceRefresh) {
      setLoading(true);
    }
    if (forceRefresh) {
      setRefreshing(true);
      sessionReelOrderRef.current = [];
    }

    const postsPromise = postsService
      .getFeedPosts(forceRefresh)
      .then((feedPosts) => {
        setPosts(feedPosts);
        setLoading(false);
        perf.milestone('Posts available', { count: feedPosts.length });
        perf.end('HOME', 'Time until first usable feed content is rendered', {
          postCount: feedPosts.length,
        });
        return feedPosts;
      })
      .catch((err) => {
        console.warn('Failed to load feed posts', err);
        setLoading(false);
        return [];
      });

    const storiesPromise = storiesService
      .getActiveStories(forceRefresh)
      .then((activeStories) => {
        setStories((prev) => (prev === activeStories ? prev : activeStories));
        perf.milestone('Stories available', { count: activeStories.length });
      })
      .catch((err) => console.warn('Failed to load stories', err));

    const reelsPromise = postsPromise
      .then(() => videosService.getRandomFeedVideos(8, forceRefresh))
      .then((feedReels) => {
        setReels(feedReels);
        perf.milestone('Reels available', { count: feedReels.length });
      })
      .catch((err) => console.warn('Failed to load feed reels', err));

    try {
      await Promise.all([postsPromise, storiesPromise, reelsPromise]);
      perf.end('HOME', 'Total time until initial feed is complete');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    perf.milestone('Home rendered');
    scrollFeedToTop('auto', homeContainerRef.current);
  }, []);

  // Manage Google AdMob Native feed lifecycle (attach/pause/destroy) for the Home feed stream
  useEffect(() => {
    getOrCreateHomeNativeFeed()
      .then(() => resumeHomeNativeFeed())
      .catch(() => {});

    return () => {
      void destroyHomeNativeFeed();
    };
  }, []);

  useEffect(() => {
    loadData();
    if (currentUser?.id) {
      storiesService
        .getActiveStories(true)
        .then((activeStories) => {
          setStories((prev) => (prev === activeStories ? prev : activeStories));
        })
        .catch(() => {});
    }
  }, [currentUser?.id]);

  // Periodically prune any Story that crosses the 24-hour expiration boundary while Home is open
  useEffect(() => {
    const pruneInterval = setInterval(() => {
      const nowMs = Date.now();
      setStories((prev) => {
        const active = prev.filter((s) => storiesService.isStoryActive(s, nowMs));
        return active.length === prev.length ? prev : active;
      });
      setActiveStory((prev) => (prev && !storiesService.isStoryActive(prev, nowMs) ? null : prev));
    }, 60_000);
    return () => clearInterval(pruneInterval);
  }, []);

  // Handle Home button re-tap while already on Home
  useEffect(() => {
    if (refreshTrigger <= 0) return;
    setActiveReelId(null);
    visibleReelsMapRef.current.clear();
    scrollFeedToTop('smooth', homeContainerRef.current);
    loadData(true);
  }, [refreshTrigger]);

  // Listen for new reposts or removed reposts so the sharer's Home feed updates immediately
  useEffect(() => {
    const handleRepostCreated = (event: Event) => {
      const customEvent = event as CustomEvent<{
        repost?: Post;
        originalPostId?: string;
        originalVideoId?: string;
      }>;
      const newRepost = customEvent.detail?.repost;
      const origPostId = customEvent.detail?.originalPostId;
      if (newRepost) {
        setPosts((prev) => {
          const updated = prev.map((p) => {
            if (origPostId && (p.id === origPostId || p.originalPostId === origPostId)) {
              return {
                ...p,
                isReposted: true,
                repostsCount: (p.repostsCount || 0) + 1,
              };
            }
            return p;
          });
          if (updated.some((p) => p.id === newRepost.id)) {
            return updated;
          }
          return [newRepost, ...updated];
        });
      } else {
        loadData(true);
      }
    };

    const handleRepostRemoved = (event: Event) => {
      const customEvent = event as CustomEvent<{
        repostId?: string;
        originalPostId?: string;
        originalVideoId?: string;
      }>;
      const repostId = customEvent.detail?.repostId;
      const origPostId = customEvent.detail?.originalPostId;
      setPosts((prev) =>
        prev
          .filter((p) => (repostId ? p.id !== repostId : true))
          .map((p) => {
            if (origPostId && (p.id === origPostId || p.originalPostId === origPostId)) {
              return {
                ...p,
                isReposted: false,
                repostsCount: Math.max(0, (p.repostsCount || 1) - 1),
              };
            }
            return p;
          })
      );
    };

    window.addEventListener('sogo-repost-created', handleRepostCreated);
    window.addEventListener('sogo-repost-removed', handleRepostRemoved);
    return () => {
      window.removeEventListener('sogo-repost-created', handleRepostCreated);
      window.removeEventListener('sogo-repost-removed', handleRepostRemoved);
    };
  }, []);

  // Listen for internal Sogo repost creations/removals and new Story creations to keep Home feed in real-time sync
  useEffect(() => {
    const handleRepostChanged = () => {
      setPosts(postsService.getCachedFeedPosts());
    };
    const handleStoryCreated = () => {
      setStories(storiesService.getCachedStories());
    };
    window.addEventListener('sogo_repost_changed', handleRepostChanged);
    window.addEventListener('sogo_post_comment_counts_updated', handleRepostChanged);
    window.addEventListener('sogo_story_created', handleStoryCreated);
    return () => {
      window.removeEventListener('sogo_post_comment_counts_updated', handleRepostChanged);
      window.removeEventListener('sogo_repost_changed', handleRepostChanged);
      window.removeEventListener('sogo_story_created', handleStoryCreated);
    };
  }, []);

  // Story Viewer Timer Progress
  useEffect(() => {
    if (!activeStory) return;
    setStoryProgress(0);
    const interval = setInterval(() => {
      setStoryProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setActiveStory(null);
          return 0;
        }
        return prev + 2;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [activeStory]);

  const handleLike = async (postId: string) => {
    const updated = await postsService.toggleLikePost(postId, currentUser);
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId || p.originalPostId === postId
          ? { ...p, isLiked: updated.isLiked, likesCount: updated.likesCount }
          : p
      )
    );
  };

  const handleBookmark = async (postId: string) => {
    const isBookmarked = await postsService.toggleBookmarkPost(postId);
    setPosts((prev) =>
      prev.map((p) => (p.id === postId || p.originalPostId === postId ? { ...p, isBookmarked } : p))
    );
  };

  const handleQuickComment = async (postId: string, text: string) => {
    if (!currentUser) return;
    await postsService.addComment(
      postId,
      {
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
      },
      text
    );
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId || p.originalPostId === postId
          ? { ...p, commentsCount: p.commentsCount + 1 }
          : p
      )
    );
  };

  const handleStoryClick = (story: Story) => {
    setActiveStory(story);
    storiesService.markStorySeen(story.id);
    setStories((prev) =>
      prev.map((s) => (s.id === story.id ? { ...s, hasSeen: true } : s))
    );
  };

  const handleShare = async (post: Post) => {
    await sharePost(post, {
      onCopied: () => {
        setShareCopiedToast(true);
        setTimeout(() => setShareCopiedToast(false), 2500);
      },
    });
  };

  const handlePostDeleted = (deletedPostId: string) => {
    setPosts((prev) =>
      prev.filter((p) => p.id !== deletedPostId && p.originalPostId !== deletedPostId)
    );
  };

  const handlePostUpdated = (updatedPost: Post) => {
    setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)));
  };

  return (
    <div ref={homeContainerRef} className="space-y-5">
      {/* Google AdMob test banner; rendered only while the Home screen is mounted */}
      <HomeBannerAd />

      {/* "What's on your mind?" Composer Entry Widget */}
      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-3.5 sm:p-4 shadow-sm">
        <button
          type="button"
          onClick={() => onNavigateCreate('post')}
          aria-label="Create a post"
          className="w-full flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
        >
          <Avatar
            src={currentUser?.avatarUrl}
            alt={currentUser?.displayName || currentUser?.username || 'Creator'}
            size="md"
          />
          <div className="flex-1 px-4 py-2.5 rounded-full bg-slate-800/80 group-hover:bg-slate-800 border border-slate-700/70 group-hover:border-cyan-500/40 text-sm text-slate-400 group-hover:text-slate-200 transition-all truncate">
            What&apos;s on your mind?
          </div>
        </button>
      </section>

      {/* Top Stories Reel */}
      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-3.5 sm:p-4 shadow-sm">
        <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-1">
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigateCreate('story')}
              className="relative w-14 h-14 rounded-full bg-slate-800 border-2 border-dashed border-slate-700 hover:border-cyan-400 flex items-center justify-center text-slate-400 hover:text-cyan-400 transition-colors focus:outline-none group cursor-pointer"
            >
              <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
            </button>
            <span className="text-xs font-medium text-slate-300">Your Story</span>
          </div>

          {stories.map((story) => (
            <StoryItem
              key={story.id}
              story={story}
              allStories={stories}
              onClick={handleStoryClick}
            />
          ))}
        </div>
      </section>

      {/* Feed Stream */}
      {loading ? (
        <LoadingState message="Fetching your SogoSocial feed..." />
      ) : posts.length === 0 && sessionReels.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            icon={<Sparkles className="w-6 h-6 text-cyan-400" />}
            title="No Posts in Feed"
            description="Be the very first creator to share a photo or thought with the community!"
            actionText="Create a Post"
            onAction={() => onNavigateCreate('post')}
          />
        </div>
      ) : (
        <section className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Latest Stories & Posts
            </span>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => loadData(true)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>

          {posts.length === 0 ? (
            <>
              {onVideoClick &&
                sessionReels.slice(0, 2).map((reel, reelIdx) => (
                  <HomeFeedReelCard
                    key={`home-reel-${reel.id}`}
                    video={reel}
                    isActive={activeReelId === reel.id}
                    isMuted={isReelMuted}
                    preloadHint={getReelPreloadHint(reelIdx, reel.id)}
                    onToggleMute={handleToggleReelMute}
                    onVisibilityChange={handleReelVisibilityChange}
                    onOpenReel={handleOpenReel}
                    onUserClick={onUserClick}
                    onVideoUpdated={handleReelUpdated}
                    onVideoDeleted={handleReelDeleted}
                  />
                ))}
              <EmptyState
                icon={<Sparkles className="w-6 h-6 text-cyan-400" />}
                title="No Posts in Feed"
                description="Be the very first creator to share a photo or thought with the community!"
                actionText="Create a Post"
                onAction={() => onNavigateCreate('post')}
              />
            </>
          ) : (
            posts.map((post, idx) => {
              const isIntervalSlot = (idx + 1) % HOME_REEL_INSERTION_INTERVAL === 0;
              const isFallbackSinglePostSlot =
                posts.length < HOME_REEL_INSERTION_INTERVAL && idx === posts.length - 1;
              const shouldInsertReel =
                Boolean(onVideoClick) && (isIntervalSlot || isFallbackSinglePostSlot);
              const reelSlotIndex = isIntervalSlot
                ? Math.floor((idx + 1) / HOME_REEL_INSERTION_INTERVAL) - 1
                : 0;
              const insertedReel =
                shouldInsertReel && reelSlotIndex < sessionReels.length
                  ? sessionReels[reelSlotIndex]
                  : null;

              const isNativeAdSlot = (idx + 1) % HOME_NATIVE_AD_INTERVAL === 0;
              const nativeSlotIndex = Math.floor((idx + 1) / HOME_NATIVE_AD_INTERVAL);
              const nativeSlotKey = `home-native-ad-slot-${nativeSlotIndex}`;

              return (
                <React.Fragment key={post.id}>
                  <PostCard
                    post={post}
                    priority={idx < 2}
                    onLike={handleLike}
                    onBookmark={handleBookmark}
                    onCommentClick={onPostClick}
                    onUserClick={onUserClick}
                    onVideoClick={onVideoClick}
                    onShare={handleShare}
                    onQuickComment={handleQuickComment}
                    onPostDeleted={handlePostDeleted}
                    onPostUpdated={handlePostUpdated}
                  />

                  {insertedReel && (
                    <HomeFeedReelCard
                      key={`home-reel-${insertedReel.id}`}
                      video={insertedReel}
                      isActive={activeReelId === insertedReel.id}
                      isMuted={isReelMuted}
                      preloadHint={getReelPreloadHint(reelSlotIndex, insertedReel.id)}
                      onToggleMute={handleToggleReelMute}
                      onVisibilityChange={handleReelVisibilityChange}
                      onOpenReel={handleOpenReel}
                      onUserClick={onUserClick}
                      onVideoUpdated={handleReelUpdated}
                      onVideoDeleted={handleReelDeleted}
                    />
                  )}

                  {isNativeAdSlot && (
                    <NativeFeedAdCard
                      key={nativeSlotKey}
                      slotKey={nativeSlotKey}
                    />
                  )}
                </React.Fragment>
              );
            })
          )}
        </section>
      )}

      {/* Full-screen Active Story Viewer Modal */}
      <AnimatePresence>
        {activeStory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm"
          >
            <div className="relative w-full max-w-sm aspect-9/16 bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col justify-between">
              <div className="absolute top-3 inset-x-3 z-20 flex gap-1">
                <div className="h-1 bg-white/30 rounded-full flex-1 overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-100 ease-linear"
                    style={{ width: `${storyProgress}%` }}
                  />
                </div>
              </div>

              <div className="relative z-20 p-4 pt-6 flex items-center justify-between text-white bg-gradient-to-b from-black/70 to-transparent">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    src={activeStory.user.avatarUrl}
                    alt={activeStory.user.displayName || activeStory.user.username}
                    size="sm"
                    className="border border-cyan-400/60"
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold flex items-center gap-1">
                      <span>{activeStory.user.username}</span>
                      <VerifiedBadge
                        userId={activeStory.user.id || activeStory.userId}
                        username={activeStory.user.username}
                        isVerified={activeStory.user.isVerified}
                        size="xs"
                      />
                    </span>
                    {activeStory.createdAt && (
                      <span className="text-[11px] text-slate-300/80 font-medium">
                        {formatRelativeTime(activeStory.createdAt)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStory(null)}
                  className="p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white focus:outline-none"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {(() => {
                const resolvedMedia = getStoryMediaUrl(activeStory, stories) || activeStory.mediaUrl;
                if (isStoryVideoMedia(resolvedMedia, activeStory.mediaType)) {
                  return (
                    <video
                      src={getOptimizedCloudinaryVideoUrl(resolvedMedia)}
                      autoPlay
                      playsInline
                      muted
                      loop
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  );
                }
                return (
                  <img
                    src={resolvedMedia}
                    alt="Story content"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                );
              })()}

              <div className="relative z-20 p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Send reply..."
                  className="flex-1 px-4 py-2 bg-slate-900/60 backdrop-blur-md rounded-xl text-xs text-white placeholder:text-slate-400 focus:outline-none border border-slate-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    setActiveStory(null);
                  }}
                  className="px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-900 text-xs font-bold rounded-xl shadow-md shadow-cyan-500/20"
                >
                  Send
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share copied toast */}
      {shareCopiedToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white border border-slate-700 px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Post link copied to clipboard!</span>
        </div>
      )}
    </div>
  );
};
