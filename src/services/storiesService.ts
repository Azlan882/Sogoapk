import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Story } from '../types';
import {
  getStoryMediaUrl,
  resolveStoryPreviewUrl,
  isStoryVideoMedia,
  preloadStoryImage,
  registerInstantStoryPreview,
} from '../lib/utils';

// Primary Firestore collection for Stories
export const STORIES_COLLECTION = 'stories';
// Secondary storage path supported by existing deployed cloud security rules on sogo-e5ea9
export const STORIES_BACKUP_COLLECTION = 'videos';

// Exact 24-hour Story lifetime in milliseconds
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

// Maximum clock skew tolerance (5 minutes) in case server clock is slightly ahead of device clock
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

const STORIES_CACHE_KEY = 'sogo_stories_cache_v2';
const LEGACY_STORIES_CACHE_KEY = 'sogo_stories_cache';
const SEEN_STORIES_STORAGE_KEY = 'sogo_seen_stories_v1';

// Legacy demo IDs that must never be treated as real user stories
const LEGACY_MOCK_STORY_IDS = new Set(['story_1', 'story_2', 'story_3', 'story_4']);

// In-memory performance cache and session-confirmed story map
let memoryCachedStories: Story[] | null = null;
let lastRawStorageSnapshot: string | null = null;
let activeStoriesFetchPromise: Promise<Story[]> | null = null;
let lastFetchTimestampMs = 0;
const MIN_REFETCH_INTERVAL_MS = 2500;
const sessionConfirmedStories = new Map<string, Story>();

/**
 * Waits for Firebase Auth to finish restoring the user session on startup if supported.
 */
async function ensureAuthReady(): Promise<void> {
  if (auth && typeof (auth as any).authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {
      // Ignore authStateReady errors
    }
  }
}

/**
 * Parses a single raw timestamp candidate (Firestore Timestamp, {seconds, nanoseconds}, ISO string, or ms number)
 * into epoch milliseconds. Returns 0 if invalid.
 */
function parseRawTimestampCandidate(rawValue: any): number {
  if (!rawValue) return 0;

  // 1. Firestore Timestamp instance (.toMillis())
  if (typeof rawValue.toMillis === 'function') {
    try {
      const ms = rawValue.toMillis();
      if (Number.isFinite(ms) && ms > 0) return ms;
    } catch {
      // Fall through
    }
  }

  // 2. Serialized Firestore Timestamp ({ seconds, nanoseconds } or { _seconds, _nanoseconds })
  const seconds = rawValue.seconds ?? rawValue._seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    const nanos = Number(rawValue.nanoseconds ?? rawValue._nanoseconds ?? 0);
    const ms = seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1_000_000);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }

  // 3. ISO 8601 string or numeric string
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    const parsed = Date.parse(rawValue);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    const asNum = Number(rawValue);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
  }

  // 4. Direct numeric epoch ms
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }

  return 0;
}

/**
 * Extracts the authoritative creation timestamp (in epoch milliseconds) from a Story document or object.
 * Prioritizes server-generated Firestore Timestamps (storyCreatedAt / createdAt), then falls back to
 * explicit createdAtMs / createdAtIso fields.
 */
export function getStoryCreatedAtMs(storyOrData: any): number {
  if (!storyOrData || typeof storyOrData !== 'object') return 0;

  // 1. Check authoritative server timestamp fields first
  const fromStoryCreatedAt = parseRawTimestampCandidate(storyOrData.storyCreatedAt);
  if (fromStoryCreatedAt > 0) return fromStoryCreatedAt;

  const fromCreatedAt = parseRawTimestampCandidate(storyOrData.createdAt);
  if (fromCreatedAt > 0) return fromCreatedAt;

  // 2. Fallback to explicit createdAtMs field
  const fromCreatedAtMs = parseRawTimestampCandidate(storyOrData.createdAtMs);
  if (fromCreatedAtMs > 0) return fromCreatedAtMs;

  // 3. Fallback to explicit createdAtIso field
  const fromCreatedAtIso = parseRawTimestampCandidate(storyOrData.createdAtIso);
  if (fromCreatedAtIso > 0) return fromCreatedAtIso;

  return 0;
}

