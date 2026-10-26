import React from 'react';
import { Heart, MessageCircle, Bookmark, Repeat2, Eye } from 'lucide-react';
import { cn, formatNumber } from '../lib/utils';

export interface PostActionsProps {
  isLiked?: boolean;
  likesCount: number;
  commentsCount: number;
  viewsCount?: number;
  repostsCount?: number;
  isReposted?: boolean;
  isBookmarked?: boolean;
  onLike: () => void;
  onComment: () => void;
  onBookmark: () => void;
  onShare?: () => void;
  className?: string;
}

export const PostActions: React.FC<PostActionsProps> = ({
  isLiked = false,
  likesCount,
  commentsCount,
  viewsCount = 0,
  repostsCount = 0,
  isReposted = false,
  isBookmarked = false,
  onLike,
  onComment,
  onBookmark,
  onShare,
  className = '',
}) => {
  return (
    <div className={cn('flex items-center justify-between py-2 px-1', className)}>
      <div className="flex items-center gap-4">
        {/* Like Button */}
        <button
          type="button"
          onClick={onLike}
          className="flex items-center gap-1.5 text-slate-300 hover:text-white group focus:outline-none transition-transform active:scale-90 cursor-pointer"
          aria-label={isLiked ? 'Unlike' : 'Like'}
        >
          <Heart
            className={cn(
              'w-6 h-6 transition-colors duration-150',
              isLiked ? 'fill-rose-500 text-rose-500' : 'group-hover:text-rose-400'
            )}
          />
          <span className={cn('text-xs font-semibold', isLiked ? 'text-rose-400' : 'text-slate-300')}>
            {formatNumber(likesCount)}
          </span>
        </button>

        {/* Comment Button */}
        <button
          type="button"
          onClick={onComment}
          className="flex items-center gap-1.5 text-slate-300 hover:text-white group focus:outline-none transition-transform active:scale-90 cursor-pointer"
          aria-label="Comments"
        >
          <MessageCircle className="w-6 h-6 group-hover:text-cyan-400 transition-colors" />
          <span className="text-xs font-semibold text-slate-300">{formatNumber(commentsCount)}</span>
        </button>

        {/* Share / Repost Button */}
        <button
          type="button"
          onClick={onShare}
          className="flex items-center gap-1.5 text-slate-300 hover:text-emerald-400 group focus:outline-none transition-transform active:scale-90 cursor-pointer"
          aria-label="Share post"
        >
          <Repeat2
            className={cn(
              'w-6 h-6 transition-colors duration-150',
              isReposted ? 'text-emerald-400' : 'group-hover:text-emerald-400'
            )}
          />
          {repostsCount > 0 && (
            <span className={cn('text-xs font-semibold', isReposted ? 'text-emerald-400' : 'text-slate-300')}>
              {formatNumber(repostsCount)}
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-3">
        {/* Total Post Views Indicator (Facebook-style subtle metric) */}
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

        {/* Bookmark Button */}
        <button
          type="button"
          onClick={onBookmark}
          className="p-1 text-slate-300 hover:text-white group focus:outline-none transition-transform active:scale-90"
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark post'}
        >
          <Bookmark
            className={cn(
              'w-6 h-6 transition-colors duration-150',
              isBookmarked ? 'fill-amber-400 text-amber-400' : 'group-hover:text-amber-400'
            )}
          />
        </button>
      </div>
    </div>
  );
};

