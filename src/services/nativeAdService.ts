import { Capacitor } from '@capacitor/core';
import {
  NativeAdFeed,
  NativeAdTemplate,
  NativeAdStyle,
  NativeAdPluginEvents,
} from '@capacitor-community/admob';
import {
  ensureAdMobInitialized,
  ensureAdConsent,
} from './adCoordinationService';

export const TEST_NATIVE_AD_ID = 'ca-app-pub-3940256099942544/2247696110';
export const LIVE_NATIVE_FEED_ID = 'ca-app-pub-4186027945506385/8043791256';

export const USE_LIVE_ADS = import.meta.env.VITE_USE_LIVE_ADS === 'true';

// SogoSocial theme matching dark palette
export const sogoNativeAdStyle: NativeAdStyle = {
  backgroundColor: '#0F172A', // slate-900
  borderColor: '#1E293B',     // slate-800
  borderWidth: 1,
  cornerRadius: 16,           // rounded-2xl
  headlineColor: '#F8FAFC',   // slate-50
  headlineFontSize: 16,
  bodyColor: '#94A3B8',       // slate-400
  bodyFontSize: 13,
  callToActionBackgroundColor: '#06B6D4', // cyan-500
  callToActionTextColor: '#0F172A',       // slate-900
  callToActionFontSize: 14,
};

export type NativeSlotStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export interface NativeSlotRecord {
  status: NativeSlotStatus;
  errorCode?: number;
  errorMessage?: string;
  loadedAt?: number;
}

const slotStatusMap = new Map<string, NativeSlotRecord>();
const slotListeners = new Map<string, Set<(record: NativeSlotRecord) => void>>();

export function getNativeSlotRecord(slotKey: string): NativeSlotRecord {
  return slotStatusMap.get(slotKey) || { status: 'idle' };
}

export function subscribeNativeSlot(
  slotKey: string,
  listener: (record: NativeSlotRecord) => void
): () => void {
  let set = slotListeners.get(slotKey);
  if (!set) {
    set = new Set();
    slotListeners.set(slotKey, set);
  }
  set.add(listener);
  // Emit current state immediately to the listener
  listener(getNativeSlotRecord(slotKey));
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      slotListeners.delete(slotKey);
    }
  };
}

function updateSlotRecord(slotKey: string, record: NativeSlotRecord): void {
  slotStatusMap.set(slotKey, record);
  const set = slotListeners.get(slotKey);
  if (set) {
    set.forEach((fn) => fn(record));
  }
}

let homeFeedInstance: NativeAdFeed | null = null;
let homeFeedInitPromise: Promise<NativeAdFeed | null> | null = null;

export function isNativeAdSupported(): boolean {
  return Capacitor.getPlatform() === 'android';
}

function getNativeAdUnitId(): string {
  return USE_LIVE_ADS ? LIVE_NATIVE_FEED_ID : TEST_NATIVE_AD_ID;
}

/**
 * Gets or initializes the singleton NativeAdFeed for the Home screen.
 */
