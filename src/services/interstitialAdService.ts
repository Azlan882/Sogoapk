import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  InterstitialAdPluginEvents,
} from '@capacitor-community/admob';

import {
  markFullScreenAdStarted,
  markFullScreenAdEnded,
  isFullScreenAdShowing,
  ensureAdMobInitialized,
  ensureAdConsent,
} from './adCoordinationService';

const TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712';
const LIVE_INTERSTITIAL_ID =
  import.meta.env.VITE_CREATOR_REWARDS_INTERSTITIAL_ID ||
  import.meta.env.VITE_INTERSTITIAL_AD_UNIT_ID ||
  'ca-app-pub-4186027945506385/8522429717';

const USE_LIVE_ADS = import.meta.env.VITE_USE_LIVE_ADS === 'true';

let isPreparing = false;
let isAdReady = false;
let isShowingAd = false;
let activeShowPromise: Promise<void> | null = null;
const INTERSTITIAL_COOLDOWN_MS = 5 * 60 * 1000; // 5-minute cooldown
let lastInterstitialShownAt = 0;

export function isInterstitialSupported(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Pre-loads the Creator Rewards interstitial ad in the background
 * so that when the user taps Creator Rewards, the ad displays without delay.
 */
export async function preloadCreatorRewardsInterstitial(): Promise<boolean> {
  if (!isInterstitialSupported()) return false;
  if (isAdReady || isPreparing || isShowingAd) return isAdReady;

  isPreparing = true;
  try {
    const consent = await ensureAdConsent();
    if (!consent.canRequestAds) {
      isPreparing = false;
      return false;
    }

    await ensureAdMobInitialized();

    const adId =
      USE_LIVE_ADS && LIVE_INTERSTITIAL_ID
        ? LIVE_INTERSTITIAL_ID
        : TEST_INTERSTITIAL_ID;

    await AdMob.prepareInterstitial({
      adId,
      isTesting: !USE_LIVE_ADS || !LIVE_INTERSTITIAL_ID,
    });

    isAdReady = true;
    return true;
  } catch (error) {
    console.warn('AdMob interstitial preload note:', error);
    isAdReady = false;
    return false;
  } finally {
    isPreparing = false;
  }
}

/**
 * Shows the Creator Rewards interstitial ad.
 * Returns a promise that resolves when the ad is dismissed or fails,
 * guaranteeing that navigation to Creator Rewards is never permanently blocked.
 * Prevents duplicate or concurrent launches.
 */
export async function showCreatorRewardsInterstitial(): Promise<void> {
  if (!isInterstitialSupported()) return;

  // 5-minute cooldown between interstitial impressions
  const now = Date.now();
  if (now - lastInterstitialShownAt < INTERSTITIAL_COOLDOWN_MS) {
    return;
  }

  // If already presenting an ad, return the ongoing promise to prevent duplicate launches
  if (isShowingAd && activeShowPromise) {
    return activeShowPromise;
  }

  // Prevent overlapping with other full-screen ads (Rewarded or App Open)
  if (isFullScreenAdShowing()) {
    return;
  }

  isShowingAd = true;
  markFullScreenAdStarted('interstitial');

  activeShowPromise = new Promise<void>(async (resolve) => {
    let finished = false;
    let dismissedHandle: PluginListenerHandle | null = null;
    let failedToShowHandle: PluginListenerHandle | null = null;
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      lastInterstitialShownAt = Date.now();
      markFullScreenAdEnded('interstitial');
      if (safetyTimeout) {
        clearTimeout(safetyTimeout);
        safetyTimeout = null;
      }
      dismissedHandle?.remove().catch(() => {});
      failedToShowHandle?.remove().catch(() => {});
      isShowingAd = false;
      activeShowPromise = null;
      // Preload next ad in background for future visits
      void preloadCreatorRewardsInterstitial();
    };

    const finish = () => {
      if (!finished) {
        finished = true;
        cleanup();
        resolve();
      }
    };

    // Safety timeout: in case native dismiss event is dropped by system, resume app within 15 seconds
    safetyTimeout = setTimeout(() => {
      console.warn('AdMob interstitial safety timeout reached.');
      finish();
    }, 15000);

    try {
      // If ad is not ready, attempt quick load with a 2.5s timeout
      if (!isAdReady) {
        const prepareSuccess = await Promise.race([
          preloadCreatorRewardsInterstitial(),
          new Promise<boolean>((res) => setTimeout(() => res(false), 2500)),
        ]);
        if (!prepareSuccess || !isAdReady) {
          finish();
          return;
        }
      }

      // Attach event listeners before calling show
      try {
        dismissedHandle = await AdMob.addListener(
          InterstitialAdPluginEvents.Dismissed,
          () => {
            isAdReady = false;
            finish();
          }
        );

        failedToShowHandle = await AdMob.addListener(
          InterstitialAdPluginEvents.FailedToShow,
          (err) => {
            console.warn('AdMob interstitial failed to show:', err);
            isAdReady = false;
            finish();
          }
        );
      } catch (listenerError) {
        console.warn('Error attaching interstitial listeners:', listenerError);
      }

      isAdReady = false;
      await AdMob.showInterstitial();
    } catch (showError) {
      console.warn('AdMob showInterstitial error:', showError);
      finish();
    }
  });

  return activeShowPromise;
}
