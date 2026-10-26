import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  DocumentSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { VideoPost, VideoComment, User } from '../types';
import { createNotification } from './notificationsService';
import { recordSogoStarAction } from './sogoStarsService';
import { isUserBlocked } from './blockService';
import { perf } from '../utils/perfLogger';
import { warmCloudinaryVideoPlayback } from '../lib/utils';

const VIDEOS_COLLECTION = 'videos';
const LOCAL_VIDEOS_CACHE_KEY = 'sogo_videos_cache';
const BOOKMARKED_VIDEOS_CACHE_KEY = 'sogo_bookmarked_videos_cache';
const VIEWED_VIDEOS_SESSION_KEY = 'sogo_viewed_videos_session';

// Helper for session view tracking to avoid excessive Firestore writes
const sessionViewedIds = new Set<string>();

// In-memory videos feed cache for instantaneous tab switching and background refresh
let memoryCachedVideos: VideoPost[] | null = null;
let memoryCachedCursor: DocumentSnapshot | null = null;
let lastVideosFetchTimestamp = 0;
let lastLikesHydratedUserId: string | null = null;
let inFlightFirstPagePromise: Promise<{ videos: VideoPost[]; nextCursor: DocumentSnapshot | null }> | null = null;
const VIDEOS_CACHE_TTL_MS = 120 * 1000; // 120 seconds TTL
const primedVideosById = new Map<string, VideoPost>();
const cachedUserVideosById = new Map<string, VideoPost[]>();
const userToggledLikeMap = new Map<string, boolean>();
const sessionVideoCommentsMap = new Map<string, VideoComment[]>();
let memoryBookmarkedVideosMap: Map<string, VideoPost> | null = null;

function getBookmarkedVideosMap(): Map<string, VideoPost> {
  if (memoryBookmarkedVideosMap) {
    return memoryBookmarkedVideosMap;
  }
  const map = new Map<string, VideoPost>();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(BOOKMARKED_VIDEOS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              item &&
              typeof item.id === 'string' &&
              item.videoUrl &&
              (!isSeedVideoDoc(item.id, item) || Number(item.duration) >= 8)
            ) {
              map.set(item.id, { ...item, isBookmarked: true });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read bookmarked videos cache', err);
  }
  memoryBookmarkedVideosMap = map;
  return map;
}

function saveBookmarkedVideosMap(map: Map<string, VideoPost>): void {
  memoryBookmarkedVideosMap = map;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        BOOKMARKED_VIDEOS_CACHE_KEY,
        JSON.stringify(Array.from(map.values()))
      );
    }
  } catch (err) {
    console.warn('Failed to save bookmarked videos cache', err);
  }
}

/**
 * Synchronously checks whether a Reel/video is currently bookmarked by its ID.
 */
export function isVideoBookmarkedSync(videoId?: string | null): boolean {
  if (!videoId) return false;
  return getBookmarkedVideosMap().has(videoId.trim());
}

/**
 * Synchronously returns all bookmarked Reels with latest cached metadata.
 */
export function getBookmarkedVideosSync(): VideoPost[] {
  const map = getBookmarkedVideosMap();
  const result: VideoPost[] = [];
  map.forEach((storedVideo, id) => {
    const latest =
      primedVideosById.get(id) ||
      memoryCachedVideos?.find((v) => v.id === id) ||
      storedVideo;
    result.push({
      ...storedVideo,
      ...latest,
      id,
      isBookmarked: true,
    });
  });
  return result;
}

/**
 * Toggles the saved/bookmarked state for a Reel using its existing Reel/video ID.
 * Never duplicates the Reel document in Firestore or re-uploads media.
 */
export async function toggleBookmarkVideo(
  videoOrId: string | VideoPost,
  knownVideo?: VideoPost
): Promise<boolean> {
  const rawId = typeof videoOrId === 'string' ? videoOrId : videoOrId?.id;
  const cleanVideoId = (rawId || '').trim();
  if (!cleanVideoId) return false;

  const providedVideo = typeof videoOrId === 'object' ? videoOrId : knownVideo;
  const map = getBookmarkedVideosMap();
  const currentlyBookmarked = map.has(cleanVideoId);
  const nextBookmarked = !currentlyBookmarked;

  if (nextBookmarked) {
    let targetVideo: VideoPost | null =
      providedVideo ||
      primedVideosById.get(cleanVideoId) ||
      memoryCachedVideos?.find((v) => v.id === cleanVideoId) ||
      getLocalVideos().find((v) => v.id === cleanVideoId) ||
      null;

    if (!targetVideo) {
      targetVideo = await getVideoById(cleanVideoId, auth?.currentUser?.uid);
    }

    if (targetVideo && targetVideo.videoUrl) {
      map.set(cleanVideoId, { ...targetVideo, isBookmarked: true });
      saveBookmarkedVideosMap(map);
    }
  } else {
    map.delete(cleanVideoId);
    saveBookmarkedVideosMap(map);
  }

  // Synchronize in-memory and local caches immediately
  const existingPrimed = primedVideosById.get(cleanVideoId);
  if (existingPrimed) {
    primedVideosById.set(cleanVideoId, { ...existingPrimed, isBookmarked: nextBookmarked });
  }

  if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.map((v) =>
      v.id === cleanVideoId ? { ...v, isBookmarked: nextBookmarked } : v
    );
  }

  cachedUserVideosById.forEach((list, uid) => {
    if (list.some((v) => v.id === cleanVideoId)) {
      cachedUserVideosById.set(
        uid,
        list.map((v) => (v.id === cleanVideoId ? { ...v, isBookmarked: nextBookmarked } : v))
      );
    }
  });

  const local = getLocalVideos();
  if (local.some((v) => v.id === cleanVideoId)) {
    saveLocalVideos(
      local.map((v) => (v.id === cleanVideoId ? { ...v, isBookmarked: nextBookmarked } : v))
    );
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_video_bookmark_changed', {
        detail: { videoId: cleanVideoId, isBookmarked: nextBookmarked },
      })
    );
  }

  return nextBookmarked;
}

/**
 * Primes a specific VideoPost (e.g., from a Profile Reels grid) into memory
 * so opening it in the full Reels viewer renders instantaneously at index 0
 * without altering the main Reels feed cache order.
 */
export function primeVideoInCache(video: VideoPost): void {
  if (!video || !video.id || !video.videoUrl) return;
  const existing =
    primedVideosById.get(video.id) ||
    memoryCachedVideos?.find((v) => v.id === video.id);
  const bookmarked = isVideoBookmarkedSync(video.id);
  const hydrated: VideoPost = {
    ...existing,
    ...video,
    isLiked: existing?.isLiked ?? video.isLiked,
    isBookmarked: bookmarked,
  };
  primedVideosById.set(video.id, hydrated);
  if (bookmarked) {
    const map = getBookmarkedVideosMap();
    map.set(video.id, hydrated);
    saveBookmarkedVideosMap(map);
  }
}

/**
 * Primes a creator's entire Reel list into memory so opening a Reel from Profile → Reels
 * can immediately populate and swipe through only that creator's Reels with 0ms latency.
 */
export function primeUserVideosInCache(userId: string, videos: VideoPost[]): void {
  if (!userId || !Array.isArray(videos)) return;
  const normalized: VideoPost[] = [];
  for (const video of videos) {
    if (!video || !video.id || !video.videoUrl) continue;
    primeVideoInCache(video);
    normalized.push(primedVideosById.get(video.id) || video);
  }
  cachedUserVideosById.set(userId, normalized);
}

/**
 * Synchronously returns cached Reels scoped exclusively to a specific userId.
 */
