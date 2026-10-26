import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Download, ZoomIn, ZoomOut, RotateCcw, AlertCircle, Check, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { registerBackInterceptor } from '../services/backButtonService';
import { getOptimizedFullscreenImageUrl } from '../lib/utils';

export interface MediaSaverPlugin {
  saveImageToGallery(options: {
    base64?: string;
    url?: string;
    filename: string;
    mimeType: string;
  }): Promise<{
    success: boolean;
    uri: string;
    location: string;
    bytesSaved: number;
  }>;
}

const MediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver');

export interface ImageViewerProps {
  isOpen: boolean;
  imageUrl: string;
  feedImageUrl?: string;
  altText?: string;
  caption?: string;
  onClose: () => void;
}

// Check if an image URL is already loaded/cached in browser memory
const isImageCached = (url: string): boolean => {
  if (typeof window === 'undefined' || !url) return false;
  try {
    const testImg = new Image();
    testImg.src = url;
    return testImg.complete && testImg.naturalWidth > 0;
  } catch {
    return false;
  }
};

// Sanitize URL for debug logs without leaking sensitive credentials/tokens
const sanitizeUrlForLog = (url: string): string => {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const sensitiveKeys = ['token', 'sig', 'signature', 'auth', 'key', 'apiKey', 'secret'];
    sensitiveKeys.forEach((k) => {
      if (parsed.searchParams.has(k)) {
        parsed.searchParams.set(k, '[REDACTED]');
      }
    });
    return parsed.toString();
  } catch {
    return url.split('?')[0];
  }
};

