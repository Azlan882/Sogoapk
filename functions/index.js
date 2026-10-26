/**
 * SogoSocial Creator Rewards - Firebase Cloud Functions
 * 
 * Server-authoritative reward qualification, fraud detection, and ledger processing.
 * To deploy:
 *   cd functions && npm install && firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { FieldValue } = require('firebase-admin/firestore');
const increment = (n) => FieldValue.increment(n);

const QUALIFIED_VIEW_RATE_CENTS_PER_1K = 50; // $0.50 USD per 1,000 views
const REFERRAL_REWARD_CENTS = 50; // $0.50 USD per qualified referral
const MINIMUM_PAYOUT_CENTS = 5000; // $50.00 USD minimum payout
const MINIMUM_PAYOUT_REFERRALS = 10; // Minimum 10 successful referrals required for payout
const MIN_WATCH_DURATION_SEC = 5; // 5 seconds continuous playback
const COOLDOWN_HOURS = 24;

/**
 * Helper: Server-side authoritative verification of a creator's successful referrals count.
 * Checks both creator_rewards.successfulReferralsCount and verified /referrals + /users records.
 */
async function getVerifiedSuccessfulReferralsCount(userId, recordedCount = 0) {
  const baseCount = Math.max(0, Math.round(Number(recordedCount) || 0));
  if (!userId) return baseCount;

  try {
    const refSnap = await db.collection('referrals').where('referrerId', '==', userId).get();
    if (refSnap.empty) return baseCount;

    let verifiedCount = 0;
    for (const d of refSnap.docs) {
      const rData = d.data() || {};
      const referredUserId = rData.referredUserId || d.id;
      if (!referredUserId || referredUserId === userId || rData.status === 'rejected') {
        continue;
      }
      if (rData.status === 'qualified' && rData.rewardGranted === true) {
        verifiedCount += 1;
        continue;
      }
      try {
        const uSnap = await db.collection('users').doc(referredUserId).get();
        if (uSnap.exists) {
          const uData = uSnap.data() || {};
          const isOnboarded = Boolean(
            uData.isOnboarded === true ||
              uData.onboardingCompleted === true ||
              (uData.username && (uData.displayName || uData.fullName) && uData.birthday)
          );
          if (isOnboarded) {
            verifiedCount += 1;
          }
        }
      } catch {}
    }

    return Math.max(baseCount, verifiedCount);
  } catch (err) {
    console.warn('[getVerifiedSuccessfulReferralsCount] lookup note:', err);
    return baseCount;
  }
}

/**
 * 1. Process Video Watch Session Trigger
 * Runs server-side when a client logs a watch session.
 */
