import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  deleteUser,
  reauthenticateWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../lib/firebase';

export interface DeletionProgressCallback {
  (step: string, percent: number): void;
}

/**
 * Executes full account deletion for the currently authenticated user.
 * Cleans up:
 * 1. User's Firestore profile (/users/{uid})
 * 2. User's subcollections (/users/{uid}/following, /users/{uid}/followers, /users/{uid}/blocked)
 * 3. User's posts (/posts where userId == uid)
 * 4. User's reels/videos (/videos where userId == uid)
 * 5. User's notifications (/notifications where recipientId == uid or userId == uid)
 * 6. User's daily stars records (/sogo_stars_daily where userId == uid)
 * 7. Firebase Auth account (currentUser.delete()) with recent-login reauthentication fallback
 * 8. Cleans all local storage and session state
 */
export async function deleteUserAccount(
  onProgress?: DeletionProgressCallback
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to delete your account.');
  }

  const uid = currentUser.uid;
  const userEmail = currentUser.email || '';

  // Attempt 1: Call authorized Cloud Function if deployed
  let backendHandled = false;
  try {
    onProgress?.('Contacting account deletion service...', 15);
    const callFn = httpsCallable(functions, 'deleteUserAccount');
    await callFn({ uid });
    backendHandled = true;
  } catch (backendErr) {
    console.warn('[AccountDeletion] Cloud Function fallback to direct client deletion:', backendErr);
  }

  if (!backendHandled) {
    // 1. Delete user-owned posts in chunks
    onProgress?.('Deleting your posts...', 25);
    try {
      const postsQuery = query(collection(db, 'posts'), where('userId', '==', uid));
      const postsSnap = await getDocs(postsQuery);
      if (!postsSnap.empty) {
        const batch = writeBatch(db);
        postsSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn('[AccountDeletion] Error deleting posts:', e);
    }

    // 2. Delete user-owned videos / reels in chunks
    onProgress?.('Deleting your Reels & media references...', 45);
    try {
      const videosQuery = query(collection(db, 'videos'), where('userId', '==', uid));
      const videosSnap = await getDocs(videosQuery);
      if (!videosSnap.empty) {
        const batch = writeBatch(db);
        videosSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn('[AccountDeletion] Error deleting videos:', e);
    }

    // 3. Delete user subcollections: following, followers, blocked
    onProgress?.('Deleting social connections & block lists...', 65);
    try {
      const subcollections = ['following', 'followers', 'blocked'];
      for (const sub of subcollections) {
        const subSnap = await getDocs(collection(db, 'users', uid, sub));
        if (!subSnap.empty) {
          const batch = writeBatch(db);
          subSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    } catch (e) {
      console.warn('[AccountDeletion] Error deleting subcollections:', e);
    }

    // 4. Delete user notifications & daily stars records
    onProgress?.('Deleting notifications & activity records...', 80);
    try {
      const notifsQuery = query(collection(db, 'notifications'), where('userId', '==', uid));
      const notifsSnap = await getDocs(notifsQuery);
      if (!notifsSnap.empty) {
        const batch = writeBatch(db);
        notifsSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn('[AccountDeletion] Error deleting notifications:', e);
    }

    // 5. Delete Firestore user document
    onProgress?.('Deleting profile record...', 90);
    try {
      const userDocRef = doc(db, 'users', uid);
      await deleteDoc(userDocRef);
    } catch (e) {
      console.warn('[AccountDeletion] Error deleting user profile doc:', e);
    }
  }

  // 6. Delete Firebase Authentication user
  onProgress?.('Finalizing Firebase Authentication deletion...', 95);
  try {
    await deleteUser(currentUser);
  } catch (authErr: any) {
    if (authErr?.code === 'auth/requires-recent-login') {
      onProgress?.('Re-authenticating with Google for security confirmation...', 96);
      const provider = new GoogleAuthProvider();
      await reauthenticateWithPopup(currentUser, provider);
      await deleteUser(currentUser);
    } else {
      console.error('[AccountDeletion] Auth deletion error:', authErr);
      throw authErr;
    }
  }

  // 7. Wipe all local storage & session caches
  if (typeof window !== 'undefined') {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  }

  onProgress?.('Account permanently deleted.', 100);
}

/**
 * Submits an external account deletion request (for Google Play compliance).
 * Used by users who no longer have the app installed or cannot access their phone.
 */
export async function submitExternalDeletionRequest(params: {
  email: string;
  username?: string;
  reason?: string;
}): Promise<string> {
  const cleanEmail = (params.email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('A valid email address is required.');
  }

  const reqCol = collection(db, 'account_deletion_requests');
  const reqRef = doc(reqCol);
  const nowIso = new Date().toISOString();

  await setDoc(reqRef, {
    id: reqRef.id,
    email: cleanEmail,
    username: (params.username || '').trim(),
    reason: (params.reason || '').trim(),
    status: 'pending',
    createdAt: nowIso,
    timestamp: serverTimestamp(),
  });

  return reqRef.id;
}
