import {
  formatRelativeTime,
  parseTimestampToMs,
  useRelativeTime,
  TimestampInput,
} from '../utils/formatRelativeTime';

export { formatRelativeTime, parseTimestampToMs, useRelativeTime };
export type { TimestampInput };

export function cn(...inputs: (string | boolean | undefined | null)[]): string {
  return inputs.filter(Boolean).join(' ');
}

export function timeAgo(dateInput: TimestampInput): string {
  return formatRelativeTime(dateInput);
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}

/**
 * Transforms a raw Cloudinary video URL for fast-start mobile progressive streaming:
 * - `f_auto:video`: explicit automatic video format & mobile-compatible codec selection with fast-start (`moov` atom at front), never generating an image format
 * - `q_auto:eco`: aggressive perceptual bitrate optimization for fast startup and smooth playback on mobile networks (3G/4G)
 * - `c_limit,w_720,h_1280`: caps resolution to 720p vertical HD (never upscaling smaller videos) to dramatically reduce initial segment size and mobile data usage
 *
 * Preserves the original uploaded asset in Cloudinary untouched and leaves non-Cloudinary URLs unchanged.
 */
export const OPTIMIZED_VIDEO_TRANSFORMS = 'f_auto:video,q_auto:eco,c_limit,w_720,h_1280';

export function getOptimizedCloudinaryVideoUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();

  // Only transform Cloudinary video delivery URLs (and never transform image thumbnail derivatives)
  if (
    trimmed.includes('res.cloudinary.com') &&
    trimmed.includes('/video/upload/') &&
    !/\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(trimmed)
  ) {
    const marker = '/video/upload/';
    const index = trimmed.indexOf(marker);
    if (index !== -1) {
      const prefix = trimmed.substring(0, index + marker.length);
      const suffix = trimmed.substring(index + marker.length);

      // If already using the current f_auto:video,q_auto:eco,c_limit,w_720,h_1280 transformation, keep as-is
      if (
        suffix.includes('f_auto:video') &&
        suffix.includes('q_auto:eco') &&
        suffix.includes('c_limit,w_720,h_1280')
      ) {
        return trimmed;
      }

      // Normalize legacy transformation prefix or extract clean version+publicId path
      const versionMatch = suffix.match(
        /^((?:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|[a-zA-Z0-9_,-]+)\/)?(v[0-9]+\/.*)$/
      );
      if (versionMatch) {
        const rawExisting = versionMatch[1] ? versionMatch[1].replace(/\/$/, '') : '';
        // Normalize non-progressive camera containers (.mov, .mkv, .avi, .3gp, .wmv) to .mp4 for reliable Android WebView playback
        const remainder = versionMatch[2].replace(
          /\.(mov|mkv|avi|3gp|wmv)(\?.*)?$/i,
          '.mp4$2'
        );

        if (
          !rawExisting ||
          rawExisting === 'f_auto,q_auto' ||
          rawExisting === 'f_auto,q_auto:good,c_limit,w_1080,h_1920' ||
          rawExisting === 'f_auto:video,q_auto:good,c_limit,w_1080,h_1920' ||
          rawExisting === 'f_auto:video,q_auto:eco,c_limit,w_720,h_1280'
        ) {
          return `${prefix}${OPTIMIZED_VIDEO_TRANSFORMS}/${remainder}`;
        }

        const updatedExisting = rawExisting
          .replace(/\bf_auto\b(?!:video)/g, 'f_auto:video')
          .replace(/\bq_auto(?::[a-zA-Z0-9]+)?\b/g, 'q_auto:eco')
          .replace(/\bc_limit,w_1080,h_1920\b/g, 'c_limit,w_720,h_1280');

        if (updatedExisting.includes('c_limit,w_720')) {
          return `${prefix}${updatedExisting}/${remainder}`;
        }

        if (updatedExisting.includes('f_auto:video') || updatedExisting.includes('q_auto')) {
          return `${prefix}${updatedExisting},c_limit,w_720,h_1280/${remainder}`;
        }

        return `${prefix}${updatedExisting},${OPTIMIZED_VIDEO_TRANSFORMS}/${remainder}`;
      }

      const normalizedSuffix = suffix.replace(
        /\.(mov|mkv|avi|3gp|wmv)(\?.*)?$/i,
        '.mp4$2'
      );
      return `${prefix}${OPTIMIZED_VIDEO_TRANSFORMS}/${normalizedSuffix}`;
    }
  }

  return trimmed;
}

