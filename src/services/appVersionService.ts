import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { App as CapApp } from '@capacitor/app';

export interface AppVersionInfo {
  versionCode: number;
  versionName: string;
  packageName: string;
  appName: string;
  isNativeAndroid: boolean;
}

export interface RemoteVersionConfig {
  minVersionCode: number;
  minVersionName?: string;
  latestVersionCode?: number;
  latestVersionName?: string;
  forceUpdate: boolean;
  title: string;
  message: string;
  releaseNotes?: string;
  playStoreUrl: string;
  updatedAt?: any;
  updatedBy?: string;
}

export interface VersionCheckResult {
  isUpdateRequired: boolean;
  currentInfo: AppVersionInfo;
  remoteConfig: RemoteVersionConfig | null;
  error?: string | null;
}

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sogo.social';
export const PLAY_STORE_MARKET_URI = 'market://details?id=com.sogo.social';

// Fallback baseline config aligned with the current Android build (versionCode 13, versionName 1.0)
export const DEFAULT_VERSION_CONFIG: RemoteVersionConfig = {
  minVersionCode: 13,
  minVersionName: '1.0',
  latestVersionCode: 13,
  latestVersionName: '1.0',
  forceUpdate: false,
  title: 'Update Required',
  message:
    'A newer version of SogoSocial is required to continue. Please update now from Google Play for the best performance, security, and latest features.',
  playStoreUrl: PLAY_STORE_URL,
};

let cachedAppInfo: AppVersionInfo | null = null;

/**
 * Retrieves the currently running application version and build/version code
 * using Capacitor App plugin on Android, with a safe fallback for web/dev environments.
 */
export async function getCurrentAppVersionInfo(): Promise<AppVersionInfo> {
  if (cachedAppInfo) {
    return cachedAppInfo;
  }

  try {
    const info = await CapApp.getInfo();
    const parsedBuild = parseInt(info.build, 10);
    const hasValidBuild = !isNaN(parsedBuild) && parsedBuild > 0;
    
    // Check if running inside Capacitor Android native container
    const isNativeAndroid =
      typeof window !== 'undefined' &&
      Boolean((window as any).Capacitor?.isNativePlatform?.() && (window as any).Capacitor?.getPlatform?.() === 'android');

    cachedAppInfo = {
      versionCode: hasValidBuild ? parsedBuild : 13,
      versionName: info.version || '1.0',
      packageName: info.id || 'com.sogo.social',
      appName: info.name || 'SogoSocial',
      isNativeAndroid,
    };
    return cachedAppInfo;
  } catch {
    cachedAppInfo = {
      versionCode: 13,
      versionName: '1.0',
      packageName: 'com.sogo.social',
      appName: 'SogoSocial',
      isNativeAndroid: false,
    };
    return cachedAppInfo;
  }
}

/**
 * Fetches the remote version configuration from Firestore (/app_config/version).
 * Returns null if the document does not yet exist.
 */
export async function fetchRemoteVersionConfig(): Promise<RemoteVersionConfig | null> {
  try {
    const docRef = doc(db, 'app_config', 'version');
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      const parsedMin = parseInt(data.minVersionCode, 10);
      const parsedLatest = parseInt(data.latestVersionCode, 10);

      return {
        minVersionCode: !isNaN(parsedMin) ? parsedMin : DEFAULT_VERSION_CONFIG.minVersionCode,
        minVersionName: data.minVersionName || DEFAULT_VERSION_CONFIG.minVersionName,
        latestVersionCode: !isNaN(parsedLatest) ? parsedLatest : DEFAULT_VERSION_CONFIG.latestVersionCode,
        latestVersionName: data.latestVersionName || DEFAULT_VERSION_CONFIG.latestVersionName,
        forceUpdate: typeof data.forceUpdate === 'boolean' ? data.forceUpdate : false,
        title: (data.title && typeof data.title === 'string' && data.title.trim()) || DEFAULT_VERSION_CONFIG.title,
        message: (data.message && typeof data.message === 'string' && data.message.trim()) || DEFAULT_VERSION_CONFIG.message,
        releaseNotes: data.releaseNotes || '',
        playStoreUrl: data.playStoreUrl || PLAY_STORE_URL,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      };
    }
    return null;
  } catch (err: any) {
    console.warn('[appVersionService] Error fetching /app_config/version:', err);
    throw err;
  }
}

/**
 * Checks whether the installed application meets the minimum required version.
 * Compares version codes numerically (never lexicographically) so versionCode 13 vs 14 is evaluated properly.
 */
export async function checkAppVersion(): Promise<VersionCheckResult> {
  const currentInfo = await getCurrentAppVersionInfo();

  try {
    const remoteConfig = await fetchRemoteVersionConfig();

    if (!remoteConfig) {
      return {
        isUpdateRequired: false,
        currentInfo,
        remoteConfig: DEFAULT_VERSION_CONFIG,
      };
    }

    const minCode = Number(remoteConfig.minVersionCode);
    const currentCode = Number(currentInfo.versionCode);

    // Only enforce mandatory update if forceUpdate is enabled AND installed code is strictly lower than minimum code
    const isUpdateRequired =
      Boolean(remoteConfig.forceUpdate) &&
      !isNaN(minCode) &&
      !isNaN(currentCode) &&
      currentCode < minCode;

    return {
      isUpdateRequired,
      currentInfo,
      remoteConfig,
    };
  } catch (err: any) {
    // Network or server error: do NOT block users permanently on cold start network blips
    return {
      isUpdateRequired: false,
      currentInfo,
      remoteConfig: null,
      error: err?.message || 'Unable to check for updates. Check internet connection.',
    };
  }
}

/**
 * Directs the user to the official Google Play listing for SogoSocial.
 * Attempts market:// intent for seamless deep linking into Google Play Store app,
 * with standard https fallback.
 */
export function openGooglePlayStore(targetUrl = PLAY_STORE_URL): void {
  try {
    const isAndroid =
      typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');

    if (isAndroid) {
      window.location.href = PLAY_STORE_MARKET_URI;
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 500);
      return;
    }
    window.location.href = targetUrl;
  } catch {
    window.location.href = targetUrl;
  }
}

/**
 * Updates or bootstraps the remote version configuration in Firestore.
 * Requires administrator permissions.
 */
export async function saveRemoteVersionConfig(
  config: Partial<RemoteVersionConfig>,
  adminEmail?: string
): Promise<void> {
  const docRef = doc(db, 'app_config', 'version');
  const payload: Record<string, any> = {
    updatedAt: serverTimestamp(),
    updatedBy: adminEmail || 'admin',
  };

  if (config.minVersionCode !== undefined) {
    payload.minVersionCode = Number(config.minVersionCode);
  }
  if (config.minVersionName !== undefined) {
    payload.minVersionName = String(config.minVersionName).trim();
  }
  if (config.latestVersionCode !== undefined) {
    payload.latestVersionCode = Number(config.latestVersionCode);
  }
  if (config.latestVersionName !== undefined) {
    payload.latestVersionName = String(config.latestVersionName).trim();
  }
  if (config.forceUpdate !== undefined) {
    payload.forceUpdate = Boolean(config.forceUpdate);
  }
  if (config.title !== undefined) {
    payload.title = String(config.title).trim();
  }
  if (config.message !== undefined) {
    payload.message = String(config.message).trim();
  }
  if (config.releaseNotes !== undefined) {
    payload.releaseNotes = String(config.releaseNotes).trim();
  }
  if (config.playStoreUrl !== undefined) {
    payload.playStoreUrl = String(config.playStoreUrl).trim();
  }

  await setDoc(docRef, payload, { merge: true });
}
