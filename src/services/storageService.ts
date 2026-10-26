/**
 * Cloudinary Storage Service for SogoSocial.
 * Handles image, avatar, and video uploads to Cloudinary with:
 * - Real-time XHR upload progress tracking
 * - Bounded automatic retry with exponential backoff (Attempt 1 -> 1s -> Attempt 2 -> 2s -> Attempt 3)
 * - Two-phase watchdog timers (byte-transfer inactivity watchdog + server-processing window)
 * - Session-level idempotency & in-flight deduplication to prevent duplicate uploads
 */

import { perf } from '../utils/perfLogger';
import { warmCloudinaryVideoPlayback } from '../lib/utils';
import { auth } from '../lib/firebase';

export interface VideoUploadResult {
  videoUrl: string;
  thumbnailUrl: string;
  duration?: number;
  publicId?: string;
  format?: string;
}

export interface VideoUploadDiagnostic {
  event: string;
  reason: 'ABORT' | 'TIMEOUT' | 'HTTP' | 'NETWORK';
  target: string;
  status: number;
  statusText: string;
  readyState: number;
  responseText: string;
  elapsedMs: number;
  lastProgress: number;
  uploadedBytes: number;
  totalBytes: number;
  navigatorOnLine: boolean | string;
  signalAborted: boolean;
  watchdogFired: boolean;
  wallClockTimeoutFired: boolean;
  attempt?: number;
  maxAttempts?: number;
  formattedSummary: string;
}

export class VideoUploadError extends Error {
  diagnostic?: VideoUploadDiagnostic;

  constructor(message: string, diagnostic?: VideoUploadDiagnostic) {
    super(message);
    this.name = 'VideoUploadError';
    this.diagnostic = diagnostic;
    Object.setPrototypeOf(this, VideoUploadError.prototype);
  }
}

export interface UploadStatusUpdate {
  phase: 'uploading' | 'retrying' | 'processing';
  attempt: number;
  maxAttempts: number;
  message: string;
}

export interface UploadImageOptions {
  onProgress?: (percent: number) => void;
  onStatusChange?: (status: UploadStatusUpdate) => void;
  signal?: AbortSignal;
}

export interface UploadAvatarOptions {
  onProgress?: (percent: number) => void;
  onStatusChange?: (status: UploadStatusUpdate) => void;
  signal?: AbortSignal;
}

export interface UploadVideoOptions {
  onProgress?: (percent: number) => void;
  onStatusChange?: (status: UploadStatusUpdate) => void;
  signal?: AbortSignal;
}

// Configuration from environment variables
const CLOUDINARY_CLOUD_NAME = (
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ||
  (typeof process !== 'undefined' ? process.env?.VITE_CLOUDINARY_CLOUD_NAME : '') ||
  'eiwwjhkq'
).trim();

const CLOUDINARY_UPLOAD_PRESET = (
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ||
  (typeof process !== 'undefined' ? process.env?.VITE_CLOUDINARY_UPLOAD_PRESET : '') ||
  'sogo_upload'
).trim();

const CLOUDINARY_VIDEO_PRESET = (
  import.meta.env.VITE_CLOUDINARY_VIDEO_PRESET ||
  (typeof process !== 'undefined' ? process.env?.VITE_CLOUDINARY_VIDEO_PRESET : '') ||
  CLOUDINARY_UPLOAD_PRESET ||
  'sogo_upload'
).trim();

const VALID_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;
const VALID_VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|3gp|mkv|avi)$/i;
const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB limit for feed/story photos
const MAX_AVATAR_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit for profile pictures
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB limit for video reels

// Bounded retry configuration: Attempt 1 -> wait 1.5s -> Attempt 2 -> wait 3s -> Attempt 3
const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1500, 3000];

// Cloudinary chunked upload threshold & chunk size (must be > 5MB for Cloudinary chunked API)
const VIDEO_CHUNK_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB per chunk

// Session-level completed upload caches & in-flight deduplication maps
const completedImageUploads = new Map<string, string>();
const inFlightImageUploads = new Map<string, Promise<string>>();
const completedVideoUploads = new Map<string, VideoUploadResult>();
const inFlightVideoUploads = new Map<string, Promise<VideoUploadResult>>();

/**
 * Normalizes a video filename and MIME type so Android content:// picker files
 * without extensions (e.g. "1000012345") are sent with a valid video filename and MIME.
 */
export function normalizeVideoFileMetadata(file: File | Blob): {
  fileName: string;
  mimeType: string;
} {
  const rawName = ((file as File).name || '').trim();
  const rawType = (file.type || '').trim().toLowerCase();

  let ext = 'mp4';
  const extMatch = rawName.match(/\.(mp4|webm|mov|m4v|3gp|mkv|avi)$/i);
  if (extMatch) {
    ext = extMatch[1].toLowerCase();
  } else if (rawType.includes('webm')) {
    ext = 'webm';
  } else if (rawType.includes('quicktime') || rawType.includes('mov')) {
    ext = 'mov';
  } else if (rawType.includes('3gpp')) {
    ext = '3gp';
  } else if (rawType.includes('x-matroska') || rawType.includes('mkv')) {
    ext = 'mkv';
  }

  const mimeType =
    rawType && rawType.startsWith('video/')
      ? rawType
      : ext === 'webm'
      ? 'video/webm'
      : ext === 'mov'
      ? 'video/quicktime'
      : 'video/mp4';

  const safeBase = rawName
    ? rawName.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'reel'
    : 'reel';

  return {
    fileName: `${safeBase}.${ext}`,
    mimeType,
  };
}

/**
 * Reads a byte range [start, end) from a File/Blob into a pure memory-backed Blob.
 *
 * CRITICAL FOR ANDROID WEBVIEW (Capacitor):
 * Passing a `content://`-backed `File` or `file.slice()` directly to `FormData` + `XMLHttpRequest`
 * causes Chromium's network service (`FileURLLoader`) to call `GetFileInfo` on the Android ContentProvider.
 * When `lastModified` is 0/synthetic or the `<video>` preview holds a stream on the same URI,
 * Chromium aborts the upload with `net::ERR_UPLOAD_FILE_CHANGED` (`xhr.onerror`, status 0).
 * Reading the slice into an `ArrayBuffer` first creates a RAM-backed `Blob` (`kBytes`),
 * completely bypassing `GetFileInfo` and `content://` stream contention during XHR upload.
 */
