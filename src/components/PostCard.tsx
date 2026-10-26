import React, { useState, useEffect, useRef } from 'react';
import { Post } from '../types';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { PostActions } from './PostActions';
import { ShareModal } from './ShareModal';
import { formatRelativeTime, useRelativeTime, getOptimizedPosterUrl, getOptimizedImageUrl, getOptimizedCloudinaryVideoUrl } from '../lib/utils';
import { FeedImage } from './FeedImage';
import {
  CheckCircle2,
  MoreHorizontal,
  MapPin,
  Heart,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Loader2,
  Share2,
  Repeat2,
  Play,
  Film,
  ExternalLink,
  Flag,
  UserX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import * as postsService from '../services/postsService';
import * as videosService from '../services/videosService';
import * as usersService from '../services/usersService';
import { ImageViewer } from './ImageViewer';
import { VerifiedBadge } from './VerifiedBadge';
import { ReportModal } from './ReportModal';
import { BlockConfirmModal } from './BlockConfirmModal';

export interface PostCardProps {
  post: Post;
  priority?: boolean;
  onLike: (postId: string) => void;
  onBookmark: (postId: string) => void;
  onCommentClick: (post: Post) => void;
  onUserClick?: (userId: string) => void;
  onVideoClick?: (videoId: string) => void;
  onShare?: (post: Post) => void;
  onQuickComment?: (postId: string, text: string) => void;
  onPostDeleted?: (postId: string) => void;
  onPostUpdated?: (updatedPost: Post) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  priority = false,
  onLike,
  onBookmark,
  onCommentClick,
  onUserClick,
  onVideoClick,
  onQuickComment,
  onPostDeleted,
  onPostUpdated,
}) => {
  const { currentUser } = useAuth();
  const [currentPost, setCurrentPost] = useState<Post>(post);
  const [showHeartOverlay, setShowHeartOverlay] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // Three-dot action menu and modal states
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);

  // Single-tap vs double-tap detection for media image
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const hasViewTrackedRef = useRef(false);

  // Edit state
  const [editCaption, setEditCaption] = useState(currentPost.caption);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Synchronize local post state if parent provides updated props
  useEffect(() => {
    setCurrentPost(post);
    setEditCaption(post.caption);
  }, [post]);

  // Listen for profile updates (avatarUrl / displayName) so active feed cards update immediately
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
      const newName = detail.displayName || detail.user?.displayName;
      const newAvatar = detail.avatarUrl || detail.user?.avatarUrl;

      setCurrentPost((prev) => {
        let next = prev;
        if (prev.user?.id === detail.userId || (!prev.isRepost && prev.userId === detail.userId)) {
          next = {
            ...next,
            user: {
              ...next.user,
              ...(newName ? { displayName: newName } : {}),
              ...(newAvatar ? { avatarUrl: newAvatar } : {}),
            },
          };
        }
        if (prev.repostedBy?.id === detail.userId || prev.sharedByUid === detail.userId) {
          next = {
            ...next,
            repostedBy: next.repostedBy
              ? {
                  ...next.repostedBy,
                  ...(newName ? { displayName: newName } : {}),
                  ...(newAvatar ? { avatarUrl: newAvatar } : {}),
                }
              : next.repostedBy,
          };
        }
        return next;
      });
    };

    window.addEventListener('sogo_profile_updated', handleProfileUpdated);
    return () => {
      window.removeEventListener('sogo_profile_updated', handleProfileUpdated);
    };
  }, []);

  useEffect(() => {
    const handleVideoBookmarkChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string; isBookmarked: boolean }>;
      const detail = customEvent.detail;
      if (!detail?.videoId) return;
      setCurrentPost((prev) =>
        prev.repostType === 'video' && prev.originalVideoId === detail.videoId
          ? { ...prev, isBookmarked: detail.isBookmarked }
          : prev
      );
    };

    window.addEventListener('sogo_video_bookmark_changed', handleVideoBookmarkChanged);
    return () => {
      window.removeEventListener('sogo_video_bookmark_changed', handleVideoBookmarkChanged);
    };
  }, []);

  const isRepost = Boolean(currentPost.isRepost);
  const isVideoRepost = Boolean(isRepost && currentPost.repostType === 'video' && currentPost.originalVideoId);
  const canonicalPostId = currentPost.originalPostId || currentPost.id;

  const originalTimestamp =
    currentPost.originalCreatedAt ||
    (currentPost as any).timestamp ||
    (currentPost as any).created_at ||
    currentPost.createdAt;
  const relativeUploadTime = useRelativeTime(originalTimestamp);
  const repostRelativeTime = useRelativeTime(isRepost ? currentPost.createdAt : null);

  // Meaningful View Tracking:
  // Uses IntersectionObserver to count a post view ONLY when it is visible in the viewport
  // for at least 1.5 seconds. Attaches views to the ORIGINAL post ID.
  useEffect(() => {
    if (isVideoRepost) return; // Video views are tracked inside the Reels viewer
    hasViewTrackedRef.current = false;
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    let visibilityTimer: NodeJS.Timeout | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!hasViewTrackedRef.current && !visibilityTimer) {
            visibilityTimer = setTimeout(async () => {
              if (!hasViewTrackedRef.current) {
                hasViewTrackedRef.current = true;
                const newCount = await postsService.incrementPostViews(canonicalPostId);
                if (newCount !== null) {
                  setCurrentPost((prev) => ({
                    ...prev,
                    viewsCount: newCount,
                  }));
                }
              }
            }, 1500);
          }
        } else {
          if (visibilityTimer) {
            clearTimeout(visibilityTimer);
            visibilityTimer = null;
          }
        }
      },
      {
        threshold: 0.5,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (visibilityTimer) clearTimeout(visibilityTimer);
    };
  }, [canonicalPostId, isVideoRepost]);

  // Determine if the current authenticated user is the original author of this post
  // Note: If this card is a repost, only the original author owns the original post;
  // the reposter owns the repost reference (isRepostOwner).
  const isOriginalOwner = Boolean(
    !isRepost &&
      currentUser &&
      (currentUser.id === currentPost.userId ||
        currentUser.id === currentPost.user?.id ||
        (currentPost.user?.username && currentUser.username === currentPost.user.username))
  );

  const isRepostOwner = Boolean(
    isRepost && currentUser && currentPost.repostedBy?.id === currentUser.id
  );

  const authorId = currentPost.user?.id || currentPost.userId;
  const isOwnPost = Boolean(
    currentUser &&
      (currentUser.id === authorId ||
        (currentPost.user?.username && currentUser.username === currentPost.user.username))
  );

  const [isFollowing, setIsFollowing] = useState<boolean>(() => {
    if (!authorId || isOwnPost) return false;
    return usersService.isFollowingUser(authorId, currentUser?.id);
  });
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  useEffect(() => {
    if (!authorId || isOwnPost) return;
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
  }, [authorId, currentUser?.id, isOwnPost]);

  const handleFollowToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!authorId || isOwnPost || isFollowLoading) return;

    setIsFollowLoading(true);
    try {
      const newStatus = await usersService.toggleFollowUser(authorId, currentUser);
      setIsFollowing(newStatus);
    } catch (err) {
      console.error('Failed to toggle follow status:', err);
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Builds the canonical original Post object so tapping a repost opens the ORIGINAL post
  const getCanonicalOriginalPost = (): Post => {
    if (!isRepost) return currentPost;
    return {
      ...currentPost,
      id: canonicalPostId,
      isRepost: false,
      repostId: undefined,
      repostedBy: undefined,
      createdAt: currentPost.originalCreatedAt || currentPost.createdAt,
    };
  };

  const handleOpenOriginalTarget = () => {
    if (isVideoRepost && currentPost.originalVideoId) {
      onVideoClick?.(currentPost.originalVideoId);
      return;
    }
    onCommentClick(getCanonicalOriginalPost());
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimerRef.current) {
      // Double click detected: cancel single-click and trigger like animation on original item
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      handleDoubleTap();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        // When tapping a shared item, open the ORIGINAL post (or Reel viewer for video reposts)
        if (isRepost) {
          handleOpenOriginalTarget();
        } else {
          setIsImageViewerOpen(true);
        }
      }, 250);
    }
  };

  const handleActionLike = async () => {
    const prevLiked = Boolean(currentPost.isLiked);
    const prevCount = Number(currentPost.likesCount) || 0;
    const nextLiked = !prevLiked;
    const nextCount = nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1);

    setCurrentPost((prev) => ({
      ...prev,
      isLiked: nextLiked,
      likesCount: nextCount,
    }));

    if (isVideoRepost && currentPost.originalVideoId) {
      if (!currentUser) {
        setCurrentPost((prev) => ({
          ...prev,
          isLiked: prevLiked,
          likesCount: prevCount,
        }));
        return;
      }
      try {
        const res = await videosService.toggleLikeVideo(
          currentPost.originalVideoId,
          currentUser.id,
          {
            id: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
          prevLiked
        );
        setCurrentPost((prev) => ({
          ...prev,
          isLiked: res.isLiked,
          likesCount: res.likesCount,
        }));
      } catch {
        setCurrentPost((prev) => ({
          ...prev,
          isLiked: prevLiked,
          likesCount: prevCount,
        }));
      }
      return;
    }
    onLike(canonicalPostId);
  };

  const handleDoubleTap = () => {
    if (!currentPost.isLiked) {
      handleActionLike();
    }
    setShowHeartOverlay(true);
    setTimeout(() => setShowHeartOverlay(false), 800);
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim()) return;
    const text = commentInput.trim();
    if (isVideoRepost && currentPost.originalVideoId && currentUser) {
      setCommentInput('');
      setCurrentPost((prev) => ({
        ...prev,
        commentsCount: prev.commentsCount + 1,
      }));
      videosService
        .addVideoComment(
          currentPost.originalVideoId,
          {
            id: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
          text
        )
        .catch(() => {
          setCurrentPost((prev) => ({
            ...prev,
            commentsCount: Math.max(0, prev.commentsCount - 1),
          }));
        });
      return;
    }
    setCommentInput('');
    setCurrentPost((prev) => ({
      ...prev,
      commentsCount: prev.commentsCount + 1,
    }));
    if (onQuickComment) {
      onQuickComment(canonicalPostId, text);
    } else if (currentUser) {
      postsService
        .addComment(
          canonicalPostId,
          {
            id: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
          text
        )
        .catch(() => {
          setCurrentPost((prev) => ({
            ...prev,
            commentsCount: Math.max(0, prev.commentsCount - 1),
          }));
        });
    }
  };

  const handleOpenEdit = () => {
    setEditCaption(currentPost.caption);
    setSaveError(null);
    setIsMenuOpen(false);
    setIsEditModalOpen(true);
  };

  const handleOpenDelete = () => {
    setDeleteError(null);
    setIsMenuOpen(false);
    setIsDeleteConfirmOpen(true);
  };

  const handleSaveEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editCaption.trim()) {
      setSaveError('Post caption cannot be empty.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const updated = await postsService.updatePost(currentPost.id, {
        caption: editCaption.trim(),
      });
      setCurrentPost(updated);
      onPostUpdated?.(updated);
      setIsEditModalOpen(false);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      if (isRepostOwner && currentPost.repostId) {
        await postsService.removeRepostFromSogo(currentPost.repostId);
        setIsDeleteConfirmOpen(false);
        onPostDeleted?.(currentPost.id);
      } else {
        await postsService.deletePost(currentPost.id);
        setIsDeleteConfirmOpen(false);
        onPostDeleted?.(currentPost.id);
      }
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <>
      <article
        ref={cardRef}
        className="bg-slate-900 rounded-2xl border border-slate-800 shadow-sm overflow-hidden mb-6 transition-all hover:border-slate-700"
      >
        {/* Sogo Repost Attribution Banner */}
        {isRepost && currentPost.repostedBy && (
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-2 bg-slate-950/60 border-b border-slate-800/80 text-xs">
            <div className="flex items-center gap-2 min-w-0 text-emerald-400 font-semibold">
              <Repeat2 className="w-3.5 h-3.5 shrink-0" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUserClick?.(currentPost.repostedBy!.id);
                }}
                className="hover:underline truncate text-left focus:outline-none cursor-pointer inline-flex items-center gap-1"
              >
                <span className="truncate">
                  {currentUser?.id === currentPost.repostedBy.id
                    ? 'You shared'
                    : `Shared by ${currentPost.repostedBy.displayName?.trim() || currentPost.repostedBy.username || 'User'}`}
                </span>
                {currentUser?.id !== currentPost.repostedBy.id && (
                  <VerifiedBadge
                    userId={currentPost.repostedBy.id}
                    username={currentPost.repostedBy.username}
                    isVerified={currentPost.repostedBy.isVerified}
                    size="xs"
                  />
                )}
              </button>
              {repostRelativeTime && (
                <span className="text-slate-500 font-normal shrink-0">
                  · {repostRelativeTime}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenOriginalTarget();
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 shrink-0 ml-2 cursor-pointer"
            >
              <span>{isVideoRepost ? 'Watch Reel' : 'View Original'}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Post Header (Always displays the ORIGINAL creator's identity and attribution) */}
        <div className="flex items-center justify-between p-3.5 sm:p-4">
          <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
            <Avatar
              src={currentPost.user.avatarUrl}
              alt={currentPost.user.displayName || currentPost.user.username || 'User'}
              size="md"
              onClick={() => onUserClick?.(currentPost.user.id)}
            />
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onUserClick?.(currentPost.user.id)}
                  className="font-bold text-sm text-white hover:underline flex items-center gap-1 focus:outline-none min-w-0 cursor-pointer"
                >
                  <span className="truncate">
                    {currentPost.user.displayName?.trim() || currentPost.user.username || 'User'}
                  </span>
                  <VerifiedBadge
                    userId={currentPost.user.id}
                    username={currentPost.user.username}
                    isVerified={currentPost.user.isVerified}
                    size="md"
                  />
                </button>
                {relativeUploadTime && (
                  <>
                    <span className="text-xs text-slate-500 shrink-0" aria-hidden="true">
                      ·
                    </span>
                    <time
                      dateTime={typeof originalTimestamp === 'string' ? originalTimestamp : undefined}
                      className="text-xs text-slate-400 whitespace-nowrap shrink-0"
                    >
                      {relativeUploadTime}
                    </time>
                  </>
                )}
              </div>
              {currentPost.location && (
                <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                  <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate max-w-[150px] sm:max-w-[220px]">{currentPost.location}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

            {!isOwnPost && currentUser && (
              <Button
                type="button"
                id={`post-follow-btn-${currentPost.id}`}
                variant={isFollowing ? 'secondary' : 'primary'}
                size="sm"
                isLoading={isFollowLoading}
                onClick={handleFollowToggle}
                className="shrink-0 text-xs font-semibold px-2.5 py-1 sm:px-3 sm:py-1 rounded-full touch-manipulation"
                aria-label={isFollowing ? `Unfollow @${currentPost.user.username}` : `Follow @${currentPost.user.username}`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Button>
            )}

            <button
              type="button"
              id={`post-menu-btn-${currentPost.id}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsMenuOpen(true);
              }}
              className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-slate-200 active:text-white rounded-xl hover:bg-slate-800 active:bg-slate-700 transition-colors touch-manipulation focus:outline-none cursor-pointer"
              aria-label="Post options menu"
              aria-expanded={isMenuOpen}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Post Media (Reel Repost Preview, Video, or Image) */}
        {isVideoRepost && currentPost.originalVideoId ? (
          <div
            onClick={() => onVideoClick?.(currentPost.originalVideoId!)}
            className="relative w-full aspect-9/16 max-h-[65vh] bg-slate-900 cursor-pointer select-none overflow-hidden flex items-center justify-center group"
            role="button"
            tabIndex={0}
            aria-label={`Open Reel by @${currentPost.user.username}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onVideoClick?.(currentPost.originalVideoId!);
              }
            }}
          >
            {currentPost.videoThumbnailUrl || currentPost.thumbnailUrl || currentPost.imageUrl ? (
              <FeedImage
                src={
                  getOptimizedPosterUrl(
                    currentPost.videoThumbnailUrl || currentPost.thumbnailUrl || currentPost.imageUrl
                  ) ||
                  currentPost.videoThumbnailUrl ||
                  currentPost.thumbnailUrl ||
                  currentPost.imageUrl ||
                  ''
                }
                alt={currentPost.caption || 'Shared Reel'}
                variant="reel-poster"
                priority={priority}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-600">
                <Film className="w-12 h-12" />
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none z-20" />

            {/* Top-left Reel Badge */}
            <div className="absolute top-3 left-3 z-20 px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md border border-cyan-500/30 flex items-center gap-1.5 text-[11px] font-bold text-cyan-400">
              <Film className="w-3.5 h-3.5" />
              <span>Sogo Reel</span>
            </div>

            {/* Center Play Button */}
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="w-14 h-14 rounded-full bg-cyan-500/90 text-slate-950 flex items-center justify-center shadow-xl shadow-cyan-500/30 group-hover:scale-110 transition-transform">
                <Play className="w-6 h-6 fill-current ml-0.5" />
              </div>
            </div>
          </div>
        ) : currentPost.videoUrl ? (
          <div className="relative aspect-16/9 bg-slate-950 overflow-hidden flex items-center justify-center">
            <video
              src={getOptimizedCloudinaryVideoUrl(currentPost.videoUrl)}
              poster={getOptimizedPosterUrl(currentPost.thumbnailUrl, currentPost.videoUrl)}
              controls
              playsInline
              preload="metadata"
              className="w-full h-full object-contain"
            />
          </div>
        ) : currentPost.imageUrl ? (
          <FeedImage
            src={currentPost.imageUrl}
            alt={currentPost.caption || 'Post image'}
            variant="feed"
            priority={priority}
            onClick={handleImageClick}
          >
            {/* Double-tap Heart Animation */}
            <AnimatePresence>
              {showHeartOverlay && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1.2, opacity: 0.95 }}
                  exit={{ scale: 1.4, opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
                >
                  <Heart className="w-24 h-24 text-white fill-rose-500 drop-shadow-xl" />
                </motion.div>
              )}
            </AnimatePresence>
          </FeedImage>
        ) : null}

        {/* Interactive Actions */}
        <div className="px-3.5 sm:px-4 pt-1">
          <PostActions
            isLiked={currentPost.isLiked}
            likesCount={currentPost.likesCount}
            commentsCount={currentPost.commentsCount}
            viewsCount={currentPost.viewsCount ?? 0}
            repostsCount={currentPost.repostsCount ?? 0}
            isReposted={isRepostOwner || currentPost.isReposted}
            isBookmarked={currentPost.isBookmarked}
            onLike={handleActionLike}
            onComment={handleOpenOriginalTarget}
            onBookmark={async () => {
              if (isVideoRepost && currentPost.originalVideoId) {
                const prev = Boolean(currentPost.isBookmarked);
                setCurrentPost((p) => ({ ...p, isBookmarked: !prev }));
                try {
                  const next = await postsService.toggleBookmarkVideo(currentPost.originalVideoId);
                  setCurrentPost((p) => ({ ...p, isBookmarked: next }));
                } catch {
                  setCurrentPost((p) => ({ ...p, isBookmarked: prev }));
                }
              } else {
                onBookmark(canonicalPostId);
              }
            }}
            onShare={() => setIsShareModalOpen(true)}
          />

          {/* Caption and Tags */}
          <div
            className={`pb-3 text-sm ${isRepost ? 'cursor-pointer' : ''}`}
            onClick={() => {
              if (isRepost) {
                handleOpenOriginalTarget();
              }
            }}
          >
            <p className="text-slate-300 leading-relaxed">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUserClick?.(currentPost.user.id);
                }}
                className="font-bold text-white hover:underline mr-1.5 inline-flex items-center gap-1 align-baseline focus:outline-none cursor-pointer"
              >
                <span>{currentPost.user.displayName?.trim() || currentPost.user.username || 'User'}</span>
                <VerifiedBadge
                  userId={currentPost.user.id}
                  username={currentPost.user.username}
                  isVerified={currentPost.user.isVerified}
                  size="xs"
                />
              </button>
              {currentPost.caption.length > 120 && !isExpanded ? (
                <>
                  <span>{currentPost.caption.slice(0, 120)}... </span>
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
                <span>{currentPost.caption}</span>
              )}
            </p>

            {currentPost.tags && currentPost.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {currentPost.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium hover:underline cursor-pointer"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* View Comments Link */}
            {currentPost.commentsCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenOriginalTarget();
                }}
                className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-200 block focus:outline-none cursor-pointer"
              >
                View all {currentPost.commentsCount} {currentPost.commentsCount === 1 ? 'comment' : 'comments'}
              </button>
            )}
          </div>

          {/* Quick Comment Input */}
          <form
            onSubmit={handleCommentSubmit}
            className="flex items-center gap-2 py-2.5 border-t border-slate-800"
          >
            <input
              type="text"
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 text-xs text-slate-200 placeholder:text-slate-500 bg-transparent focus:outline-none"
            />
            {commentInput.trim() && (
              <button
                type="submit"
                className="text-xs font-bold text-cyan-400 hover:text-cyan-300 focus:outline-none transition-colors cursor-pointer"
              >
                Post
              </button>
            )}
          </form>
        </div>
      </article>

      {/* Share Menu Modal (Share to Sogo / Share to other apps / Copy link) */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        targetType={isVideoRepost ? 'video' : 'post'}
        post={currentPost}
        onRepostSuccess={() => {
          setCurrentPost((prev) => ({
            ...prev,
            repostsCount: (prev.repostsCount || 0) + 1,
            isReposted: true,
          }));
        }}
        onRepostRemoved={() => {
          setCurrentPost((prev) => ({
            ...prev,
            repostsCount: Math.max(0, (prev.repostsCount || 1) - 1),
            isReposted: false,
          }));
        }}
      />

      {/* Three-Dot Action Menu (Bottom Sheet on Mobile, Centered Modal on Desktop) */}
      <AnimatePresence>
        {isMenuOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            />

            {/* Menu Panel */}
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative z-10 w-full sm:max-w-sm bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 shadow-2xl space-y-2 mb-0 sm:mb-auto"
            >
              {/* Mobile grab handle */}
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-3 sm:hidden" />

              <div className="text-center pb-2 border-b border-slate-800/80">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {isRepost ? 'Repost Options' : 'Post Options'}
                </span>
              </div>

              {isOriginalOwner ? (
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    id={`edit-post-btn-${currentPost.id}`}
                    onClick={handleOpenEdit}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 shrink-0">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <span>Edit Post</span>
                  </button>

                  <button
                    type="button"
                    id={`share-own-post-btn-${currentPost.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsShareModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span>Share Post</span>
                  </button>

                  <button
                    type="button"
                    id={`delete-post-btn-${currentPost.id}`}
                    onClick={handleOpenDelete}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <span>Delete Post</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 pt-1">
                  {isRepost && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        handleOpenOriginalTarget();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 shrink-0">
                        <ExternalLink className="w-4 h-4" />
                      </div>
                      <span>{isVideoRepost ? 'Open Original Reel' : 'Open Original Post'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    id={`share-post-menu-btn-${currentPost.id}`}
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsShareModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-750 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span>Share {isVideoRepost ? 'Reel' : 'Post'}</span>
                  </button>

                  {!isOwnPost && authorId && (
                    <>
                      <button
                        type="button"
                        id={`report-post-btn-${currentPost.id}`}
                        onClick={() => {
                          setIsMenuOpen(false);
                          setIsReportModalOpen(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                          <Flag className="w-4 h-4" />
                        </div>
                        <span>Report {isVideoRepost ? 'Reel' : 'Post'}</span>
                      </button>

                      <button
                        type="button"
                        id={`block-user-post-btn-${currentPost.id}`}
                        onClick={() => {
                          setIsMenuOpen(false);
                          setIsBlockModalOpen(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                          <UserX className="w-4 h-4" />
                        </div>
                        <span>Block {currentPost.user?.username ? `@${currentPost.user.username}` : 'User'}</span>
                      </button>
                    </>
                  )}

                  {isRepostOwner && (
                    <button
                      type="button"
                      onClick={handleOpenDelete}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </div>
                      <span>Remove Repost</span>
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                id={`cancel-menu-btn-${currentPost.id}`}
                onClick={() => setIsMenuOpen(false)}
                className="w-full py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 active:bg-slate-700 transition-colors mt-2 border border-slate-750 focus:outline-none min-h-[44px] touch-manipulation cursor-pointer"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Post Modal */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSaving && setIsEditModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-xs"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <Pencil className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-base text-white">Edit Post</h3>
                </div>
                <button
                  type="button"
                  onClick={() => !isSaving && setIsEditModalOpen(false)}
                  disabled={isSaving}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none disabled:opacity-50"
                  aria-label="Close edit modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <form onSubmit={handleSaveEdit} className="p-4 sm:p-5 space-y-4">
                {saveError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{saveError}</span>
                  </div>
                )}

                {/* Post Preview Snippet */}
                <div className="flex items-center gap-3 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                  <img
                    src={getOptimizedImageUrl(currentPost.imageUrl, 200)}
                    alt="Post thumbnail"
                    loading="lazy"
                    decoding="async"
                    className="w-14 h-14 object-cover rounded-lg shrink-0 border border-slate-700"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">
                      {currentPost.user.displayName}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      @{currentPost.user.username}
                    </p>
                    {relativeUploadTime && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Published {relativeUploadTime === 'Just now' ? 'just now' : `${relativeUploadTime} ago`}
                      </p>
                    )}
                  </div>
                </div>

                {/* Caption Input */}
                <div className="space-y-1.5">
                  <label
                    htmlFor={`edit-caption-${currentPost.id}`}
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Post Caption / Description
                  </label>
                  <textarea
                    id={`edit-caption-${currentPost.id}`}
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    rows={4}
                    placeholder="Write a caption..."
                    disabled={isSaving}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 transition-colors resize-none"
                  />
                  <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                    <span>Markdown & hashtags supported</span>
                    <span>{editCaption.length} characters</span>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    disabled={isSaving}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 min-h-[44px] touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    id={`save-post-edit-btn-${currentPost.id}`}
                    disabled={isSaving || !editCaption.trim()}
                    className="px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 active:scale-98 rounded-xl shadow-md shadow-cyan-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] touch-manipulation"
                  >
                    {isSaving ? (
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

      {/* Delete / Remove Repost Confirmation Dialog */}
      <AnimatePresence>
        {isDeleteConfirmOpen && (
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
                {isRepostOwner ? 'Remove Repost?' : 'Delete Post?'}
              </h3>
              <p className="text-xs text-slate-400 mb-5 leading-relaxed px-2">
                {isRepostOwner
                  ? 'This will remove your repost from the Sogo timeline. The original creator’s post will remain intact.'
                  : 'Are you sure you want to permanently delete this post? This action will remove it from the feed and cannot be undone.'}
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
                  id={`confirm-delete-btn-${currentPost.id}`}
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-lg shadow-rose-600/20 flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px] touch-manipulation cursor-pointer"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{isRepostOwner ? 'Removing...' : 'Deleting Post...'}</span>
                    </>
                  ) : (
                    <span>{isRepostOwner ? 'Remove Repost' : 'Delete Post'}</span>
                  )}
                </button>

                <button
                  type="button"
                  id={`cancel-delete-btn-${currentPost.id}`}
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

      {/* Full-Screen Lightbox Image Viewer */}
      {currentPost.imageUrl && !isRepost && (
        <ImageViewer
          isOpen={isImageViewerOpen}
          imageUrl={currentPost.imageUrl}
          feedImageUrl={getOptimizedImageUrl(currentPost.imageUrl, 1080) || currentPost.imageUrl}
          altText={currentPost.caption || 'Post image'}
          caption={currentPost.caption}
          onClose={() => setIsImageViewerOpen(false)}
        />
      )}

      {/* Moderation & Block Dialogs */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetType={isVideoRepost ? 'video' : 'post'}
        targetId={isVideoRepost && currentPost.originalVideoId ? currentPost.originalVideoId : currentPost.id}
        targetAuthorId={authorId || ''}
        targetAuthorUsername={currentPost.user?.username}
        targetTitleOrCaption={currentPost.caption}
      />

      <BlockConfirmModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        targetUserId={authorId || ''}
        targetUsername={currentPost.user?.username}
        targetDisplayName={currentPost.user?.displayName}
        targetAvatarUrl={currentPost.user?.avatarUrl}
        onBlockedSuccess={() => {
          onPostDeleted?.(currentPost.id);
        }}
      />
    </>
  );
};
