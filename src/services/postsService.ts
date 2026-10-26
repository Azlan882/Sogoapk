import {
  collection,
  doc,
  getDocs,
  getCountFromServer,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Post, PostLocationData, Comment, User, VideoPost } from '../types';
import {
  createNotification,
  removeLikeNotification,
  removeRepostNotification,
} from './notificationsService';
import * as videosService from './videosService';
import { recordSogoStarAction } from './sogoStarsService';
import { isUserBlocked } from './blockService';
import { perf } from '../utils/perfLogger';
import { getOptimizedPosterUrl } from '../lib/utils';

const POSTS_STORAGE_KEY = 'sogo_posts_cache';
const COMMENTS_STORAGE_KEY = 'sogo_comments_cache';
const POSTS_COLLECTION = 'posts';
const VIDEOS_COLLECTION = 'videos';

// In-memory feed cache for instantaneous navigation between Home, Reels, and Profile
let memoryCachedPosts: Post[] | null = null;
let lastPostsFetchTimestamp = 0;
let inFlightFeedPostsPromise: Promise<Post[]> | null = null;
const POSTS_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

const INITIAL_POSTS: Post[] = [
  {
    id: 'post_1',
    userId: 'user_2',
    user: {
      id: 'user_2',
      username: 'maya_lens',
      displayName: 'Maya Chen',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop&q=80',
      isVerified: true,
    },
    imageUrl: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1200&auto=format&fit=crop&q=80',
    caption: 'Neon reflections in Shinjuku alleys after the rain. There is a quiet magic in the city when the crowds disperse. 🏮✨ #tokyo #filmphotography #cinematic',
    tags: ['tokyo', 'filmphotography', 'cinematic'],
    location: 'Shinjuku, Tokyo, Japan',
    likesCount: 342,
    commentsCount: 28,
    viewsCount: 1250,
    isLiked: false,
    isBookmarked: false,
    createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'post_2',
    userId: 'user_1',
    user: {
      id: 'user_1',
      username: 'azlan',
      displayName: 'Azlan Malik',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
      isVerified: true,
    },
    imageUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&auto=format&fit=crop&q=80',
    caption: 'Clean workspace, cold brew, and shipping features. The SogoSocial design system is coming together so smoothly. 💻☕️',
    tags: ['developer', 'workspace', 'minimalism'],
    location: 'San Francisco, CA',
    likesCount: 512,
    commentsCount: 42,
    viewsCount: 2480,
    isLiked: true,
    isBookmarked: true,
    createdAt: new Date(Date.now() - 7 * 3600000).toISOString(),
  },
  {
    id: 'post_3',
    userId: 'user_4',
    user: {
      id: 'user_4',
      username: 'sophia_travel',
      displayName: 'Sophia Laurent',
      avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80',
      isVerified: true,
    },
    imageUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&auto=format&fit=crop&q=80',
    caption: 'Early sunrise mist over the alpine peaks. Woke up at 4:30 AM for this hike and it was worth every single step. 🏔️🌤️',
    tags: ['adventure', 'nature', 'alps'],
    location: 'Dolomites, Italy',
    likesCount: 890,
    commentsCount: 65,
    viewsCount: 3820,
    isLiked: false,
    isBookmarked: false,
    createdAt: new Date(Date.now() - 14 * 3600000).toISOString(),
  },
  {
    id: 'post_4',
    userId: 'user_3',
    user: {
      id: 'user_3',
      username: 'alex_design',
      displayName: 'Alex Rivers',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
      isVerified: false,
    },
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80',
    caption: 'Fluid typography experiments and organic curves. Balancing mathematical grid precision with emotional warmth. 🎨📐',
    tags: ['graphicdesign', 'generative', '3d'],
    location: 'Design Studio, Berlin',
    likesCount: 418,
    commentsCount: 19,
    viewsCount: 1640,
    isLiked: false,
    isBookmarked: false,
    createdAt: new Date(Date.now() - 24 * 3600000).toISOString(),
  }
];

const INITIAL_COMMENTS: Record<string, Comment[]> = {
  post_1: [
    {
      id: 'com_1',
      postId: 'post_1',
      userId: 'user_1',
      user: {
        id: 'user_1',
        username: 'azlan',
        displayName: 'Azlan Malik',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
      },
      text: 'The color grading on this is breathtaking! What lens did you shoot this with?',
      createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      likesCount: 12,
    },
    {
      id: 'com_2',
      postId: 'post_1',
      userId: 'user_3',
      user: {
        id: 'user_3',
        username: 'alex_design',
        displayName: 'Alex Rivers',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
      },
      text: 'Blade Runner vibes. Absolutely stunning composition.',
      createdAt: new Date(Date.now() - 1 * 3600000).toISOString(),
      likesCount: 4,
    }
  ]
};

const memoryStore: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {}
  return memoryStore[key] || null;
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {}
  memoryStore[key] = value;
}

function resolvePostLocationString(rawLocation: any, rawLocationData?: any): string | undefined {
  if (typeof rawLocation === 'string' && rawLocation.trim()) {
    return rawLocation.trim();
  }
  if (rawLocation && typeof rawLocation === 'object' && typeof rawLocation.name === 'string' && rawLocation.name.trim()) {
    return rawLocation.name.trim();
  }
  if (rawLocationData && typeof rawLocationData === 'object' && typeof rawLocationData.name === 'string' && rawLocationData.name.trim()) {
    return rawLocationData.name.trim();
  }
  return undefined;
}

function resolvePostLocationData(rawLocation: any, rawLocationData?: any): PostLocationData | undefined {
  if (rawLocationData && typeof rawLocationData === 'object' && typeof rawLocationData.name === 'string') {
    return {
      name: rawLocationData.name,
      ...(rawLocationData.placeId ? { placeId: String(rawLocationData.placeId) } : {}),
      ...(typeof rawLocationData.latitude === 'number' ? { latitude: rawLocationData.latitude } : {}),
      ...(typeof rawLocationData.longitude === 'number' ? { longitude: rawLocationData.longitude } : {}),
      ...(rawLocationData.country ? { country: String(rawLocationData.country) } : {}),
    };
  }
  if (rawLocation && typeof rawLocation === 'object' && typeof rawLocation.name === 'string') {
    return {
      name: rawLocation.name,
      ...(rawLocation.placeId ? { placeId: String(rawLocation.placeId) } : {}),
      ...(typeof rawLocation.latitude === 'number' ? { latitude: rawLocation.latitude } : {}),
      ...(typeof rawLocation.longitude === 'number' ? { longitude: rawLocation.longitude } : {}),
      ...(rawLocation.country ? { country: String(rawLocation.country) } : {}),
    };
  }
  return undefined;
}

