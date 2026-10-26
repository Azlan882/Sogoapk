import React from 'react';
import { Comment } from '../types';
import { Avatar } from './Avatar';
import { timeAgo } from '../lib/utils';
import { Heart } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';

export interface CommentItemProps {
  comment: Comment;
  onUserClick?: (userId: string) => void;
}

export const CommentItem: React.FC<CommentItemProps> = ({ comment, onUserClick }) => {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Avatar
        src={comment.user.avatarUrl}
        alt={comment.user.displayName}
        size="sm"
        onClick={() => onUserClick?.(comment.user.id)}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          <button
            type="button"
            onClick={() => onUserClick?.(comment.user.id)}
            className="font-bold text-white hover:underline mr-1.5 inline-flex items-center gap-1 align-baseline focus:outline-none"
          >
            <span>{comment.user.username}</span>
            <VerifiedBadge
              userId={comment.user.id}
              username={comment.user.username}
              isVerified={comment.user.isVerified}
              size="xs"
            />
          </button>
          <span className="text-slate-200 break-words">{comment.text}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 font-medium">
          <span>{timeAgo(comment.createdAt)}</span>
          {comment.likesCount ? (
            <span>{comment.likesCount} {comment.likesCount === 1 ? 'like' : 'likes'}</span>
          ) : null}
          <button type="button" className="hover:text-cyan-400 focus:outline-none">
            Reply
          </button>
        </div>
      </div>
      <button
        type="button"
        className="p-1 text-slate-500 hover:text-rose-400 focus:outline-none transition-colors"
      >
        <Heart className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
