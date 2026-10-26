/**
 * SogoSocial Google Play Install Referrer Service
 *
 * Integrates with Google Play Install Referrer API on Android via the native
 * Capacitor `InstallReferrer` plugin.
 *
 * Captures referral attribution when a user clicks a Google Play Store invite link
 * (e.g. https://play.google.com/store/apps/details?id=com.sogo.social&referrer=referral_code%3DSOGO-USER),
 * installs the app, and opens it for the first time.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { setPendingReferralCode, getPendingReferralCode } from './rewardsService';

export interface InstallReferrerResult {
  success: boolean;
  installReferrer?: string;
  referrerClickTimestamp?: number;
  installBeginTimestamp?: number;
  googlePlayInstant?: boolean;
  error?: string;
}

export interface InstallReferrerPluginInterface {
  getInstallReferrer(): Promise<InstallReferrerResult>;
}

export const InstallReferrer = registerPlugin<InstallReferrerPluginInterface>('InstallReferrer');

// Local storage persistent tracking keys
export const KEY_INSTALL_REFERRER_CHECKED = 'sogosocial_install_referrer_checked';
export const KEY_INSTALL_REFERRER_RAW = 'sogosocial_install_referrer_raw';
export const KEY_INSTALL_REFERRER_PARSED = 'sogosocial_install_referrer_parsed_code';

/**
 * Safely parses the inviter's referral code from the Google Play install referrer string.
 *
 * Google Play passes the decoded query string of the original &referrer= parameter.
 * Example input:
 * - "referral_code=SOGO-ALEXANDER"
 * - "referral_code=SOGO-ALEXANDER&utm_source=google-play"
 * - "ref=SOGO-ALEXANDER"
 * - "referral_code%3DSOGO-ALEXANDER" (in case doubly encoded)
 */
export function parseReferralCodeFromReferrerString(rawReferrer: string): string | null {
  if (!rawReferrer || typeof rawReferrer !== 'string') {
    return null;
  }

  const trimmed = rawReferrer.trim();
  if (!trimmed) {
    return null;
  }

  // Attempt URL decoding in case the string is still percent-encoded
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  // 1. Try URLSearchParams parsing
  try {
    // If the string starts with '?' or doesn't, ensure URLSearchParams can parse key=value pairs
    const searchStr = decoded.startsWith('?') ? decoded.slice(1) : decoded;
    const params = new URLSearchParams(searchStr);

    const candidates = [
      params.get('referral_code'),
      params.get('ref'),
      params.get('referral'),
      params.get('referrer'),
      params.get('code'),
      params.get('utm_content'),
    ];

    for (const c of candidates) {
      if (c && c.trim()) {
        const clean = c.trim().toUpperCase();
        if (clean.startsWith('SOGO-') || /^[A-Z0-9_-]{3,30}$/.test(clean)) {
          return clean;
        }
      }
    }
  } catch (err) {
    console.warn('[InstallReferrer] URLSearchParams parse note:', err);
  }

  // 2. Regex fallback for key=value patterns
  const patterns = [
    /(?:^|[&?])referral_code=([^&]+)/i,
    /(?:^|[&?])ref=([^&]+)/i,
    /(?:^|[&?])referral=([^&]+)/i,
    /(?:^|[&?])code=([^&]+)/i,
    /\b(SOGO-[A-Z0-9_-]+)\b/i,
  ];

  for (const regex of patterns) {
    const match = decoded.match(regex);
    if (match && match[1]) {
      try {
        const val = decodeURIComponent(match[1]).trim().toUpperCase();
        if (val) return val;
      } catch {
        const val = match[1].trim().toUpperCase();
        if (val) return val;
      }
    }
  }

  return null;
}

let isCheckInProgress = false;

/**
 * Initializes and queries the Google Play Install Referrer API on first Android launch.
 *
 * Invariants:
 * - Runs asynchronously in the background; never blocks app startup, render, or Google Sign-In.
 * - Idempotent: once checked and recorded in localStorage, skips re-querying on subsequent launches.
 * - Respects precedence: if a user already has an active pending referral code (e.g. from an
 *   explicit web link), preserves it while still recording the raw install referrer for auditability.
 * - Persists the parsed referral code into `sogosocial_pending_referral_code` so it safely survives
 *   app restarts, Google Sign-In, and onboarding.
 */
export async function initInstallReferrerAttribution(): Promise<string | null> {
  // Only supported on native Android
  if (Capacitor.getPlatform() !== 'android') {
    return null;
  }

  // Check if we have already queried the native API on this installation
  try {
    const alreadyChecked = localStorage.getItem(KEY_INSTALL_REFERRER_CHECKED);
    if (alreadyChecked === 'true') {
      const existingParsed = localStorage.getItem(KEY_INSTALL_REFERRER_PARSED);
      return existingParsed || null;
    }
  } catch {}

  if (isCheckInProgress) {
    return null;
  }

  isCheckInProgress = true;

  try {
    console.log('[InstallReferrer] 🚀 Querying Google Play Install Referrer API on first launch...');
    const result = await InstallReferrer.getInstallReferrer();

    console.log('[InstallReferrer] Response received from native bridge:', {
      success: result.success,
      installReferrer: result.installReferrer,
      error: result.error,
      clickTimestamp: result.referrerClickTimestamp,
      installTimestamp: result.installBeginTimestamp,
    });

    if (result.success && result.installReferrer) {
      const raw = result.installReferrer;
      try {
        localStorage.setItem(KEY_INSTALL_REFERRER_RAW, raw);
      } catch {}

      const parsedCode = parseReferralCodeFromReferrerString(raw);
      if (parsedCode) {
        console.log(`[InstallReferrer] ✅ Successfully parsed referral code: "${parsedCode}" from Play Store referrer`);

        try {
          localStorage.setItem(KEY_INSTALL_REFERRER_PARSED, parsedCode);
        } catch {}

        // Precedence: If no pending code is currently set, apply the Play Store referrer code
        const currentPending = getPendingReferralCode();
        if (!currentPending) {
          setPendingReferralCode(parsedCode);
          console.log(`[InstallReferrer] 📌 Saved "${parsedCode}" as active pending referral code`);
        } else {
          console.log(
            `[InstallReferrer] ℹ️ Existing pending code "${currentPending}" preserved; ` +
            `Play Store code "${parsedCode}" recorded in backup storage`
          );
        }

        try {
          localStorage.setItem(KEY_INSTALL_REFERRER_CHECKED, 'true');
        } catch {}

        return parsedCode;
      } else {
        console.log('[InstallReferrer] ℹ️ Play Store install referrer was empty or contained no referral_code parameter');
      }
    } else {
      console.log(
        `[InstallReferrer] ℹ️ Native response: ${result.error || 'No install referrer available'} ` +
        `(Expected for direct debug APK installations without Google Play campaign link)`
      );
    }

    // Mark as checked to prevent duplicate native calls
    try {
      localStorage.setItem(KEY_INSTALL_REFERRER_CHECKED, 'true');
    } catch {}

    return null;
  } catch (err) {
    console.warn('[InstallReferrer] Non-blocking install referrer check exception:', err);
    return null;
  } finally {
    isCheckInProgress = false;
  }
}