function getStoredPosts(): Post[] {
  try {
    const raw = safeGetItem(POSTS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to get posts from storage', e);
  }
  return INITIAL_POSTS;
}

function savePosts(posts: Post[]) {
  memoryCachedPosts = posts;
  try {
    safeSetItem(POSTS_STORAGE_KEY, JSON.stringify(posts));
  } catch (e) {
    console.error('Failed to save posts to storage', e);
  }
}

function getStoredComments(): Record<string, Comment[]> {
  try {
    const raw = safeGetItem(COMMENTS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to get comments from storage', e);
  }
  return INITIAL_COMMENTS;
}

function saveComments(comments: Record<string, Comment[]>) {
  try {
    safeSetItem(COMMENTS_STORAGE_KEY, JSON.stringify(comments));
  } catch (e) {
    console.error('Failed to save comments to storage', e);
  }
}

function isPostFromBlockedUser(post: Post): boolean {
  if (!post) return false;
  if (post.userId && isUserBlocked(post.userId)) return true;
  if (post.user?.id && isUserBlocked(post.user.id)) return true;
  if (post.originalAuthorId && isUserBlocked(post.originalAuthorId)) return true;
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('sogo_user_blocked', ((e: CustomEvent) => {
    const blockedId = e.detail?.blockedUserId;
    if (!blockedId) return;
    if (memoryCachedPosts) {
      memoryCachedPosts = memoryCachedPosts.filter((p) => !isPostFromBlockedUser(p));
    }
  }) as EventListener);
}

/**
 * Returns immediately available feed posts from in-memory cache or local storage.
 * Used for zero-latency initial UI rendering on screen mount.
 */
export function getCachedFeedPosts(): Post[] {
  let posts: Post[] = [];
  if (memoryCachedPosts && memoryCachedPosts.length > 0) {
    posts = memoryCachedPosts;
  } else {
    const stored = getStoredPosts();
    if (stored && stored.length > 0) {
      memoryCachedPosts = stored;
      posts = stored;
    }
  }
  return posts.filter((p) => !isPostFromBlockedUser(p));
}

/**
 * Shared helper to resolve a reference-based repost document into a hydrated Post item
 * without duplicating media in Firestore.
 * Safely returns null if the referenced original post or video was deleted or is invalid.
 */
async function resolveRepostDocument(
  docId: string,
  data: Record<string, any>,
  normalPostsMap?: Map<string, Post>,
  currentUid?: string
): Promise<Post | null> {
  const sharerUid = data.sharedByUid || data.userId || data.repostedBy?.id;
  const repostType = data.repostType === 'video' ? 'video' : 'post';
  if (!sharerUid || typeof sharerUid !== 'string') {
    return null;
  }

  const repostedBy = {
    id: sharerUid, // Always enforce the authenticated sharer's document UID
    username: data.repostedBy?.username || 'user',
    displayName: data.repostedBy?.displayName || 'User',
    avatarUrl: data.repostedBy?.avatarUrl || '',
    isVerified: Boolean(data.repostedBy?.isVerified),
  };

  if (repostType === 'post') {
    const origPostId = typeof data.originalPostId === 'string' ? data.originalPostId.trim() : '';
    if (!origPostId || origPostId.startsWith('repost_')) {
      return null;
    }

    // Resolve original post from batch map, memory cache, or Firestore/seed (0ms if cached)
    let origPost = normalPostsMap?.get(origPostId) || null;
    if (!origPost) {
      origPost = await getPostById(origPostId, false);
    }

    // If original post was deleted or is itself a repost, safely omit this repost
    if (!origPost || origPost.isRepost) {
      return null;
    }

    return {
      ...origPost,
      id: docId,
      isRepost: true,
      repostId: docId,
      repostType: 'post',
      originalPostId: origPost.id,
      originalAuthorId: origPost.userId,
      originalCreatedAt: origPost.createdAt,
      sharedByUid: sharerUid,
      repostedBy,
      userId: origPost.userId,
      user: origPost.user,
      isReposted: currentUid ? hasUserRepostedPostSync(origPost.id, currentUid) : origPost.isReposted,
      createdAt: data.createdAt || origPost.createdAt,
    };
  } else {
    const origVideoId = typeof data.originalVideoId === 'string' ? data.originalVideoId.trim() : '';
    if (!origVideoId || origVideoId.startsWith('repost_')) {
      return null;
    }

    const origVideo = await videosService.getVideoById(origVideoId, currentUid);
    // If original video was deleted or is invalid, safely omit this repost
    if (!origVideo || !origVideo.videoUrl) {
      return null;
    }

    return {
      id: docId,
      userId: origVideo.userId,
      user: origVideo.user,
      imageUrl: origVideo.thumbnailUrl || '',
      videoUrl: origVideo.videoUrl,
      thumbnailUrl: origVideo.thumbnailUrl,
      caption: origVideo.caption,
      tags: origVideo.tags || [],
      likesCount: origVideo.likesCount,
      commentsCount: origVideo.commentsCount,
      viewsCount: origVideo.viewsCount,
      repostsCount: origVideo.repostsCount || 0,
      isLiked: Boolean(origVideo.isLiked),
      isBookmarked: videosService.isVideoBookmarkedSync(origVideo.id),
      isReposted: currentUid ? hasUserRepostedVideoSync(origVideo.id, currentUid) : false,
      createdAt: data.createdAt || origVideo.createdAt,
      isRepost: true,
      repostId: docId,
      repostType: 'video',
      originalVideoId: origVideo.id,
      originalAuthorId: origVideo.userId,
      originalCreatedAt: origVideo.createdAt,
      sharedByUid: sharerUid,
      repostedBy,
    };
  }
}

// =========================================================
// AUTHORITATIVE POST COMMENT COUNTS
// The `commentsCount` field on a post document is never persisted by clients (Firestore rules only let
// non-owners change viewsCount/repostsCount), so it stays 0 for real posts. The comments subcollection
// (`posts/{id}/comments`) is the source of truth that the Post Detail screen displays, so the feed
// derives its count from it using a cheap server-side aggregation (no comment documents are downloaded).
// =========================================================

// Comments written locally whose Firestore write has not settled yet (prevents under/double counting races)
const pendingCommentWrites = new Map<string, Set<string>>();

function getPendingCommentCount(canonicalPostId: string): number {
  return pendingCommentWrites.get(canonicalPostId)?.size || 0;
}

/**
 * Returns the authoritative number of comments for an original post, or null if it cannot be determined.
 */
export async function getPostCommentCount(postId: string): Promise<number | null> {
  if (!postId || postCommentsSubcollectionDenied) return null;
  try {
    const snap = await getCountFromServer(collection(db, POSTS_COLLECTION, postId, 'comments'));
    return Math.max(0, Number(snap.data().count) || 0) + getPendingCommentCount(postId);
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code.includes('permission-denied')) {
      postCommentsSubcollectionDenied = true;
    }
    return null;
  }
}

/**
 * Writes an authoritative comment count into the in-memory + persisted feed cache for the original post
 * and every repost referencing it. Returns true when anything changed.
 */
export function setCachedPostCommentCount(postId: string, count: number): boolean {
  if (!postId || !Number.isFinite(count)) return false;
  const safeCount = Math.max(0, Math.floor(count));
  const posts = (memoryCachedPosts && memoryCachedPosts.length > 0) ? memoryCachedPosts : getStoredPosts();
  let changed = false;
  const updated = posts.map((p) => {
    if (p.repostType === 'video') return p;
    if ((p.id === postId || p.originalPostId === postId) && p.commentsCount !== safeCount) {
      changed = true;
      return { ...p, commentsCount: safeCount };
    }
    return p;
  });
  if (changed) savePosts(updated);
  return changed;
}

/**
 * Resolves authoritative comment counts for the Firestore-backed original posts in a feed
 * (one lightweight aggregation per unique original post, run in parallel).
 */
async function fetchFeedCommentCounts(items: Post[]): Promise<Map<string, number>> {
  const ids = new Set<string>();
  for (const p of items) {
    if (p.repostType === 'video') continue;
    const canonicalId = p.originalPostId || p.id;
    // Built-in sample posts are not Firestore documents; keep their sample data
    if (INITIAL_POSTS.some((seed) => seed.id === canonicalId)) continue;
    ids.add(canonicalId);
  }
  const results = new Map<string, number>();
  await Promise.all(
    Array.from(ids).map(async (id) => {
      const count = await getPostCommentCount(id);
      if (count !== null) results.set(id, count);
    })
  );
  return results;
}

function applyCommentCounts(items: Post[], counts: Map<string, number>): Post[] {
  if (counts.size === 0) return items;
  return items.map((p) => {
    if (p.repostType === 'video') return p;
    const count = counts.get(p.originalPostId || p.id);
    return count !== undefined && count !== p.commentsCount ? { ...p, commentsCount: count } : p;
  });
}

export async function getFeedPosts(forceRefresh = false): Promise<Post[]> {
  // If memory cache is fresh and not forcing refresh, return immediately
  if (!forceRefresh && memoryCachedPosts && memoryCachedPosts.length > 0) {
    const age = Date.now() - lastPostsFetchTimestamp;
    if (age < POSTS_CACHE_TTL_MS) {
      perf.mark('HOME', 'Serving feed from memory cache', { count: memoryCachedPosts.length, ageMs: age });
      return memoryCachedPosts;
    }
  }

  // Prevent duplicate simultaneous Firestore feed requests (e.g. rapid repeated Home taps)
  if (inFlightFeedPostsPromise) {
    return inFlightFeedPostsPromise;
  }

  inFlightFeedPostsPromise = (async (): Promise<Post[]> => {
    perf.start('HOME', 'Main Firestore feed query');
    try {
      const postsRef = collection(db, POSTS_COLLECTION);
      let snapshot;
      try {
        // 20 initial feed items (posts + reference reposts)
        const q = query(postsRef, orderBy('createdAt', 'desc'), limit(20));
        snapshot = await getDocs(q);
      } catch {
        // Fallback in case orderBy index is absent: retrieve and sort in memory
        snapshot = await getDocs(query(postsRef, limit(20)));
      }
      perf.end('HOME', 'Main Firestore feed query', { docsReturned: snapshot.docs.length });

      if (!snapshot.empty) {
        perf.start('HOME', 'Post metadata and user/profile merge');
        const stored = getStoredPosts();
        const storedMap = new Map(stored.map((p) => [p.id, p]));
        const currentUid = auth?.currentUser?.uid;

        // 1. First pass: parse normal posts and record confirmed repost IDs
        const normalPostsMap = new Map<string, Post>();
        const rawDocs = snapshot.docs;

        for (const d of rawDocs) {
          const data = d.data();
          if (data.isRepost) {
            confirmedRepostIds.add(d.id);
            continue;
          }

          const local = storedMap.get(d.id);
          const normalPost: Post = {
            id: d.id,
            userId: data.userId || '',
            user: data.user || {
              id: data.userId || '',
              username: 'creator',
              displayName: 'Creator',
              avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
            },
            imageUrl: data.imageUrl || '',
            videoUrl: data.videoUrl || undefined,
            caption: data.caption || '',
            tags: data.tags || [],
            location: resolvePostLocationString(data.location, data.locationData),
            locationData: resolvePostLocationData(data.location, data.locationData),
            likesCount: Math.max(Number(data.likesCount) || 0, local?.likesCount || 0),
            commentsCount: Math.max(Number(data.commentsCount) || 0, local?.commentsCount || 0),
            viewsCount: Math.max(0, Number(data.viewsCount) || 0, local?.viewsCount || 0),
            repostsCount: Math.max(0, Number(data.repostsCount) || 0, local?.repostsCount || 0),
            isLiked: local?.isLiked ?? false,
            isBookmarked: local?.isBookmarked ?? false,
            isReposted: currentUid ? hasUserRepostedPostSync(d.id, currentUid) : Boolean(local?.isReposted),
            createdAt: data.createdAt || new Date().toISOString(),
          };
          normalPostsMap.set(d.id, normalPost);
        }

        // 2. Second pass: resolve reference-based reposts in parallel without duplicating stored media
        const resolvedFeedItems = await Promise.all(
          rawDocs.map(async (d): Promise<Post | null> => {
            const data = d.data();
            if (!data.isRepost) {
              const p = normalPostsMap.get(d.id) || null;
              if (p && currentUid) {
                p.isReposted = hasUserRepostedPostSync(p.id, currentUid);
              }
              return p;
            }
            return resolveRepostDocument(d.id, data, normalPostsMap, currentUid);
          })
        );

        const validFirestoreItems = resolvedFeedItems.filter((item): item is Post => item !== null);

        // Sort by creation date descending
        validFirestoreItems.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        const firestoreIds = new Set(validFirestoreItems.map((p) => p.id));

        // Keep sample seed posts (post_1..post_4) that are not yet in Firestore
        const remainingSeed = INITIAL_POSTS.filter((p) => !firestoreIds.has(p.id)).map((seed) => {
          const local = storedMap.get(seed.id);
          const mergedSeed = local ? { ...seed, ...local } : seed;
          return {
            ...mergedSeed,
            isReposted: currentUid ? hasUserRepostedPostSync(seed.id, currentUid) : Boolean(mergedSeed.isReposted),
          };
        });

        const merged = [...validFirestoreItems, ...remainingSeed];
        merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Replace the (never persisted) stored counter with the authoritative comment count.
        // Wait briefly so the first paint is correct; slower results are applied when they arrive.
        const countsPromise = fetchFeedCommentCounts(merged);
        const earlyCounts = await Promise.race([
          countsPromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        const finalFeed = earlyCounts ? applyCommentCounts(merged, earlyCounts) : merged;

        memoryCachedPosts = finalFeed;
        lastPostsFetchTimestamp = Date.now();
        savePosts(finalFeed);

        if (!earlyCounts) {
          countsPromise
            .then((lateCounts) => {
              let changed = false;
              lateCounts.forEach((count, id) => {
                if (setCachedPostCommentCount(id, count)) changed = true;
              });
              if (changed && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('sogo_post_comment_counts_updated'));
              }
            })
            .catch(() => {});
        }

        perf.end('HOME', 'Post metadata and user/profile merge', { totalPosts: finalFeed.length });
        return finalFeed;
      }
    } catch (err) {
      console.warn('Failed to load posts from Firestore, using local cache', err);
    }

    const cached = getStoredPosts();
    memoryCachedPosts = cached;
    return cached;
  })();

  try {
    const rawFeed = await inFlightFeedPostsPromise;
    return rawFeed.filter((p) => !isPostFromBlockedUser(p));
  } finally {
    inFlightFeedPostsPromise = null;
  }
}

export async function getPostById(postId: string, skipMemoryCache = false): Promise<Post | null> {
  if (!postId || !postId.trim()) return null;
  const cleanId = postId.trim();
  const currentUid = auth?.currentUser?.uid;

  // 1. Check memory cache and localStorage cache first for 0ms retrieval
  if (!skipMemoryCache) {
    if (memoryCachedPosts) {
      const fromMem = memoryCachedPosts.find((p) => p.id === cleanId && !p.isRepost);
      if (fromMem) {
        if (isPostFromBlockedUser(fromMem)) return null;
        return {
          ...fromMem,
          isReposted: currentUid ? hasUserRepostedPostSync(cleanId, currentUid) : fromMem.isReposted,
        };
      }
    }
    const fromStored = getStoredPosts().find((p) => p.id === cleanId && !p.isRepost);
    if (fromStored) {
      if (isPostFromBlockedUser(fromStored)) return null;
      return {
        ...fromStored,
        isReposted: currentUid ? hasUserRepostedPostSync(cleanId, currentUid) : fromStored.isReposted,
      };
    }
  }

  try {
    const docRef = doc(db, POSTS_COLLECTION, cleanId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      // If someone looked up a repost document ID, resolve to the original post
      if (data.isRepost && data.originalPostId && data.originalPostId !== cleanId) {
        return getPostById(data.originalPostId, skipMemoryCache);
      }
      if (data.isRepost) {
        return null;
      }

      const local = getStoredPosts().find((p) => p.id === cleanId && !p.isRepost);
      const post: Post = {
        id: snap.id,
        userId: data.userId || '',
        user: data.user || {
          id: data.userId || '',
          username: 'user',
          displayName: 'User',
          avatarUrl: '',
        },
        imageUrl: data.imageUrl || '',
        videoUrl: data.videoUrl || undefined,
        caption: data.caption || '',
        tags: data.tags || [],
        location: resolvePostLocationString(data.location, data.locationData),
        locationData: resolvePostLocationData(data.location, data.locationData),
        likesCount: local?.likesCount ?? (Number(data.likesCount) || 0),
        commentsCount: local?.commentsCount ?? (Number(data.commentsCount) || 0),
        viewsCount: local?.viewsCount ?? (Number(data.viewsCount) || 0),
        repostsCount: local?.repostsCount ?? (Number(data.repostsCount) || 0),
        isLiked: local?.isLiked ?? false,
        isBookmarked: local?.isBookmarked ?? false,
        isReposted: currentUid ? hasUserRepostedPostSync(snap.id, currentUid) : Boolean(local?.isReposted),
        createdAt: data.createdAt || new Date().toISOString(),
      };
      if (isPostFromBlockedUser(post)) return null;
      return post;
    }

    // Document does not exist in Firestore: only return if it is one of the built-in seed posts
    const seedPost = INITIAL_POSTS.find((p) => p.id === cleanId);
    if (seedPost) {
      if (isPostFromBlockedUser(seedPost)) return null;
      const local = getStoredPosts().find((p) => p.id === cleanId && !p.isRepost);
      const merged = local ? { ...seedPost, ...local } : seedPost;
      if (isPostFromBlockedUser(merged)) return null;
      return {
        ...merged,
        isReposted: currentUid ? hasUserRepostedPostSync(cleanId, currentUid) : Boolean(merged.isReposted),
      };
    }
    return null;
  } catch (err) {
    console.warn('Failed to fetch post from Firestore, using cache', err);
    const posts = getStoredPosts();
    const found = posts.find((p) => p.id === cleanId && !p.isRepost) || INITIAL_POSTS.find((p) => p.id === cleanId) || null;
    if (found && isPostFromBlockedUser(found)) return null;
    return found;
  }
}

export async function getUserPosts(userId: string): Promise<Post[]> {
  if (!userId) return [];
  if (isUserBlocked(userId)) return [];
  const currentUid = auth?.currentUser?.uid;

  try {
    const postsRef = collection(db, POSTS_COLLECTION);
    // Single-field query returns both original posts (userId == userId) AND reference reposts (userId == userId)
    const q = query(postsRef, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    const stored = getStoredPosts();
    const storedMap = new Map(stored.map((p) => [p.id, p]));
    const normalPostsMap = new Map<string, Post>();

    // Populate normalPostsMap from local cache first so repost resolution is 0ms when cached
    for (const p of stored) {
      if (!p.isRepost) {
        normalPostsMap.set(p.id, p);
      }
    }

    for (const d of snapshot.docs) {
      const data = d.data();
      if (data.isRepost) {
        confirmedRepostIds.add(d.id);
        continue;
      }
      const local = storedMap.get(d.id);
      const normalPost: Post = {
        id: d.id,
        userId: data.userId || userId,
        user: data.user || {
          id: data.userId || userId,
          username: 'user',
          displayName: 'User',
          avatarUrl: '',
        },
        imageUrl: data.imageUrl || '',
        videoUrl: data.videoUrl || undefined,
        caption: data.caption || '',
        tags: data.tags || [],
        location: resolvePostLocationString(data.location, data.locationData),
        locationData: resolvePostLocationData(data.location, data.locationData),
        likesCount: Math.max(Number(data.likesCount) || 0, local?.likesCount || 0),
        commentsCount: Math.max(Number(data.commentsCount) || 0, local?.commentsCount || 0),
        viewsCount: Math.max(0, Number(data.viewsCount) || 0, local?.viewsCount || 0),
        repostsCount: Math.max(0, Number(data.repostsCount) || 0, local?.repostsCount || 0),
        isLiked: local?.isLiked ?? false,
        isBookmarked: local?.isBookmarked ?? false,
        isReposted: currentUid ? hasUserRepostedPostSync(d.id, currentUid) : Boolean(local?.isReposted),
        createdAt: data.createdAt || new Date().toISOString(),
      };
      normalPostsMap.set(d.id, normalPost);
    }

    // Resolve both original posts and reference-based reposts for the user's Profile timeline
    const resolvedItems = await Promise.all(
      snapshot.docs.map(async (d): Promise<Post | null> => {
        const data = d.data();
        if (!data.isRepost) {
          return normalPostsMap.get(d.id) || null;
        }
        return resolveRepostDocument(d.id, data, normalPostsMap, currentUid);
      })
    );

    const firestoreUserItems = resolvedItems.filter((item): item is Post => item !== null);
    const seenIds = new Set(firestoreUserItems.map((p) => p.id));

    // Also include any locally cached original posts or reposts by this user (e.g. seed posts or just-created reposts)
    for (const localItem of stored) {
      if (seenIds.has(localItem.id)) continue;
      const isUserOriginalPost =
        !localItem.isRepost &&
        (localItem.userId === userId || localItem.user?.id === userId || localItem.user?.username === userId);
      const isUserRepost =
        Boolean(localItem.isRepost) &&
        (localItem.sharedByUid === userId || localItem.repostedBy?.id === userId);

      if (isUserOriginalPost || isUserRepost) {
        seenIds.add(localItem.id);
        firestoreUserItems.push(localItem);
      }
    }

    // In-memory sort by createdAt descending so newest posts & reposts appear first on Profile
    firestoreUserItems.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return firestoreUserItems;
  } catch (err) {
    console.warn('Failed to query user posts from Firestore, checking local cache', err);
    const posts = getStoredPosts();
    return posts
      .filter((p) => {
        if (p.isRepost) {
          return p.sharedByUid === userId || p.repostedBy?.id === userId;
        }
        return p.userId === userId || p.user?.id === userId || p.user?.username === userId;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function getBookmarkedPosts(): Promise<Post[]> {
  const posts = getStoredPosts();
  const seen = new Set<string>();
  const bookmarked: Post[] = [];
  for (const p of posts) {
    if (!p.isBookmarked || p.repostType === 'video') continue;
    const canonicalId = p.originalPostId || p.id;
    if (!seen.has(canonicalId)) {
      seen.add(canonicalId);
      bookmarked.push(p.isRepost ? { ...p, id: canonicalId, isRepost: false } : p);
    }
  }

  // Include saved Reels using their canonical Reel/video ID so they appear in the Saved grid
  // and open directly in the Reels viewer when tapped (without duplicating any Firestore documents)
  const bookmarkedVideos = videosService.getBookmarkedVideosSync();
  for (const v of bookmarkedVideos) {
    if (!v || !v.id || !v.videoUrl) continue;
    if (!seen.has(v.id)) {
      seen.add(v.id);
      videosService.primeVideoInCache(v);
      const posterUrl = getOptimizedPosterUrl(v.thumbnailUrl, v.videoUrl) || v.thumbnailUrl || '';
      bookmarked.push({
        id: v.id,
        userId: v.userId,
        user: v.user,
        imageUrl: posterUrl,
        videoUrl: v.videoUrl,
        thumbnailUrl: posterUrl,
        caption: v.caption,
        tags: v.tags || [],
        likesCount: v.likesCount,
        commentsCount: v.commentsCount,
        viewsCount: v.viewsCount,
        repostsCount: v.repostsCount || 0,
        isLiked: Boolean(v.isLiked),
        isBookmarked: true,
        isReposted: Boolean(v.isReposted),
        createdAt: v.createdAt,
        isRepost: false,
        repostType: 'video',
        originalVideoId: v.id,
      });
    }
  }

  return bookmarked;
}

export async function createPost(
  newPostData: Omit<Post, 'id' | 'likesCount' | 'commentsCount' | 'createdAt'>,
  idempotencyKey?: string
): Promise<Post> {
  if (!newPostData.imageUrl || !newPostData.imageUrl.startsWith('https://')) {
    throw new Error('A valid uploaded image URL is required before publishing a post.');
  }

  const sanitizedKey = idempotencyKey
    ? idempotencyKey.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64)
    : '';
  const newPostId = sanitizedKey
    ? `post_${sanitizedKey}`
    : `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();

  // Ensure active Firebase Auth UID is aligned for Firestore security rules
  const activeUserId = auth?.currentUser?.uid || newPostData.userId;

  // Normalize and deduplicate tags
  const normalizedTags = Array.from(
    new Set(
      (newPostData.tags || [])
        .map((t) => String(t).replace(/#+/g, '').trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const normalizedLocation = newPostData.location?.trim() || undefined;
  const normalizedLocationData =
    newPostData.locationData && normalizedLocation
      ? {
          name: normalizedLocation,
          ...(newPostData.locationData.placeId ? { placeId: newPostData.locationData.placeId } : {}),
          ...(typeof newPostData.locationData.latitude === 'number'
            ? { latitude: newPostData.locationData.latitude }
            : {}),
          ...(typeof newPostData.locationData.longitude === 'number'
            ? { longitude: newPostData.locationData.longitude }
            : {}),
          ...(newPostData.locationData.country ? { country: newPostData.locationData.country } : {}),
        }
      : undefined;

  const created: Post = {
    ...newPostData,
    id: newPostId,
    userId: activeUserId,
    user: {
      ...newPostData.user,
      id: activeUserId,
    },
    tags: normalizedTags,
    location: normalizedLocation,
    locationData: normalizedLocationData,
    likesCount: 0,
    commentsCount: 0,
    viewsCount: 0,
    isLiked: false,
    isBookmarked: false,
    createdAt: nowIso,
  };

  const postPayload = {
    id: newPostId,
    userId: activeUserId,
    user: {
      id: activeUserId,
      username: created.user.username || 'user',
      displayName: created.user.displayName || 'User',
      avatarUrl: created.user.avatarUrl || '',
      isVerified: Boolean(created.user.isVerified),
    },
    imageUrl: created.imageUrl,
    caption: created.caption,
    tags: normalizedTags,
    location: normalizedLocation || null,
    ...(normalizedLocationData ? { locationData: normalizedLocationData } : {}),
    likesCount: 0,
    commentsCount: 0,
    viewsCount: 0,
    createdAt: nowIso,
  };

  // 1. Persist to Firestore server-side as source of truth (with 1 bounded retry for transient socket blips)
  const postRef = doc(db, POSTS_COLLECTION, newPostId);
  try {
    await setDoc(postRef, postPayload);
    console.log('[FIRESTORE_POST_SUCCESS] Saved post document:', newPostId);
  } catch (firstErr) {
    console.warn('[FIRESTORE_POST_RETRY] Retrying Firestore post write after error:', firstErr);
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await setDoc(postRef, postPayload);
      console.log('[FIRESTORE_POST_SUCCESS] Saved post document on retry:', newPostId);
    } catch (err) {
      console.error('[FIRESTORE_POST_ERROR] Could not save post to Firestore:', err);
      throw err;
    }
  }

  // 2. Save to local cache for instant UI rendering (deduplicated by ID)
  const posts = getStoredPosts().filter((p) => p.id !== newPostId);
  const updated = [created, ...posts];
  savePosts(updated);

  // Track Sogo Stars "Create 3 new Posts" mission (50 Stars) asynchronously
  recordSogoStarAction({
    userId: created.userId,
    missionId: 'create_posts',
    actionKey: newPostId,
  }).catch(() => {});

  return created;
}

export async function updatePost(
  postId: string,
  updates: { caption: string; tags?: string[]; location?: string }
): Promise<Post> {
  const posts = getStoredPosts();
  const existingIndex = posts.findIndex((p) => p.id === postId);
  
  if (existingIndex === -1) {
    throw new Error('Post not found');
  }

  const existing = posts[existingIndex];
  const updatedPost: Post = {
    ...existing,
    caption: updates.caption.trim(),
    ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
    ...(updates.location !== undefined ? { location: updates.location } : {}),
  };

  // 1. Update in Firestore
  try {
    const postRef = doc(db, POSTS_COLLECTION, postId);
    const docSnap = await getDoc(postRef);

    if (docSnap.exists()) {
      await updateDoc(postRef, {
        caption: updates.caption.trim(),
        ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
        ...(updates.location !== undefined ? { location: updates.location } : {}),
        updatedAt: new Date().toISOString(),
      });
    } else {
      // If it only existed in local initial seed, persist it as a real Firestore document
      await setDoc(postRef, {
        userId: updatedPost.userId,
        user: updatedPost.user,
        imageUrl: updatedPost.imageUrl,
        caption: updatedPost.caption,
        tags: updatedPost.tags || [],
        location: updatedPost.location || null,
        likesCount: updatedPost.likesCount,
        commentsCount: updatedPost.commentsCount,
        createdAt: updatedPost.createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Failed to update post in Firestore', err);
    throw err;
  }

  // 2. Update in local cache
  posts[existingIndex] = updatedPost;
  savePosts(posts);

  return updatedPost;
}

export async function toggleLikePost(
  postId: string,
  actorUser?: { id: string; username: string; displayName: string; avatarUrl: string } | null
): Promise<{ isLiked: boolean; likesCount: number }> {
  const posts = (memoryCachedPosts && memoryCachedPosts.length > 0)
    ? [...memoryCachedPosts]
    : getStoredPosts();
  const matchedEntry = posts.find((p) => p.id === postId || p.originalPostId === postId);
  const canonicalPostId = matchedEntry?.originalPostId || postId;

  let targetPost = posts.find((p) => p.id === canonicalPostId && !p.isRepost) || matchedEntry;

  const currentActorId = actorUser?.id || auth?.currentUser?.uid;

  // Determine next like state from the canonical post immediately without blocking on network reads
  const canonicalRef = targetPost;
  const likedUsers: string[] = (canonicalRef as any)?.likedUserIds || [];
  const userAlreadyLiked = currentActorId
    ? likedUsers.includes(currentActorId) || Boolean(canonicalRef?.isLiked && likedUsers.length === 0)
    : Boolean(canonicalRef?.isLiked);
  const nextLiked = !userAlreadyLiked;

  let nextLikedUsers = [...likedUsers];
  if (currentActorId) {
    if (nextLiked) {
      if (!nextLikedUsers.includes(currentActorId)) nextLikedUsers.push(currentActorId);
    } else {
      nextLikedUsers = nextLikedUsers.filter((uid) => uid !== currentActorId);
    }
  }

  const baseCount = canonicalRef?.likesCount ?? 0;
  const nextCount = nextLiked ? baseCount + 1 : Math.max(0, baseCount - 1);
  const result = { isLiked: nextLiked, likesCount: nextCount };

  // Synchronize both the original post and any reposts referencing it immediately
  const updated = posts.map((p) => {
    if (p.id === canonicalPostId || p.originalPostId === canonicalPostId) {
      return {
        ...p,
        isLiked: nextLiked,
        likesCount: nextCount,
        likedUserIds: nextLikedUsers,
      };
    }
    return p;
  });
  savePosts(updated);

  // Secondary notification work runs asynchronously in the background so UI updates in 0ms
  if (actorUser) {
    (async () => {
      let resolvedTarget = targetPost;
      if (!resolvedTarget) {
        resolvedTarget = (await getPostById(canonicalPostId).catch(() => null)) || undefined;
      }
      const postOwnerId = resolvedTarget?.userId || resolvedTarget?.user?.id;
      if (postOwnerId && postOwnerId !== actorUser.id) {
        if (result.isLiked) {
          await createNotification({
            recipientId: postOwnerId,
            actor: actorUser,
            type: 'like',
            postId: canonicalPostId,
            postImageUrl: resolvedTarget?.imageUrl,
          }).catch((err) => {
            console.warn('Could not dispatch post like notification:', err);
          });
        } else {
          await removeLikeNotification(canonicalPostId, actorUser.id).catch((err) => {
            console.warn('Could not remove post like notification:', err);
          });
        }
      }
    })().catch(() => {});
  }

  return result;
}

export async function toggleBookmarkVideo(
  videoId: string,
  knownVideo?: VideoPost
): Promise<boolean> {
  const nextBookmarked = await videosService.toggleBookmarkVideo(videoId, knownVideo);
  const posts = (memoryCachedPosts && memoryCachedPosts.length > 0)
    ? [...memoryCachedPosts]
    : getStoredPosts();
  if (posts.some((p) => p.originalVideoId === videoId)) {
    const updated = posts.map((p) =>
      p.originalVideoId === videoId ? { ...p, isBookmarked: nextBookmarked } : p
    );
    savePosts(updated);
  }
  return nextBookmarked;
}

export async function toggleBookmarkPost(postId: string): Promise<boolean> {
  const posts = (memoryCachedPosts && memoryCachedPosts.length > 0)
    ? [...memoryCachedPosts]
    : getStoredPosts();
  const matchedEntry = posts.find((p) => p.id === postId || p.originalPostId === postId);
  if (matchedEntry?.repostType === 'video' && matchedEntry.originalVideoId) {
    return toggleBookmarkVideo(matchedEntry.originalVideoId);
  }
  if (!matchedEntry && (videosService.isVideoBookmarkedSync(postId) || videosService.getPrimedVideo(postId))) {
    return toggleBookmarkVideo(postId);
  }
  const canonicalPostId = matchedEntry?.originalPostId || postId;

  const currentBookmarked = Boolean(matchedEntry?.isBookmarked);
  const nextBookmarked = !currentBookmarked;

  const updated = posts.map((p) => {
    if (p.id === canonicalPostId || p.originalPostId === canonicalPostId) {
      return {
        ...p,
        isBookmarked: nextBookmarked,
      };
    }
    return p;
  });
  savePosts(updated);
  return nextBookmarked;
}

let postCommentsSubcollectionDenied = false;

export async function getComments(postId: string): Promise<Comment[]> {
  const posts = (memoryCachedPosts && memoryCachedPosts.length > 0)
    ? memoryCachedPosts
    : getStoredPosts();
  const matched = posts.find((p) => p.id === postId);
  const canonicalPostId = matched?.originalPostId || postId;
  const allComments = getStoredComments();
  const localList = allComments[canonicalPostId] || [];

  if (!postCommentsSubcollectionDenied) {
    try {
      const commentsRef = collection(db, POSTS_COLLECTION, canonicalPostId, 'comments');
      const q = query(commentsRef, orderBy('createdAt', 'asc'));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const firestoreComments: Comment[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            postId: canonicalPostId,
            userId: data.userId || '',
            user: data.user || {
              id: data.userId || '',
              username: 'user',
              displayName: 'User',
              avatarUrl: '',
            },
            text: data.text || '',
            createdAt: data.createdAt || new Date().toISOString(),
            likesCount: Number(data.likesCount) || 0,
          };
        });

        const byId = new Map<string, Comment>();
        for (const c of localList) {
          byId.set(c.id, c);
        }
        for (const c of firestoreComments) {
          byId.set(c.id, c);
        }
        return Array.from(byId.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'permission-denied' || code.includes('permission-denied')) {
        postCommentsSubcollectionDenied = true;
      } else {
        console.warn('Failed to load post comments from Firestore, using local cache', err);
      }
    }
  }

  return localList;
}

export async function addComment(
  postId: string,
  user: Comment['user'],
  text: string
): Promise<Comment> {
  const cleanText = text.trim();
  const sanitizedUser: Comment['user'] = {
    id: user.id || auth?.currentUser?.uid || '',
    username: user.username || 'user',
    displayName: user.displayName || 'User',
    avatarUrl: user.avatarUrl || '',
    ...(user.isVerified !== undefined ? { isVerified: Boolean(user.isVerified) } : {}),
  };

  const posts = (memoryCachedPosts && memoryCachedPosts.length > 0)
    ? [...memoryCachedPosts]
    : getStoredPosts();
  const matched = posts.find((p) => p.id === postId || p.originalPostId === postId);
  const canonicalPostId = matched?.originalPostId || postId;

  const allComments = getStoredComments();
  const postComments = allComments[canonicalPostId] || [];
  const newComment: Comment = {
    id: `com_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    postId: canonicalPostId,
    userId: sanitizedUser.id,
    user: sanitizedUser,
    text: cleanText,
    createdAt: new Date().toISOString(),
    likesCount: 0,
  };
  allComments[canonicalPostId] = [...postComments, newComment];
  saveComments(allComments);

  // Update comment counter immediately on the original post and any reposts referencing it
  const targetPost = posts.find((p) => p.id === canonicalPostId && !p.isRepost) || matched;
  const updatedPosts = posts.map((p) => {
    if (p.id === canonicalPostId || p.originalPostId === canonicalPostId) {
      return { ...p, commentsCount: (Number(p.commentsCount) || 0) + 1 };
    }
    return p;
  });
  savePosts(updatedPosts);

  // Persist to Firestore & run Sogo Stars + notifications asynchronously without blocking UI
  (async () => {
    if (!postCommentsSubcollectionDenied) {
      let pending = pendingCommentWrites.get(canonicalPostId);
      if (!pending) {
        pending = new Set<string>();
        pendingCommentWrites.set(canonicalPostId, pending);
      }
      pending.add(newComment.id);
      try {
        const commentRef = doc(db, POSTS_COLLECTION, canonicalPostId, 'comments', newComment.id);
        await setDoc(commentRef, {
          id: newComment.id,
          postId: canonicalPostId,
          userId: sanitizedUser.id,
          user: sanitizedUser,
          text: cleanText,
          createdAt: newComment.createdAt,
          likesCount: 0,
        });
      } catch (err: any) {
        const code = String(err?.code || '');
        if (code === 'permission-denied' || code.includes('permission-denied')) {
          postCommentsSubcollectionDenied = true;
        }
      } finally {
        const stillPending = pendingCommentWrites.get(canonicalPostId);
        stillPending?.delete(newComment.id);
        if (stillPending && stillPending.size === 0) pendingCommentWrites.delete(canonicalPostId);
      }
    }

    let resolvedTarget = targetPost;
    if (!resolvedTarget) {
      resolvedTarget = (await getPostById(canonicalPostId).catch(() => null)) || undefined;
    }
    const postOwnerId = resolvedTarget?.userId || resolvedTarget?.user?.id;

    // Track Sogo Stars "Comment on 3 Posts" mission (50 Stars)
    if (cleanText.length > 0) {
      recordSogoStarAction({
        userId: sanitizedUser.id,
        missionId: 'comment_posts',
        actionKey: newComment.id,
        targetOwnerId: postOwnerId,
      }).catch(() => {});
    }

    if (postOwnerId && postOwnerId !== sanitizedUser.id) {
      createNotification({
        recipientId: postOwnerId,
        actor: sanitizedUser,
        type: 'comment',
        postId: canonicalPostId,
        postImageUrl: resolvedTarget?.imageUrl,
        text: cleanText,
      }).catch((err) => {
        console.warn('Could not dispatch post comment notification:', err);
      });
    }
  })().catch(() => {});

  return newComment;
}

export async function deletePost(postId: string): Promise<void> {
  // 1. Delete from Firestore if it exists in the database
  try {
    const postRef = doc(db, POSTS_COLLECTION, postId);
    const docSnap = await getDoc(postRef);
    if (docSnap.exists()) {
      await deleteDoc(postRef);
    }
  } catch (err) {
    console.error('Failed to delete post from Firestore', err);
    throw err;
  } finally {
    // 2. Remove the deleted post AND any reposts referencing it from local cache
    const posts = getStoredPosts();
    savePosts(posts.filter((p) => p.id !== postId && p.originalPostId !== postId));

    // 3. Remove any cached comments for this post
    try {
      const allComments = getStoredComments();
      if (allComments[postId]) {
        delete allComments[postId];
        saveComments(allComments);
      }
    } catch {}
  }
}

// In-memory set for session view deduplication (prevents multiple counts during single session/scrolling)
const sessionViewedPostIds = new Set<string>();

/**
 * Conservatively increments the view count for a feed post.
 * Always attaches views to the ORIGINAL post ID so reposts never split or duplicate view counts.
 */
export async function incrementPostViews(postId: string): Promise<number | null> {
  if (!postId) return null;
  const posts = getStoredPosts();
  const matched = posts.find((p) => p.id === postId);
  if (matched?.repostType === 'video') {
    return null; // Video views are tracked in the Reels viewer
  }
  const canonicalPostId = matched?.originalPostId || postId;

  if (!canonicalPostId || sessionViewedPostIds.has(canonicalPostId)) {
    return null; // Already counted during this session
  }
  sessionViewedPostIds.add(canonicalPostId);

  // 1. Optimistically update local cache for both original post and its reposts
  let newViewsCount = 1;
  const existing = posts.find((p) => p.id === canonicalPostId || p.originalPostId === canonicalPostId);
  if (existing) {
    newViewsCount = (existing.viewsCount || 0) + 1;
    const updated = posts.map((p) =>
      p.id === canonicalPostId || p.originalPostId === canonicalPostId
        ? { ...p, viewsCount: newViewsCount }
        : p
    );
    savePosts(updated);
  }

  // 2. Atomically increment on the ORIGINAL post in Firestore
  try {
    const postRef = doc(db, POSTS_COLLECTION, canonicalPostId);
    await updateDoc(postRef, {
      viewsCount: increment(1),
    });
  } catch (err) {
    console.debug('incrementPostViews note:', err);
  }

  return newViewsCount;
}

// =========================================================
// SOGO SOCIAL REPOST SYSTEM (Reference-Based, Zero Media Copy)
// =========================================================

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

// In-memory set of confirmed repost document IDs (and negative-checked IDs) for 0ms duplicate checks
const confirmedRepostIds = new Set<string>();
const checkedMissingRepostIds = new Set<string>();

/**
 * Synchronous 0ms check for whether the user has reposted a given post in memory or local cache.
 */
export function hasUserRepostedPostSync(originalPostId: string, userId?: string): boolean {
  if (!originalPostId || !userId) return false;
  const cleanPostId = originalPostId.trim();
  const repostId = `repost_post_${cleanPostId}_${userId}`;
  if (confirmedRepostIds.has(repostId)) return true;

  const cached = memoryCachedPosts || getStoredPosts();
  const found = cached.some((p) => p.id === repostId);
  if (found) {
    confirmedRepostIds.add(repostId);
  }
  return found;
}

/**
 * Synchronous 0ms check for whether the user has reposted a given Reel/video in memory or local cache.
 */
export function hasUserRepostedVideoSync(originalVideoId: string, userId?: string): boolean {
  if (!originalVideoId || !userId) return false;
  const cleanVideoId = originalVideoId.trim();
  const repostId = `repost_video_${cleanVideoId}_${userId}`;
  if (confirmedRepostIds.has(repostId)) return true;

  const cached = memoryCachedPosts || getStoredPosts();
  const found = cached.some((p) => p.id === repostId);
  if (found) {
    confirmedRepostIds.add(repostId);
  }
  return found;
}

/**
 * Checks whether a user has already reposted a given original post.
 */
export async function hasUserRepostedPost(originalPostId: string, userId: string): Promise<boolean> {
  if (!originalPostId || !userId) return false;
  const cleanPostId = originalPostId.trim();
  const repostId = `repost_post_${cleanPostId}_${userId}`;

  if (hasUserRepostedPostSync(cleanPostId, userId)) {
    return true;
  }
  if (checkedMissingRepostIds.has(repostId)) {
    return false;
  }

  try {
    const snap = await getDoc(doc(db, POSTS_COLLECTION, repostId));
    if (snap.exists()) {
      confirmedRepostIds.add(repostId);
      checkedMissingRepostIds.delete(repostId);
      return true;
    }
    checkedMissingRepostIds.add(repostId);
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks whether a user has already reposted a given original Reel/video.
 */
export async function hasUserRepostedVideo(originalVideoId: string, userId: string): Promise<boolean> {
  if (!originalVideoId || !userId) return false;
  const cleanVideoId = originalVideoId.trim();
  const repostId = `repost_video_${cleanVideoId}_${userId}`;

  if (hasUserRepostedVideoSync(cleanVideoId, userId)) {
    return true;
  }
  if (checkedMissingRepostIds.has(repostId)) {
    return false;
  }

  try {
    const snap = await getDoc(doc(db, POSTS_COLLECTION, repostId));
    if (snap.exists()) {
      confirmedRepostIds.add(repostId);
      checkedMissingRepostIds.delete(repostId);
      return true;
    }
    checkedMissingRepostIds.add(repostId);
    return false;
  } catch {
    return false;
  }
}

/**
 * Creates a reference-based Sogo timeline repost for an original Post.
 * - Never duplicates media (imageUrl / videoUrl are not written to the repost document)
 * - Enforces authenticated user identity
 * - Prevents malformed or cross-user references
 * - Prevents duplicate reposts via deterministic document ID
 * - Executes a single awaited Firestore setDoc on the critical path (eliminating sequential getDoc delays)
 * - Attaches repostsCount increment and notification to the original post & creator asynchronously
 */
export async function repostPostToSogo(
  postOrOriginalId: string,
  sharerUser: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'isVerified'>,
  knownPost?: Post
): Promise<Post> {
  perf.start('REPOST', 'repostPostToSogo', { targetId: postOrOriginalId });
  const activeUid = auth?.currentUser?.uid;
  if (!activeUid || !sharerUser?.id || activeUid !== sharerUser.id) {
    perf.end('REPOST', 'repostPostToSogo', { error: 'unauthenticated' });
    throw new Error('You must be signed in to share to Sogo.');
  }

  // Resolve to canonical original post ID in 0ms from knownPost or local cache
  const stored = memoryCachedPosts || getStoredPosts();
  const existingEntry =
    knownPost || stored.find((p) => p.id === postOrOriginalId || p.originalPostId === postOrOriginalId);
  const canonicalPostId = (
    knownPost?.originalPostId ||
    existingEntry?.originalPostId ||
    postOrOriginalId ||
    ''
  ).trim();

  if (!canonicalPostId || !VALID_ID_REGEX.test(canonicalPostId) || canonicalPostId.startsWith('repost_')) {
    perf.end('REPOST', 'repostPostToSogo', { error: 'invalid_id' });
    throw new Error('Invalid original post reference.');
  }

  const repostId = `repost_post_${canonicalPostId}_${activeUid}`;

  // Fast 0ms duplicate check before network write
  if (hasUserRepostedPostSync(canonicalPostId, activeUid)) {
    perf.end('REPOST', 'repostPostToSogo', { error: 'duplicate_sync' });
    throw new Error('You have already shared this post to your Sogo timeline.');
  }

  // Resolve original post from knownPost or memory/local cache first (0ms), falling back to Firestore only if uncached
  let originalPost: Post | null = null;
  if (knownPost && !knownPost.isRepost && knownPost.id === canonicalPostId) {
    originalPost = knownPost;
  } else if (knownPost && knownPost.isRepost && knownPost.originalPostId === canonicalPostId) {
    originalPost = {
      ...knownPost,
      id: canonicalPostId,
      isRepost: false,
      repostId: undefined,
      repostedBy: undefined,
      sharedByUid: undefined,
      createdAt: knownPost.originalCreatedAt || knownPost.createdAt,
    };
  } else {
    originalPost = await getPostById(canonicalPostId, false);
  }

  if (!originalPost || originalPost.isRepost) {
    perf.end('REPOST', 'repostPostToSogo', { error: 'original_not_found' });
    throw new Error('The original post could not be found or has been deleted.');
  }

  const originalAuthorId = originalPost.userId || originalPost.user?.id;
  if (!originalAuthorId || !VALID_ID_REGEX.test(originalAuthorId)) {
    perf.end('REPOST', 'repostPostToSogo', { error: 'invalid_author' });
    throw new Error('Original post author could not be verified.');
  }

  const nowIso = new Date().toISOString();
  const repostedBy = {
    id: activeUid,
    username: sharerUser.username || 'user',
    displayName: sharerUser.displayName || 'User',
    avatarUrl: sharerUser.avatarUrl || '',
    isVerified: Boolean(sharerUser.isVerified),
  };

  // 1. Write lightweight reference document to Firestore (NO media copy!) and AWAIT confirmation
  const repostRef = doc(db, POSTS_COLLECTION, repostId);
  perf.start('REPOST', 'Firestore setDoc repost reference', { repostId, canonicalPostId });
  try {
    await setDoc(repostRef, {
      id: repostId,
      repostId,
      isRepost: true,
      repostType: 'post',
      originalPostId: canonicalPostId,
      originalVideoId: null,
      originalAuthorId,
      sharedByUid: activeUid,
      userId: activeUid,
      repostedBy,
      createdAt: nowIso,
    });
    perf.end('REPOST', 'Firestore setDoc repost reference', { status: 'confirmed' });
  } catch (writeErr) {
    perf.end('REPOST', 'Firestore setDoc repost reference', { status: 'failed' });
    perf.end('REPOST', 'repostPostToSogo', { status: 'failed' });
    console.error('[REPOST_WRITE_ERROR] Failed to write repost reference to Firestore:', writeErr);
    throw writeErr;
  }

  // Record confirmed repost state
  confirmedRepostIds.add(repostId);
  checkedMissingRepostIds.delete(repostId);

  const nextRepostsCount = (originalPost.repostsCount || 0) + 1;

  // 2. Construct hydrated feed item referencing the original post
  const hydratedRepost: Post = {
    ...originalPost,
    id: repostId,
    isRepost: true,
    repostId,
    repostType: 'post',
    originalPostId: canonicalPostId,
    originalAuthorId,
    originalCreatedAt: originalPost.createdAt,
    sharedByUid: activeUid,
    repostedBy,
    userId: originalPost.userId,
    user: originalPost.user,
    repostsCount: nextRepostsCount,
    isReposted: true,
    createdAt: nowIso,
  };

  // 3. Prepend to local feed cache and update original post's repostsCount & isReposted
  const currentFeed = getStoredPosts().map((p) =>
    p.id === canonicalPostId || p.originalPostId === canonicalPostId
      ? { ...p, repostsCount: nextRepostsCount, isReposted: true }
      : p
  );
  const updatedFeed = [hydratedRepost, ...currentFeed.filter((p) => p.id !== repostId)];
  savePosts(updatedFeed);
  lastPostsFetchTimestamp = Date.now();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_repost_changed', {
        detail: { action: 'created', repost: hydratedRepost, originalPostId: canonicalPostId },
      })
    );
  }

  // 4. Non-blocking background updates: increment repostsCount on original post & notify original creator
  const origRef = doc(db, POSTS_COLLECTION, canonicalPostId);
  updateDoc(origRef, {
    repostsCount: increment(1),
  }).catch((err) => {
    console.debug('repostsCount background update note:', err);
  });

  if (originalAuthorId !== activeUid) {
    createNotification({
      recipientId: originalAuthorId,
      actor: {
        id: activeUid,
        username: repostedBy.username,
        displayName: repostedBy.displayName,
        avatarUrl: repostedBy.avatarUrl,
      },
      type: 'repost',
      postId: canonicalPostId,
      postImageUrl: originalPost.imageUrl,
    }).catch((err) => {
      console.warn('Could not dispatch repost notification:', err);
    });
  }

  perf.end('REPOST', 'repostPostToSogo', { repostId, status: 'success' });
  return hydratedRepost;
}

/**
 * Creates a reference-based Sogo timeline repost for an original Reel/video.
 * - References originalVideoId without duplicating Cloudinary video or thumbnail storage
 * - Enforces authenticated user identity
 * - Executes a single awaited Firestore setDoc on the critical path
 * - Tapping the resulting feed item opens the existing Reels viewer at that exact video
 */
export async function repostVideoToSogo(
  videoId: string,
  sharerUser: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'isVerified'>,
  knownVideo?: VideoPost
): Promise<Post> {
  perf.start('REPOST', 'repostVideoToSogo', { videoId });
  const activeUid = auth?.currentUser?.uid;
  if (!activeUid || !sharerUser?.id || activeUid !== sharerUser.id) {
    perf.end('REPOST', 'repostVideoToSogo', { error: 'unauthenticated' });
    throw new Error('You must be signed in to share Reels to Sogo.');
  }

  const cleanVideoId = (videoId || '').trim();
  if (!cleanVideoId || !VALID_ID_REGEX.test(cleanVideoId) || cleanVideoId.startsWith('repost_')) {
    perf.end('REPOST', 'repostVideoToSogo', { error: 'invalid_id' });
    throw new Error('Invalid original video reference.');
  }

  const repostId = `repost_video_${cleanVideoId}_${activeUid}`;

  // Fast 0ms duplicate check before network write
  if (hasUserRepostedVideoSync(cleanVideoId, activeUid)) {
    perf.end('REPOST', 'repostVideoToSogo', { error: 'duplicate_sync' });
    throw new Error('You have already shared this Reel to your Sogo timeline.');
  }

  // Resolve original video from knownVideo prop (0ms) or cache/Firestore
  const originalVideo =
    knownVideo && knownVideo.id === cleanVideoId && knownVideo.videoUrl
      ? knownVideo
      : await videosService.getVideoById(cleanVideoId, activeUid);

  if (!originalVideo || !originalVideo.videoUrl) {
    perf.end('REPOST', 'repostVideoToSogo', { error: 'original_not_found' });
    throw new Error('The original Reel could not be found or has been removed.');
  }

  const originalAuthorId = originalVideo.userId || originalVideo.user?.id;
  if (!originalAuthorId || !VALID_ID_REGEX.test(originalAuthorId)) {
    perf.end('REPOST', 'repostVideoToSogo', { error: 'invalid_author' });
    throw new Error('Original Reel creator could not be verified.');
  }

  const nowIso = new Date().toISOString();
  const repostedBy = {
    id: activeUid,
    username: sharerUser.username || 'user',
    displayName: sharerUser.displayName || 'User',
    avatarUrl: sharerUser.avatarUrl || '',
    isVerified: Boolean(sharerUser.isVerified),
  };

  // 1. Write lightweight reference document to Firestore (NO videoUrl/imageUrl duplication!) and AWAIT confirmation
  const repostRef = doc(db, POSTS_COLLECTION, repostId);
  perf.start('REPOST', 'Firestore setDoc video repost reference', { repostId, cleanVideoId });
  try {
    await setDoc(repostRef, {
      id: repostId,
      repostId,
      isRepost: true,
      repostType: 'video',
      originalPostId: null,
      originalVideoId: cleanVideoId,
      originalAuthorId,
      sharedByUid: activeUid,
      userId: activeUid,
      repostedBy,
      createdAt: nowIso,
    });
    perf.end('REPOST', 'Firestore setDoc video repost reference', { status: 'confirmed' });
  } catch (writeErr) {
    perf.end('REPOST', 'Firestore setDoc video repost reference', { status: 'failed' });
    perf.end('REPOST', 'repostVideoToSogo', { status: 'failed' });
    console.error('[REPOST_VIDEO_WRITE_ERROR] Failed to write video repost reference to Firestore:', writeErr);
    throw writeErr;
  }

  confirmedRepostIds.add(repostId);
  checkedMissingRepostIds.delete(repostId);

  const nextRepostsCount = (originalVideo.repostsCount || 0) + 1;
  videosService.updateCachedVideoReposts(cleanVideoId, 1, true);

  // 2. Construct hydrated feed item referencing the original video
  const hydratedVideoRepost: Post = {
    id: repostId,
    userId: originalVideo.userId,
    user: originalVideo.user,
    imageUrl: originalVideo.thumbnailUrl || '',
    videoUrl: originalVideo.videoUrl,
    thumbnailUrl: originalVideo.thumbnailUrl,
    caption: originalVideo.caption,
    tags: [],
    likesCount: originalVideo.likesCount,
    commentsCount: originalVideo.commentsCount,
    viewsCount: originalVideo.viewsCount,
    repostsCount: nextRepostsCount,
    isLiked: Boolean(originalVideo.isLiked),
    isBookmarked: videosService.isVideoBookmarkedSync(cleanVideoId),
    isReposted: true,
    createdAt: nowIso,
    isRepost: true,
    repostId,
    repostType: 'video',
    originalVideoId: cleanVideoId,
    originalAuthorId,
    originalCreatedAt: originalVideo.createdAt,
    sharedByUid: activeUid,
    repostedBy,
  };

  // 3. Prepend to local feed cache
  const currentFeed = getStoredPosts().map((p) =>
    p.originalVideoId === cleanVideoId ? { ...p, repostsCount: nextRepostsCount, isReposted: true } : p
  );
  const updatedFeed = [hydratedVideoRepost, ...currentFeed.filter((p) => p.id !== repostId)];
  savePosts(updatedFeed);
  lastPostsFetchTimestamp = Date.now();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_repost_changed', {
        detail: { action: 'created', repost: hydratedVideoRepost, originalVideoId: cleanVideoId },
      })
    );
  }

  // 4. Non-blocking background updates: increment repostsCount on original video & notify creator
  const videoRef = doc(db, VIDEOS_COLLECTION, cleanVideoId);
  updateDoc(videoRef, {
    repostsCount: increment(1),
  }).catch((err) => {
    console.debug('video repostsCount background update note:', err);
  });

  if (originalAuthorId !== activeUid) {
    createNotification({
      recipientUserId: originalAuthorId,
      actor: {
        id: activeUid,
        username: repostedBy.username,
        displayName: repostedBy.displayName,
        avatarUrl: repostedBy.avatarUrl,
      },
      type: 'video_repost',
      videoId: cleanVideoId,
      postImageUrl: originalVideo.thumbnailUrl,
    }).catch((err) => {
      console.warn('Could not dispatch video repost notification:', err);
    });
  }

  perf.end('REPOST', 'repostVideoToSogo', { repostId, status: 'success' });
  return hydratedVideoRepost;
}

