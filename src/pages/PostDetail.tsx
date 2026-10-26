import React, { useState, useEffect } from 'react';
import { Post, Comment } from '../types';
import { PostCard } from '../components/PostCard';
import { CommentItem } from '../components/CommentItem';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../hooks/useAuth';
import * as postsService from '../services/postsService';
import { sharePost } from '../services/shareService';
import { ArrowLeft, Send, Check } from 'lucide-react';

export interface PostDetailProps {
  post: Post;
  onBack: () => void;
  onUserClick?: (userId: string) => void;
}

export const PostDetail: React.FC<PostDetailProps> = ({ post, onBack, onUserClick }) => {
  const { currentUser } = useAuth();
  const [currentPost, setCurrentPost] = useState<Post>(post);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shareCopiedToast, setShareCopiedToast] = useState(false);

  const canonicalPostId = currentPost.originalPostId || currentPost.id;

  useEffect(() => {
    let isMounted = true;
    async function loadPostAndComments() {
      setLoadingComments(true);
      try {
        const targetId = post.originalPostId || post.id;
        // If opened from a repost item, load the canonical original post so header/metrics reflect original
        if (post.isRepost && post.originalPostId) {
          const originalPost = await postsService.getPostById(post.originalPostId);
          if (originalPost && isMounted) {
            setCurrentPost(originalPost);
          }
        } else {
          setCurrentPost(post);
        }
        const fetched = await postsService.getComments(targetId);
        if (isMounted) {
          setComments(fetched);
          // Keep the post's displayed counter and the shared feed cache consistent with the comments shown here
          setCurrentPost((prev) => ({ ...prev, commentsCount: fetched.length }));
          postsService.setCachedPostCommentCount(targetId, fetched.length);
        }
      } finally {
        if (isMounted) {
          setLoadingComments(false);
        }
      }
    }
    loadPostAndComments();
    return () => {
      isMounted = false;
    };
  }, [post.id, post.originalPostId, post.isRepost]);

  useEffect(() => {
    const handleProfileUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        userId: string;
        displayName?: string;
        avatarUrl?: string;
        user?: { displayName?: string; avatarUrl?: string };
      }>;
      const detail = customEvent.detail;
      if (!detail?.userId) return;
      const newName = detail.displayName || detail.user?.displayName;
      const newAvatar = detail.avatarUrl || detail.user?.avatarUrl;

      setCurrentPost((prev) => {
        if (prev.user?.id === detail.userId || prev.userId === detail.userId) {
          return {
            ...prev,
            user: {
              ...prev.user,
              ...(newName ? { displayName: newName } : {}),
              ...(newAvatar ? { avatarUrl: newAvatar } : {}),
            },
          };
        }
        return prev;
      });

      setComments((prev) =>
        prev.map((c) => {
          if (c.user?.id === detail.userId || c.userId === detail.userId) {
            return {
              ...c,
              user: {
                ...c.user,
                ...(newName ? { displayName: newName } : {}),
                ...(newAvatar ? { avatarUrl: newAvatar } : {}),
              },
            };
          }
          return c;
        })
      );
    };

    window.addEventListener('sogo_profile_updated', handleProfileUpdated);
    return () => {
      window.removeEventListener('sogo_profile_updated', handleProfileUpdated);
    };
  }, []);

  const handleLike = async (postId: string) => {
    const updated = await postsService.toggleLikePost(postId, currentUser);
    setCurrentPost((prev) => ({
      ...prev,
      isLiked: updated.isLiked,
      likesCount: updated.likesCount,
    }));
  };

  const handleBookmark = async (postId: string) => {
    const isBookmarked = await postsService.toggleBookmarkPost(postId);
    setCurrentPost((prev) => ({
      ...prev,
      isBookmarked,
    }));
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !currentUser) return;

    setIsSubmitting(true);
    try {
      const created = await postsService.addComment(
        canonicalPostId,
        {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          avatarUrl: currentUser.avatarUrl,
        },
        commentText.trim()
      );
      setComments((prev) => [...prev, created]);
      setCurrentPost((prev) => ({
        ...prev,
        commentsCount: prev.commentsCount + 1,
      }));
      setCommentText('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShare = async (postToShare: Post) => {
    await sharePost(postToShare, {
      onCopied: () => {
        setShareCopiedToast(true);
        setTimeout(() => setShareCopiedToast(false), 2500);
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Back Button Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded-full border border-slate-700 transition-colors focus:outline-none"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="font-bold text-base text-white">Post</span>
      </div>

      {/* Main Post Card */}
      <PostCard
        post={currentPost}
        onLike={handleLike}
        onBookmark={handleBookmark}
        onCommentClick={() => {}}
        onShare={handleShare}
        onUserClick={onUserClick}
        onPostDeleted={() => onBack()}
        onPostUpdated={(updated) => setCurrentPost(updated)}
        onQuickComment={(_id, text) => {
          if (!currentUser) return;
          postsService.addComment(
            currentPost.id,
            {
              id: currentUser.id,
              username: currentUser.username,
              displayName: currentUser.displayName,
              avatarUrl: currentUser.avatarUrl,
            },
            text
          ).then((created) => {
            setComments((prev) => [...prev, created]);
            setCurrentPost((prev) => ({
              ...prev,
              commentsCount: prev.commentsCount + 1,
            }));
          });
        }}
      />

      {/* Comments Section */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Comments ({comments.length})
        </h3>

        {loadingComments ? (
          <LoadingState message="Loading discussion..." />
        ) : comments.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            No comments yet. Start the conversation!
          </p>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onUserClick={onUserClick}
              />
            ))}
          </div>
        )}

        {/* Comment Form */}
        <form onSubmit={handleAddComment} className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-800">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Share your perspective..."
            className="flex-1 px-4 py-2.5 bg-slate-800/80 focus:bg-slate-800 text-sm text-slate-100 placeholder:text-slate-500 rounded-full border border-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-all"
          />
          <button
            type="submit"
            disabled={!commentText.trim() || isSubmitting}
            className="p-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-900 rounded-full transition-colors focus:outline-none shadow-md shadow-cyan-500/20"
            aria-label="Send comment"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

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