export function getCachedUserVideos(userId?: string | null): VideoPost[] {
  if (!userId) return [];
  const direct = cachedUserVideosById.get(userId);
  if (direct && direct.length > 0) {
    return direct.map((v) => {
      const base = primedVideosById.get(v.id) || v;
      return { ...base, isBookmarked: isVideoBookmarkedSync(v.id) };
    });
  }
  const globalCached = getCachedVideos();
  return globalCached.filter((v) => v.userId === userId || v.user?.id === userId);
}

/**
 * Retrieves a primed or cached video by ID synchronously (0ms).
 */
export function getPrimedVideo(videoId?: string | null): VideoPost | null {
  if (!videoId) return null;
  if (primedVideosById.has(videoId)) {
    const primed = primedVideosById.get(videoId)!;
    return { ...primed, isBookmarked: isVideoBookmarkedSync(videoId) };
  }
  const cached = getCachedVideos();
  return cached.find((v) => v.id === videoId) || null;
}

/**
 * Hydrates `isLiked` status for a batch of videos asynchronously in the background
 * so the initial Reel metadata & video stream startup never waits on a second Firestore round-trip.
 */
function hydrateVideoLikesInBackground(videos: VideoPost[], currentUserId?: string): void {
  if (!currentUserId || videos.length === 0) return;

  perf.start('REELS', 'Background likes hydration', { count: videos.length });
  Promise.all(
    videos.map(async (video) => {
      try {
        const likeDoc = await getDoc(doc(db, VIDEOS_COLLECTION, video.id, 'likes', currentUserId));
        return { id: video.id, isLiked: likeDoc.exists() };
      } catch {
        return { id: video.id, isLiked: Boolean(video.isLiked) };
      }
    })
  )
    .then((results) => {
      perf.end('REELS', 'Background likes hydration');
      lastLikesHydratedUserId = currentUserId;
      const likedMap: Record<string, boolean> = {};
      let anyChanged = false;

      for (const r of results) {
        const toggleKey = `${r.id}_${currentUserId}`;
        likedMap[r.id] = userToggledLikeMap.has(toggleKey)
          ? userToggledLikeMap.get(toggleKey)!
          : r.isLiked;
      }

      for (const v of videos) {
        if (likedMap[v.id] !== undefined && v.isLiked !== likedMap[v.id]) {
          v.isLiked = likedMap[v.id];
          anyChanged = true;
        }
      }

      if (memoryCachedVideos) {
        memoryCachedVideos = memoryCachedVideos.map((v) =>
          likedMap[v.id] !== undefined ? { ...v, isLiked: likedMap[v.id] } : v
        );
      }

      if (anyChanged && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('sogo_video_likes_hydrated', {
            detail: { likedMap },
          })
        );
      }
    })
    .catch(() => {});
}

/**
 * Reads local cached videos (fallback & offline support).
 */
function getLocalVideos(): VideoPost[] {
  try {
    const raw = localStorage.getItem(LOCAL_VIDEOS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seenSeedUsers = new Set<string>();
        return parsed.filter((v) => {
          if (!v || !v.id || !v.videoUrl) return false;
          if (isSeedVideoDoc(v.id, v)) {
            if (Number(v.duration) > 0 && Number(v.duration) < 8) return false;
            const ownerKey = v.userId || v.user?.id || v.user?.username || v.id;
            if (seenSeedUsers.has(ownerKey)) return false;
            seenSeedUsers.add(ownerKey);
          }
          return true;
        });
      }
    }
  } catch (err) {
    console.warn('Failed to read local videos cache', err);
  }
  return [];
}

/**
 * Saves videos to local cache and in-memory cache.
 */
function saveLocalVideos(videos: VideoPost[]) {
  try {
    localStorage.setItem(LOCAL_VIDEOS_CACHE_KEY, JSON.stringify(videos.slice(0, 12)));
  } catch (err) {
    console.warn('Failed to update local videos cache', err);
  }
}

/**
 * Checks whether a Firestore document in the `videos` collection is a genuine playable Reel
 * (filtering out notifications, stories, comments, and reactions stored in the same collection).
 */
function isGenuineVideoDoc(docId: string, data?: Record<string, any> | null): boolean {
  if (!data) return false;
  if (
    data.isNotification ||
    data.isStory ||
    data.isComment ||
    data.isReaction ||
    docId.startsWith('notif_') ||
    docId.startsWith('story_') ||
    docId.startsWith('cmt_') ||
    docId.startsWith('react_')
  ) {
    return false;
  }
  return Boolean(data.videoUrl && typeof data.videoUrl === 'string' && data.videoUrl.trim() !== '');
}

/**
 * Checks whether a valid Reel document belongs to the controlled seed/demo dataset.
 */
function isSeedVideoDoc(docId: string, data?: Record<string, any> | null): boolean {
  if (!data) return false;
  return Boolean(
    data.isSeedContent === true ||
      data.isSeedAccount === true ||
      docId.startsWith('vid_sogo_seed_')
  );
}

// Session-scoped pagination buffers for adaptive mixing of genuine creator Reels and seed Reels
let sessionPaginationSeenIds = new Set<string>();
let sessionSeenSeedUserIds = new Set<string>();
let sessionBufferedRealVideos: VideoPost[] = [];
let sessionBufferedSeedVideos: VideoPost[] = [];
let sessionFirestoreExhausted = false;
let sessionLastEvaluatedCursor: DocumentSnapshot | null = null;
let sessionMixPatternStep = 0;
let sessionLastPickedWasSeed = false;

/**
 * Returns immediately available videos from memory or local cache for zero-delay rendering.
 */
function isVideoFromBlockedUser(video: VideoPost): boolean {
  if (!video) return false;
  if (video.userId && isUserBlocked(video.userId)) return true;
  if (video.user?.id && isUserBlocked(video.user.id)) return true;
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('sogo_user_blocked', ((e: CustomEvent) => {
    const blockedId = e.detail?.blockedUserId;
    if (!blockedId) return;
    if (memoryCachedVideos) {
      memoryCachedVideos = memoryCachedVideos.filter((v) => !isVideoFromBlockedUser(v));
    }
    sessionBufferedRealVideos = sessionBufferedRealVideos.filter((v) => !isVideoFromBlockedUser(v));
    sessionBufferedSeedVideos = sessionBufferedSeedVideos.filter((v) => !isVideoFromBlockedUser(v));
  }) as EventListener);
}

export function getCachedVideos(): VideoPost[] {
  let list: VideoPost[] = [];
  if (memoryCachedVideos && memoryCachedVideos.length > 0) {
    list = memoryCachedVideos.map((v) => ({
      ...v,
      isBookmarked: isVideoBookmarkedSync(v.id),
    }));
  } else {
    const local = getLocalVideos();
    if (local && local.length > 0) {
      list = local.map((v) => ({
        ...v,
        isBookmarked: isVideoBookmarkedSync(v.id),
      }));
    }
  }
  return list.filter((v) => !isVideoFromBlockedUser(v));
}

/**
 * Helper to deduplicate and Fisher-Yates shuffle a list of VideoPost items.
 */
function shuffleUniqueVideos(videos: VideoPost[], limitCount?: number): VideoPost[] {
  const seen = new Set<string>();
  const unique: VideoPost[] = [];
  for (const v of videos) {
    if (v && v.id && v.videoUrl && !seen.has(v.id)) {
      seen.add(v.id);
      unique.push(v);
    }
  }
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return limitCount ? unique.slice(0, limitCount) : unique;
}

