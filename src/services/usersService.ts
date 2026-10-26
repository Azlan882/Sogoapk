import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  limit,
  arrayUnion,
  arrayRemove,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { updateProfile as updateFbProfile } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { User } from '../types';
import { createNotification, removeFollowNotification } from './notificationsService';
import { recordSogoStarAction } from './sogoStarsService';
import { isUserBlocked } from './blockService';

const USERS_STORAGE_KEY = 'sogo_users_cache';
const VERIFIED_USERS_CACHE_KEY = 'sogo_verified_users_map';

// In-memory authoritative map of user verification states loaded from Firestore /users
const authoritativeVerifiedByUid = new Map<string, boolean>();
const authoritativeVerifiedByUsername = new Map<string, boolean>();
let hasLoadedVerifiedCache = false;
let inFlightVerifySync: Promise<void> | null = null;
let lastVerifySyncMs = 0;

function ensureVerifiedCacheLoaded() {
  if (hasLoadedVerifiedCache) return;
  hasLoadedVerifiedCache = true;
  try {
    const raw = localStorage.getItem(VERIFIED_USERS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.byUid && typeof parsed.byUid === 'object') {
          Object.entries(parsed.byUid).forEach(([uid, val]) => {
            authoritativeVerifiedByUid.set(uid, Boolean(val));
          });
        }
        if (parsed.byUsername && typeof parsed.byUsername === 'object') {
          Object.entries(parsed.byUsername).forEach(([uname, val]) => {
            authoritativeVerifiedByUsername.set(uname.toLowerCase(), Boolean(val));
          });
        }
      }
    }
  } catch {}
}

function persistVerifiedCache() {
  try {
    const byUid: Record<string, boolean> = {};
    authoritativeVerifiedByUid.forEach((v, k) => {
      byUid[k] = v;
    });
    const byUsername: Record<string, boolean> = {};
    authoritativeVerifiedByUsername.forEach((v, k) => {
      byUsername[k] = v;
    });
    localStorage.setItem(VERIFIED_USERS_CACHE_KEY, JSON.stringify({ byUid, byUsername }));
  } catch {}
}

function recordAuthoritativeUserVerification(userId: string, isVerified: boolean, username?: string) {
  ensureVerifiedCacheLoaded();
  if (userId) {
    authoritativeVerifiedByUid.set(userId, Boolean(isVerified));
  }
  if (username) {
    authoritativeVerifiedByUsername.set(username.trim().toLowerCase(), Boolean(isVerified));
  }
}

/**
 * Resolves the authoritative verification status for any user across the app.
 * Prefers the authoritative Firestore /users state so granting or revoking a Blue Tick
 * immediately reflects on all existing Posts, Reels, Stories, Comments, and Notifications.
 */
export function resolveUserVerified(
  userId?: string,
  fallbackIsVerified?: boolean,
  username?: string
): boolean {
  ensureVerifiedCacheLoaded();
  if (userId && authoritativeVerifiedByUid.has(userId)) {
    return Boolean(authoritativeVerifiedByUid.get(userId));
  }
  if (username) {
    const cleanUname = username.trim().toLowerCase();
    if (authoritativeVerifiedByUsername.has(cleanUname)) {
      return Boolean(authoritativeVerifiedByUsername.get(cleanUname));
    }
  }
  return Boolean(fallbackIsVerified);
}

/**
 * Synchronizes authoritative verification status for all users from Firestore /users.
 * Throttled so multiple components mounting simultaneously share a single lightweight fetch.
 */