/**
 * Removes a user's own repost from their Sogo timeline and decrements repostsCount on the original item.
 */
export async function removeRepostFromSogo(repostId: string): Promise<void> {
  const activeUid = auth?.currentUser?.uid;
  if (!activeUid) {
    throw new Error('You must be signed in to remove a repost.');
  }

  const cleanId = (repostId || '').trim();
  if (!cleanId.startsWith('repost_') || !cleanId.endsWith(`_${activeUid}`)) {
    throw new Error('You can only remove your own reposts.');
  }

  // Extract target ID from cached item or deterministic ID pattern
  const cachedEntry = getStoredPosts().find((p) => p.id === cleanId);
  let originalPostId = cachedEntry?.originalPostId;
  let originalVideoId = cachedEntry?.originalVideoId;

  if (!originalPostId && cleanId.startsWith('repost_post_')) {
    originalPostId = cleanId.slice('repost_post_'.length, cleanId.length - (`_${activeUid}`).length);
  } else if (!originalVideoId && cleanId.startsWith('repost_video_')) {
    originalVideoId = cleanId.slice('repost_video_'.length, cleanId.length - (`_${activeUid}`).length);
  }

  const repostRef = doc(db, POSTS_COLLECTION, cleanId);
  await deleteDoc(repostRef);

  confirmedRepostIds.delete(cleanId);
  checkedMissingRepostIds.add(cleanId);

  const posts = getStoredPosts()
    .filter((p) => p.id !== cleanId)
    .map((p) => {
      if (originalPostId && (p.id === originalPostId || p.originalPostId === originalPostId)) {
        return { ...p, repostsCount: Math.max(0, (p.repostsCount || 1) - 1), isReposted: false };
      }
      if (originalVideoId && p.originalVideoId === originalVideoId) {
        return { ...p, repostsCount: Math.max(0, (p.repostsCount || 1) - 1), isReposted: false };
      }
      return p;
    });
  savePosts(posts);

  if (originalVideoId) {
    videosService.updateCachedVideoReposts(originalVideoId, -1, false);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_repost_changed', {
        detail: { action: 'removed', repostId: cleanId, originalPostId, originalVideoId },
      })
    );
  }

  // Background cleanup for counter & notification
  if (originalPostId) {
    const origRef = doc(db, POSTS_COLLECTION, originalPostId);
    updateDoc(origRef, { repostsCount: increment(-1) }).catch(() => {});
    removeRepostNotification(originalPostId, activeUid, false).catch(() => {});
  }

  if (originalVideoId) {
    const vidRef = doc(db, VIDEOS_COLLECTION, originalVideoId);
    updateDoc(vidRef, { repostsCount: increment(-1) }).catch(() => {});
    removeRepostNotification(originalVideoId, activeUid, true).catch(() => {});
  }
}

