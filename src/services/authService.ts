import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  reload,
  updateProfile as updateFbProfile,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { Capacitor } from '@capacitor/core';
import { auth, db, GOOGLE_WEB_CLIENT_ID } from '../lib/firebase';
import { User } from '../types';
import { perf } from '../utils/perfLogger';

const AUTH_USER_KEY = 'sogo_auth_user';
const GOOGLE_LOGIN_DIAG_KEY = 'sogo_google_login_diagnostic';

let initializeSocialLoginPromise: Promise<void> | null = null;

export interface GoogleAuthDiagnostics {
  packageName: string;
  webClientIdConfigured: boolean;
  webClientIdEndsWithGoogle: boolean;
  webClientIdMasked: string;
  filterByAuthorizedAccounts: boolean;
  gcmErrorCode: string;
  gcmErrorMessage: string;
  registeredSha1Notice: string;
  timestamp: string;
}

export interface GoogleLoginDiagnostic {
  stage: string;
  platform: string;
  isNative: boolean;
  packageName: string;
  webClientIdMasked: string;
  hasIdToken: boolean;
  hasAccessToken: boolean;
  responseType: string;
  firebaseUid: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  timestamp: string;
}

let lastGoogleAuthDiagnostics: GoogleAuthDiagnostics | null = null;
let currentGoogleLoginDiagnostic: GoogleLoginDiagnostic | null = null;
let googleLoginInFlight = false;
const googleLoginDiagListeners = new Set<() => void>();

