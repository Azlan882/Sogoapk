import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { VideoPost } from '../types';

export interface MediaSaverDownloadProgress {
  videoId?: string;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface MediaSaverPluginInterface {
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
  saveVideoToGallery(options: {
    base64?: string;
    url?: string;
    fallbackUrl?: string;
    filename: string;
    mimeType: string;
    videoId?: string;
  }): Promise<{
    success: boolean;
    uri: string;
    location: string;
    bytesSaved: number;
  }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: MediaSaverDownloadProgress) => void
  ): Promise<PluginListenerHandle>;
}

const MediaSaver = registerPlugin<MediaSaverPluginInterface>('MediaSaver');

// Track in-flight downloads by video ID/URL to prevent duplicate simultaneous downloads from repeated taps
const activeReelDownloads = new Set<string>();

export interface ReelDownloadOptions {
  onProgress?: (percent: number) => void;
}

export interface ReelDownloadResult {
  success: boolean;
  filename: string;
  location: string;
  bytesSaved: number;
  method: 'android-mediastore' | 'browser-blob';
}

/**
 * Checks if a specific Reel is currently being downloaded.
 */
export function isReelDownloading(videoIdOrUrl?: string): boolean {
  if (!videoIdOrUrl) return false;
  return activeReelDownloads.has(videoIdOrUrl);
}

/**
 * Resolves the primary MP4 download URL and fallback URL for a Reel video.
 * Ensures Cloudinary URLs deliver a universally playable MP4 file without re-uploading or altering the Reel.
 */
export function resolveReelDownloadUrls(videoUrl: string): {
  primaryUrl: string;
  fallbackUrl: string;
} {
  const raw = (videoUrl || '').trim();
  if (!raw) {
    return { primaryUrl: '', fallbackUrl: '' };
  }

  if (raw.includes('res.cloudinary.com') && raw.includes('/video/upload/')) {
    const marker = '/video/upload/';
    const index = raw.indexOf(marker);
    if (index !== -1) {
      const prefix = raw.substring(0, index + marker.length);
      const rawSuffix = raw.substring(index + marker.length);

      // Strip any existing transformation segment before the version tag (e.g. f_auto,q_auto/v1234/...)
      const versionMatch = rawSuffix.match(/^(?:[^/]+\/)?(v[0-9]+\/.*)$/);
      const cleanVersionSuffix = versionMatch ? versionMatch[1] : rawSuffix;

      const mp4Suffix = cleanVersionSuffix.replace(
        /\.(mov|webm|mkv|m4v|3gp|avi)(\?.*)?$/i,
        '.mp4$2'
      );

      const cleanRawUrl = `${prefix}${cleanVersionSuffix}`;
      const transcodeMp4Url = `${prefix}f_mp4,q_auto/${mp4Suffix}`;

      // If the stored video is already an .mp4, prefer direct raw .mp4 CDN delivery first (0ms transcoding wait)
      if (/\.mp4(\?.*)?$/i.test(cleanVersionSuffix)) {
        return {
          primaryUrl: cleanRawUrl,
          fallbackUrl: transcodeMp4Url,
        };
      }

      // If stored in another container (.mov, .webm, etc.), request MP4 conversion first with raw URL as fallback
      return {
        primaryUrl: transcodeMp4Url,
        fallbackUrl: cleanRawUrl,
      };
    }
  }

  return {
    primaryUrl: raw,
    fallbackUrl: raw,
  };
}

/**
 * Builds a clean, user-friendly MP4 filename for the saved Reel.
 */
export function buildReelFilename(
  video: Pick<VideoPost, 'id' | 'videoUrl'> & { user?: { username?: string } }
): string {
  const cleanUser = (video.user?.username || 'creator')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase()
    .slice(0, 20);
  const cleanId = (video.id || 'reel')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(-8);
  const timestamp = Date.now();
  return `sogosocial-reel-${cleanUser || 'sogo'}-${cleanId}-${timestamp}.mp4`;
}

/**
 * Fetches a video URL as a Blob using XMLHttpRequest to provide real-time byte download progress (0-100%).
 */
function fetchVideoBlobWithProgress(
  url: string,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = 120000; // 2 minutes max timeout

    let lastPercent = 1;
    onProgress?.(1);

    xhr.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100)));
        if (pct > lastPercent) {
          lastPercent = pct;
          onProgress?.(pct);
        }
      } else if (event.loaded > 0) {
        lastPercent = Math.min(95, lastPercent + 3);
        onProgress?.(lastPercent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response as Blob;
        if (!blob || blob.size === 0) {
          reject(new Error('Downloaded video file is empty (0 bytes).'));
          return;
        }
        if (blob.type && blob.type.toLowerCase().includes('text/html')) {
          reject(new Error('Server returned an invalid content type instead of video.'));
          return;
        }
        onProgress?.(100);
        resolve(blob);
      } else {
        reject(new Error(`HTTP ${xhr.status}: Failed to download video.`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while downloading Reel.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Download timed out. Please check your connection and try again.'));
    };

    xhr.send();
  });
}

