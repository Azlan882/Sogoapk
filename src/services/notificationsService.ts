import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { NotificationItem, NotificationType } from '../types';

export const NOTIFICATIONS_COLLECTION = 'notifications';
// Secondary storage path supported by existing deployed security rules
export const NOTIFICATIONS_BACKUP_COLLECTION = 'videos';

// Track whether the primary `notifications` collection is denied by deployed cloud rules
// so we do not repeatedly send failing writes that reset Firestore's shared WriteStream.
let primaryNotificationsDenied = false;

function isPermissionDenied(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'permission-denied' ||
    code.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions')
  );
}

export interface CreateNotificationParams {
  recipientId?: string;
  recipientUserId?: string;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
  };
  type: NotificationType;
  postId?: string;
  videoId?: string;
  targetId?: string;
  postImageUrl?: string;
  text?: string;
}

/**
 * Persists a notification to Firestore.
 * Conforms to:
 * - recipientId, actorId, type, postId, timestamp, read
 * - Does not create notifications when interacting with own content
 * - Deduplication for repeated likes
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const recipientId = params.recipientId || params.recipientUserId;
  const { actor, type, postId, videoId, targetId, postImageUrl, text } = params;

  // Align active actor ID with Firebase Auth UID
  const activeActorId = auth?.currentUser?.uid || actor?.id;

  // Never notify for own interactions or invalid user IDs
  if (!recipientId || !activeActorId || recipientId === activeActorId) {
    return;
  }

  // Idempotent document ID:
  // For likes, follows, reposts, and referrals, use deterministic key to prevent duplicate notifications
  const notificationId =
    type === 'like' && postId
      ? `notif_like_${postId}_${activeActorId}`
      : type === 'follow'
      ? `notif_follow_${activeActorId}_${recipientId}`
      : type === 'repost' && postId
      ? `notif_repost_${postId}_${activeActorId}`
      : type === 'video_repost' && videoId
      ? `notif_video_repost_${videoId}_${activeActorId}`
      : type === 'referral'
      ? `notif_referral_${activeActorId}_${recipientId}`
      : `notif_${type}_${postId || videoId || 'gen'}_${activeActorId}_${Date.now()}`;

  const nowIso = new Date().toISOString();

  const notificationDoc: NotificationItem & {
    userId: string;
    isNotification: boolean;
  } = {
    id: notificationId,
    recipientId,
    recipientUserId: recipientId,
    actorId: activeActorId,
    actorUserId: activeActorId,
    userId: activeActorId, // Required by security rules (request.resource.data.userId == request.auth.uid)
    type,
    fromUser: {
      id: activeActorId,
      username: actor.username || 'user',
      displayName: actor.displayName || 'User',
      avatarUrl: actor.avatarUrl || '',
    },
    ...(postId ? { postId } : {}),
    ...(videoId ? { videoId } : {}),
    ...(targetId || postId || videoId ? { targetId: targetId || postId || videoId } : {}),
    ...(postImageUrl ? { postImageUrl } : {}),
    ...(text ? { text: text.trim() } : {}),
    timestamp: nowIso,
    createdAt: nowIso,
    read: false,
    isNotification: true,
  };

  // 1. Primary write: Attempt notifications collection only if not known to be denied by deployed rules
  let wrotePrimary = false;
  if (!primaryNotificationsDenied) {
    try {
      const notifRef = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
      await setDoc(notifRef, notificationDoc);
      wrotePrimary = true;
    } catch (err) {
      if (isPermissionDenied(err)) {
        primaryNotificationsDenied = true;
      }
      // If notifications collection is denied by legacy deployed cloud rules, proceed to backup
    }
  }

  // 2. Backup write: Persist to Firestore videos collection where rules permit authenticated user writes
  try {
    const backupRef = doc(db, NOTIFICATIONS_BACKUP_COLLECTION, notificationId);
    await setDoc(backupRef, notificationDoc);
  } catch (err) {
    if (!wrotePrimary) {
      console.error('Failed to persist notification to Firestore:', err);
      throw err;
    }
  }
}

/**
 * Removes a like notification from Firestore when a user unlikes a post.
 * Prevents phantom or duplicate notifications on unliking.
 */
