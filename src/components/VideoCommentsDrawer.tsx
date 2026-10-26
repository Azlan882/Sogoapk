import React, { useState, useEffect } from 'react';
import { X, Send, MessageCircle } from 'lucide-react';
import { VideoPost, VideoComment } from '../types';
import { useAuth } from '../hooks/useAuth';
import * as videosService from '../services/videosService';
import { Avatar } from './Avatar';
import { formatRelativeTime } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';

export interface VideoCommentsDrawerProps {
  video: VideoPost;
  isOpen: boolean;
  onClose: () => void;
  onCommentAdded: () => void;
}

export const VideoCommentsDrawer: React.FC<VideoCommentsDrawerProps> = ({
  video,
  isOpen,
  onClose,
  onCommentAdded,
}) => {
  const { currentUser } = useAuth();
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && video) {
      loadComments();
    }
  }, [isOpen, video.id]);

  const loadComments = async () => {
    setLoading(true);
    try {
      const data = await videosService.getVideoComments(video.id);
      setComments(data);
    } catch (err) {
      console.error('Failed to load video comments', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !currentUser || submitting) return;

    setSubmitting(true);
    try {
      const newComment = await videosService.addVideoComment(
        video.id,
        {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          avatarUrl: currentUser.avatarUrl,
          isVerified: Boolean(currentUser.isVerified),
        },
        inputText.trim()
      );

      setComments((prev) => [...prev, newComment]);
      setInputText('');
      onCommentAdded();
    } catch (err) {
      console.error('Failed to post comment', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity">
      {/* Backdrop tap to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer content */}
      <div className="relative w-full max-w-lg bg-[#0F172A] border-t border-slate-800 rounded-t-3xl shadow-2xl flex flex-col max-h-[70vh] min-h-[40vh] z-10 animate-in slide-in-from-bottom duration-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              Comments ({comments.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close comments"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <MessageCircle className="w-10 h-10 mx-auto text-slate-600 mb-2 stroke-[1.5]" />
              <p className="text-sm font-medium">No comments yet</p>
              <p className="text-xs text-slate-500 mt-0.5">Be the first to share your thoughts!</p>
            </div>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex gap-3">
                <Avatar
                  src={comment.user.avatarUrl}
                  alt={comment.user.displayName}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1">
                      <span>@{comment.user.username}</span>
                      <VerifiedBadge
                        userId={comment.user.id || comment.userId}
                        username={comment.user.username}
                        isVerified={comment.user.isVerified}
                        size="xs"
                      />
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 mt-1 break-words">
                    {comment.text}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Comment input form */}
        <form
          onSubmit={handleSend}
          className="p-3 border-t border-slate-800/80 bg-[#0B0F1A]/80 flex items-center gap-2"
        >
          {currentUser && (
            <Avatar
              src={currentUser.avatarUrl}
              alt={currentUser.displayName}
              size="xs"
            />
          )}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={currentUser ? 'Add a comment...' : 'Sign in to comment'}
            disabled={!currentUser || submitting}
            className="flex-1 bg-slate-900 border border-slate-700/60 rounded-full px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || !currentUser || submitting}
            className="p-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
            aria-label="Send comment"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
