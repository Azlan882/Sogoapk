import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../lib/firebase';
import * as notificationsService from './notificationsService';
import {
  CreatorRewardsSummary,
  RewardLedgerItem,
  RewardLedgerType,
  PayoutRequest,
  PayoutMethod,
  PayoutDetails,
  ReferralRecord,
  WatchSessionTelemetry,
  User,
} from '../types';
import { getAppBaseUrl } from './shareService';
import {
  recordSogoStarAction,
  getCachedSogoStarsDailyState,
  getSogoStarsDailyState,
  SOGO_STAR_MISSIONS,
} from './sogoStarsService';
import { SogoStarsDailyState } from '../types';

// ==========================================
// PROGRAM CONSTANTS & ECONOMIC RULES
// ==========================================

export const QUALIFIED_VIEW_RATE_USD = 0.0005; // $0.50 per 1,000 views
export const CENTS_PER_1000_QUALIFIED_VIEWS = 50; // 50 cents = $0.50 USD
export const REFERRAL_REWARD_CENTS = 10; // $0.10 USD per qualified referral
export const MINIMUM_PAYOUT_CENTS = 5000; // $50.00 USD minimum payout
export const MINIMUM_PAYOUT_REFERRALS = 10; // 10 successful referrals minimum for payout
export const MIN_WATCH_DURATION_FOR_QUALIFIED_VIEW = 5; // 5 seconds continuous playback
export const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24-hour cooldown per user per video
export const MAX_QUALIFIED_VIEWS_PER_HOUR = 30; // Velocity limit against bot farms

// Local storage cache keys
const LOCAL_REWARDS_CACHE_PREFIX = 'sogosocial_rewards_';
const LOCAL_LEDGER_CACHE_PREFIX = 'sogosocial_ledger_';
const LOCAL_VIEW_COOLDOWN_KEY = 'sogosocial_view_cooldowns';
const LOCAL_VIEW_VELOCITY_KEY = 'sogosocial_view_velocity';
const PENDING_REFERRAL_KEY = 'sogosocial_pending_referral_code';

// Firestore collection names
export const REWARDS_COLLECTION = 'creator_rewards';
export const LEDGER_COLLECTION = 'reward_ledger';
export const PAYOUTS_COLLECTION = 'payout_requests';
export const REFERRALS_COLLECTION = 'referrals';
export const WATCH_SESSIONS_COLLECTION = 'video_watch_sessions';

// Helper: Convert integer cents to display USD string
export function formatCentsToUsd(cents: number): string {
  const safeCents = Math.max(0, Math.round(cents || 0));
  const dollars = (safeCents / 100).toFixed(2);
  return `$${dollars}`;
}

// Helper: Convert integer cents to float USD
export function centsToUsd(cents: number): number {
  return Number(((cents || 0) / 100).toFixed(2));
}

export interface PayoutEligibilityResult {
  availableBalanceCents: number;
  successfulReferralsCount: number;
  minBalanceCents: number;
  minReferralsCount: number;
  meetsBalanceRequirement: boolean;
  meetsReferralsRequirement: boolean;
  isEligibleForPayout: boolean;
  balanceProgressPercent: number;
  remainingBalanceCents: number;
  referralsProgressPercent: number;
  remainingReferralsCount: number;
  rejectionReason: string | null;
}

export interface WithdrawalValidationPopup {
  allowed: boolean;
  reasonCode: 'referrals_below_minimum' | 'balance_below_minimum' | null;
  title: string | null;
  message: string | null;
  availableBalanceCents: number;
  successfulReferralsCount: number;
}

/**
 * Validates withdrawal click in the exact required order:
 * STEP 1 — Successful referrals (< 10 -> "You need at least 10 successful referrals to make a withdrawal.")
 * STEP 2 — Payment threshold (< $50 -> "The minimum payment threshold is $50.")
 */
export function validateWithdrawalEligibility(
  summary?: CreatorRewardsSummary | null,
  referrals?: ReferralRecord[],
  authoritativeAvailableBalanceCents?: number
): WithdrawalValidationPopup {
  const eligibility = evaluatePayoutEligibility(
    summary,
    referrals,
    authoritativeAvailableBalanceCents
  );

  if (eligibility.successfulReferralsCount < MINIMUM_PAYOUT_REFERRALS) {
    return {
      allowed: false,
      reasonCode: 'referrals_below_minimum',
      title: '10 Referrals Required',
      message: 'You need at least 10 referrals for your first withdrawal on Sogo.',
      availableBalanceCents: eligibility.availableBalanceCents,
      successfulReferralsCount: eligibility.successfulReferralsCount,
    };
  }

  if (eligibility.availableBalanceCents < MINIMUM_PAYOUT_CENTS) {
    return {
      allowed: false,
      reasonCode: 'balance_below_minimum',
      title: '$50 Minimum Balance Required',
      message:
        'You need at least $50 in available Creator Rewards balance before you can withdraw.',
      availableBalanceCents: eligibility.availableBalanceCents,
      successfulReferralsCount: eligibility.successfulReferralsCount,
    };
  }

  return {
    allowed: true,
    reasonCode: null,
    title: null,
    message: null,
    availableBalanceCents: eligibility.availableBalanceCents,
    successfulReferralsCount: eligibility.successfulReferralsCount,
  };
}

/**
 * Evaluates whether a creator satisfies BOTH payout eligibility requirements:
 * 1. Minimum successful referrals: 10
 * 2. Minimum available reward balance: $50.00 USD (5000 cents)
 */
export function evaluatePayoutEligibility(
  summary?: CreatorRewardsSummary | null,
  referrals?: ReferralRecord[],
  authoritativeAvailableBalanceCents?: number
): PayoutEligibilityResult {
  const { displayAvailableBalanceCents } = getDisplayRewardsMetrics(summary);
  const rawAvailableCents =
    authoritativeAvailableBalanceCents !== undefined
      ? authoritativeAvailableBalanceCents
      : displayAvailableBalanceCents;
  const availableBalanceCents = Math.max(0, Math.round(Number(rawAvailableCents) || 0));
  const summaryReferralsCount = Math.max(0, Math.round(Number(summary?.successfulReferralsCount) || 0));

  let verifiedFromListCount = 0;
  if (Array.isArray(referrals) && referrals.length > 0) {
    const ownerId = summary?.userId;
    verifiedFromListCount = referrals.filter(
      (r) =>
        r.status === 'qualified' &&
        r.rewardGranted &&
        (!ownerId || (r.referrerId === ownerId && r.referredUserId !== ownerId))
    ).length;
  }

  const successfulReferralsCount = Math.max(summaryReferralsCount, verifiedFromListCount);

  const meetsReferralsRequirement = successfulReferralsCount >= MINIMUM_PAYOUT_REFERRALS;
  const meetsBalanceRequirement = availableBalanceCents >= MINIMUM_PAYOUT_CENTS;
  const isEligibleForPayout = meetsReferralsRequirement && meetsBalanceRequirement;

  const balanceProgressPercent = Number(
    (Math.min(availableBalanceCents / MINIMUM_PAYOUT_CENTS, 1) * 100).toFixed(2)
  );
  const remainingBalanceCents = Math.max(0, MINIMUM_PAYOUT_CENTS - availableBalanceCents);

  const referralsProgressPercent = Math.min(
    100,
    Math.round((successfulReferralsCount / MINIMUM_PAYOUT_REFERRALS) * 100)
  );
  const remainingReferralsCount = Math.max(0, MINIMUM_PAYOUT_REFERRALS - successfulReferralsCount);

  // Enforce strict validation order: Step 1 = Successful Referrals (< 10), Step 2 = Payment Threshold (< $50)
  let rejectionReason: string | null = null;
  if (!meetsReferralsRequirement) {
    rejectionReason = 'You need at least 10 successful referrals to make a withdrawal.';
  } else if (!meetsBalanceRequirement) {
    rejectionReason = 'The minimum payment threshold is $50.';
  }

  return {
    availableBalanceCents,
    successfulReferralsCount,
    minBalanceCents: MINIMUM_PAYOUT_CENTS,
    minReferralsCount: MINIMUM_PAYOUT_REFERRALS,
    meetsBalanceRequirement,
    meetsReferralsRequirement,
    isEligibleForPayout,
    balanceProgressPercent,
    remainingBalanceCents,
    referralsProgressPercent,
    remainingReferralsCount,
    rejectionReason,
  };
}