export async function readSliceAsMemoryBlob(
  file: File | Blob,
  start: number,
  end: number,
  mimeType: string
): Promise<Blob> {
  const slice = file.slice(start, end, mimeType);
  try {
    if (typeof slice.arrayBuffer === 'function') {
      const buffer = await slice.arrayBuffer();
      return new Blob([buffer], { type: mimeType });
    }
  } catch {
    // Fall through to Response / FileReader fallback
  }

  try {
    const buffer = await new Response(slice).arrayBuffer();
    return new Blob([buffer], { type: mimeType });
  } catch {
    // Fall through to FileReader fallback
  }

  return new Promise<Blob>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Blob([reader.result], { type: mimeType }));
      } else {
        reject(new Error('Failed to read video file bytes from device.'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('Failed to read video file bytes from device.'));
    };
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Builds a deterministic fingerprint for a File/Blob so retries of the same file
 * within the session can reuse a completed Cloudinary URL without duplicate uploads.
 */
function getFileFingerprint(file: File | Blob, category: 'image' | 'avatar' | 'video'): string {
  const f = file as File;
  const name = f.name || 'blob';
  const lastModified = f.lastModified || 0;
  const size = file.size || 0;
  const type = file.type || 'unknown';
  if (name === 'blob' && lastModified === 0) {
    return ''; // Anonymous blob without metadata: do not cache across separate calls
  }
  return `${category}:${name}:${size}:${lastModified}:${type}`;
}

/**
 * Generates a unique upload correlation ID shared across chunks of the same logical upload.
 */
function createUniqueUploadId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Waits for a bounded backoff delay while respecting an optional AbortSignal.
 * If the browser/WebView reports offline (`navigator.onLine === false`), waits up to 8s
 * for connectivity to return before starting the next retry attempt.
 */
function waitForRetryBackoff(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Upload was cancelled.'));
      return;
    }

    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    const effectiveDelayMs = isOffline ? Math.max(delayMs, 6000) : delayMs;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener?.('online', onOnline);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Upload was cancelled.'));
    };

    const onOnline = () => {
      // Network came back online; wait 600ms for routes/DNS to stabilize then resolve
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 600);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (isOffline && typeof window !== 'undefined') {
      window.addEventListener?.('online', onOnline, { once: true });
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, effectiveDelayMs);
  });
}

/**
 * Determines whether an HTTP status code is transient and safe to retry.
 * - 408 Request Timeout, 429 Too Many Requests, and 5xx Server Errors are retryable.
 * - 400, 401, 403, 404, 413, 422 (validation / preset / size / auth errors) are NOT retryable.
 */
function isRetryableHttpStatus(status: number): boolean {
  if (status === 0) return true; // Network / socket interruption
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

interface InternalImageAttemptError extends Error {
  isRetryable: boolean;
  reason: 'ABORT' | 'TIMEOUT' | 'HTTP' | 'NETWORK' | 'VALIDATION';
  status?: number;
}

function createImageAttemptError(
  message: string,
  reason: 'ABORT' | 'TIMEOUT' | 'HTTP' | 'NETWORK' | 'VALIDATION',
  isRetryable: boolean,
  status?: number
): InternalImageAttemptError {
  const err = new Error(message) as InternalImageAttemptError;
  err.reason = reason;
  err.isRetryable = isRetryable;
  err.status = status;
  return err;
}

/**
 * Executes a single XHR image/avatar upload attempt to Cloudinary with:
 * - Fresh FormData construction
 * - Live progress callbacks (0-99% during byte transfer, 100% on verified response)
 * - Two-phase watchdog timer (60s byte-transfer inactivity, 180s server-processing timeout once 100% sent)
 */
function executeImageUploadAttempt(params: {
  file: File | Blob;
  uploadUrl: string;
  uploadPreset: string;
  uniqueUploadId: string;
  mediaLabel: 'image' | 'avatar';
  attempt: number;
  maxAttempts: number;
  onProgress?: (percent: number) => void;
  onProcessingPhase?: () => void;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    file,
    uploadUrl,
    uploadPreset,
    uniqueUploadId,
    mediaLabel,
    attempt,
    maxAttempts,
    onProgress,
    onProcessingPhase,
    signal,
  } = params;

  return new Promise<string>((resolve, reject) => {
    const startTime = performance.now();
    const fileSizeKB = (file.size / 1024).toFixed(1);
    console.info(
      `[UPLOAD] Starting ${mediaLabel} upload (attempt ${attempt}/${maxAttempts}, ${fileSizeKB} KB)`
    );

    // Construct fresh FormData for every attempt so Android WebView streams cleanly
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    try {
      xhr.setRequestHeader('X-Unique-Upload-Id', uniqueUploadId);
    } catch {}

    let isSettled = false;
    let lastPercent = 0;
    let allBytesSent = false;

    const BYTE_INACTIVITY_TIMEOUT_MS = 60000; // 60s without byte movement
    const SERVER_PROCESSING_TIMEOUT_MS = 180000; // 180s once 100% bytes uploaded
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const safeResolve = (url: string) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(url);
    };

    const safeReject = (err: InternalImageAttemptError) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(err);
    };

    const resetWatchdogTimer = (timeoutMs: number = BYTE_INACTIVITY_TIMEOUT_MS) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        try {
          xhr.abort();
        } catch {}
        safeReject(
          createImageAttemptError(
            'Upload timed out due to a slow or stalled connection.',
            'TIMEOUT',
            true,
            xhr.status
          )
        );
      }, timeoutMs);
    };

    resetWatchdogTimer(BYTE_INACTIVITY_TIMEOUT_MS);

    if (signal) {
      if (signal.aborted) {
        try {
          xhr.abort();
        } catch {}
        safeReject(createImageAttemptError('Image upload was cancelled.', 'ABORT', false));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          try {
            xhr.abort();
          } catch {}
          safeReject(createImageAttemptError('Image upload was cancelled.', 'ABORT', false));
        },
        { once: true }
      );
    }

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            onProgress?.(percent);
          }
          if (event.loaded >= event.total && !allBytesSent) {
            allBytesSent = true;
            onProcessingPhase?.();
            // All request bytes sent; give Cloudinary ample server-side processing time
            resetWatchdogTimer(SERVER_PROCESSING_TIMEOUT_MS);
          } else if (!allBytesSent) {
            resetWatchdogTimer(BYTE_INACTIVITY_TIMEOUT_MS);
          }
        } else {
          resetWatchdogTimer(BYTE_INACTIVITY_TIMEOUT_MS);
        }
      };
    }

    xhr.onload = () => {
      const durationMs = Math.round(performance.now() - startTime);
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (
          xhr.status >= 200 &&
          xhr.status < 300 &&
          typeof data.secure_url === 'string' &&
          data.secure_url.startsWith('https://')
        ) {
          onProgress?.(100);
          console.info(
            `[UPLOAD] ${mediaLabel} upload succeeded on attempt ${attempt}/${maxAttempts} in ${durationMs}ms`
          );
          safeResolve(data.secure_url);
        } else {
          const retryable = isRetryableHttpStatus(xhr.status);
          const errMsg =
            data?.error?.message || `Failed to upload image (HTTP ${xhr.status}).`;
          console.warn(
            `[UPLOAD] ${mediaLabel} HTTP error on attempt ${attempt}/${maxAttempts} (status ${xhr.status}, retryable=${retryable}): ${errMsg}`
          );
          safeReject(createImageAttemptError(errMsg, 'HTTP', retryable, xhr.status));
        }
      } catch {
        const retryable = isRetryableHttpStatus(xhr.status) || xhr.status >= 500 || xhr.status === 0;
        safeReject(
          createImageAttemptError(
            'Invalid response from image server.',
            'HTTP',
            retryable,
            xhr.status
          )
        );
      }
    };

    xhr.onerror = () => {
      if (signal?.aborted) {
        safeReject(createImageAttemptError('Image upload was cancelled.', 'ABORT', false));
        return;
      }
      const durationMs = Math.round(performance.now() - startTime);
      console.warn(
        `[UPLOAD] ${mediaLabel} network interruption on attempt ${attempt}/${maxAttempts} after ${durationMs}ms (status=${xhr.status}, lastPercent=${lastPercent}%)`
      );
      safeReject(
        createImageAttemptError(
          'Network error while uploading image.',
          'NETWORK',
          true,
          xhr.status
        )
      );
    };

    xhr.ontimeout = () => {
      safeReject(
        createImageAttemptError(
          'Upload timed out.',
          'TIMEOUT',
          true,
          xhr.status
        )
      );
    };

    xhr.onabort = () => {
      if (!isSettled) {
        safeReject(createImageAttemptError('Image upload was cancelled.', 'ABORT', false));
      }
    };

    xhr.send(formData);
  });
}

