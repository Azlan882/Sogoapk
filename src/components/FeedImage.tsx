import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Image as ImageIcon, RefreshCw, AlertCircle } from 'lucide-react';
import { cn, getOptimizedImageUrl } from '../lib/utils';

// Session-level cache of URLs that have been completely downloaded and decoded.
// Prevents any placeholder flash when scrolling back and forth through the Home feed.
const decodedImageUrls = new Set<string>();

/**
 * Synchronously checks whether an image URL is already decoded in our session cache
 * or already complete in the browser/WebView memory cache.
 */
export function isImageUrlReadyInCache(url?: string): boolean {
  if (!url || typeof window === 'undefined') return false;
  if (decodedImageUrls.has(url)) return true;

  try {
    const probe = new Image();
    probe.src = url;
    if (probe.complete && probe.naturalWidth > 0) {
      decodedImageUrls.add(url);
      return true;
    }
  } catch {
    // Ignore synchronous probe errors
  }
  return false;
}

export interface FeedImageProps {
  src: string;
  alt?: string;
  variant?: 'feed' | 'reel-poster' | 'grid';
  priority?: boolean;
  maxWidth?: number;
  containerClassName?: string;
  imgClassName?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
}

/**
 * SogoSocial FeedImage Component
 * - Eliminates the black box and progressive top-to-bottom piece-by-piece rendering in the feed.
 * - Shows a cohesive SogoSocial slate skeleton placeholder while the image downloads & decodes.
 * - Waits for both `onLoad` AND `img.decode()` before revealing the complete image in one smooth transition.
 * - Preloads images 800px ahead of the scroll viewport and renders cached images instantaneously.
 */