function notifyGoogleLoginDiagnosticListeners(): void {
  googleLoginDiagListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function setGoogleLoginInFlightState(inFlight: boolean): void {
  googleLoginInFlight = inFlight;
  notifyGoogleLoginDiagnosticListeners();
}

function recordGoogleLoginDiagnostic(
  partial: Partial<GoogleLoginDiagnostic> & { stage: string }
): GoogleLoginDiagnostic {
  const prev = getGoogleLoginDiagnostic();
  const next: GoogleLoginDiagnostic = {
    stage: partial.stage,
    platform: partial.platform ?? prev?.platform ?? Capacitor.getPlatform(),
    isNative: partial.isNative ?? prev?.isNative ?? Capacitor.isNativePlatform(),
    packageName: partial.packageName ?? prev?.packageName ?? 'com.sogo.social',
    webClientIdMasked:
      partial.webClientIdMasked ??
      prev?.webClientIdMasked ??
      maskGoogleClientId(GOOGLE_WEB_CLIENT_ID),
    hasIdToken: partial.hasIdToken ?? prev?.hasIdToken ?? false,
    hasAccessToken: partial.hasAccessToken ?? prev?.hasAccessToken ?? false,
    responseType: partial.responseType ?? prev?.responseType ?? 'none',
    firebaseUid:
      partial.firebaseUid !== undefined
        ? partial.firebaseUid
        : prev?.firebaseUid ?? null,
    errorCode:
      partial.errorCode !== undefined ? partial.errorCode : prev?.errorCode ?? null,
    errorMessage:
      partial.errorMessage !== undefined
        ? partial.errorMessage
        : prev?.errorMessage ?? null,
    timestamp: partial.timestamp ?? new Date().toISOString(),
  };
  currentGoogleLoginDiagnostic = next;
  try {
    localStorage.setItem(GOOGLE_LOGIN_DIAG_KEY, JSON.stringify(next));
  } catch {}
  notifyGoogleLoginDiagnosticListeners();
  return next;
}

export function getGoogleLoginDiagnostic(): GoogleLoginDiagnostic | null {
  if (currentGoogleLoginDiagnostic) {
    return currentGoogleLoginDiagnostic;
  }
  try {
    const raw = localStorage.getItem(GOOGLE_LOGIN_DIAG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GoogleLoginDiagnostic;
      if (parsed && typeof parsed.stage === 'string') {
        currentGoogleLoginDiagnostic = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

export function isGoogleLoginInFlight(): boolean {
  return googleLoginInFlight;
}

export function subscribeGoogleLoginDiagnostic(listener: () => void): () => void {
  googleLoginDiagListeners.add(listener);
  return () => {
    googleLoginDiagListeners.delete(listener);
  };
}

export function clearGoogleLoginDiagnostic(): void {
  currentGoogleLoginDiagnostic = null;
  try {
    localStorage.removeItem(GOOGLE_LOGIN_DIAG_KEY);
  } catch {}
  notifyGoogleLoginDiagnosticListeners();
}

export function formatGoogleLoginDiagnostic(diag: GoogleLoginDiagnostic): string {
  return [
    'Google Login Diagnostic',
    `stage: ${diag.stage}`,
    `platform: ${diag.platform} (native=${diag.isNative})`,
    `packageName: ${diag.packageName}`,
    `webClientId: ${diag.webClientIdMasked}`,
    `hasIdToken: ${diag.hasIdToken}`,
    `hasAccessToken: ${diag.hasAccessToken}`,
    `responseType: ${diag.responseType}`,
    `firebaseUid: ${diag.firebaseUid || 'none'}`,
    `errorCode: ${diag.errorCode || 'none'}`,
    `errorMessage: ${diag.errorMessage || 'none'}`,
    `timestamp: ${diag.timestamp}`,
  ].join('\n');
}

export function getLatestGoogleAuthDiagnostics(): GoogleAuthDiagnostics | null {
  return lastGoogleAuthDiagnostics;
}

export function maskGoogleClientId(clientId: string): string {
  if (!clientId || clientId.length < 20) return '***';
  return `${clientId.slice(0, 14)}...${clientId.slice(-28)}`;
}

/**
 * Initializes the Capacitor SocialLogin plugin with the Google OAuth 2.0 Web Client ID.
 * Uses a promise lock to guarantee initialize is executed exactly once.
 */
export function initializeSocialLogin(): Promise<void> {
  if (!initializeSocialLoginPromise) {
    initializeSocialLoginPromise = (async () => {
      try {
        await SocialLogin.initialize({
          google: {
            webClientId: GOOGLE_WEB_CLIENT_ID,
            mode: 'online',
          },
        });
        console.log(
          '[SOGO_AUTH] SocialLogin initialized (webClientId: ' +
            maskGoogleClientId(GOOGLE_WEB_CLIENT_ID) +
            ')'
        );
      } catch (err) {
        console.warn('[SOGO_AUTH] SocialLogin.initialize warning:', err);
      }
    })();
  }
  return initializeSocialLoginPromise;
}

/**
 * Synchronously builds an initial App User from the verified Firebase Auth session
 * and any existing local profile cache so the authenticated UI shell can render immediately
 * without waiting on sequential Firestore reads.
 */
export function buildImmediateAppUser(fbUser: FirebaseUser): User {
  const localCacheKey = `sogo_profile_${fbUser.uid}`;
  let cached: Partial<User> = {};
  let hasLocalCache = false;

  try {
    const rawAuth = localStorage.getItem(AUTH_USER_KEY);
    if (rawAuth) {
      const parsedAuth = JSON.parse(rawAuth);
      if (parsedAuth && parsedAuth.id === fbUser.uid) {
        cached = { ...cached, ...parsedAuth };
        hasLocalCache = true;
      }
    }
  } catch {}

  try {
    const rawProfile = localStorage.getItem(localCacheKey);
    if (rawProfile) {
      const parsedProfile = JSON.parse(rawProfile);
      if (parsedProfile) {
        cached = { ...cached, ...parsedProfile };
        hasLocalCache = true;
      }
    }
  } catch {}

  const displayName =
    cached.displayName ||
    fbUser.displayName ||
    (fbUser.email ? fbUser.email.split('@')[0] : 'SogoSocial User');

  const email = cached.email || fbUser.email || '';

  const defaultUsername =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'user';

  const username = cached.username || defaultUsername;

  const avatarUrl =
    cached.avatarUrl ||
    fbUser.photoURL ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;

  const birthday = cached.birthday || '';

  // If local cache exists for this UID, respect its onboarding state;
  // otherwise provisionally treat as onboarded until background Firestore profile sync resolves.
  const isOnboarded = hasLocalCache
    ? Boolean(
        cached.isOnboarded === true ||
          (cached.birthday && cached.username && cached.displayName)
      )
    : true;

  return {
    id: fbUser.uid,
    username,
    displayName,
    email,
    avatarUrl,
    birthday,
    isOnboarded,
    bio: cached.bio ?? '',
    website: cached.website ?? '',
    followersCount: Number(cached.followersCount ?? 0),
    followingCount: Number(cached.followingCount ?? cached.following?.length ?? 0),
    postsCount: Number(cached.postsCount ?? 0),
    isFollowing: false,
    following: Array.isArray(cached.following) ? cached.following : [],
    isVerified: Boolean(cached.isVerified ?? false),
    createdAt:
      cached.createdAt ||
      fbUser.metadata?.creationTime ||
      new Date().toISOString(),
  };
}

/**
 * Reconciles the user's following subcollection in the background without blocking startup or profile loads.
 */
function reconcileUserFollowingInBackground(uid: string, baseUser: User): void {
  if (!db || !uid) return;
  const localCacheKey = `sogo_profile_${uid}`;

  getDocs(collection(db, 'users', uid, 'following'))
    .then((followingSnap) => {
      if (!followingSnap.empty) {
        const subFollowingIds = followingSnap.docs.map((d) => d.id);
        const currentFollowing = baseUser.following || [];
        const merged = Array.from(new Set([...currentFollowing, ...subFollowingIds]));
        const nextCount = Math.max(baseUser.followingCount || 0, merged.length);

        if (merged.length !== currentFollowing.length || nextCount !== baseUser.followingCount) {
          const updatedUser: User = {
            ...baseUser,
            following: merged,
            followingCount: nextCount,
          };
          try {
            localStorage.setItem(localCacheKey, JSON.stringify(updatedUser));
            localStorage.setItem(`sogo_following_${uid}`, JSON.stringify(merged));
            if (auth?.currentUser?.uid === uid) {
              localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));
            }
          } catch {}

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('sogo_profile_updated', {
                detail: {
                  userId: uid,
                  user: { following: merged, followingCount: nextCount },
                },
              })
            );
          }
        }
      }
    })
    .catch(() => {});
}

/**
 * Maps a Firebase User and optional additional profile data into SogoSocial's User schema.
 * Reads stored profile document from Firestore to preserve custom bio, stats, etc.
 */
export async function mapFirebaseUserToAppUser(
  fbUser: FirebaseUser,
  additional?: Partial<User>
): Promise<User> {
  const localCacheKey = `sogo_profile_${fbUser.uid}`;
  let cached: Partial<User> = {};
  try {
    const raw = localStorage.getItem(localCacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch {}

  let firestoreData: Partial<User> | null = null;
  let firestoreExists = false;
  let firestoreFetchError = false;

  // If Firestore is available, retrieve the existing profile document as source of truth
  if (db) {
    try {
      const snap = await getDoc(doc(db, 'users', fbUser.uid));
      if (snap.exists()) {
        firestoreExists = true;
        firestoreData = snap.data() as Partial<User>;
        cached = { ...cached, ...firestoreData };
      }
    } catch (err) {
      firestoreFetchError = true;
      console.warn('Could not fetch user document from Firestore:', err);
    }
  }

  const displayName =
    additional?.displayName ||
    firestoreData?.displayName ||
    (firestoreData as Record<string, any>)?.fullName ||
    cached.displayName ||
    fbUser.displayName ||
    (fbUser.email ? fbUser.email.split('@')[0] : 'SogoSocial User');

  const email =
    additional?.email ||
    firestoreData?.email ||
    fbUser.email ||
    cached.email ||
    '';

  const defaultUsername = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'user';

  const username =
    additional?.username ||
    firestoreData?.username ||
    cached.username ||
    defaultUsername;

  const avatarUrl =
    additional?.avatarUrl ||
    firestoreData?.avatarUrl ||
    (firestoreData as Record<string, any>)?.photoURL ||
    (firestoreData as Record<string, any>)?.profilePhoto ||
    cached.avatarUrl ||
    fbUser.photoURL ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;

  const birthday =
    additional?.birthday ||
    firestoreData?.birthday ||
    cached.birthday ||
    '';

  // Profile is complete if explicitly flagged as onboarded,
  // or if existing user profile already has required fields in Firestore
  const isComplete =
    additional?.isOnboarded === true ||
    (firestoreExists && (
      firestoreData?.isOnboarded === true ||
      (firestoreData as Record<string, any>)?.onboardingCompleted === true ||
      Boolean(firestoreData?.birthday && firestoreData?.username && firestoreData?.displayName)
    )) ||
    cached.isOnboarded === true;

  const user: User = {
    id: fbUser.uid,
    username,
    displayName,
    email,
    avatarUrl,
    birthday,
    isOnboarded: Boolean(isComplete),
    bio: additional?.bio ?? firestoreData?.bio ?? cached.bio ?? '',
    website: additional?.website ?? firestoreData?.website ?? cached.website ?? '',
    followersCount: Number(firestoreData?.followersCount ?? cached.followersCount ?? 0),
    followingCount: Number(firestoreData?.followingCount ?? firestoreData?.following?.length ?? cached.followingCount ?? 0),
    postsCount: Number(firestoreData?.postsCount ?? cached.postsCount ?? 0),
    isFollowing: false,
    following: Array.isArray(firestoreData?.following)
      ? firestoreData.following
      : Array.isArray(cached.following)
      ? cached.following
      : [],
    isVerified: Boolean(firestoreData?.isVerified ?? cached.isVerified ?? false),
    createdAt:
      firestoreData?.createdAt ||
      cached.createdAt ||
      fbUser.metadata?.creationTime ||
      new Date().toISOString(),
  };

  try {
    localStorage.setItem(localCacheKey, JSON.stringify(user));
    if (Array.isArray(user.following)) {
      localStorage.setItem(`sogo_following_${user.id}`, JSON.stringify(user.following));
    }
  } catch {}

  // Reconcile following list from Firestore subcollection in the background without blocking startup
  reconcileUserFollowingInBackground(fbUser.uid, user);

  // ONLY create an initial stub if Firestore successfully verified that the document does NOT exist
  if (db && fbUser.uid && !firestoreExists && !firestoreFetchError) {
    setDoc(
      doc(db, 'users', fbUser.uid),
      {
        id: fbUser.uid,
        uid: fbUser.uid,
        username,
        displayName,
        fullName: displayName,
        email,
        avatarUrl,
        photoURL: avatarUrl,
        profilePhoto: avatarUrl,
        birthday: '',
        isOnboarded: false,
        onboardingCompleted: false,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        createdAt: user.createdAt,
        updatedAt: serverTimestamp(),
      }
    ).catch((err) => {
      console.warn('Could not initialize new user document in Firestore:', err);
    });
  }

  return user;
}

/**
 * Checks if a user's SogoSocial profile document exists and is complete in Firestore.
 */
export async function checkUserProfileStatus(uid: string): Promise<{
  exists: boolean;
  isComplete: boolean;
  data?: Partial<User>;
}> {
  if (!db || !uid) {
    return { exists: false, isComplete: false };
  }
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) {
      return { exists: false, isComplete: false };
    }
    const data = snap.data() as Partial<User>;
    const isComplete =
      data.isOnboarded === true ||
      Boolean(data.birthday && data.username && data.displayName);
    return { exists: true, isComplete, data };
  } catch (err) {
    console.warn('Firestore checkUserProfileStatus error:', err);
    return { exists: false, isComplete: false };
  }
}

/**
 * Completes a user's initial onboarding profile in Firestore and local state.
 */
export async function completeUserProfile(
  uid: string,
  profileData: {
    displayName: string;
    username: string;
    birthday: string;
    avatarUrl: string;
    bio?: string;
    website?: string;
  }
): Promise<User> {
  const cleanName = profileData.displayName.trim();
  const cleanUsername = profileData.username.trim().toLowerCase();
  const cleanBirthday = profileData.birthday.trim();
  const cleanAvatar = profileData.avatarUrl.trim();
  const cleanBio = (profileData.bio || '').trim();
  const cleanWebsite = (profileData.website || '').trim();

  if (!cleanName) {
    throw new Error('Full Name is required.');
  }
  if (!cleanBirthday) {
    throw new Error('Birthday is required.');
  }
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error('Username must be at least 3 characters.');
  }
  if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
    throw new Error('Username can only contain letters, numbers, and underscores (3-30 characters).');
  }

  // Check username availability excluding current user's document
  const isAvailable = await checkUsernameAvailability(cleanUsername, uid);
  if (!isAvailable) {
    throw new Error(`Username @${cleanUsername} is already taken. Please choose another.`);
  }

  const localCacheKey = `sogo_profile_${uid}`;
  let existing: Partial<User> = {};
  try {
    const raw = localStorage.getItem(localCacheKey);
    if (raw) existing = JSON.parse(raw);
  } catch {}

  const finalAvatar =
    cleanAvatar ||
    existing.avatarUrl ||
    auth?.currentUser?.photoURL ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanUsername)}`;

  const userEmail = existing.email || auth?.currentUser?.email || '';

  const updatedUser: User = {
    id: uid,
    username: cleanUsername,
    displayName: cleanName,
    email: userEmail,
    avatarUrl: finalAvatar,
    birthday: cleanBirthday,
    bio: cleanBio,
    website: cleanWebsite,
    followersCount: existing.followersCount ?? 0,
    followingCount: existing.followingCount ?? 0,
    postsCount: existing.postsCount ?? 0,
    isFollowing: false,
    following: existing.following || [],
    isVerified: existing.isVerified ?? false,
    isOnboarded: true,
    createdAt: existing.createdAt || new Date().toISOString(),
  };

  // 1. Save to Firestore with serverTimestamp
  // Await auth state readiness if available so auth.currentUser is guaranteed initialized
  if (auth && typeof (auth as any).authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {}
  }

  // Resolve target UID: Prefer auth.currentUser.uid to guarantee identity matching request.auth.uid in security rules
  const currentAuthUid = auth?.currentUser?.uid || null;
  const targetUid = currentAuthUid || uid;
  const documentPath = `users/${targetUid}`;

  console.log('[FIRESTORE_WRITE_DEBUG] Attempting profile save:', {
    authUid: currentAuthUid,
    targetUid,
    documentPath,
    isOwnerMatch: currentAuthUid === targetUid,
  });

  if (db && targetUid) {
    const firestorePayload: Record<string, any> = {
      id: targetUid,
      uid: targetUid,
      username: cleanUsername,
      displayName: cleanName,
      fullName: cleanName,
      email: userEmail,
      avatarUrl: finalAvatar,
      photoURL: finalAvatar,
      profilePhoto: finalAvatar,
      birthday: cleanBirthday,
      bio: cleanBio,
      website: cleanWebsite,
      isOnboarded: true,
      onboardingCompleted: true,
      followersCount: updatedUser.followersCount,
      followingCount: updatedUser.followingCount,
      postsCount: updatedUser.postsCount,
      following: updatedUser.following || [],
      updatedAt: serverTimestamp(),
    };
    if (!existing.createdAt) {
      firestorePayload.createdAt = serverTimestamp();
    }

    try {
      console.log('[FIRESTORE_WRITE_EXECUTE] Calling setDoc on path:', documentPath);
      await setDoc(doc(db, 'users', targetUid), firestorePayload, { merge: true });
      console.log('[FIRESTORE_WRITE_SUCCESS] Document successfully written to path:', documentPath);
    } catch (firestoreErr: any) {
      const code = firestoreErr?.code || 'UNKNOWN';
      const msg = firestoreErr?.message || String(firestoreErr);

      console.error('[FIRESTORE_WRITE_ERROR]', {
        authUid: currentAuthUid,
        targetUid,
        documentPath,
        errorCode: code,
        errorMessage: msg,
      });

      if (code === 'permission-denied' || msg.toLowerCase().includes('permission')) {
        throw new Error(
          `Firestore permission denied on path "${documentPath}". The Firestore security rules on your live project "sogo-e5ea9" must be updated to allow writes to "/users/${targetUid}". Please check your Firebase Console rules.`
        );
      }
      throw firestoreErr;
    }
  }

  // 2. Save to local storage caches
  try {
    localStorage.setItem(localCacheKey, JSON.stringify(updatedUser));
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));

    // Also update sogo_users_cache so local user lookups find this user
    const usersRaw = localStorage.getItem('sogo_users_cache');
    let usersList: User[] = usersRaw ? JSON.parse(usersRaw) : [];
    const idx = usersList.findIndex((u) => u.id === uid);
    if (idx >= 0) {
      usersList[idx] = updatedUser;
    } else {
      usersList.push(updatedUser);
    }
    localStorage.setItem('sogo_users_cache', JSON.stringify(usersList));
  } catch {}

  // 3. Update Firebase Auth user profile (displayName & photoURL) if available
  if (auth?.currentUser) {
    try {
      await updateFbProfile(auth.currentUser, {
        displayName: cleanName,
        photoURL: finalAvatar,
      });
    } catch {}
  }

  return updatedUser;
}

/**
 * Checks if a username is available in both Firestore and local cache.
 * Accepts optional excludeUserId so user's own document doesn't self-conflict.
 */
export async function checkUsernameAvailability(
  username: string,
  excludeUserId?: string
): Promise<boolean> {
  const clean = username.trim().toLowerCase();
  if (!clean || clean.length < 3) return false;

  // Check local users cache
  try {
    const raw = localStorage.getItem('sogo_users_cache');
    if (raw) {
      const localUsers: User[] = JSON.parse(raw);
      if (
        localUsers.some(
          (u) => u.username.toLowerCase() === clean && u.id !== excludeUserId
        )
      ) {
        return false;
      }
    }
  } catch {}

  // Check Firestore users collection
  if (db) {
    try {
      const q = query(
        collection(db, 'users'),
        where('username', '==', clean),
        limit(2)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const isSelf = snap.docs.some((d) => d.id === excludeUserId);
        if (!isSelf || snap.docs.length > 1) {
          return false;
        }
      }
    } catch (err) {
      console.warn('Firestore username availability check error:', err);
    }
  }

  return true;
}

/**
 * Formats Firebase Auth and Google Sign-In errors into friendly, user-facing error messages.
 */
export function formatAuthError(err: unknown): string {
  if (!err) return 'An unexpected error occurred. Please try again.';
  const errorObj = err as { code?: string; message?: string };
  const code = errorObj?.code || '';
  const message = errorObj?.message || String(err);

  if (
    code === 'USER_CANCELLED' ||
    message.includes('cancelled') ||
    message.includes('canceled') ||
    code === 'auth/popup-closed-by-user'
  ) {
    return 'Google Sign-In was cancelled.';
  }

  if (message.includes('[16]') || message.includes('Account reauth failed')) {
    return 'Google Sign-In re-authentication failed (Credential Manager Error [16]). The APK signing certificate (SHA-1) does not match the SHA-1 registered in Firebase/Google Cloud Console, or the Google account is not added as an authorized Test User in the OAuth consent screen.';
  }

  if (message.includes('[28444]') || message.includes('Developer console')) {
    return 'Google OAuth configuration mismatch (Error [28444]). Please verify that your Android package name (com.sogo.social) and signing certificate SHA-1 match Google Cloud Console.';
  }

  switch (code) {
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/network-request-failed':
      return 'Network connection error. Please check your internet connection and try again.';
    case 'auth/invalid-credential':
      return 'Invalid authentication credential. Please try again.';
    case 'auth/user-disabled':
      return 'This user account has been disabled. Please contact support.';
    case 'auth/too-many-requests':
      return 'Too many requests. Please wait a minute and try again.';
    case 'auth/email-already-in-use':
      return 'This email is already associated with another sign-in method.';
    default:
      if (message.includes('auth/')) {
        return message.replace(/^Firebase:\s*/, '');
      }
      return message;
  }
}

/**
 * Signs in the user using Google Sign-In.
 * - On native Capacitor (Android/iOS): Uses @capgo/capacitor-social-login with Google Credential Manager.
 * - On Web / Browser preview: Uses Firebase Auth GoogleAuthProvider popup.
 * In both cases, the authenticated Google account is authenticated with Firebase Auth and
 * the user profile is synced/persisted into Firestore.
 */
export async function loginWithGoogle(): Promise<User> {
  if (!auth) {
    recordGoogleLoginDiagnostic({
      stage: 'auth_unavailable',
      errorCode: 'AUTH_UNAVAILABLE',
      errorMessage: 'Firebase Authentication is not available.',
    });
    throw new Error('Firebase Authentication is not available.');
  }

  setGoogleLoginInFlightState(true);
  recordGoogleLoginDiagnostic({
    stage: 'start',
    hasIdToken: false,
    hasAccessToken: false,
    responseType: 'none',
    firebaseUid: null,
    errorCode: null,
    errorMessage: null,
  });

  try {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (err) {
      console.warn('Persistence configuration note:', err);
    }

    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      recordGoogleLoginDiagnostic({ stage: 'initialize_social_login' });
      // Ensure plugin initialized with Web Client ID before sign-in
      await initializeSocialLogin();

      recordGoogleLoginDiagnostic({ stage: 'social_login_prompt' });
      let res;
      try {
        res = await SocialLogin.login({
          provider: 'google',
          options: {
            style: 'standard', // Standard account picker prompt
            filterByAuthorizedAccounts: false, // Explicitly false as required
            forcePrompt: true, // Guarantees the account picker appears
          },
        });
      } catch (pluginErr: any) {
        const code = pluginErr?.code || '';
        const msg = pluginErr?.message || String(pluginErr);

        recordGoogleLoginDiagnostic({
          stage: 'social_login_error',
          errorCode: code || 'PLUGIN_ERROR',
          errorMessage: msg,
        });

        // Record diagnostic information without logging sensitive tokens or secrets
        const diagnostics: GoogleAuthDiagnostics = {
          packageName: 'com.sogo.social',
          webClientIdConfigured: Boolean(GOOGLE_WEB_CLIENT_ID),
          webClientIdEndsWithGoogle: GOOGLE_WEB_CLIENT_ID.endsWith(
            '.apps.googleusercontent.com'
          ),
          webClientIdMasked: maskGoogleClientId(GOOGLE_WEB_CLIENT_ID),
          filterByAuthorizedAccounts: false,
          gcmErrorCode: code || 'UNKNOWN',
          gcmErrorMessage: msg,
          registeredSha1Notice:
            'Expected registered debug SHA-1: A7:BA:F2:7B:FD:3E:CE:73:05:43:BB:7C:8B:C2:C6:59:71:13:56:DF. Check Android Logcat tag "GoogleProvider" or run "keytool -printcert -jarfile <apk>" to inspect the actual APK certificate.',
          timestamp: new Date().toISOString(),
        };
        lastGoogleAuthDiagnostics = diagnostics;

        console.error('[SOGO_GOOGLE_SIGN_IN_DIAGNOSTICS]', {
          packageName: diagnostics.packageName,
          webClientIdConfigured: diagnostics.webClientIdConfigured,
          webClientIdEndsWithGoogle: diagnostics.webClientIdEndsWithGoogle,
          webClientIdMasked: diagnostics.webClientIdMasked,
          filterByAuthorizedAccounts: diagnostics.filterByAuthorizedAccounts,
          gcmErrorCode: diagnostics.gcmErrorCode,
          gcmErrorMessage: diagnostics.gcmErrorMessage,
          registeredSha1Notice: diagnostics.registeredSha1Notice,
        });

        if (
          code === 'USER_CANCELLED' ||
          msg.includes('cancelled') ||
          msg.includes('canceled')
        ) {
          throw new Error('Google Sign-In was cancelled.');
        }
        throw pluginErr;
      }

      const rawResult = (res?.result as any) || (res as any) || {};
      const idToken = rawResult?.idToken || (res as any)?.idToken;
      const hasAccessToken = Boolean(
        rawResult?.accessToken?.token || rawResult?.accessToken
      );
      const responseType = String(rawResult?.responseType || 'unknown');

      recordGoogleLoginDiagnostic({
        stage: 'social_login_returned',
        hasIdToken: Boolean(idToken),
        hasAccessToken,
        responseType,
      });

      if (!idToken) {
        recordGoogleLoginDiagnostic({
          stage: 'missing_id_token',
          hasIdToken: false,
          hasAccessToken,
          responseType,
          errorCode: 'MISSING_ID_TOKEN',
          errorMessage:
            'Unable to retrieve Google ID token from device credential manager.',
        });
        throw new Error(
          'Unable to retrieve Google ID token from device credential manager. Please try again.'
        );
      }

      // Exchange ID token with Firebase Auth
      recordGoogleLoginDiagnostic({ stage: 'firebase_sign_in_with_credential' });
      let userCredential;
      try {
        const credential = GoogleAuthProvider.credential(idToken);
        userCredential = await signInWithCredential(auth, credential);
      } catch (fbErr: any) {
        recordGoogleLoginDiagnostic({
          stage: 'firebase_credential_error',
          errorCode: fbErr?.code || 'FIREBASE_AUTH_ERROR',
          errorMessage: fbErr?.message || String(fbErr),
        });
        throw fbErr;
      }

      recordGoogleLoginDiagnostic({
        stage: 'firestore_profile_sync',
        firebaseUid: userCredential.user?.uid || null,
      });
      const appUser = await mapFirebaseUserToAppUser(userCredential.user);

      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      recordGoogleLoginDiagnostic({
        stage: 'success',
        firebaseUid: appUser.id,
        errorCode: null,
        errorMessage: null,
      });
      return appUser;
    } else {
      // Web / browser preview fallback
      try {
        recordGoogleLoginDiagnostic({ stage: 'web_popup_start' });
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const userCredential = await signInWithPopup(auth, provider);
        const appUser = await mapFirebaseUserToAppUser(userCredential.user);

        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
        recordGoogleLoginDiagnostic({
          stage: 'success',
          firebaseUid: appUser.id,
          errorCode: null,
          errorMessage: null,
        });
        return appUser;
      } catch (webErr: any) {
        const code = webErr?.code || '';
        const msg = webErr?.message || String(webErr);
        recordGoogleLoginDiagnostic({
          stage: 'web_popup_error',
          errorCode: code || 'WEB_POPUP_ERROR',
          errorMessage: msg,
        });
        if (
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request'
        ) {
          throw new Error('Google Sign-In was cancelled.');
        }
        if (code === 'auth/popup-blocked') {
          throw new Error(
            'Popup was blocked by your browser. Please allow popups or open in a new window.'
          );
        }
        throw webErr;
      }
    }
  } finally {
    setGoogleLoginInFlightState(false);
  }
}

/**
 * Registers a new user with Email and Password.
 * Sends the built-in Firebase verification email and creates the user profile in Firestore.
 */
export async function registerWithEmail(
  fullName: string,
  username: string,
  email: string,
  password: string
): Promise<{ user: User; needsVerification: boolean }> {
  if (!auth) {
    throw new Error('Firebase Authentication is not available.');
  }

  const cleanName = fullName.trim();
  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  // Validate inputs
  if (!cleanName || !cleanUsername || !cleanEmail || !password) {
    throw new Error('Please fill in all required fields.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    throw new Error('Username must be between 3 and 30 characters long.');
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(cleanUsername)) {
    throw new Error('Username can only contain letters, numbers, and underscores.');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }

  // Check username availability
  const isAvailable = await checkUsernameAvailability(cleanUsername);
  if (!isAvailable) {
    throw new Error(`Username "@${cleanUsername}" is already taken. Please choose another.`);
  }

  // Create Firebase Auth user
  const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  const fbUser = userCredential.user;

  // Update Firebase display name
  try {
    await updateFbProfile(fbUser, { displayName: cleanName });
  } catch {}

  // Send Firebase's native verification email
  await sendEmailVerification(fbUser);

  // Construct and store SogoSocial user profile document in Firestore
  const appUser: User = {
    id: fbUser.uid,
    username: cleanUsername,
    displayName: cleanName,
    email: cleanEmail,
    avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanUsername)}`,
    bio: '',
    website: '',
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    isFollowing: false,
    isVerified: false,
    createdAt: new Date().toISOString(),
  };

  if (db) {
    try {
      await setDoc(doc(db, 'users', fbUser.uid), appUser, { merge: true });
    } catch (e) {
      console.warn('Failed to save profile to Firestore:', e);
    }
  }

  try {
    localStorage.setItem(`sogo_profile_${fbUser.uid}`, JSON.stringify(appUser));
  } catch {}

  return { user: appUser, needsVerification: true };
}

