import React, { useState, useEffect } from 'react';
import { cn, getOptimizedAvatarUrl } from '../lib/utils';

export interface AvatarProps {
  src?: string;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  hasStory?: boolean;
  storySeen?: boolean;
  className?: string;
  onClick?: () => void;
}

const sizeMap = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl font-bold',
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt = 'User',
  size = 'md',
  hasStory = false,
  storySeen = false,
  className = '',
  onClick,
}) => {
  const [hasError, setHasError] = useState(false);
  const [useFallbackRaw, setUseFallbackRaw] = useState(false);

  useEffect(() => {
    setHasError(false);
    setUseFallbackRaw(false);
  }, [src]);

  const optimizedSrc = !useFallbackRaw ? getOptimizedAvatarUrl(src, size) : src || '';

  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const ringClasses = hasStory
    ? storySeen
      ? 'p-[2px] rounded-full ring-2 ring-slate-700'
      : 'p-[2px] rounded-full ring-2 ring-cyan-400 bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-500 shadow-md shadow-cyan-500/20'
    : '';

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative inline-block select-none shrink-0 transition-transform duration-150',
        onClick ? 'cursor-pointer hover:scale-105 active:scale-95' : '',
        ringClasses
      )}
    >
      <div
        className={cn(
          'overflow-hidden rounded-full bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-300 font-semibold',
          sizeMap[size],
          className
        )}
      >
        {optimizedSrc && !hasError ? (
          <img
            src={optimizedSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={() => {
              if (!useFallbackRaw && src && optimizedSrc !== src) {
                setUseFallbackRaw(true);
              } else {
                setHasError(true);
              }
            }}
          />
        ) : (
          <span>{getInitials(alt)}</span>
        )}
      </div>
    </div>
  );
};