exports.processVideoWatchSession = functions.firestore
  .document('video_watch_sessions/{sessionId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const sessionId = context.params.sessionId;

    if (!data) return null;

    const { viewerUid, creatorUid, videoId, watchDurationSeconds, cooldownKey } = data;

    // Rule 1: Viewer must be logged in
    if (!viewerUid) {
      console.log(`[Disqualified] Session ${sessionId}: Anonymous viewer`);
      return snap.ref.update({ status: 'disqualified', reason: 'Anonymous viewer' });
    }

    // Rule 2: Creator self-views do not generate rewards
    if (viewerUid === creatorUid) {
      console.log(`[Disqualified] Session ${sessionId}: Creator self-view`);
      return snap.ref.update({ status: 'disqualified', reason: 'Creator self-view' });
    }

    // Rule 3: Watch duration threshold (>= 5s)
    if ((watchDurationSeconds || 0) < MIN_WATCH_DURATION_SEC) {
      console.log(`[Disqualified] Session ${sessionId}: Watch duration ${watchDurationSeconds}s < ${MIN_WATCH_DURATION_SEC}s`);
      return snap.ref.update({ status: 'disqualified', reason: 'Duration below minimum' });
    }

    // Rule 4: Server-side 24-hour cooldown verification
    const cooldownDocRef = db.collection('reward_view_cooldowns').doc(cooldownKey || `${videoId}_${viewerUid}`);
    const nowMs = Date.now();

    try {
      const cooldownSnap = await cooldownDocRef.get();
      if (cooldownSnap.exists) {
        const lastViewTime = cooldownSnap.data().timestampMs || 0;
        if (nowMs - lastViewTime < COOLDOWN_HOURS * 60 * 60 * 1000) {
          console.log(`[Disqualified] Session ${sessionId}: Within 24-hour cooldown`);
          return snap.ref.update({ status: 'disqualified', reason: '24h cooldown active' });
        }
      }

      // Record new cooldown timestamp
      await cooldownDocRef.set({
        videoId,
        viewerUid,
        creatorUid,
        timestampMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('Cooldown check error:', err);
    }

    // Rule 5: Atomically increment qualified views and update creator ledger
    const creatorRewardsRef = db.collection('creator_rewards').doc(creatorUid);
    const nowIso = new Date().toISOString();

    await db.runTransaction(async (t) => {
      const creatorDoc = await t.get(creatorRewardsRef);
      const currentData = creatorDoc.exists ? creatorDoc.data() : {
        userId: creatorUid,
        qualifiedViewsCount: 0,
        videoRewardsCents: 0,
        availableBalanceCents: 0,
        totalEarnedCents: 0,
      };

      const newQualifiedViews = (currentData.qualifiedViewsCount || 0) + 1;
      const newVideoRewardsCents = Math.floor((newQualifiedViews * QUALIFIED_VIEW_RATE_CENTS_PER_1K) / 1000);
      const deltaCents = newVideoRewardsCents - (currentData.videoRewardsCents || 0);

      t.set(creatorRewardsRef, {
        userId: creatorUid,
        qualifiedViewsCount: newQualifiedViews,
        videoRewardsCents: newVideoRewardsCents,
        availableBalanceCents: (currentData.availableBalanceCents || 0) + deltaCents,
        totalEarnedCents: (currentData.totalEarnedCents || 0) + deltaCents,
        updatedAt: nowIso,
      }, { merge: true });

      // If milestone or earned incremental cents, write to ledger
      if (deltaCents > 0 || newQualifiedViews % 100 === 0) {
        const txnId = `txn_vid_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
        const ledgerRef = db.collection('reward_ledger').doc(txnId);
        t.set(ledgerRef, {
          id: txnId,
          userId: creatorUid,
          type: 'video_reward',
          amountCents: deltaCents,
          amountUsd: deltaCents / 100,
          currency: 'USD',
          videoId,
          qualifiedViews: newQualifiedViews,
          description: `Reward for ${newQualifiedViews} qualified video views ($0.50 / 1,000 views)`,
          status: 'completed',
          eventId: `event_qview_${videoId}_${newQualifiedViews}`,
          createdAt: nowIso,
        });
      }
    });

    return snap.ref.update({ status: 'qualified', qualifiedAt: nowIso });
  });

/**
 * 2. Process Referral Qualification Trigger
 * Runs server-side when a referred user completes onboarding/verification.
 * Server independently validates referrer legitimacy, code consistency, and enforces strict idempotency.
 */
exports.processReferralQualification = functions.firestore
  .document('referrals/{referredUserId}')
  .onWrite(async (change, context) => {
    const afterData = change.after.data();
    if (!afterData) return null;

    const referredUserId = context.params.referredUserId;
    const { referrerId, referralCode, status, rewardGranted } = afterData;

    // Do not re-process if already qualified or reward already granted
    if (status === 'qualified' || rewardGranted === true) {
      return null;
    }

    // Rule 1: Validate referred user profile in /users
    const userSnap = await db.collection('users').doc(referredUserId).get();
    if (!userSnap.exists) {
      console.log(`[Referral] User ${referredUserId} document not found`);
      return null;
    }
    const userData = userSnap.data();

    // Must be fully onboarded
    const isOnboarded = userData.isOnboarded || (userData.displayName && userData.username);
    if (!isOnboarded) {
      console.log(`[Referral] User ${referredUserId} not yet onboarded`);
      return null;
    }

    // Rule 2: Strictly prevent self-referral
    if (!referrerId || referrerId === referredUserId) {
      console.log(`[Referral] Self-referral rejected for ${referredUserId}`);
      return change.after.ref.update({ status: 'rejected', reason: 'Self-referral prohibited' });
    }

    // Rule 3: Server independently verifies referrer account exists
    const referrerSnap = await db.collection('users').doc(referrerId).get();
    if (!referrerSnap.exists) {
      console.log(`[Referral] Referrer ${referrerId} does not exist in users collection`);
      return change.after.ref.update({ status: 'rejected', reason: 'Referrer user account does not exist' });
    }
    const referrerData = referrerSnap.data();

    // Rule 4: Server validates referral code matches referrer username/id
    if (referralCode && typeof referralCode === 'string') {
      const cleanCode = referralCode.trim().toUpperCase();
      const referrerUsername = (referrerData.username || '').toUpperCase();
      const referrerNormalizedBase = referrerUsername.replace(/[^A-Z0-9]/g, '');
      const referrerShortId = referrerId.slice(0, 6).toUpperCase();
      const codeBase = cleanCode.replace(/^SOGO-/, '');
      const codeNormalizedBase = codeBase.replace(/[^A-Z0-9]/g, '');

      const matchesUsername =
        Boolean(referrerUsername) &&
        (codeBase === referrerUsername || codeNormalizedBase === referrerNormalizedBase);
      const matchesShortId = codeBase === referrerShortId || codeNormalizedBase === referrerShortId;

      if (!matchesUsername && !matchesShortId) {
        console.warn(`[Referral Fraud] Code mismatch: code ${cleanCode} does not match referrer @${referrerData.username}`);
        return change.after.ref.update({
          status: 'rejected',
          reason: 'Referral code does not match referrer identity'
        });
      }
    }

    // Rule 5: Strict server-side idempotency using deterministic ledger ID
    const deterministicLedgerId = `txn_ref_${referredUserId}`;
    const ledgerRef = db.collection('reward_ledger').doc(deterministicLedgerId);
    const referrerRewardsRef = db.collection('creator_rewards').doc(referrerId);
    const notifId = `notif_referral_${referredUserId}_${referrerId}`;
    const notifRef = db.collection('notifications').doc(notifId);
    const nowIso = new Date().toISOString();

    try {
      await db.runTransaction(async (t) => {
        // Idempotency check 1: Check deterministic ledger record
        const existingTxn = await t.get(ledgerRef);
        if (existingTxn.exists) {
          console.log(`[Referral Idempotency] Reward already recorded for referred user ${referredUserId}`);
          return;
        }

        // Idempotency check 2: Check current referral doc state
        const currentRefDoc = await t.get(change.after.ref);
        if (currentRefDoc.exists) {
          const rData = currentRefDoc.data();
          if (rData.rewardGranted === true || rData.status === 'qualified') {
            console.log(`[Referral Idempotency] Referral doc already marked qualified`);
            return;
          }
        }

        // Retrieve referrer Creator Rewards summary
        const creatorDoc = await t.get(referrerRewardsRef);
        const currentData = creatorDoc.exists ? creatorDoc.data() : {
          userId: referrerId,
          successfulReferralsCount: 0,
          referralRewardsCents: 0,
          availableBalanceCents: 0,
          totalEarnedCents: 0,
        };

        const newReferralsCount = (currentData.successfulReferralsCount || 0) + 1;
        const newReferralRewardsCents = (currentData.referralRewardsCents || 0) + REFERRAL_REWARD_CENTS;
        const newAvailable = (currentData.availableBalanceCents || 0) + REFERRAL_REWARD_CENTS;
        const newTotal = (currentData.totalEarnedCents || 0) + REFERRAL_REWARD_CENTS;

        // Atomically update creator rewards balance
        t.set(referrerRewardsRef, {
          userId: referrerId,
          successfulReferralsCount: newReferralsCount,
          referralRewardsCents: newReferralRewardsCents,
          availableBalanceCents: newAvailable,
          totalEarnedCents: newTotal,
          updatedAt: nowIso,
        }, { merge: true });

        // Atomically create auditable ledger record with deterministic ID
        t.set(ledgerRef, {
          id: deterministicLedgerId,
          userId: referrerId,
          type: 'referral_reward',
          amountCents: REFERRAL_REWARD_CENTS,
          amountUsd: REFERRAL_REWARD_CENTS / 100,
          currency: 'USD',
          referredUserId,
          referredUsername: userData.username || 'creator',
          description: `Referral bonus: @${userData.username || 'creator'} joined SogoSocial ($0.50)`,
          status: 'completed',
          eventId: `event_ref_${referredUserId}`,
          createdAt: nowIso,
        });

        // Mark referral document qualified
        t.update(change.after.ref, {
          status: 'qualified',
          rewardGranted: true,
          qualifiedAt: nowIso,
        });

        // Create idempotent notification for the referrer (public profile info only)
        t.set(notifRef, {
          id: notifId,
          recipientId: referrerId,
          recipientUserId: referrerId,
          actorId: referredUserId,
          actorUserId: referredUserId,
          userId: referredUserId,
          type: 'referral',
          fromUser: {
            id: referredUserId,
            username: userData.username || 'creator',
            displayName: userData.displayName || userData.fullName || 'New Creator',
            avatarUrl: userData.avatarUrl || userData.photoURL || '',
          },
          text: 'joined SogoSocial with your referral code (+$0.50 reward)',
          timestamp: nowIso,
          createdAt: nowIso,
          read: false,
          isNotification: true,
        }, { merge: true });
      });
      console.log(`[Referral Success] Credited $0.50 to referrer ${referrerId} for user ${referredUserId}`);
    } catch (err) {
      console.error('[Referral Transaction Error]:', err);
    }

    return null;
  });

/**
 * Cloud Function: requestPayout
 * Authenticated creator requests payout of their available balance.
 * Validates BOTH mandatory eligibility requirements server-side:
 * - Caller is authenticated (uid from context.auth.uid)
 * - Requirement 1: Minimum available reward balance >= $50.00 USD (5,000 cents) AND >= requestedCents
 * - Requirement 2: Minimum successful referrals >= 10
 * - Atomically deducts available balance, reserves pending payout, creates payout request, and writes ledger
 */
exports.requestPayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userId = context.auth.uid;
  const { amountCents, payoutMethod, payoutDetails, notes } = data || {};
  const requestedCents = Math.round(Number(amountCents) || 0);

  if (requestedCents < MINIMUM_PAYOUT_CENTS) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Minimum payout is $50.00 USD (5000 cents). Requested: ${requestedCents} cents.`
    );
  }

  const validMethods = ['paypal', 'bank_transfer', 'venmo'];
  if (!payoutMethod || !validMethods.includes(payoutMethod)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Payout method must be one of: ${validMethods.join(', ')}.`
    );
  }

  if (!payoutDetails || typeof payoutDetails !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'Payout details are required.');
  }

  if (payoutMethod === 'paypal' && (!payoutDetails.accountEmail || !payoutDetails.accountEmail.includes('@'))) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid PayPal email address is required.');
  }
  if (payoutMethod === 'bank_transfer' && (!payoutDetails.bankName || !payoutDetails.routingOrIban)) {
    throw new functions.https.HttpsError('invalid-argument', 'Bank name and routing/IBAN are required for bank transfer.');
  }
  if (payoutMethod === 'venmo' && !payoutDetails.venmoHandle) {
    throw new functions.https.HttpsError('invalid-argument', 'Venmo handle is required.');
  }

  const nowIso = new Date().toISOString();
  const requestId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const creatorRewardsRef = db.collection('creator_rewards').doc(userId);
  const payoutRef = db.collection('payout_requests').doc(requestId);
  const ledgerTxnId = `txn_payout_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ledgerRef = db.collection('reward_ledger').doc(ledgerTxnId);

  // Pre-verify authoritative referral count from /referrals + /users
  const verifiedReferralsFromCollection = await getVerifiedSuccessfulReferralsCount(userId, 0);

  await db.runTransaction(async (t) => {
    const creatorSnap = await t.get(creatorRewardsRef);
    if (!creatorSnap.exists) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Payout eligibility requirements not met: You need at least $50.00 USD in available balance and at least 10 successful referrals.'
      );
    }

    const cData = creatorSnap.data();
    const recordedReferrals = Math.max(0, Number(cData.successfulReferralsCount) || 0);
    const successfulReferrals = Math.max(recordedReferrals, verifiedReferralsFromCollection);

    // Reconcile any verified referral rewards not yet merged into creator_rewards
    const existingReferralCents = Math.max(0, Number(cData.referralRewardsCents) || 0);
    const verifiedReferralCents = successfulReferrals * REFERRAL_REWARD_CENTS;
    const unaccountedReferralCents = Math.max(0, verifiedReferralCents - existingReferralCents);

    const currentAvailable = (Number(cData.availableBalanceCents) || 0) + unaccountedReferralCents;
    const currentTotalEarned = (Number(cData.totalEarnedCents) || 0) + unaccountedReferralCents;

    const meetsBalanceRequirement = currentAvailable >= MINIMUM_PAYOUT_CENTS;
    const meetsReferralsRequirement = successfulReferrals >= MINIMUM_PAYOUT_REFERRALS;

    if (!meetsBalanceRequirement && !meetsReferralsRequirement) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Payout eligibility requirements not met: You must have at least $50.00 USD in available balance (current: $${(currentAvailable / 100).toFixed(2)}) and at least ${MINIMUM_PAYOUT_REFERRALS} successful referrals (current: ${successfulReferrals}/${MINIMUM_PAYOUT_REFERRALS}).`
      );
    }

    if (!meetsBalanceRequirement) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Minimum available reward balance of $50.00 USD is required to request a payout (current available balance: $${(currentAvailable / 100).toFixed(2)} USD).`
      );
    }

    if (!meetsReferralsRequirement) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Minimum of ${MINIMUM_PAYOUT_REFERRALS} successful referrals is required to request a payout (you currently have ${successfulReferrals} of ${MINIMUM_PAYOUT_REFERRALS} successful referrals).`
      );
    }

    if (currentAvailable < requestedCents) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Insufficient available balance. Available: $${(currentAvailable / 100).toFixed(2)}, Requested: $${(requestedCents / 100).toFixed(2)}.`
      );
    }

    const newAvailable = currentAvailable - requestedCents;
    const newPending = (Number(cData.pendingPayoutCents) || 0) + requestedCents;

    // 1. Reserve balance on creator_rewards
    t.set(creatorRewardsRef, {
      availableBalanceCents: newAvailable,
      totalEarnedCents: currentTotalEarned,
      referralRewardsCents: Math.max(existingReferralCents, verifiedReferralCents),
      successfulReferralsCount: successfulReferrals,
      pendingPayoutCents: newPending,
      updatedAt: nowIso,
    }, { merge: true });

    // 2. Create payout request document
    t.set(payoutRef, {
      id: requestId,
      userId,
      amountCents: requestedCents,
      amountUsd: requestedCents / 100,
      currency: 'USD',
      payoutMethod,
      payoutDetails: {
        accountEmail: payoutDetails.accountEmail || null,
        accountHolderName: payoutDetails.accountHolderName || null,
        bankName: payoutDetails.bankName || null,
        routingOrIban: payoutDetails.routingOrIban || null,
        accountNumberLast4: payoutDetails.accountNumberLast4 || null,
        venmoHandle: payoutDetails.venmoHandle || null,
      },
      status: 'pending',
      requestedAt: nowIso,
      notes: typeof notes === 'string' ? notes.trim() : '',
      successfulReferralsCount: successfulReferrals,
    });

    // 3. Create reward ledger record
    t.set(ledgerRef, {
      id: ledgerTxnId,
      userId,
      type: 'payout',
      amountCents: -requestedCents,
      amountUsd: -(requestedCents / 100),
      currency: 'USD',
      payoutRequestId: requestId,
      description: `Payout request via ${payoutMethod.replace('_', ' ').toUpperCase()} ($${(requestedCents / 100).toFixed(2)})`,
      status: 'pending',
      eventId: `event_payout_${requestId}`,
      createdAt: nowIso,
    });
  });

  return { success: true, requestId };
});