/**
 * Safely compresses and resizes high-resolution photos in-browser using standard HTML5 Canvas
 * before network transmission, reducing cellular upload payloads by 80-95% while preserving visual clarity.
 * - Leaves animated GIFs, SVGs, and files already under 280KB untouched.
 * - Proportional aspect-ratio downscaling with maximum dimension limits:
 *   - Feed / story images: max 1600px, quality 0.86 (crystal-clear on mobile & tablet)
 *   - Avatar / profile photos: max 512px, quality 0.85
 * - Zero external library dependencies (uses native createImageBitmap / HTMLCanvasElement).
 * - Safe fallback: if canvas decoding fails or if the output is larger, returns the original file untouched.
 */
async function compressImageBeforeUpload(
  file: File | Blob,
  maxDimension: number,
  quality = 0.86
): Promise<File | Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return file;
  }

  const mime = file.type?.toLowerCase() || '';
  const fileName = (file as File).name || 'image.jpg';

  // Never alter animated GIFs, SVGs, or already small files (<= 280 KB)
  if (mime.includes('gif') || mime.includes('svg') || file.size <= 280 * 1024) {
    return file;
  }

  try {
    let sourceWidth = 0;
    let sourceHeight = 0;
    let imageSource: ImageBitmap | HTMLImageElement;

    if (typeof window.createImageBitmap === 'function') {
      imageSource = await window.createImageBitmap(file);
      sourceWidth = imageSource.width;
      sourceHeight = imageSource.height;
    } else {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image for compression'));
          img.src = objectUrl;
        });
        imageSource = img;
        sourceWidth = img.naturalWidth || img.width;
        sourceHeight = img.naturalHeight || img.height;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    if (!sourceWidth || !sourceHeight) {
      if ('close' in imageSource && typeof (imageSource as ImageBitmap).close === 'function') {
        (imageSource as ImageBitmap).close();
      }
      return file;
    }

    // Determine target dimensions preserving exact aspect ratio
    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;

    if (sourceWidth > maxDimension || sourceHeight > maxDimension) {
      if (sourceWidth >= sourceHeight) {
        targetWidth = maxDimension;
        targetHeight = Math.round((sourceHeight * maxDimension) / sourceWidth);
      } else {
        targetHeight = maxDimension;
        targetWidth = Math.round((sourceWidth * maxDimension) / sourceHeight);
      }
    } else if (file.size <= 500 * 1024) {
      // Dimensions are already within bounds and file is under 500KB: keep original
      if ('close' in imageSource && typeof (imageSource as ImageBitmap).close === 'function') {
        (imageSource as ImageBitmap).close();
      }
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if ('close' in imageSource && typeof (imageSource as ImageBitmap).close === 'function') {
        (imageSource as ImageBitmap).close();
      }
      return file;
    }

    // High quality bicubic downsampling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageSource, 0, 0, targetWidth, targetHeight);

    if ('close' in imageSource && typeof (imageSource as ImageBitmap).close === 'function') {
      (imageSource as ImageBitmap).close();
    }

    // Determine output MIME: keep PNG for transparent images, otherwise JPEG
    const outputMime = mime.includes('png') ? 'image/png' : 'image/jpeg';
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), outputMime, quality);
    });

    if (!compressedBlob || compressedBlob.size === 0) {
      return file;
    }

    // If compression didn't actually reduce size, keep original
    if (compressedBlob.size >= file.size) {
      return file;
    }

    // Reconstruct File object if original was a File
    if (file instanceof File) {
      const ext = outputMime === 'image/png' ? '.png' : '.jpg';
      const cleanBase = fileName.replace(/\.[^/.]+$/, '');
      return new File([compressedBlob], `${cleanBase}${ext}`, {
        type: outputMime,
        lastModified: Date.now(),
      });
    }

    return compressedBlob;
  } catch (err) {
    console.warn('[STORAGE] Client-side image compression fallback to original:', err);
    return file;
  }
}

/**
 * Shared resilient image upload runner with automatic bounded retries and idempotency.
 */