/**
 * Computes the authoritative expiration timestamp (in epoch milliseconds) for a Story.
 * A Story always expires exactly 24 hours after its original creation timestamp.
 */
export function getStoryExpiresAtMs(storyOrData: any): number {
  const createdMs = getStoryCreatedAtMs(storyOrData);
  if (!createdMs || createdMs <= 0) return 0;
  return createdMs + STORY_LIFETIME_MS;
}

/**
 * Determines whether a Story is currently active (created within the last 24 hours).
 * Strictly uses the Story's authoritative creation timestamp.
 */
export function isStoryActive(storyOrData: any, nowMs: number = Date.now()): boolean {
  if (!storyOrData || typeof storyOrData !== 'object') return false;
  if (storyOrData.id && LEGACY_MOCK_STORY_IDS.has(String(storyOrData.id))) return false;
  if (storyOrData.isNotification) return false;

  const createdMs = getStoryCreatedAtMs(storyOrData);
  if (!createdMs || createdMs <= 0) return false;

  // Guard against corrupted far-future timestamps while allowing minor server/device clock skew
  if (createdMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) return false;

  const expiresMs = createdMs + STORY_LIFETIME_MS;
  return nowMs < expiresMs;
}

function getSeenStoryIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_STORIES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string'));
    }
  } catch {
    // Ignore storage read errors
  }
  return new Set();
}