/**
 * Fallback background trigger for payout requests.
 * If a payout request is created directly in Firestore, enforces BOTH payout eligibility requirements
 * ($50.00 USD available balance AND 10 successful referrals) and reserves balance server-side.
 */
exports.processPayoutRequestOnCreate = functions.firestore
  .document('payout_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data) return null;
    const requestId = context.params.requestId;

    // Check if already processed and recorded in ledger
    const existingLedger = await db.collection('reward_ledger')
      .where('payoutRequestId', '==', requestId)
      .limit(1)
      .get();
    if (!existingLedger.empty) return null;

    const userId = data.userId;
    const amountCents = Number(data.amountCents) || 0;
    if (amountCents < MINIMUM_PAYOUT_CENTS || !userId) {
      return snap.ref.update({
        status: 'rejected',
        rejectionReason: 'Below minimum payout threshold ($50.00 USD) or invalid user ID'
      });
    }

    const creatorRef = db.collection('creator_rewards').doc(userId);
    const nowIso = new Date().toISOString();
    const verifiedReferralsFromCollection = await getVerifiedSuccessfulReferralsCount(userId, 0);

    try {
      await db.runTransaction(async (t) => {
        const cSnap = await t.get(creatorRef);
        if (!cSnap.exists) {
          t.update(snap.ref, {
            status: 'rejected',
            rejectionReason: 'No creator reward account found'
          });
          return;
        }
        const cData = cSnap.data();
        const recordedReferrals = Math.max(0, Number(cData.successfulReferralsCount) || 0);
        const successfulReferrals = Math.max(recordedReferrals, verifiedReferralsFromCollection);

        const existingReferralCents = Math.max(0, Number(cData.referralRewardsCents) || 0);
        const verifiedReferralCents = successfulReferrals * REFERRAL_REWARD_CENTS;
        const unaccountedReferralCents = Math.max(0, verifiedReferralCents - existingReferralCents);

        const available = (Number(cData.availableBalanceCents) || 0) + unaccountedReferralCents;
        const totalEarned = (Number(cData.totalEarnedCents) || 0) + unaccountedReferralCents;

        const meetsBalance = available >= MINIMUM_PAYOUT_CENTS;
        const meetsReferrals = successfulReferrals >= MINIMUM_PAYOUT_REFERRALS;

        if (!meetsBalance && !meetsReferrals) {
          t.update(snap.ref, {
            status: 'rejected',
            rejectionReason: `Payout eligibility not met: Requires at least $50.00 USD available balance (current: $${(available / 100).toFixed(2)}) and at least ${MINIMUM_PAYOUT_REFERRALS} successful referrals (current: ${successfulReferrals}/${MINIMUM_PAYOUT_REFERRALS}).`
          });
          return;
        }

        if (!meetsBalance) {
          t.update(snap.ref, {
            status: 'rejected',
            rejectionReason: `Minimum available reward balance of $50.00 USD is required (current: $${(available / 100).toFixed(2)} USD).`
          });
          return;
        }

        if (!meetsReferrals) {
          t.update(snap.ref, {
            status: 'rejected',
            rejectionReason: `Minimum of ${MINIMUM_PAYOUT_REFERRALS} successful referrals is required (current: ${successfulReferrals}/${MINIMUM_PAYOUT_REFERRALS}).`
          });
          return;
        }

        if (available < amountCents) {
          t.update(snap.ref, {
            status: 'rejected',
            rejectionReason: 'Insufficient available balance'
          });
          return;
        }

        t.set(creatorRef, {
          availableBalanceCents: available - amountCents,
          totalEarnedCents: totalEarned,
          referralRewardsCents: Math.max(existingReferralCents, verifiedReferralCents),
          successfulReferralsCount: successfulReferrals,
          pendingPayoutCents: (Number(cData.pendingPayoutCents) || 0) + amountCents,
          updatedAt: nowIso,
        }, { merge: true });

        const txnId = `txn_payout_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        t.set(db.collection('reward_ledger').doc(txnId), {
          id: txnId,
          userId,
          type: 'payout',
          amountCents: -amountCents,
          amountUsd: -(amountCents / 100),
          currency: 'USD',
          payoutRequestId: requestId,
          description: `Payout request via ${(data.payoutMethod || 'transfer').toUpperCase()} ($${(amountCents / 100).toFixed(2)})`,
          status: 'pending',
          eventId: `event_payout_${requestId}`,
          createdAt: nowIso,
        });
      });
    } catch (err) {
      console.error('[processPayoutRequestOnCreate Error]:', err);
    }

    return null;
  });

// ==========================================
// 3. SOGOSOCIAL ADMIN & CONTROL PANEL FUNCTIONS
// ==========================================

const AUTHORIZED_ADMIN_EMAIL = 'azlanmalik774@gmail.com';

/**
 * Helper to strictly verify the caller is the authorized administrator
 */
function verifyAdminContext(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const callerEmail = (context.auth.token.email || '').toLowerCase().trim();
  const isAdminClaim = Boolean(
    context.auth.token.admin === true || context.auth.token.role === 'admin'
  );

  if (callerEmail !== AUTHORIZED_ADMIN_EMAIL || !isAdminClaim) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Unauthorized: Only the designated SogoSocial administrator (azlanmalik774@gmail.com) with verified admin claim can perform this operation.'
    );
  }
  return { adminUid: context.auth.uid, adminEmail: callerEmail };
}

/**
 * Cloud Function: syncAdminClaim
 * Strictly assigns custom claim `admin: true` ONLY to azlanmalik774@gmail.com.
 * Rejects any other email.
 */
exports.syncAdminClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const callerEmail = (context.auth.token.email || '').toLowerCase().trim();
  const callerUid = context.auth.uid;

  if (callerEmail !== AUTHORIZED_ADMIN_EMAIL) {
    // If not the authorized email, ensure any stray admin claim is stripped
    if (context.auth.token.admin) {
      await admin.auth().setCustomUserClaims(callerUid, { admin: false });
    }
    throw new functions.https.HttpsError(
      'permission-denied',
      'Unauthorized: Admin privileges are exclusively reserved for azlanmalik774@gmail.com.'
    );
  }

  // Set custom user claim { admin: true } using Firebase Admin SDK
  await admin.auth().setCustomUserClaims(callerUid, { admin: true });

  // Record in auditable admin logs
  const nowIso = new Date().toISOString();
  await db.collection('adminAuditLogs').add({
    adminUid: callerUid,
    adminEmail: callerEmail,
    action: 'GRANT_ADMIN_CLAIM',
    targetType: 'user',
    targetId: callerUid,
    reason: 'Authorized administrator role initialization',
    timestamp: nowIso,
  });

  return {
    success: true,
    admin: true,
    email: callerEmail,
    message: 'Admin claim granted. Please refresh user token.',
  };
});

/**
 * Cloud Function: adminPerformUserAction
 * Server-authoritative user moderation (suspend, unsuspend, disable, restore, verify, unverify).
 */
exports.adminPerformUserAction = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetUserId, action, reason } = data || {};

  if (!targetUserId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUserId and action are required.');
  }

  const nowIso = new Date().toISOString();
  const userDocRef = db.collection('users').doc(targetUserId);
  const userSnap = await userDocRef.get();

  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', `User ${targetUserId} not found.`);
  }

  const beforeData = userSnap.data();
  let updateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  if (action === 'suspend') {
    updateData.isSuspended = true;
    updateData.suspensionReason = reason || 'Suspended by administrator';
    updateData.suspendedAt = nowIso;
  } else if (action === 'unsuspend') {
    updateData.isSuspended = false;
    updateData.suspensionReason = null;
    updateData.unsuspendedAt = nowIso;
  } else if (action === 'disable') {
    updateData.isDisabled = true;
    updateData.disabledReason = reason || 'Disabled by administrator';
    updateData.disabledAt = nowIso;
    try {
      await admin.auth().updateUser(targetUserId, { disabled: true });
    } catch (e) {
      console.warn('Firebase Auth disable note:', e);
    }
  } else if (action === 'restore') {
    updateData.isDisabled = false;
    updateData.isSuspended = false;
    updateData.restoredAt = nowIso;
    try {
      await admin.auth().updateUser(targetUserId, { disabled: false });
    } catch (e) {
      console.warn('Firebase Auth restore note:', e);
    }
  } else if (action === 'verify') {
    updateData.isVerified = true;
    updateData.verifiedAt = nowIso;
    updateData.verifiedBy = adminUid;
  } else if (action === 'unverify') {
    updateData.isVerified = false;
    updateData.verifiedAt = null;
    updateData.verifiedBy = null;
  } else {
    throw new functions.https.HttpsError('invalid-argument', `Invalid action: ${action}`);
  }

  await userDocRef.update(updateData);

  // If verification changed, also sync denormalized user.isVerified on authored posts & videos
  if (action === 'verify' || action === 'unverify') {
    const verifiedBool = action === 'verify';
    try {
      const [postsSnap, videosSnap] = await Promise.all([
        db.collection('posts').where('userId', '==', targetUserId).limit(100).get(),
        db.collection('videos').where('userId', '==', targetUserId).limit(100).get(),
      ]);
      const batch = db.batch();
      postsSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && d.user && typeof d.user === 'object') {
          batch.update(docSnap.ref, { 'user.isVerified': verifiedBool });
        }
      });
      videosSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d && d.user && typeof d.user === 'object') {
          batch.update(docSnap.ref, { 'user.isVerified': verifiedBool });
        }
      });
      await batch.commit();
    } catch (syncErr) {
      console.warn('Denormalized verification sync note:', syncErr);
    }
  }

  // Write to auditable admin log
  await db.collection('adminAuditLogs').add({
    adminUid,
    adminEmail,
    action: `USER_${action.toUpperCase()}`,
    targetType: 'user',
    targetId: targetUserId,
    targetUsername: beforeData.username || 'unknown',
    reason: reason || 'Administrative action',
    timestamp: nowIso,
    before: {
      isSuspended: beforeData.isSuspended || false,
      isDisabled: beforeData.isDisabled || false,
      isVerified: Boolean(beforeData.isVerified),
    },
    after: {
      isSuspended: updateData.isSuspended ?? beforeData.isSuspended ?? false,
      isDisabled: updateData.isDisabled ?? beforeData.isDisabled ?? false,
      isVerified: updateData.isVerified ?? Boolean(beforeData.isVerified),
    },
  });

  return { success: true, action, targetUserId, isVerified: updateData.isVerified ?? Boolean(beforeData.isVerified) };
});

/**
 * Cloud Function: adminSetUserVerification
 * Server-authoritative Blue Tick / Verified status assignment and revocation.
 */
exports.adminSetUserVerification = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetUserId, isVerified, reason } = data || {};

  if (!targetUserId || typeof isVerified !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'targetUserId and boolean isVerified are required.');
  }

  const nowIso = new Date().toISOString();
  const userDocRef = db.collection('users').doc(targetUserId);
  const userSnap = await userDocRef.get();

  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', `User ${targetUserId} not found.`);
  }

  const beforeData = userSnap.data() || {};
  const previousVerified = Boolean(beforeData.isVerified);

  await userDocRef.set(
    {
      isVerified: Boolean(isVerified),
      verifiedAt: isVerified ? nowIso : null,
      verifiedBy: isVerified ? adminUid : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Sync denormalized user.isVerified on authored posts & videos
  try {
    const [postsSnap, videosSnap] = await Promise.all([
      db.collection('posts').where('userId', '==', targetUserId).limit(100).get(),
      db.collection('videos').where('userId', '==', targetUserId).limit(100).get(),
    ]);
    const batch = db.batch();
    postsSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d && d.user && typeof d.user === 'object') {
        batch.update(docSnap.ref, { 'user.isVerified': Boolean(isVerified) });
      }
    });
    videosSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d && d.user && typeof d.user === 'object') {
        batch.update(docSnap.ref, { 'user.isVerified': Boolean(isVerified) });
      }
    });
    await batch.commit();
  } catch (syncErr) {
    console.warn('Denormalized verification sync note:', syncErr);
  }

  await db.collection('adminAuditLogs').add({
    adminUid,
    adminEmail,
    action: isVerified ? 'USER_VERIFY' : 'USER_UNVERIFY',
    targetType: 'user',
    targetId: targetUserId,
    targetUsername: beforeData.username || 'unknown',
    reason: reason || (isVerified ? 'Granted Blue Tick verification' : 'Removed Blue Tick verification'),
    timestamp: nowIso,
    before: { isVerified: previousVerified },
    after: { isVerified: Boolean(isVerified) },
  });

  return {
    success: true,
    targetUserId,
    username: beforeData.username || undefined,
    isVerified: Boolean(isVerified),
  };
});

/**
 * Cloud Function: adminPerformPayoutAction
 * Server-authoritative payout processing (approve, reject, mark_paid, cancel).
 */
exports.adminPerformPayoutAction = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { payoutId, action, notes, reason } = data || {};

  if (!payoutId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'payoutId and action are required.');
  }

  const validActions = ['approve', 'reject', 'mark_paid', 'cancel'];
  if (!validActions.includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', `Action must be one of: ${validActions.join(', ')}`);
  }

  const payoutRef = db.collection('payout_requests').doc(payoutId);
  const payoutSnap = await payoutRef.get();
  if (!payoutSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Payout request not found.');
  }

  const payoutData = payoutSnap.data();
  const userId = payoutData.userId;
  const amountCents = Number(payoutData.amountCents) || 0;
  const nowIso = new Date().toISOString();

  let newStatus = 'pending';
  if (action === 'approve') newStatus = 'approved';
  else if (action === 'reject') newStatus = 'rejected';
  else if (action === 'mark_paid') newStatus = 'paid';
  else if (action === 'cancel') newStatus = 'cancelled';

  await db.runTransaction(async (t) => {
    // 1. Update payout request status
    t.update(payoutRef, {
      status: newStatus,
      processedAt: nowIso,
      adminNotes: notes || null,
      rejectionReason: action === 'reject' ? (reason || 'Payout rejected by administrator') : null,
      updatedAt: nowIso,
    });

    // 2. Adjust creator rewards summary balances if needed
    const creatorRewardsRef = db.collection('creator_rewards').doc(userId);
    const creatorSnap = await t.get(creatorRewardsRef);

    if (creatorSnap.exists) {
      const cData = creatorSnap.data();
      const currentPendingPayout = Number(cData.pendingPayoutCents) || 0;
      const currentWithdrawn = Number(cData.withdrawnAmountCents) || 0;
      const currentAvailable = Number(cData.availableBalanceCents) || 0;

      let newPendingPayout = currentPendingPayout;
      let newWithdrawn = currentWithdrawn;
      let newAvailable = currentAvailable;

      if (action === 'mark_paid') {
        // Amount moves from pending payout to withdrawn
        newPendingPayout = Math.max(0, currentPendingPayout - amountCents);
        newWithdrawn = currentWithdrawn + amountCents;
      } else if (action === 'reject' || action === 'cancel') {
        // Return funds back to available balance
        newPendingPayout = Math.max(0, currentPendingPayout - amountCents);
        newAvailable = currentAvailable + amountCents;
      }

      t.set(creatorRewardsRef, {
        pendingPayoutCents: newPendingPayout,
        withdrawnAmountCents: newWithdrawn,
        availableBalanceCents: newAvailable,
        updatedAt: nowIso,
      }, { merge: true });
    }

    // 3. Create ledger record for auditable trace
    const ledgerTxnId = `txn_payout_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    t.set(db.collection('reward_ledger').doc(ledgerTxnId), {
      id: ledgerTxnId,
      userId,
      type: 'payout',
      amountCents: action === 'reject' || action === 'cancel' ? amountCents : -amountCents,
      amountUsd: (action === 'reject' || action === 'cancel' ? amountCents : -amountCents) / 100,
      currency: 'USD',
      payoutRequestId: payoutId,
      description: `Payout ${newStatus.toUpperCase()}: $${(amountCents / 100).toFixed(2)} (${notes || reason || 'Admin processed'})`,
      status: newStatus === 'paid' ? 'completed' : newStatus,
      createdAt: nowIso,
    });

    // 4. Record in admin audit log
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    t.set(db.collection('adminAuditLogs').doc(auditId), {
      adminUid,
      adminEmail,
      action: `PAYOUT_${newStatus.toUpperCase()}`,
      targetType: 'payout',
      targetId: payoutId,
      affectedUserId: userId,
      amountCents,
      amountUsd: amountCents / 100,
      notes: notes || reason || '',
      timestamp: nowIso,
      previousStatus: payoutData.status,
      newStatus,
    });
  });

  return { success: true, payoutId, status: newStatus };
});