async function runResilientImageUpload(
  file: File | Blob,
  mediaLabel: 'image' | 'avatar',
  maxSizeBytes: number,
  options?: UploadImageOptions
): Promise<string> {
  if (!file || file.size === 0) {
    throw new Error('Selected image file is empty. Please choose another photo.');
  }

  const fileName = (file as File).name || '';
  const hasValidMime = Boolean(file.type && file.type.startsWith('image/'));
  const hasValidExt = Boolean(fileName && VALID_IMAGE_EXTENSIONS.test(fileName));

  if (!hasValidMime && !hasValidExt) {
    throw new Error('Please select a valid image file (JPG, PNG, or WebP).');
  }

  if (file.size > maxSizeBytes) {
    const maxMB = Math.round(maxSizeBytes / (1024 * 1024));
    throw new Error(`Image is too large. Please select a photo under ${maxMB}MB.`);
  }

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Image upload service is not configured.');
  }

  // 1. Check session idempotency cache so retries of an already-uploaded file return immediately
  const fingerprint = getFileFingerprint(file, mediaLabel);
  if (fingerprint && completedImageUploads.has(fingerprint)) {
    const cachedUrl = completedImageUploads.get(fingerprint)!;
    options?.onProgress?.(100);
    return cachedUrl;
  }

  // 2. Deduplicate identical concurrent in-flight uploads
  if (fingerprint && inFlightImageUploads.has(fingerprint)) {
    return inFlightImageUploads.get(fingerprint)!;
  }

  const uploadTask = (async (): Promise<string> => {
    // Compress and downscale high-resolution photo before network transmission
    const maxDim = mediaLabel === 'avatar' ? 512 : 1600;
    const compressionQuality = mediaLabel === 'avatar' ? 0.85 : 0.86;
    let targetUploadFile = file;
    try {
      targetUploadFile = await compressImageBeforeUpload(file, maxDim, compressionQuality);
    } catch {
      targetUploadFile = file;
    }

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const uniqueUploadId = createUniqueUploadId(mediaLabel);
    const overallStart = performance.now();
    perf.start('UPLOAD', `${mediaLabel}_upload`, { sizeBytes: targetUploadFile.size });

    let lastError: InternalImageAttemptError | null = null;

    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      if (options?.signal?.aborted) {
        throw new Error('Image upload was cancelled.');
      }

      if (attempt === 1) {
        options?.onStatusChange?.({
          phase: 'uploading',
          attempt,
          maxAttempts: MAX_UPLOAD_ATTEMPTS,
          message: 'Uploading photo…',
        });
      } else {
        options?.onStatusChange?.({
          phase: 'uploading',
          attempt,
          maxAttempts: MAX_UPLOAD_ATTEMPTS,
          message: `Uploading photo (Attempt ${attempt} of ${MAX_UPLOAD_ATTEMPTS})…`,
        });
      }

      try {
        const secureUrl = await executeImageUploadAttempt({
          file: targetUploadFile,
          uploadUrl,
          uploadPreset: CLOUDINARY_UPLOAD_PRESET,
          uniqueUploadId,
          mediaLabel,
          attempt,
          maxAttempts: MAX_UPLOAD_ATTEMPTS,
          onProgress: options?.onProgress,
          onProcessingPhase: () => {
            options?.onStatusChange?.({
              phase: 'processing',
              attempt,
              maxAttempts: MAX_UPLOAD_ATTEMPTS,
              message: 'Finalizing photo…',
            });
          },
          signal: options?.signal,
        });

        if (fingerprint) {
          completedImageUploads.set(fingerprint, secureUrl);
        }

        perf.end('UPLOAD', `${mediaLabel}_upload`, {
          status: 'success',
          attempt,
          totalDurationMs: Math.round(performance.now() - overallStart),
        });
        return secureUrl;
      } catch (err: any) {
        const attemptErr = err as InternalImageAttemptError;
        lastError = attemptErr;

        const canRetry =
          attempt < MAX_UPLOAD_ATTEMPTS &&
          Boolean(attemptErr?.isRetryable) &&
          !options?.signal?.aborted;

        if (!canRetry) {
          break;
        }

        const backoffMs = RETRY_DELAYS_MS[attempt - 1] ?? 2000;
        console.warn(
          `[UPLOAD] ${mediaLabel} attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} failed (${attemptErr.reason}). Retrying in ${backoffMs}ms...`
        );

        options?.onStatusChange?.({
          phase: 'retrying',
          attempt: attempt + 1,
          maxAttempts: MAX_UPLOAD_ATTEMPTS,
          message: 'Connection interrupted. Retrying...',
        });

        await waitForRetryBackoff(backoffMs, options?.signal);
      }
    }

    perf.end('UPLOAD', `${mediaLabel}_upload`, {
      status: 'failed',
      reason: lastError?.reason || 'UNKNOWN',
      totalDurationMs: Math.round(performance.now() - overallStart),
    });

    if (lastError?.reason === 'ABORT') {
      throw new Error('Image upload was cancelled.');
    }
    if (lastError && !lastError.isRetryable) {
      throw new Error(lastError.message);
    }

    throw new Error('Upload failed. Please check your connection and try again.');
  })();

  if (fingerprint) {
    inFlightImageUploads.set(fingerprint, uploadTask);
  }

  try {
    return await uploadTask;
  } finally {
    if (fingerprint) {
      inFlightImageUploads.delete(fingerprint);
    }
  }
}

/**
 * Uploads a feed or story image to Cloudinary using the unsigned upload preset.
 * - Automatically retries transient network interruptions up to 3 attempts (1s -> 2s backoff).
 * - Never returns multi-megabyte base64 Data URLs that would break Firestore's 1MB document limit.
 */
export async function uploadImage(
  file: File | Blob,
  options?: UploadImageOptions
): Promise<string> {
  return runResilientImageUpload(file, 'image', MAX_IMAGE_SIZE_BYTES, options);
}

/**
 * Uploads a profile picture directly to Cloudinary using the existing unsigned preset.
 * - Validates image MIME type / extension and file size (max 10MB).
 * - Tracks live upload progress (0-100%) via XMLHttpRequest.
 * - Automatically retries transient network interruptions up to 3 attempts (1s -> 2s backoff).
 * - Strictly returns a Cloudinary HTTPS URL and never stores base64 data in Firestore.
 */
export async function uploadAvatarImage(
  file: File | Blob,
  options?: UploadAvatarOptions
): Promise<string> {
  return runResilientImageUpload(file, 'avatar', MAX_AVATAR_SIZE_BYTES, options);
}

/**
 * Executes a single video upload request (either full file <= 6MB or a single 6MB chunk)
 * to Cloudinary via XMLHttpRequest using a memory-backed Blob.
 */
