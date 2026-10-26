import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  RewardAdPluginEvents,
  AdMobRewardItem,
} from '@capacitor-community/admob';

import {
  markFullScreenAdStarted,
  markFullScreenAdEnded,
  isFullScreenAdShowing,
  ensureAdMobInitialized,
  ensureAdConsent,
} from './adCoordinationService';

const TEST_REWARDED_AD_ID = 'ca-app-pub-3940256099942544/5224354917';
const LIVE_REWARDED_AD_ID = 'ca-app-pub-4186027945506385/3349245650';

const USE_LIVE_ADS = import.meta.env.VITE_USE_LIVE_ADS === 'true';

let isAdRequestInProgress = false;

export function isRewardedAdSupported(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export interface PlayRewardedAdResult {
  success: boolean;
  rewardEarned: boolean;
  rewardItem?: AdMobRewardItem;
  error?: string;
  errorMessage?: string;
}

/**
 * Prepares and displays a Rewarded Video Ad via @capacitor-community/admob.
 * Resolves only after the ad completes or is dismissed/fails.
 *
 * CRITICAL INVARIANT:
 * `rewardEarned` is strictly `true` ONLY if the native plugin confirms that
 * the user earned the reward (via RewardAdPluginEvents.Rewarded or resolved reward item).
 * Dismissal without earning guarantees `rewardEarned: false`.
 */
export async function playRewardedAd(userId?: string): Promise<PlayRewardedAdResult> {
  if (!isRewardedAdSupported()) {
    return {
      success: false,
      rewardEarned: false,
      error: 'PLATFORM_NOT_SUPPORTED',
      errorMessage: 'Rewarded ads are only supported on the native Android app.',
    };
  }

  if (isAdRequestInProgress || isFullScreenAdShowing()) {
    return {
      success: false,
      rewardEarned: false,
      error: 'IN_PROGRESS',
      errorMessage: 'An ad is already active or loading. Please wait a moment.',
    };
  }

  isAdRequestInProgress = true;

  try {
    // 1. Consent
    const consent = await ensureAdConsent();
    if (!consent.canRequestAds) {
      isAdRequestInProgress = false;
      return {
        success: false,
        rewardEarned: false,
        error: 'CONSENT_DENIED',
        errorMessage: 'Ad consent is required to watch rewarded ads.',
      };
    }

    // 2. Initialize
    await ensureAdMobInitialized();

    // 3. Select Ad Unit
    const adId = USE_LIVE_ADS ? LIVE_REWARDED_AD_ID : TEST_REWARDED_AD_ID;

    // 4. Prepare Ad with SSV metadata if userId provided
    await AdMob.prepareRewardVideoAd({
      adId,
      isTesting: !USE_LIVE_ADS,
      ...(userId ? { ssv: { userId } } : {}),
    });

    markFullScreenAdStarted('rewarded');

    // 5. Present ad and track explicit reward confirmation
    return await new Promise<PlayRewardedAdResult>(async (resolve) => {
      let rewardEarned = false;
      let earnedItem: AdMobRewardItem | undefined;
      let settled = false;

      let rewardedHandle: PluginListenerHandle | null = null;
      let dismissedHandle: PluginListenerHandle | null = null;
      let failedToShowHandle: PluginListenerHandle | null = null;
      let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        markFullScreenAdEnded('rewarded');
        if (safetyTimeout) {
          clearTimeout(safetyTimeout);
          safetyTimeout = null;
        }
        rewardedHandle?.remove().catch(() => {});
        dismissedHandle?.remove().catch(() => {});
        failedToShowHandle?.remove().catch(() => {});
        isAdRequestInProgress = false;
      };

      const finish = (result: PlayRewardedAdResult) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      };

      // Watchdog timeout in case native events are swallowed (60s)
      safetyTimeout = setTimeout(() => {
        finish({
          success: false,
          rewardEarned: false,
          error: 'TIMEOUT',
          errorMessage: 'The rewarded ad timed out. Please try again.',
        });
      }, 60000);

      try {
        rewardedHandle = await AdMob.addListener(
          RewardAdPluginEvents.Rewarded,
          (reward: AdMobRewardItem) => {
            rewardEarned = true;
            earnedItem = reward;
          }
        );

        dismissedHandle = await AdMob.addListener(
          RewardAdPluginEvents.Dismissed,
          () => {
            if (rewardEarned) {
              finish({
                success: true,
                rewardEarned: true,
                rewardItem: earnedItem,
              });
            } else {
              finish({
                success: true,
                rewardEarned: false,
                error: 'DISMISSED_EARLY',
                errorMessage:
                  'Ad closed before completion. You must watch the entire ad to earn Stars.',
              });
            }
          }
        );

        failedToShowHandle = await AdMob.addListener(
          RewardAdPluginEvents.FailedToShow,
          (err) => {
            console.warn('Rewarded ad failed to show:', err);
            finish({
              success: false,
              rewardEarned: false,
              error: 'FAILED_TO_SHOW',
              errorMessage: 'Could not display the ad. Please try again.',
            });
          }
        );

        const directReward = await AdMob.showRewardVideoAd({ adId });
        if (directReward && (directReward.amount > 0 || directReward.type)) {
          rewardEarned = true;
          earnedItem = directReward;
        }
      } catch (err: any) {
        console.warn('AdMob showRewardVideoAd error:', err);
        finish({
          success: false,
          rewardEarned: false,
          error: 'SHOW_ERROR',
          errorMessage: err?.message || 'Could not display the ad. Please try again.',
        });
      }
    });
  } catch (prepError: any) {
    isAdRequestInProgress = false;
    console.warn('AdMob prepareRewardVideoAd error:', prepError);
    return {
      success: false,
      rewardEarned: false,
      error: 'LOAD_ERROR',
      errorMessage:
        'Could not load rewarded ad. Please check your internet connection and try again.',
    };
  }
}
