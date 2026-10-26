/**
 * SogoSocial Global Ad Coordination Service
 *
 * Ensures strict mutual exclusion between all full-screen ad formats:
 * - Creator Rewards Interstitial Ad
 * - Sogo Stars Rewarded Video Ad
 * - App Open Ad
 *
 * Guarantees that:
 * 1. No two full-screen ads can ever present simultaneously.
 * 2. Returning from one full-screen ad cannot immediately trigger another ad (10-second guard window).
 */

import { Capacitor } from '@capacitor/core';
import { AdMob, AdmobConsentStatus } from '@capacitor-community/admob';

export type FullScreenAdType = 'interstitial' | 'rewarded' | 'app_open';

let activeFullScreenAd: FullScreenAdType | null = null;
let lastFullScreenAdDismissedAt = 0;

let initializationPromise: Promise<void> | null = null;
let consentPromise: Promise<{ canRequestAds: boolean }> | null = null;
let cachedConsent: { canRequestAds: boolean } | null = null;

/**
 * Initializes AdMob once globally across all ad formats.
 */
export async function ensureAdMobInitialized(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  if (!initializationPromise) {
    initializationPromise = AdMob.initialize().catch((error) => {
      initializationPromise = null;
      console.warn('[AdCoordination] AdMob.initialize failed:', error);
      throw error;
    });
  }
  await initializationPromise;
}

/**
 * Requests UMP consent info once globally across all ad formats.
 * Concurrent requests share the same promise.
 */
export async function ensureAdConsent(): Promise<{ canRequestAds: boolean }> {
  if (Capacitor.getPlatform() !== 'android') {
    return { canRequestAds: false };
  }
  if (cachedConsent && cachedConsent.canRequestAds) {
    return cachedConsent;
  }
  if (consentPromise) {
    return consentPromise;
  }

  consentPromise = (async () => {
    try {
      let consent = await AdMob.requestConsentInfo();
      if (
        consent.isConsentFormAvailable &&
        consent.status === AdmobConsentStatus.REQUIRED
      ) {
        consent = await AdMob.showConsentForm();
      }
      cachedConsent = { canRequestAds: consent.canRequestAds === true };
      return cachedConsent;
    } catch (err) {
      console.warn('[AdCoordination] Ad consent resolution note:', err);
      // In debug / non-UMP environments, allow ad requests
      return { canRequestAds: true };
    } finally {
      consentPromise = null;
    }
  })();

  return consentPromise;
}

// Minimum buffer time (10 seconds) after closing any full-screen ad
// before an App Open ad is permitted to display.
export const POST_AD_SUPPRESSION_WINDOW_MS = 10000;

/**
 * Returns true if any full-screen ad is currently active or displaying.
 */
export function isFullScreenAdShowing(): boolean {
  return activeFullScreenAd !== null;
}

/**
 * Returns the currently active full-screen ad type, or null if none is showing.
 */
export function getActiveFullScreenAdType(): FullScreenAdType | null {
  return activeFullScreenAd;
}

/**
 * Returns the timestamp (ms) when the last full-screen ad was dismissed.
 */
export function getLastFullScreenAdDismissedAt(): number {
  return lastFullScreenAdDismissedAt;
}

/**
 * Checks whether an App Open ad is permitted to display right now based on full-screen ad state.
 */
export function canShowAppOpenAd(): boolean {
  if (isFullScreenAdShowing()) {
    return false;
  }
  const timeSinceLastDismissal = Date.now() - lastFullScreenAdDismissedAt;
  if (timeSinceLastDismissal < POST_AD_SUPPRESSION_WINDOW_MS) {
    return false;
  }
  return true;
}

/**
 * Marks that a full-screen ad has started presenting.
 */
export function markFullScreenAdStarted(type: FullScreenAdType): boolean {
  if (activeFullScreenAd !== null) {
    console.warn(`[AdCoordination] Blocked ${type} ad: ${activeFullScreenAd} is already active`);
    return false;
  }
  activeFullScreenAd = type;
  return true;
}

/**
 * Marks that the currently active full-screen ad has completed or was dismissed.
 */
export function markFullScreenAdEnded(type: FullScreenAdType): void {
  if (activeFullScreenAd === type) {
    activeFullScreenAd = null;
  } else if (activeFullScreenAd !== null) {
    console.warn(`[AdCoordination] Discrepancy: ending ${type} but active was ${activeFullScreenAd}`);
    activeFullScreenAd = null;
  }
  lastFullScreenAdDismissedAt = Date.now();
}
