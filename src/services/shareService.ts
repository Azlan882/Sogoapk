import { Capacitor } from '@capacitor/core';
import { Post, VideoPost } from '../types';

export const SOGO_PRODUCTION_HOST = 'sogo-e5ea9.web.app';
export const SOGO_PRODUCTION_URL = `https://${SOGO_PRODUCTION_HOST}`;

/**
 * Returns the canonical base URL for public sharing and deep links.
 *
 * Rules:
 * 1. When running as an Android/iOS native app or Capacitor WebView
 *    (where origin is https://localhost or localhost), it MUST ALWAYS return
 *    the real production domain (e.g. https://sogo-e5ea9.web.app).
 * 2. If VITE_PUBLIC_APP_URL is explicitly configured, it is used, provided
 *    it is not a localhost URL while running on native Capacitor.
 * 3. In local web browser development (not Capacitor native), window.location.origin
 *    can be used if VITE_PUBLIC_APP_URL is not set.
 */
export function getAppBaseUrl(): string {
  const envUrl = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_APP_URL) ||
    ''
  ).trim().replace(/\/+$/, '');

  const isNative = Capacitor.isNativePlatform();
  const isCapacitorOrigin =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.protocol === 'capacitor:' ||
      (window as any).Capacitor?.isNativePlatform?.() ||
      (window as any).Capacitor?.isPluginAvailable?.('App'));

  // On native Android app or Capacitor WebView, NEVER return localhost
  if (isNative || isCapacitorOrigin) {
    if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
      return envUrl;
    }
    return SOGO_PRODUCTION_URL;
  }

  // If explicitly configured in environment, use it
  if (envUrl) {
    return envUrl;
  }

  // Web browser environment: use current origin if valid
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
    return window.location.origin.replace(/\/+$/, '');
  }

  return SOGO_PRODUCTION_URL;
}

/**
 * Returns the full shareable URL for a given post ID.
 * Example: https://sogo-e5ea9.web.app/post/abc123
 */
export function getPostShareUrl(postId: string): string {
  if (!postId || !postId.trim()) {
    return SOGO_PRODUCTION_URL;
  }
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}/post/${encodeURIComponent(postId.trim())}`;
}

/**
 * Returns the full canonical shareable URL for a given Reel/video ID.
 * Example: https://sogo-e5ea9.web.app/reel/vid_123
 */
export function getVideoShareUrl(videoId: string): string {
  if (!videoId || !videoId.trim()) {
    return SOGO_PRODUCTION_URL;
  }
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}/reel/${encodeURIComponent(videoId.trim())}`;
}

export interface SharePostOptions {
  onSuccess?: () => void;
  onCopied?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Copies a URL string to the clipboard with fallback support.
 */
export async function copyUrlToClipboard(url: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch (clipErr) {
    console.warn('Clipboard writeText failed:', clipErr);
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) {
      return true;
    }
  } catch (execErr) {
    console.warn('execCommand copy failed:', execErr);
  }

  return false;
}

/**
 * Shares a post via the Web Share API (native share sheet on Android/iOS/supported browsers).
 * Gracefully falls back to clipboard copy if navigator.share is unavailable.
 */
export async function sharePost(post: Post, options?: SharePostOptions): Promise<boolean> {
  const canonicalId = post.originalPostId || post.id;
  const shareUrl = getPostShareUrl(canonicalId);
  const authorName = post.user?.displayName || post.user?.username || 'a creator';
  const shareTitle = `Post by ${authorName} on SogoSocial`;
  
  // Format share text containing the REAL production URL
  const shareText = `Check out this post on SogoSocial:\n${shareUrl}`;

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: shareUrl,
      });
      options?.onSuccess?.();
      return true;
    } catch (err: any) {
      // AbortError indicates the user dismissed the native share sheet
      if (err?.name === 'AbortError') {
        return false;
      }
      console.warn('Native share failed, falling back to clipboard copy:', err);
    }
  }

  // Fallback: Copy link to clipboard
  const copied = await copyUrlToClipboard(shareUrl);
  if (copied) {
    options?.onCopied?.();
    return true;
  }

  options?.onError?.(new Error('Could not share or copy link'));
  return false;
}