export async function syncVerifiedUsersFromFirestore(force = false): Promise<void> {
  ensureVerifiedCacheLoaded();
  if (!db) return;
  const now = Date.now();
  if (!force && now - lastVerifySyncMs < 15000 && authoritativeVerifiedByUid.size > 0) {
    return;
  }
  if (inFlightVerifySync) {
    return inFlightVerifySync;
  }

  inFlightVerifySync = (async () => {
    try {
      const snap = await getDocs(query(collection(db, 'users'), limit(100)));
      let changed = false;
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const uid = docSnap.id;
        const verified = Boolean(data.isVerified);
        const uname = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';

        if (authoritativeVerifiedByUid.get(uid) !== verified) {
          changed = true;
        }
        authoritativeVerifiedByUid.set(uid, verified);
        if (uname) {
          authoritativeVerifiedByUsername.set(uname, verified);
        }
      });
      lastVerifySyncMs = Date.now();
      persistVerifiedCache();

      if (changed && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sogo_verification_updated', { detail: {} }));
      }
    } catch (err) {
      console.warn('Could not sync verified users map from Firestore:', err);
    } finally {
      inFlightVerifySync = null;
    }
  })();

  return inFlightVerifySync;
}

/**
 * Immediately updates local caches and broadcasts verification state changes across the app
 * when an admin grants or removes a user's Blue Tick.
 */
export function applyLocalVerificationUpdate(
  targetUserId: string,
  isVerified: boolean,
  username?: string
): void {
  if (!targetUserId) return;
  recordAuthoritativeUserVerification(targetUserId, isVerified, username);
  persistVerifiedCache();

  // 1. Update sogo_profile_{uid}
  const localProfileKey = `sogo_profile_${targetUserId}`;
  try {
    const raw = localStorage.getItem(localProfileKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.isVerified = Boolean(isVerified);
      localStorage.setItem(localProfileKey, JSON.stringify(parsed));
    }
  } catch {}

  // 2. Update sogo_auth_user if target is current user
  try {
    const rawAuth = localStorage.getItem('sogo_auth_user');
    if (rawAuth) {
      const parsedAuth = JSON.parse(rawAuth);
      if (parsedAuth.id === targetUserId) {
        parsedAuth.isVerified = Boolean(isVerified);
        localStorage.setItem('sogo_auth_user', JSON.stringify(parsedAuth));
      }
    }
  } catch {}

  // 3. Update sogo_users_cache
  try {
    const users = getStoredUsers();
    const updated = users.map((u) =>
      u.id === targetUserId ? { ...u, isVerified: Boolean(isVerified) } : u
    );
    saveUsers(updated);
  } catch {}

  // 4. Broadcast reactive events for all mounted components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_verification_updated', {
        detail: { userId: targetUserId, username, isVerified: Boolean(isVerified) },
      })
    );
    window.dispatchEvent(
      new CustomEvent('sogo_profile_updated', {
        detail: {
          userId: targetUserId,
          isVerified: Boolean(isVerified),
          user: { isVerified: Boolean(isVerified) },
        },
      })
    );
  }
}

export const INITIAL_USERS: User[] = [
  {
    id: 'user_1',
    username: 'azlan',
    displayName: 'Azlan Malik',
    email: 'azlanmalik774@gmail.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
    bio: 'Software engineer, DevOps & product creator. Crafting modern visual experiences.',
    website: 'https://azlanmalik.com',
    followersCount: 1420,
    followingCount: 380,
    postsCount: 24,
    isFollowing: false,
    isVerified: false,
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
  },
  {
    id: 'user_2',
    username: 'maya_lens',
    displayName: 'Maya Chen',
    email: 'maya@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop&q=80',
    bio: 'Film photographer & visual poet. Chasing golden hour in Tokyo & SF.',
    website: 'https://mayachen.photo',
    followersCount: 8900,
    followingCount: 420,
    postsCount: 68,
    isFollowing: true,
    isVerified: false,
    createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
  },
  {
    id: 'user_3',
    username: 'alex_design',
    displayName: 'Alex Rivers',
    email: 'alex@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
    bio: 'Design systems lead & typography obsessive. Form follows emotion.',
    website: 'https://rivers.design',
    followersCount: 4320,
    followingCount: 512,
    postsCount: 39,
    isFollowing: false,
    isVerified: false,
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
  },
  {
    id: 'user_4',
    username: 'sophia_travel',
    displayName: 'Sophia Laurent',
    email: 'sophia@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80',
    bio: 'Wanderlust explorer ✈️ Traveling across 34 countries and counting.',
    followersCount: 12500,
    followingCount: 610,
    postsCount: 112,
    isFollowing: true,
    isVerified: false,
    createdAt: new Date(Date.now() - 200 * 86400000).toISOString(),
  },
  {
    id: 'user_5',
    username: 'kai_tokyo',
    displayName: 'Kai Sato',
    email: 'kai@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80',
    bio: 'Cyberpunk street scenes, night architecture and matcha latte aficionado.',
    followersCount: 6700,
    followingCount: 290,
    postsCount: 45,
    isFollowing: false,
    isVerified: false,
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
  }
];