/**
 * Mixes genuine creator Reels and seed Reels (at most 1 seed Reel per seed user),
 * always leading with genuine creator Reels and interleaving seed Reels without
 * ever placing consecutive seed Reels while genuine creator Reels remain.
 */
function mixRealAndSeedVideos(
  videos: VideoPost[],
  limitCount?: number,
  shufflePools = true
): VideoPost[] {
  const seenIds = new Set<string>();
  const seenSeedUsers = new Set<string>();
  const realList: VideoPost[] = [];
  const seedList: VideoPost[] = [];

  for (const v of videos) {
    if (!v || !v.id || !v.videoUrl || seenIds.has(v.id)) continue;
    seenIds.add(v.id);
    if (isSeedVideoDoc(v.id, v)) {
      const ownerKey = v.userId || v.user?.id || v.user?.username || v.id;
      if (seenSeedUsers.has(ownerKey)) continue;
      seenSeedUsers.add(ownerKey);
      seedList.push(v);
    } else {
      realList.push(v);
    }
  }

  const realPool = shufflePools ? shuffleUniqueVideos(realList) : [...realList];
  const seedPool = shufflePools ? shuffleUniqueVideos(seedList) : [...seedList];
  const pattern: Array<'real' | 'seed'> = ['real', 'real', 'seed', 'real', 'seed'];
  const mixed: VideoPost[] = [];
  let step = 0;
  let lastWasSeed = false;
  const maxItems = limitCount ?? realPool.length + seedPool.length;

  while (mixed.length < maxItems && (realPool.length > 0 || seedPool.length > 0)) {
    let pick: 'real' | 'seed';
    if (mixed.length === 0 && realPool.length > 0) {
      pick = 'real';
      step = 1;
    } else if (lastWasSeed && realPool.length > 0) {
      pick = 'real';
      step++;
    } else {
      pick = pattern[step % pattern.length];
      step++;
    }

    if (pick === 'real') {
      if (realPool.length > 0) {
        mixed.push(realPool.shift()!);
        lastWasSeed = false;
      } else if (seedPool.length > 0) {
        mixed.push(seedPool.shift()!);
        lastWasSeed = true;
      }
    } else {
      if (seedPool.length > 0) {
        mixed.push(seedPool.shift()!);
        lastWasSeed = true;
      } else if (realPool.length > 0) {
        mixed.push(realPool.shift()!);
        lastWasSeed = false;
      }
    }
  }

  return mixed;
}

/**
 * Returns immediately available randomized Reels for the Home feed.
 */
export function getCachedFeedReels(limitCount = 6): VideoPost[] {
  const all = getCachedVideos();
  if (all && all.length > 0) {
    return mixRealAndSeedVideos(all, limitCount, true);
  }
  return [];
}

/**
 * Fetches paginated videos from Firestore ordered by creation date descending,
 * adaptively interleaving genuine creator Reels and seed Reels so seed content
 * never blocks or overwhelms real creator Reels.
 * Returns video metadata immediately after the primary collection query and hydrates
 * user `isLiked` flags asynchronously in the background so Reel playback starts without delay.
 */
