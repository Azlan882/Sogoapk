import React from 'react';
import { Post } from '../types';
import { Heart, MessageCircle, Repeat2, Play, FileText } from 'lucide-react';
import { formatNumber, getOptimizedCloudinaryVideoUrl, getOptimizedPosterUrl } from '../lib/utils';
import { FeedImage } from './FeedImage';

export interface ImageGridProps {
  posts: Post[];
  onPostClick: (post: Post) => void;
  emptyMessage?: string;
}

export const ImageGrid: React.FC<ImageGridProps> = ({ posts, onPostClick, emptyMessage = 'No posts yet' }) => {
  if (posts.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
      {posts.map((post, idx) => {
        const displayImage =
          post.imageUrl ||
          post.videoThumbnailUrl ||
          (post.videoUrl ? getOptimizedPosterUrl(undefined, post.videoUrl) : '') ||
          '';
        return (
          <div
            key={post.isRepost && post.repostId ? post.repostId : post.id}
            onClick={() => onPostClick(post)}
            className="group relative aspect-square bg-slate-800 border border-slate-800/80 overflow-hidden cursor-pointer rounded-lg sm:rounded-xl shadow-xs"
          >
            {displayImage ? (
              <FeedImage
                src={displayImage}
                alt={post.caption || 'Post thumbnail'}
                variant="grid"
                maxWidth={360}
                priority={idx < 6}
              />
            ) : post.videoUrl ? (
              <video
                src={getOptimizedCloudinaryVideoUrl(post.videoUrl)}
                muted
                playsInline
                preload="metadata"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 p-3 flex flex-col items-center justify-center text-center">
                <FileText className="w-5 h-5 text-slate-500 mb-1.5 shrink-0" />
                <p className="text-[11px] text-slate-300 line-clamp-3 leading-snug font-medium">
                  {post.caption || 'Shared post'}
                </p>
              </div>
            )}

            {/* Repost Indicator Badge */}
            {post.isRepost && (
              <div
                title={`Reposted from @${post.originalAuthor?.username || post.user?.username || 'creator'}`}
                className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-xs border border-emerald-500/40 flex items-center gap-1 text-[10px] font-bold text-emerald-400"
              >
                <Repeat2 className="w-3 h-3 stroke-[2.2]" />
                <span className="hidden sm:inline">Repost</span>
              </div>
            )}

            {/* Video Indicator Badge */}
            {(post.repostType === 'video' || Boolean(post.videoUrl)) && (
              <div className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-white">
                <Play className="w-3 h-3 fill-white ml-0.5" />
              </div>
            )}

            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-[#0B0F1A]/70 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-4 text-white">
              <div className="flex items-center gap-1.5 font-bold text-xs sm:text-sm">
                <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
                <span>{formatNumber(post.likesCount)}</span>
              </div>
              <div className="flex items-center gap-1.5 font-bold text-xs sm:text-sm">
                <MessageCircle className="w-4 h-4 fill-cyan-400 text-cyan-400" />
                <span>{formatNumber(post.commentsCount)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