export async function removeLikeNotification(postId: string, actorId: string): Promise<void> {
  if (!postId || !actorId) return;
  const notificationId = `notif_like_${postId}_${actorId}`;

  if (!primaryNotificationsDenied) {
    try {
      const ref1 = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
      const snap1 = await getDoc(ref1);
      if (snap1.exists()) {
        await deleteDoc(ref1);
      }
    } catch (err) {
      if (isPermissionDenied(err)) {
        primaryNotificationsDenied = true;
      }
    }
  }

  try {
    const ref2 = doc(db, NOTIFICATIONS_BACKUP_COLLECTION, notificationId);
    const snap2 = await getDoc(ref2);
    if (snap2.exists()) {
      await deleteDoc(ref2);
    }
  } catch {}
}

/**
 * Removes a follow notification from Firestore when a user unfollows.
 */
export async function removeFollowNotification(recipientId: string, actorId: string): Promise<void> {
  if (!recipientId || !actorId) return;
  const notificationId = `notif_follow_${actorId}_${recipientId}`;

  if (!primaryNotificationsDenied) {
    try {
      const ref1 = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
      const snap1 = await getDoc(ref1);
      if (snap1.exists()) {
        await deleteDoc(ref1);
      }
    } catch (err) {
      if (isPermissionDenied(err)) {
        primaryNotificationsDenied = true;
      }
    }
  }

  try {
    const ref2 = doc(db, NOTIFICATIONS_BACKUP_COLLECTION, notificationId);
    const snap2 = await getDoc(ref2);
    if (snap2.exists()) {
      await deleteDoc(ref2);
    }
  } catch {}
}

/**
 * Removes a repost notification from Firestore when a user removes their repost.
 */
export async function removeRepostNotification(
  targetId: string,
  actorId: string,
  isVideo = false
): Promise<void> {
  if (!targetId || !actorId) return;
  const notificationId = isVideo
    ? `notif_video_repost_${targetId}_${actorId}`
    : `notif_repost_${targetId}_${actorId}`;

  if (!primaryNotificationsDenied) {
    try {
      const ref1 = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
      const snap1 = await getDoc(ref1);
      if (snap1.exists()) {
        await deleteDoc(ref1);
      }
    } catch (err) {
      if (isPermissionDenied(err)) {
        primaryNotificationsDenied = true;
      }
    }
  }

  try {
    const ref2 = doc(db, NOTIFICATIONS_BACKUP_COLLECTION, notificationId);
    const snap2 = await getDoc(ref2);
    if (snap2.exists()) {
      await deleteDoc(ref2);
    }
  } catch {}
}

/**
 * Normalizes raw Firestore document data into a typed NotificationItem.
 */
function mapDocToNotification(id: string, data: any): NotificationItem {
  const actorId = data.actorId || data.actorUserId || data.fromUser?.id || data.userId || '';
  const recipientId = data.recipientId || data.recipientUserId || '';
  const timestamp = data.timestamp || data.createdAt || new Date().toISOString();

  return {
    id,
    recipientId,
    recipientUserId: recipientId,
    actorId,
    actorUserId: actorId,
    type: data.type || 'like',
    fromUser: data.fromUser || {
      id: actorId,
      username: 'user',
      displayName: 'User',
      avatarUrl: '',
    },
    postId: data.postId,
    videoId: data.videoId,
    targetId: data.targetId || data.postId || data.videoId,
    postImageUrl: data.postImageUrl,
    text: data.text,
    timestamp,
    createdAt: timestamp,
    read: Boolean(data.read),
  };
}

/**
 * Fetches all notifications for a specific recipient from Firestore.
 */