/**
 * Transforms a Cloudinary avatar/profile picture URL with face-centered crop (`c_fill,g_face`),
 * responsive dimensions (72px to 240px based on size tier), automatic format (`f_auto`),
 * and quality (`q_auto`) so circular avatars load as ~5-15 KB assets instead of multi-megabyte originals.
 * Preserves non-Cloudinary URLs untouched.
 */
export function getOptimizedAvatarUrl(
  url?: string,
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number | string = 'md'
): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('res.cloudinary.com') && trimmed.includes('/image/upload/')) {
    const marker = '/image/upload/';
    const index = trimmed.indexOf(marker);
    if (index !== -1) {
      const prefix = trimmed.substring(0, index + marker.length);
      const suffix = trimmed.substring(index + marker.length);

      let targetPx = 120; // default for 'md' (40px * 3x retina)
      if (typeof size === 'number') {
        targetPx = Math.max(32, Math.min(Math.round(size * 2), 512));
      } else {
        switch (size) {
          case 'xs': targetPx = 72; break;   // 24px * 3x
          case 'sm': targetPx = 96; break;   // 32px * 3x
          case 'md': targetPx = 120; break;  // 40px * 3x
          case 'lg': targetPx = 168; break;  // 56px * 3x
          case 'xl': targetPx = 240; break;  // 80px * 3x
          default: targetPx = 120; break;
        }
      }

      const avatarTrans = `c_fill,g_face,w_${targetPx},h_${targetPx},f_auto,q_auto`;
      const versionMatch = suffix.match(
        /^(?:(?:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|[a-zA-Z0-9_,-]+)\/)?(v[0-9]+\/.*)$/
      );
      const cleanPath = versionMatch ? versionMatch[1] : suffix;
      return `${prefix}${avatarTrans}/${cleanPath}`;
    }
  }

  return trimmed;
}

/**
 * Transforms a Cloudinary full-screen viewer image URL with automatic format (f_auto),
 * quality (q_auto), and a maximum target resolution (c_limit,w_1440,h_1920) so full-screen
 * views are razor-sharp on mobile displays without downloading massive 10MB+ raw camera files.
 * Preserves non-Cloudinary URLs and original aspect ratios.
 */
export function getOptimizedFullscreenImageUrl(
  url?: string,
  maxWidth = 1440,
  maxHeight = 1920
): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('res.cloudinary.com') && trimmed.includes('/image/upload/')) {
    const marker = '/image/upload/';
    const index = trimmed.indexOf(marker);
    if (index !== -1) {
      const prefix = trimmed.substring(0, index + marker.length);
      const suffix = trimmed.substring(index + marker.length);

      const trans = `f_auto,q_auto,c_limit,w_${maxWidth},h_${maxHeight}`;
      const versionMatch = suffix.match(
        /^(?:(?:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|[a-zA-Z0-9_,-]+)\/)?(v[0-9]+\/.*)$/
      );
      const cleanPath = versionMatch ? versionMatch[1] : suffix;
      return `${prefix}${trans}/${cleanPath}`;
    }
  }

  return trimmed;
}

/**
 * Transforms a Cloudinary image URL with automatic format (f_auto), quality (q_auto),
 * and an appropriate width limit (c_limit,w_<maxWidth>) so feed, card, and grid images download
 * quickly as compact assets (~40-120 KB) instead of multi-megabyte raw camera files.
 * Preserves non-Cloudinary URLs and original aspect ratios without distortion.
 */