export async function getVideos(
  lastDocSnapshot?: DocumentSnapshot | null,
  pageSize = 4,
  currentUserId?: string,
  forceRefresh = false
): Promise<{ videos: VideoPost[]; nextCursor: DocumentSnapshot | null }> {
  // If requesting the first page without forceRefresh, check fresh in-memory cache
  if (!lastDocSnapshot && !forceRefresh && memoryCachedVideos && memoryCachedVideos.length > 0) {
    const age = Date.now() - lastVideosFetchTimestamp;
    if (age < VIDEOS_CACHE_TTL_MS) {
      perf.mark('REELS', 'Serving videos from memory cache', { count: memoryCachedVideos.length, ageMs: age });
      const safeCached = memoryCachedVideos.filter((v) => !isVideoFromBlockedUser(v));
      if (currentUserId && lastLikesHydratedUserId !== currentUserId) {
        hydrateVideoLikesInBackground(safeCached, currentUserId);
      }
      return {
        videos: safeCached,
        nextCursor: memoryCachedCursor,
      };
    }
  }

  // Deduplicate concurrent first-page requests (e.g. Home background warm + user tapping Reels tab)
  if (!lastDocSnapshot && !forceRefresh && inFlightFirstPagePromise) {
    const sharedRes = await inFlightFirstPagePromise;
    const safeShared = sharedRes.videos.filter((v) => !isVideoFromBlockedUser(v));
    if (currentUserId && lastLikesHydratedUserId !== currentUserId) {
      hydrateVideoLikesInBackground(safeShared, currentUserId);
    }
    return {
      videos: safeShared,
      nextCursor: sharedRes.nextCursor,
    };
  }

  const fetchTask = (async (): Promise<{ videos: VideoPost[]; nextCursor: DocumentSnapshot | null }> => {
    perf.start('REELS', 'getVideos', { pageSize, hasCursor: !!lastDocSnapshot });
    try {
      const videosRef = collection(db, VIDEOS_COLLECTION);
      const isFirstPage = !lastDocSnapshot;

      if (isFirstPage) {
        sessionPaginationSeenIds = new Set<string>();
        sessionSeenSeedUserIds = new Set<string>();
        sessionBufferedRealVideos = [];
        sessionBufferedSeedVideos = [];
        sessionFirestoreExhausted = false;
        sessionLastEvaluatedCursor = null;
        sessionMixPatternStep = 0;
        sessionLastPickedWasSeed = false;
      }

      let currentCursor: DocumentSnapshot | null | undefined =
        sessionLastEvaluatedCursor || lastDocSnapshot;
      let batchCount = 0;

      // Preserve any already-known isLiked flags from cache to avoid UI flicker during refresh
      const previousLikedMap = new Map<string, boolean>();
      if (memoryCachedVideos) {
        for (const cachedVid of memoryCachedVideos) {
          if (cachedVid.isLiked) {
            previousLikedMap.set(cachedVid.id, true);
          }
        }
      }

      // Scan documents in lean batches until we have enough genuine creator Reels to lead and interleave
      // with seed Reels (so notification docs or seed Reels never starve genuine creator Reels).
      const targetPoolSize = Math.max(pageSize * 2, 8);
      const minRealNeeded = Math.max(pageSize, 4);
      while (
        !sessionFirestoreExhausted &&
        (sessionBufferedRealVideos.length < minRealNeeded ||
          sessionBufferedRealVideos.length + sessionBufferedSeedVideos.length < targetPoolSize) &&
        batchCount < 6
      ) {
        batchCount++;
        const fetchBatchSize =
          sessionBufferedRealVideos.length < minRealNeeded
            ? Math.max(pageSize * 8, 48)
            : Math.max(pageSize * 5, 24);
        perf.start('REELS', 'Initial Firestore query', { batch: batchCount, limit: fetchBatchSize });

        let q = query(videosRef, orderBy('createdAt', 'desc'), limit(fetchBatchSize));
        if (currentCursor) {
          q = query(
            videosRef,
            orderBy('createdAt', 'desc'),
            startAfter(currentCursor),
            limit(fetchBatchSize)
          );
        }

        const snapshot = await getDocs(q);
        perf.end('REELS', 'Initial Firestore query', {
          docsReturned: snapshot.docs.length,
          batch: batchCount,
        });

        if (snapshot.docs.length === 0) {
          sessionFirestoreExhausted = true;
          break;
        }

        const newlyFoundSeeds: VideoPost[] = [];
        for (let i = 0; i < snapshot.docs.length; i++) {
          const d = snapshot.docs[i];
          sessionLastEvaluatedCursor = d;
          const data = d.data();
          if (!isGenuineVideoDoc(d.id, data)) continue;
          const authorUid = data.userId || data.user?.id;
          if (authorUid && isUserBlocked(authorUid)) continue;
          if (sessionPaginationSeenIds.has(d.id)) continue;
          sessionPaginationSeenIds.add(d.id);

          const isSeed = isSeedVideoDoc(d.id, data);
          if (isSeed) {
            const seedOwnerKey =
              data.userId || data.user?.id || data.user?.username || d.id;
            // Enforce maximum 1 seed Reel per seed user across the entire feed session
            if (sessionSeenSeedUserIds.has(seedOwnerKey)) {
              continue;
            }
            sessionSeenSeedUserIds.add(seedOwnerKey);
          }

          const video: VideoPost = {
            id: d.id,
            userId: data.userId || '',
            user: data.user || {
              id: data.userId || '',
              username: 'user',
              displayName: 'SogoSocial User',
              avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300',
            },
            videoUrl: data.videoUrl || '',
            thumbnailUrl: data.thumbnailUrl || '',
            caption: data.caption || '',
            tags: data.tags || [],
            likesCount: Number(data.likesCount) || 0,
            commentsCount: Number(data.commentsCount) || 0,
            viewsCount: Number(data.viewsCount) || 0,
            repostsCount: Number(data.repostsCount) || 0,
            duration: data.duration,
            publicId: data.publicId,
            createdAt: data.createdAt || new Date().toISOString(),
            isLiked: previousLikedMap.get(d.id) ?? false,
            isBookmarked: isVideoBookmarkedSync(d.id),
            isSeedContent: isSeed,
          };

          if (isSeed) {
            newlyFoundSeeds.push(video);
          } else {
            sessionBufferedRealVideos.push(video);
          }
        }

        if (newlyFoundSeeds.length > 0) {
          // Lightly shuffle newly scanned seed Reels so seed slots feature varied creators/topics
          sessionBufferedSeedVideos.push(...shuffleUniqueVideos(newlyFoundSeeds));
        }

        currentCursor = sessionLastEvaluatedCursor;
        if (snapshot.docs.length < fetchBatchSize) {
          sessionFirestoreExhausted = true;
        }
      }

      if (batchCount > 1) {
        perf.mark('REELS', 'Batch scanning needed multiple queries', { totalBatches: batchCount });
      }

      // Adaptively mix genuine creator Reels and seed Reels:
      // - Always lead with genuine creator Reels on the first page
      // - Never place two seed Reels back-to-back while genuine creator Reels remain
      const totalBuffered =
        sessionBufferedRealVideos.length + sessionBufferedSeedVideos.length;
      const realShare =
        totalBuffered > 0 ? sessionBufferedRealVideos.length / totalBuffered : 0;
      const mixPattern: Array<'real' | 'seed'> =
        realShare >= 0.65
          ? ['real', 'real', 'real', 'seed']
          : ['real', 'real', 'seed', 'real', 'seed'];

      const firestoreVideos: VideoPost[] = [];
      while (
        firestoreVideos.length < pageSize &&
        (sessionBufferedRealVideos.length > 0 || sessionBufferedSeedVideos.length > 0)
      ) {
        let pickType: 'real' | 'seed';
        // Never lead with a seed Reel on the first page when genuine creator Reels exist
        if (isFirstPage && firestoreVideos.length === 0 && sessionBufferedRealVideos.length > 0) {
          pickType = 'real';
          sessionMixPatternStep = 1;
        } else if (sessionLastPickedWasSeed && sessionBufferedRealVideos.length > 0) {
          // Never place two seed Reels consecutively while genuine creator Reels are available
          pickType = 'real';
          sessionMixPatternStep++;
        } else {
          pickType = mixPattern[sessionMixPatternStep % mixPattern.length];
          sessionMixPatternStep++;
        }

        if (pickType === 'real') {
          if (sessionBufferedRealVideos.length > 0) {
            firestoreVideos.push(sessionBufferedRealVideos.shift()!);
            sessionLastPickedWasSeed = false;
          } else if (sessionBufferedSeedVideos.length > 0) {
            firestoreVideos.push(sessionBufferedSeedVideos.shift()!);
            sessionLastPickedWasSeed = true;
          }
        } else {
          if (sessionBufferedSeedVideos.length > 0) {
            firestoreVideos.push(sessionBufferedSeedVideos.shift()!);
            sessionLastPickedWasSeed = true;
          } else if (sessionBufferedRealVideos.length > 0) {
            firestoreVideos.push(sessionBufferedRealVideos.shift()!);
            sessionLastPickedWasSeed = false;
          }
        }
      }

      const hasMoreToServe =
        !sessionFirestoreExhausted ||
        sessionBufferedRealVideos.length > 0 ||
        sessionBufferedSeedVideos.length > 0;
      const nextCursor = hasMoreToServe
        ? sessionLastEvaluatedCursor || lastDocSnapshot || null
        : null;

      // Cache videos locally and in-memory immediately (before background like checks)
      if (isFirstPage && firestoreVideos.length > 0) {
        memoryCachedVideos = firestoreVideos;
        memoryCachedCursor = nextCursor;
        lastVideosFetchTimestamp = Date.now();
        saveLocalVideos(firestoreVideos);
      }

      // Warm ONLY the first Reel's poster image (warmStream = false so we never compete with <video> byte streaming)
      if (firestoreVideos.length > 0) {
        warmCloudinaryVideoPlayback(
          firestoreVideos[0].videoUrl,
          firestoreVideos[0].thumbnailUrl,
          false
        );
      }

      // Hydrate user liked status asynchronously in the background (non-blocking!)
      if (currentUserId && firestoreVideos.length > 0) {
        hydrateVideoLikesInBackground(firestoreVideos, currentUserId);
      }

      perf.end('REELS', 'getVideos', { totalLoaded: firestoreVideos.length });
      return {
        videos: firestoreVideos,
        nextCursor,
      };
    } catch (err) {
      console.warn('Firestore getVideos failed, using local cache fallback', err);
      perf.end('REELS', 'getVideos', { error: true });
      const cached = getLocalVideos();
      return {
        videos: cached,
        nextCursor: null,
      };
    }
  })();

  if (!lastDocSnapshot && !forceRefresh) {
    inFlightFirstPagePromise = fetchTask;
  }

  try {
    return await fetchTask;
  } finally {
    if (inFlightFirstPagePromise === fetchTask) {
      inFlightFirstPagePromise = null;
    }
  }
}

/**
 * Fetches a small varied/randomized selection of active, valid Reels for display in the Home feed.
 * Respects existing video validity checks (active, non-notification, has videoUrl).
 * Uses in-memory cache first if available, or a small candidate pool from recent videos.
 * Does NOT execute like queries (not shown in Home carousel).
 */
