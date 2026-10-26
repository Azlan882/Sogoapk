import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Story } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import {
  cn,
  resolveStoryPreviewUrl,
  getStoryMediaUrl,
  isStoryVideoMedia,
  isStoryUrlLoaded,
  markStoryUrlLoaded,
  getInstantStoryPreview,
} from '../lib/utils';

export interface StoryItemProps {
  story: Story;
  allStories?: Story[];
  onClick: (story: Story) => void;
}

const getInitials = (name: string) => {
  const clean = (name || 'User').trim();
  const parts = clean.split(' ').filter(Boolean);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
};

export const StoryItem: React.FC<StoryItemProps> = React.memo(({ story, allStories, onClick }) => {
  // Build ordered candidate sources:
  // 0. Instant in-memory preview URL (if user just created this Story in the current session)
  // 1. Optimized Story thumbnail / preview URL (or Cloudinary static video frame)
  // 2. Raw Story media URL (if different from optimized URL)
  // 3. User avatar URL (ONLY if Story has no valid media or Story media fails)
  const candidateSources = useMemo(() => {
    const list: string[] = [];
    const instant =
      getInstantStoryPreview(story.mediaUrl) || getInstantStoryPreview(story.thumbnailUrl);
    const preview = resolveStoryPreviewUrl(story, allStories);
    const rawMedia = getStoryMediaUrl(story, allStories);
    const avatar = story.user?.avatarUrl?.trim() || '';

    if (instant) list.push(instant);
    if (preview && !list.includes(preview)) list.push(preview);
    if (rawMedia && !list.includes(rawMedia)) list.push(rawMedia);
    if (avatar && !list.includes(avatar)) list.push(avatar);

    return list;
  }, [
    story.id,
    story.mediaUrl,
    story.thumbnailUrl,
    story.mediaType,
    story.originalStoryId,
    story.user?.avatarUrl,
    allStories,
  ]);

  // Primitive key so object/array reference changes never falsely reset sourceIndex or isLoaded
  const sourcesKey = candidateSources.join('|');

  const [sourceIndex, setSourceIndex] = useState(0);
  const activeSrc = candidateSources[sourceIndex] || '';
  const isVideoSource = Boolean(activeSrc && isStoryVideoMedia(activeSrc));

  const [isLoaded, setIsLoaded] = useState<boolean>(() =>
    Boolean(activeSrc && isStoryUrlLoaded(activeSrc))
  );

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Only reset sourceIndex when the actual URL candidates string changes
  useEffect(() => {
    setSourceIndex(0);
  }, [sourcesKey]);

  // Synchronously check in-memory loaded cache and DOM img.complete before paint
  useLayoutEffect(() => {
    if (!activeSrc) {
      setIsLoaded(false);
      return;
    }
    if (isStoryUrlLoaded(activeSrc)) {
      setIsLoaded(true);
      return;
    }
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      markStoryUrlLoaded(activeSrc);
      setIsLoaded(true);
      return;
    }
    setIsLoaded(false);
  }, [activeSrc]);

  const handleMediaError = () => {
    if (sourceIndex + 1 < candidateSources.length) {
      const nextSrc = candidateSources[sourceIndex + 1] || '';
      setIsLoaded(Boolean(nextSrc && isStoryUrlLoaded(nextSrc)));
      setSourceIndex((prev) => prev + 1);
    } else {
      // All candidate URLs failed -> allow fallback to initials
      setSourceIndex(candidateSources.length);
    }
  };

  const ringClasses = story.hasSeen
    ? 'p-[2px] rounded-full ring-2 ring-slate-700'
    : 'p-[2px] rounded-full ring-2 ring-cyan-400 bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-500 shadow-md shadow-cyan-500/20';

  const displayName = story.user?.displayName || story.user?.username || 'User';

  return (
    <button
      type="button"
      onClick={() => onClick(story)}
      className="flex flex-col items-center gap-1.5 focus:outline-none group cursor-pointer shrink-0"
    >
      <div
        className={cn(
          'relative inline-block select-none shrink-0 transition-transform duration-150 group-hover:scale-105 group-active:scale-95',
          ringClasses
        )}
      >
        <div className="relative overflow-hidden rounded-full bg-slate-800 border border-slate-700/80 w-14 h-14 flex items-center justify-center text-slate-300 text-base font-semibold">
          {activeSrc ? (
            <>
              {!isLoaded && (
                <div
                  className="absolute inset-0 rounded-full bg-slate-800 animate-pulse"
                  aria-hidden="true"
                />
              )}
              {isVideoSource ? (
                <video
                  src={`${activeSrc}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  className={cn(
                    'w-full h-full object-cover pointer-events-none transition-opacity duration-150',
                    isLoaded ? 'opacity-100' : 'opacity-0'
                  )}
                  onLoadedData={() => {
                    markStoryUrlLoaded(activeSrc);
                    setIsLoaded(true);
                  }}
                  onError={handleMediaError}
                />
              ) : (
                <img
                  ref={imgRef}
                  src={activeSrc}
                  alt={displayName}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className={cn(
                    'w-full h-full object-cover transition-opacity duration-150',
                    isLoaded ? 'opacity-100' : 'opacity-0'
                  )}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth > 0) {
                      markStoryUrlLoaded(activeSrc);
                      setIsLoaded(true);
                    }
                  }}
                  onError={handleMediaError}
                />
              )}
            </>
          ) : (
            <span>{getInitials(displayName)}</span>
          )}
        </div>
      </div>
      <span className="text-xs font-medium text-slate-300 max-w-[74px] flex items-center gap-0.5 truncate group-hover:text-cyan-400">
        <span className="truncate">{story.user?.username}</span>
        <VerifiedBadge
          userId={story.user?.id || story.userId}
          username={story.user?.username}
          isVerified={story.user?.isVerified}
          size="xs"
        />
      </span>
    </button>
  );
});
StoryItem.displayName = 'StoryItem';