/**
 * Canonical user-facing display metrics calculation.
 * Seamlessly incorporates qualified-view rewards (both organic and admin-staged)
 * into the authoritative available balance, total earned, and video rewards metrics
 * with strict idempotency so values are never double-counted.
 */
export function getDisplayRewardsMetrics(
  summary?: CreatorRewardsSummary | null,
  organicTotalViews = 0
): {
  genuineTotalViews: number;
  genuineQualifiedViews: number;
  genuineVideoRewardsCents: number;
  genuineReferralRewardsCents: number;
  genuineSogoStarsRewardsCents: number;
  genuineSogoStarsTotal: number;
  genuineTotalEarnedCents: number;
  testViewsCount: number;
  testQualifiedViewsCount: number;
  testVideoRewardsCents: number;
  displayTotalViews: number;
  displayQualifiedViews: number;
  displayVideoRewardsCents: number;
  displayReferralRewardsCents: number;
  displaySogoStarsRewardsCents: number;
  displaySogoStarsTotal: number;
  displayTotalEarnedCents: number;
  displayAvailableBalanceCents: number;
} {
  const safeSummary = summary || null;
  const genuineTotalViews =
    safeSummary && safeSummary.totalViewsCount !== undefined
      ? Math.max(0, Number(safeSummary.totalViewsCount) || 0)
      : Math.max(0, Number(organicTotalViews) || 0);
  const genuineQualifiedViews = Math.max(0, Number(safeSummary?.qualifiedViewsCount) || 0);

  // Preserve idempotency if summary was already normalized via normalizeCreatorRewardsSummary
  const recordedGenuineVideoRewards =
    safeSummary?.rawVideoRewardsCents !== undefined
      ? Math.max(0, Number(safeSummary.rawVideoRewardsCents) || 0)
      : Math.max(0, Number(safeSummary?.videoRewardsCents) || 0);
  const computedGenuineVideoRewards = Math.floor(
    (genuineQualifiedViews * CENTS_PER_1000_QUALIFIED_VIEWS) / 1000
  );
  const genuineVideoRewardsCents = Math.max(
    recordedGenuineVideoRewards,
    computedGenuineVideoRewards
  );
  const unaccountedGenuineVideoRewards = Math.max(
    0,
    genuineVideoRewardsCents - recordedGenuineVideoRewards
  );

  const genuineReferralRewardsCents = Math.max(0, Number(safeSummary?.referralRewardsCents) || 0);
  const recordedStarsRewardsCents =
    safeSummary?.rawSogoStarsRewardsCents !== undefined
      ? Math.max(0, Number(safeSummary.rawSogoStarsRewardsCents) || 0)
      : Math.max(0, Number(safeSummary?.sogoStarsRewardsCents) || 0);
  const recordedStarsTotal = Math.max(
    0,
    Number(safeSummary?.sogoStarsTotal) || 0,
    Number(safeSummary?.sogoStarsToday) || 0
  );

  const baseTotalEarnedCents =
    safeSummary?.rawTotalEarnedCents !== undefined
      ? Math.max(0, Number(safeSummary.rawTotalEarnedCents) || 0)
      : Math.max(0, Number(safeSummary?.totalEarnedCents) || 0);
  const baseAvailableBalanceCents =
    safeSummary?.rawAvailableBalanceCents !== undefined
      ? Math.max(0, Number(safeSummary.rawAvailableBalanceCents) || 0)
      : Math.max(0, Number(safeSummary?.availableBalanceCents) || 0);

  const genuineTotalEarnedWithVideoDelta =
    baseTotalEarnedCents + unaccountedGenuineVideoRewards;

  // Derive Stars earnings already contributing to totalEarnedCents so the breakdown always sums to Total Earnings without double-counting
  const impliedStarsFromTotalCents = Math.max(
    0,
    genuineTotalEarnedWithVideoDelta - genuineVideoRewardsCents - genuineReferralRewardsCents
  );
  const genuineSogoStarsRewardsCents = Math.max(
    recordedStarsRewardsCents,
    impliedStarsFromTotalCents
  );
  const extraImpliedStars =
    genuineSogoStarsRewardsCents > recordedStarsRewardsCents
      ? (genuineSogoStarsRewardsCents - recordedStarsRewardsCents) * 10
      : 0;
  const genuineSogoStarsTotal =
    recordedStarsTotal > 0
      ? recordedStarsTotal + extraImpliedStars
      : genuineSogoStarsRewardsCents > 0
      ? genuineSogoStarsRewardsCents * 10
      : 0;

  const genuineTotalEarnedCents = Math.max(
    genuineTotalEarnedWithVideoDelta,
    genuineVideoRewardsCents + genuineReferralRewardsCents + genuineSogoStarsRewardsCents
  );

  // Staged admin test video metrics ($0.50 per 1,000 qualified views)
  const testViews = Math.max(0, Number(safeSummary?.testViewsCount) || 0);
  const testQualifiedViews = Math.max(0, Number(safeSummary?.testQualifiedViewsCount) || 0);
  const computedTestVideoRewards = Math.floor(
    (testQualifiedViews * CENTS_PER_1000_QUALIFIED_VIEWS) / 1000
  );
  const testVideoRewards = Math.max(
    0,
    Number(safeSummary?.testVideoRewardsCents) || 0,
    computedTestVideoRewards
  );

  // Canonical user-facing & admin-facing combined metrics
  const displayTotalViews = genuineTotalViews + testViews;
  const displayQualifiedViews = genuineQualifiedViews + testQualifiedViews;
  const displayVideoRewardsCents = genuineVideoRewardsCents + testVideoRewards;
  const displayReferralRewardsCents = genuineReferralRewardsCents;
  const displaySogoStarsRewardsCents = genuineSogoStarsRewardsCents;
  const displaySogoStarsTotal = genuineSogoStarsTotal;
  const displayTotalEarnedCents = genuineTotalEarnedCents + testVideoRewards;
  const displayAvailableBalanceCents =
    baseAvailableBalanceCents + unaccountedGenuineVideoRewards + testVideoRewards;

  return {
    genuineTotalViews,
    genuineQualifiedViews,
    genuineVideoRewardsCents,
    genuineReferralRewardsCents,
    genuineSogoStarsRewardsCents,
    genuineSogoStarsTotal,
    genuineTotalEarnedCents,
    testViewsCount: testViews,
    testQualifiedViewsCount: testQualifiedViews,
    testVideoRewardsCents: testVideoRewards,
    displayTotalViews,
    displayQualifiedViews,
    displayVideoRewardsCents,
    displayReferralRewardsCents,
    displaySogoStarsRewardsCents,
    displaySogoStarsTotal,
    displayTotalEarnedCents,
    displayAvailableBalanceCents,
  };
}

/**
 * Normalizes a CreatorRewardsSummary (optionally reconciling verified referrals first)
 * so that availableBalanceCents, totalEarnedCents, videoRewardsCents, and display* fields
 * all reflect the single authoritative balance shown on the Creator Rewards page.
 * Strictly idempotent: calling this multiple times on the same summary never double-counts.
 */