function executeVideoUploadAttempt(params: {
  chunkBlob: Blob;
  fileName: string;
  uploadUrl: string;
  uploadPreset: string;
  uniqueUploadId?: string;
  contentRange?: string;
  isFinalChunk: boolean;
  chunkStartByte: number;
  chunkByteSize: number;
  totalFileBytes: number;
  attempt: number;
  maxAttempts: number;
  onProgress?: (percent: number) => void;
  onProcessingPhase?: () => void;
  signal?: AbortSignal;
}): Promise<VideoUploadResult | null> {
  const {
    chunkBlob,
    fileName,
    uploadUrl,
    uploadPreset,
    uniqueUploadId,
    contentRange,
    isFinalChunk,
    chunkStartByte,
    chunkByteSize,
    totalFileBytes,
    attempt,
    maxAttempts,
    onProgress,
    onProcessingPhase,
    signal,
  } = params;

  return new Promise((resolve, reject) => {
    const uploadStartTime = performance.now();
    const chunkSizeMB = (chunkByteSize / (1024 * 1024)).toFixed(2);
    console.info(
      `[Reel Upload] Upload starting (attempt ${attempt}/${maxAttempts}, chunkBytes=${chunkSizeMB} MB, range=${contentRange || 'single-part'})`
    );

    // Construct fresh FormData with an explicit filename and memory-backed Blob
    const formData = new FormData();
    formData.append('file', chunkBlob, fileName);
    formData.append('upload_preset', uploadPreset);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);

    // Only attach chunk headers when performing a multi-chunk upload (> 6MB).
    // Keeping single-part uploads free of custom headers makes them simple CORS requests
    // (no preflight OPTIONS round-trip and no upload-ID state collision across retries).
    if (contentRange && uniqueUploadId) {
      try {
        xhr.setRequestHeader('X-Unique-Upload-Id', uniqueUploadId);
        xhr.setRequestHeader('Content-Range', contentRange);
      } catch {}
    }

    let isSettled = false;
    let watchdogFired = false;
    let wallClockTimeoutFired = false;
    let abortFired = false;
    let allBytesSent = false;
    let lastReportedPercent = Math.min(
      99,
      Math.round((chunkStartByte / Math.max(1, totalFileBytes)) * 100)
    );
    let loadedBytes = chunkStartByte;
    const totalBytes = totalFileBytes;

    let safeUrlTarget = 'api.cloudinary.com';
    try {
      const parsed = new URL(uploadUrl);
      safeUrlTarget = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      safeUrlTarget = 'api.cloudinary.com/video/upload';
    }

    const buildDiagnostic = (
      event: string,
      reason: 'ABORT' | 'TIMEOUT' | 'HTTP' | 'NETWORK',
      extraDetail?: string
    ): VideoUploadDiagnostic => {
      const elapsedMs = Math.round(performance.now() - uploadStartTime);
      const safeResponseSnippet = xhr.responseText
        ? xhr.responseText.slice(0, 300).replace(/\r?\n|\r/g, ' ')
        : 'none';
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : 'unknown';

      console.warn(
        `[Reel Upload] Error type/status: reason=${reason}, status=${xhr.status}, event=${event}, progress=${lastReportedPercent}%`
      );

      const formattedSummary =
        `VIDEO UPLOAD FAILURE DIAGNOSTIC\n` +
        `attempt: ${attempt} of ${maxAttempts}\n` +
        `event: ${event}\n` +
        `reason: ${reason}\n` +
        `target: ${safeUrlTarget}\n` +
        `status: ${xhr.status}\n` +
        `statusText: ${xhr.statusText || 'n/a'}\n` +
        `readyState: ${xhr.readyState}\n` +
        `responseText: ${safeResponseSnippet}\n` +
        `elapsedMs: ${elapsedMs}\n` +
        `lastProgress: ${lastReportedPercent}%\n` +
        `uploadedBytes: ${loadedBytes}\n` +
        `totalBytes: ${totalBytes}\n` +
        `navigator.onLine: ${isOnline}\n` +
        `signalAborted: ${Boolean(signal?.aborted)}\n` +
        `watchdogFired: ${watchdogFired}\n` +
        `wallClockTimeoutFired: ${wallClockTimeoutFired}` +
        (extraDetail ? `\ndetail: ${extraDetail}` : '');

      console.warn(`\n========== ${formattedSummary} ==========\n`);

      return {
        event,
        reason,
        target: safeUrlTarget,
        status: xhr.status,
        statusText: xhr.statusText || 'n/a',
        readyState: xhr.readyState,
        responseText: safeResponseSnippet,
        elapsedMs,
        lastProgress: lastReportedPercent,
        uploadedBytes: loadedBytes,
        totalBytes,
        navigatorOnLine: isOnline,
        signalAborted: Boolean(signal?.aborted),
        watchdogFired,
        wallClockTimeoutFired,
        attempt,
        maxAttempts,
        formattedSummary,
      };
    };

    const safeRejectWithDiagnostic = (
      message: string,
      event: string,
      reason: 'ABORT' | 'TIMEOUT' | 'HTTP' | 'NETWORK',
      extraDetail?: string
    ) => {
      if (isSettled) return;
      isSettled = true;
      cleanupTimers();
      const diagnostic = buildDiagnostic(event, reason, extraDetail);
      reject(new VideoUploadError(message, diagnostic));
    };

    const safeResolve = (res: VideoUploadResult | null) => {
      if (isSettled) return;
      isSettled = true;
      cleanupTimers();
      resolve(res);
    };

    // Two-phase activity watchdog:
    // - Phase 1 (Active byte transfer): 90s inactivity window that resets whenever bytes advance.
    // - Phase 2 (100% of bytes sent, waiting for Cloudinary server processing): 180s window so large videos
    //   are never prematurely aborted while Cloudinary finalizes metadata and thumbnail generation.
    const BYTE_INACTIVITY_TIMEOUT_MS = 90000;
    const SERVER_PROCESSING_TIMEOUT_MS = 180000;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

    const resetInactivityTimer = (timeoutMs: number = BYTE_INACTIVITY_TIMEOUT_MS) => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        watchdogFired = true;
        try {
          xhr.abort();
        } catch {}
        safeRejectWithDiagnostic(
          'VIDEO_UPLOAD_TIMEOUT: Upload timed out due to a stalled connection. Please check your connection and try again.',
          allBytesSent ? 'server_processing_watchdog' : 'inactivity_watchdog',
          'TIMEOUT',
          allBytesSent
            ? 'Server processing timed out after 180s waiting for response'
            : 'Inactivity watchdog fired (no byte progress for 90s)'
        );
      }, timeoutMs);
    };

    resetInactivityTimer(BYTE_INACTIVITY_TIMEOUT_MS);

    // Maximum overall timeout per request: allow at least 20 minutes
    const MAX_WALL_CLOCK_TIMEOUT_MS = Math.max(
      20 * 60 * 1000,
      Math.ceil(chunkByteSize / 20000) * 1000
    );
    const overallTimer = setTimeout(() => {
      wallClockTimeoutFired = true;
      try {
        xhr.abort();
      } catch {}
      safeRejectWithDiagnostic(
        'VIDEO_UPLOAD_TIMEOUT: Overall upload duration limit exceeded. Please try again.',
        'wall_clock_timeout',
        'TIMEOUT',
        'Maximum overall wall-clock time limit reached'
      );
    }, MAX_WALL_CLOCK_TIMEOUT_MS);

    const cleanupTimers = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      if (overallTimer) {
        clearTimeout(overallTimer);
      }
    };

    if (signal) {
      if (signal.aborted) {
        abortFired = true;
        try {
          xhr.abort();
        } catch {}
        safeRejectWithDiagnostic(
          'VIDEO_UPLOAD_ABORTED: Upload was cancelled.',
          'signal_aborted_pre_send',
          'ABORT',
          'AbortSignal was already aborted before XHR send'
        );
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          abortFired = true;
          try {
            xhr.abort();
          } catch {}
          safeRejectWithDiagnostic(
            'VIDEO_UPLOAD_ABORTED: Upload was cancelled.',
            'signal_abort_event',
            'ABORT',
            'AbortSignal abort event received'
          );
        },
        { once: true }
      );
    }

    let lastProgressTime = 0;

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const chunkLoaded = Math.min(
            chunkByteSize,
            Math.round((event.loaded / event.total) * chunkByteSize)
          );
          loadedBytes = Math.min(totalFileBytes, chunkStartByte + chunkLoaded);
          const now = performance.now();
          const percent = Math.min(99, Math.round((loadedBytes / totalFileBytes) * 100));

          if (
            percent !== lastReportedPercent &&
            (now - lastProgressTime >= 80 || percent >= 99)
          ) {
            lastReportedPercent = percent;
            lastProgressTime = now;
            onProgress?.(percent);
          }

          if (event.loaded >= event.total && !allBytesSent) {
            allBytesSent = true;
            if (isFinalChunk) {
              onProcessingPhase?.();
            }
            resetInactivityTimer(SERVER_PROCESSING_TIMEOUT_MS);
          } else if (!allBytesSent) {
            resetInactivityTimer(BYTE_INACTIVITY_TIMEOUT_MS);
          }
        } else {
          resetInactivityTimer(BYTE_INACTIVITY_TIMEOUT_MS);
        }
      };
    }

    xhr.onload = () => {
      const uploadEndTime = performance.now();
      const durationMs = uploadEndTime - uploadStartTime;
      const speedMBs =
        durationMs > 0 ? (chunkByteSize / (1024 * 1024)) / (durationMs / 1000) : 0;

      console.info(`[Reel Upload] Cloudinary response status: ${xhr.status}`);

      try {
        const response = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          // Intermediate chunk acknowledged by Cloudinary
          if (!isFinalChunk && response.done === false) {
            const chunkEndPercent = Math.min(
              99,
              Math.round(((chunkStartByte + chunkByteSize) / totalFileBytes) * 100)
            );
            onProgress?.(chunkEndPercent);
            safeResolve(null);
            return;
          }

          if (
            typeof response.secure_url === 'string' &&
            response.secure_url.startsWith('https://')
          ) {
            console.info(
              `[Reel Upload] Cloudinary upload successful (publicId=${response.public_id || 'n/a'}, ${durationMs.toFixed(1)}ms, ${speedMBs.toFixed(2)} MB/s)`
            );

            const videoUrl: string = response.secure_url;
            const thumbnailUrl =
              response.thumbnail_url ||
              videoUrl.replace(/\.[a-zA-Z0-9]+$/, '.jpg');

            // Eagerly warm the optimized playback derivative (f_auto:video,q_auto:good,c_limit,w_1080,h_1920)
            // and poster image immediately on upload completion so the first viewer never hits cold transcoding.
            warmCloudinaryVideoPlayback(videoUrl, thumbnailUrl);

            onProgress?.(100);

            safeResolve({
              videoUrl,
              thumbnailUrl,
              duration: response.duration || 0,
              publicId: response.public_id,
              format: response.format || 'mp4',
            });
            return;
          }
        }

        const errMsg =
          response.error?.message || `Upload failed with HTTP status ${xhr.status}`;
        safeRejectWithDiagnostic(
          `VIDEO_UPLOAD_HTTP_ERROR: ${errMsg}`,
          'onload_http_error',
          'HTTP',
          `Cloudinary error: ${errMsg}`
        );
      } catch {
        safeRejectWithDiagnostic(
          'VIDEO_UPLOAD_HTTP_ERROR: Failed to parse Cloudinary response.',
          'onload_parse_error',
          'HTTP',
          'Failed to parse JSON response from server'
        );
      }
    };

    xhr.onerror = () => {
      if (signal?.aborted || abortFired) {
        safeRejectWithDiagnostic(
          'VIDEO_UPLOAD_ABORTED: Upload was cancelled.',
          'onerror_after_abort',
          'ABORT',
          'onerror triggered following cancellation'
        );
        return;
      }

      if (watchdogFired || wallClockTimeoutFired) {
        safeRejectWithDiagnostic(
          'VIDEO_UPLOAD_TIMEOUT: Upload timed out.',
          'onerror_after_timeout',
          'TIMEOUT',
          'onerror triggered following timeout'
        );
        return;
      }

      if (xhr.status > 0) {
        safeRejectWithDiagnostic(
          `VIDEO_UPLOAD_HTTP_ERROR: Server returned status ${xhr.status}.`,
          'onerror_http',
          'HTTP',
          `onerror with HTTP status ${xhr.status}`
        );
        return;
      }

      safeRejectWithDiagnostic(
        'VIDEO_UPLOAD_NETWORK_ERROR: Network error occurred while uploading video. Please check your connection.',
        'onerror',
        'NETWORK',
        `Socket / CORS / WebView network failure (status 0, readyState ${xhr.readyState}, online: ${typeof navigator !== 'undefined' ? navigator.onLine : 'unknown'})`
      );
    };

    xhr.ontimeout = () => {
      safeRejectWithDiagnostic(
        'VIDEO_UPLOAD_TIMEOUT: Upload timed out. Please try again.',
        'ontimeout',
        'TIMEOUT',
        'Native XHR ontimeout event fired'
      );
    };

    xhr.onabort = () => {
      abortFired = true;
      if (!isSettled) {
        safeRejectWithDiagnostic(
          'VIDEO_UPLOAD_ABORTED: Upload was cancelled.',
          'onabort',
          'ABORT',
          'Native XHR onabort event fired'
        );
      }
    };

    xhr.send(formData);
  });
}