export async function getRandomFeedVideos(
  limitCount = 6,
  forceRefresh = false
): Promise<VideoPost[]> {
  perf.start('HOME', 'Reel/video data if Home loads it');
  try {
    // 1. If in-memory cache already has videos and not forcing refresh, mix & shuffle from memory (0ms network cost!)
    if (!forceRefresh && memoryCachedVideos && memoryCachedVideos.length > 0) {
      const mixed = mixRealAndSeedVideos(memoryCachedVideos, limitCount, true).filter((v) => !isVideoFromBlockedUser(v));
      if (mixed.length > 0) {
        perf.end('HOME', 'Reel/video data if Home loads it', { source: 'memory-cache', count: mixed.length });
        return mixed;
      }
    }

    // 2. Fetch a lean candidate pool of up to 6 videos in a single batch query
    const { videos } = await getVideos(null, Math.min(limitCount, 6), undefined, forceRefresh);
    if (!videos || videos.length === 0) {
      perf.end('HOME', 'Reel/video data if Home loads it', { source: 'empty', count: 0 });
      return [];
    }

    const result = mixRealAndSeedVideos(videos, limitCount, true).filter((v) => !isVideoFromBlockedUser(v));
    perf.end('HOME', 'Reel/video data if Home loads it', { source: 'firestore-shuffled', count: result.length });
    return result;
  } catch (err) {
    console.warn('getRandomFeedVideos failed, falling back to local cache', err);
    const result = mixRealAndSeedVideos(getLocalVideos(), limitCount, true).filter((v) => !isVideoFromBlockedUser(v));
    perf.end('HOME', 'Reel/video data if Home loads it', { source: 'local-cache-fallback', count: result.length });
    return result;
  }
}

/**
 * Creates a new video document in Firestore after Cloudinary upload succeeds.
 * Uses an optional idempotencyKey so retries of the same upload never create duplicate Reels.
 */