export function getOptimizedImageUrl(url?: string, maxWidth = 800): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('res.cloudinary.com') && trimmed.includes('/image/upload/')) {
    const marker = '/image/upload/';
    const index = trimmed.indexOf(marker);
    if (index !== -1) {
      const prefix = trimmed.substring(0, index + marker.length);
      const suffix = trimmed.substring(index + marker.length);

      // If already has exact matching width limit and f_auto/q_auto, return as-is
      if (
        maxWidth > 0 &&
        suffix.includes(`w_${maxWidth}`) &&
        suffix.includes('f_auto') &&
        suffix.includes('q_auto')
      ) {
        return trimmed;
      }

      const widthTransform = maxWidth > 0 ? `,c_limit,w_${maxWidth}` : '';
      const transforms = `f_auto,q_auto${widthTransform}`;

      const versionMatch = suffix.match(
        /^(?:(?:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|[a-zA-Z0-9_,-]+)\/)?(v[0-9]+\/.*)$/
      );
      const cleanPath = versionMatch ? versionMatch[1] : suffix;
      return `${prefix}${transforms}/${cleanPath}`;
    }
  }

  return trimmed;
}

/**
 * Transforms a Cloudinary video poster/thumbnail URL with f_auto,q_auto:eco,c_limit,w_720 so it loads instantly.
 * If primary `url` is missing and `fallbackVideoUrl` is a Cloudinary video URL, derives a fast first-frame
 * poster image URL from the video URL.
 */
export function getOptimizedPosterUrl(url?: string, fallbackVideoUrl?: string): string | undefined {
  const candidate = url && typeof url === 'string' && url.trim() ? url.trim() : '';

  if (candidate) {
    if (
      candidate.includes('res.cloudinary.com') &&
      (candidate.includes('/video/upload/') || candidate.includes('/image/upload/'))
    ) {
      const isVideoUpload = candidate.includes('/video/upload/');
      const marker = isVideoUpload ? '/video/upload/' : '/image/upload/';
      const index = candidate.indexOf(marker);
      if (index !== -1) {
        const prefix = candidate.substring(0, index + marker.length);
        const suffix = candidate.substring(index + marker.length);

        if (suffix.includes('f_auto') || suffix.includes('q_auto')) {
          return candidate;
        }

        const versionMatch = suffix.match(/^(?:[^/]+\/)?(v[0-9]+\/.*)$/);
        const cleanSuffix = (versionMatch ? versionMatch[1] : suffix).replace(
          /\.(mp4|mov|webm|mkv|m4v|3gp|avi)(\?.*)?$/i,
          '.jpg$2'
        );

        const posterTransforms = isVideoUpload
          ? 'so_0,f_auto,q_auto:eco,c_limit,w_720'
          : 'f_auto,q_auto:eco,c_limit,w_720';
        return `${prefix}${posterTransforms}/${cleanSuffix}`;
      }
    }
    return candidate;
  }

  // Derive a fast poster from Cloudinary video URL if no explicit thumbnailUrl was stored
  if (
    fallbackVideoUrl &&
    typeof fallbackVideoUrl === 'string' &&
    fallbackVideoUrl.includes('res.cloudinary.com') &&
    fallbackVideoUrl.includes('/video/upload/')
  ) {
    const marker = '/video/upload/';
    const index = fallbackVideoUrl.indexOf(marker);
    if (index !== -1) {
      const prefix = fallbackVideoUrl.substring(0, index + marker.length);
      const rawSuffix = fallbackVideoUrl.substring(index + marker.length);
      const versionMatch = rawSuffix.match(/^(?:[^/]+\/)?(v[0-9]+\/.*)$/);
      const suffix = (versionMatch ? versionMatch[1] : rawSuffix).replace(
        /\.(mp4|mov|webm|mkv|m4v|3gp|avi)(\?.*)?$/i,
        '.jpg$2'
      );
      return `${prefix}so_0,f_auto,q_auto:eco,c_limit,w_720/${suffix}`;
    }
  }

  return undefined;
}

/**
 * Checks whether a Story media URL or mediaType represents video content.
 */
export function isStoryVideoMedia(url?: string, mediaType?: string): boolean {
  if (mediaType === 'video') return true;
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  if (clean.includes('/video/upload/')) {
    // A Cloudinary video URL whose extension was converted to .jpg/.png/.webp for frame extraction is an image thumbnail
    if (/\.(jpg|jpeg|png|webp|avif)(\?.*)?$/i.test(clean)) {
      return false;
    }
    return true;
  }
  return /\.(mp4|mov|webm|mkv|m4v)(\?.*)?$/i.test(clean);
}

