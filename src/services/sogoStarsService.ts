import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import {
  SogoStarMissionDefinition,
  SogoStarMissionId,
  SogoStarMissionProgress,
  SogoStarsDailyState,
} from '../types';

export const SOGO_STARS_DAILY_COLLECTION = 'sogo_stars_daily';
const REWARDS_COLLECTION = 'creator_rewards';
const LEDGER_COLLECTION = 'reward_ledger';
const LOCAL_SOGO_STARS_CACHE_PREFIX = 'sogo_stars_daily_v1_';

// ==========================================
// SOGO STARS MONETIZATION CONSTANTS
// ==========================================

export const MAX_DAILY_SOGO_STARS = 500; // Hard server-side & client-side daily cap
export const STARS_PER_USD_DOLLAR = 1000; // 1,000 Stars = $1.00 USD
export const STARS_PER_USD_CENT = 10; // 10 Stars = $0.01 USD
export const MAX_DAILY_SOGO_STARS_CENTS = 50; // 500 Stars = $0.50 USD max per day

/**
 * Exact 8 daily Sogo Stars missions.
 * Total possible: 100 + 100 + 50 + 50 + 50 + 50 + 50 + 50 = 500 Stars/day ($0.50/day).
 */
export const SOGO_STAR_MISSIONS: SogoStarMissionDefinition[] = [
  {
    id: 'watch_ad',
    title: 'Watch an Ad — Earn 100 Sogo Stars',
    description: 'Watch a daily rewarded video ad to earn 100 Stars',
    targetCount: 1,
    rewardStars: 100,
    rewardCents: 10,
    rewardUsd: 0.10,
  },
  {
    id: 'post_reels',
    title: 'Post 3 new Reels',
    description: 'Upload and publish 3 new genuine Reels today',
    targetCount: 3,
    rewardStars: 100,
    rewardCents: 10,
    rewardUsd: 0.10,
  },
  {
    id: 'like_reels',
    title: 'Like 3 Reels',
    description: 'Like 3 distinct Reels from other creators today',
    targetCount: 3,
    rewardStars: 50,
    rewardCents: 5,
    rewardUsd: 0.05,
  },
  {
    id: 'comment_reels',
    title: 'Comment on 3 Reels',
    description: 'Leave meaningful comments on 3 Reels today',
    targetCount: 3,
    rewardStars: 50,
    rewardCents: 5,
    rewardUsd: 0.05,
  },
  {
    id: 'watch_reels',
    title: 'Watch 10 qualifying Reels',
    description: 'Watch 10 distinct qualifying Reels from other creators today',
    targetCount: 10,
    rewardStars: 50,
    rewardCents: 5,
    rewardUsd: 0.05,
  },
  {
    id: 'follow_creators',
    title: 'Follow 3 creators',
    description: 'Follow 3 distinct creators on SogoSocial today',
    targetCount: 3,
    rewardStars: 50,
    rewardCents: 5,
    rewardUsd: 0.05,
  },
  {
    id: 'create_posts',
    title: 'Create 3 new Posts',
    description: 'Publish 3 new community feed posts today',
    targetCount: 3,
    rewardStars: 50,
    rewardCents: 5,
    rewardUsd: 0.05,
  },
  {
    id: 'comment_posts',
    title: 'Comment on 3 Posts',
    description: 'Leave meaningful comments on 3 feed posts today',
    targetCount: 3,
    rewardStars: 50,
    rewardCents: 5,
    rewardUsd: 0.05,
  },
];

export const SOGO_STAR_MISSION_MAP: Record<SogoStarMissionId, SogoStarMissionDefinition> =
  SOGO_STAR_MISSIONS.reduce((acc, mission) => {
    acc[mission.id] = mission;
    return acc;
  }, {} as Record<SogoStarMissionId, SogoStarMissionDefinition>);

/**
 * Returns the canonical server-defined UTC calendar day key (YYYY-MM-DD).
 */
export function getCurrentSogoDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Converts Sogo Stars to integer USD cents (1,000 Stars = 100 cents / $1.00).
 */
export function starsToCents(stars: number): number {
  const safeStars = Math.max(0, Math.floor(Number(stars) || 0));
  return Math.floor(safeStars / STARS_PER_USD_CENT);
}

/**
 * Converts Sogo Stars to float USD (1,000 Stars = $1.00).
 */
export function starsToUsd(stars: number): number {
  const safeStars = Math.max(0, Number(stars) || 0);
  return Number((safeStars / STARS_PER_USD_DOLLAR).toFixed(2));
}

/**
 * Formats Sogo Stars value as a USD string (e.g. "$0.50").
 */
export function formatStarsUsd(stars: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(starsToUsd(stars));
}

/**
 * Builds the default empty missions map for a new calendar day.
 */