function getStoredUsers(): User[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load users from localStorage', e);
  }
  return INITIAL_USERS;
}

function saveUsers(users: User[]) {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch (e) {
    console.error('Failed to save users to localStorage', e);
  }
}

export function getFollowingIds(actorId?: string): string[] {
  const currentActorId = actorId || auth?.currentUser?.uid;
  if (!currentActorId) return [];

  try {
    const raw = localStorage.getItem(`sogo_following_${currentActorId}`);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {}

  try {
    const cachedAuth = localStorage.getItem('sogo_auth_user');
    if (cachedAuth) {
      const u = JSON.parse(cachedAuth);
      if (u.id === currentActorId && Array.isArray(u.following)) {
        return u.following;
      }
    }
  } catch {}

  return [];
}

export function isFollowingUser(targetUserId: string, actorId?: string): boolean {
  if (!targetUserId) return false;
  const currentActorId = actorId || auth?.currentUser?.uid;
  if (!currentActorId || targetUserId === currentActorId) return false;

  const list = getFollowingIds(currentActorId);
  if (list.length > 0) {
    return list.includes(targetUserId);
  }

  const users = getStoredUsers();
  const target = users.find((u) => u.id === targetUserId);
  return Boolean(target?.isFollowing);
}

export async function getUser(userId: string, currentActorId?: string): Promise<User | null> {
  if (!userId) return null;
  const actorId = currentActorId || auth?.currentUser?.uid;

  // 1. Fetch user profile from Firestore by document ID (Firebase Auth UID)
  try {
    const userDocRef = doc(db, 'users', userId);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      const data = snap.data();
      const verified = Boolean(data.isVerified);
      const uname = data.username || data.displayName?.toLowerCase().replace(/\s+/g, '_') || 'user';
      recordAuthoritativeUserVerification(snap.id, verified, uname);
      persistVerifiedCache();

      const firestoreUser: User = {
        id: snap.id,
        username: uname,
        displayName: data.displayName || data.fullName || 'SogoSocial User',
        email: data.email || '',
        avatarUrl: data.avatarUrl || data.photoURL || data.profilePhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userId)}`,
        bio: data.bio || '',
        website: data.website || '',
        followersCount: Number(data.followersCount) || 0,
        followingCount: Number(data.followingCount) || 0,
        postsCount: Number(data.postsCount) || 0,
        birthday: data.birthday || '',
        isOnboarded: data.isOnboarded !== false,
        isFollowing: isFollowingUser(snap.id, actorId),
        following: Array.isArray(data.following) ? data.following : [],
        isVerified: verified,
        verifiedAt: data.verifiedAt || null,
        verifiedBy: data.verifiedBy || null,
        createdAt: data.createdAt || new Date().toISOString(),
      };
      return firestoreUser;
    }
  } catch (err) {
    console.warn('Could not fetch user document from Firestore:', err);
  }

  // 2. Query Firestore by username in case a username was provided
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '==', userId), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      const data = docSnap.data();
      const verified = Boolean(data.isVerified);
      recordAuthoritativeUserVerification(docSnap.id, verified, data.username);
      persistVerifiedCache();

      return {
        id: docSnap.id,
        username: data.username,
        displayName: data.displayName || data.fullName || 'SogoSocial User',
        email: data.email || '',
        avatarUrl: data.avatarUrl || data.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(docSnap.id)}`,
        bio: data.bio || '',
        website: data.website || '',
        followersCount: Number(data.followersCount) || 0,
        followingCount: Number(data.followingCount) || 0,
        postsCount: Number(data.postsCount) || 0,
        birthday: data.birthday || '',
        isOnboarded: data.isOnboarded !== false,
        isFollowing: isFollowingUser(docSnap.id, actorId),
        following: Array.isArray(data.following) ? data.following : [],
        isVerified: verified,
        verifiedAt: data.verifiedAt || null,
        verifiedBy: data.verifiedBy || null,
        createdAt: data.createdAt || new Date().toISOString(),
      };
    }
  } catch {}

  // 3. Fallback to local cache
  const users = getStoredUsers();
  const found = users.find((u) => u.id === userId || u.username === userId);
  if (found) {
    return {
      ...found,
      isFollowing: isFollowingUser(found.id, actorId),
      isVerified: resolveUserVerified(found.id, found.isVerified, found.username),
    };
  }
  return null;
}