function saveSeenStoryId(storyId: string): void {
  try {
    const seen = getSeenStoryIds();
    seen.add(storyId);
    // Keep at most 200 recent seen story IDs
    const trimmed = Array.from(seen).slice(-200);
    localStorage.setItem(SEEN_STORIES_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Normalizes and filters a list of raw stories:
 * - Excludes any expired stories (>= 24 hours old) or legacy mock stories
 * - Resolves mediaUrl and thumbnailUrl in O(1) using an in-memory Map
 * - Sorts newest-first by authoritative creation timestamp
 */
function hydrateActiveStoriesList(rawStories: any[], nowMs: number = Date.now()): Story[] {
  if (!Array.isArray(rawStories) || rawStories.length === 0) return [];

  const seenIds = getSeenStoryIds();

  // Build an O(1) lookup Map by story ID so shared/referenced stories never trigger O(N^2) scans
  const storyMap = new Map<string, Story>();
  for (const s of rawStories) {
    if (s && s.id && !LEGACY_MOCK_STORY_IDS.has(String(s.id))) {
      storyMap.set(String(s.id), s as Story);
    }
  }

  const activeList: Story[] = [];
  const seenOutputIds = new Set<string>();

  for (const raw of rawStories) {
    if (!raw || !raw.id) continue;
    const storyId = String(raw.id);
    if (seenOutputIds.has(storyId) || LEGACY_MOCK_STORY_IDS.has(storyId)) continue;

    if (!isStoryActive(raw, nowMs)) continue;

    const createdMs = getStoryCreatedAtMs(raw);
    if (!createdMs) continue;
    const expiresMs = createdMs + STORY_LIFETIME_MS;

    const resolvedMediaUrl = getStoryMediaUrl(raw, storyMap);
    const resolvedPreviewUrl = resolveStoryPreviewUrl(raw, storyMap);
    const finalMediaUrl = resolvedMediaUrl || raw.mediaUrl || '';
    if (!finalMediaUrl) continue;

    const finalThumbnailUrl = resolvedPreviewUrl || raw.thumbnailUrl || undefined;

    // Warm thumbnail image in browser memory cache
    if (finalThumbnailUrl) {
      preloadStoryImage(finalThumbnailUrl);
    } else if (finalMediaUrl) {
      preloadStoryImage(finalMediaUrl);
    }

    const userObj = raw.user && typeof raw.user === 'object' ? raw.user : {};
    const userId = String(raw.userId || raw.ownerId || raw.authorId || raw.uid || userObj.id || '');

    const normalizedStory: Story = {
      id: storyId,
      userId,
      user: {
        id: String(userObj.id || userId),
        username: String(userObj.username || 'user'),
        displayName: String(userObj.displayName || userObj.username || 'User'),
        avatarUrl: String(userObj.avatarUrl || ''),
      },
      mediaUrl: finalMediaUrl,
      thumbnailUrl: finalThumbnailUrl,
      mediaType:
        raw.mediaType ||
        (isStoryVideoMedia(finalMediaUrl, raw.mediaType) ? 'video' : 'image'),
      originalStoryId: raw.originalStoryId || raw.referencedStoryId || undefined,
      createdAt: new Date(createdMs).toISOString(),
      createdAtMs: createdMs,
      expiresAt: new Date(expiresMs).toISOString(),
      expiresAtMs: expiresMs,
      hasSeen: Boolean(raw.hasSeen || seenIds.has(storyId)),
    };

    seenOutputIds.add(storyId);
    activeList.push(normalizedStory);
  }

  // Sort newest stories first by authoritative creation timestamp
  activeList.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  return activeList;
}

function readLocalCache(nowMs: number = Date.now()): Story[] {
  try {
    const raw = localStorage.getItem(STORIES_CACHE_KEY);
    if (memoryCachedStories && raw === lastRawStorageSnapshot) {
      const filtered = memoryCachedStories.filter((s) => isStoryActive(s, nowMs));
      if (filtered.length !== memoryCachedStories.length) {
        memoryCachedStories = filtered;
      }
      return memoryCachedStories;
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        lastRawStorageSnapshot = raw;
        memoryCachedStories = hydrateActiveStoriesList(parsed, nowMs);
        return memoryCachedStories;
      }
    }

    // Fallback: if v2 cache key is not yet populated, check legacy cache key without deleting it yet
    const rawLegacy = localStorage.getItem(LEGACY_STORIES_CACHE_KEY);
    if (rawLegacy) {
      const parsedLegacy = JSON.parse(rawLegacy);
      if (Array.isArray(parsedLegacy)) {
        memoryCachedStories = hydrateActiveStoriesList(parsedLegacy, nowMs);
        return memoryCachedStories;
      }
    }
  } catch (e) {
    console.warn('Failed to parse stories cache from storage', e);
  }

  if (memoryCachedStories) {
    memoryCachedStories = memoryCachedStories.filter((s) => isStoryActive(s, nowMs));
    return memoryCachedStories;
  }

  return [];
}

function writeLocalCache(stories: Story[], nowMs: number = Date.now()): Story[] {
  const hydrated = hydrateActiveStoriesList(stories, nowMs);
  memoryCachedStories = hydrated;
  try {
    const serialized = JSON.stringify(hydrated);
    lastRawStorageSnapshot = serialized;
    localStorage.setItem(STORIES_CACHE_KEY, serialized);
  } catch (e) {
    console.warn('Failed to save stories cache to storage', e);
  }
  return hydrated;
}

/**
 * Fetches a single Story document by ID from either the primary or backup Firestore collection.
 */
async function fetchStoryDocDataById(storyId: string): Promise<Record<string, any> | null> {
  if (!storyId) return null;

  try {
    const primarySnap = await getDoc(doc(db, STORIES_COLLECTION, storyId));
    if (primarySnap.exists()) {
      return { ...primarySnap.data(), id: primarySnap.id };
    }
  } catch {
    // Proceed to backup collection if primary is restricted by cloud rules
  }

  try {
    const backupSnap = await getDoc(doc(db, STORIES_BACKUP_COLLECTION, storyId));
    if (backupSnap.exists()) {
      const data = backupSnap.data();
      if (data.isStory || data.mediaUrl || String(backupSnap.id).startsWith('story_')) {
        return { ...data, id: backupSnap.id };
      }
    }
  } catch {
    // Ignore read error
  }

  return null;
}

/**
 * Persists a Story payload to Firestore using both the primary `/stories` collection
 * and the backup `/videos` collection (for compatibility with live sogo-e5ea9 rules).
 */
async function persistStoryToFirestore(
  storyId: string,
  primaryPayload: Record<string, any>,
  backupPayload: Record<string, any>
): Promise<void> {
  let wrotePrimary = false;
  let primaryError: unknown = null;

  // 1. Primary write: Attempt /stories/{storyId}
  try {
    const primaryRef = doc(db, STORIES_COLLECTION, storyId);
    await setDoc(primaryRef, primaryPayload);
    wrotePrimary = true;
  } catch (err) {
    primaryError = err;
  }

  // 2. Backup write: Persist to /videos/{storyId} where live sogo-e5ea9 rules permit authenticated owner writes
  let wroteBackup = false;
  let backupError: unknown = null;
  try {
    const backupRef = doc(db, STORIES_BACKUP_COLLECTION, storyId);
    await setDoc(backupRef, backupPayload);
    wroteBackup = true;
  } catch (err) {
    backupError = err;
  }

  if (!wrotePrimary && !wroteBackup) {
    throw backupError || primaryError || new Error('Could not save story to Firestore.');
  }
}

/**
 * One-time migration helper: if an existing installation has real user-created stories
 * in the legacy local-only key ('sogo_stories_cache') that are still within their 24h window,
 * backfill them to Firestore preserving their original creation timestamp.
 */
async function migrateLegacyLocalStoriesIfNeeded(nowMs: number): Promise<Story[]> {
  try {
    const rawLegacy = localStorage.getItem(LEGACY_STORIES_CACHE_KEY);
    if (!rawLegacy) return [];

    const parsed = JSON.parse(rawLegacy);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LEGACY_STORIES_CACHE_KEY);
      return [];
    }

    const validLegacy = hydrateActiveStoriesList(parsed, nowMs);
    if (validLegacy.length === 0) {
      localStorage.removeItem(LEGACY_STORIES_CACHE_KEY);
      return [];
    }

    const currentUid = auth?.currentUser?.uid;
    if (currentUid) {
      const ownStories = validLegacy.filter((s) => s.userId === currentUid);
      await Promise.all(
        ownStories.map(async (story) => {
          try {
            const createdMs = getStoryCreatedAtMs(story);
            if (!createdMs) return;
            const expiresMs = createdMs + STORY_LIFETIME_MS;
            const existing = await fetchStoryDocDataById(story.id);
            if (!existing) {
              const basePayload: Record<string, any> = {
                id: story.id,
                isStory: true,
                userId: currentUid,
                ownerId: currentUid,
                authorId: currentUid,
                uid: currentUid,
                user: {
                  ...story.user,
                  id: currentUid,
                },
                mediaUrl: story.mediaUrl,
                thumbnailUrl: story.thumbnailUrl || story.mediaUrl,
                mediaType: story.mediaType || 'image',
                type: story.mediaType || 'image',
                storyCreatedAt: Timestamp.fromMillis(createdMs),
                createdAtIso: new Date(createdMs).toISOString(),
                createdAtMs: createdMs,
                expiresAt: Timestamp.fromMillis(expiresMs),
                expiresAtIso: new Date(expiresMs).toISOString(),
                expiresAtMs: expiresMs,
              };
              if (story.originalStoryId) {
                basePayload.originalStoryId = story.originalStoryId;
              }
              await persistStoryToFirestore(
                story.id,
                { ...basePayload, createdAt: Timestamp.fromMillis(createdMs) },
                { ...basePayload, videoUrl: '' }
              );
            }
          } catch (err) {
            console.warn('Failed to backfill legacy story to Firestore:', err);
          }
        })
      );
      localStorage.removeItem(LEGACY_STORIES_CACHE_KEY);
    }

    return validLegacy;
  } catch {
    return [];
  }
}