export async function createVideo(
  videoData: Omit<VideoPost, 'id' | 'likesCount' | 'commentsCount' | 'viewsCount' | 'isLiked' | 'createdAt'>,
  idempotencyKey?: string
): Promise<VideoPost> {
  if (!videoData.videoUrl || !videoData.videoUrl.startsWith('https://')) {
    throw new Error('A valid uploaded video URL is required before publishing a Reel.');
  }

  const sanitizedKey = idempotencyKey
    ? idempotencyKey.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64)
    : '';
  const newVideoId = sanitizedKey
    ? `vid_${sanitizedKey}`
    : `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();

  const fullVideo: VideoPost = {
    ...videoData,
    id: newVideoId,
    likesCount: 0,
    commentsCount: 0,
    viewsCount: 0,
    isLiked: false,
    createdAt: nowIso,
  };

  const firestorePayload = {
    userId: fullVideo.userId,
    user: fullVideo.user,
    videoUrl: fullVideo.videoUrl,
    thumbnailUrl: fullVideo.thumbnailUrl,
    caption: fullVideo.caption,
    tags: fullVideo.tags || [],
    likesCount: 0,
    commentsCount: 0,
    viewsCount: 0,
    duration: fullVideo.duration || 0,
    publicId: fullVideo.publicId || null,
    createdAt: nowIso,
  };

  const docRef = doc(db, VIDEOS_COLLECTION, newVideoId);
  try {
    await setDoc(docRef, firestorePayload);
  } catch (firstErr) {
    console.warn('Retrying Firestore video document write after error:', firstErr);
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await setDoc(docRef, firestorePayload);
    } catch (err) {
      console.error('Failed to write video document to Firestore', err);
      throw new Error('Video uploaded, but saving to SogoSocial failed. Please tap Publish to try saving again.');
    }
  }

  // Update local & memory caches after Firestore write succeeds (deduplicated by ID)
  const existing = getLocalVideos().filter((v) => v.id !== newVideoId);
  saveLocalVideos([fullVideo, ...existing]);

  // Track Sogo Stars "Post 3 new Reels" mission (200 Stars) asynchronously
  recordSogoStarAction({
    userId: fullVideo.userId,
    missionId: 'post_reels',
    actionKey: newVideoId,
  }).catch(() => {});

  return fullVideo;
}

/**
 * Toggles a like on a video in Firestore:
 * Writes to subcollection `videos/{videoId}/likes/{userId}` and updates `likesCount`.
 * Primary Like write completes first; Sogo Stars tracking and notifications run asynchronously.
 */
export async function toggleLikeVideo(
  videoId: string,
  userId: string,
  actorUser?: VideoComment['user'],
  knownCurrentlyLiked?: boolean
): Promise<{ isLiked: boolean; likesCount: number }> {
  const videoRef = doc(db, VIDEOS_COLLECTION, videoId);
  const likeRef = doc(db, VIDEOS_COLLECTION, videoId, 'likes', userId);
  const toggleKey = `${videoId}_${userId}`;

  // Use cached video metadata if available to avoid blocking on a second document read
  const cachedVideo =
    primedVideosById.get(videoId) ||
    memoryCachedVideos?.find((v) => v.id === videoId) ||
    getLocalVideos().find((v) => v.id === videoId) ||
    null;

  let wasLiked: boolean;
  if (typeof knownCurrentlyLiked === 'boolean') {
    wasLiked = knownCurrentlyLiked;
  } else if (userToggledLikeMap.has(toggleKey)) {
    wasLiked = userToggledLikeMap.get(toggleKey)!;
  } else if (cachedVideo && typeof cachedVideo.isLiked === 'boolean') {
    wasLiked = cachedVideo.isLiked;
  } else {
    const likeSnap = await getDoc(likeRef);
    wasLiked = likeSnap.exists();
  }

  const currentLikes = cachedVideo ? Number(cachedVideo.likesCount) || 0 : 0;

  if (wasLiked) {
    // Unlike
    const nextCount = Math.max(0, currentLikes - 1);
    userToggledLikeMap.set(toggleKey, false);

    if (memoryCachedVideos) {
      memoryCachedVideos = memoryCachedVideos.map((v) =>
        v.id === videoId ? { ...v, isLiked: false, likesCount: nextCount } : v
      );
    }
    const existingPrimed = primedVideosById.get(videoId);
    if (existingPrimed) {
      primedVideosById.set(videoId, { ...existingPrimed, isLiked: false, likesCount: nextCount });
    }

    try {
      await deleteDoc(likeRef);
    } catch (err) {
      userToggledLikeMap.set(toggleKey, true);
      if (memoryCachedVideos) {
        memoryCachedVideos = memoryCachedVideos.map((v) =>
          v.id === videoId ? { ...v, isLiked: true, likesCount: currentLikes } : v
        );
      }
      if (existingPrimed) {
        primedVideosById.set(videoId, { ...existingPrimed, isLiked: true, likesCount: currentLikes });
      }
      throw err;
    }

    // Update counter in background without blocking UI
    updateDoc(videoRef, { likesCount: increment(-1) }).catch(() => {});

    return { isLiked: false, likesCount: nextCount };
  } else {
    // Like
    const nextCount = currentLikes + 1;
    userToggledLikeMap.set(toggleKey, true);

    if (memoryCachedVideos) {
      memoryCachedVideos = memoryCachedVideos.map((v) =>
        v.id === videoId ? { ...v, isLiked: true, likesCount: nextCount } : v
      );
    }
    const existingPrimed = primedVideosById.get(videoId);
    if (existingPrimed) {
      primedVideosById.set(videoId, { ...existingPrimed, isLiked: true, likesCount: nextCount });
    }

    try {
      await setDoc(likeRef, { userId, likedAt: new Date().toISOString() });
    } catch (err) {
      userToggledLikeMap.set(toggleKey, false);
      if (memoryCachedVideos) {
        memoryCachedVideos = memoryCachedVideos.map((v) =>
          v.id === videoId ? { ...v, isLiked: false, likesCount: currentLikes } : v
        );
      }
      if (existingPrimed) {
        primedVideosById.set(videoId, { ...existingPrimed, isLiked: false, likesCount: currentLikes });
      }
      throw err;
    }

    // Update counter in background without blocking UI
    updateDoc(videoRef, { likesCount: increment(1) }).catch(() => {});

    // Secondary processing: Sogo Stars tracking & notification (non-blocking)
    const resolveSecondary = async () => {
      let ownerId = (cachedVideo as any)?.userId || (cachedVideo as any)?.user?.id;
      let thumbUrl = (cachedVideo as any)?.thumbnailUrl;

      if (!ownerId) {
        const snap = await getDoc(videoRef).catch(() => null);
        if (snap && snap.exists()) {
          const d = snap.data();
          ownerId = d?.userId || d?.user?.id;
          thumbUrl = d?.thumbnailUrl;
        }
      }

      // Track Sogo Stars "Like 3 Reels" mission (50 Stars)
      recordSogoStarAction({
        userId,
        missionId: 'like_reels',
        actionKey: videoId,
        targetOwnerId: ownerId,
      }).catch(() => {});

      if (actorUser && ownerId && ownerId !== userId) {
        createNotification({
          recipientUserId: ownerId,
          actor: {
            id: actorUser.id || userId,
            username: actorUser.username || 'user',
            displayName: actorUser.displayName || 'User',
            avatarUrl: actorUser.avatarUrl || '',
          },
          type: 'video_like',
          videoId,
          postImageUrl: thumbUrl,
        }).catch((err) => {
          console.warn('Could not dispatch video like notification:', err);
        });
      }
    };
    resolveSecondary().catch(() => {});

    return { isLiked: true, likesCount: nextCount };
  }
}

/**
 * Increments the view count for a video conservatively.
 * Avoids spamming by checking session-viewed cache first.
 */
export async function incrementVideoViews(videoId: string): Promise<number | null> {
  if (!videoId || sessionViewedIds.has(videoId)) {
    return null; // Already counted for this session
  }
  sessionViewedIds.add(videoId);

  let updatedCount: number | null = null;
  let targetVideoOwnerId: string | undefined;
  const local = getLocalVideos();
  if (local.length > 0) {
    const nextLocal = local.map((v) => {
      if (v.id === videoId) {
        targetVideoOwnerId = v.userId || v.user?.id;
        updatedCount = (Number(v.viewsCount) || 0) + 1;
        return { ...v, viewsCount: updatedCount };
      }
      return v;
    });
    if (updatedCount !== null) {
      saveLocalVideos(nextLocal);
    }
  } else if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.map((v) => {
      if (v.id === videoId) {
        targetVideoOwnerId = v.userId || v.user?.id;
        updatedCount = (Number(v.viewsCount) || 0) + 1;
        return { ...v, viewsCount: updatedCount };
      }
      return v;
    });
  }

  const viewerUid = auth?.currentUser?.uid;
  if (viewerUid) {
    recordSogoStarAction({
      userId: viewerUid,
      missionId: 'watch_reels',
      actionKey: videoId,
      targetOwnerId: targetVideoOwnerId,
    }).catch(() => {});
  }

  try {
    const videoRef = doc(db, VIDEOS_COLLECTION, videoId);
    await updateDoc(videoRef, {
      viewsCount: increment(1),
    });
  } catch (err) {
    console.warn('Could not increment video views in Firestore', err);
  }

  return updatedCount;
}

/**
 * Retrieves comments for a video from `videos/{videoId}/comments`.
 */
export async function getVideoComments(videoId: string): Promise<VideoComment[]> {
  const sessionList = sessionVideoCommentsMap.get(videoId) || [];
  try {
    const commentsRef = collection(db, VIDEOS_COLLECTION, videoId, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);

    const firestoreList = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        videoId,
        userId: data.userId || '',
        user: data.user || {
          id: data.userId || '',
          username: 'user',
          displayName: 'User',
          avatarUrl: '',
        },
        text: data.text || '',
        createdAt: data.createdAt || new Date().toISOString(),
      };
    });

    const byId = new Map<string, VideoComment>();
    for (const c of sessionList) {
      byId.set(c.id, c);
    }
    for (const c of firestoreList) {
      byId.set(c.id, c);
    }
    const merged = Array.from(byId.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    sessionVideoCommentsMap.set(videoId, merged);
    return merged;
  } catch (err) {
    console.warn('Failed to load video comments from Firestore', err);
    return sessionList;
  }
}

/**
 * Adds a comment to a video in `videos/{videoId}/comments` and increments `commentsCount`.
 */
export async function addVideoComment(
  videoId: string,
  user: VideoComment['user'],
  text: string
): Promise<VideoComment> {
  const commentId = `vcom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();
  const cleanText = text.trim();

  // Sanitize user object so undefined properties (such as user.isVerified === undefined)
  // never cause Firestore setDoc() validation errors.
  const sanitizedUser: VideoComment['user'] = {
    id: user.id || auth?.currentUser?.uid || '',
    username: user.username || 'user',
    displayName: user.displayName || 'User',
    avatarUrl: user.avatarUrl || '',
    ...(user.isVerified !== undefined ? { isVerified: Boolean(user.isVerified) } : {}),
  };

  const comment: VideoComment = {
    id: commentId,
    videoId,
    userId: sanitizedUser.id,
    user: sanitizedUser,
    text: cleanText,
    createdAt: nowIso,
  };

  // 1. Primary operation: persist comment to Firestore subcollection
  const commentRef = doc(db, VIDEOS_COLLECTION, videoId, 'comments', commentId);
  await setDoc(commentRef, {
    id: commentId,
    videoId,
    userId: sanitizedUser.id,
    user: sanitizedUser,
    text: comment.text,
    createdAt: nowIso,
  });

  // Update in-memory caches immediately
  const existingSessionComments = sessionVideoCommentsMap.get(videoId) || [];
  sessionVideoCommentsMap.set(videoId, [...existingSessionComments, comment]);

  if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.map((v) =>
      v.id === videoId ? { ...v, commentsCount: (Number(v.commentsCount) || 0) + 1 } : v
    );
  }
  const existingPrimed = primedVideosById.get(videoId);
  if (existingPrimed) {
    primedVideosById.set(videoId, {
      ...existingPrimed,
      commentsCount: (Number(existingPrimed.commentsCount) || 0) + 1,
    });
  }

  // 2. Secondary operations: counter increment, Sogo Stars tracking, and notification (non-blocking)
  const videoRef = doc(db, VIDEOS_COLLECTION, videoId);
  updateDoc(videoRef, {
    commentsCount: increment(1),
  }).catch(() => {});

  const cachedVideo =
    existingPrimed ||
    memoryCachedVideos?.find((v) => v.id === videoId) ||
    getLocalVideos().find((v) => v.id === videoId) ||
    null;

  (async () => {
    let videoOwnerId = cachedVideo?.userId || cachedVideo?.user?.id;
    let thumbnailUrl = cachedVideo?.thumbnailUrl;

    if (!videoOwnerId) {
      const videoSnap = await getDoc(videoRef).catch(() => null);
      const videoData = videoSnap && videoSnap.exists() ? videoSnap.data() : null;
      videoOwnerId = videoData?.userId || videoData?.user?.id;
      thumbnailUrl = videoData?.thumbnailUrl;
    }

    // Track Sogo Stars "Comment on 3 Reels" mission (50 Stars)
    if (comment.text.length > 0) {
      recordSogoStarAction({
        userId: sanitizedUser.id,
        missionId: 'comment_reels',
        actionKey: commentId,
        targetOwnerId: videoOwnerId,
      }).catch(() => {});
    }

    if (videoOwnerId && videoOwnerId !== sanitizedUser.id) {
      createNotification({
        recipientUserId: videoOwnerId,
        actor: {
          id: sanitizedUser.id,
          username: sanitizedUser.username,
          displayName: sanitizedUser.displayName,
          avatarUrl: sanitizedUser.avatarUrl,
        },
        type: 'video_comment',
        videoId,
        postImageUrl: thumbnailUrl,
        text: comment.text,
      }).catch((err) => {
        console.warn('Could not dispatch video comment notification:', err);
      });
    }
  })().catch(() => {});

  return comment;
}