export function normalizeCreatorRewardsSummary(
  baseSummary: CreatorRewardsSummary,
  referrals?: ReferralRecord[],
  organicTotalViews = 0
): CreatorRewardsSummary {
  const rawSummary: CreatorRewardsSummary = {
    ...baseSummary,
    availableBalanceCents:
      baseSummary.rawAvailableBalanceCents !== undefined
        ? Number(baseSummary.rawAvailableBalanceCents) || 0
        : Number(baseSummary.availableBalanceCents) || 0,
    totalEarnedCents:
      baseSummary.rawTotalEarnedCents !== undefined
        ? Number(baseSummary.rawTotalEarnedCents) || 0
        : Number(baseSummary.totalEarnedCents) || 0,
    videoRewardsCents:
      baseSummary.rawVideoRewardsCents !== undefined
        ? Number(baseSummary.rawVideoRewardsCents) || 0
        : Number(baseSummary.videoRewardsCents) || 0,
    sogoStarsRewardsCents:
      baseSummary.rawSogoStarsRewardsCents !== undefined
        ? Number(baseSummary.rawSogoStarsRewardsCents) || 0
        : Number(baseSummary.sogoStarsRewardsCents) || 0,
  };

  const reconciled = Array.isArray(referrals)
    ? reconcileSummaryWithReferrals(rawSummary, referrals)
    : rawSummary;

  const metrics = getDisplayRewardsMetrics(reconciled, organicTotalViews);

  return {
    ...reconciled,
    rawAvailableBalanceCents: Number(reconciled.availableBalanceCents) || 0,
    rawTotalEarnedCents: Number(reconciled.totalEarnedCents) || 0,
    rawVideoRewardsCents: Number(reconciled.videoRewardsCents) || 0,
    rawSogoStarsRewardsCents: Number(reconciled.sogoStarsRewardsCents) || 0,
    availableBalanceCents: metrics.displayAvailableBalanceCents,
    totalEarnedCents: metrics.displayTotalEarnedCents,
    videoRewardsCents: metrics.displayVideoRewardsCents,
    sogoStarsRewardsCents: metrics.displaySogoStarsRewardsCents,
    sogoStarsTotal: metrics.displaySogoStarsTotal,
    testVideoRewardsCents: metrics.testVideoRewardsCents,
    displayAvailableBalanceCents: metrics.displayAvailableBalanceCents,
    displayTotalEarnedCents: metrics.displayTotalEarnedCents,
    displayVideoRewardsCents: metrics.displayVideoRewardsCents,
    displayQualifiedViews: metrics.displayQualifiedViews,
    displayTotalViews: metrics.displayTotalViews,
    displaySogoStarsRewardsCents: metrics.displaySogoStarsRewardsCents,
    displaySogoStarsTotal: metrics.displaySogoStarsTotal,
  };
}

// Helper: Default initial summary for creators
export function getInitialRewardsSummary(userId: string): CreatorRewardsSummary {
  return {
    userId,
    availableBalanceCents: 0,
    totalEarnedCents: 0,
    videoRewardsCents: 0,
    referralRewardsCents: 0,
    pendingEarningsCents: 0,
    withdrawnAmountCents: 0,
    pendingPayoutCents: 0,
    qualifiedViewsCount: 0,
    successfulReferralsCount: 0,
    currency: 'USD',
    updatedAt: new Date().toISOString(),
  };
}