/**
 * Returns locally cached active stories (< 24h old) for instant 0ms UI hydration while
 * the authoritative Firestore query runs in the background.
 */
export function getCachedStories(): Story[] {
  return readLocalCache(Date.now());
}

/**
 * Fetches active Stories (< 24 hours old from original creation time) authoritatively from Firestore.
 * Queries both primary `/stories` and backup `/videos` (where `storyCreatedAt >= cutoffTimestamp`),
 * deduplicating by ID and preserving original creation timestamps across app reinstalls.
 */
export async function getActiveStories(forceRefresh = false): Promise<Story[]> {
  const nowMs = Date.now();

  if (
    !forceRefresh &&
    memoryCachedStories &&
    nowMs - lastFetchTimestampMs < MIN_REFETCH_INTERVAL_MS
  ) {
    return memoryCachedStories.filter((s) => isStoryActive(s, nowMs));
  }

  if (activeStoriesFetchPromise) {
    return activeStoriesFetchPromise;
  }

  activeStoriesFetchPromise = (async () => {
    try {
      await ensureAuthReady();
      const currentNowMs = Date.now();
      const legacyMigrated = await migrateLegacyLocalStoriesIfNeeded(currentNowMs);
      const cutoffMs = currentNowMs - STORY_LIFETIME_MS;
      const cutoffTimestamp = Timestamp.fromMillis(cutoffMs);

      // 1. Query primary /stories collection (if permitted by deployed rules)
      const fetchPrimary = async (): Promise<any[]> => {
        if (!auth?.currentUser) return [];
        const storiesRef = collection(db, STORIES_COLLECTION);
        try {
          const activeQuery = query(
            storiesRef,
            where('createdAt', '>=', cutoffTimestamp),
            orderBy('createdAt', 'desc'),
            limit(50)
          );
          const snap = await getDocs(activeQuery);
          return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        } catch {
          try {
            const fallbackQuery = query(storiesRef, orderBy('createdAt', 'desc'), limit(50));
            const snap = await getDocs(fallbackQuery);
            return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
          } catch {
            return [];
          }
        }
      };

      // 2. Query backup /videos collection using single-field index on `storyCreatedAt`
      const fetchBackup = async (): Promise<any[]> => {
        const backupRef = collection(db, STORIES_BACKUP_COLLECTION);
        try {
          const activeBackupQuery = query(
            backupRef,
            where('storyCreatedAt', '>=', cutoffTimestamp),
            orderBy('storyCreatedAt', 'desc'),
            limit(50)
          );
          const snap = await getDocs(activeBackupQuery);
          return snap.docs
            .map((d) => ({ ...d.data(), id: d.id }))
            .filter(
              (item: any) =>
                !item.isNotification &&
                (item.isStory === true ||
                  Boolean(item.mediaUrl) ||
                  String(item.id).startsWith('story_'))
            );
        } catch {
          try {
            const fallbackBackupQuery = query(
              backupRef,
              where('isStory', '==', true),
              limit(50)
            );
            const snap = await getDocs(fallbackBackupQuery);
            return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
          } catch {
            return [];
          }
        }
      };

      const [primaryDocs, backupDocs] = await Promise.all([fetchPrimary(), fetchBackup()]);

      const rawFirestoreStories: any[] = [];
      const fetchedMap = new Map<string, any>();

      for (const docRecord of [...primaryDocs, ...backupDocs]) {
        if (!docRecord || !docRecord.id) continue;
        const docId = String(docRecord.id);
        if (fetchedMap.has(docId)) continue;
        if (isStoryActive(docRecord, currentNowMs)) {
          rawFirestoreStories.push(docRecord);
          fetchedMap.set(docId, docRecord);
        }
      }

      // Only if a shared/reposted story is missing its own mediaUrl and references an originalStoryId
      // not already in the batch, resolve the missing original story in parallel (bounded to max 5).
      const missingOriginalIds = new Set<string>();
      for (const item of rawFirestoreStories) {
        const refId = item.originalStoryId || item.referencedStoryId;
        if (refId && !item.mediaUrl && !fetchedMap.has(refId) && missingOriginalIds.size < 5) {
          missingOriginalIds.add(String(refId));
        }
      }

      if (missingOriginalIds.size > 0) {
        const originalRecords = await Promise.all(
          Array.from(missingOriginalIds).map((id) => fetchStoryDocDataById(id))
        );
        for (const origData of originalRecords) {
          if (origData && origData.id) {
            fetchedMap.set(String(origData.id), origData);
          }
        }
        // Attach resolved media onto any referencing story that lacked it
        for (const item of rawFirestoreStories) {
          const refId = item.originalStoryId || item.referencedStoryId;
          if (refId && !item.mediaUrl && fetchedMap.has(refId)) {
            const orig = fetchedMap.get(refId);
            item.mediaUrl = orig.mediaUrl || orig.imageUrl || orig.videoUrl || '';
            item.thumbnailUrl = item.thumbnailUrl || orig.thumbnailUrl || orig.previewUrl;
            item.mediaType = item.mediaType || orig.mediaType;
          }
        }
      }

      // Merge any session-confirmed stories and just-migrated stories if still active (< 24h old)
      const combined = [...rawFirestoreStories];
      sessionConfirmedStories.forEach((sessionStory, id) => {
        if (isStoryActive(sessionStory, currentNowMs)) {
          if (!fetchedMap.has(id)) {
            combined.push(sessionStory);
            fetchedMap.set(id, sessionStory);
          }
        } else {
          sessionConfirmedStories.delete(id);
        }
      });

      for (const migrated of legacyMigrated) {
        if (!fetchedMap.has(migrated.id) && isStoryActive(migrated, currentNowMs)) {
          combined.push(migrated);
          fetchedMap.set(migrated.id, migrated);
        }
      }

      lastFetchTimestampMs = Date.now();
      return writeLocalCache(combined, lastFetchTimestampMs);
    } catch (error) {
      console.warn('Failed to fetch active stories from Firestore, using valid cached stories:', error);
      return readLocalCache(Date.now());
    } finally {
      activeStoriesFetchPromise = null;
    }
  })();

  return activeStoriesFetchPromise;
}