export async function getOrCreateHomeNativeFeed(): Promise<NativeAdFeed | null> {
  if (!isNativeAdSupported()) {
    return null;
  }

  if (homeFeedInstance) {
    return homeFeedInstance;
  }

  if (homeFeedInitPromise) {
    return homeFeedInitPromise;
  }

  homeFeedInitPromise = (async () => {
    try {
      const consent = await ensureAdConsent();
      if (!consent.canRequestAds) {
        console.warn('[NativeAds] Consent check denies ad requests.');
        return null;
      }

      await ensureAdMobInitialized();

      const adId = getNativeAdUnitId();
      const isTesting = !USE_LIVE_ADS;

      console.log('[NativeAds] 🚀 Initializing Home NativeAdFeed:', {
        feedId: 'home-feed',
        adId,
        isTesting,
        useLiveAds: USE_LIVE_ADS,
        template: NativeAdTemplate.Medium,
      });

      const feed = await NativeAdFeed.create({
        feedId: 'home-feed',
        adId,
        isTesting,
        template: NativeAdTemplate.Medium,
        style: sogoNativeAdStyle,
      });

      // Listen for Native Ad plugin events to manage slot state and diagnostics
      await feed.addListener(NativeAdPluginEvents.Loaded, (event: any) => {
        const slotKey = event?.slotKey;
        console.log(`[NativeAds] ✅ SUCCESS: Native ad loaded in slot: "${slotKey}"`, {
          feedId: event?.feedId,
          slotKey,
          adUnitId: adId,
        });
        if (slotKey) {
          updateSlotRecord(slotKey, { status: 'loaded', loadedAt: Date.now() });
        }
      });

      await feed.addListener(NativeAdPluginEvents.FailedToLoad, (event: any) => {
        const slotKey = event?.slotKey;
        console.warn(`[NativeAds] ❌ FAILURE: Native ad failed to load in slot: "${slotKey}"`, {
          feedId: event?.feedId,
          slotKey,
          adUnitId: adId,
          isTesting,
          useLiveAds: USE_LIVE_ADS,
          errorCode: event?.code,
          errorMessage: event?.message,
        });
        if (slotKey) {
          updateSlotRecord(slotKey, {
            status: 'failed',
            errorCode: event?.code,
            errorMessage: event?.message,
          });
        }
      });

      await feed.addListener(NativeAdPluginEvents.AdImpression, (event: any) => {
        console.log(`[NativeAds] 👁️ Impression recorded for slot: "${event?.slotKey}"`);
      });

      await feed.addListener(NativeAdPluginEvents.Clicked, (event: any) => {
        console.log(`[NativeAds] 👆 Click recorded for slot: "${event?.slotKey}"`);
      });

      homeFeedInstance = feed;
      return feed;
    } catch (err: any) {
      console.warn('[NativeAds] Failed to initialize Home NativeAdFeed:', err);
      return null;
    } finally {
      homeFeedInitPromise = null;
    }
  })();

  return homeFeedInitPromise;
}

/**
 * Attaches a DOM element to the Home native ad feed for a specific slot.
 */
export async function attachHomeNativeSlot(slotKey: string, element: HTMLElement): Promise<void> {
  if (!isNativeAdSupported() || !element) return;
  try {
    const current = getNativeSlotRecord(slotKey);
    if (current.status === 'idle') {
      updateSlotRecord(slotKey, { status: 'loading' });
    }

    const feed = await getOrCreateHomeNativeFeed();
    if (feed) {
      console.log(`[NativeAds] Attaching slot "${slotKey}" to NativeAdFeed...`);
      feed.attach(slotKey, element);
    } else {
      console.warn(`[NativeAds] Could not attach slot "${slotKey}": feed is null. Marking failed.`);
      updateSlotRecord(slotKey, {
        status: 'failed',
        errorMessage: 'Feed initialization returned null',
      });
    }
  } catch (err: any) {
    console.warn(`[NativeAds] Failed to attach slot ${slotKey}:`, err);
    updateSlotRecord(slotKey, {
      status: 'failed',
      errorMessage: err?.message || 'Failed to attach slot',
    });
  }
}

/**
 * Detaches a DOM element from the Home native ad feed.
 */
export function detachHomeNativeSlot(element: HTMLElement): void {
  if (!isNativeAdSupported() || !element) return;
  try {
    if (homeFeedInstance) {
      homeFeedInstance.detach(element);
    }
  } catch (err) {
    console.warn('[NativeAds] Failed to detach element:', err);
  }
}

/**
 * Pauses native ad overlays when leaving the Home screen.
 */
export async function pauseHomeNativeFeed(): Promise<void> {
  if (homeFeedInstance) {
    try {
      await homeFeedInstance.pause();
    } catch (err) {
      console.warn('[NativeAds] Pause note:', err);
    }
  }
}

/**
 * Resumes native ad overlays when returning to the Home screen.
 */
export function resumeHomeNativeFeed(): void {
  if (homeFeedInstance) {
    try {
      homeFeedInstance.resume();
    } catch (err) {
      console.warn('[NativeAds] Resume note:', err);
    }
  }
}

/**
 * Destroys the Home native feed upon component unmount.
 */
export async function destroyHomeNativeFeed(): Promise<void> {
  if (homeFeedInstance) {
    try {
      console.log('[NativeAds] Destroying Home NativeAdFeed upon feed unmount.');
      await homeFeedInstance.destroy();
    } catch (err) {
      console.warn('[NativeAds] Destroy note:', err);
    } finally {
      homeFeedInstance = null;
      slotStatusMap.clear();
    }
  }
}
