import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  AppOpenAdPluginEvents,
} from '@capacitor-community/admob';
import {
  canShowAppOpenAd,
  markFullScreenAdStarted,
  markFullScreenAdEnded,
  ensureAdMobInitialized,
  ensureAdConsent,
} from './adCoordinationService';

const TEST_APP_OPEN_ID = 'ca-app-pub-3940256099942544/9257395921';
const LIVE_APP_OPEN_ID = 'ca-app-pub-4186027945506385/2475769805';

const USE_LIVE_ADS = import.meta.env.VITE_USE_LIVE_ADS === 'true';

// Persistent storage keys
const KEY_HAS_LAUNCHED_BEFORE = 'sogo_has_launched_before';
const KEY_LAST_APP_OPEN_TIMESTAMP = 'sogo_last_app_open_ad_timestamp';

// 4-hour persistent interval requirement (4 * 60 * 60 * 1000 ms)
export const APP_OPEN_COOLDOWN_MS = 4 * 60 * 60 * 1000;

let isPreloading = false;
let isShowing = false;

export function isAppOpenSupported(): boolean {
  return Capacitor.getPlatform() === 'android';
}

function getAppOpenAdId(): string {
  return USE_LIVE_ADS ? LIVE_APP_OPEN_ID : TEST_APP_OPEN_ID;
}

/**
 * Checks if the user is a returning user (not their very first cold start).
 * On first launch, this sets the flag and returns false to prevent an immediate ad.
 */
export function checkIsReturningUserAndMark(): boolean {
  try {
    const hasLaunched = localStorage.getItem(KEY_HAS_LAUNCHED_BEFORE);
    if (!hasLaunched) {
      localStorage.setItem(KEY_HAS_LAUNCHED_BEFORE, 'true');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether the persistent 4-hour interval has elapsed since the last App Open ad.
 */
export function isAppOpenCooldownElapsed(): boolean {
  try {
    const lastTimestampStr = localStorage.getItem(KEY_LAST_APP_OPEN_TIMESTAMP);
    if (!lastTimestampStr) return true;
    const lastTimestamp = Number(lastTimestampStr);
    if (isNaN(lastTimestamp) || lastTimestamp <= 0) return true;
    return Date.now() - lastTimestamp >= APP_OPEN_COOLDOWN_MS;
  } catch {
    return true;
  }
}

/**
 * Records the timestamp of an App Open ad display in persistent storage.
 */
function recordAppOpenAdShown(): void {
  try {
    localStorage.setItem(KEY_LAST_APP_OPEN_TIMESTAMP, String(Date.now()));
  } catch (err) {
    console.warn('[AppOpenAd] Failed to persist timestamp:', err);
  }
}

export async function preloadAppOpenAd(): Promise<boolean> {
  if (!isAppOpenSupported()) return false;
  if (isPreloading || isShowing) return false;

  isPreloading = true;
  try {
    const consent = await ensureAdConsent();
    if (!consent.canRequestAds) {
      return false;
    }

    await ensureAdMobInitialized();
    const adId = getAppOpenAdId();

    // Check if already loaded
    try {
      const { value: isLoaded } = await AdMob.isAppOpenLoaded({ adId });
      if (isLoaded) {
        return true;
      }
    } catch {
      // Continue to load
    }

    await AdMob.loadAppOpen({ adId });
    return true;
  } catch (err) {
    console.warn('[AppOpenAd] Preload error (safe fallback):', err);
    return false;
  } finally {
    isPreloading = false;
  }
}

/**
 * Evaluates whether an App Open ad should display on app launch or resume.
 *
 * Enforces:
 * 1. Returning user check (never on first cold launch).
 * 2. 4-hour persistent cooldown.
 * 3. Mutual exclusion: no overlapping full-screen ads, and not immediately after returning from another ad.
 * 4. Preload availability: shows ONLY if already loaded; never freezes or holds app startup.
 * 5. Safe failure handling and background reload.
 */
export async function tryShowAppOpenAd(trigger: 'launch' | 'resume'): Promise<boolean> {
  if (!isAppOpenSupported()) return false;

  // 1. First-launch protection: only show to returning users
  const isReturning = checkIsReturningUserAndMark();
  if (!isReturning) {
    // First launch ever: do not show ad, but preload in background for future launches
    void preloadAppOpenAd();
    return false;
  }

  // 2. Persistent 4-hour cooldown enforcement
  if (!isAppOpenCooldownElapsed()) {
    // Cooldown still active; silently preload if needed and proceed
    void preloadAppOpenAd();
    return false;
  }

  // 3. Mutual exclusion: check that no other full-screen ad is active or recently dismissed
  if (!canShowAppOpenAd() || isShowing) {
    return false;
  }

  // 4. Consent verification
  const consent = await ensureAdConsent();
  if (!consent.canRequestAds) {
    return false;
  }

  await ensureAdMobInitialized();
  const adId = getAppOpenAdId();

  // 5. Verification: must already be loaded (never block startup waiting for network ad response)
  try {
    const { value: isLoaded } = await AdMob.isAppOpenLoaded({ adId });
    if (!isLoaded) {
      // Ad not preloaded; kick off preload in background for next time and let user enter immediately
      void preloadAppOpenAd();
      return false;
    }
  } catch (err) {
    console.warn('[AppOpenAd] Error checking isAppOpenLoaded:', err);
    void preloadAppOpenAd();
    return false;
  }

  // 6. Presentation
  isShowing = true;
  const started = markFullScreenAdStarted('app_open');
  if (!started) {
    isShowing = false;
    return false;
  }

  return new Promise<boolean>(async (resolve) => {
    let closedHandle: PluginListenerHandle | null = null;
    let failedToShowHandle: PluginListenerHandle | null = null;
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (safetyTimeout) {
        clearTimeout(safetyTimeout);
        safetyTimeout = null;
      }
      closedHandle?.remove().catch(() => {});
      failedToShowHandle?.remove().catch(() => {});
      markFullScreenAdEnded('app_open');
      isShowing = false;
      // Preload next ad in background for subsequent sessions
      void preloadAppOpenAd();
    };

    const finish = (shown: boolean) => {
      if (!settled) {
        settled = true;
        if (shown) {
          recordAppOpenAdShown();
        }
        cleanup();
        resolve(shown);
      }
    };

    // Safety timeout in case system drops native dismissal callback
    safetyTimeout = setTimeout(() => {
      console.warn('[AppOpenAd] Safety watchdog timeout reached');
      finish(false);
    }, 12000);

    try {
      closedHandle = await AdMob.addListener(AppOpenAdPluginEvents.Closed, () => {
        finish(true);
      });

      failedToShowHandle = await AdMob.addListener(
        AppOpenAdPluginEvents.FailedToShow,
        (err) => {
          console.warn('[AppOpenAd] Failed to show:', err);
          finish(false);
        }
      );

      await AdMob.showAppOpen({ adId });
    } catch (err) {
      console.warn('[AppOpenAd] showAppOpen error:', err);
      finish(false);
    }
  });
}