/**
 * Signs in with Email and Password using Firebase Auth.
 * Checks if the email is verified; if not, prevents main app access.
 */
export async function loginWithEmail(
  email: string,
  password: string
): Promise<{ user: User; emailVerified: boolean }> {
  if (!auth) {
    throw new Error('Firebase Authentication is not available.');
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) {
    throw new Error('Please enter both email and password.');
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    console.warn('Persistence configuration note:', err);
  }

  const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);

  // Reload the Firebase user to get the latest emailVerified status
  await reload(userCredential.user);
  const isVerified = userCredential.user.emailVerified;

  const appUser = await mapFirebaseUserToAppUser(userCredential.user);

  if (isVerified) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
    return { user: appUser, emailVerified: true };
  } else {
    // Do not save active session key if email is unverified
    localStorage.removeItem(AUTH_USER_KEY);
    return { user: appUser, emailVerified: false };
  }
}

/**
 * Reloads the current Firebase user and checks if their email has been verified.
 */
export async function checkEmailVerificationStatus(): Promise<boolean> {
  if (!auth?.currentUser) {
    return false;
  }

  await reload(auth.currentUser);

  if (auth.currentUser.emailVerified) {
    const appUser = await mapFirebaseUserToAppUser(auth.currentUser);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
    return true;
  }

  return false;
}