/**
 * Creates a new Story in Firebase Firestore with an authoritative server creation timestamp
 * and 24-hour expiration window, and updates the local read-through cache.
 */
export async function createStory(
  user: Story['user'],
  mediaUrl: string,
  idempotencyKey?: string,
  options?: {
    thumbnailUrl?: string;
    mediaType?: 'image' | 'video';
    originalStoryId?: string;
    localPreviewUrl?: string;
  }
): Promise<Story> {
  if (!mediaUrl || !mediaUrl.startsWith('https://')) {
    throw new Error('A valid uploaded media URL is required before sharing a story.');
  }

  // Ensure Firebase Authentication has restored the active session before writing to Firestore
  await ensureAuthReady();

  const activeUid = auth?.currentUser?.uid || user?.id;
  if (!activeUid || !auth?.currentUser?.uid) {
    throw new Error('You must be signed in to share a story.');
  }

  const sanitizedKey = idempotencyKey
    ? idempotencyKey.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64)
    : '';
  const storyId = sanitizedKey
    ? `story_${sanitizedKey}`
    : `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Idempotency guard: if this exact story was already created in this session or local cache, return it without resetting createdAt
  const existingSession = sessionConfirmedStories.get(storyId);
  if (existingSession && isStoryActive(existingSession)) {
    return existingSession;
  }
  const existingCached = readLocalCache().find((s) => s.id === storyId);
  if (existingCached && isStoryActive(existingCached)) {
    return existingCached;
  }

  const detectedMediaType =
    options?.mediaType || (isStoryVideoMedia(mediaUrl) ? 'video' : 'image');
  const resolvedThumb =
    options?.thumbnailUrl ||
    resolveStoryPreviewUrl({
      mediaUrl,
      mediaType: detectedMediaType,
    });

  // Register instant session preview (if created from local file picker) so Story circle renders in 0ms
  // while Cloudinary's derived thumbnail warms in the background.
  if (options?.localPreviewUrl) {
    registerInstantStoryPreview(mediaUrl, options.localPreviewUrl);
    if (resolvedThumb) {
      registerInstantStoryPreview(resolvedThumb, options.localPreviewUrl);
    }
  }

  // Pre-warm both the optimized thumbnail and canonical mediaUrl in browser cache
  if (resolvedThumb) preloadStoryImage(resolvedThumb);
  preloadStoryImage(mediaUrl);

  const nowMs = Date.now();
  const expiresMs = nowMs + STORY_LIFETIME_MS;
  const createdIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(expiresMs).toISOString();

  // Strictly align all owner/user ID fields with the authenticated Firebase UID (request.auth.uid)
  const normalizedUser = {
    id: activeUid,
    username: user?.username || 'user',
    displayName: user?.displayName || user?.username || auth.currentUser?.displayName || 'User',
    avatarUrl: user?.avatarUrl || auth.currentUser?.photoURL || '',
  };

  const baseStoryFields: Record<string, any> = {
    id: storyId,
    isStory: true,
    userId: activeUid,
    ownerId: activeUid,
    authorId: activeUid,
    uid: activeUid,
    user: normalizedUser,
    mediaUrl,
    thumbnailUrl: resolvedThumb || mediaUrl,
    mediaType: detectedMediaType,
    type: detectedMediaType,
    storyCreatedAt: serverTimestamp(),
    createdAtIso: createdIso,
    createdAtMs: nowMs,
    expiresAt: Timestamp.fromMillis(expiresMs),
    expiresAtIso: expiresIso,
    expiresAtMs: expiresMs,
  };

  if (options?.originalStoryId) {
    baseStoryFields.originalStoryId = options.originalStoryId;
  }

  // Primary payload for `/stories/{storyId}` includes `createdAt: serverTimestamp()`
  const primaryPayload: Record<string, any> = {
    ...baseStoryFields,
    createdAt: serverTimestamp(),
  };

  // Backup payload for `/videos/{storyId}` uses `storyCreatedAt: serverTimestamp()` and `videoUrl: ''`
  // so it satisfies live sogo-e5ea9 rules while remaining invisible to `orderBy('createdAt')` video feed queries.
  const backupPayload: Record<string, any> = {
    ...baseStoryFields,
    videoUrl: '',
  };

  await persistStoryToFirestore(storyId, primaryPayload, backupPayload);

  const newStory: Story = {
    id: storyId,
    userId: activeUid,
    user: normalizedUser,
    mediaUrl,
    thumbnailUrl: resolvedThumb || undefined,
    mediaType: detectedMediaType,
    originalStoryId: options?.originalStoryId,
    createdAt: createdIso,
    createdAtMs: nowMs,
    expiresAt: expiresIso,
    expiresAtMs: expiresMs,
    hasSeen: false,
  };

  sessionConfirmedStories.set(storyId, newStory);
  const currentStories = readLocalCache(nowMs).filter((s) => s.id !== storyId);
  writeLocalCache([newStory, ...currentStories], nowMs);
  lastFetchTimestampMs = nowMs;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_story_created', {
        detail: { story: newStory },
      })
    );
  }

  return newStory;
}

export async function markStorySeen(storyId: string): Promise<void> {
  if (!storyId) return;
  saveSeenStoryId(storyId);
  const existingSession = sessionConfirmedStories.get(storyId);
  if (existingSession) {
    sessionConfirmedStories.set(storyId, { ...existingSession, hasSeen: true });
  }
  const stories = readLocalCache();
  const updated = stories.map((s) => (s.id === storyId ? { ...s, hasSeen: true } : s));
  writeLocalCache(updated);
}
