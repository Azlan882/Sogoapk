import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface BlockedUserRecord {
  blockedUserId: string;
  blockedUsername?: string;
  blockedDisplayName?: string;
  blockedAvatarUrl?: string;
  createdAt: string;
}

// In-memory cache for fast synchronous filtering in feeds & reels
let currentActiveUserId: string | null = null;
let blockedUserIds = new Set<string>();
let cachedBlockedRecords: BlockedUserRecord[] = [];
let unsubscribeListener: (() => void) | null = null;

const listeners = new Set<(blockedIds: Set<string>) => void>();

function getLocalStorageKey(userId: string): string {
  return `sogo_blocked_users_${userId}`;
}

function loadLocalBlocked(userId: string): BlockedUserRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getLocalStorageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveLocalBlocked(userId: string, records: BlockedUserRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getLocalStorageKey(userId), JSON.stringify(records));
  } catch {}
}

/**
 * Initializes the block service for the active user.
 * Loads synchronous cache from localStorage and listens to Firestore updates.
 */
export function initBlockService(userId?: string): void {
  const activeId = userId || auth.currentUser?.uid;
  if (!activeId) {
    if (unsubscribeListener) {
      unsubscribeListener();
      unsubscribeListener = null;
    }
    currentActiveUserId = null;
    blockedUserIds.clear();
    cachedBlockedRecords = [];
    return;
  }

  if (currentActiveUserId === activeId && unsubscribeListener) {
    return;
  }

  currentActiveUserId = activeId;

  // 1. Instant load from local storage
  cachedBlockedRecords = loadLocalBlocked(activeId);
  blockedUserIds = new Set(cachedBlockedRecords.map((r) => r.blockedUserId));

  // 2. Set up real-time listener from Firestore /users/{activeId}/blocked
  if (unsubscribeListener) {
    unsubscribeListener();
    unsubscribeListener = null;
  }

  try {
    const blockedColRef = collection(db, 'users', activeId, 'blocked');
    unsubscribeListener = onSnapshot(
      query(blockedColRef),
      (snapshot) => {
        const records: BlockedUserRecord[] = [];
        const newSet = new Set<string>();

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const rec: BlockedUserRecord = {
            blockedUserId: docSnap.id,
            blockedUsername: data.blockedUsername || '',
            blockedDisplayName: data.blockedDisplayName || '',
            blockedAvatarUrl: data.blockedAvatarUrl || '',
            createdAt: data.createdAt || new Date().toISOString(),
          };
          records.push(rec);
          newSet.add(rec.blockedUserId);
        });

        cachedBlockedRecords = records;
        blockedUserIds = newSet;
        saveLocalBlocked(activeId, records);

        // Notify subscribers
        listeners.forEach((listener) => listener(new Set(blockedUserIds)));
      },
      (error) => {
        console.warn('[BlockService] onSnapshot error:', error);
      }
    );
  } catch (err) {
    console.warn('[BlockService] init error:', err);
  }
}

/**
 * Check if a specific user ID is currently blocked.
 */
export function isUserBlocked(userId: string): boolean {
  if (!userId) return false;
  return blockedUserIds.has(userId);
}

/**
 * Returns an array of all blocked user IDs for synchronous feed filtering.
 */
export function getBlockedUserIds(): string[] {
  return Array.from(blockedUserIds);
}

/**
 * Returns a copy of the in-memory Set of blocked user IDs.
 */
export function getBlockedUserIdsSet(): Set<string> {
  return new Set(blockedUserIds);
}

/**
 * Fetches the full list of blocked user records.
 */
export async function getBlockedUsersList(): Promise<BlockedUserRecord[]> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return [];

  if (cachedBlockedRecords.length > 0) {
    return [...cachedBlockedRecords];
  }

  try {
    const blockedColRef = collection(db, 'users', currentUid, 'blocked');
    const snap = await getDocs(blockedColRef);
    const records: BlockedUserRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      records.push({
        blockedUserId: docSnap.id,
        blockedUsername: data.blockedUsername || '',
        blockedDisplayName: data.blockedDisplayName || '',
        blockedAvatarUrl: data.blockedAvatarUrl || '',
        createdAt: data.createdAt || new Date().toISOString(),
      });
    });
    cachedBlockedRecords = records;
    blockedUserIds = new Set(records.map((r) => r.blockedUserId));
    saveLocalBlocked(currentUid, records);
    return records;
  } catch (err) {
    console.warn('[BlockService] getBlockedUsersList error:', err);
    return [...cachedBlockedRecords];
  }
}

/**
 * Blocks a user. Saves to Firestore `/users/{currentUserId}/blocked/{targetUserId}`
 * and updates memory + localStorage caches immediately.
 */
export async function blockUser(
  targetUserId: string,
  targetUserData?: {
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }
): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) {
    throw new Error('You must be signed in to block users.');
  }

  if (targetUserId === currentUid) {
    throw new Error('You cannot block your own account.');
  }

  const cleanTargetId = (targetUserId || '').trim();
  if (!cleanTargetId) {
    throw new Error('Invalid user ID to block.');
  }

  const nowIso = new Date().toISOString();
  const record: BlockedUserRecord = {
    blockedUserId: cleanTargetId,
    blockedUsername: targetUserData?.username || '',
    blockedDisplayName: targetUserData?.displayName || '',
    blockedAvatarUrl: targetUserData?.avatarUrl || '',
    createdAt: nowIso,
  };

  // 1. Optimistic local update
  blockedUserIds.add(cleanTargetId);
  cachedBlockedRecords = cachedBlockedRecords.filter((r) => r.blockedUserId !== cleanTargetId);
  cachedBlockedRecords.push(record);
  saveLocalBlocked(currentUid, cachedBlockedRecords);

  // Notify memory listeners
  listeners.forEach((listener) => listener(new Set(blockedUserIds)));

  // Dispatch global window event for reactive feed pruning
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_user_blocked', {
        detail: { blockedUserId: cleanTargetId },
      })
    );
  }

  // 2. Persist to Firestore
  try {
    const docRef = doc(db, 'users', currentUid, 'blocked', cleanTargetId);
    await setDoc(docRef, record);
  } catch (err) {
    console.error('[BlockService] Failed to write block record to Firestore:', err);
    throw err;
  }
}

/**
 * Unblocks a user. Removes from Firestore and updates memory + local storage caches.
 */
export async function unblockUser(targetUserId: string): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) {
    throw new Error('You must be signed in to unblock users.');
  }

  const cleanTargetId = (targetUserId || '').trim();
  if (!cleanTargetId) return;

  // 1. Optimistic local update
  blockedUserIds.delete(cleanTargetId);
  cachedBlockedRecords = cachedBlockedRecords.filter((r) => r.blockedUserId !== cleanTargetId);
  saveLocalBlocked(currentUid, cachedBlockedRecords);

  listeners.forEach((listener) => listener(new Set(blockedUserIds)));

  // Dispatch global window event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_user_unblocked', {
        detail: { unblockedUserId: cleanTargetId },
      })
    );
  }

  // 2. Remove from Firestore
  try {
    const docRef = doc(db, 'users', currentUid, 'blocked', cleanTargetId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error('[BlockService] Failed to remove block record from Firestore:', err);
    throw err;
  }
}

/**
 * Subscribe to changes in the blocked users set.
 */
export function subscribeToBlockedUsers(callback: (blockedIds: Set<string>) => void): () => void {
  listeners.add(callback);
  callback(new Set(blockedUserIds));
  return () => {
    listeners.delete(callback);
  };
}