/**
 * Resends the native Firebase email verification to the currently authenticated user.
 */
export async function resendVerificationEmail(): Promise<void> {
  if (!auth?.currentUser) {
    throw new Error('No active registration session found. Please sign in to resend verification.');
  }

  await sendEmailVerification(auth.currentUser);
}

/**
 * Sends a native Firebase password reset email.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  if (!auth) {
    throw new Error('Firebase Authentication is not available.');
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Please enter your email address.');
  }

  await sendPasswordResetEmail(auth, cleanEmail);
}

/**
 * Subscribes to Firebase Auth state changes.
 * Only passes verified users to the callback as active sessions.
 */
export function subscribeToAuthState(
  callback: (user: User | null, emailVerified: boolean) => void
): () => void {
  if (!auth) {
    callback(null, false);
    return () => {};
  }

  return onAuthStateChanged(auth, async (fbUser) => {
    perf.milestone('Auth state available', { authenticated: Boolean(fbUser) });

    if (!fbUser) {
      localStorage.removeItem(AUTH_USER_KEY);
      callback(null, false);
      return;
    }

    try {
      // Avoid blocking startup with a network reload() when the user is already verified
      // or authenticated via Google OAuth provider.
      const isGoogleProvider = fbUser.providerData?.some((p) => p.providerId === 'google.com');
      let isVerified = Boolean(fbUser.emailVerified || isGoogleProvider);

      if (!isVerified) {
        try {
          await reload(fbUser);
          isVerified = Boolean(fbUser.emailVerified);
        } catch (reloadErr) {
          console.warn('Non-fatal user reload warning on startup:', reloadErr);
        }
      }

      if (!isVerified) {
        localStorage.removeItem(AUTH_USER_KEY);
        const unverifiedUser = buildImmediateAppUser(fbUser);
        callback(unverifiedUser, false);
        return;
      }

      // 1. Immediately emit verified user session from Firebase Auth + local cache so Home shell renders without waiting on Firestore
      const immediateUser = buildImmediateAppUser(fbUser);
      try {
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(immediateUser));
      } catch {}
      callback(immediateUser, true);

      // 2. Refresh full user profile from Firestore in the background and update state when ready
      mapFirebaseUserToAppUser(fbUser)
        .then((syncedUser) => {
          if (auth?.currentUser?.uid === fbUser.uid) {
            perf.milestone('User profile loaded', { uid: fbUser.uid });
            try {
              localStorage.setItem(AUTH_USER_KEY, JSON.stringify(syncedUser));
            } catch {}
            callback(syncedUser, true);
          }
        })
        .catch((err) => {
          console.warn('Background Firestore profile sync note:', err);
        });
    } catch (e) {
      console.error('Error mapping Firebase auth user:', e);
      callback(null, false);
    }
  });
}