export async function getSuggestedUsers(excludeUserId?: string, currentActorId?: string): Promise<User[]> {
  const actorId = currentActorId || excludeUserId || auth?.currentUser?.uid;

  // Query real registered users from Firestore
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, limit(50));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const allFirestoreUsers: User[] = snap.docs.map((d) => {
        const data = d.data();
        const verified = Boolean(data.isVerified);
        const uname = data.username || 'user';
        recordAuthoritativeUserVerification(d.id, verified, uname);
        return {
          id: d.id,
          username: uname,
          displayName: data.displayName || data.fullName || 'SogoSocial User',
          email: data.email || '',
          avatarUrl: data.avatarUrl || data.photoURL || '',
          bio: data.bio || '',
          website: data.website || '',
          followersCount: Number(data.followersCount) || 0,
          followingCount: Number(data.followingCount) || 0,
          postsCount: Number(data.postsCount) || 0,
          isOnboarded: true,
          isFollowing: isFollowingUser(d.id, actorId),
          following: Array.isArray(data.following) ? data.following : [],
          isVerified: verified,
          verifiedAt: data.verifiedAt || null,
          verifiedBy: data.verifiedBy || null,
          createdAt: data.createdAt || new Date().toISOString(),
        };
      });

      lastVerifySyncMs = Date.now();
      persistVerifiedCache();
      saveUsers(allFirestoreUsers);

      const filtered = allFirestoreUsers.filter((u) => u.id !== excludeUserId);
      if (filtered.length > 0) {
        return filtered;
      }
    }
  } catch (err) {
    console.warn('Could not fetch suggested users from Firestore:', err);
  }

  const users = getStoredUsers();
  return users
    .filter((u) => u.id !== excludeUserId)
    .map((u) => ({
      ...u,
      isFollowing: isFollowingUser(u.id, actorId),
      isVerified: resolveUserVerified(u.id, u.isVerified, u.username),
    }));
}

export async function searchUsers(searchQuery: string): Promise<User[]> {
  const trimmed = searchQuery.trim().toLowerCase();
  if (!trimmed) return [];
  const actorId = auth?.currentUser?.uid;

  try {
    const users = await getSuggestedUsers(undefined, actorId);
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(trimmed) ||
        u.displayName.toLowerCase().includes(trimmed) ||
        (u.bio && u.bio.toLowerCase().includes(trimmed))
    );
  } catch {
    const users = getStoredUsers();
    return users
      .filter(
        (u) =>
          u.username.toLowerCase().includes(trimmed) ||
          u.displayName.toLowerCase().includes(trimmed) ||
          (u.bio && u.bio.toLowerCase().includes(trimmed))
      )
      .map((u) => ({
        ...u,
        isVerified: resolveUserVerified(u.id, u.isVerified, u.username),
      }));
  }
}