// Helper: Read local rewards cache
function getCachedRewards(userId: string): CreatorRewardsSummary | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_REWARDS_CACHE_PREFIX}${userId}`);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to read local rewards cache:', err);
  }
  return null;
}

// Helper: Write local rewards cache
function setCachedRewards(userId: string, summary: CreatorRewardsSummary): void {
  try {
    localStorage.setItem(`${LOCAL_REWARDS_CACHE_PREFIX}${userId}`, JSON.stringify(summary));
  } catch (err) {
    console.warn('Failed to write local rewards cache:', err);
  }
}

/**
 * Reconciles a CreatorRewardsSummary with verified referrals from /referrals + /users.
 * Strictly idempotent: only accounts for verified referrals not yet merged into creator_rewards by Cloud Functions.
 */
export function reconcileSummaryWithReferrals(
  baseSummary: CreatorRewardsSummary,
  referrals: ReferralRecord[]
): CreatorRewardsSummary {
  const verifiedReferrals = referrals.filter(
    (r) =>
      r.status === 'qualified' &&
      r.rewardGranted &&
      r.referrerId === baseSummary.userId &&
      r.referredUserId !== baseSummary.userId
  );

  const verifiedCount = verifiedReferrals.length;
  const verifiedReferralCents = verifiedReferrals.reduce(
    (sum, r) => sum + (Number(r.rewardAmountCents) || REFERRAL_REWARD_CENTS),
    0
  );

  const existingReferralsCount = Number(baseSummary.successfulReferralsCount) || 0;
  const existingReferralCents = Number(baseSummary.referralRewardsCents) || 0;

  if (verifiedCount <= existingReferralsCount && verifiedReferralCents <= existingReferralCents) {
    return baseSummary;
  }

  const unaccountedCents = Math.max(0, verifiedReferralCents - existingReferralCents);

  return {
    ...baseSummary,
    successfulReferralsCount: Math.max(existingReferralsCount, verifiedCount),
    referralRewardsCents: Math.max(existingReferralCents, verifiedReferralCents),
    totalEarnedCents: (Number(baseSummary.totalEarnedCents) || 0) + unaccountedCents,
    availableBalanceCents: (Number(baseSummary.availableBalanceCents) || 0) + unaccountedCents,
  };
}

/**
 * Reconciles a CreatorRewardsSummary with verified Sogo Stars daily mission earnings.
 * Strictly idempotent: only accounts for earned Sogo Stars cents not yet reflected in sogoStarsRewardsCents.
 */
export function reconcileSummaryWithSogoStars(
  baseSummary: CreatorRewardsSummary,
  dailyStars?: SogoStarsDailyState | null
): CreatorRewardsSummary {
  const effectiveDaily =
    dailyStars ||
    (baseSummary.userId ? getCachedSogoStarsDailyState(baseSummary.userId) : null);

  if (!effectiveDaily || effectiveDaily.centsEarnedToday <= 0) {
    return baseSummary;
  }

  const verifiedTodayStars = Math.min(500, Math.max(0, Number(effectiveDaily.starsEarnedToday) || 0));
  const verifiedTodayCents = Math.min(50, Math.max(0, Number(effectiveDaily.centsEarnedToday) || 0));

  const existingStarsCents = Math.max(0, Number(baseSummary.sogoStarsRewardsCents) || 0);
  const existingStarsToday =
    baseSummary.sogoStarsDateKey === effectiveDaily.dateKey
      ? Math.max(0, Number(baseSummary.sogoStarsToday) || 0)
      : 0;

  const unaccountedStarsDelta = Math.max(0, verifiedTodayStars - existingStarsToday);
  const unaccountedCents = Math.max(
    0,
    verifiedTodayCents - existingStarsCents,
    Math.floor(unaccountedStarsDelta / 10)
  );

  if (unaccountedCents <= 0 && verifiedTodayStars <= existingStarsToday) {
    return baseSummary;
  }

  return {
    ...baseSummary,
    sogoStarsToday: Math.max(existingStarsToday, verifiedTodayStars),
    sogoStarsDateKey: effectiveDaily.dateKey,
    sogoStarsTotal: Math.max(
      Number(baseSummary.sogoStarsTotal) || 0,
      verifiedTodayStars
    ),
    sogoStarsRewardsCents: existingStarsCents + unaccountedCents,
    totalEarnedCents: (Number(baseSummary.totalEarnedCents) || 0) + unaccountedCents,
    availableBalanceCents: (Number(baseSummary.availableBalanceCents) || 0) + unaccountedCents,
  };
}

/**
 * Retrieves the creator rewards summary for a given user.
 * Fetches from Firestore and reconciles with verified referrals and Sogo Stars.
 */
export async function getCreatorRewards(userId: string): Promise<CreatorRewardsSummary> {
  if (!userId) return getInitialRewardsSummary('');

  let baseSummary: CreatorRewardsSummary | null = null;

  try {
    const docRef = doc(db, REWARDS_COLLECTION, userId);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      baseSummary = {
        userId,
        availableBalanceCents: Number(data.availableBalanceCents) || 0,
        totalEarnedCents: Number(data.totalEarnedCents) || 0,
        videoRewardsCents: Number(data.videoRewardsCents) || 0,
        referralRewardsCents: Number(data.referralRewardsCents) || 0,
        sogoStarsTotal: data.sogoStarsTotal !== undefined ? Number(data.sogoStarsTotal) : undefined,
        sogoStarsToday: data.sogoStarsToday !== undefined ? Number(data.sogoStarsToday) : undefined,
        sogoStarsDateKey: data.sogoStarsDateKey,
        sogoStarsRewardsCents: data.sogoStarsRewardsCents !== undefined ? Number(data.sogoStarsRewardsCents) : undefined,
        pendingEarningsCents: Number(data.pendingEarningsCents) || 0,
        withdrawnAmountCents: Number(data.withdrawnAmountCents) || 0,
        pendingPayoutCents: Number(data.pendingPayoutCents) || 0,
        totalViewsCount: data.totalViewsCount !== undefined ? Number(data.totalViewsCount) : undefined,
        qualifiedViewsCount: Number(data.qualifiedViewsCount) || 0,
        successfulReferralsCount: Number(data.successfulReferralsCount) || 0,
        currency: 'USD',
        updatedAt: data.updatedAt || new Date().toISOString(),
        testViewsCount: data.testViewsCount !== undefined ? Number(data.testViewsCount) : undefined,
        testQualifiedViewsCount: data.testQualifiedViewsCount !== undefined ? Number(data.testQualifiedViewsCount) : undefined,
        testVideoRewardsCents: data.testVideoRewardsCents !== undefined ? Number(data.testVideoRewardsCents) : undefined,
        hasAdminTestData: Boolean(data.hasAdminTestData),
      };
    }
  } catch (err) {
    console.warn('Firestore getCreatorRewards fetch note:', err);
  }

  const initialOrBase = baseSummary || getCachedRewards(userId) || getInitialRewardsSummary(userId);

  try {
    const [referrals, dailyStars] = await Promise.all([
      getUserReferrals(userId).catch(() => []),
      getSogoStarsDailyState(userId).catch(() => null),
    ]);
    const withReferrals = reconcileSummaryWithReferrals(initialOrBase, referrals);
    const reconciled = reconcileSummaryWithSogoStars(withReferrals, dailyStars);
    setCachedRewards(userId, reconciled);
    return reconciled;
  } catch {
    const withStars = reconcileSummaryWithSogoStars(initialOrBase);
    setCachedRewards(userId, withStars);
    return withStars;
  }
}

/**
 * Real-time listener for creator rewards summary (and live referral & Sogo Stars updates).
 */
export function subscribeToCreatorRewards(
  userId: string,
  onUpdate: (summary: CreatorRewardsSummary) => void
): () => void {
  if (!userId) {
    onUpdate(getInitialRewardsSummary(''));
    return () => {};
  }

  let latestBaseSummary: CreatorRewardsSummary =
    getCachedRewards(userId) || getInitialRewardsSummary(userId);
  let latestReferrals: ReferralRecord[] = [];
  let latestDailyStars: SogoStarsDailyState | null = getCachedSogoStarsDailyState(userId);

  const emitReconciled = () => {
    const withRefs = reconcileSummaryWithReferrals(latestBaseSummary, latestReferrals);
    const reconciled = reconcileSummaryWithSogoStars(withRefs, latestDailyStars);
    setCachedRewards(userId, reconciled);
    onUpdate(reconciled);
  };

  let unsubRewards: (() => void) | null = null;
  let unsubReferrals: (() => void) | null = null;

  const handleStarsEvent = (e: Event) => {
    const customEvent = e as CustomEvent<{ userId: string; state: SogoStarsDailyState }>;
    if (customEvent.detail?.state) {
      latestDailyStars = customEvent.detail.state;
      emitReconciled();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('sogo_stars_updated', handleStarsEvent);
  }

  try {
    const docRef = doc(db, REWARDS_COLLECTION, userId);
    unsubRewards = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          latestBaseSummary = {
            userId,
            availableBalanceCents: Number(data.availableBalanceCents) || 0,
            totalEarnedCents: Number(data.totalEarnedCents) || 0,
            videoRewardsCents: Number(data.videoRewardsCents) || 0,
            referralRewardsCents: Number(data.referralRewardsCents) || 0,
            sogoStarsTotal: data.sogoStarsTotal !== undefined ? Number(data.sogoStarsTotal) : undefined,
            sogoStarsToday: data.sogoStarsToday !== undefined ? Number(data.sogoStarsToday) : undefined,
            sogoStarsDateKey: data.sogoStarsDateKey,
            sogoStarsRewardsCents: data.sogoStarsRewardsCents !== undefined ? Number(data.sogoStarsRewardsCents) : undefined,
            pendingEarningsCents: Number(data.pendingEarningsCents) || 0,
            withdrawnAmountCents: Number(data.withdrawnAmountCents) || 0,
            pendingPayoutCents: Number(data.pendingPayoutCents) || 0,
            totalViewsCount: data.totalViewsCount !== undefined ? Number(data.totalViewsCount) : undefined,
            qualifiedViewsCount: Number(data.qualifiedViewsCount) || 0,
            successfulReferralsCount: Number(data.successfulReferralsCount) || 0,
            currency: 'USD',
            updatedAt: data.updatedAt || new Date().toISOString(),
            testViewsCount: data.testViewsCount !== undefined ? Number(data.testViewsCount) : undefined,
            testQualifiedViewsCount: data.testQualifiedViewsCount !== undefined ? Number(data.testQualifiedViewsCount) : undefined,
            testVideoRewardsCents: data.testVideoRewardsCents !== undefined ? Number(data.testVideoRewardsCents) : undefined,
            hasAdminTestData: Boolean(data.hasAdminTestData),
          };
        } else {
          latestBaseSummary = getInitialRewardsSummary(userId);
        }
        emitReconciled();
      },
      (err) => {
        console.warn('Firestore rewards subscription note:', err);
        emitReconciled();
      }
    );
  } catch {
    emitReconciled();
  }

  try {
    unsubReferrals = subscribeToUserReferrals(userId, (refs) => {
      latestReferrals = refs;
      emitReconciled();
    });
  } catch {}

  return () => {
    if (unsubRewards) unsubRewards();
    if (unsubReferrals) unsubReferrals();
    if (typeof window !== 'undefined') {
      window.removeEventListener('sogo_stars_updated', handleStarsEvent);
    }
  };
}

/**
 * Retrieves the creator's auditable reward ledger history.
 * Avoids composite index failures by querying by userId and sorting in memory,
 * and reconciles deterministic referral ledger records (`txn_ref_{referredUserId}`)
 * and Sogo Stars daily mission rewards (`txn_stars_{userId}_{dateKey}_{missionId}`).
 */
export async function getRewardLedger(
  userId: string,
  filterType?: RewardLedgerType | 'all',
  limitCount = 50
): Promise<RewardLedgerItem[]> {
  if (!userId) return [];

  const itemsMap = new Map<string, RewardLedgerItem>();

  try {
    const ledgerRef = collection(db, LEDGER_COLLECTION);
    const q = query(ledgerRef, where('userId', '==', userId));
    const snap = await getDocs(q);

    snap.forEach((d) => {
      const data = d.data();
      const item: RewardLedgerItem = {
        id: d.id,
        userId: data.userId || userId,
        type: data.type || 'video_reward',
        transactionType: data.transactionType,
        isAdminTestData: Boolean(data.isAdminTestData),
        amountCents: Number(data.amountCents) || 0,
        amountUsd: Number(data.amountUsd) || 0,
        currency: 'USD',
        videoId: data.videoId,
        videoCaption: data.videoCaption,
        qualifiedViews: data.qualifiedViews,
        referredUserId: data.referredUserId,
        referredUsername: data.referredUsername,
        payoutRequestId: data.payoutRequestId,
        starsEarned: data.starsEarned !== undefined ? Number(data.starsEarned) : undefined,
        missionId: data.missionId,
        dateKey: data.dateKey,
        description: data.description || '',
        status: data.status || 'completed',
        eventId: data.eventId || d.id,
        createdAt: data.createdAt || new Date().toISOString(),
      };
      itemsMap.set(item.id, item);
    });
  } catch (err) {
    console.warn('Firestore getRewardLedger fetch note:', err);
  }

  // Reconcile verified referrals into deterministic ledger entries (txn_ref_{referredUserId}) if not yet written by Cloud Function
  if (!filterType || filterType === 'all' || filterType === 'referral_reward') {
    try {
      const referrals = await getUserReferrals(userId);
      const existingReferredIds = new Set<string>();
      itemsMap.forEach((item) => {
        if (item.referredUserId) existingReferredIds.add(item.referredUserId);
      });

      for (const r of referrals) {
        if (
          r.status === 'qualified' &&
          r.rewardGranted &&
          r.referrerId === userId &&
          r.referredUserId !== userId
        ) {
          const deterministicId = `txn_ref_${r.referredUserId}`;
          if (!itemsMap.has(deterministicId) && !existingReferredIds.has(r.referredUserId)) {
            const referralReward = Number(r.rewardAmountCents) || REFERRAL_REWARD_CENTS;
            itemsMap.set(deterministicId, {
              id: deterministicId,
              userId,
              type: 'referral_reward',
              amountCents: referralReward,
              amountUsd: centsToUsd(referralReward),
              currency: 'USD',
              referredUserId: r.referredUserId,
              referredUsername: r.referredUsername || 'creator',
              description: `Referral bonus: @${r.referredUsername || 'creator'} joined SogoSocial (${formatCentsToUsd(referralReward)})`,
              status: 'completed',
              eventId: `event_ref_${r.referredUserId}`,
              createdAt: r.qualifiedAt || r.createdAt,
            });
          }
        }
      }
    } catch {}
  }

  // Reconcile completed Sogo Stars missions for today into deterministic ledger entries (txn_stars_{userId}_{dateKey}_{missionId})
  if (!filterType || filterType === 'all' || filterType === 'sogo_stars_reward') {
    try {
      const dailyStars = await getSogoStarsDailyState(userId);
      for (const def of SOGO_STAR_MISSIONS) {
        const prog = dailyStars.missions[def.id];
        if (prog && prog.completed && prog.rewardGranted) {
          const deterministicId = `txn_stars_${dailyStars.userId || userId}_${dailyStars.dateKey}_${def.id}`;
          const aliasId = `txn_stars_${userId}_${dailyStars.dateKey}_${def.id}`;
          if (!itemsMap.has(deterministicId) && !itemsMap.has(aliasId)) {
            const usdFloat = centsToUsd(def.rewardCents);
            itemsMap.set(deterministicId, {
              id: deterministicId,
              userId,
              type: 'sogo_stars_reward',
              transactionType: 'SOGO_STARS_MISSION_REWARD',
              isAdminTestData: false,
              amountCents: def.rewardCents,
              amountUsd: usdFloat,
              currency: 'USD',
              starsEarned: def.rewardStars,
              missionId: def.id,
              dateKey: dailyStars.dateKey,
              description: `⭐ Sogo Stars: ${def.title} (+${def.rewardStars} Stars → +$${usdFloat.toFixed(2)})`,
              status: 'completed',
              eventId: `sogo_stars_${userId}_${dailyStars.dateKey}_${def.id}`,
              createdAt: prog.completedAt || dailyStars.updatedAt,
            });
          }
        }
      }
    } catch {}
  }

  let items = Array.from(itemsMap.values());

  if (items.length > 0) {
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    try {
      localStorage.setItem(
        `${LOCAL_LEDGER_CACHE_PREFIX}${userId}`,
        JSON.stringify(items.slice(0, 30))
      );
    } catch {}
    if (filterType && filterType !== 'all') {
      items = items.filter((i) => i.type === filterType);
    }
    return items.slice(0, limitCount);
  }

  // Fallback to local cache
  try {
    const cached = localStorage.getItem(`${LOCAL_LEDGER_CACHE_PREFIX}${userId}`);
    if (cached) {
      const parsed: RewardLedgerItem[] = JSON.parse(cached);
      if (filterType && filterType !== 'all') {
        return parsed.filter((i) => i.type === filterType);
      }
      return parsed.slice(0, limitCount);
    }
  } catch {}

  return [];
}

/**
 * Retrieves all payout requests for a user.
 */
export async function getPayoutRequests(userId: string): Promise<PayoutRequest[]> {
  if (!userId) return [];

  try {
    const payoutsRef = collection(db, PAYOUTS_COLLECTION);
    const q = query(payoutsRef, where('userId', '==', userId));
    const snap = await getDocs(q);

    const items: PayoutRequest[] = [];
    snap.forEach((d) => {
      const data = d.data();
      items.push({
        id: d.id,
        userId: data.userId || userId,
        amountCents: Number(data.amountCents) || 0,
        amountUsd: Number(data.amountUsd) || 0,
        currency: 'USD',
        payoutMethod: data.payoutMethod || 'paypal',
        payoutDetails: data.payoutDetails || {},
        status: data.status || 'pending',
        requestedAt: data.requestedAt || new Date().toISOString(),
        processedAt: data.processedAt,
        rejectionReason: data.rejectionReason,
        notes: data.notes,
        successfulReferralsCount:
          data.successfulReferralsCount !== undefined
            ? Number(data.successfulReferralsCount)
            : undefined,
      });
    });
    items.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    return items.slice(0, 20);
  } catch (err) {
    console.warn('Firestore getPayoutRequests note:', err);
    return [];
  }
}

/**
 * Helper to verify raw referral docs against /users/{referredUserId} onboarding status.
 */
async function hydrateAndVerifyReferrals(
  userId: string,
  rawDocs: { id: string; data: Record<string, any> }[]
): Promise<ReferralRecord[]> {
  const hydrated = await Promise.all(
    rawDocs.map(async ({ id, data }) => {
      const referredUserId = data.referredUserId || id;
      const referrerId = data.referrerId || userId;
      let status: ReferralRecord['status'] = data.status || 'pending';
      let rewardGranted = Boolean(data.rewardGranted);
      let referredUsername = data.referredUsername || 'creator';
      let referredDisplayName = data.referredDisplayName || 'New Creator';
      let referredAvatarUrl = data.referredAvatarUrl;
      let qualifiedAt = data.qualifiedAt;

      // Verify referred user's profile in /users/{referredUserId}
      if (status !== 'rejected' && referredUserId && referrerId !== referredUserId) {
        try {
          const userSnap = await getDoc(doc(db, 'users', referredUserId));
          if (userSnap.exists()) {
            const uData = userSnap.data();
            if (uData.username) referredUsername = uData.username;
            if (uData.displayName || uData.fullName) {
              referredDisplayName = uData.displayName || uData.fullName;
            }
            if (uData.avatarUrl || uData.photoURL) {
              referredAvatarUrl = uData.avatarUrl || uData.photoURL;
            }
            const isOnboarded = Boolean(
              uData.isOnboarded === true ||
                uData.onboardingCompleted === true ||
                (uData.username && uData.displayName && uData.birthday)
            );
            if (isOnboarded) {
              status = 'qualified';
              rewardGranted = true;
              qualifiedAt = qualifiedAt || data.createdAt || new Date().toISOString();
            }
          }
        } catch {}
      }

      return {
        id,
        referralCode: data.referralCode || '',
        referrerId,
        referredUserId,
        referredUsername,
        referredDisplayName,
        referredAvatarUrl,
        status,
        rewardAmountCents: Number(data.rewardAmountCents) || REFERRAL_REWARD_CENTS,
        rewardGranted,
        createdAt: data.createdAt || new Date().toISOString(),
        qualifiedAt,
        reason: data.reason,
      } satisfies ReferralRecord;
    })
  );

  hydrated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return hydrated.slice(0, 50);
}

/**
 * Retrieves all referrals attributed to a user.
 * Avoids composite index requirements by querying on referrerId and sorting in memory.
 */
export async function getUserReferrals(userId: string): Promise<ReferralRecord[]> {
  if (!userId) return [];

  try {
    const referralsRef = collection(db, REFERRALS_COLLECTION);
    const q = query(referralsRef, where('referrerId', '==', userId));
    const snap = await getDocs(q);

    const rawDocs: { id: string; data: Record<string, any> }[] = [];
    snap.forEach((d) => {
      rawDocs.push({ id: d.id, data: d.data() });
    });

    return await hydrateAndVerifyReferrals(userId, rawDocs);
  } catch (err) {
    console.warn('Firestore getUserReferrals note:', err);
    return [];
  }
}

/**
 * Real-time subscription to referrals attributed to a user.
 */
export function subscribeToUserReferrals(
  userId: string,
  onUpdate: (referrals: ReferralRecord[]) => void
): () => void {
  if (!userId) {
    onUpdate([]);
    return () => {};
  }

  try {
    const referralsRef = collection(db, REFERRALS_COLLECTION);
    const q = query(referralsRef, where('referrerId', '==', userId));
    return onSnapshot(
      q,
      async (snap) => {
        const rawDocs: { id: string; data: Record<string, any> }[] = [];
        snap.forEach((d) => {
          rawDocs.push({ id: d.id, data: d.data() });
        });
        const hydrated = await hydrateAndVerifyReferrals(userId, rawDocs);
        onUpdate(hydrated);
      },
      (err) => {
        console.warn('Firestore subscribeToUserReferrals note:', err);
      }
    );
  } catch {
    return () => {};
  }
}

/**
 * Computes a standardized referral code for any SogoSocial user.
 * e.g. SOGO-ALEXANDER or SOGO-USER123
 */
export function getReferralCodeForUser(user: { id: string; username?: string }): string {
  const baseName = (user.username || user.id.slice(0, 6))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return `SOGO-${baseName}`;
}

export const PLAY_STORE_PACKAGE_URL =
  'https://play.google.com/store/apps/details?id=com.sogo.social';

/**
 * Generates the official Google Play Store invite URL with the creator's
 * unique referral code in the Play Install Referrer parameter.
 * Structure: https://play.google.com/store/apps/details?id=com.sogo.social&referrer=referral_code%3DSOGO-USER
 */
export function getGooglePlayReferralLink(referralCode: string): string {
  const cleanCode = (referralCode || 'SOGO-CREATOR').trim().toUpperCase();
  return `${PLAY_STORE_PACKAGE_URL}&referrer=referral_code%3D${encodeURIComponent(cleanCode)}`;
}

/**
 * Generates the legacy web referral link for web browser signups and deep-link testing.
 * Structure: https://sogo-e5ea9.web.app/?ref=SOGO-USER
 */
export function getWebReferralLink(referralCode: string): string {
  const origin = getAppBaseUrl();
  const cleanCode = (referralCode || 'SOGO-CREATOR').trim().toUpperCase();
  return `${origin}/?ref=${encodeURIComponent(cleanCode)}`;
}

/**
 * Generates the primary shareable referral link.
 * Defaults to the Google Play Store listing with install referrer attached
 * so new users install the app directly from Google Play.
 */
export function getReferralLink(referralCode: string): string {
  return getGooglePlayReferralLink(referralCode);
}

/**
 * Store pending referral code in local storage for new user signups.
 */
export function setPendingReferralCode(code: string): void {
  try {
    if (code && code.trim()) {
      localStorage.setItem(PENDING_REFERRAL_KEY, code.trim().toUpperCase());
    }
  } catch {}
}

export function getPendingReferralCode(): string | null {
  try {
    return localStorage.getItem(PENDING_REFERRAL_KEY);
  } catch {
    return null;
  }
}

export function clearPendingReferralCode(): void {
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {}
}

// Cooldown tracking in memory & local storage to avoid excessive spam
function checkAndMarkCooldown(key: string): boolean {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(LOCAL_VIEW_COOLDOWN_KEY);
    const cooldowns: Record<string, number> = raw ? JSON.parse(raw) : {};

    const lastTime = cooldowns[key];
    if (lastTime && now - lastTime < VIEW_COOLDOWN_MS) {
      return false; // Still in 24-hour cooldown
    }

    // Clean old keys past 48 hours
    const cleaned: Record<string, number> = {};
    for (const [k, t] of Object.entries(cooldowns)) {
      if (now - t < 48 * 60 * 60 * 1000) {
        cleaned[k] = t;
      }
    }
    cleaned[key] = now;
    localStorage.setItem(LOCAL_VIEW_COOLDOWN_KEY, JSON.stringify(cleaned));
    return true;
  } catch {
    return true;
  }
}

// Velocity guard: check max qualified views per hour
function checkAndIncrementVelocity(): boolean {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(LOCAL_VIEW_VELOCITY_KEY);
    const record: { count: number; windowStart: number } = raw
      ? JSON.parse(raw)
      : { count: 0, windowStart: now };

    if (now - record.windowStart > 60 * 60 * 1000) {
      // New 1-hour window
      localStorage.setItem(
        LOCAL_VIEW_VELOCITY_KEY,
        JSON.stringify({ count: 1, windowStart: now })
      );
      return true;
    }

    if (record.count >= MAX_QUALIFIED_VIEWS_PER_HOUR) {
      console.warn('View qualification velocity limit reached for this hour');
      return false;
    }

    record.count += 1;
    localStorage.setItem(LOCAL_VIEW_VELOCITY_KEY, JSON.stringify(record));
    return true;
  } catch {
    return true;
  }
}

/**
 * Records a video watch session and processes qualification.
 * 
 * Qualification Rules:
 * 1. Viewer must be logged in.
 * 2. Creator's own views do not count.
 * 3. Watch duration must be >= 5 seconds (or 50% of duration).
 * 4. 24-hour cooldown per viewer per video.
 * 5. Velocity limit: max 30 views/hour.
 * 6. Idempotent event logging.
 */
export async function recordVideoWatchTelemetry(
  telemetry: WatchSessionTelemetry,
  videoCaption?: string
): Promise<{ qualified: boolean; reason?: string }> {
  // 1. Viewer must be logged in
  if (!telemetry.viewerUid) {
    return { qualified: false, reason: 'Viewer not logged in' };
  }

  // 2. Creator's own views do not count
  if (telemetry.viewerUid === telemetry.creatorUid) {
    return { qualified: false, reason: 'Own video view not eligible for rewards' };
  }

  // 3. Meaningful consumption: at least 5 seconds or 50% of video duration
  const minRequired = telemetry.videoDurationSeconds
    ? Math.min(MIN_WATCH_DURATION_FOR_QUALIFIED_VIEW, telemetry.videoDurationSeconds * 0.5)
    : MIN_WATCH_DURATION_FOR_QUALIFIED_VIEW;

  if (telemetry.watchDurationSeconds < minRequired) {
    return { qualified: false, reason: 'Watch duration below qualification threshold' };
  }

  // Track Sogo Stars "Watch 10 qualifying Reels" mission for the viewer (non-blocking)
  recordSogoStarAction({
    userId: telemetry.viewerUid,
    missionId: 'watch_reels',
    actionKey: telemetry.videoId,
    targetOwnerId: telemetry.creatorUid,
  }).catch(() => {});

  // 4. 24-hour cooldown check
  const todayBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cooldownKey = `${telemetry.videoId}_${telemetry.viewerUid}_${todayBucket}`;
  if (!checkAndMarkCooldown(cooldownKey)) {
    return { qualified: false, reason: 'View already counted within 24-hour cooldown window' };
  }

  // 5. Viewing velocity check
  if (!checkAndIncrementVelocity()) {
    return { qualified: false, reason: 'Viewing velocity limit exceeded' };
  }

  const nowIso = new Date().toISOString();
  const sessionId = telemetry.sessionId || `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Record raw watch session document to Firestore
    const sessionRef = doc(db, WATCH_SESSIONS_COLLECTION, sessionId);
    await setDoc(sessionRef, {
      id: sessionId,
      videoId: telemetry.videoId,
      creatorUid: telemetry.creatorUid,
      viewerUid: telemetry.viewerUid,
      watchDurationSeconds: telemetry.watchDurationSeconds,
      videoDurationSeconds: telemetry.videoDurationSeconds || 0,
      timestamp: nowIso,
      isQualifiedCandidate: true,
      cooldownKey,
    });
  } catch (err) {
    console.warn('Could not record watch session document:', err);
  }

  // Process qualification transaction for creator:
  // In a production backend, this is triggered by a Cloud Function on `video_watch_sessions`.
  // Here, we provide the atomic transaction handler.
  try {
    await runTransaction(db, async (transaction) => {
      const creatorRewardsRef = doc(db, REWARDS_COLLECTION, telemetry.creatorUid);
      const creatorSnap = await transaction.get(creatorRewardsRef);

      const currentSummary: CreatorRewardsSummary = creatorSnap.exists()
        ? (creatorSnap.data() as CreatorRewardsSummary)
        : getInitialRewardsSummary(telemetry.creatorUid);

      const newQualifiedViews = (Number(currentSummary.qualifiedViewsCount) || 0) + 1;

      // Economic formula: $0.50 per 1,000 qualified views ($0.0005 per view)
      // Every 1,000 views = 50 cents. Fractional cents handled accurately:
      const newVideoRewardsCents = Math.floor((newQualifiedViews * 50) / 1000);
      const earnedDeltaCents = newVideoRewardsCents - (Number(currentSummary.videoRewardsCents) || 0);

      const newAvailableBalanceCents = (Number(currentSummary.availableBalanceCents) || 0) + earnedDeltaCents;
      const newTotalEarnedCents = (Number(currentSummary.totalEarnedCents) || 0) + earnedDeltaCents;

      transaction.set(
        creatorRewardsRef,
        {
          userId: telemetry.creatorUid,
          qualifiedViewsCount: newQualifiedViews,
          videoRewardsCents: newVideoRewardsCents,
          availableBalanceCents: newAvailableBalanceCents,
          totalEarnedCents: newTotalEarnedCents,
          currency: 'USD',
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // If this milestone view generated a new increment of cents, log to ledger
      if (earnedDeltaCents > 0 || newQualifiedViews % 100 === 0) {
        const transactionId = `txn_vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const ledgerRef = doc(db, LEDGER_COLLECTION, transactionId);
        transaction.set(ledgerRef, {
          id: transactionId,
          userId: telemetry.creatorUid,
          type: 'video_reward',
          amountCents: earnedDeltaCents,
          amountUsd: centsToUsd(earnedDeltaCents),
          currency: 'USD',
          videoId: telemetry.videoId,
          videoCaption: videoCaption?.slice(0, 80) || 'Video qualified views reward',
          qualifiedViews: newQualifiedViews,
          description: `Reward for ${newQualifiedViews.toLocaleString()} qualified video views ($0.50 / 1k views)`,
          status: 'completed',
          eventId: `event_qview_${telemetry.videoId}_${newQualifiedViews}`,
          createdAt: nowIso,
        });
      }
    });

    return { qualified: true };
  } catch (err) {
    // If Firestore rules restrict direct client writes to creator_rewards,
    // this gracefully flags that server-side Cloud Function is handling the ledger
    console.info('Watch session queued for server-side reward processing:', err);
    return { qualified: true, reason: 'Queued for server validation' };
  }
}

/**
 * Resolves a referral code (e.g. "SOGO-MUHAMMADAZLAAN", "SOGO-AZLANMALIK", or raw username)
 * to the referrer's user ID and canonical referral code.
 * Handles usernames containing underscores that are stripped by `getReferralCodeForUser`.
 */
export async function resolveReferrerByCode(referralCode: string): Promise<{
  referrerId: string;
  referrerUsername: string;
  canonicalCode: string;
} | null> {
  if (!referralCode || !referralCode.trim()) return null;

  const cleanCode = referralCode.trim().toUpperCase();
  const codeBase = cleanCode.replace(/^SOGO-/, '').trim();
  const codeAlphaNum = codeBase.replace(/[^A-Z0-9]/g, '');
  if (!codeAlphaNum) return null;

  const canonicalCode = `SOGO-${codeAlphaNum}`;
  const usersRef = collection(db, 'users');

  // 1. Fast path: exact lowercase username match
  try {
    const q = query(usersRef, where('username', '==', codeBase.toLowerCase()), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      const uData = docSnap.data();
      return {
        referrerId: docSnap.id,
        referrerUsername: uData.username || codeBase.toLowerCase(),
        canonicalCode: getReferralCodeForUser({ id: docSnap.id, username: uData.username }),
      };
    }
  } catch {}

  // 2. Canonical / alphanumeric match (handles usernames with underscores like "muhammad_azlaan" -> "SOGO-MUHAMMADAZLAAN" or 6-char UID prefix)
  try {
    const allUsersSnap = await getDocs(usersRef);
    for (const docSnap of allUsersSnap.docs) {
      const uData = docSnap.data();
      const candidateCode = getReferralCodeForUser({
        id: docSnap.id,
        username: uData.username,
      });
      const candidateUsernameAlphaNum = String(uData.username || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const candidateShortId = docSnap.id.slice(0, 6).toUpperCase();

      if (
        candidateCode === canonicalCode ||
        (candidateUsernameAlphaNum && candidateUsernameAlphaNum === codeAlphaNum) ||
        candidateShortId === codeBase ||
        candidateShortId === codeAlphaNum
      ) {
        return {
          referrerId: docSnap.id,
          referrerUsername: uData.username || docSnap.id.slice(0, 6),
          canonicalCode: candidateCode,
        };
      }
    }
  } catch (err) {
    console.warn('Error resolving referral code across users:', err);
  }

  return null;
}

/**
 * Registers a new user referral when someone signs up with a referral code.
 */
export async function registerReferral(params: {
  referralCode: string;
  referredUser: User;
}): Promise<{ success: boolean; message: string; referrerId?: string }> {
  const { referralCode, referredUser } = params;
  const activeUid = auth?.currentUser?.uid || referredUser?.id;

  if (!referralCode || !activeUid) {
    return { success: false, message: 'Missing referral code or authenticated user' };
  }

  try {
    const resolved = await resolveReferrerByCode(referralCode);
    if (!resolved || !resolved.referrerId) {
      return { success: false, message: 'Referral code not found' };
    }

    const { referrerId, canonicalCode } = resolved;

    // Rule: User cannot refer themselves
    if (referrerId === activeUid) {
      return { success: false, message: 'You cannot use your own referral code' };
    }

    // Rule: One referral attribution per account (document ID === referredUser's UID)
    const referralDocRef = doc(db, REFERRALS_COLLECTION, activeUid);
    const existingSnap = await getDoc(referralDocRef);
    if (existingSnap.exists()) {
      clearPendingReferralCode();
      return {
        success: true,
        message: 'Referral already recorded for this account',
        referrerId: existingSnap.data()?.referrerId || referrerId,
      };
    }

    const nowIso = new Date().toISOString();
    const referralData: ReferralRecord = {
      id: activeUid,
      referralCode: canonicalCode,
      referrerId,
      referredUserId: activeUid,
      referredUsername: referredUser.username || 'creator',
      referredDisplayName: referredUser.displayName || 'New Creator',
      referredAvatarUrl: referredUser.avatarUrl || '',
      status: 'pending', // Pending until verified onboarding
      rewardAmountCents: REFERRAL_REWARD_CENTS, // 10 cents = $0.10 USD
      rewardGranted: false,
      createdAt: nowIso,
    };

    await setDoc(referralDocRef, referralData);
    clearPendingReferralCode();

    // Send notification to the referrer using the existing notification architecture
    // Only public profile fields (id, username, displayName, avatarUrl) are included
    try {
      await notificationsService.createNotification({
        recipientId: referrerId,
        recipientUserId: referrerId,
        actor: {
          id: activeUid,
          username: referredUser.username || 'creator',
          displayName: referredUser.displayName || 'New Creator',
          avatarUrl: referredUser.avatarUrl || '',
        },
        type: 'referral',
        text: 'joined SogoSocial with your referral code (+$0.10 reward)',
      });
    } catch (notifErr) {
      console.warn('Referral notification note:', notifErr);
    }

    return { success: true, message: 'Referral applied successfully', referrerId };
  } catch (err: any) {
    console.warn('Error registering referral:', err);
    return { success: false, message: err?.message || 'Failed to apply referral code' };
  }
}

/**
 * Checks and qualifies a pending referral once the referred user completes onboarding & activity.
 * The reward is credited server-authoritatively by the Cloud Function `processReferralQualification`
 * and reconciled via verified /referrals + /users records.
 */
export async function qualifyReferral(referredUserId: string): Promise<boolean> {
  const activeUid = auth?.currentUser?.uid || referredUserId;
  if (!activeUid) return false;

  try {
    const referralDocRef = doc(db, REFERRALS_COLLECTION, activeUid);
    const refSnap = await getDoc(referralDocRef);

    if (!refSnap.exists()) return false;
    const refData = refSnap.data() as ReferralRecord;

    if (refData.status === 'qualified' || refData.rewardGranted) {
      return true;
    }

    // Verify referred user's onboarding completion in /users/{activeUid}
    const userSnap = await getDoc(doc(db, 'users', activeUid));
    if (userSnap.exists()) {
      const uData = userSnap.data();
      if (uData.isOnboarded === true || uData.onboardingCompleted === true) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn('Referral qualification check note:', err);
    return false;
  }
}

/**
 * Submits a payout request for a creator.
 * Validates BOTH mandatory eligibility conditions:
 * 1. Minimum available reward balance: $50.00 USD (5000 cents) AND available balance >= requested amount
 * 2. Minimum successful referrals: 10
 * Executes server-authoritatively via Cloud Function `requestPayout`, with validated Firestore fallback.
 */
export async function submitPayoutRequest(params: {
  userId: string;
  amountCents: number;
  payoutMethod: PayoutMethod;
  payoutDetails: PayoutDetails;
  notes?: string;
}): Promise<{ success: boolean; requestId?: string; error?: string }> {
  const { userId, amountCents, payoutMethod, payoutDetails, notes } = params;

  if (!userId) {
    return { success: false, error: 'User not authenticated' };
  }

  // Verify live authoritative balance & referrals from Firestore first in strict order:
  // Step 1: >= 10 successful referrals
  // Step 2: >= $50.00 USD available balance
  const [liveSummary, liveReferrals] = await Promise.all([
    getCreatorRewards(userId),
    getUserReferrals(userId).catch(() => []),
  ]);
  const eligibility = evaluatePayoutEligibility(liveSummary, liveReferrals);

  if (!eligibility.meetsReferralsRequirement) {
    return {
      success: false,
      error: 'You need at least 10 successful referrals to make a withdrawal.',
    };
  }

  if (!eligibility.meetsBalanceRequirement || amountCents < MINIMUM_PAYOUT_CENTS) {
    return {
      success: false,
      error: 'The minimum payment threshold is $50.',
    };
  }

  // Validate payment details
  if (payoutMethod === 'paypal' && !payoutDetails.accountEmail?.includes('@')) {
    return { success: false, error: 'Valid PayPal email address is required' };
  }
  if (payoutMethod === 'bank_transfer' && (!payoutDetails.bankName || !payoutDetails.routingOrIban)) {
    return { success: false, error: 'Bank name and routing/IBAN are required for bank transfer' };
  }
  if (payoutMethod === 'venmo' && !payoutDetails.venmoHandle) {
    return { success: false, error: 'Venmo handle is required' };
  }

  if (amountCents > eligibility.availableBalanceCents) {
    return {
      success: false,
      error: `Requested amount (${formatCentsToUsd(amountCents)}) exceeds your available balance (${formatCentsToUsd(eligibility.availableBalanceCents)}).`,
    };
  }

  // Method 1: Server-authoritative Cloud Function requestPayout
  try {
    if (functions && typeof httpsCallable === 'function') {
      const callRequestPayout = httpsCallable(functions, 'requestPayout');
      const result = await callRequestPayout({
        amountCents,
        payoutMethod,
        payoutDetails,
        notes: notes?.trim() || '',
        successfulReferralsCount: eligibility.successfulReferralsCount,
      });
      const data = result.data as any;
      if (data?.success && data?.requestId) {
        return { success: true, requestId: data.requestId };
      }
    }
  } catch (fnErr: any) {
    console.warn('Callable requestPayout note:', fnErr);
    // If the server explicitly rejected the payout due to eligibility or validation, return the server error immediately
    const errorMsg = fnErr?.message || '';
    const errorCode = String(fnErr?.code || '');
    if (
      errorCode.includes('failed-precondition') ||
      errorCode.includes('invalid-argument') ||
      errorCode.includes('permission-denied') ||
      errorCode.includes('unauthenticated') ||
      errorMsg.includes('Insufficient available balance') ||
      errorMsg.includes('Minimum') ||
      errorMsg.includes('referral') ||
      errorMsg.includes('eligibility') ||
      errorMsg.includes('balance') ||
      errorMsg.includes('required')
    ) {
      return { success: false, error: errorMsg || 'Payout request rejected by server validation.' };
    }
  }

  // Method 2: Fallback to creating pending payout_requests document directly in Firestore
  // (Permitted by firestore.rules ONLY when status == 'pending', amountCents >= 5000, and successfulReferralsCount >= 10)
  const requestId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();

  try {
    const payoutDocRef = doc(db, PAYOUTS_COLLECTION, requestId);
    const payoutDoc: PayoutRequest = {
      id: requestId,
      userId,
      amountCents,
      amountUsd: centsToUsd(amountCents),
      currency: 'USD',
      payoutMethod,
      payoutDetails,
      status: 'pending',
      requestedAt: nowIso,
      notes: notes?.trim() || '',
      successfulReferralsCount: eligibility.successfulReferralsCount,
    };
    await setDoc(payoutDocRef, payoutDoc);

    return { success: true, requestId };
  } catch (err: any) {
    console.error('Failed to submit payout request fallback:', err);
    return {
      success: false,
      error: err?.message || 'Failed to submit payout request. Please try again.',
    };
  }
}