/**
 * Synchronizes an updated user profile (e.g. new Cloudinary avatarUrl or displayName)
 * across all cached posts, reposts, and comments, and updates the user's own Firestore posts in the background.
 */
export function syncUserProfileInPosts(
  userId: string,
  updates: { displayName?: string; avatarUrl?: string; username?: string }
): void {
  if (!userId) return;

  // 1. Update cached posts & reposts in memory and localStorage
  const posts = getStoredPosts();
  let changed = false;
  const updatedPosts = posts.map((p) => {
    let nextPost = p;

    if (p.user?.id === userId || (!p.isRepost && p.userId === userId)) {
      changed = true;
      nextPost = {
        ...nextPost,
        user: {
          ...nextPost.user,
          ...(updates.displayName ? { displayName: updates.displayName } : {}),
          ...(updates.avatarUrl ? { avatarUrl: updates.avatarUrl } : {}),
          ...(updates.username ? { username: updates.username } : {}),
        },
      };
    }

    if (p.repostedBy?.id === userId || p.sharedByUid === userId) {
      changed = true;
      nextPost = {
        ...nextPost,
        repostedBy: nextPost.repostedBy
          ? {
              ...nextPost.repostedBy,
              ...(updates.displayName ? { displayName: updates.displayName } : {}),
              ...(updates.avatarUrl ? { avatarUrl: updates.avatarUrl } : {}),
              ...(updates.username ? { username: updates.username } : {}),
            }
          : nextPost.repostedBy,
      };
    }

    return nextPost;
  });

  if (changed) {
    savePosts(updatedPosts);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sogo_repost_changed'));
    }
  }

  // 2. Update cached comments in localStorage
  const commentsMap = getStoredComments();
  let commentsChanged = false;
  for (const postId of Object.keys(commentsMap)) {
    const list = commentsMap[postId];
    if (Array.isArray(list)) {
      commentsMap[postId] = list.map((c) => {
        if (c.user?.id === userId || c.userId === userId) {
          commentsChanged = true;
          return {
            ...c,
            user: {
              ...c.user,
              ...(updates.displayName ? { displayName: updates.displayName } : {}),
              ...(updates.avatarUrl ? { avatarUrl: updates.avatarUrl } : {}),
              ...(updates.username ? { username: updates.username } : {}),
            },
          };
        }
        return c;
      });
    }
  }
  if (commentsChanged) {
    saveComments(commentsMap);
  }

  // 3. Background Firestore update for the user's own authored posts
  if (db && auth?.currentUser?.uid === userId) {
    const q = query(collection(db, POSTS_COLLECTION), where('userId', '==', userId), limit(30));
    getDocs(q)
      .then((snap) => {
        snap.docs.forEach((docSnap) => {
          const d = docSnap.data();
          if (!d.isRepost && d.user) {
            updateDoc(doc(db, POSTS_COLLECTION, docSnap.id), {
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
      syncUserProfileInPosts(customEvent.detail.userId, {
        displayName: customEvent.detail.displayName || customEvent.detail.user?.displayName,
        avatarUrl: customEvent.detail.avatarUrl || customEvent.detail.user?.avatarUrl,
        username: customEvent.detail.user?.username,
      });
    }
  });
}