/**
 * Determines whether a VideoUploadError is transient and should be automatically retried.
 */
function isRetryableVideoError(err: unknown): boolean {
  if (!(err instanceof VideoUploadError) || !err.diagnostic) {
    return false;
  }
  const { reason, status } = err.diagnostic;
  if (reason === 'ABORT') return false;
  if (reason === 'NETWORK' || reason === 'TIMEOUT') return true;
  if (reason === 'HTTP') {
    return isRetryableHttpStatus(status);
  }
  return false;
}

/**
 * Uploads a video file directly to Cloudinary using unsigned upload preset.
 * - Reads file slices into memory-backed Blobs before XHR to prevent Android WebView content:// ERR_UPLOAD_FILE_CHANGED errors.
 * - Uses single-part upload (without custom headers) for videos <= 6MB and 6MB resumable chunked uploads for videos > 6MB.
 * - Reports real upload progress via optional onProgress callback (0-100%).
 * - Automatically retries transient network interruptions up to 3 attempts (1.5s -> 3s exponential backoff).
 * - Deduplicates in-flight and completed uploads per file fingerprint so retries never create duplicate media.
 */
export async function uploadVideo(
  file: File | Blob,
  onProgressOrOptions?: ((percent: number) => void) | UploadVideoOptions
): Promise<VideoUploadResult> {
  const onProgress =
    typeof onProgressOrOptions === 'function'
      ? onProgressOrOptions
      : onProgressOrOptions?.onProgress;
  const onStatusChange =
    typeof onProgressOrOptions === 'object' ? onProgressOrOptions?.onStatusChange : undefined;
  const signal =
    typeof onProgressOrOptions === 'object' ? onProgressOrOptions?.signal : undefined;

  if (!file || file.size === 0) {
    throw new Error('Selected video file is empty. Please choose another video.');
  }

  const rawFileName = (file as File).name || '';
  const hasValidMime = Boolean(
    file.type && (file.type.startsWith('video/') || file.type === 'application/octet-stream')
  );
  const hasValidExt = Boolean(rawFileName && VALID_VIDEO_EXTENSIONS.test(rawFileName));

  if (!hasValidMime && !hasValidExt) {
    throw new Error('Please select a valid video file (MP4, WebM, MOV).');
  }

  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error('Video file is too large. Please select a video smaller than 100MB.');
  }

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_VIDEO_PRESET) {
    throw new Error('Video upload service is not configured.');
  }

  const { fileName, mimeType } = normalizeVideoFileMetadata(file);

  console.info(`[Reel Upload] Selected file: ${fileName}`);
  console.info(`[Reel Upload] File size: ${file.size} bytes (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.info(`[Reel Upload] MIME type: ${mimeType}`);

  // 1. Check session idempotency cache so retrying after a post-upload error reuses the existing Cloudinary video
  const fingerprint = getFileFingerprint(file, 'video');
  if (fingerprint && completedVideoUploads.has(fingerprint)) {
    const cachedResult = completedVideoUploads.get(fingerprint)!;
    onProgress?.(100);
    return cachedResult;
  }

  // 2. Deduplicate identical concurrent in-flight video uploads
  if (fingerprint && inFlightVideoUploads.has(fingerprint)) {
    return inFlightVideoUploads.get(fingerprint)!;
  }

  const uploadTask = (async (): Promise<VideoUploadResult> => {
    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
    const uniqueUploadId = createUniqueUploadId('video');
    const overallStart = performance.now();
    perf.start('UPLOAD', 'video_upload', { sizeBytes: file.size });

    const totalFileBytes = file.size;
    const totalChunks = Math.max(1, Math.ceil(totalFileBytes / VIDEO_CHUNK_SIZE_BYTES));
    const isChunked = totalChunks > 1;

    let finalResult: VideoUploadResult | null = null;
    let lastError: unknown = null;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const chunkStartByte = chunkIndex * VIDEO_CHUNK_SIZE_BYTES;
      const chunkEndByte = Math.min(chunkStartByte + VIDEO_CHUNK_SIZE_BYTES, totalFileBytes);
      const chunkByteSize = chunkEndByte - chunkStartByte;
      const isFinalChunk = chunkIndex === totalChunks - 1;
      const contentRange = isChunked
        ? `bytes ${chunkStartByte}-${chunkEndByte - 1}/${totalFileBytes}`
        : undefined;

      // Materialize this chunk into a RAM-backed Blob before XHR so Android WebView never
      // aborts FormData streaming with net::ERR_UPLOAD_FILE_CHANGED on content:// URIs.
      let chunkBlob: Blob;
      try {
        chunkBlob = await readSliceAsMemoryBlob(file, chunkStartByte, chunkEndByte, mimeType);
      } catch (readErr) {
        const msg =
          'Could not read the selected video file from your device. Please re-select the video and try again.';
        console.error(`[Reel Upload] Upload failed (local file read error):`, readErr);
        throw new Error(msg);
      }

      let chunkSucceeded = false;

      for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
        if (signal?.aborted) {
          throw new VideoUploadError('VIDEO_UPLOAD_ABORTED: Upload was cancelled.');
        }

        if (attempt === 1) {
          onStatusChange?.({
            phase: 'uploading',
            attempt,
            maxAttempts: MAX_UPLOAD_ATTEMPTS,
            message: 'Uploading to SogoSocial…',
          });
        } else {
          if (!isChunked) {
            onProgress?.(0);
          } else {
            const basePercent = Math.min(
              99,
              Math.round((chunkStartByte / totalFileBytes) * 100)
            );
            onProgress?.(basePercent);
          }
          onStatusChange?.({
            phase: 'uploading',
            attempt,
            maxAttempts: MAX_UPLOAD_ATTEMPTS,
            message: `Uploading to SogoSocial (Attempt ${attempt} of ${MAX_UPLOAD_ATTEMPTS})…`,
          });
        }

        try {
          const result = await executeVideoUploadAttempt({
            chunkBlob,
            fileName,
            uploadUrl,
            uploadPreset: CLOUDINARY_VIDEO_PRESET,
            uniqueUploadId: isChunked ? uniqueUploadId : undefined,
            contentRange,
            isFinalChunk,
            chunkStartByte,
            chunkByteSize,
            totalFileBytes,
            attempt,
            maxAttempts: MAX_UPLOAD_ATTEMPTS,
            onProgress,
            onProcessingPhase: () => {
              onStatusChange?.({
                phase: 'processing',
                attempt,
                maxAttempts: MAX_UPLOAD_ATTEMPTS,
                message: 'Processing video…',
              });
            },
            signal,
          });

          chunkSucceeded = true;
          if (isFinalChunk && result) {
            finalResult = result;
          }
          break;
        } catch (err: unknown) {
          lastError = err;

          const canRetry =
            attempt < MAX_UPLOAD_ATTEMPTS &&
            isRetryableVideoError(err) &&
            !signal?.aborted;

          if (!canRetry) {
            break;
          }

          const backoffMs = RETRY_DELAYS_MS[attempt - 1] ?? 3000;
          const reason = err instanceof VideoUploadError ? err.diagnostic?.reason : 'NETWORK';
          console.warn(
            `[Reel Upload] Attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} interrupted (${reason}). Retrying in ${backoffMs}ms...`
          );

          onStatusChange?.({
            phase: 'retrying',
            attempt: attempt + 1,
            maxAttempts: MAX_UPLOAD_ATTEMPTS,
            message: 'Connection interrupted. Retrying...',
          });

          await waitForRetryBackoff(backoffMs, signal);
        }
      }

      if (!chunkSucceeded) {
        break;
      }
    }

    if (finalResult) {
      if (fingerprint) {
        completedVideoUploads.set(fingerprint, finalResult);
      }

      perf.end('UPLOAD', 'video_upload', {
        status: 'success',
        totalDurationMs: Math.round(performance.now() - overallStart),
      });
      return finalResult;
    }

    perf.end('UPLOAD', 'video_upload', {
      status: 'failed',
      reason: lastError instanceof VideoUploadError ? lastError.diagnostic?.reason : 'UNKNOWN',
      totalDurationMs: Math.round(performance.now() - overallStart),
    });

    console.error(
      `[Reel Upload] Upload failed:`,
      lastError instanceof Error ? lastError.message : lastError
    );

    if (lastError instanceof VideoUploadError) {
      if (lastError.diagnostic?.reason === 'ABORT') {
        throw lastError;
      }
      if (!isRetryableVideoError(lastError)) {
        throw lastError;
      }
      throw new VideoUploadError(
        'Upload failed. Please check your connection and try again.',
        lastError.diagnostic
      );
    }

    throw new Error(
      lastError instanceof Error
        ? lastError.message
        : 'Upload failed. Please check your connection and try again.'
    );
  })();

  if (fingerprint) {
    inFlightVideoUploads.set(fingerprint, uploadTask);
  }

  try {
    return await uploadTask;
  } finally {
    if (fingerprint) {
      inFlightVideoUploads.delete(fingerprint);
    }
  }
}

/**
 * Isolated developer test function for uploading an image via the Cloudflare Worker
 * to Bunny Storage Zone (sogosocial-media-s3) in Singapore (https://sg-s3.storage.bunnycdn.com)
 * and returning the CDN URL (sogosocial-media-cdn.b-cdn.net).
 *
 * Requirements:
 * - Accepted types: JPEG, PNG, WebP, GIF.
 * - Maximum size: 5 MB.
 * - Requires an authenticated Firebase user to obtain a fresh ID token.
 * - Endpoint: POST https://sogosocial-upload.malikqayyum882.workers.dev/upload
 * - FormData field: "file"
 * - Authorization: Bearer <Firebase ID token>
 *
 * NOTE: This is strictly for development diagnostics and does NOT modify or replace
 * any production Cloudinary upload pipelines (uploadImage, uploadAvatarImage, uploadVideo).
 */
export async function testBunnyImageUpload(file: File | Blob): Promise<string> {
  if (!file) {
    throw new Error('No file provided for upload test.');
  }

  // Validate MIME type (JPEG, PNG, WebP, GIF)
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const mimeType = file.type ? file.type.toLowerCase().trim() : '';
  if (!mimeType || !allowedTypes.includes(mimeType)) {
    throw new Error(
      `Unsupported file type "${file.type || 'unknown'}". Accepted types are JPEG, PNG, WebP, and GIF.`
    );
  }

  // Validate file size (max 5 MB)
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(`File size (${sizeMb} MB) exceeds maximum allowed limit of 5 MB.`);
  }

  // Verify signed-in Firebase user
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User is not authenticated. Please sign in to run the Bunny upload test.');
  }

  // Get current Firebase ID token
  const idToken = await user.getIdToken();
  if (!idToken) {
    throw new Error('Failed to retrieve Firebase ID token for authenticated user.');
  }

  // Construct multipart FormData with field "file"
  const formData = new FormData();
  if (file instanceof File) {
    formData.append('file', file, file.name);
  } else {
    formData.append('file', file, 'test-image.jpg');
  }

  // Execute request to Cloudflare Worker
  const workerUrl = 'https://sogosocial-upload.malikqayyum882.workers.dev/upload';
  let response: Response;
  try {
    response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      body: formData,
    });
  } catch (netErr: any) {
    throw new Error(
      `Network or CORS error connecting to Cloudflare Worker: ${netErr?.message || netErr}`
    );
  }

  // Safely parse JSON response
  const rawText = await response.text();
  let jsonResult: any = null;
  try {
    jsonResult = JSON.parse(rawText);
  } catch {
    jsonResult = { raw: rawText };
  }

  // Check for successful response with URL
  if (
    response.ok &&
    jsonResult?.success === true &&
    typeof jsonResult?.url === 'string' &&
    jsonResult.url.trim().length > 0
  ) {
    return jsonResult.url.trim();
  }

  // Detailed error message formatting
  const statusInfo = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const errorMessage =
    jsonResult?.error ||
    jsonResult?.message ||
    (typeof jsonResult?.raw === 'string' && jsonResult.raw.length > 0
      ? jsonResult.raw
      : 'Unknown error from worker');

  throw new Error(`Worker upload failed (${statusInfo}): ${errorMessage}`);
}