export function getDefaultDailyMissionsMap(): Record<SogoStarMissionId, SogoStarMissionProgress> {
  const map = {} as Record<SogoStarMissionId, SogoStarMissionProgress>;
  for (const def of SOGO_STAR_MISSIONS) {
    map[def.id] = {
      missionId: def.id,
      currentCount: 0,
      targetCount: def.targetCount,
      rewardStars: def.rewardStars,
      rewardCents: def.rewardCents,
      completed: false,
      rewardGranted: false,
      completedAt: null,
      actionKeys: [],
    };
  }
  return map;
}

/**
 * Builds an initial SogoStarsDailyState for a user and UTC date key.
 */
export function getInitialSogoStarsDailyState(
  userId: string,
  dateKey: string = getCurrentSogoDateKey()
): SogoStarsDailyState {
  return {
    id: `${userId}_${dateKey}`,
    userId,
    dateKey,
    starsEarnedToday: 0,
    maxDailyStars: MAX_DAILY_SOGO_STARS,
    centsEarnedToday: 0,
    completedMissionsCount: 0,
    totalMissionsCount: SOGO_STAR_MISSIONS.length,
    missions: getDefaultDailyMissionsMap(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Normalizes raw Firestore document data into a validated SogoStarsDailyState,
 * enforcing the hard 500 Stars / 50 cents daily cap and exact 7 mission structures.
 */
export function normalizeSogoStarsDailyState(
  userId: string,
  dateKey: string,
  raw?: Record<string, any> | null
): SogoStarsDailyState {
  const base = getInitialSogoStarsDailyState(userId, dateKey);
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const rawMissions = (raw.missions && typeof raw.missions === 'object') ? raw.missions : {};
  const normalizedMissions = getDefaultDailyMissionsMap();
  let computedStarsFromMissions = 0;
  let completedCount = 0;

  for (const def of SOGO_STAR_MISSIONS) {
    const m = rawMissions[def.id];
    if (m && typeof m === 'object') {
      const actionKeys = Array.isArray(m.actionKeys)
        ? m.actionKeys.filter((k: any) => typeof k === 'string').slice(0, def.targetCount * 2)
        : [];
      const rawCurrent = Math.max(
        0,
        Math.min(def.targetCount, Number(m.currentCount) || actionKeys.length || 0)
      );
      const completed = Boolean(m.completed || rawCurrent >= def.targetCount);
      const rewardGranted = Boolean(m.rewardGranted && completed);

      normalizedMissions[def.id] = {
        missionId: def.id,
        currentCount: completed ? def.targetCount : rawCurrent,
        targetCount: def.targetCount,
        rewardStars: def.rewardStars,
        rewardCents: def.rewardCents,
        completed,
        rewardGranted,
        completedAt: m.completedAt || null,
        actionKeys,
      };

      if (completed) {
        completedCount += 1;
      }
      if (rewardGranted) {
        computedStarsFromMissions += def.rewardStars;
      }
    }
  }

  const rawStarsEarned = Math.max(
    0,
    Number(raw.starsEarnedToday) || 0,
    computedStarsFromMissions
  );
  const clampedStars = Math.min(MAX_DAILY_SOGO_STARS, rawStarsEarned);
  const clampedCents = Math.min(MAX_DAILY_SOGO_STARS_CENTS, starsToCents(clampedStars));

  return {
    id: `${userId}_${dateKey}`,
    userId,
    dateKey,
    starsEarnedToday: clampedStars,
    maxDailyStars: MAX_DAILY_SOGO_STARS,
    centsEarnedToday: clampedCents,
    completedMissionsCount: Math.min(SOGO_STAR_MISSIONS.length, completedCount),
    totalMissionsCount: SOGO_STAR_MISSIONS.length,
    missions: normalizedMissions,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
  };
}

// Local cache & in-memory listeners for instant UI responsiveness
const localListeners = new Map<string, Set<(state: SogoStarsDailyState) => void>>();

// Track UIDs where cloud rules do not yet permit sogo_stars_daily reads/writes
// so we never repeatedly crash Firestore's shared WriteStream pipeline.
const sogoStarsCloudDeniedUids = new Set<string>();
const rewardsCloudDeniedUids = new Set<string>();
const ledgerCloudDeniedUids = new Set<string>();

function isPermissionDeniedError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'permission-denied' ||
    code.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions')
  );
}

export function getCachedSogoStarsDailyState(
  userId: string,
  dateKey: string = getCurrentSogoDateKey()
): SogoStarsDailyState | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${LOCAL_SOGO_STARS_CACHE_PREFIX}${userId}_${dateKey}`);
    if (raw) {
      return normalizeSogoStarsDailyState(userId, dateKey, JSON.parse(raw));
    }
  } catch {}
  return null;
}

function getCachedDailyState(userId: string, dateKey: string): SogoStarsDailyState | null {
  return getCachedSogoStarsDailyState(userId, dateKey);
}

/**
 * Merges two daily states for the same user and dateKey by unioning their mission actionKeys
 * so that an in-flight or offline action is never overwritten by a stale snapshot.
 */
export function mergeSogoStarsDailyStates(
  userId: string,
  dateKey: string,
  primary?: Record<string, any> | SogoStarsDailyState | null,
  secondary?: Record<string, any> | SogoStarsDailyState | null
): SogoStarsDailyState {
  const stateA = normalizeSogoStarsDailyState(userId, dateKey, primary || null);
  if (!secondary) return stateA;
  const stateB = normalizeSogoStarsDailyState(userId, dateKey, secondary || null);

  const mergedMissions = getDefaultDailyMissionsMap();
  let completedCount = 0;
  let computedStars = 0;

  for (const def of SOGO_STAR_MISSIONS) {
    const mA = stateA.missions[def.id];
    const mB = stateB.missions[def.id];
    const unionKeys = Array.from(
      new Set([...(mA?.actionKeys || []), ...(mB?.actionKeys || [])])
    ).slice(0, def.targetCount * 2);

    const currentCount = Math.min(
      def.targetCount,
      Math.max(mA?.currentCount || 0, mB?.currentCount || 0, unionKeys.length)
    );
    const completed = Boolean(
      mA?.completed || mB?.completed || currentCount >= def.targetCount
    );
    const rewardGranted = Boolean(
      (mA?.rewardGranted || mB?.rewardGranted || completed) && completed
    );

    mergedMissions[def.id] = {
      missionId: def.id,
      currentCount: completed ? def.targetCount : currentCount,
      targetCount: def.targetCount,
      rewardStars: def.rewardStars,
      rewardCents: def.rewardCents,
      completed,
      rewardGranted,
      completedAt: mA?.completedAt || mB?.completedAt || (completed ? new Date().toISOString() : null),
      actionKeys: unionKeys,
    };

    if (completed) {
      completedCount += 1;
    }
    if (rewardGranted) {
      computedStars += def.rewardStars;
    }
  }

  const clampedStars = Math.min(
    MAX_DAILY_SOGO_STARS,
    Math.max(stateA.starsEarnedToday, stateB.starsEarnedToday, computedStars)
  );
  const clampedCents = Math.min(MAX_DAILY_SOGO_STARS_CENTS, starsToCents(clampedStars));

  return {
    id: `${userId}_${dateKey}`,
    userId,
    dateKey,
    starsEarnedToday: clampedStars,
    maxDailyStars: MAX_DAILY_SOGO_STARS,
    centsEarnedToday: clampedCents,
    completedMissionsCount: Math.min(SOGO_STAR_MISSIONS.length, completedCount),
    totalMissionsCount: SOGO_STAR_MISSIONS.length,
    missions: mergedMissions,
    updatedAt:
      stateA.updatedAt >= stateB.updatedAt ? stateA.updatedAt : stateB.updatedAt,
  };
}

function setCachedDailyState(state: SogoStarsDailyState, aliasUserId?: string): void {
  const userIdsToNotify = Array.from(
    new Set([state.userId, aliasUserId].filter((id): id is string => Boolean(id)))
  );

  for (const uid of userIdsToNotify) {
    const aliasedState: SogoStarsDailyState =
      uid === state.userId
        ? state
        : { ...state, id: `${uid}_${state.dateKey}`, userId: uid };
    try {
      localStorage.setItem(
        `${LOCAL_SOGO_STARS_CACHE_PREFIX}${uid}_${state.dateKey}`,
        JSON.stringify(aliasedState)
      );
    } catch {}
    const key = `${uid}_${state.dateKey}`;
    const listeners = localListeners.get(key);
    if (listeners) {
      listeners.forEach((cb) => {
        try {
          cb(aliasedState);
        } catch {}
      });
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('sogo_stars_updated', {
          detail: { userId: state.userId, dateKey: state.dateKey, state },
        })
      );
    } catch {}
  }
}

/**
 * Fetches the user's Sogo Stars daily state for today (or a specified UTC dateKey).
 */
export async function getSogoStarsDailyState(
  userId: string,
  dateKey: string = getCurrentSogoDateKey()
): Promise<SogoStarsDailyState> {
  const effectiveUserId = auth?.currentUser?.uid || userId;
  if (!effectiveUserId) {
    return getInitialSogoStarsDailyState('', dateKey);
  }

  const cached =
    getCachedDailyState(effectiveUserId, dateKey) ||
    (userId !== effectiveUserId ? getCachedDailyState(userId, dateKey) : null);

  if (!sogoStarsCloudDeniedUids.has(effectiveUserId)) {
    try {
      const docId = `${effectiveUserId}_${dateKey}`;
      const docRef = doc(db, SOGO_STARS_DAILY_COLLECTION, docId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const merged = mergeSogoStarsDailyStates(
          effectiveUserId,
          dateKey,
          snap.data(),
          cached
        );
        setCachedDailyState(merged, userId);
        return merged;
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        sogoStarsCloudDeniedUids.add(effectiveUserId);
      } else {
        console.warn('Firestore getSogoStarsDailyState note:', err);
      }
    }
  }

  return cached || getInitialSogoStarsDailyState(effectiveUserId, dateKey);
}

/**
 * Subscribes in real time to the user's Sogo Stars daily mission progress for today.
 */
export function subscribeToSogoStarsDaily(
  userId: string,
  onUpdate: (state: SogoStarsDailyState) => void
): () => void {
  const dateKey = getCurrentSogoDateKey();
  const effectiveUserId = auth?.currentUser?.uid || userId;
  if (!effectiveUserId) {
    onUpdate(getInitialSogoStarsDailyState('', dateKey));
    return () => {};
  }

  const docId = `${effectiveUserId}_${dateKey}`;
  const aliasDocId = `${userId}_${dateKey}`;
  const initial =
    getCachedDailyState(effectiveUserId, dateKey) ||
    getCachedDailyState(userId, dateKey) ||
    getInitialSogoStarsDailyState(effectiveUserId, dateKey);
  onUpdate(initial);

  // Register local in-memory listener for instant optimistic updates
  if (!localListeners.has(docId)) {
    localListeners.set(docId, new Set());
  }
  localListeners.get(docId)!.add(onUpdate);

  if (aliasDocId !== docId) {
    if (!localListeners.has(aliasDocId)) {
      localListeners.set(aliasDocId, new Set());
    }
    localListeners.get(aliasDocId)!.add(onUpdate);
  }

  let unsubFirestore: (() => void) | null = null;
  if (!sogoStarsCloudDeniedUids.has(effectiveUserId)) {
    try {
      const docRef = doc(db, SOGO_STARS_DAILY_COLLECTION, docId);
      unsubFirestore = onSnapshot(
        docRef,
        (snap) => {
          const currentCached =
            getCachedDailyState(effectiveUserId, dateKey) ||
            getCachedDailyState(userId, dateKey);
          if (snap.exists()) {
            const merged = mergeSogoStarsDailyStates(
              effectiveUserId,
              dateKey,
              snap.data(),
              currentCached
            );
            setCachedDailyState(merged, userId);
            onUpdate(merged);
          } else {
            const fallback =
              currentCached || getInitialSogoStarsDailyState(effectiveUserId, dateKey);
            onUpdate(fallback);
          }
        },
        (err) => {
          if (isPermissionDeniedError(err)) {
            sogoStarsCloudDeniedUids.add(effectiveUserId);
          } else {
            console.warn('Firestore subscribeToSogoStarsDaily note:', err);
          }
        }
      );
    } catch {}
  }

  return () => {
    if (unsubFirestore) unsubFirestore();
    localListeners.get(docId)?.delete(onUpdate);
    localListeners.get(aliasDocId)?.delete(onUpdate);
  };
}

/**
 * Helper to apply a single mission action to a SogoStarsDailyState.
 */
function computeNextDailyStateForAction(
  currentState: SogoStarsDailyState,
  missionDef: SogoStarMissionDefinition,
  cleanActionKey: string,
  nowIso: string
): {
  updated: boolean;
  newlyCompleted: boolean;
  starsAwarded: number;
  centsAwarded: number;
  nextState: SogoStarsDailyState;
} {
  const missionId = missionDef.id;
  const missionProgress = currentState.missions[missionId];
  if (!missionProgress) {
    return {
      updated: false,
      newlyCompleted: false,
      starsAwarded: 0,
      centsAwarded: 0,
      nextState: currentState,
    };
  }

  if (missionProgress.completed && missionProgress.rewardGranted) {
    return {
      updated: false,
      newlyCompleted: false,
      starsAwarded: 0,
      centsAwarded: 0,
      nextState: currentState,
    };
  }

  const existingKeys = Array.isArray(missionProgress.actionKeys)
    ? missionProgress.actionKeys
    : [];
  if (existingKeys.includes(cleanActionKey)) {
    return {
      updated: false,
      newlyCompleted: false,
      starsAwarded: 0,
      centsAwarded: 0,
      nextState: currentState,
    };
  }

  const updatedKeys = [...existingKeys, cleanActionKey];
  const nextCount = Math.min(
    missionDef.targetCount,
    Math.max(missionProgress.currentCount + 1, updatedKeys.length)
  );
  const isNowComplete = nextCount >= missionDef.targetCount;

  let starsAwarded = 0;
  let centsAwarded = 0;
  let newlyCompleted = false;
  let rewardGranted = missionProgress.rewardGranted;

  if (isNowComplete && !rewardGranted) {
    const remainingAllowance = Math.max(
      0,
      MAX_DAILY_SOGO_STARS - currentState.starsEarnedToday
    );
    if (remainingAllowance > 0) {
      starsAwarded = Math.min(missionDef.rewardStars, remainingAllowance);
      centsAwarded = starsToCents(starsAwarded);
      rewardGranted = true;
      newlyCompleted = true;
    }
  }

  const nextMissions: Record<SogoStarMissionId, SogoStarMissionProgress> = {
    ...currentState.missions,
    [missionId]: {
      ...missionProgress,
      currentCount: nextCount,
      targetCount: missionDef.targetCount,
      rewardStars: missionDef.rewardStars,
      rewardCents: missionDef.rewardCents,
      completed: isNowComplete,
      rewardGranted,
      completedAt: isNowComplete ? missionProgress.completedAt || nowIso : null,
      actionKeys: updatedKeys,
    },
  };

  const nextCompletedCount = Object.values(nextMissions).filter(
    (m) => m.completed
  ).length;
  const nextStarsEarnedToday = Math.min(
    MAX_DAILY_SOGO_STARS,
    currentState.starsEarnedToday + starsAwarded
  );
  const nextCentsEarnedToday = Math.min(
    MAX_DAILY_SOGO_STARS_CENTS,
    starsToCents(nextStarsEarnedToday)
  );

  const nextState: SogoStarsDailyState = {
    id: currentState.id,
    userId: currentState.userId,
    dateKey: currentState.dateKey,
    starsEarnedToday: nextStarsEarnedToday,
    maxDailyStars: MAX_DAILY_SOGO_STARS,
    centsEarnedToday: nextCentsEarnedToday,
    completedMissionsCount: nextCompletedCount,
    totalMissionsCount: SOGO_STAR_MISSIONS.length,
    missions: nextMissions,
    updatedAt: nowIso,
  };

  return {
    updated: true,
    newlyCompleted,
    starsAwarded,
    centsAwarded,
    nextState,
  };
}

/**
 * Records a user action toward one of the 7 daily Sogo Stars missions.
 *
 * Enforces:
 * - Hard 500 Stars / day server-defined UTC calendar day limit
 * - Mission-specific deduplication via `actionKey` (cannot like/watch/follow the same target repeatedly)
 * - Anti-self-farming for watch_reels and follow_creators
 * - Single reward grant per mission per day via deterministic ledger ID `txn_stars_{userId}_{dateKey}_{missionId}`
 * - Atomic conversion of earned Stars into the existing Creator Rewards USD balance (1,000 Stars = $1.00)
 */
export async function recordSogoStarAction(params: {
  userId: string;
  missionId: SogoStarMissionId;
  actionKey: string;
  targetOwnerId?: string;
}): Promise<{
  updated: boolean;
  newlyCompleted: boolean;
  starsAwarded: number;
  centsAwarded: number;
  state?: SogoStarsDailyState;
}> {
  const { userId, missionId, actionKey, targetOwnerId } = params;
  const effectiveUserId = auth?.currentUser?.uid || userId;

  if (!effectiveUserId || !missionId || !actionKey) {
    return { updated: false, newlyCompleted: false, starsAwarded: 0, centsAwarded: 0 };
  }

  const missionDef = SOGO_STAR_MISSION_MAP[missionId];
  if (!missionDef) {
    return { updated: false, newlyCompleted: false, starsAwarded: 0, centsAwarded: 0 };
  }

  // Anti-self-farming guard for watch_reels and follow_creators
  const selfRestrictedMissions: SogoStarMissionId[] = [
    'watch_reels',
    'follow_creators',
  ];
  if (
    selfRestrictedMissions.includes(missionId) &&
    targetOwnerId &&
    (targetOwnerId === effectiveUserId || targetOwnerId === userId)
  ) {
    return { updated: false, newlyCompleted: false, starsAwarded: 0, centsAwarded: 0 };
  }

  const dateKey = getCurrentSogoDateKey();
  const dailyDocId = `${effectiveUserId}_${dateKey}`;
  const ledgerId = `txn_stars_${effectiveUserId}_${dateKey}_${missionId}`;
  const cleanActionKey = String(actionKey).trim().slice(0, 120);

  if (!cleanActionKey) {
    return { updated: false, newlyCompleted: false, starsAwarded: 0, centsAwarded: 0 };
  }

  const nowIso = new Date().toISOString();

  // 1. Optimistically compute and cache the updated mission progress immediately
  // so the UI reflects 1/3, 2/3, 3/3 right away with zero lag.
  const baseCached =
    getCachedDailyState(effectiveUserId, dateKey) ||
    getCachedDailyState(userId, dateKey) ||
    getInitialSogoStarsDailyState(effectiveUserId, dateKey);

  const optimisticStep = computeNextDailyStateForAction(
    baseCached,
    missionDef,
    cleanActionKey,
    nowIso
  );

  if (!optimisticStep.updated) {
    return {
      updated: false,
      newlyCompleted: false,
      starsAwarded: 0,
      centsAwarded: 0,
      state: baseCached,
    };
  }

  setCachedDailyState(optimisticStep.nextState, userId);

  const dailyRef = doc(db, SOGO_STARS_DAILY_COLLECTION, dailyDocId);
  const rewardsRef = doc(db, REWARDS_COLLECTION, effectiveUserId);
  const ledgerRef = doc(db, LEDGER_COLLECTION, ledgerId);

  // 2. Persist daily mission progress & (if newly completed) reward balance + ledger to Firestore
  // asynchronously in the background so user social actions (Like / Comment / Follow / Post) never wait.
  (async () => {
    if (sogoStarsCloudDeniedUids.has(effectiveUserId)) {
      return;
    }

    try {
      // Read via unary getDoc first (does not touch PersistentWriteStream).
      // If cloud rules deny sogo_stars_daily, circuit-break immediately without crashing WriteStream.
      const dailySnap = await getDoc(dailyRef);
      const mergedBefore = mergeSogoStarsDailyStates(
        effectiveUserId,
        dateKey,
        dailySnap.exists() ? dailySnap.data() : null,
        baseCached
      );

      const step = computeNextDailyStateForAction(
        mergedBefore,
        missionDef,
        cleanActionKey,
        nowIso
      );

      const targetState = step.updated ? step.nextState : optimisticStep.nextState;
      const targetMission = targetState.missions[missionId];
      const isMissionCompleted = Boolean(targetMission?.completed && targetMission?.rewardGranted);
      const wasCompletedInFirestore = Boolean(
        dailySnap.exists() &&
          dailySnap.data()?.missions?.[missionId]?.completed &&
          dailySnap.data()?.missions?.[missionId]?.rewardGranted
      );

      const shouldGrantRewardInFirestore =
        isMissionCompleted && (!wasCompletedInFirestore || step.newlyCompleted || optimisticStep.newlyCompleted);

      await setDoc(dailyRef, targetState, { merge: true });
      setCachedDailyState(targetState, userId);

      if (shouldGrantRewardInFirestore) {
        let finalStarsAwarded = step.starsAwarded || optimisticStep.starsAwarded;
        let finalCentsAwarded = step.centsAwarded || optimisticStep.centsAwarded;
        if (finalStarsAwarded <= 0) {
          finalStarsAwarded = missionDef.rewardStars;
          finalCentsAwarded = missionDef.rewardCents;
        }
        const usdFloat = Number((finalCentsAwarded / 100).toFixed(2));

        if (!ledgerCloudDeniedUids.has(effectiveUserId)) {
          try {
            const ledgerSnap = await getDoc(ledgerRef);
            if (!ledgerSnap.exists()) {
              await setDoc(ledgerRef, {
                id: ledgerId,
                userId: effectiveUserId,
                type: 'sogo_stars_reward',
                transactionType: 'SOGO_STARS_MISSION_REWARD',
                isAdminTestData: false,
                amountCents: finalCentsAwarded,
                amountUsd: usdFloat,
                currency: 'USD',
                starsEarned: finalStarsAwarded,
                missionId,
                dateKey,
                description: `⭐ Sogo Stars: ${missionDef.title} (+${finalStarsAwarded} Stars → +$${usdFloat.toFixed(2)})`,
                status: 'completed',
                eventId: `sogo_stars_${effectiveUserId}_${dateKey}_${missionId}`,
                createdAt: nowIso,
              });
            }
          } catch (ledgerErr) {
            if (isPermissionDeniedError(ledgerErr)) {
              ledgerCloudDeniedUids.add(effectiveUserId);
            }
          }
        }

        if (!rewardsCloudDeniedUids.has(effectiveUserId)) {
          try {
            const rSnap = await getDoc(rewardsRef);
            if (rSnap.exists()) {
              const rData = rSnap.data();
              await updateDoc(rewardsRef, {
                availableBalanceCents: (Number(rData.availableBalanceCents) || 0) + finalCentsAwarded,
                totalEarnedCents: (Number(rData.totalEarnedCents) || 0) + finalCentsAwarded,
                sogoStarsRewardsCents: (Number(rData.sogoStarsRewardsCents) || 0) + finalCentsAwarded,
                sogoStarsTotal: (Number(rData.sogoStarsTotal) || 0) + finalStarsAwarded,
                sogoStarsToday: targetState.starsEarnedToday,
                sogoStarsDateKey: dateKey,
                updatedAt: nowIso,
              });
            } else {
              await setDoc(rewardsRef, {
                userId: effectiveUserId,
                availableBalanceCents: finalCentsAwarded,
                totalEarnedCents: finalCentsAwarded,
                videoRewardsCents: 0,
                referralRewardsCents: 0,
                sogoStarsRewardsCents: finalCentsAwarded,
                sogoStarsTotal: finalStarsAwarded,
                sogoStarsToday: targetState.starsEarnedToday,
                sogoStarsDateKey: dateKey,
                pendingEarningsCents: 0,
                withdrawnAmountCents: 0,
                pendingPayoutCents: 0,
                qualifiedViewsCount: 0,
                successfulReferralsCount: 0,
                currency: 'USD',
                updatedAt: nowIso,
              });
            }
          } catch (rewardsErr) {
            if (isPermissionDeniedError(rewardsErr)) {
              rewardsCloudDeniedUids.add(effectiveUserId);
            }
          }
        }
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        sogoStarsCloudDeniedUids.add(effectiveUserId);
      } else {
        console.warn('Sogo Stars background sync note:', err);
      }
    }
  })().catch(() => {});

  return {
    updated: optimisticStep.updated,
    newlyCompleted: optimisticStep.newlyCompleted,
    starsAwarded: optimisticStep.starsAwarded,
    centsAwarded: optimisticStep.centsAwarded,
    state: optimisticStep.nextState,
  };
}

/**
 * Atomically claims the daily 100 Sogo Stars reward for watching a rewarded ad.
 *
 * Enforces:
 * - Exactly once per calendar day (UTC YYYY-MM-DD).
 * - Enforced server-side via Firestore transaction on:
 *   1) Deterministic ledger document `reward_ledger/txn_stars_{userId}_{dateKey}_watch_ad`.
 *   2) Daily progress document `sogo_stars_daily/{userId}_{dateKey}` with `missions.watch_ad.rewardGranted == true`.
 *   3) Atomic update of `creator_rewards/{userId}` available balance (+10 cents) and Stars (+100).
 * - Rejects any duplicate claims immediately, across app restarts, reinstalls, or repeated taps.
 */
export async function claimRewardedAdStars(userId: string): Promise<{
  success: boolean;
  alreadyClaimed?: boolean;
  starsAwarded: number;
  centsAwarded: number;
  error?: string;
  state?: SogoStarsDailyState;
}> {
  const effectiveUserId = auth?.currentUser?.uid || userId;
  if (!effectiveUserId) {
    return {
      success: false,
      starsAwarded: 0,
      centsAwarded: 0,
      error: 'User is not authenticated.',
    };
  }

  const dateKey = getCurrentSogoDateKey();
  const dailyDocId = `${effectiveUserId}_${dateKey}`;
  const ledgerId = `txn_stars_${effectiveUserId}_${dateKey}_watch_ad`;
  const missionDef = SOGO_STAR_MISSION_MAP['watch_ad'];
  const rewardStars = missionDef ? missionDef.rewardStars : 100;
  const nowIso = new Date().toISOString();

  // Fast pre-check from local cache to avoid unnecessary network calls
  const cached = getCachedDailyState(effectiveUserId, dateKey);
  if (cached?.missions?.watch_ad?.rewardGranted) {
    return {
      success: false,
      alreadyClaimed: true,
      starsAwarded: 0,
      centsAwarded: 0,
      error: 'Daily rewarded ad has already been claimed today. Check back tomorrow!',
      state: cached,
    };
  }

  const dailyRef = doc(db, SOGO_STARS_DAILY_COLLECTION, dailyDocId);
  const rewardsRef = doc(db, REWARDS_COLLECTION, effectiveUserId);
  const ledgerRef = doc(db, LEDGER_COLLECTION, ledgerId);

  try {
    const transactionResult = await runTransaction(db, async (txn) => {
      // 1. Read existing ledger record (idempotency check)
      const ledgerSnap = await txn.get(ledgerRef);
      if (ledgerSnap.exists()) {
        throw new Error('ALREADY_CLAIMED');
      }

      // 2. Read existing daily progress
      const dailySnap = await txn.get(dailyRef);
      const existingDailyData = dailySnap.exists() ? dailySnap.data() : null;
      if (existingDailyData?.missions?.watch_ad?.rewardGranted) {
        throw new Error('ALREADY_CLAIMED');
      }

      // 3. Read existing rewards summary
      const rewardsSnap = await txn.get(rewardsRef);

      // 4. Compute updated daily state
      const currentDailyState = normalizeSogoStarsDailyState(
        effectiveUserId,
        dateKey,
        existingDailyData || cached
      );

      const remainingAllowance = Math.max(
        0,
        MAX_DAILY_SOGO_STARS - currentDailyState.starsEarnedToday
      );
      const starsToAward = Math.min(rewardStars, remainingAllowance);
      const centsToAward = starsToCents(starsToAward);

      const updatedMissions = {
        ...currentDailyState.missions,
        watch_ad: {
          missionId: 'watch_ad' as SogoStarMissionId,
          currentCount: 1,
          targetCount: 1,
          rewardStars: 100,
          rewardCents: 10,
          completed: true,
          rewardGranted: true,
          completedAt: nowIso,
          actionKeys: ['rewarded_ad_watched'],
        },
      };

      const completedCount = Object.values(updatedMissions).filter(
        (m) => m.completed
      ).length;
      const nextStarsEarnedToday = Math.min(
        MAX_DAILY_SOGO_STARS,
        currentDailyState.starsEarnedToday + starsToAward
      );
      const nextCentsEarnedToday = Math.min(
        MAX_DAILY_SOGO_STARS_CENTS,
        starsToCents(nextStarsEarnedToday)
      );

      const nextDailyState: SogoStarsDailyState = {
        id: dailyDocId,
        userId: effectiveUserId,
        dateKey,
        starsEarnedToday: nextStarsEarnedToday,
        maxDailyStars: MAX_DAILY_SOGO_STARS,
        centsEarnedToday: nextCentsEarnedToday,
        completedMissionsCount: Math.min(SOGO_STAR_MISSIONS.length, completedCount),
        totalMissionsCount: SOGO_STAR_MISSIONS.length,
        missions: updatedMissions,
        updatedAt: nowIso,
      };

      // 5. Atomic write: Daily state
      txn.set(dailyRef, nextDailyState, { merge: true });

      // 6. Atomic write: Ledger transaction record
      txn.set(ledgerRef, {
        id: ledgerId,
        userId: effectiveUserId,
        type: 'sogo_stars_reward',
        transactionType: 'SOGO_STARS_MISSION_REWARD',
        isAdminTestData: false,
        amountCents: centsToAward,
        amountUsd: Number((centsToAward / 100).toFixed(2)),
        currency: 'USD',
        starsEarned: starsToAward,
        missionId: 'watch_ad',
        dateKey,
        description: `⭐ Sogo Stars: Watch an Ad (+${starsToAward} Stars → +$${(centsToAward / 100).toFixed(2)})`,
        status: 'completed',
        eventId: `sogo_stars_${effectiveUserId}_${dateKey}_watch_ad`,
        createdAt: nowIso,
      });

      // 7. Atomic write: Creator Rewards balance update
      if (rewardsSnap.exists()) {
        const rData = rewardsSnap.data();
        txn.update(rewardsRef, {
          availableBalanceCents: (Number(rData.availableBalanceCents) || 0) + centsToAward,
          totalEarnedCents: (Number(rData.totalEarnedCents) || 0) + centsToAward,
          sogoStarsRewardsCents: (Number(rData.sogoStarsRewardsCents) || 0) + centsToAward,
          sogoStarsTotal: (Number(rData.sogoStarsTotal) || 0) + starsToAward,
          sogoStarsToday: nextStarsEarnedToday,
          sogoStarsDateKey: dateKey,
          updatedAt: nowIso,
        });
      } else {
        txn.set(rewardsRef, {
          userId: effectiveUserId,
          availableBalanceCents: centsToAward,
          totalEarnedCents: centsToAward,
          videoRewardsCents: 0,
          referralRewardsCents: 0,
          sogoStarsRewardsCents: centsToAward,
          sogoStarsTotal: starsToAward,
          sogoStarsToday: nextStarsEarnedToday,
          sogoStarsDateKey: dateKey,
          pendingEarningsCents: 0,
          withdrawnAmountCents: 0,
          pendingPayoutCents: 0,
          qualifiedViewsCount: 0,
          successfulReferralsCount: 0,
          currency: 'USD',
          updatedAt: nowIso,
        });
      }

      return {
        starsAwarded: starsToAward,
        centsAwarded: centsToAward,
        state: nextDailyState,
      };
    });

    // Update local caches and notify listeners
    setCachedDailyState(transactionResult.state, userId);

    return {
      success: true,
      starsAwarded: transactionResult.starsAwarded,
      centsAwarded: transactionResult.centsAwarded,
      state: transactionResult.state,
    };
  } catch (error: any) {
    if (error?.message === 'ALREADY_CLAIMED') {
      const refreshedState = await getSogoStarsDailyState(effectiveUserId, dateKey);
      return {
        success: false,
        alreadyClaimed: true,
        starsAwarded: 0,
        centsAwarded: 0,
        error: 'Daily rewarded ad has already been claimed today. Check back tomorrow!',
        state: refreshedState,
      };
    }

    console.warn('claimRewardedAdStars transaction error:', error);
    return {
      success: false,
      starsAwarded: 0,
      centsAwarded: 0,
      error: error?.message || 'Failed to claim daily Stars reward. Please try again.',
    };
  }
}