// Session-level set of optimized Cloudinary video URLs whose derivatives have already been warmed
const warmedVideoStreamUrls = new Set<string>();

/**
 * Eagerly warms the optimized Cloudinary playback representation (`f_auto:video,q_auto:eco,c_limit,w_720,h_1280`)
 * and its poster image in the background after upload completion so Cloudinary prepares and edge-caches
 * the streamable derivative before the first viewer opens the Reel.
 */
export function warmCloudinaryVideoPlayback(
  videoUrl?: string,
  thumbnailUrl?: string,
  warmStream = true
): void {
  if (typeof window === 'undefined') return;

  const posterUrl = getOptimizedPosterUrl(thumbnailUrl, videoUrl);
  if (posterUrl && !loadedStoryUrlsCache.has(posterUrl)) {
    const img = new window.Image();
    img.decoding = 'async';
    img.onload = () => {
      loadedStoryUrlsCache.add(posterUrl);
    };
    img.src = posterUrl;
  }

  if (!warmStream || !videoUrl || typeof videoUrl !== 'string') return;
  const optimizedVideoUrl = getOptimizedCloudinaryVideoUrl(videoUrl);
  if (!optimizedVideoUrl || warmedVideoStreamUrls.has(optimizedVideoUrl)) return;

  warmedVideoStreamUrls.add(optimizedVideoUrl);

  // Request the initial 32KB header (moov atom) post-upload so Cloudinary generates and edge-caches the derivative immediately
  if (typeof window.fetch === 'function') {
    window
      .fetch(optimizedVideoUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-32767' },
        mode: 'cors',
        credentials: 'omit',
      })
      .catch(() => {
        // Ignore background warmup errors
      });
  }
}

// In-memory cache of Story thumbnail/media URLs that have already been decoded in this session.
// Allows StoryItem to render immediately with opacity-100 and zero network/decode delay.
const loadedStoryUrlsCache = new Set<string>();

// Session-only map from newly uploaded remote Story URLs to their already-decoded local blob/preview URL
// so a freshly created Story displays in 0ms before Cloudinary's cold derivative finishes generating.
const instantStoryPreviewMap = new Map<string, string>();

export function isStoryUrlLoaded(url?: string): boolean {
  if (!url) return false;
  return loadedStoryUrlsCache.has(url);
}

export function markStoryUrlLoaded(url?: string): void {
  if (!url) return;
  loadedStoryUrlsCache.add(url);
}

export function registerInstantStoryPreview(remoteUrl?: string, localPreviewUrl?: string): void {
  if (!remoteUrl || !localPreviewUrl) return;
  instantStoryPreviewMap.set(remoteUrl, localPreviewUrl);
  loadedStoryUrlsCache.add(localPreviewUrl);
}

export function getInstantStoryPreview(url?: string): string {
  if (!url) return '';
  return instantStoryPreviewMap.get(url) || '';
}

export function preloadStoryImage(url?: string): void {
  if (!url || typeof window === 'undefined') return;
  const trimmed = url.trim();
  if (!trimmed || loadedStoryUrlsCache.has(trimmed) || isStoryVideoMedia(trimmed)) return;

  const img = new window.Image();
  img.decoding = 'async';
  img.onload = () => {
    if (img.naturalWidth > 0) {
      loadedStoryUrlsCache.add(trimmed);
    }
  };
  img.src = trimmed;
}

/**
 * Optimizes an image URL specifically for small circular Story previews (~56x56px CSS, ~160-240px retina)
 * without duplicating or re-uploading any media.
 */
export function getOptimizedStoryThumbnailUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // 1. Cloudinary video URL -> extract representative first frame as compact static JPEG thumbnail
  if (trimmed.includes('res.cloudinary.com') && trimmed.includes('/video/upload/')) {
    const marker = '/video/upload/';
    const index = trimmed.indexOf(marker);
    if (index !== -1) {
      const prefix = trimmed.substring(0, index + marker.length);
      const rawSuffix = trimmed.substring(index + marker.length);
      // Strip any existing transformation prefix before the version segment (e.g. f_auto,q_auto/v123/...)
      const versionMatch = rawSuffix.match(/^(?:[^/]+\/)?(v[0-9]+\/.*)$/);
      const cleanSuffix = (versionMatch ? versionMatch[1] : rawSuffix).replace(
        /\.(mp4|mov|webm|mkv|m4v)(\?.*)?$/i,
        '.jpg$2'
      );
      return `${prefix}so_0,f_jpg,q_auto,c_fill,w_240,h_240/${cleanSuffix}`;
    }
  }

  // 2. Cloudinary image URL -> deliver compact 240x240 fill thumbnail
  if (trimmed.includes('res.cloudinary.com') && trimmed.includes('/image/upload/')) {
    const marker = '/image/upload/';
    const index = trimmed.indexOf(marker);
    if (index !== -1) {
      const prefix = trimmed.substring(0, index + marker.length);
      const suffix = trimmed.substring(index + marker.length);
      if (suffix.includes('w_240') && suffix.includes('h_240') && suffix.includes('f_auto')) {
        return trimmed;
      }
      const versionMatch = suffix.match(
        /^(?:(?:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|[a-zA-Z0-9_,-]+)\/)?(v[0-9]+\/.*)$/
      );
      const cleanPath = versionMatch ? versionMatch[1] : suffix;
      return `${prefix}f_auto,q_auto,c_fill,w_240,h_240/${cleanPath}`;
    }
  }

  // 3. Unsplash URL -> request a compact w=240 thumbnail for fast Story circle loading
  if (trimmed.includes('images.unsplash.com') && /[?&]w=\d+/.test(trimmed)) {
    return trimmed.replace(/([?&])w=\d+/, '$1w=240');
  }

  return trimmed;
}

export interface StoryMediaLike {
  id?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  originalStoryId?: string;
  referencedStoryId?: string;
  originalStory?: StoryMediaLike;
}

/**
 * Resolves the canonical full-resolution media URL for a Story (supporting both original Stories
 * and shared/referenced Stories) using O(1) map lookup when available.
 */
export function getStoryMediaUrl(
  story?: StoryMediaLike | null,
  allStoriesOrMap?: StoryMediaLike[] | Map<string, StoryMediaLike>
): string {
  if (!story) return '';

  const directMedia =
    (typeof story.mediaUrl === 'string' && story.mediaUrl.trim()) ||
    (typeof story.imageUrl === 'string' && story.imageUrl.trim()) ||
    (typeof story.videoUrl === 'string' && story.videoUrl.trim()) ||
    (typeof story.thumbnailUrl === 'string' && story.thumbnailUrl.trim()) ||
    (typeof story.previewUrl === 'string' && story.previewUrl.trim()) ||
    '';

  if (directMedia) {
    return directMedia;
  }

  if (story.originalStory) {
    const nested = getStoryMediaUrl(story.originalStory, allStoriesOrMap);
    if (nested) return nested;
  }

  const refId = story.originalStoryId || story.referencedStoryId;
  if (refId && allStoriesOrMap) {
    const referenced =
      allStoriesOrMap instanceof Map
        ? allStoriesOrMap.get(refId)
        : Array.isArray(allStoriesOrMap)
          ? allStoriesOrMap.find((s) => s && s.id === refId && s.id !== story.id)
          : undefined;
    if (referenced && referenced.id !== story.id) {
      return getStoryMediaUrl(referenced);
    }
  }

  return '';
}

/**
 * Resolves the visual thumbnail/preview URL to display inside a Story circle BEFORE the user taps it:
 * 1. Uses valid thumbnailUrl / previewUrl if present on the Story.
 * 2. Otherwise uses mediaUrl / imageUrl.
 * 3. If the Story is a video Story (videoUrl or video mediaUrl), derives an efficient Cloudinary frame thumbnail
 *    when hosted on Cloudinary (or uses thumbnailUrl) instead of downloading the full video.
 * 4. If the Story is a shared/reference Story, resolves the referenced Story's thumbnail/media URL in O(1).
 * 5. Returns empty string ONLY when there is genuinely no valid Story media available.
 */