/**
 * Retrieves the current verified user, if available.
 */
export async function getCurrentUser(): Promise<User | null> {
  if (auth?.currentUser) {
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified) {
      return mapFirebaseUserToAppUser(auth.currentUser);
    }
  }
  return null;
}

/**
 * Signs out of Firebase Authentication and native Google Credential Manager.
 */
export async function logout(): Promise<void> {
  localStorage.removeItem(AUTH_USER_KEY);

  if (Capacitor.isNativePlatform()) {
    try {
      await SocialLogin.logout({ provider: 'google' });
    } catch (e) {
      console.warn('SocialLogin logout notice:', e);
    }
  }

  if (auth) {
    await fbSignOut(auth);
  }
}

/**
 * Updates the user's profile in Firestore and local storage.
 */
export async function saveCurrentUser(user: User): Promise<void> {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.setItem(`sogo_profile_${user.id}`, JSON.stringify(user));

  // Also sync sogo_users_cache so local queries find the updated user
  try {
    const rawCache = localStorage.getItem('sogo_users_cache');
    if (rawCache) {
      const cachedUsers: User[] = JSON.parse(rawCache);
      let found = false;
      const updated = cachedUsers.map((u) => {
        if (u.id === user.id) {
          found = true;
          return { ...u, ...user };
        }
        return u;
      });
      if (!found) {
        updated.push(user);
      }
      localStorage.setItem('sogo_users_cache', JSON.stringify(updated));
    }
  } catch {}

  if (auth?.currentUser) {
    try {
      await updateFbProfile(auth.currentUser, {
        displayName: user.displayName,
        photoURL: user.avatarUrl,
      });
    } catch {}
  }

  if (db && user.id) {
    const targetUid = auth?.currentUser?.uid || user.id;
    try {
      const payload: Record<string, any> = {
        id: targetUid,
        uid: targetUid,
        displayName: user.displayName,
        fullName: user.displayName, // backward compatibility
        avatarUrl: user.avatarUrl,
        photoURL: user.avatarUrl,
        profilePhoto: user.avatarUrl,
        bio: user.bio || '',
        website: user.website || '',
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', targetUid), payload, { merge: true });
    } catch (firestoreErr) {
      console.warn('Could not persist updated user profile to Firestore:', firestoreErr);
    }
  }
}