/**
 * Retrieves all videos created by a specific user (for the Profile screen and creator-scoped Reel viewer).
 */
export async function getUserVideos(userId: string, currentUserId?: string): Promise<VideoPost[]> {
  if (!userId) return [];
  if (isUserBlocked(userId)) return [];
  try {
    const videosRef = collection(db, VIDEOS_COLLECTION);
    // Single-field query avoids "The query requires an index" composite index failure
    const q = query(videosRef, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    const videos: VideoPost[] = snapshot.docs
      .filter((d) => !d.data().isNotification && !d.data().isStory && Boolean(d.data().videoUrl))
      .map((d) => {
        const data = d.data();
        const existingPrimed = primedVideosById.get(d.id);
        return {
          id: d.id,
          userId: data.userId || userId,
          user: data.user || {
            id: data.userId || userId,
            username: 'user',
            displayName: 'User',
            avatarUrl: '',
          },
          videoUrl: data.videoUrl || '',
          thumbnailUrl: data.thumbnailUrl || '',
          caption: data.caption || '',
          tags: data.tags || [],
          likesCount: Number(data.likesCount) || 0,
          commentsCount: Number(data.commentsCount) || 0,
          viewsCount: Number(data.viewsCount) || 0,
          repostsCount: Number(data.repostsCount) || 0,
          isLiked: existingPrimed?.isLiked ?? false,
          isBookmarked: isVideoBookmarkedSync(d.id),
          duration: data.duration,
          createdAt: data.createdAt || new Date().toISOString(),
        };
      });

    // In-memory sort by createdAt descending
    videos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    primeUserVideosInCache(userId, videos);
    if (currentUserId) {
      hydrateVideoLikesInBackground(videos, currentUserId);
    }
    return videos;
  } catch (err) {
    console.warn('Failed to query user videos from Firestore, checking local cache', err);
    return getCachedUserVideos(userId);
  }
}

/**
 * Retrieves a single video document by ID from Firestore or fallback cache.
 */
export async function getVideoById(videoId: string, currentUserId?: string): Promise<VideoPost | null> {
  if (!videoId) return null;
  perf.start('REELS', 'getVideoById', { videoId });

  // 1. Check in-memory cached or primed videos first (0ms latency!)
  if (primedVideosById.has(videoId)) {
    const primedMatch = primedVideosById.get(videoId)!;
    if (isVideoFromBlockedUser(primedMatch)) return null;
    if (currentUserId) {
      hydrateVideoLikesInBackground([primedMatch], currentUserId);
    }
    perf.end('REELS', 'getVideoById', { source: 'primed-cache' });
    return primedMatch;
  }

  if (memoryCachedVideos) {
    const memoryMatch = memoryCachedVideos.find((v) => v.id === videoId);
    if (memoryMatch) {
      if (isVideoFromBlockedUser(memoryMatch)) return null;
      if (currentUserId && lastLikesHydratedUserId !== currentUserId) {
        hydrateVideoLikesInBackground([memoryMatch], currentUserId);
      }
      perf.end('REELS', 'getVideoById', { source: 'memory-cache' });
      return memoryMatch;
    }
  }

  // 2. Check local storage cache
  const localMatch = getLocalVideos().find((v) => v.id === videoId);
  if (localMatch) {
    if (isVideoFromBlockedUser(localMatch)) return null;
    perf.end('REELS', 'getVideoById', { source: 'local-cache' });
    return localMatch;
  }

  // 3. Fallback to direct Firestore getDoc
  try {
    const videoRef = doc(db, VIDEOS_COLLECTION, videoId);
    const snap = await getDoc(videoRef);
    if (!snap.exists()) {
      perf.end('REELS', 'getVideoById', { source: 'not-found' });
      return null;
    }

    const data = snap.data();
    if (data.isNotification || data.isStory || !data.videoUrl) {
      perf.end('REELS', 'getVideoById', { source: 'invalid' });
      return null;
    }

    const video: VideoPost = {
      id: snap.id,
      userId: data.userId || '',
      user: data.user || {
        id: data.userId || '',
        username: 'user',
        displayName: 'SogoSocial User',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300',
      },
      videoUrl: data.videoUrl || '',
      thumbnailUrl: data.thumbnailUrl || '',
      caption: data.caption || '',
      tags: data.tags || [],
      likesCount: Number(data.likesCount) || 0,
      commentsCount: Number(data.commentsCount) || 0,
      viewsCount: Number(data.viewsCount) || 0,
      repostsCount: Number(data.repostsCount) || 0,
      duration: data.duration,
      createdAt: data.createdAt || new Date().toISOString(),
      isLiked: false,
      isBookmarked: isVideoBookmarkedSync(snap.id),
    };

    if (isVideoFromBlockedUser(video)) return null;

    if (currentUserId) {
      hydrateVideoLikesInBackground([video], currentUserId);
    }

    perf.end('REELS', 'getVideoById', { source: 'firestore' });
    return video;
  } catch (err) {
    console.warn('Failed to get video by ID from Firestore', err);
    perf.end('REELS', 'getVideoById', { source: 'error' });
    const cached = getLocalVideos();
    const found = cached.find((v) => v.id === videoId) || null;
    if (found && isVideoFromBlockedUser(found)) return null;
    return found;
  }
}

/**
 * Updates cached video repost count and reposted flag in memory and localStorage.
 */
export function updateCachedVideoReposts(
  videoId: string,
  delta: number,
  isReposted?: boolean
): void {
  if (!videoId) return;
  const local = getLocalVideos();
  if (local.length > 0) {
    const updatedLocal = local.map((v) => {
      if (v.id === videoId) {
        return {
          ...v,
          repostsCount: Math.max(0, (v.repostsCount || 0) + delta),
          ...(isReposted !== undefined ? { isReposted } : {}),
        };
      }
      return v;
    });
    saveLocalVideos(updatedLocal);
  } else if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.map((v) => {
      if (v.id === videoId) {
        return {
          ...v,
          repostsCount: Math.max(0, (v.repostsCount || 0) + delta),
          ...(isReposted !== undefined ? { isReposted } : {}),
        };
      }
      return v;
    });
  }
}

/**
 * Synchronizes an updated user profile (avatarUrl / displayName) across cached videos
 * and updates the user's own video documents in Firestore in the background.
 */