export const FeedImage: React.FC<FeedImageProps> = ({
  src,
  alt = 'Post image',
  variant = 'feed',
  priority = false,
  maxWidth,
  containerClassName,
  imgClassName,
  onClick,
  children,
}) => {
  const effectiveMaxWidth =
    maxWidth ?? (variant === 'grid' ? 360 : variant === 'reel-poster' ? 720 : 800);

  const optimizedSrc = getOptimizedImageUrl(src, effectiveMaxWidth) || src;

  // Check if either optimizedSrc or raw src is already decoded in memory
  const initiallyReady =
    isImageUrlReadyInCache(optimizedSrc) || isImageUrlReadyInCache(src);

  const [activeSrc, setActiveSrc] = useState<string>(() =>
    isImageUrlReadyInCache(optimizedSrc)
      ? optimizedSrc
      : isImageUrlReadyInCache(src)
      ? src
      : optimizedSrc
  );
  const [hasTriedRawFallback, setHasTriedRawFallback] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [shouldLoad, setShouldLoad] = useState<boolean>(() => priority || initiallyReady);
  const [isReady, setIsReady] = useState<boolean>(() => initiallyReady);
  const [hasError, setHasError] = useState<boolean>(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Synchronize state when `src` prop changes
  useEffect(() => {
    const nextOptimized = getOptimizedImageUrl(src, effectiveMaxWidth) || src;
    const cachedOptimized = isImageUrlReadyInCache(nextOptimized);
    const cachedRaw = isImageUrlReadyInCache(src);

    setHasTriedRawFallback(false);
    setHasError(false);

    if (cachedOptimized) {
      setActiveSrc(nextOptimized);
      setShouldLoad(true);
      setIsReady(true);
    } else if (cachedRaw) {
      setActiveSrc(src);
      setShouldLoad(true);
      setIsReady(true);
    } else {
      setActiveSrc(nextOptimized);
      setIsReady(false);
      if (priority) {
        setShouldLoad(true);
      }
    }
  }, [src, effectiveMaxWidth, priority]);

  // Preload image 800px before it enters the viewport so scrolling feels effortless
  useEffect(() => {
    if (shouldLoad || isReady) return;
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '350px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldLoad, isReady]);

  // Finalize image readiness ONLY after full bitmap decode completes
  const finalizeDecodeAndReveal = useCallback((imgEl: HTMLImageElement, loadedUrl: string) => {
    const markReady = () => {
      decodedImageUrls.add(loadedUrl);
      if (isMountedRef.current) {
        setIsReady(true);
        setHasError(false);
      }
    };

    if (typeof imgEl.decode === 'function') {
      imgEl
        .decode()
        .then(markReady)
        .catch(() => {
          // Even if decode() rejects (e.g. SVG or older WebView quirk after onload),
          // onload has already fired and naturalWidth > 0, so reveal cleanly.
          markReady();
        });
    } else {
      markReady();
    }
  }, []);

  // Ref callback to immediately detect already-cached DOM images on mount
  const handleImgRef = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      if (node && node.complete && node.naturalWidth > 0) {
        decodedImageUrls.add(activeSrc);
        setIsReady(true);
        setHasError(false);
      }
    },
    [activeSrc]
  );

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const imgEl = e.currentTarget;
    finalizeDecodeAndReveal(imgEl, activeSrc);
  };

  const handleError = () => {
    // If the optimized Cloudinary transformation URL failed, transparently fall back to raw `src`
    if (!hasTriedRawFallback && activeSrc !== src && src) {
      setHasTriedRawFallback(true);
      setActiveSrc(src);
      return;
    }

    if (isMountedRef.current) {
      setHasError(true);
      setIsReady(false);
    }
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHasError(false);
    setIsReady(false);
    setHasTriedRawFallback(false);
    setShouldLoad(true);
    const nextRetry = retryCount + 1;
    setRetryCount(nextRetry);
    const separator = src.includes('?') ? '&' : '?';
    setActiveSrc(`${src}${separator}_retry=${nextRetry}`);
  };

  return (
    <div
      ref={wrapperRef}
      onClick={hasError ? undefined : onClick}
      className={cn(
        'relative w-full overflow-hidden select-none flex items-center justify-center',
        variant === 'feed' && 'cursor-pointer max-h-[75vh]',
        variant === 'feed' &&
          (isReady
            ? 'min-h-[200px] bg-slate-950/50'
            : 'min-h-[280px] sm:min-h-[340px] bg-slate-900'),
        variant === 'reel-poster' && 'w-full h-full bg-slate-900',
        variant === 'grid' && 'w-full h-full bg-slate-800',
        containerClassName
      )}
    >
      {/* SogoSocial Loading Placeholder — Shown until the entire image is downloaded & decoded */}
      {!isReady && !hasError && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900 overflow-hidden pointer-events-none"
        >
          {/* Soft ambient slate shimmer */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800/75 via-slate-900/90 to-slate-800/75 animate-pulse" />

          {variant !== 'grid' ? (
            <div className="relative z-10 flex flex-col items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-900/65 border border-slate-800/90 backdrop-blur-xs shadow-inner">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800/90 text-slate-400">
                <ImageIcon className="w-5 h-5 text-slate-400/90" />
                <span className="absolute -inset-0.5 rounded-xl border border-cyan-400/25 animate-pulse" />
              </div>
              <span className="text-[11px] font-medium text-slate-400 tracking-wide">
                Loading photo...
              </span>
            </div>
          ) : (
            <div className="relative z-10 flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800/80 text-slate-500">
              <ImageIcon className="w-4 h-4 opacity-60" />
            </div>
          )}
        </div>
      )}

      {/* Clean Fallback State if Image Fails to Load */}
      {hasError && (
        <div
          onClick={handleRetry}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleRetry(e as any);
            }
          }}
          className={cn(
            'relative z-10 w-full flex flex-col items-center justify-center text-center p-6 bg-slate-900/95 text-slate-400 cursor-pointer hover:bg-slate-900 transition-colors',
            variant === 'feed' ? 'min-h-[260px]' : 'h-full'
          )}
        >
          <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-400 mb-2.5">
            <AlertCircle className="w-5 h-5 text-slate-400" />
          </div>
          {variant !== 'grid' ? (
            <>
              <p className="text-xs font-semibold text-slate-300 mb-1">
                Couldn&apos;t load photo
              </p>
              <span className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-cyan-400 border border-slate-700 transition-colors">
                <RefreshCw className="w-3 h-3" />
                <span>Tap to retry</span>
              </span>
            </>
          ) : (
            <RefreshCw className="w-4 h-4 text-slate-500" />
          )}
        </div>
      )}

      {/* Hidden while downloading/decoding (opacity-0); revealed as a complete image once ready */}
      {shouldLoad && !hasError && (
        <img
          ref={handleImgRef}
          src={activeSrc}
          alt={alt}
          referrerPolicy="no-referrer"
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={handleLoad}
          onError={handleError}
          draggable={false}
          className={cn(
            'transition-opacity duration-200 ease-out',
            variant === 'feed' &&
              'w-full h-auto max-h-[75vh] object-contain hover:scale-[1.01] transition-transform',
            variant === 'reel-poster' &&
              'w-full h-full object-contain group-hover:scale-[1.01] transition-transform',
            variant === 'grid' &&
              'w-full h-full object-cover group-hover:scale-105 transition-transform',
            isReady ? 'opacity-100' : 'opacity-0 pointer-events-none',
            imgClassName
          )}
        />
      )}

      {/* Optional overlays (e.g., double-tap heart animation, play badges) */}
      {children}
    </div>
  );
};