/**
 * Downloads a Reel video locally to the user's Android gallery (Movies/SogoSocial) or browser Downloads.
 *
 * Strictly local device operation:
 * - Does NOT count as a video view or qualified view
 * - Does NOT trigger Creator Rewards or watch sessions
 * - Does NOT modify Firestore documents, likes, comments, reposts, or notifications
 * - Does NOT upload anything to Cloudinary
 */
export async function downloadReelVideo(
  video: Pick<VideoPost, 'id' | 'videoUrl'> & { user?: { username?: string } },
  options?: ReelDownloadOptions
): Promise<ReelDownloadResult> {
  const rawUrl = (video?.videoUrl || '').trim();
  if (!rawUrl || !rawUrl.startsWith('http')) {
    throw new Error('This Reel does not have a valid downloadable video URL.');
  }

  const lockKey = video.id || rawUrl;
  if (activeReelDownloads.has(lockKey)) {
    throw new Error('DOWNLOAD_ALREADY_IN_PROGRESS');
  }

  activeReelDownloads.add(lockKey);
  const { primaryUrl, fallbackUrl } = resolveReelDownloadUrls(rawUrl);
  const filename = buildReelFilename(video);
  const isNativeAndroid =
    Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android';

  let progressListener: PluginListenerHandle | null = null;

  try {
    options?.onProgress?.(1);

    // 1. Native Android path: stream directly into MediaStore.Video (Movies/SogoSocial)
    if (isNativeAndroid) {
      try {
        progressListener = await MediaSaver.addListener('downloadProgress', (event) => {
          if (!event.videoId || event.videoId === video.id) {
            const pct = Math.max(1, Math.min(100, Number(event.percent) || 1));
            options?.onProgress?.(pct);
          }
        });
      } catch {
        // Listener registration is optional
      }

      try {
        const nativeRes = await MediaSaver.saveVideoToGallery({
          url: primaryUrl,
          fallbackUrl,
          filename,
          mimeType: 'video/mp4',
          videoId: video.id,
        });

        if (nativeRes && nativeRes.success && nativeRes.bytesSaved > 0) {
          options?.onProgress?.(100);
          return {
            success: true,
            filename,
            location: nativeRes.location || `Movies/SogoSocial/${filename}`,
            bytesSaved: nativeRes.bytesSaved,
            method: 'android-mediastore',
          };
        }
        throw new Error('MediaStore could not verify the saved video file.');
      } catch (nativeErr: any) {
        const errMsg = String(nativeErr?.message || nativeErr || '');
        const errCode = String(nativeErr?.code || '');

        // Do not fallback if the user explicitly denied storage permission
        if (
          errCode === 'PERMISSION_DENIED' ||
          errMsg.toLowerCase().includes('permission denied')
        ) {
          throw new Error(
            'Storage permission denied. Please allow storage access to save Reels.'
          );
        }

        console.warn('Native direct URL video save failed, attempting blob fallback:', nativeErr);
      }
    }

    // 2. Web Browser & Fallback path: download Blob with live XHR progress
    let blob: Blob;
    try {
      blob = await fetchVideoBlobWithProgress(primaryUrl, options?.onProgress);
    } catch (primaryFetchErr) {
      if (fallbackUrl && fallbackUrl !== primaryUrl) {
        blob = await fetchVideoBlobWithProgress(fallbackUrl, options?.onProgress);
      } else {
        throw primaryFetchErr;
      }
    }

    // If on Android and native URL stream failed (e.g. WebView cookie/CORS difference) and blob is <= 25MB,
    // pass base64 to MediaSaver.saveVideoToGallery so it still lands in Android Gallery (Movies/SogoSocial)
    if (isNativeAndroid && blob.size > 0 && blob.size <= 25 * 1024 * 1024) {
      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            } else {
              reject(new Error('Failed to encode video buffer'));
            }
          };
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(blob);
        });

        const base64Res = await MediaSaver.saveVideoToGallery({
          base64: base64Data,
          filename,
          mimeType: 'video/mp4',
          videoId: video.id,
        });

        if (base64Res && base64Res.success) {
          options?.onProgress?.(100);
          return {
            success: true,
            filename,
            location: base64Res.location || `Movies/SogoSocial/${filename}`,
            bytesSaved: base64Res.bytesSaved || blob.size,
            method: 'android-mediastore',
          };
        }
      } catch (base64Err) {
        console.warn('Base64 MediaStore fallback failed, triggering browser blob save:', base64Err);
      }
    }

    // Standard browser / WebView anchor download
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
      try {
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 2000);

    options?.onProgress?.(100);
    return {
      success: true,
      filename,
      location: `Downloads/${filename}`,
      bytesSaved: blob.size,
      method: 'browser-blob',
    };
  } catch (err: any) {
    const rawMsg = String(err?.message || err || '');
    if (rawMsg === 'DOWNLOAD_ALREADY_IN_PROGRESS') {
      throw err;
    }
    if (rawMsg.toLowerCase().includes('permission')) {
      throw new Error('Storage permission denied. Please allow storage access to save Reels.');
    }
    if (rawMsg.toLowerCase().includes('timed out')) {
      throw new Error('Download timed out. Please check your connection and try again.');
    }
    throw new Error("Couldn't download Reel. Please check your connection and try again.");
  } finally {
    if (progressListener) {
      try {
        await progressListener.remove();
      } catch {}
    }
    activeReelDownloads.delete(lockKey);
  }
}