export function syncUserProfileInVideos(
  userId: string,
  updates: { displayName?: string; avatarUrl?: string; username?: string }
): void {
  if (!userId) return;

  const local = getLocalVideos();
  if (local.length > 0) {
    let changed = false;
    const updatedLocal = local.map((v) => {
      if (v.userId === userId || v.user?.id === userId) {
        changed = true;
        return {
          ...v,
          user: {
            ...v.user,
            ...(updates.displayName ? { displayName: updates.displayName } : {}),
            ...(updates.avatarUrl ? { avatarUrl: updates.avatarUrl } : {}),
            ...(updates.username ? { username: updates.username } : {}),
          },
        };
      }
      return v;
    });
    if (changed) {
      saveLocalVideos(updatedLocal);
    }
  } else if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.map((v) => {
      if (v.userId === userId || v.user?.id === userId) {
        return {
          ...v,
          user: {
            ...v.user,
            ...(updates.displayName ? { displayName: updates.displayName } : {}),
            ...(updates.avatarUrl ? { avatarUrl: updates.avatarUrl } : {}),
            ...(updates.username ? { username: updates.username } : {}),
          },
        };
      }
      return v;
    });
  }

  if (db && auth?.currentUser?.uid === userId) {
    const q = query(collection(db, VIDEOS_COLLECTION), where('userId', '==', userId), limit(30));
    getDocs(q)
      .then((snap) => {
        snap.docs.forEach((docSnap) => {
          const d = docSnap.data();
          if (d.isNotification || d.isStory || !d.videoUrl) return;
          if (d.user) {
            updateDoc(doc(db, VIDEOS_COLLECTION, docSnap.id), {
              user: {
                ...d.user,
                ...(updates.displayName ? { displayName: updates.displayName } : {}),
                ...(updates.avatarUrl ? { avatarUrl: updates.avatarUrl } : {}),
                ...(updates.username ? { username: updates.username } : {}),
              },
            }).catch(() => {});
          }
        });
      })
      .catch(() => {});
  }
}

  if (typeof window !== 'undefined') {
    window.addEventListener('sogo_profile_updated', (e: Event) => {
      const customEvent = e as CustomEvent<{
        userId: string;
        displayName?: string;
        avatarUrl?: string;
        user?: Partial<User>;
      }>;
      if (customEvent.detail?.userId) {
        syncUserProfileInVideos(customEvent.detail.userId, {
          displayName: customEvent.detail.displayName || customEvent.detail.user?.displayName,
          avatarUrl: customEvent.detail.avatarUrl || customEvent.detail.user?.avatarUrl,
          username: customEvent.detail.user?.username,
        });
      }
    });
  }

/**
 * Updates a Reel's caption/tags in Firestore and all local/memory caches.
 * Strictly requires the authenticated user's UID to match the Reel document's userId.
 */
export async function updateVideo(
  videoId: string,
  updates: { caption: string; tags?: string[] }
): Promise<VideoPost> {
  const cleanId = (videoId || '').trim();
  if (!cleanId) {
    throw new Error('Invalid Reel ID.');
  }

  const activeUserId = auth?.currentUser?.uid;
  if (!activeUserId) {
    throw new Error('You must be signed in to edit a Reel.');
  }

  const cleanCaption = updates.caption.trim();
  const extractedTags =
    updates.tags !== undefined
      ? updates.tags
      : Array.from(
          new Set(
            (cleanCaption.match(/#[a-zA-Z0-9_]+/g) || []).map((t) =>
              t.slice(1).toLowerCase()
            )
          )
        );

  const videoRef = doc(db, VIDEOS_COLLECTION, cleanId);
  const docSnap = await getDoc(videoRef);
  if (!docSnap.exists()) {
    throw new Error('Reel not found.');
  }

  const data = docSnap.data();
  if (!data.userId || data.userId !== activeUserId) {
    throw new Error('Only the Reel owner can edit this Reel.');
  }

  await updateDoc(videoRef, {
    caption: cleanCaption,
    tags: extractedTags,
    updatedAt: new Date().toISOString(),
  });

  const existingCached =
    primedVideosById.get(cleanId) ||
    memoryCachedVideos?.find((v) => v.id === cleanId) ||
    getLocalVideos().find((v) => v.id === cleanId);

  const updatedVideo: VideoPost = {
    id: cleanId,
    userId: data.userId,
    user: existingCached?.user || data.user || {
      id: data.userId,
      username: 'user',
      displayName: 'User',
      avatarUrl: '',
    },
    videoUrl: existingCached?.videoUrl || data.videoUrl || '',
    thumbnailUrl: existingCached?.thumbnailUrl || data.thumbnailUrl || '',
    caption: cleanCaption,
    tags: extractedTags,
    likesCount: existingCached?.likesCount ?? (Number(data.likesCount) || 0),
    commentsCount: existingCached?.commentsCount ?? (Number(data.commentsCount) || 0),
    viewsCount: existingCached?.viewsCount ?? (Number(data.viewsCount) || 0),
    repostsCount: existingCached?.repostsCount ?? (Number(data.repostsCount) || 0),
    isLiked: existingCached?.isLiked ?? false,
    isBookmarked: isVideoBookmarkedSync(cleanId),
    isReposted: existingCached?.isReposted,
    duration: existingCached?.duration ?? data.duration,
    createdAt: existingCached?.createdAt || data.createdAt || new Date().toISOString(),
  };

  primedVideosById.set(cleanId, updatedVideo);

  if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.map((v) =>
      v.id === cleanId ? updatedVideo : v
    );
  }

  cachedUserVideosById.forEach((list, uid) => {
    if (list.some((v) => v.id === cleanId)) {
      cachedUserVideosById.set(
        uid,
        list.map((v) => (v.id === cleanId ? updatedVideo : v))
      );
    }
  });

  const local = getLocalVideos();
  if (local.some((v) => v.id === cleanId)) {
    saveLocalVideos(local.map((v) => (v.id === cleanId ? updatedVideo : v)));
  }

  const bookmarkedMap = getBookmarkedVideosMap();
  if (bookmarkedMap.has(cleanId)) {
    bookmarkedMap.set(cleanId, { ...updatedVideo, isBookmarked: true });
    saveBookmarkedVideosMap(bookmarkedMap);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_video_updated', {
        detail: { video: updatedVideo },
      })
    );
  }

  return updatedVideo;
}

/**
 * Permanently deletes a Reel from Firestore and removes it from all local/memory caches.
 * Strictly requires the authenticated user's UID to match the Reel document's userId.
 */
export async function deleteVideo(videoId: string): Promise<void> {
  const cleanId = (videoId || '').trim();
  if (!cleanId) {
    throw new Error('Invalid Reel ID.');
  }

  const activeUserId = auth?.currentUser?.uid;
  if (!activeUserId) {
    throw new Error('You must be signed in to delete a Reel.');
  }

  const videoRef = doc(db, VIDEOS_COLLECTION, cleanId);
  const docSnap = await getDoc(videoRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    if (!data.userId || data.userId !== activeUserId) {
      throw new Error('Only the Reel owner can delete this Reel.');
    }
    await deleteDoc(videoRef);
  }

  // Best-effort cleanup if the owner had also shared their own Reel to Sogo timeline
  deleteDoc(doc(db, 'posts', `repost_video_${cleanId}_${activeUserId}`)).catch(() => {});

  // Remove from all in-memory and localStorage caches
  primedVideosById.delete(cleanId);
  sessionPaginationSeenIds.delete(cleanId);
  sessionBufferedRealVideos = sessionBufferedRealVideos.filter((v) => v.id !== cleanId);
  sessionBufferedSeedVideos = sessionBufferedSeedVideos.filter((v) => v.id !== cleanId);

  if (memoryCachedVideos) {
    memoryCachedVideos = memoryCachedVideos.filter((v) => v.id !== cleanId);
  }

  cachedUserVideosById.forEach((list, uid) => {
    if (list.some((v) => v.id === cleanId)) {
      cachedUserVideosById.set(
        uid,
        list.filter((v) => v.id !== cleanId)
      );
    }
  });

  const local = getLocalVideos();
  if (local.some((v) => v.id === cleanId)) {
    saveLocalVideos(local.filter((v) => v.id !== cleanId));
  }

  const bookmarkedMap = getBookmarkedVideosMap();
  if (bookmarkedMap.has(cleanId)) {
    bookmarkedMap.delete(cleanId);
    saveBookmarkedVideosMap(bookmarkedMap);
  }

  sessionVideoCommentsMap.delete(cleanId);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_video_deleted', {
        detail: { videoId: cleanId },
      })
    );
  }
}

