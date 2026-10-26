import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
} from '@capacitor-community/admob';
import {
  ensureAdMobInitialized,
  ensureAdConsent,
} from './adCoordinationService';

export const TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111';
export const LIVE_BANNER_ID = 'ca-app-pub-4186027945506385/7823290245';

// Only use live ads when the build explicitly sets this to "true".
export const USE_LIVE_ADS = import.meta.env.VITE_USE_LIVE_ADS === 'true';

export type BannerScreen = 'home' | 'profile';
export type BannerStatus = 'idle' | 'loading' | 'loaded' | 'failed';

const activeConsumers = new Set<BannerScreen>();
let hideDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentBannerStatus: BannerStatus = 'idle';
let currentAdUnitId: string | null = null;
let listenersInitialized = false;
const pluginHandles: PluginListenerHandle[] = [];

export function getBannerStatus(): BannerStatus {
  return currentBannerStatus;
}

export function getBannerAdId(): string {
  return USE_LIVE_ADS ? LIVE_BANNER_ID : TEST_BANNER_ID;
}

async function setupBannerEventListeners(): Promise<void> {
  if (listenersInitialized || Capacitor.getPlatform() !== 'android') return;
  listenersInitialized = true;

  try {
    const loadedHandle = await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
      currentBannerStatus = 'loaded';
      console.log(
        `[BannerAd] ✅ SUCCESS: Banner ad loaded successfully on screen(s): [${Array.from(activeConsumers).join(', ')}] ` +
        `(adUnitId: ${currentAdUnitId}, useLiveAds: ${USE_LIVE_ADS})`
      );
    });
    pluginHandles.push(loadedHandle);

    const failedHandle = await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (error: any) => {
      currentBannerStatus = 'failed';
      console.warn(
        `[BannerAd] ❌ FAILURE: Banner ad failed to load on screen(s): [${Array.from(activeConsumers).join(', ')}]`,
        {
          adUnitId: currentAdUnitId,
          isTesting: !USE_LIVE_ADS,
          useLiveAds: USE_LIVE_ADS,
          errorCode: error?.code,
          errorMessage: error?.message,
          responseInfo: error?.responseInfo,
          rawError: error,
        }
      );
    });
    pluginHandles.push(failedHandle);

    const sizeHandle = await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: any) => {
      console.log(`[BannerAd] 📐 SizeChanged event received: width=${size?.width}px, height=${size?.height}px`);
    });
    pluginHandles.push(sizeHandle);

    const openHandle = await AdMob.addListener(BannerAdPluginEvents.Opened, () => {
      console.log('[BannerAd] 📱 Banner opened overlay');
    });
    pluginHandles.push(openHandle);

    const closeHandle = await AdMob.addListener(BannerAdPluginEvents.Closed, () => {
      console.log('[BannerAd] 📱 Banner closed overlay');
    });
    pluginHandles.push(closeHandle);
  } catch (err) {
    console.warn('[BannerAd] Could not attach banner event listeners:', err);
  }
}

/**
 * Requests that the banner ad be displayed for a specific screen ('home' or 'profile').
 * Coordinated lifecycle: If a banner is already active or in-flight, it stays alive without
 * teardown, preventing race conditions when navigating between Home and Profile.
 */
export async function requestBanner(screen: BannerScreen): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;

  activeConsumers.add(screen);
  if (hideDebounceTimer) {
    clearTimeout(hideDebounceTimer);
    hideDebounceTimer = null;
  }

  // If banner is already showing or loading, maintain it seamlessly
  if (currentBannerStatus === 'loaded' || currentBannerStatus === 'loading') {
    console.log(
      `[BannerAd] 🔄 Screen "${screen}" joined active banner consumers ([${Array.from(activeConsumers).join(', ')}]). ` +
      `Preserving existing banner view without teardown.`
    );
    return;
  }

  try {
    const consent = await ensureAdConsent();
    if (!consent.canRequestAds) {
      console.warn(`[BannerAd] ⚠️ Cannot request banner on "${screen}": consent policy denies ad requests.`);
      return;
    }

    await ensureAdMobInitialized();
    await setupBannerEventListeners();

    const adId = getBannerAdId();
    currentAdUnitId = adId;
    currentBannerStatus = 'loading';

    console.log(`[BannerAd] 🚀 Requesting banner ad for screen "${screen}":`, {
      adId,
      isTesting: !USE_LIVE_ADS,
      useLiveAds: USE_LIVE_ADS,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 72,
    });

    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 72,
      isTesting: !USE_LIVE_ADS,
    });
  } catch (error) {
    currentBannerStatus = 'failed';
    console.warn(`[BannerAd] showBanner exception on "${screen}":`, error);
  }
}

/**
 * Releases a screen's claim on the banner ad.
 * Uses a 250ms debounce so navigating between Home and Profile preserves the banner smoothly
 * without one component's unmount cleanup destroying the other's banner.
 */
export function releaseBanner(screen: BannerScreen): void {
  if (Capacitor.getPlatform() !== 'android') return;

  activeConsumers.delete(screen);
  console.log(
    `[BannerAd] 📤 Screen "${screen}" released banner. Remaining active consumers: [${Array.from(activeConsumers).join(', ')}]`
  );

  if (activeConsumers.size === 0) {
    if (hideDebounceTimer) clearTimeout(hideDebounceTimer);
    hideDebounceTimer = setTimeout(async () => {
      if (activeConsumers.size === 0) {
        console.log('[BannerAd] 🧹 Cleanup: No active screens require banner. Removing native banner view.');
        try {
          await AdMob.removeBanner();
        } catch (err) {
          console.warn('[BannerAd] removeBanner error note:', err);
        } finally {
          currentBannerStatus = 'idle';
          currentAdUnitId = null;
        }
      }
    }, 250);
  }
}