/**
 * Cloud Function: adminAdjustCreatorReward
 * Auditable balance adjustments with admin UID, reason, and target user.
 */
exports.adminAdjustCreatorReward = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetUserId, adjustmentCents, reason } = data || {};

  if (!targetUserId || typeof adjustmentCents !== 'number' || !reason) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'targetUserId, adjustmentCents (number), and reason are required.'
    );
  }

  const nowIso = new Date().toISOString();
  const creatorRewardsRef = db.collection('creator_rewards').doc(targetUserId);

  await db.runTransaction(async (t) => {
    const creatorSnap = await t.get(creatorRewardsRef);
    const currentData = creatorSnap.exists ? creatorSnap.data() : {
      userId: targetUserId,
      availableBalanceCents: 0,
      totalEarnedCents: 0,
    };

    const newAvailable = Math.max(0, (currentData.availableBalanceCents || 0) + adjustmentCents);
    const newTotal = Math.max(0, (currentData.totalEarnedCents || 0) + (adjustmentCents > 0 ? adjustmentCents : 0));

    t.set(creatorRewardsRef, {
      userId: targetUserId,
      availableBalanceCents: newAvailable,
      totalEarnedCents: newTotal,
      updatedAt: nowIso,
    }, { merge: true });

    // Ledger record
    const ledgerTxnId = `txn_adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    t.set(db.collection('reward_ledger').doc(ledgerTxnId), {
      id: ledgerTxnId,
      userId: targetUserId,
      type: 'bonus',
      amountCents: adjustmentCents,
      amountUsd: adjustmentCents / 100,
      currency: 'USD',
      description: `Admin manual adjustment: ${reason} ($${(adjustmentCents / 100).toFixed(2)})`,
      status: 'completed',
      adminUid,
      createdAt: nowIso,
    });

    // Audit log
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    t.set(db.collection('adminAuditLogs').doc(auditId), {
      adminUid,
      adminEmail,
      action: 'CREATOR_REWARD_ADJUSTMENT',
      targetType: 'creator_reward',
      targetId: targetUserId,
      affectedUserId: targetUserId,
      adjustmentCents,
      adjustmentUsd: adjustmentCents / 100,
      reason,
      timestamp: nowIso,
      previousBalanceCents: currentData.availableBalanceCents || 0,
      newBalanceCents: newAvailable,
    });
  });

  return { success: true, targetUserId, adjustmentCents };
});

/**
 * Cloud Function: adminDeleteVideo
 * Deletes video document and audits the action.
 */
exports.adminDeleteVideo = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { videoId, reason } = data || {};

  if (!videoId) {
    throw new functions.https.HttpsError('invalid-argument', 'videoId is required.');
  }

  const videoRef = db.collection('videos').doc(videoId);
  const videoSnap = await videoRef.get();
  if (!videoSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Video not found.');
  }

  const videoData = videoSnap.data();
  const nowIso = new Date().toISOString();

  // Delete the video document
  await videoRef.delete();

  // Audit log
  await db.collection('adminAuditLogs').add({
    adminUid,
    adminEmail,
    action: 'DELETE_VIDEO',
    targetType: 'video',
    targetId: videoId,
    targetCreatorId: videoData.userId || '',
    caption: videoData.caption || '',
    videoUrl: videoData.videoUrl || '',
    reason: reason || 'Administrative moderation',
    timestamp: nowIso,
  });

  return { success: true, videoId };
});

/**
 * Cloud Function: adminDeletePost
 * Deletes post document and audits the action.
 */
exports.adminDeletePost = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { postId, reason } = data || {};

  if (!postId) {
    throw new functions.https.HttpsError('invalid-argument', 'postId is required.');
  }

  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Post not found.');
  }

  const postData = postSnap.data();
  const nowIso = new Date().toISOString();

  await postRef.delete();

  await db.collection('adminAuditLogs').add({
    adminUid,
    adminEmail,
    action: 'DELETE_POST',
    targetType: 'post',
    targetId: postId,
    targetCreatorId: postData.userId || '',
    caption: postData.caption || '',
    reason: reason || 'Administrative moderation',
    timestamp: nowIso,
  });

  return { success: true, postId };
});

/**
 * Cloud Function: adminResolveReport
 * Resolves or dismisses moderation reports.
 */
exports.adminResolveReport = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { reportId, status, notes } = data || {};

  if (!reportId || !['resolved', 'dismissed', 'reviewing'].includes(status)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid reportId and status required.');
  }

  const nowIso = new Date().toISOString();
  const reportRef = db.collection('reports').doc(reportId);
  const reportSnap = await reportRef.get();

  if (!reportSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Report not found.');
  }

  await reportRef.update({
    status,
    reviewedBy: adminUid,
    reviewerEmail: adminEmail,
    resolutionNotes: notes || '',
    resolvedAt: nowIso,
    updatedAt: nowIso,
  });

  await db.collection('adminAuditLogs').add({
    adminUid,
    adminEmail,
    action: `REPORT_${status.toUpperCase()}`,
    targetType: 'report',
    targetId: reportId,
    notes: notes || '',
    timestamp: nowIso,
  });

  return { success: true, reportId, status };
});

// =========================================================================
// ADMIN-ONLY TESTING & STAGING TOOLS (azlanmalik774@gmail.com)
// =========================================================================

const SYNTHETIC_TEST_USERS = [
  { displayName: 'Elena Rostova', username: 'elena_r', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150' },
  { displayName: 'Marcus Brody', username: 'marcus_b', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150' },
  { displayName: 'Liam Vance', username: 'liam_vance', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150' },
  { displayName: 'Chloe Bennett', username: 'chloebennett', avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150' },
  { displayName: 'Julian Hayes', username: 'julian_h', avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150' },
  { displayName: 'Sienna Brooks', username: 'sienna_b', avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150' },
  { displayName: 'Adrian Cole', username: 'adrian_c', avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150' },
  { displayName: 'Natasha Kim', username: 'natasha_kim', avatarUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150' },
];

const REALISTIC_SAMPLE_COMMENTS = [
  'Incredible composition and lighting here!',
  'Love the mood and aesthetic on this one.',
  'Super clean execution, keep it up!',
  'The details on this are unmatched.',
  'Really inspiring content, appreciate you sharing this.',
  'Such high quality visual flow!',
  'The sound design paired with the motion is so smooth.',
  'Top tier work, definitely saving this for reference!',
];

/**
 * Cloud Function: adminAddTestViews
 * Adds distinguishable test views to a video.
 * Does not fire fake watch sessions in video_watch_sessions so organic anti-cheat is preserved.
 */
exports.adminAddTestViews = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { videoId, count = 100, idempotencyKey } = data || {};

  if (!videoId) {
    throw new functions.https.HttpsError('invalid-argument', 'videoId is required.');
  }

  const viewIncrement = Math.max(1, Math.min(500000, Number(count) || 100));

  // Idempotency check
  if (idempotencyKey) {
    const existingAudit = await db.collection('adminAuditLogs')
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existingAudit.empty) {
      return { success: true, alreadyProcessed: true, videoId, count: viewIncrement };
    }
  }

  const videoRef = db.collection('videos').doc(videoId);
  const videoSnap = await videoRef.get();
  if (!videoSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Video not found.');
  }

  const nowIso = new Date().toISOString();
  await videoRef.update({
    viewsCount: admin.firestore.FieldValue.increment(viewIncrement),
    testViewsCount: admin.firestore.FieldValue.increment(viewIncrement),
    hasAdminTestData: true,
    lastAdminTestAt: nowIso,
  });

  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.collection('adminAuditLogs').doc(auditId).set({
    id: auditId,
    adminUid,
    adminEmail,
    action: 'ADD_TEST_VIEWS',
    targetType: 'video',
    targetId: videoId,
    count: viewIncrement,
    idempotencyKey: idempotencyKey || null,
    timestamp: nowIso,
    notes: `Added ${viewIncrement} test views (distinguishable via testViewsCount).`,
  });

  return { success: true, videoId, addedViews: viewIncrement };
});

/**
 * Cloud Function: adminAddTestFollowers
 * Adds distinguishable test followers to a user without creating fake Firebase Auth accounts.
 */
exports.adminAddTestFollowers = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetUserId, count = 10, idempotencyKey } = data || {};

  if (!targetUserId) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUserId is required.');
  }

  const followerIncrement = Math.max(1, Math.min(50000, Number(count) || 10));

  if (idempotencyKey) {
    const existingAudit = await db.collection('adminAuditLogs')
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existingAudit.empty) {
      return { success: true, alreadyProcessed: true, targetUserId, count: followerIncrement };
    }
  }

  const userRef = db.collection('users').doc(targetUserId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }

  const nowIso = new Date().toISOString();
  await userRef.update({
    followersCount: admin.firestore.FieldValue.increment(followerIncrement),
    testFollowersCount: admin.firestore.FieldValue.increment(followerIncrement),
    hasAdminTestData: true,
    lastAdminTestAt: nowIso,
  });

  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.collection('adminAuditLogs').doc(auditId).set({
    id: auditId,
    adminUid,
    adminEmail,
    action: 'ADD_TEST_FOLLOWERS',
    targetType: 'user',
    targetId: targetUserId,
    count: followerIncrement,
    idempotencyKey: idempotencyKey || null,
    timestamp: nowIso,
    notes: `Added ${followerIncrement} test followers without creating fake Auth accounts.`,
  });

  return { success: true, targetUserId, addedFollowers: followerIncrement };
});

/**
 * Cloud Function: adminAddTestLikes
 * Adds distinguishable test likes to a post or video.
 */
exports.adminAddTestLikes = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetType, targetId, count = 10, idempotencyKey } = data || {};

  if (!targetId || !targetType || !['video', 'post'].includes(targetType)) {
    throw new functions.https.HttpsError('invalid-argument', 'targetType ("video" or "post") and targetId are required.');
  }

  const likeIncrement = Math.max(1, Math.min(50000, Number(count) || 10));

  if (idempotencyKey) {
    const existingAudit = await db.collection('adminAuditLogs')
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existingAudit.empty) {
      return { success: true, alreadyProcessed: true, targetType, targetId, count: likeIncrement };
    }
  }

  const colName = targetType === 'video' ? 'videos' : 'posts';
  const targetRef = db.collection(colName).doc(targetId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError('not-found', `${targetType} not found.`);
  }

  const nowIso = new Date().toISOString();
  await targetRef.update({
    likesCount: admin.firestore.FieldValue.increment(likeIncrement),
    testLikesCount: admin.firestore.FieldValue.increment(likeIncrement),
    hasAdminTestData: true,
    lastAdminTestAt: nowIso,
  });

  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.collection('adminAuditLogs').doc(auditId).set({
    id: auditId,
    adminUid,
    adminEmail,
    action: 'ADD_TEST_LIKES',
    targetType,
    targetId,
    count: likeIncrement,
    idempotencyKey: idempotencyKey || null,
    timestamp: nowIso,
    notes: `Added ${likeIncrement} test likes (distinguishable via testLikesCount).`,
  });

  return { success: true, targetType, targetId, addedLikes: likeIncrement };
});

/**
 * Cloud Function: adminAddTestComment
 * Adds realistic synthetic comment to a post or video without user notification spam.
 */
exports.adminAddTestComment = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetType, targetId, text, idempotencyKey } = data || {};

  if (!targetId || !targetType || !['video', 'post'].includes(targetType)) {
    throw new functions.https.HttpsError('invalid-argument', 'targetType ("video" or "post") and targetId are required.');
  }

  if (idempotencyKey) {
    const existingAudit = await db.collection('adminAuditLogs')
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existingAudit.empty) {
      return { success: true, alreadyProcessed: true, targetType, targetId };
    }
  }

  const colName = targetType === 'video' ? 'videos' : 'posts';
  const targetRef = db.collection(colName).doc(targetId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError('not-found', `${targetType} not found.`);
  }

  const randomUser = SYNTHETIC_TEST_USERS[Math.floor(Math.random() * SYNTHETIC_TEST_USERS.length)];
  const commentText = (text && text.trim()) || REALISTIC_SAMPLE_COMMENTS[Math.floor(Math.random() * REALISTIC_SAMPLE_COMMENTS.length)];
  const commentId = `test_com_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();

  const commentData = {
    id: commentId,
    [targetType === 'video' ? 'videoId' : 'postId']: targetId,
    userId: `synth_${randomUser.username}`,
    user: {
      id: `synth_${randomUser.username}`,
      username: randomUser.username,
      displayName: randomUser.displayName,
      avatarUrl: randomUser.avatarUrl,
    },
    text: commentText,
    isAdminTestData: true,
    isSyntheticTest: true,
    createdAt: nowIso,
  };

  // Add comment to subcollection
  await targetRef.collection('comments').doc(commentId).set(commentData);

  // Update parent commentsCount and testCommentsCount
  await targetRef.update({
    commentsCount: admin.firestore.FieldValue.increment(1),
    testCommentsCount: admin.firestore.FieldValue.increment(1),
    hasAdminTestData: true,
    lastAdminTestAt: nowIso,
  });

  // CRITICAL: We deliberately skip dispatching user notifications to prevent spamming creators.

  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.collection('adminAuditLogs').doc(auditId).set({
    id: auditId,
    adminUid,
    adminEmail,
    action: 'ADD_TEST_COMMENT',
    targetType,
    targetId,
    commentId,
    commentText,
    author: randomUser.displayName,
    idempotencyKey: idempotencyKey || null,
    timestamp: nowIso,
    notes: `Added synthetic test comment by ${randomUser.displayName} without notification spam.`,
  });

  return { success: true, targetType, targetId, comment: commentData };
});