export function resolveStoryPreviewUrl(
  story?: StoryMediaLike | null,
  allStoriesOrMap?: StoryMediaLike[] | Map<string, StoryMediaLike>
): string {
  if (!story) return '';

  // 1. Explicit thumbnail / preview URL on the Story
  const explicitThumb =
    (typeof story.thumbnailUrl === 'string' && story.thumbnailUrl.trim()) ||
    (typeof story.previewUrl === 'string' && story.previewUrl.trim()) ||
    '';
  if (explicitThumb) {
    return getOptimizedStoryThumbnailUrl(explicitThumb);
  }

  // 2. Direct mediaUrl / imageUrl / videoUrl on the Story
  const directMedia =
    (typeof story.mediaUrl === 'string' && story.mediaUrl.trim()) ||
    (typeof story.imageUrl === 'string' && story.imageUrl.trim()) ||
    (typeof story.videoUrl === 'string' && story.videoUrl.trim()) ||
    '';

  if (directMedia) {
    if (isStoryVideoMedia(directMedia, story.mediaType)) {
      const derivedPoster = getOptimizedStoryThumbnailUrl(directMedia);
      // If Cloudinary video URL was converted to a .jpg frame thumbnail, return it
      if (derivedPoster && !isStoryVideoMedia(derivedPoster)) {
        return derivedPoster;
      }
      // For non-Cloudinary video URLs without a separate thumbnail, return the video URL so StoryItem can render a muted frame preview
      return directMedia;
    }
    return getOptimizedStoryThumbnailUrl(directMedia);
  }

  // 3. Shared / referenced Story resolution
  if (story.originalStory) {
    const nestedPreview = resolveStoryPreviewUrl(story.originalStory, allStoriesOrMap);
    if (nestedPreview) return nestedPreview;
  }

  const refId = story.originalStoryId || story.referencedStoryId;
  if (refId && allStoriesOrMap) {
    const referenced =
      allStoriesOrMap instanceof Map
        ? allStoriesOrMap.get(refId)
        : Array.isArray(allStoriesOrMap)
          ? allStoriesOrMap.find((s) => s && s.id === refId && s.id !== story.id)
          : undefined;
    if (referenced && referenced.id !== story.id) {
      return resolveStoryPreviewUrl(referenced);
    }
  }

  return '';
}

/**
 * Reliably scrolls the main document viewport and any scrollable ancestor container to the top.
 * When `behavior` is `'smooth'` and the user has scrolled very far down (> 2800px),
 * clamps the starting scroll offset first so smooth scrolling in Android WebView / mobile browsers
 * finishes quickly and reliably reaches `top: 0`.
 */
export function scrollFeedToTop(
  behavior: ScrollBehavior = 'smooth',
  containerElement?: HTMLElement | null
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const scrollingEl =
    (document.scrollingElement as HTMLElement | null) ||
    document.documentElement ||
    document.body;

  const currentWindowScroll =
    window.scrollY ||
    window.pageYOffset ||
    scrollingEl?.scrollTop ||
    document.documentElement?.scrollTop ||
    document.body?.scrollTop ||
    0;

  if (behavior === 'smooth') {
    // If the user scrolled extremely far down (e.g. 20+ posts deep), jump closer first
    // so Android WebView's smooth scroll animation never stalls or takes several seconds
    if (currentWindowScroll > 2800) {
      try {
        window.scrollTo(0, 1100);
        if (scrollingEl) scrollingEl.scrollTop = 1100;
      } catch {}
    }

    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }

    if (scrollingEl && typeof scrollingEl.scrollTo === 'function') {
      try {
        scrollingEl.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        scrollingEl.scrollTop = 0;
      }
    }
  } else {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
    if (scrollingEl) scrollingEl.scrollTop = 0;
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }

  // Also check any scrollable ancestor of the provided containerElement (e.g. <main> or wrapper div)
  let node: HTMLElement | null = containerElement || document.querySelector('main');
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.scrollTop > 0) {
      if (behavior === 'smooth') {
        if (node.scrollTop > 2800) {
          node.scrollTop = 1100;
        }
        try {
          node.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          node.scrollTop = 0;
        }
      } else {
        node.scrollTop = 0;
      }
    }
    node = node.parentElement;
  }
}