/**
 * Shares a Reel/video via the Web Share API (native share sheet on Android/iOS/supported browsers).
 * Gracefully falls back to clipboard copy if navigator.share is unavailable.
 */
export async function shareVideo(
  video: Pick<VideoPost, 'id' | 'caption'> & { user?: { username?: string; displayName?: string } },
  options?: SharePostOptions
): Promise<boolean> {
  const shareUrl = getVideoShareUrl(video.id);
  const shareTitle = `Video by @${video.user?.username || 'user'} on SogoSocial`;
  const shareText = `Check out this video on SogoSocial:\n${shareUrl}`;

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: shareUrl,
      });
      options?.onSuccess?.();
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return false;
      }
      console.warn('Native video share failed, falling back to clipboard copy:', err);
    }
  }

  const copied = await copyUrlToClipboard(shareUrl);
  if (copied) {
    options?.onCopied?.();
    return true;
  }

  options?.onError?.(new Error('Could not share or copy video link'));
  return false;
}

/**
 * Extracts a postId from a URL, path, or deep link string.
 *
 * Supported formats:
 * - https://sogo-e5ea9.web.app/post/abc123
 * - https://sogo-e5ea9.web.app/posts/abc123
 * - /post/abc123
 * - /posts/abc123
 * - sogo://post/abc123
 * - https://domain/?postId=abc123
 * - https://domain/?post=abc123
 * - https://domain/#/post/abc123
 */
export function extractPostIdFromUrl(urlOrPath: string): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;

  try {
    const trimmed = urlOrPath.trim();

    // 1. Direct path check /post/:id or /posts/:id
    const pathMatch = trimmed.match(/(?:\/|^)(?:post|posts)\/([a-zA-Z0-9_\-]+)/i);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }

    // 2. Query param check (postId or post)
    if (trimmed.includes('?')) {
      const queryString = trimmed.split('?')[1]?.split('#')[0];
      if (queryString) {
        const params = new URLSearchParams(queryString);
        const qPostId = params.get('postId') || params.get('post');
        if (qPostId && /^[a-zA-Z0-9_\-]+$/.test(qPostId)) {
          return qPostId;
        }
      }
    }

    // 3. Hash check (#/post/:id or #post-:id)
    if (trimmed.includes('#')) {
      const hash = trimmed.split('#')[1];
      const hashMatch = hash?.match(/(?:\/|^)(?:post|posts)[\/\-]([a-zA-Z0-9_\-]+)/i);
      if (hashMatch && hashMatch[1]) {
        return hashMatch[1];
      }
    }

    // 4. Custom scheme sogo://post/:id
    const schemeMatch = trimmed.match(/^sogo:\/\/(?:post|posts)\/([a-zA-Z0-9_\-]+)/i);
    if (schemeMatch && schemeMatch[1]) {
      return schemeMatch[1];
    }
  } catch (e) {
    console.error('Error parsing postId from URL:', e);
  }

  return null;
}

/**
 * Extracts a videoId from a URL, path, or deep link string.
 */
export function extractVideoIdFromUrl(urlOrPath: string): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;
  try {
    const trimmed = urlOrPath.trim();
    const pathMatch = trimmed.match(/(?:\/|^)(?:video|reel|reels)\/([a-zA-Z0-9_\-]+)/i);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }
    if (trimmed.includes('?')) {
      const queryString = trimmed.split('?')[1]?.split('#')[0];
      if (queryString) {
        const params = new URLSearchParams(queryString);
        const qVideoId = params.get('videoId') || params.get('video') || params.get('reelId');
        if (qVideoId && /^[a-zA-Z0-9_\-]+$/.test(qVideoId)) {
          return qVideoId;
        }
      }
    }
  } catch {}
  return null;
}