export const ImageViewer: React.FC<ImageViewerProps> = ({
  isOpen,
  imageUrl,
  feedImageUrl,
  altText = 'Post image',
  caption,
  onClose,
}) => {
  const optimizedFullUrl = getOptimizedFullscreenImageUrl(imageUrl);
  const effectiveFeedUrl = feedImageUrl || optimizedFullUrl;
  const displaySrc =
    effectiveFeedUrl && isImageCached(effectiveFeedUrl) && !isImageCached(optimizedFullUrl)
      ? effectiveFeedUrl
      : optimizedFullUrl;
  const isSameUrl = effectiveFeedUrl === displaySrc;

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageError, setImageError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(
    () => isImageCached(displaySrc) || isImageCached(effectiveFeedUrl)
  );
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle');
  const [downloadErrorMessage, setDownloadErrorMessage] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Touch handling for pinch-to-zoom and double-tap
  const lastTouchTimeRef = useRef<number>(0);
  const initialPinchDistRef = useRef<number | null>(null);
  const initialScaleRef = useRef<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const logDebug = useCallback(
    (loadStarted: boolean, loadCompleted: boolean, loadErrored: boolean) => {
      console.log('IMAGE VIEWER DEBUG', {
        feedImageUrl: sanitizeUrlForLog(effectiveFeedUrl),
        viewerImageUrl: sanitizeUrlForLog(imageUrl),
        sameUrl: isSameUrl,
        viewerMounted: true,
        loadStarted,
        loadCompleted,
        loadErrored,
      });
    },
    [effectiveFeedUrl, imageUrl, isSameUrl]
  );

  // Reset zoom & pan when modal opens or image changes
  useEffect(() => {
    if (!isOpen) return;

    setScale(1);
    setPosition({ x: 0, y: 0 });
    setDownloadStatus('idle');
    setDownloadErrorMessage(null);

    const isCached =
      isImageCached(displaySrc) ||
      isImageCached(effectiveFeedUrl) ||
      Boolean(imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0);

    if (isCached) {
      setImageLoaded(true);
      setImageError(false);
      setErrorMessage(null);
      logDebug(true, true, false);
    } else {
      setImageLoaded(false);
      setImageError(false);
      setErrorMessage(null);
      logDebug(true, false, false);
    }
  }, [isOpen, displaySrc, effectiveFeedUrl, logDebug]);

  // Image load timeout fallback: 15 seconds
  useEffect(() => {
    if (!isOpen || imageLoaded || imageError) return;

    const timeoutTimer = setTimeout(() => {
      // Re-check if image completed before timing out
      if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
        setImageLoaded(true);
        setImageError(false);
        return;
      }

      setImageLoaded(true);
      setImageError(true);
      setErrorMessage('Image could not be loaded. Please try again.');
      logDebug(true, false, true);
    }, 15000);

    return () => clearTimeout(timeoutTimer);
  }, [isOpen, imageLoaded, imageError, logDebug]);

  // Callback ref for immediate synchronous detection when DOM element attaches
  const handleImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      if (node && node.complete && node.naturalWidth > 0) {
        setImageLoaded(true);
        setImageError(false);
        setErrorMessage(null);
        logDebug(true, true, false);
      }
    },
    [logDebug]
  );

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
    setErrorMessage(null);
    logDebug(true, true, false);
  };

  const handleImageError = () => {
    setImageLoaded(true);
    setImageError(true);
    setErrorMessage('Unable to load image');
    logDebug(true, false, true);
  };

  // Intercept Android hardware/system Back button FIRST
  useEffect(() => {
    if (!isOpen) return;

    return registerBackInterceptor(() => {
      // If zoomed in, first zoom reset or immediately close
      onClose();
      return true; // back action consumed
    });
  }, [isOpen, onClose]);

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.5, 4));
  };

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(prev - 0.5, 1);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Double tap to toggle zoom
  const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      handleResetZoom();
    } else {
      setScale(2.5);
    }
  };

  // Touch Events for Mobile Pinch-to-zoom & Double-tap
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialPinchDistRef.current = dist;
      initialScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTouchTimeRef.current < 300) {
        handleDoubleTap(e);
        lastTouchTimeRef.current = 0;
      } else {
        lastTouchTimeRef.current = now;
        if (scale > 1) {
          setIsDragging(true);
          setDragStart({
            x: e.touches[0].clientX - position.x,
            y: e.touches[0].clientY - position.y,
          });
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const newScale = Math.min(Math.max((dist / initialPinchDistRef.current) * initialScaleRef.current, 1), 4);
      setScale(newScale);
      if (newScale === 1) {
        setPosition({ x: 0, y: 0 });
      }
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    }
  };

  const handleTouchEnd = () => {
    initialPinchDistRef.current = null;
    setIsDragging(false);
  };

  // Mouse drag handlers for desktop pan while zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Robust Image Download implementation using Android MediaStore
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    // 1. Disable / debounce download button to prevent repeated taps & duplicate downloads
    if (downloadStatus === 'downloading') return;

    // 2. Show "Downloading..."
    setDownloadStatus('downloading');
    setDownloadErrorMessage(null);

    let httpStatus: number | null = null;
    let contentType: string | null = null;
    let finalMime = 'image/jpeg';
    let extension = 'jpg';
    let bytesDownloaded = 0;
    let saveMethod = 'none';
    let saveLocation: string | null = null;
    let saveCompleted = false;
    let permissionStatus = 'unknown';
    let caughtError: any = null;

    try {
      // 3. Fetch/download actual image bytes
      let blob: Blob | null = null;

      try {
        const response = await fetch(imageUrl, {
          mode: 'cors',
          cache: 'no-cache',
        });
        httpStatus = response.status;
        contentType = response.headers.get('content-type') || null;

        // 4. Verify response succeeded
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch image`);
        }

        blob = await response.blob();
        bytesDownloaded = blob.size;

        // 5. Verify there is actual image data
        if (bytesDownloaded === 0) {
          throw new Error('Image data buffer is 0 bytes');
        }
      } catch (fetchErr: any) {
        // If webview fetch fails (e.g. CORS) and we are on native Android,
        // native MediaSaver can download directly from URL
        if (Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android') {
          console.warn('Webview fetch failed; will stream via native Android connection:', fetchErr);
        } else {
          throw fetchErr;
        }
      }

      // Determine proper file extension & MIME type from contentType or URL
      const cleanUrl = imageUrl.split('?')[0].toLowerCase();
      const detectedMime = (contentType || (blob && blob.type) || '').toLowerCase();

      if (detectedMime.includes('png') || cleanUrl.endsWith('.png')) {
        extension = 'png';
        finalMime = 'image/png';
      } else if (detectedMime.includes('webp') || cleanUrl.endsWith('.webp')) {
        extension = 'webp';
        finalMime = 'image/webp';
      } else if (detectedMime.includes('gif') || cleanUrl.endsWith('.gif')) {
        extension = 'gif';
        finalMime = 'image/gif';
      } else {
        extension = 'jpg';
        finalMime = 'image/jpeg';
      }

      const filename = `sogosocial-image-${Date.now()}.${extension}`;

      // 6. Save it to a user-visible Android location (MediaStore) or browser fallback
      if (Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android') {
        saveMethod = 'android-mediastore';
        permissionStatus = 'granted-or-scoped-storage';

        let base64Data: string | undefined = undefined;
        if (blob) {
          const reader = new FileReader();
          base64Data = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                resolve(reader.result);
              } else {
                reject(new Error('Failed to convert image blob to base64'));
              }
            };
            reader.onerror = () => reject(new Error('FileReader error during base64 conversion'));
            reader.readAsDataURL(blob);
          });
        }

        // Call native MediaStore plugin
        const saveResult = await MediaSaver.saveImageToGallery({
          base64: base64Data,
          url: imageUrl,
          filename,
          mimeType: finalMime,
        });

        // 7. Confirm the save operation succeeded
        if (!saveResult || !saveResult.success) {
          throw new Error('Native MediaStore save returned unconfirmed or failed result');
        }

        saveLocation = saveResult.location || `Pictures/SogoSocial/${filename}`;
        saveCompleted = true;
      } else {
        // Fallback for Web browser preview / desktop testing
        if (!blob) {
          throw new Error('Image data unavailable for browser download');
        }
        saveMethod = 'browser-blob-download';
        permissionStatus = 'not-required-web';

        const blobUrl = window.URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = blobUrl;
        downloadAnchor.download = filename;
        downloadAnchor.style.display = 'none';
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();

        setTimeout(() => {
          try {
            document.body.removeChild(downloadAnchor);
            window.URL.revokeObjectURL(blobUrl);
          } catch {}
        }, 1000);

        saveLocation = `Downloads/${filename}`;
        saveCompleted = true;
      }

      // 8. Only THEN show: "Image downloaded ✓"
      setDownloadStatus('success');
      setTimeout(() => {
        setDownloadStatus('idle');
      }, 3000);
    } catch (err: any) {
      // 9. If anything fails: do NOT show success; show error; log diagnostic
      caughtError = err;
      saveCompleted = false;
      setDownloadStatus('error');
      setDownloadErrorMessage("Couldn't download image. Please try again.");
    } finally {
      // Log temporary safe diagnostics
      console.log('IMAGE DOWNLOAD DEBUG', {
        sourceUrl: sanitizeUrlForLog(imageUrl),
        httpStatus,
        contentType: contentType || (saveCompleted ? finalMime : null),
        bytesDownloaded,
        saveMethod,
        saveLocation,
        saveCompleted,
        permissionStatus,
        error: caughtError ? String(caughtError.message || caughtError) : null,
      });
    }
  }, [downloadStatus, imageUrl]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Full screen image viewer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-md flex flex-col select-none touch-manipulation overflow-hidden"
        onClick={onClose}
      >
        {/* Top Control Bar */}
        <div
          className="relative z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Zoom Controls */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={scale >= 4}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white disabled:opacity-30 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={scale <= 1}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white disabled:opacity-30 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            {scale > 1 && (
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xs font-semibold transition-colors focus:outline-none flex items-center gap-1.5 min-h-[44px] cursor-pointer"
                aria-label="Reset zoom"
                title="Reset zoom"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{Math.round(scale * 100)}%</span>
              </button>
            )}
          </div>

          {/* Action Buttons: Download + Close */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloadStatus === 'downloading'}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer disabled:opacity-50"
              aria-label="Download image"
              title="Download image"
            >
              {downloadStatus === 'downloading' ? (
                <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
              ) : downloadStatus === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400" />
              ) : (
                <Download className="w-5 h-5" />
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
              aria-label="Close image viewer"
              title="Close image viewer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Download Feedback Banner */}
        <AnimatePresence>
          {downloadStatus === 'downloading' && (
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="mx-auto my-1 px-4 py-2 bg-cyan-950/80 border border-cyan-500/50 rounded-full text-cyan-300 text-xs font-semibold flex items-center gap-2 shadow-lg z-30 pointer-events-none"
            >
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              <span>Downloading...</span>
            </motion.div>
          )}
          {downloadStatus === 'success' && (
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="mx-auto my-1 px-4 py-2 bg-emerald-950/80 border border-emerald-500/50 rounded-full text-emerald-300 text-xs font-semibold flex items-center gap-2 shadow-lg z-30 pointer-events-none"
            >
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Image downloaded ✓</span>
            </motion.div>
          )}
          {downloadStatus === 'error' && (
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="mx-auto my-1 px-4 py-2 bg-rose-950/80 border border-rose-500/50 rounded-full text-rose-300 text-xs font-semibold flex items-center gap-2 shadow-lg z-30 pointer-events-none"
            >
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>{downloadErrorMessage || "Couldn't download image. Please try again."}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center Canvas / Viewport */}
        <div
          ref={containerRef}
          className="flex-1 relative flex items-center justify-center overflow-hidden p-2 sm:p-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          {/* Loading spinner */}
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <span className="text-xs">Full image loading...</span>
            </div>
          )}

          {/* Error State */}
          {imageError ? (
            <div
              className="p-6 max-w-sm mx-auto bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-3 z-20 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
              <h3 className="text-white font-semibold text-sm">
                {errorMessage || 'Unable to load image'}
              </h3>
              <p className="text-slate-400 text-xs">
                {errorMessage === 'Image could not be loaded. Please try again.'
                  ? 'The image request timed out. Please check your network connection.'
                  : 'The image could not be loaded from the network or source.'}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-white rounded-xl text-xs font-semibold cursor-pointer min-h-[44px] transition-colors"
                aria-label="Close"
              >
                Close
              </button>
            </div>
          ) : (
            <div
              className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-75"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: 'center center',
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={handleDoubleTap}
            >
              <img
                ref={handleImageRef}
                src={displaySrc}
                alt={altText}
                referrerPolicy="no-referrer"
                onLoad={handleImageLoad}
                onError={handleImageError}
                className={`max-w-full max-h-[85vh] w-auto h-auto object-contain rounded-md shadow-2xl transition-opacity duration-200 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                draggable={false}
              />
            </div>
          )}
        </div>

        {/* Bottom Area: Caption preview if available */}
        {caption && (
          <div
            className="relative z-30 px-4 py-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-auto max-w-2xl mx-auto w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs sm:text-sm text-slate-200 line-clamp-2 leading-relaxed">
              {caption}
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