// In-flight follow promises keyed by `${actorId}_${targetUserId}` to deduplicate rapid repeated taps
const inFlightFollowOps = new Map<string, Promise<boolean>>();

export async function toggleFollowUser(
  targetUserId: string,
  actorUser?: { id: string; username: string; displayName: string; avatarUrl: string } | null
): Promise<boolean> {
  const actorId = actorUser?.id || auth?.currentUser?.uid;
  if (!targetUserId || !actorId || targetUserId === actorId) {
    return false;
  }

  const opKey = `${actorId}_${targetUserId}`;
  // If an operation is already actively processing for this exact target, return the existing in-flight promise
  const existingOp = inFlightFollowOps.get(opKey);
  if (existingOp) {
    return existingOp;
  }

  const currentFollowing = getFollowingIds(actorId);
  const isCurrentlyFollowing = isFollowingUser(targetUserId, actorId);
  const newStatus = !isCurrentlyFollowing;

  if (newStatus && isUserBlocked(targetUserId)) {
    throw new Error('You cannot follow an account you have blocked. Please unblock them first.');
  }

  // 1. Calculate new following list for actor
  let updatedFollowing: string[];
  if (newStatus) {
    updatedFollowing = Array.from(new Set([...currentFollowing, targetUserId]));
  } else {
    updatedFollowing = currentFollowing.filter((id) => id !== targetUserId);
  }

  // 2. Persist locally immediately for instant responsive UX
  try {
    localStorage.setItem(`sogo_following_${actorId}`, JSON.stringify(updatedFollowing));
  } catch {}

  try {
    const cachedAuth = localStorage.getItem('sogo_auth_user');
    if (cachedAuth) {
      const u = JSON.parse(cachedAuth);
      if (u.id === actorId) {
        u.following = updatedFollowing;
        u.followingCount = updatedFollowing.length;
        localStorage.setItem('sogo_auth_user', JSON.stringify(u));
      }
    }
  } catch {}

  // 3. Update cached users list
  const users = getStoredUsers();
  const updatedUsers = users.map((u) => {
    if (u.id === targetUserId) {
      return {
        ...u,
        isFollowing: newStatus,
        followersCount: newStatus ? u.followersCount + 1 : Math.max(0, u.followersCount - 1),
      };
    }
    if (u.id === actorId) {
      return {
        ...u,
        followingCount: updatedFollowing.length,
        following: updatedFollowing,
      };
    }
    return u;
  });
  saveUsers(updatedUsers);

  // 4. Dispatch custom event so all active components in the app immediately react
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sogo_follow_changed', {
        detail: { targetUserId, isFollowing: newStatus, actorId },
      })
    );
  }

  // 5. Asynchronously persist to Firestore & dispatch notifications concurrently
  if (db && actorId) {
    const backgroundPersistPromise = (async () => {
      try {
        const writes: Promise<unknown>[] = [];

        // 5a. Actor user doc update
        const actorDocRef = doc(db, 'users', actorId);
        writes.push(
          updateDoc(actorDocRef, {
            following: newStatus ? arrayUnion(targetUserId) : arrayRemove(targetUserId),
            followingCount: increment(newStatus ? 1 : -1),
            updatedAt: serverTimestamp(),
          }).catch(async () => {
            // Fallback setDoc if actor doc does not exist yet
            try {
              await setDoc(
                actorDocRef,
                {
                  id: actorId,
                  following: updatedFollowing,
                  followingCount: updatedFollowing.length,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            } catch (innerErr) {
              console.warn('Could not update actor following array in Firestore:', innerErr);
            }
          })
        );

        // 5b. Subcollection: /users/{actorId}/following/{targetUserId}
        const followDocRef = doc(db, 'users', actorId, 'following', targetUserId);
        if (newStatus) {
          writes.push(
            setDoc(followDocRef, {
              targetUserId,
              actorUserId: actorId,
              createdAt: serverTimestamp(),
              followedAt: new Date().toISOString(),
            }).catch((err) => {
              console.warn('Could not update following subcollection:', err);
            })
          );
        } else {
          writes.push(
            deleteDoc(followDocRef).catch((err) => {
              console.warn('Could not delete from following subcollection:', err);
            })
          );
        }

        // 5c. Subcollection: /users/{targetUserId}/followers/{actorId}
        const followerDocRef = doc(db, 'users', targetUserId, 'followers', actorId);
        if (newStatus) {
          writes.push(
            setDoc(followerDocRef, {
              followerUserId: actorId,
              targetUserId,
              createdAt: serverTimestamp(),
              followedAt: new Date().toISOString(),
            }).catch((err) => {
              console.warn('Could not update followers subcollection:', err);
            })
          );
        } else {
          writes.push(
            deleteDoc(followerDocRef).catch((err) => {
              console.warn('Could not delete from followers subcollection:', err);
            })
          );
        }

        // 5d. Safely update target user followersCount
        const targetDocRef = doc(db, 'users', targetUserId);
        writes.push(
          updateDoc(targetDocRef, {
            followersCount: increment(newStatus ? 1 : -1),
          }).catch(() => {})
        );

        // Wait for Firestore document writes to finish in parallel
        await Promise.all(writes);

        // 6. Asynchronous Notification dispatch (non-blocking, fire-and-forget)
        if (actorUser && targetUserId && targetUserId !== actorId) {
          if (newStatus) {
            createNotification({
              recipientUserId: targetUserId,
              actor: actorUser,
              type: 'follow',
            }).catch((err) => {
              console.warn('Could not dispatch follow notification:', err);
            });
          } else {
            removeFollowNotification(targetUserId, actorId).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Error persisting follow status to Firestore:', err);
      } finally {
        inFlightFollowOps.delete(opKey);
      }
      return newStatus;
    })();

    inFlightFollowOps.set(opKey, backgroundPersistPromise);
  }

  // Track Sogo Stars "Follow 3 creators" mission (50 Stars) asynchronously when following a creator
  if (newStatus && actorId && targetUserId && actorId !== targetUserId) {
    recordSogoStarAction({
      userId: actorId,
      missionId: 'follow_creators',
      actionKey: targetUserId,
      targetOwnerId: targetUserId,
    }).catch(() => {});
  }

  return newStatus;
}

export async function updateUserProfile(userId: string, data: Partial<User>): Promise<User> {
  const currentAuthUid = auth?.currentUser?.uid || null;
  if (!currentAuthUid) {
    throw new Error('You must be signed in to update your profile.');
  }
  const targetUid = userId || currentAuthUid;
  if (targetUid !== currentAuthUid) {
    throw new Error('Unauthorized: You can only update your own profile.');
  }

  const cleanName = data.displayName !== undefined ? data.displayName.trim() : undefined;
  if (cleanName !== undefined && !cleanName) {
    throw new Error('Display Name cannot be empty.');
  }

  const cleanAvatar = data.avatarUrl !== undefined ? data.avatarUrl.trim() : undefined;
  if (cleanAvatar !== undefined && cleanAvatar.startsWith('data:')) {
    throw new Error('Base64 image data cannot be stored in Firestore. Please upload a valid image.');
  }

  // Security: Strip any verification or role fields from normal user profile updates
  const safeData: Partial<User> = { ...data };
  delete (safeData as any).isVerified;
  delete (safeData as any).verifiedAt;
  delete (safeData as any).verifiedBy;
  delete (safeData as any).isAdmin;
  delete (safeData as any).isSuspended;
  delete (safeData as any).isDisabled;

  // 1. Write canonical profile fields to Firestore users/{targetUid}
  // Never include isVerified, verifiedAt, or verifiedBy in client profile updates.
  if (db) {
    const firestorePayload: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };
    if (cleanName !== undefined) {
      firestorePayload.displayName = cleanName;
      firestorePayload.fullName = cleanName; // Backward compatibility alias
    }
    if (safeData.bio !== undefined) {
      firestorePayload.bio = safeData.bio.trim();
    }
    if (safeData.website !== undefined) {
      firestorePayload.website = safeData.website.trim();
    }
    if (cleanAvatar) {
      firestorePayload.avatarUrl = cleanAvatar;
      firestorePayload.photoURL = cleanAvatar;
      firestorePayload.profilePhoto = cleanAvatar;
    }

    try {
      await setDoc(doc(db, 'users', targetUid), firestorePayload, { merge: true });
    } catch (firestoreErr: any) {
      console.error('[PROFILE NAME SAVE] Firestore write failed:', {
        uid: targetUid,
        newName: cleanName,
        firestoreWrite: 'failed',
        error: firestoreErr?.message || firestoreErr,
      });
      const code = firestoreErr?.code || '';
      const msg = firestoreErr?.message || String(firestoreErr);
      if (code === 'permission-denied' || msg.includes('permission')) {
        throw new Error('Permission denied updating profile. Please ensure you are signed in.');
      }
      throw new Error(`Failed to save profile changes to database: ${msg}`);
    }
  }

  // 2. Synchronize Firebase Auth user profile if currentUser matches targetUid
  if (auth?.currentUser && auth.currentUser.uid === targetUid && (cleanName || cleanAvatar)) {
    try {
      await updateFbProfile(auth.currentUser, {
        ...(cleanName ? { displayName: cleanName } : {}),
        ...(cleanAvatar ? { photoURL: cleanAvatar } : {}),
      });
    } catch (fbAuthErr) {
      console.warn('Could not synchronize Firebase Auth profile:', fbAuthErr);
    }
  }

  // 3. Synchronize local profile cache (sogo_profile_{uid})
  const localProfileKey = `sogo_profile_${targetUid}`;
  let cachedProfile: Partial<User> = {};
  try {
    const raw = localStorage.getItem(localProfileKey);
    if (raw) cachedProfile = JSON.parse(raw);
  } catch {}

  const preservedIsVerified = resolveUserVerified(
    targetUid,
    cachedProfile.isVerified,
    cachedProfile.username
  );

  const mergedProfile: User = {
    id: targetUid,
    username: cachedProfile.username || 'user',
    displayName: cleanName ?? cachedProfile.displayName ?? 'SogoSocial User',
    avatarUrl:
      cleanAvatar
        ? cleanAvatar
        : cachedProfile.avatarUrl ||
          `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(targetUid)}`,
    bio: safeData.bio !== undefined ? safeData.bio.trim() : cachedProfile.bio || '',
    website: safeData.website !== undefined ? safeData.website.trim() : cachedProfile.website || '',
    followersCount: cachedProfile.followersCount || 0,
    followingCount: cachedProfile.followingCount || 0,
    postsCount: cachedProfile.postsCount || 0,
    isFollowing: cachedProfile.isFollowing || false,
    following: cachedProfile.following || [],
    createdAt: cachedProfile.createdAt || new Date().toISOString(),
    ...cachedProfile,
    ...safeData,
    isVerified: preservedIsVerified,
    ...(cleanName !== undefined ? { displayName: cleanName } : {}),
    ...(cleanAvatar ? { avatarUrl: cleanAvatar } : {}),
  };

  try {
    localStorage.setItem(localProfileKey, JSON.stringify(mergedProfile));
  } catch {}

  // 4. Synchronize sogo_auth_user if this corresponds to the currently signed-in user
  try {
    const rawAuth = localStorage.getItem('sogo_auth_user');
    if (rawAuth) {
      const parsedAuth: User = JSON.parse(rawAuth);
      if (parsedAuth.id === targetUid) {
        const updatedAuth = { ...parsedAuth, ...mergedProfile };
        localStorage.setItem('sogo_auth_user', JSON.stringify(updatedAuth));
      }
    }
  } catch {}

  // 5. Synchronize sogo_users_cache (user directory cache)
  const storedUsers = getStoredUsers();
  let found = false;
  const updatedStoredUsers = storedUsers.map((u) => {
    if (u.id === targetUid) {
      found = true;
      return { ...u, ...mergedProfile };
    }
    return u;
  });
  if (!found) {
    updatedStoredUsers.push(mergedProfile);
  }
  saveUsers(updatedStoredUsers);

  // 6. Dispatch reactive event for cross-component synchronization
  try {
    window.dispatchEvent(
      new CustomEvent('sogo_profile_updated', {
        detail: {
          userId: targetUid,
          displayName: mergedProfile.displayName,
          avatarUrl: mergedProfile.avatarUrl,
          isVerified: mergedProfile.isVerified,
          user: mergedProfile,
        },
      })
    );
  } catch {}

  console.log('[PROFILE NAME SAVE]', {
    uid: targetUid,
    newName: mergedProfile.displayName,
    avatarUrl: mergedProfile.avatarUrl,
    firestoreWrite: 'success',
    localStateUpdate: 'success',
    finalDisplayedName: mergedProfile.displayName,
  });

  return mergedProfile;
}

/**
 * Fetch the list of users who follow targetUserId.
 * Ensures each returned User has authoritative isVerified status from Firestore.
 */
export async function getUserFollowers(
  targetUserId: string,
  currentActorId?: string
): Promise<User[]> {
  if (!targetUserId) return [];
  const actorId = currentActorId || auth?.currentUser?.uid;
  const followerIds = new Set<string>();

  try {
    const userSnap = await getDoc(doc(db, 'users', targetUserId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (Array.isArray(data.followers)) {
        data.followers.forEach((id: string) => {
          if (id) followerIds.add(id);
        });
      }
    }

    const followsSnap = await getDocs(
      query(collection(db, 'follows'), where('targetUid', '==', targetUserId), limit(100))
    );
    followsSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.followerUid) followerIds.add(d.followerUid);
    });
  } catch (err) {
    console.warn('Could not query followers from Firestore:', err);
  }

  const results: User[] = [];
  for (const fid of Array.from(followerIds)) {
    const u = await getUser(fid, actorId);
    if (u) results.push(u);
  }
  return results;
}

/**
 * Fetch the list of users that targetUserId is following.
 * Ensures each returned User has authoritative isVerified status from Firestore.
 */
export async function getUserFollowing(
  targetUserId: string,
  currentActorId?: string
): Promise<User[]> {
  if (!targetUserId) return [];
  const actorId = currentActorId || auth?.currentUser?.uid;
  const followingIds = new Set<string>();

  try {
    const userSnap = await getDoc(doc(db, 'users', targetUserId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (Array.isArray(data.following)) {
        data.following.forEach((id: string) => {
          if (id) followingIds.add(id);
        });
      }
    }

    const followsSnap = await getDocs(
      query(collection(db, 'follows'), where('followerUid', '==', targetUserId), limit(100))
    );
    followsSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.targetUid) followingIds.add(d.targetUid);
    });
  } catch (err) {
    console.warn('Could not query following from Firestore:', err);
  }

  if (followingIds.size === 0 && targetUserId === actorId) {
    getFollowingIds(actorId).forEach((id) => followingIds.add(id));
  }

  const results: User[] = [];
  for (const tid of Array.from(followingIds)) {
    const u = await getUser(tid, actorId);
    if (u) results.push(u);
  }
  return results;
}