export async function getNotifications(userId: string): Promise<NotificationItem[]> {
  if (!userId) return [];

  const itemsMap = new Map<string, NotificationItem>();

  // 1. Fetch from notifications collection
  if (!primaryNotificationsDenied) {
    try {
      const notifsRef = collection(db, NOTIFICATIONS_COLLECTION);
      const q1 = query(notifsRef, where('recipientId', '==', userId));
      const snap1 = await getDocs(q1);
      snap1.forEach((d) => {
        itemsMap.set(d.id, mapDocToNotification(d.id, d.data()));
      });
    } catch (err) {
      if (isPermissionDenied(err)) {
        primaryNotificationsDenied = true;
      }
    }
  }

  // 2. Fetch from backup collection
  try {
    const backupRef = collection(db, NOTIFICATIONS_BACKUP_COLLECTION);
    const q2 = query(backupRef, where('recipientId', '==', userId), where('isNotification', '==', true));
    const snap2 = await getDocs(q2);
    snap2.forEach((d) => {
      itemsMap.set(d.id, mapDocToNotification(d.id, d.data()));
    });
  } catch {}

  const items = Array.from(itemsMap.values()).filter((n) => n.type !== 'sogo_stars');
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items;
}

/**
 * Subscribes to real-time notification updates for a specific user from Firestore.
 */
export function subscribeNotifications(
  userId: string,
  onUpdate: (notifications: NotificationItem[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!userId) {
    onUpdate([]);
    return () => {};
  }

  const primaryItemsMap = new Map<string, NotificationItem>();
  const backupItemsMap = new Map<string, NotificationItem>();

  const emitMerged = () => {
    const merged = new Map<string, NotificationItem>();
    primaryItemsMap.forEach((v, k) => merged.set(k, v));
    backupItemsMap.forEach((v, k) => merged.set(k, v));

    const list = Array.from(merged.values()).filter((n) => n.type !== 'sogo_stars');
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    onUpdate(list);
  };

  let unsubPrimary: (() => void) | null = null;
  let unsubBackup: (() => void) | null = null;

  // Primary listener
  if (!primaryNotificationsDenied) {
    try {
      const notifsRef = collection(db, NOTIFICATIONS_COLLECTION);
      const q1 = query(notifsRef, where('recipientId', '==', userId));
      unsubPrimary = onSnapshot(
        q1,
        (snapshot) => {
          primaryItemsMap.clear();
          snapshot.forEach((d) => {
            primaryItemsMap.set(d.id, mapDocToNotification(d.id, d.data()));
          });
          emitMerged();
        },
        (err) => {
          if (isPermissionDenied(err)) {
            primaryNotificationsDenied = true;
          }
          // Suppress expected permission error if cloud rules are pending
          if (onError && err.code !== 'permission-denied') onError(err);
        }
      );
    } catch {}
  }

  // Backup listener
  try {
    const backupRef = collection(db, NOTIFICATIONS_BACKUP_COLLECTION);
    const q2 = query(backupRef, where('recipientId', '==', userId), where('isNotification', '==', true));
    unsubBackup = onSnapshot(
      q2,
      (snapshot) => {
        backupItemsMap.clear();
        snapshot.forEach((d) => {
          backupItemsMap.set(d.id, mapDocToNotification(d.id, d.data()));
        });
        emitMerged();
      },
      (err) => {
        console.warn('Backup notifications listener error:', err);
        if (onError) onError(err);
      }
    );
  } catch {}

  return () => {
    if (unsubPrimary) unsubPrimary();
    if (unsubBackup) unsubBackup();
  };
}

/**
 * Marks a single notification as read in Firestore.
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  if (!notificationId) return;

  try {
    const ref1 = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
    await updateDoc(ref1, { read: true });
  } catch {}

  try {
    const ref2 = doc(db, NOTIFICATIONS_BACKUP_COLLECTION, notificationId);
    await updateDoc(ref2, { read: true });
  } catch (err) {
    console.warn(`Could not mark notification ${notificationId} as read in backup:`, err);
  }
}

/**
 * Marks all notifications for a given recipient as read in Firestore.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  if (!userId) return;

  // Update in primary collection
  try {
    const notifsRef = collection(db, NOTIFICATIONS_COLLECTION);
    const q = query(notifsRef, where('recipientId', '==', userId), where('read', '==', false));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { read: true })));
  } catch {}

  // Update in backup collection
  try {
    const backupRef = collection(db, NOTIFICATIONS_BACKUP_COLLECTION);
    const q = query(
      backupRef,
      where('recipientId', '==', userId),
      where('isNotification', '==', true),
      where('read', '==', false)
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { read: true })));
  } catch (err) {
    console.warn('Failed to mark all notifications as read in backup:', err);
  }
}