/**
 * Cloud Function: adminGrantTestReward
 * Grants test rewards to a creator with transactionType: "admin_test_reward" and full audit trace.
 */
exports.adminGrantTestReward = functions.https.onCall(async (data, context) => {
  console.info('[adminGrantTestReward] 1. Function entry. Received payload:', JSON.stringify(data || {}));

  let adminUid, adminEmail;
  try {
    const verified = verifyAdminContext(context);
    adminUid = verified.adminUid;
    adminEmail = verified.adminEmail;
    console.info('[adminGrantTestReward] 2. Admin auth verified:', { adminUid, adminEmail });
  } catch (authErr) {
    console.error('[adminGrantTestReward] Admin authentication verification failed:', authErr);
    throw authErr;
  }

  const { targetUserId, amountCents, reason, idempotencyKey } = data || {};
  const rewardCents = Math.round(Number(amountCents) || 0);

  if (!targetUserId || rewardCents <= 0) {
    console.warn('[adminGrantTestReward] Invalid arguments provided:', { targetUserId, amountCents, rewardCents });
    throw new functions.https.HttpsError(
      'invalid-argument',
      'targetUserId and positive amountCents (integer) are required.'
    );
  }

  // Target user lookup
  console.info('[adminGrantTestReward] 3. Target user lookup starting for UID:', targetUserId);
  let targetUserSnap;
  try {
    targetUserSnap = await db.collection('users').doc(targetUserId).get();
  } catch (userLookupErr) {
    console.error('[adminGrantTestReward] Error during target user lookup:', userLookupErr);
    throw new functions.https.HttpsError('internal', `User lookup failed: ${userLookupErr.message}`);
  }

  if (!targetUserSnap.exists) {
    console.warn('[adminGrantTestReward] Target user not found:', targetUserId);
    throw new functions.https.HttpsError('not-found', 'Target user does not exist.');
  }
  console.info('[adminGrantTestReward] Target user verified exists:', targetUserId);

  const nowIso = new Date().toISOString();
  const creatorRewardsRef = db.collection('creator_rewards').doc(targetUserId);
  const ledgerTxnId = idempotencyKey || `txn_testrew_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ledgerRef = db.collection('reward_ledger').doc(ledgerTxnId);

  let alreadyProcessed = false;
  let previousBalance = 0;
  let newBalance = 0;

  try {
    console.info('[adminGrantTestReward] 4. Starting transaction. Checking idempotency & creator rewards doc...');
    await db.runTransaction(async (t) => {
      // Idempotency check: if this ledger entry already exists, do not process again
      console.info('[adminGrantTestReward] 5. Idempotency check on ledgerRef:', ledgerTxnId);
      const existingLedger = await t.get(ledgerRef);
      if (existingLedger.exists) {
        console.warn('[adminGrantTestReward] Idempotent hit: ledger entry already exists:', ledgerTxnId);
        alreadyProcessed = true;
        return;
      }

      // Reward document lookup inside transaction
      console.info('[adminGrantTestReward] 6. Reward document lookup for creator:', targetUserId);
      const creatorSnap = await t.get(creatorRewardsRef);
      const currentData = creatorSnap.exists ? creatorSnap.data() : {
        userId: targetUserId,
        availableBalanceCents: 0,
        totalEarnedCents: 0,
      };

      previousBalance = currentData.availableBalanceCents || 0;
      newBalance = Math.max(0, previousBalance + rewardCents);
      const newTotal = Math.max(0, (currentData.totalEarnedCents || 0) + rewardCents);
      const newTestRewardTotal = (currentData.testRewardsGrantedCents || 0) + rewardCents;

      console.info('[adminGrantTestReward] 7. Updating creator_rewards document...', {
        previousBalance,
        newBalance,
        newTotal,
        newTestRewardTotal,
      });

      t.set(creatorRewardsRef, {
        userId: targetUserId,
        availableBalanceCents: newBalance,
        totalEarnedCents: newTotal,
        testRewardsGrantedCents: newTestRewardTotal,
        hasAdminTestData: true,
        updatedAt: nowIso,
      }, { merge: true });

      // Ledger record strictly marked with transactionType: "admin_test_reward"
      console.info('[adminGrantTestReward] 8. Creating reward_ledger entry:', ledgerTxnId);
      t.set(ledgerRef, {
        id: ledgerTxnId,
        userId: targetUserId,
        type: 'admin_test_reward',
        transactionType: 'admin_test_reward',
        amountCents: rewardCents,
        amountUsd: rewardCents / 100,
        currency: 'USD',
        description: reason || `Admin staging test reward ($${(rewardCents / 100).toFixed(2)})`,
        status: 'completed',
        isAdminTestData: true,
        adminUid,
        adminEmail,
        eventId: ledgerTxnId,
        operationId: ledgerTxnId,
        createdAt: nowIso,
      });
    });

    console.info('[adminGrantTestReward] 9. Transaction completed successfully.', { alreadyProcessed });
  } catch (txnErr) {
    console.error('[adminGrantTestReward] Transaction failed with error:', {
      code: txnErr.code,
      message: txnErr.message,
      stack: txnErr.stack,
    });
    throw new functions.https.HttpsError('internal', `Transaction failed: ${txnErr.message}`);
  }

  // 10. Audit log write outside transaction for reliability and minimal locking
  if (!alreadyProcessed) {
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      console.info('[adminGrantTestReward] 10. Writing adminAuditLogs entry:', auditId);
      await db.collection('adminAuditLogs').doc(auditId).set({
        id: auditId,
        adminUid,
        adminEmail,
        action: 'GRANT_TEST_REWARD',
        targetType: 'creator_reward',
        targetId: targetUserId,
        affectedUserId: targetUserId,
        amountCents: rewardCents,
        amountUsd: rewardCents / 100,
        reason: reason || 'Admin staging test reward',
        idempotencyKey: idempotencyKey || null,
        timestamp: nowIso,
        previousBalanceCents: previousBalance,
        newBalanceCents: newBalance,
      });
      console.info('[adminGrantTestReward] adminAuditLogs entry written successfully:', auditId);
    } catch (auditErr) {
      console.error('[adminGrantTestReward] Warning: audit log write failed:', {
        code: auditErr.code,
        message: auditErr.message,
        stack: auditErr.stack,
      });
      // Non-fatal: balance transaction already committed
    }
  }

  return { success: true, alreadyProcessed, targetUserId, amountCents: rewardCents };
});

// Aliases for admin testing functions
exports.admin_test_reward = exports.adminGrantTestReward;
exports.add_test_views = exports.adminAddTestViews;
exports.add_test_followers = exports.adminAddTestFollowers;
exports.add_test_likes = exports.adminAddTestLikes;
exports.add_test_comments = exports.adminAddTestComment;

/**
 * Cloud Function: adminAddTestVideoMetrics
 * Atomically increments testViewsCount, testQualifiedViewsCount, and recalculates
 * cumulative testVideoRewardsCents on creator_rewards/{targetUserId} inside a server transaction.
 * Treats totalTestViews and qualifiedTestViews as ADDITIONS (deltas) on top of existing server values.
 */
exports.adminAddTestVideoMetrics = functions.https.onCall(async (data, context) => {
  const { adminUid, adminEmail } = verifyAdminContext(context);
  const { targetUserId, totalTestViews, qualifiedTestViews, reason, operationId: customOpId } = data || {};

  if (!targetUserId) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUserId is required.');
  }

  const deltaTotalViews = Math.round(Number(totalTestViews) || 0);
  const deltaQualifiedViews = Math.round(Number(qualifiedTestViews) || 0);

  if (deltaQualifiedViews > 0 && deltaTotalViews > 0 && deltaQualifiedViews > deltaTotalViews) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Qualified test views adjustment (${deltaQualifiedViews}) cannot exceed total test views adjustment (${deltaTotalViews}).`
    );
  }

  const operationId = customOpId || `admin_test_reward_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const creatorRef = db.collection('creator_rewards').doc(targetUserId);
  const ledgerRef = db.collection('reward_ledger').doc(operationId);
  const auditRef = db.collection('adminAuditLogs').doc();
  const nowIso = new Date().toISOString();

  let alreadyProcessed = false;
  let previousCombinedQualifiedViews = 0;
  let newCombinedQualifiedViews = 0;
  let newTestViews = 0;
  let newTestQualifiedViews = 0;
  let newTestVideoRewardsCents = 0;
  let addedRewardCents = 0;

  await db.runTransaction(async (t) => {
    const ledgerSnap = await t.get(ledgerRef);
    if (ledgerSnap.exists) {
      alreadyProcessed = true;
      return;
    }

    const creatorSnap = await t.get(creatorRef);
    const cur = creatorSnap.exists ? (creatorSnap.data() || {}) : {};

    const prevOrganicViews = Math.max(0, Number(cur.totalViewsCount) || 0);
    const prevOrganicQualifiedViews = Math.max(0, Number(cur.qualifiedViewsCount) || 0);
    const prevTestViews = Math.max(0, Number(cur.testViewsCount) || 0);
    const prevTestQualifiedViews = Math.max(0, Number(cur.testQualifiedViewsCount) || 0);
    const prevTestVideoRewardsCents = Math.max(0, Number(cur.testVideoRewardsCents) || 0);

    const effectiveAddedTotalViews =
      deltaTotalViews > 0 ? Math.max(deltaTotalViews, deltaQualifiedViews) : deltaTotalViews;

    newTestQualifiedViews = Math.max(0, prevTestQualifiedViews + deltaQualifiedViews);
    newTestViews = Math.max(
      newTestQualifiedViews,
      Math.max(0, prevTestViews + effectiveAddedTotalViews)
    );
    newTestVideoRewardsCents = Math.floor((newTestQualifiedViews * 50) / 1000);
    addedRewardCents = Math.max(0, newTestVideoRewardsCents - prevTestVideoRewardsCents);

    previousCombinedQualifiedViews = prevOrganicQualifiedViews + prevTestQualifiedViews;
    newCombinedQualifiedViews = prevOrganicQualifiedViews + newTestQualifiedViews;
    const previousCombinedTotalViews = prevOrganicViews + prevTestViews;
    const newCombinedTotalViews = prevOrganicViews + newTestViews;

    if (!creatorSnap.exists) {
      t.set(creatorRef, {
        userId: targetUserId,
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
        testViewsCount: newTestViews,
        testQualifiedViewsCount: newTestQualifiedViews,
        testVideoRewardsCents: newTestVideoRewardsCents,
        hasAdminTestData: true,
        updatedAt: nowIso,
      });
    } else {
      t.update(creatorRef, {
        testViewsCount: newTestViews,
        testQualifiedViewsCount: newTestQualifiedViews,
        testVideoRewardsCents: newTestVideoRewardsCents,
        hasAdminTestData: true,
        updatedAt: nowIso,
      });
    }

    t.set(ledgerRef, {
      id: operationId,
      operationId,
      eventId: operationId,
      userId: targetUserId,
      type: 'admin_test_reward',
      transactionType: 'admin_test_reward',
      isAdminTestData: true,
      amountCents: addedRewardCents,
      amountUsd: Number((addedRewardCents / 100).toFixed(2)),
      currency: 'USD',
      adminUid,
      adminEmail,
      status: 'completed',
      addedTotalViews: effectiveAddedTotalViews,
      addedQualifiedViews: deltaQualifiedViews,
      previousQualifiedViews: previousCombinedQualifiedViews,
      newQualifiedViews: newCombinedQualifiedViews,
      testViewsCount: newTestViews,
      testQualifiedViewsCount: newTestQualifiedViews,
      qualifiedViews: newCombinedQualifiedViews,
      description: `Admin qualified views adjustment: ${deltaQualifiedViews >= 0 ? '+' : ''}${deltaQualifiedViews.toLocaleString()} qualified views (${previousCombinedQualifiedViews.toLocaleString()} → ${newCombinedQualifiedViews.toLocaleString()})`,
      reason: reason || 'Admin test video metrics staging calculation',
      createdAt: nowIso,
    });

    t.set(auditRef, {
      id: auditRef.id,
      adminUid,
      adminEmail,
      action: 'ADD_TEST_VIDEO_METRICS',
      targetType: 'creator_reward',
      targetId: targetUserId,
      affectedUserId: targetUserId,
      addedTotalViews: effectiveAddedTotalViews,
      addedQualifiedViews: deltaQualifiedViews,
      adjustmentAmount: deltaQualifiedViews,
      previousTotalViews: previousCombinedTotalViews,
      newTotalViews: newCombinedTotalViews,
      previousQualifiedViews: previousCombinedQualifiedViews,
      newQualifiedViews: newCombinedQualifiedViews,
      previousTestQualifiedViews: prevTestQualifiedViews,
      newTestQualifiedViews,
      previousTestVideoRewardsCents: prevTestVideoRewardsCents,
      newTestVideoRewardsCents,
      totalTestViews: newTestViews,
      qualifiedTestViews: newTestQualifiedViews,
      testVideoRewardsCents: newTestVideoRewardsCents,
      amountCents: addedRewardCents,
      amountUsd: Number((addedRewardCents / 100).toFixed(2)),
      operationId,
      idempotencyKey: operationId,
      reason: reason || 'Admin test video metrics staging calculation',
      timestamp: nowIso,
      notes:
        reason ||
        `Admin adjusted qualified views by ${deltaQualifiedViews >= 0 ? '+' : ''}${deltaQualifiedViews.toLocaleString()} (${previousCombinedQualifiedViews.toLocaleString()} → ${newCombinedQualifiedViews.toLocaleString()}) for user ${targetUserId}.`,
    });
  });

  return {
    success: true,
    alreadyProcessed,
    targetUserId,
    addedQualifiedViews: deltaQualifiedViews,
    previousQualifiedViews: previousCombinedQualifiedViews,
    newQualifiedViews: newCombinedQualifiedViews,
    totalTestViews: newTestViews,
    qualifiedTestViews: newTestQualifiedViews,
    testVideoRewardsCents: newTestVideoRewardsCents,
    operationId,
  };
});

exports.add_test_video_metrics = exports.adminAddTestVideoMetrics;

// ==========================================
// SOGO STARS SERVER-SIDE DAILY CAP ENFORCEMENT
// ==========================================

const SOGO_STAR_DAILY_MAX = 500;
const SOGO_STAR_DAILY_MAX_CENTS = 50; // $0.50 USD (1,000 Stars = $1.00)
const SOGO_STAR_MISSION_DEFINITIONS = {
  post_reels: { title: 'Post 3 new Reels', targetCount: 3, rewardStars: 200, rewardCents: 20 },
  like_reels: { title: 'Like 3 Reels', targetCount: 3, rewardStars: 50, rewardCents: 5 },
  comment_reels: { title: 'Comment on 3 Reels', targetCount: 3, rewardStars: 50, rewardCents: 5 },
  watch_reels: { title: 'Watch 10 qualifying Reels', targetCount: 10, rewardStars: 50, rewardCents: 5 },
  follow_creators: { title: 'Follow 3 creators', targetCount: 3, rewardStars: 50, rewardCents: 5 },
  create_posts: { title: 'Create 3 new Posts', targetCount: 3, rewardStars: 50, rewardCents: 5 },
  comment_posts: { title: 'Comment on 3 Posts', targetCount: 3, rewardStars: 50, rewardCents: 5 },
};

/**
 * Firestore document write trigger on sogo_stars_daily/{dailyId}
 * Enforces the hard 500 Stars ($0.50 USD) daily server cap.
 */
exports.enforceSogoStarsDailyCap = functions.firestore
  .document('sogo_stars_daily/{dailyId}')
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const data = change.after.data() || {};
    const starsEarnedToday = Number(data.starsEarnedToday) || 0;
    const centsEarnedToday = Number(data.centsEarnedToday) || 0;

    if (starsEarnedToday > SOGO_STAR_DAILY_MAX || centsEarnedToday > SOGO_STAR_DAILY_MAX_CENTS) {
      const clampedStars = Math.min(SOGO_STAR_DAILY_MAX, Math.max(0, starsEarnedToday));
      const clampedCents = Math.min(SOGO_STAR_DAILY_MAX_CENTS, Math.floor(clampedStars / 10));
      await change.after.ref.update({
        starsEarnedToday: clampedStars,
        centsEarnedToday: clampedCents,
        maxDailyStars: SOGO_STAR_DAILY_MAX,
      });
    }
    return null;
  });

/**
 * Cloud Function: deleteUserAccount
 * Securely deletes user account and personal data from Firebase Auth and Firestore.
 */
exports.deleteUserAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerUid = context.auth.uid;
  const targetUid = data?.uid || callerUid;

  // Normal users can only delete their own account; admin can delete any
  const isCallerAdmin =
    context.auth.token?.admin === true ||
    context.auth.token?.email === 'azlanmalik774@gmail.com';
  if (callerUid !== targetUid && !isCallerAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot delete another user account.');
  }

  // 1. Delete user-owned posts in chunks
  const postsSnap = await db.collection('posts').where('userId', '==', targetUid).get();
  if (!postsSnap.empty) {
    const batch = db.batch();
    postsSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. Delete user-owned videos in chunks
  const videosSnap = await db.collection('videos').where('userId', '==', targetUid).get();
  if (!videosSnap.empty) {
    const batch = db.batch();
    videosSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 3. Delete user subcollections: following, followers, blocked
  for (const sub of ['following', 'followers', 'blocked']) {
    const subSnap = await db.collection('users').doc(targetUid).collection(sub).get();
    if (!subSnap.empty) {
      const batch = db.batch();
      subSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  // 4. Delete notifications & daily stars
  const notifsSnap = await db.collection('notifications').where('userId', '==', targetUid).get();
  if (!notifsSnap.empty) {
    const batch = db.batch();
    notifsSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 5. Delete user profile document
  await db.collection('users').doc(targetUid).delete();

  // 6. Delete user from Firebase Auth
  try {
    await admin.auth().deleteUser(targetUid);
  } catch (authErr) {
    console.warn('[deleteUserAccount] Auth delete note:', authErr);
  }

  return { success: true, deletedUid: targetUid };
});



