import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getIdTokenResult } from 'firebase/auth';
import { getApps } from 'firebase/app';
import { db, auth, functions, app } from '../lib/firebase';
import {
  AdminOverviewStats,
  AdminUserRecord,
  AdminVideoRecord,
  AdminPostRecord,
  AdminCreatorSummaryItem,
  AdminReferralItem,
  AdminReportItem,
  AdminAuditLog,
  DailyAnalyticsPoint,
  AdminSystemHealth,
  GrantTestRewardDiagnostic,
} from '../types/admin';
import { User, PayoutRequest, VideoPost, Post, CreatorRewardsSummary, ReferralRecord } from '../types';
import { applyLocalVerificationUpdate } from './usersService';
import * as rewardsService from './rewardsService';

export const AUTHORIZED_ADMIN_EMAIL = 'azlanmalik774@gmail.com';

export class AdminService {
  /**
   * Fast frontend authorization check.
   * NOTE: Must be paired with custom claim verification and Firestore Security Rules.
   */
  isAuthorizedAdminEmail(email?: string | null): boolean {
    if (!email) return false;
    return email.toLowerCase().trim() === AUTHORIZED_ADMIN_EMAIL;
  }

  /**
   * Verifies the administrator's Firebase Auth ID token and custom claims.
   * Forces a refresh via getIdToken(true) and getIdTokenResult(currentUser, true)
   * to guarantee the latest server-issued custom claims are verified.
   */
  async verifyAdminClaims(forceRefresh: boolean = true): Promise<{
    isAdmin: boolean;
    isAdminClaim: boolean;
    isEmailAuthorized: boolean;
    isValidAdmin: boolean;
    email?: string | null;
    uid?: string | null;
    claims: Record<string, any>;
  }> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return {
        isAdmin: false,
        isAdminClaim: false,
        isEmailAuthorized: false,
        isValidAdmin: false,
        claims: {},
      };
    }

    try {
      // Check token claims; when forceRefresh is false on initial startup, inspect cached token first (0ms),
      // and only force a network refresh if the admin claim isn't already present on the cached token.
      if (forceRefresh) {
        await currentUser.getIdToken(true);
      }
      let tokenResult = await getIdTokenResult(currentUser, forceRefresh);
      const isEmailAuthorized = this.isAuthorizedAdminEmail(currentUser.email);
      let isAdminClaim = Boolean(
        tokenResult.claims &&
          (tokenResult.claims.admin === true || tokenResult.claims.role === 'admin')
      );

      if (!forceRefresh && isEmailAuthorized && !isAdminClaim) {
        await currentUser.getIdToken(true);
        tokenResult = await getIdTokenResult(currentUser, true);
        isAdminClaim = Boolean(
          tokenResult.claims &&
            (tokenResult.claims.admin === true || tokenResult.claims.role === 'admin')
        );
      }

      const isValidAdmin = isAdminClaim && isEmailAuthorized;

      return {
        isAdmin: isValidAdmin,
        isAdminClaim,
        isEmailAuthorized,
        isValidAdmin,
        email: currentUser.email,
        uid: currentUser.uid,
        claims: tokenResult.claims || {},
      };
    } catch (err) {
      console.error('[AdminService] Error checking admin claims:', err);
      return {
        isAdmin: false,
        isAdminClaim: false,
        isEmailAuthorized: this.isAuthorizedAdminEmail(currentUser.email),
        isValidAdmin: false,
        email: currentUser.email,
        uid: currentUser.uid,
        claims: {},
      };
    }
  }

  /**
   * Requests custom claim { admin: true } synchronization via Cloud Function.
   * Only azlanmalik774@gmail.com is permitted to trigger this.
   */
  async syncAdminClaim(): Promise<{ success: boolean; message: string }> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('You must be signed in to synchronize admin status.');
    }

    if (!this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error(`Unauthorized: Only ${AUTHORIZED_ADMIN_EMAIL} can request admin claims.`);
    }

    try {
      const syncFn = httpsCallable(functions, 'syncAdminClaim');
      const response: any = await syncFn({});
      
      // Force refresh the token so the custom claim immediately registers on the client
      await currentUser.getIdToken(true);
      await getIdTokenResult(currentUser, true);

      return {
        success: true,
        message: response.data?.message || 'Admin claim successfully synchronized with Firebase Auth.',
      };
    } catch (err: any) {
      console.warn('[AdminService] Cloud Function sync note:', err.message);
      
      // Even if Cloud Function call fails, refresh token in case claim was set via CLI script or console
      try {
        await currentUser.getIdToken(true);
        const tokenRes = await getIdTokenResult(currentUser, true);
        if (tokenRes.claims?.admin === true) {
          return {
            success: true,
            message: 'Admin claim verified successfully via refreshed token.',
          };
        }
      } catch (tokenErr) {
        console.warn('[AdminService] Token refresh check warning:', tokenErr);
      }

      return {
        success: false,
        message: err.message || 'Could not reach syncAdminClaim Cloud Function. Check CLI script instructions.',
      };
    }
  }

  /**
   * Records an immutable admin action in `adminAuditLogs`
   */
  async recordAuditLog(log: Omit<AdminAuditLog, 'id' | 'timestamp'>): Promise<void> {
    const currentUser = auth.currentUser;
    const adminUid = currentUser?.uid || log.adminUid || 'unknown_admin';
    const adminEmail = (currentUser?.email || log.adminEmail || AUTHORIZED_ADMIN_EMAIL)
      .toLowerCase()
      .trim();

    const logRef = doc(collection(db, 'adminAuditLogs'));
    const logData: AdminAuditLog = {
      ...log,
      id: logRef.id,
      adminUid,
      adminEmail,
      timestamp: new Date().toISOString(),
    };

    try {
      await setDoc(logRef, logData);
    } catch (e) {
      console.warn('[AdminService] Warning recording audit log:', e);
    }
  }

  // =========================================================================
  // 1. OVERVIEW & AGGREGATE PLATFORM STATS
  // =========================================================================

  async getOverviewStats(): Promise<AdminOverviewStats> {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      // Parallel reads
      const [
        usersSnap,
        videosSnap,
        postsSnap,
        creatorRewardsSnap,
        payoutsSnap,
        referralsRes,
      ] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'videos')),
        getDocs(collection(db, 'posts')),
        getDocs(collection(db, 'creator_rewards')),
        getDocs(collection(db, 'payout_requests')),
        getDocs(collection(db, 'referrals')).catch(() => null),
      ]);

      const totalUsers = usersSnap.size;
      let newUsersToday = 0;
      let activeUsers = 0;
      const usersMap: Record<string, Record<string, any>> = {};

      usersSnap.forEach((docSnap) => {
        const u = docSnap.data();
        usersMap[docSnap.id] = u;
        const createdMs = u.createdAt ? new Date(u.createdAt).getTime() : 0;
        if (createdMs >= todayStart) newUsersToday++;
        if (u.isOnboarded || (u.postsCount && u.postsCount > 0) || u.followersCount > 0) {
          activeUsers++;
        }
      });
      if (activeUsers === 0 && totalUsers > 0) activeUsers = totalUsers;

      let totalVideos = 0;
      let videosUploadedToday = 0;
      let totalVideoViews = 0;

      videosSnap.forEach((docSnap) => {
        const v = docSnap.data();
        if (v.isNotification || v.isStory || !v.videoUrl) return;
        totalVideos++;
        const createdMs = v.createdAt ? new Date(v.createdAt).getTime() : 0;
        if (createdMs >= todayStart) videosUploadedToday++;
        totalVideoViews += Number(v.viewsCount) || 0;
      });

      const totalPosts = postsSnap.size;

      const referralsByReferrer = this.groupVerifiedReferralsByReferrer(referralsRes, usersMap);

      let qualifiedRewardViews = 0;
      let totalCreatorRewardsCents = 0;
      let totalReferralRewardsCents = 0;
      let totalLiabilityCents = 0;

      creatorRewardsSnap.forEach((docSnap) => {
        const raw = docSnap.data() as CreatorRewardsSummary;
        const uId = raw.userId || docSnap.id;
        const normalized = rewardsService.normalizeCreatorRewardsSummary(
          { ...raw, userId: uId },
          referralsByReferrer[uId] || []
        );
        const metrics = rewardsService.getDisplayRewardsMetrics(normalized);
        qualifiedRewardViews += metrics.displayQualifiedViews;
        totalCreatorRewardsCents += metrics.displayTotalEarnedCents;
        totalReferralRewardsCents += Number(normalized.referralRewardsCents) || 0;
        totalLiabilityCents +=
          metrics.displayAvailableBalanceCents + (Number(normalized.pendingPayoutCents) || 0);
      });

      let pendingPayoutsCount = 0;
      let totalPayoutAmountPendingCents = 0;

      payoutsSnap.forEach((docSnap) => {
        const p = docSnap.data() as PayoutRequest;
        if (p.status === 'pending') {
          pendingPayoutsCount++;
          totalPayoutAmountPendingCents += Number(p.amountCents) || 0;
        }
      });

      return {
        totalUsers,
        newUsersToday,
        activeUsers,
        totalVideos,
        videosUploadedToday,
        totalPosts,
        totalVideoViews,
        qualifiedRewardViews,
        totalCreatorRewardsCents,
        totalReferralRewardsCents,
        pendingPayoutsCount,
        totalPayoutAmountPendingCents,
        totalRewardLiabilityCents: totalLiabilityCents,
      };
    } catch (err) {
      console.error('[AdminService] getOverviewStats error:', err);
      return {
        totalUsers: 0,
        newUsersToday: 0,
        activeUsers: 0,
        totalVideos: 0,
        videosUploadedToday: 0,
        totalPosts: 0,
        totalVideoViews: 0,
        qualifiedRewardViews: 0,
        totalCreatorRewardsCents: 0,
        totalReferralRewardsCents: 0,
        pendingPayoutsCount: 0,
        totalPayoutAmountPendingCents: 0,
        totalRewardLiabilityCents: 0,
      };
    }
  }

  // =========================================================================
  // 2. USERS MANAGEMENT
  // =========================================================================

  async getAllUsers(): Promise<AdminUserRecord[]> {
    const usersCol = collection(db, 'users');
    console.log('[AdminService] getAllUsers: Starting query on collection:', {
      path: usersCol.path,
      id: usersCol.id,
      timestamp: new Date().toISOString(),
    });

    let usersSnap;
    try {
      usersSnap = await getDocs(usersCol);
      console.log('[AdminService] getAllUsers: /users query succeeded:', {
        size: usersSnap.size,
        empty: usersSnap.empty,
        docsCount: usersSnap.docs.length,
      });
      usersSnap.docs.forEach((d, idx) => {
        const raw = d.data();
        console.log(`[AdminService] user doc [${idx}] ID: ${d.id}`, {
          username: raw.username,
          displayName: raw.displayName || raw.fullName,
          email: raw.email,
          createdAt: raw.createdAt,
        });
      });
    } catch (err: any) {
      console.error('[AdminService] getAllUsers: CRITICAL /users query failure:', {
        code: err?.code,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        fullError: err,
      });
      throw err;
    }

    // Auxiliary queries using Promise.allSettled so permission issues or query failures on secondary collections don't prevent real users from displaying
    const [videosRes, postsRes, rewardsRes, referralsRes] = await Promise.allSettled([
      getDocs(collection(db, 'videos')),
      getDocs(collection(db, 'posts')),
      getDocs(collection(db, 'creator_rewards')),
      getDocs(collection(db, 'referrals')),
    ]);

    console.log('[AdminService] getAllUsers: Auxiliary queries status:', {
      videosStatus: videosRes.status,
      postsStatus: postsRes.status,
      rewardsStatus: rewardsRes.status,
      referralsStatus: referralsRes.status,
    });

    const rawUsersMap: Record<string, Record<string, any>> = {};
    usersSnap.forEach((d) => {
      rawUsersMap[d.id] = d.data() || {};
    });

    const referralsByReferrer = this.groupVerifiedReferralsByReferrer(
      referralsRes.status === 'fulfilled' ? referralsRes.value : null,
      rawUsersMap
    );

    const videoCounts: Record<string, number> = {};
    if (videosRes.status === 'fulfilled') {
      videosRes.value.forEach((d) => {
        const data = d.data();
        if (data?.isNotification || data?.isStory || !data?.videoUrl) return;
        const uId = data?.userId;
        if (uId) videoCounts[uId] = (videoCounts[uId] || 0) + 1;
      });
    }

    const postCounts: Record<string, number> = {};
    if (postsRes.status === 'fulfilled') {
      postsRes.value.forEach((d) => {
        const uId = d.data()?.userId;
        if (uId) postCounts[uId] = (postCounts[uId] || 0) + 1;
      });
    }

    const rewardsMap: Record<string, { available: number; total: number }> = {};
    if (rewardsRes.status === 'fulfilled') {
      rewardsRes.value.forEach((d) => {
        const data = (d.data() || {}) as CreatorRewardsSummary;
        const uId = data.userId || d.id;
        const normalized = rewardsService.normalizeCreatorRewardsSummary(
          { ...data, userId: uId },
          referralsByReferrer[uId] || []
        );
        const metrics = rewardsService.getDisplayRewardsMetrics(normalized);
        rewardsMap[uId] = {
          available: metrics.displayAvailableBalanceCents,
          total: metrics.displayTotalEarnedCents,
        };
      });
    }

    const results: AdminUserRecord[] = [];
    usersSnap.forEach((docSnap) => {
      const data = (docSnap.data() || {}) as Record<string, any>;
      const uid = docSnap.id;

      // Parse createdAt safely handling Firestore Timestamp, string ISO, or number
      let createdAtIso = new Date().toISOString();
      if (data.createdAt) {
        if (typeof data.createdAt === 'string') {
          createdAtIso = data.createdAt;
        } else if (typeof data.createdAt?.toDate === 'function') {
          createdAtIso = data.createdAt.toDate().toISOString();
        } else if (typeof data.createdAt?.toMillis === 'function') {
          createdAtIso = new Date(data.createdAt.toMillis()).toISOString();
        } else if (typeof data.createdAt?.seconds === 'number') {
          createdAtIso = new Date(data.createdAt.seconds * 1000).toISOString();
        } else if (typeof data.createdAt === 'number') {
          createdAtIso = new Date(data.createdAt).toISOString();
        }
      }

      const userRecord: AdminUserRecord = {
        ...data,
        id: uid,
        username: data.username || 'user',
        displayName: data.displayName || data.fullName || 'SogoSocial User',
        email: data.email || '',
        avatarUrl: data.avatarUrl || data.photoURL || '',
        bio: data.bio || '',
        website: data.website || '',
        followersCount: Number(data.followersCount) || 0,
        followingCount: Number(data.followingCount) || 0,
        postsCount: Number(data.postsCount) || 0,
        birthday: data.birthday || '',
        isOnboarded: data.isOnboarded !== false,
        isFollowing: false,
        following: Array.isArray(data.following) ? data.following : [],
        isVerified: Boolean(data.isVerified),
        verifiedAt: data.verifiedAt || null,
        verifiedBy: data.verifiedBy || null,
        createdAt: createdAtIso,
        uploadedVideosCount: videoCounts[uid] || 0,
        uploadedPostsCount: postCounts[uid] || 0,
        availableBalanceCents: rewardsMap[uid]?.available || 0,
        totalEarnedCents: rewardsMap[uid]?.total || 0,
        isSuspended: Boolean(data.isSuspended),
        isDisabled: Boolean(data.isDisabled),
        suspensionReason: data.suspensionReason || undefined,
      };

      results.push(userRecord);
    });

    console.log(`[AdminService] getAllUsers: Successfully mapped ${results.length} AdminUserRecord objects.`);

    return results.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });
  }

  async performUserModeration(
    targetUserId: string,
    action: 'suspend' | 'unsuspend' | 'disable' | 'restore' | 'verify' | 'unverify',
    reason: string
  ): Promise<void> {
    if (action === 'verify' || action === 'unverify') {
      await this.setUserVerification(targetUserId, action === 'verify', reason);
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized administrative action.');
    }

    const claims = await this.verifyAdminClaims(false);
    if (!claims.isAdminClaim || !claims.isValidAdmin) {
      throw new Error('Unauthorized: Active admin custom claim (admin: true) is required.');
    }

    try {
      const callFn = httpsCallable(functions, 'adminPerformUserAction');
      await callFn({ targetUserId, action, reason });
    } catch (cloudErr) {
      console.warn('[AdminService] Cloud function fallback for user action:', cloudErr);
      const userRef = doc(db, 'users', targetUserId);
      const nowIso = new Date().toISOString();

      if (action === 'suspend') {
        await updateDoc(userRef, {
          isSuspended: true,
          suspensionReason: reason,
          suspendedAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      } else if (action === 'unsuspend') {
        await updateDoc(userRef, {
          isSuspended: false,
          suspensionReason: null,
          unsuspendedAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      } else if (action === 'disable') {
        await updateDoc(userRef, {
          isDisabled: true,
          disabledReason: reason,
          disabledAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      } else if (action === 'restore') {
        await updateDoc(userRef, {
          isDisabled: false,
          isSuspended: false,
          restoredAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      }

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: `USER_${action.toUpperCase()}`,
        targetType: 'user',
        targetId: targetUserId,
        reason,
      });
    }
  }

  /**
   * Grants or revokes Blue Tick (Verified badge) status for a user.
   * Requires verified admin authentication & custom claim.
   */
  async setUserVerification(
    targetUserId: string,
    isVerified: boolean,
    reason?: string
  ): Promise<{ success: boolean; isVerified: boolean }> {
    if (!targetUserId) {
      throw new Error('Target user ID is required.');
    }

    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized: Only the designated SogoSocial administrator can modify verification status.');
    }

    const claims = await this.verifyAdminClaims(false);
    if (!claims.isAdminClaim || !claims.isValidAdmin) {
      throw new Error('Unauthorized: Verified admin custom claim (admin: true) is required.');
    }

    const verifiedBool = Boolean(isVerified);
    const nowIso = new Date().toISOString();
    const auditReason =
      reason?.trim() ||
      (verifiedBool ? 'Granted Blue Tick verification' : 'Removed Blue Tick verification');

    let targetUsername: string | undefined;

    try {
      const callFn = httpsCallable(functions, 'adminSetUserVerification');
      const res: any = await callFn({
        targetUserId,
        isVerified: verifiedBool,
        reason: auditReason,
      });
      if (res?.data?.username) {
        targetUsername = res.data.username;
      }
    } catch (cloudErr) {
      console.warn('[AdminService] Cloud function fallback for setUserVerification:', cloudErr);
      const userRef = doc(db, 'users', targetUserId);
      const existingSnap = await getDoc(userRef);
      const beforeData = existingSnap.exists() ? existingSnap.data() : {};
      targetUsername = beforeData?.username;

      const updatePayload = {
        isVerified: verifiedBool,
        verifiedAt: verifiedBool ? nowIso : null,
        verifiedBy: verifiedBool ? currentUser.uid : null,
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(userRef, updatePayload, { merge: true });
      } catch (writeErr: any) {
        if (writeErr?.code === 'permission-denied') {
          await currentUser.getIdToken(true);
          await setDoc(userRef, updatePayload, { merge: true });
        } else {
          throw writeErr;
        }
      }

      // Best-effort sync of denormalized user.isVerified on authored posts & videos
      Promise.allSettled([
        getDocs(query(collection(db, 'posts'), where('userId', '==', targetUserId), limit(100))),
        getDocs(query(collection(db, 'videos'), where('userId', '==', targetUserId), limit(100))),
      ])
        .then(([postsRes, videosRes]) => {
          const updates: Promise<unknown>[] = [];
          if (postsRes.status === 'fulfilled') {
            postsRes.value.forEach((docSnap) => {
              const d = docSnap.data();
              if (d && d.user && typeof d.user === 'object') {
                updates.push(
                  updateDoc(docSnap.ref, { 'user.isVerified': verifiedBool }).catch(() => {})
                );
              }
            });
          }
          if (videosRes.status === 'fulfilled') {
            videosRes.value.forEach((docSnap) => {
              const d = docSnap.data();
              if (d && d.user && typeof d.user === 'object') {
                updates.push(
                  updateDoc(docSnap.ref, { 'user.isVerified': verifiedBool }).catch(() => {})
                );
              }
            });
          }
          return Promise.allSettled(updates);
        })
        .catch(() => {});

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: verifiedBool ? 'USER_VERIFY' : 'USER_UNVERIFY',
        targetType: 'user',
        targetId: targetUserId,
        targetUsername: targetUsername || 'user',
        reason: auditReason,
        before: { isVerified: Boolean(beforeData?.isVerified) },
        after: { isVerified: verifiedBool },
      });
    }

    // Immediately synchronize authoritative verification map and local caches across the app
    applyLocalVerificationUpdate(targetUserId, verifiedBool, targetUsername);

    return {
      success: true,
      isVerified: verifiedBool,
    };
  }

  // =========================================================================
  // 3. VIDEOS MANAGEMENT
  // =========================================================================

  async getAllVideos(): Promise<AdminVideoRecord[]> {
    const videosSnap = await getDocs(collection(db, 'videos'));
    const videos: AdminVideoRecord[] = [];

    videosSnap.forEach((docSnap) => {
      const raw = docSnap.data();
      if (raw.isNotification || raw.isStory || !raw.videoUrl) return;
      const data = raw as VideoPost;
      const viewsCount = Number(data.viewsCount) || 0;
      const duration = Number(data.duration) || 0;

      // Automated suspicious heuristic check: zero duration or abnormal high views
      const isSuspicious = duration <= 0 || (viewsCount > 1000 && !data.commentsCount && !data.likesCount);
      const suspiciousReason = duration <= 0
        ? 'Missing or zero second duration'
        : isSuspicious
        ? 'High view count with zero engagement'
        : undefined;

      videos.push({
        ...data,
        id: docSnap.id,
        isSuspicious,
        suspiciousReason,
        estimatedRewardCents: Math.floor((viewsCount / 1000) * 50),
      });
    });

    return videos.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  async deleteVideo(videoId: string, reason: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized.');
    }

    try {
      const callFn = httpsCallable(functions, 'adminDeleteVideo');
      await callFn({ videoId, reason });
    } catch (cloudErr) {
      console.warn('[AdminService] Direct deletion fallback for video:', cloudErr);
      const videoRef = doc(db, 'videos', videoId);
      const snap = await getDoc(videoRef);
      const vData = snap.data();

      await deleteDoc(videoRef);

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'DELETE_VIDEO',
        targetType: 'video',
        targetId: videoId,
        caption: vData?.caption || '',
        reason,
      });
    }
  }

  // =========================================================================
  // 4. POSTS MANAGEMENT
  // =========================================================================

  async getAllPosts(): Promise<AdminPostRecord[]> {
    const postsSnap = await getDocs(collection(db, 'posts'));
    const posts: AdminPostRecord[] = [];

    postsSnap.forEach((docSnap) => {
      const data = docSnap.data() as Post;
      posts.push({
        ...data,
        id: docSnap.id,
      });
    });

    return posts.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  async deletePost(postId: string, reason: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized.');
    }

    try {
      const callFn = httpsCallable(functions, 'adminDeletePost');
      await callFn({ postId, reason });
    } catch (cloudErr) {
      console.warn('[AdminService] Direct deletion fallback for post:', cloudErr);
      const postRef = doc(db, 'posts', postId);
      const snap = await getDoc(postRef);
      const pData = snap.data();

      await deleteDoc(postRef);

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'DELETE_POST',
        targetType: 'post',
        targetId: postId,
        caption: pData?.caption || '',
        reason,
      });
    }
  }

  // =========================================================================
  // 5. CREATOR REWARDS & ADJUSTMENTS
  // =========================================================================

  /**
   * Helper: Groups and verifies referral records by referrerId using the in-memory usersMap,
   * matching the exact verification logic of rewardsService.getUserReferrals.
   */
  private groupVerifiedReferralsByReferrer(
    referralsSnap: any,
    usersMap: Record<string, Record<string, any>>
  ): Record<string, ReferralRecord[]> {
    const grouped: Record<string, ReferralRecord[]> = {};
    if (!referralsSnap || typeof referralsSnap.forEach !== 'function') {
      return grouped;
    }

    referralsSnap.forEach((docSnap: any) => {
      const data = docSnap.data() || {};
      const id = docSnap.id;
      const referredUserId = data.referredUserId || id;
      const referrerId = data.referrerId || '';
      if (!referrerId) return;

      let status: ReferralRecord['status'] = data.status || 'pending';
      let rewardGranted = Boolean(data.rewardGranted);
      let referredUsername = data.referredUsername || 'creator';
      let referredDisplayName = data.referredDisplayName || 'New Creator';
      let referredAvatarUrl = data.referredAvatarUrl;
      let qualifiedAt = data.qualifiedAt;

      if (status !== 'rejected' && referredUserId && referrerId !== referredUserId) {
        const uData = usersMap[referredUserId];
        if (uData) {
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
              (uData.username && (uData.displayName || uData.fullName) && uData.birthday)
          );
          if (isOnboarded) {
            status = 'qualified';
            rewardGranted = true;
            qualifiedAt = qualifiedAt || data.createdAt || new Date().toISOString();
          }
        }
      }

      if (!grouped[referrerId]) {
        grouped[referrerId] = [];
      }

      grouped[referrerId].push({
        id,
        referralCode: data.referralCode || '',
        referrerId,
        referredUserId,
        referredUsername,
        referredDisplayName,
        referredAvatarUrl,
        status,
        rewardAmountCents: Number(data.rewardAmountCents) || rewardsService.REFERRAL_REWARD_CENTS,
        rewardGranted,
        createdAt: data.createdAt || new Date().toISOString(),
        qualifiedAt,
        reason: data.reason,
      });
    });

    return grouped;
  }

  async getAllCreatorRewards(): Promise<AdminCreatorSummaryItem[]> {
    const [rewardsSnap, usersSnap, referralsSnap, videosSnap] = await Promise.all([
      getDocs(collection(db, 'creator_rewards')),
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'referrals')).catch(() => null),
      getDocs(collection(db, 'videos')).catch(() => null),
    ]);

    const usersMap: Record<string, User> = {};
    usersSnap.forEach((d) => {
      usersMap[d.id] = { ...(d.data() as User), id: d.id };
    });

    const organicViewsByCreator: Record<string, number> = {};
    if (videosSnap && typeof videosSnap.forEach === 'function') {
      videosSnap.forEach((d) => {
        const v = d.data();
        if (!v || v.isNotification || v.isStory || !v.videoUrl) return;
        const uId = v.userId;
        if (uId) {
          organicViewsByCreator[uId] = (organicViewsByCreator[uId] || 0) + (Number(v.viewsCount) || 0);
        }
      });
    }

    const referralsByReferrer = this.groupVerifiedReferralsByReferrer(referralsSnap, usersMap);

    const itemsMap = new Map<string, AdminCreatorSummaryItem>();

    rewardsSnap.forEach((docSnap) => {
      const r = docSnap.data() as CreatorRewardsSummary;
      const uId = r.userId || docSnap.id;
      const normalized = rewardsService.normalizeCreatorRewardsSummary(
        {
          ...rewardsService.getInitialRewardsSummary(uId),
          ...r,
          userId: uId,
        },
        referralsByReferrer[uId] || [],
        organicViewsByCreator[uId] || 0
      );

      itemsMap.set(uId, {
        ...normalized,
        userId: uId,
        user: usersMap[uId],
      });
    });

    // Include any creators who have verified referral rewards even if their creator_rewards doc hasn't been initialized yet
    for (const [referrerId, refList] of Object.entries(referralsByReferrer)) {
      if (!itemsMap.has(referrerId) && usersMap[referrerId]) {
        const normalized = rewardsService.normalizeCreatorRewardsSummary(
          rewardsService.getInitialRewardsSummary(referrerId),
          refList,
          organicViewsByCreator[referrerId] || 0
        );
        if ((normalized.availableBalanceCents || 0) > 0 || (normalized.totalEarnedCents || 0) > 0) {
          itemsMap.set(referrerId, {
            ...normalized,
            userId: referrerId,
            user: usersMap[referrerId],
          });
        }
      }
    }

    const items = Array.from(itemsMap.values());
    return items.sort(
      (a, b) =>
        (b.availableBalanceCents || b.totalEarnedCents || 0) -
        (a.availableBalanceCents || a.totalEarnedCents || 0)
    );
  }

  async adjustCreatorReward(
    targetUserId: string,
    adjustmentCents: number,
    reason: string
  ): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized administrative adjustment.');
    }

    try {
      const callFn = httpsCallable(functions, 'adminAdjustCreatorReward');
      await callFn({ targetUserId, adjustmentCents, reason });
    } catch (cloudErr) {
      console.warn('[AdminService] Direct adjustment fallback:', cloudErr);
      const creatorRef = doc(db, 'creator_rewards', targetUserId);
      const nowIso = new Date().toISOString();

      await runTransaction(db, async (t) => {
        const snap = await t.get(creatorRef);
        const curData = snap.exists()
          ? snap.data()
          : { userId: targetUserId, availableBalanceCents: 0, totalEarnedCents: 0 };

        const curAvailable = Number(curData.availableBalanceCents) || 0;
        const curTotal = Number(curData.totalEarnedCents) || 0;
        const curTestVideoRewards = Number(curData.testVideoRewardsCents) || 0;

        let newAvailable = curAvailable;
        let newTestVideoRewards = curTestVideoRewards;

        if (adjustmentCents >= 0) {
          newAvailable = curAvailable + adjustmentCents;
        } else if (curAvailable + adjustmentCents >= 0) {
          newAvailable = curAvailable + adjustmentCents;
        } else {
          const remainderDebit = curAvailable + adjustmentCents; // negative
          newAvailable = 0;
          newTestVideoRewards = Math.max(0, curTestVideoRewards + remainderDebit);
        }

        const newTotal = Math.max(0, curTotal + (adjustmentCents > 0 ? adjustmentCents : 0));

        const updatePayload: Record<string, any> = {
          userId: targetUserId,
          availableBalanceCents: newAvailable,
          totalEarnedCents: newTotal,
          updatedAt: nowIso,
        };
        if (newTestVideoRewards !== curTestVideoRewards) {
          updatePayload.testVideoRewardsCents = newTestVideoRewards;
        }

        t.set(creatorRef, updatePayload, { merge: true });

        // Ledger record
        const txnId = `txn_adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        t.set(doc(db, 'reward_ledger', txnId), {
          id: txnId,
          userId: targetUserId,
          type: 'bonus',
          amountCents: adjustmentCents,
          amountUsd: adjustmentCents / 100,
          currency: 'USD',
          description: `Admin manual adjustment: ${reason} ($${(adjustmentCents / 100).toFixed(2)})`,
          status: 'completed',
          adminUid: currentUser.uid,
          createdAt: nowIso,
        });
      });

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'CREATOR_REWARD_ADJUSTMENT',
        targetType: 'creator_reward',
        targetId: targetUserId,
        affectedUserId: targetUserId,
        amountCents: adjustmentCents,
        amountUsd: adjustmentCents / 100,
        reason,
      });
    }
  }

  // =========================================================================
  // 6. REFERRALS MANAGEMENT
  // =========================================================================

  async getAllReferrals(): Promise<AdminReferralItem[]> {
    const referralsSnap = await getDocs(collection(db, 'referrals'));
    const usersSnap = await getDocs(collection(db, 'users'));

    const usersMap: Record<string, User> = {};
    usersSnap.forEach((d) => {
      usersMap[d.id] = { ...(d.data() as User), id: d.id };
    });

    const items: AdminReferralItem[] = [];
    referralsSnap.forEach((docSnap) => {
      const r = docSnap.data() as ReferralRecord;
      items.push({
        ...r,
        id: docSnap.id,
        referrerUser: usersMap[r.referrerId],
        referredUserObj: usersMap[r.referredUserId],
      });
    });

    return items.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  // =========================================================================
  // 7. PAYOUTS MANAGEMENT
  // =========================================================================

  async getAllPayouts(): Promise<(PayoutRequest & { user?: User })[]> {
    const payoutsSnap = await getDocs(collection(db, 'payout_requests'));
    const usersSnap = await getDocs(collection(db, 'users'));

    const usersMap: Record<string, User> = {};
    usersSnap.forEach((d) => {
      usersMap[d.id] = { ...(d.data() as User), id: d.id };
    });

    const items: (PayoutRequest & { user?: User })[] = [];
    payoutsSnap.forEach((docSnap) => {
      const p = docSnap.data() as PayoutRequest;
      items.push({
        ...p,
        id: docSnap.id,
        user: usersMap[p.userId],
      });
    });

    return items.sort((a, b) => {
      const dateA = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
      const dateB = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  async processPayout(
    payoutId: string,
    action: 'approve' | 'reject' | 'mark_paid' | 'cancel',
    notes?: string,
    reason?: string
  ): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized administrative payout processing.');
    }

    try {
      const callFn = httpsCallable(functions, 'adminPerformPayoutAction');
      await callFn({ payoutId, action, notes, reason });
    } catch (cloudErr) {
      console.warn('[AdminService] Direct payout transaction fallback:', cloudErr);
      const payoutRef = doc(db, 'payout_requests', payoutId);
      const nowIso = new Date().toISOString();

      let newStatus: PayoutRequest['status'] = 'pending';
      if (action === 'approve') newStatus = 'approved';
      else if (action === 'reject') newStatus = 'rejected';
      else if (action === 'mark_paid') newStatus = 'paid';
      else if (action === 'cancel') newStatus = 'cancelled';

      await runTransaction(db, async (t) => {
        const pSnap = await t.get(payoutRef);
        if (!pSnap.exists()) throw new Error('Payout request not found.');
        const pData = pSnap.data() as PayoutRequest;
        const amountCents = Number(pData.amountCents) || 0;
        const userId = pData.userId;

        t.update(payoutRef, {
          status: newStatus,
          processedAt: nowIso,
          notes: notes || null,
          rejectionReason: action === 'reject' ? (reason || 'Rejected by administrator') : null,
        });

        // Update creator summary balances
        const creatorRef = doc(db, 'creator_rewards', userId);
        const cSnap = await t.get(creatorRef);
        if (cSnap.exists()) {
          const cData = cSnap.data();
          const curPending = Number(cData.pendingPayoutCents) || 0;
          const curWithdrawn = Number(cData.withdrawnAmountCents) || 0;
          const curAvailable = Number(cData.availableBalanceCents) || 0;

          let newPending = curPending;
          let newWithdrawn = curWithdrawn;
          let newAvailable = curAvailable;

          if (action === 'mark_paid') {
            newPending = Math.max(0, curPending - amountCents);
            newWithdrawn = curWithdrawn + amountCents;
          } else if (action === 'reject' || action === 'cancel') {
            newPending = Math.max(0, curPending - amountCents);
            newAvailable = curAvailable + amountCents;
          }

          t.set(creatorRef, {
            pendingPayoutCents: newPending,
            withdrawnAmountCents: newWithdrawn,
            availableBalanceCents: newAvailable,
            updatedAt: nowIso,
          }, { merge: true });
        }
      });

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: `PAYOUT_${newStatus.toUpperCase()}`,
        targetType: 'payout',
        targetId: payoutId,
        notes: notes || reason || '',
      });
    }
  }

  // =========================================================================
  // 8. REPORTS & MODERATION
  // =========================================================================

  async getAllReports(): Promise<AdminReportItem[]> {
    const reportsSnap = await getDocs(collection(db, 'reports'));
    const items: AdminReportItem[] = [];

    reportsSnap.forEach((docSnap) => {
      items.push({
        ...(docSnap.data() as any),
        id: docSnap.id,
      });
    });

    return items.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  async resolveReport(
    reportId: string,
    status: 'resolved' | 'dismissed',
    notes?: string
  ): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized.');
    }

    try {
      const callFn = httpsCallable(functions, 'adminResolveReport');
      await callFn({ reportId, status, notes });
    } catch (cloudErr) {
      console.warn('[AdminService] Direct report update fallback:', cloudErr);
      const reportRef = doc(db, 'reports', reportId);
      const nowIso = new Date().toISOString();

      await updateDoc(reportRef, {
        status,
        reviewedBy: currentUser.uid,
        resolutionNotes: notes || '',
        resolvedAt: nowIso,
        updatedAt: nowIso,
      });

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: `REPORT_${status.toUpperCase()}`,
        targetType: 'report',
        targetId: reportId,
        notes: notes || '',
      });
    }
  }

  async createReport(report: Omit<AdminReportItem, 'id' | 'createdAt' | 'status'>): Promise<string> {
    const currentUser = auth.currentUser;
    const reportRef = doc(collection(db, 'reports'));
    const nowIso = new Date().toISOString();

    const data: AdminReportItem = {
      ...report,
      id: reportRef.id,
      reporterId: currentUser?.uid || 'anonymous',
      reporterEmail: currentUser?.email || undefined,
      status: 'pending',
      createdAt: nowIso,
    };

    await setDoc(reportRef, data);
    return reportRef.id;
  }

  // =========================================================================
  // 9. ANALYTICS
  // =========================================================================

  async getAnalyticsData(days: number = 7): Promise<DailyAnalyticsPoint[]> {
    const points: DailyAnalyticsPoint[] = [];
    const now = new Date();

    // Generate day buckets
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      points.push({
        date: label,
        newUsers: 0,
        videoUploads: 0,
        postUploads: 0,
        videoViews: 0,
        qualifiedViews: 0,
        rewardLiabilityUsd: 0,
      });
    }

    try {
      const [usersSnap, videosSnap, postsSnap, rewardsSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'videos')),
        getDocs(collection(db, 'posts')),
        getDocs(collection(db, 'creator_rewards')),
      ]);

      const bucketMap: Record<string, DailyAnalyticsPoint> = {};
      points.forEach((p) => {
        bucketMap[p.date] = p;
      });

      // Bucket users
      usersSnap.forEach((d) => {
        const c = d.data().createdAt;
        if (c) {
          const label = new Date(c).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (bucketMap[label]) bucketMap[label].newUsers++;
        }
      });

      // Bucket videos
      videosSnap.forEach((d) => {
        const v = d.data();
        if (v.createdAt) {
          const label = new Date(v.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (bucketMap[label]) {
            bucketMap[label].videoUploads++;
            bucketMap[label].videoViews += Number(v.viewsCount) || 0;
          }
        }
      });

      // Bucket posts
      postsSnap.forEach((d) => {
        const c = d.data().createdAt;
        if (c) {
          const label = new Date(c).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (bucketMap[label]) bucketMap[label].postUploads++;
        }
      });

      // Liability total
      let totalLiabilityCents = 0;
      rewardsSnap.forEach((d) => {
        const r = d.data() as CreatorRewardsSummary;
        const metrics = rewardsService.getDisplayRewardsMetrics(r);
        totalLiabilityCents +=
          metrics.displayAvailableBalanceCents + (Number(r.pendingPayoutCents) || 0);
      });
      const currentUsd = Number((totalLiabilityCents / 100).toFixed(2));
      points.forEach((p) => {
        p.rewardLiabilityUsd = currentUsd;
      });
    } catch (e) {
      console.warn('[AdminService] Analytics data calculation note:', e);
    }

    return points;
  }

  // =========================================================================
  // 10. SYSTEM & HEALTH
  // =========================================================================

  // =========================================================================
  // 11. ADMIN TESTING & STAGING TOOLS
  // =========================================================================

  /**
   * 1. Add Test Views
   * Adds distinguishable test views to a video.
   */
  async addTestViews(videoId: string, count: number = 100): Promise<{ success: boolean; addedViews: number }> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized. Admin testing tools are strictly restricted to authorized admin.');
    }

    const claims = await this.verifyAdminClaims(false);
    if (!claims.isAdminClaim || !claims.isValidAdmin) {
      throw new Error('Unauthorized: Active admin custom claim (admin: true) is required.');
    }

    const idempotencyKey = `idemp_views_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeCount = Math.max(1, Math.min(500000, Number(count) || 100));

    try {
      const callFn = httpsCallable(functions, 'adminAddTestViews');
      const res: any = await callFn({ videoId, count: safeCount, idempotencyKey });
      return res.data;
    } catch (cloudErr) {
      console.warn('[AdminService] Direct fallback for addTestViews:', cloudErr);
      const videoRef = doc(db, 'videos', videoId);
      const nowIso = new Date().toISOString();
      const updatePayload = {
        viewsCount: increment(safeCount),
        testViewsCount: increment(safeCount),
        hasAdminTestData: true,
        lastAdminTestAt: nowIso,
      };

      try {
        await updateDoc(videoRef, updatePayload);
      } catch (writeErr: any) {
        if (writeErr?.code === 'permission-denied') {
          await currentUser.getIdToken(true);
          await getIdTokenResult(currentUser, true);
          await updateDoc(videoRef, updatePayload);
        } else {
          throw writeErr;
        }
      }

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'ADD_TEST_VIEWS',
        targetType: 'video',
        targetId: videoId,
        idempotencyKey,
        notes: `Added ${safeCount} test views (distinguishable via testViewsCount).`,
      });

      return { success: true, addedViews: safeCount };
    }
  }

  /**
   * 2. Add Test Followers
   * Adds distinguishable test followers without creating fake Firebase Auth accounts.
   */
  async addTestFollowers(targetUserId: string, count: number = 10): Promise<{ success: boolean; addedFollowers: number }> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized. Admin testing tools are strictly restricted to authorized admin.');
    }

    const claims = await this.verifyAdminClaims(false);
    if (!claims.isAdminClaim || !claims.isValidAdmin) {
      throw new Error('Unauthorized: Active admin custom claim (admin: true) is required.');
    }

    const idempotencyKey = `idemp_foll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeCount = Math.max(1, Math.min(50000, Number(count) || 10));

    try {
      const callFn = httpsCallable(functions, 'adminAddTestFollowers');
      const res: any = await callFn({ targetUserId, count: safeCount, idempotencyKey });
      return res.data;
    } catch (cloudErr) {
      console.warn('[AdminService] Direct fallback for addTestFollowers:', cloudErr);
      const userRef = doc(db, 'users', targetUserId);
      const nowIso = new Date().toISOString();
      const updatePayload = {
        followersCount: increment(safeCount),
        testFollowersCount: increment(safeCount),
        hasAdminTestData: true,
        lastAdminTestAt: nowIso,
      };

      try {
        await updateDoc(userRef, updatePayload);
      } catch (writeErr: any) {
        if (writeErr?.code === 'permission-denied') {
          await currentUser.getIdToken(true);
          await getIdTokenResult(currentUser, true);
          await updateDoc(userRef, updatePayload);
        } else {
          throw writeErr;
        }
      }

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'ADD_TEST_FOLLOWERS',
        targetType: 'user',
        targetId: targetUserId,
        idempotencyKey,
        notes: `Added ${safeCount} test followers without fake Auth accounts.`,
      });

      return { success: true, addedFollowers: safeCount };
    }
  }

  /**
   * 3. Add Test Likes
   * Adds test likes to a video or post with separate counter.
   */
  async addTestLikes(
    targetType: 'video' | 'post',
    targetId: string,
    count: number = 10
  ): Promise<{ success: boolean; addedLikes: number }> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized. Admin testing tools are strictly restricted to authorized admin.');
    }

    const claims = await this.verifyAdminClaims(false);
    if (!claims.isAdminClaim || !claims.isValidAdmin) {
      throw new Error('Unauthorized: Active admin custom claim (admin: true) is required.');
    }

    const idempotencyKey = `idemp_likes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeCount = Math.max(1, Math.min(50000, Number(count) || 10));

    try {
      const callFn = httpsCallable(functions, 'adminAddTestLikes');
      const res: any = await callFn({ targetType, targetId, count: safeCount, idempotencyKey });
      return res.data;
    } catch (cloudErr) {
      console.warn('[AdminService] Direct fallback for addTestLikes:', cloudErr);
      const colName = targetType === 'video' ? 'videos' : 'posts';
      const docRef = doc(db, colName, targetId);
      const nowIso = new Date().toISOString();
      const updatePayload = {
        likesCount: increment(safeCount),
        testLikesCount: increment(safeCount),
        hasAdminTestData: true,
        lastAdminTestAt: nowIso,
      };

      try {
        await updateDoc(docRef, updatePayload);
      } catch (writeErr: any) {
        if (writeErr?.code === 'permission-denied') {
          await currentUser.getIdToken(true);
          await getIdTokenResult(currentUser, true);
          await updateDoc(docRef, updatePayload);
        } else {
          throw writeErr;
        }
      }

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'ADD_TEST_LIKES',
        targetType,
        targetId,
        idempotencyKey,
        notes: `Added ${safeCount} test likes (distinguishable via testLikesCount).`,
      });

      return { success: true, addedLikes: safeCount };
    }
  }

  /**
   * 4. Add Test Comments
   * Adds realistic synthetic comment without notification spam.
   */
  async addTestComment(
    targetType: 'video' | 'post',
    targetId: string,
    text?: string
  ): Promise<{ success: boolean; comment: any }> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error('Unauthorized. Admin testing tools are strictly restricted to authorized admin.');
    }

    const claims = await this.verifyAdminClaims(false);
    if (!claims.isAdminClaim || !claims.isValidAdmin) {
      throw new Error('Unauthorized: Active admin custom claim (admin: true) is required.');
    }

    const idempotencyKey = `idemp_comm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const callFn = httpsCallable(functions, 'adminAddTestComment');
      const res: any = await callFn({ targetType, targetId, text, idempotencyKey });
      return res.data;
    } catch (cloudErr) {
      console.warn('[AdminService] Direct fallback for addTestComment:', cloudErr);
      const syntheticNames = [
        { name: 'Elena Rostova', user: 'elena_r', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150' },
        { name: 'Marcus Brody', user: 'marcus_b', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150' },
        { name: 'Liam Vance', user: 'liam_vance', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150' },
        { name: 'Chloe Bennett', user: 'chloebennett', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150' },
        { name: 'Julian Hayes', user: 'julian_h', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150' },
      ];
      const randomUser = syntheticNames[Math.floor(Math.random() * syntheticNames.length)];
      const defaultTexts = [
        'Incredible composition and lighting here!',
        'Love the mood and aesthetic on this one.',
        'Super clean execution, keep it up!',
        'The details on this are unmatched.',
        'Really inspiring content, appreciate you sharing this.',
      ];
      const commentText = (text && text.trim()) || defaultTexts[Math.floor(Math.random() * defaultTexts.length)];
      const commentId = `test_com_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();

      const commentData = {
        id: commentId,
        [targetType === 'video' ? 'videoId' : 'postId']: targetId,
        userId: `synth_${randomUser.user}`,
        user: {
          id: `synth_${randomUser.user}`,
          username: randomUser.user,
          displayName: randomUser.name,
          avatarUrl: randomUser.avatar,
        },
        text: commentText,
        isAdminTestData: true,
        isSyntheticTest: true,
        createdAt: nowIso,
      };

      const colName = targetType === 'video' ? 'videos' : 'posts';
      const targetRef = doc(db, colName, targetId);
      const commentRef = doc(db, colName, targetId, 'comments', commentId);
      const counterUpdatePayload = {
        commentsCount: increment(1),
        testCommentsCount: increment(1),
        hasAdminTestData: true,
        lastAdminTestAt: nowIso,
      };

      try {
        await setDoc(commentRef, commentData);
        await updateDoc(targetRef, counterUpdatePayload);
      } catch (writeErr: any) {
        if (writeErr?.code === 'permission-denied') {
          await currentUser.getIdToken(true);
          await getIdTokenResult(currentUser, true);
          await setDoc(commentRef, commentData);
          await updateDoc(targetRef, counterUpdatePayload);
        } else {
          throw writeErr;
        }
      }

      await this.recordAuditLog({
        adminUid: currentUser.uid,
        adminEmail: currentUser.email || AUTHORIZED_ADMIN_EMAIL,
        action: 'ADD_TEST_COMMENT',
        targetType,
        targetId,
        idempotencyKey,
        notes: `Added synthetic comment from ${randomUser.name} without notification spam.`,
      });

      return { success: true, comment: commentData };
    }
  }

  /**
   * 5. Grant Test Reward
   * Adds test rewards to a creator with transactionType: "admin_test_reward" and full audit trace.
   */
  /**
   * 5. Grant Test Reward (Spark-Compatible Client-Side Diagnostic Implementation)
   * Executes each operation with individual try/catch wrapping and emits live
   * diagnostic reports to pinpoint the exact Firestore operation being attempted/denied.
   */
  async grantTestReward(
    targetUserId: string,
    amountCents: number,
    reason: string,
    customIdempotencyKey?: string,
    onDiagnosticUpdate?: (diag: GrantTestRewardDiagnostic) => void
  ): Promise<{
    success: boolean;
    amountCents: number;
    alreadyProcessed?: boolean;
    operationId?: string;
    auditId?: string;
    message?: string;
  }> {
    const currentUser = auth.currentUser;
    const authUid = currentUser?.uid || 'NONE';
    const authEmail = currentUser?.email || 'NONE';

    const diag: GrantTestRewardDiagnostic = {
      authUid,
      authEmail,
      hasAdminClaim: false,
      currentOperation: 'PRE_FLIGHT_AUTH_CHECK',
      currentPath: 'auth.currentUser',
      status: 'IN_PROGRESS',
      steps: [
        { name: '1. Auth & Admin Claim Verification', path: 'auth/token', status: 'PENDING' },
        { name: '2. READ reward_ledger', path: 'reward_ledger/<operationId>', status: 'PENDING' },
        { name: '3. READ creator_rewards', path: `creator_rewards/${targetUserId}`, status: 'PENDING' },
        { name: '4. WRITE creator_rewards', path: `creator_rewards/${targetUserId}`, status: 'PENDING' },
        { name: '5. CREATE reward_ledger', path: 'reward_ledger/<operationId>', status: 'PENDING' },
        { name: '6. CREATE adminAuditLogs', path: 'adminAuditLogs/<id>', status: 'PENDING' },
      ],
      timestamp: new Date().toISOString(),
    };

    const updateDiag = (updater: (d: GrantTestRewardDiagnostic) => void) => {
      updater(diag);
      diag.timestamp = new Date().toISOString();
      console.log(`[GrantTestReward:Diag] Op: ${diag.currentOperation} | Path: ${diag.currentPath} | Status: ${diag.status}`);
      onDiagnosticUpdate?.({ ...diag, steps: diag.steps.map((s) => ({ ...s })) });
    };

    // Step 1: Pre-flight auth & ID token claims verification
    const allApps = getApps().map((a) => ({
      name: a.name,
      projectId: a.options.projectId,
      appId: a.options.appId,
    }));
    console.log('[FIREBASE_APPS_DIAGNOSTIC]', allApps);

    diag.firebaseAppName = app.name;
    diag.firebaseProjectId = app.options.projectId || 'N/A';
    diag.firebaseAppId = app.options.appId || 'N/A';
    diag.firestoreDatabaseId = (db as any)._databaseId?.database || '(default)';
    diag.initializedAppsSummary = JSON.stringify(allApps);

    updateDiag((d) => {
      d.currentOperation = '1. Auth & Admin Claim Verification';
      d.currentPath = 'auth/token';
      d.steps[0].status = 'RUNNING';
    });

    try {
      if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
        throw new Error(`Unauthorized: Current user (${authEmail}) is not authorized admin azlanmalik774@gmail.com.`);
      }

      await currentUser.getIdToken(true);
      const tokenResult = await getIdTokenResult(currentUser, true);
      const hasAdmin = Boolean(tokenResult.claims && tokenResult.claims.admin === true);
      diag.hasAdminClaim = hasAdmin;
      diag.claimsSummary = JSON.stringify(tokenResult.claims || {});

      if (!hasAdmin) {
        throw new Error('Access denied: Refreshed token does NOT contain custom claim admin: true.');
      }

      updateDiag((d) => {
        d.steps[0].status = 'SUCCESS';
      });
    } catch (authErr: any) {
      updateDiag((d) => {
        d.steps[0].status = 'FAILED';
        d.steps[0].code = authErr?.code || 'AUTH_DENIED';
        d.steps[0].message = authErr?.message;
        d.failedOperation = '1. Auth & Admin Claim Verification';
        d.failedPath = 'auth/token';
        d.errorCode = authErr?.code || 'AUTH_DENIED';
        d.errorMessage = authErr?.message;
        d.status = 'ERROR';
      });
      console.error('[GrantTestReward:Diag] Step 1 Auth/Claim FAILED:', authErr?.code, authErr?.message);
      throw authErr;
    }

    const safeAmountCents = Math.round(Number(amountCents) || 0);
    if (safeAmountCents <= 0 || !Number.isInteger(safeAmountCents) || !isFinite(safeAmountCents)) {
      throw new Error('Positive integer amount in cents is required.');
    }
    if (safeAmountCents > 1000000) {
      throw new Error('Test reward amount exceeds maximum staging limit ($10,000.00).');
    }

    const operationId = customIdempotencyKey || `admin_test_reward_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ledgerRef = doc(db, 'reward_ledger', operationId);
    const creatorRef = doc(db, 'creator_rewards', targetUserId);
    const auditRef = doc(collection(db, 'adminAuditLogs'));
    const adminUid = currentUser.uid;
    const adminEmail = AUTHORIZED_ADMIN_EMAIL;

    diag.steps[1].path = `reward_ledger/${operationId}`;
    diag.steps[4].path = `reward_ledger/${operationId}`;
    diag.steps[5].path = `adminAuditLogs/${auditRef.id}`;

    // Step 2: READ reward_ledger/{operationId}
    updateDiag((d) => {
      d.currentOperation = `READ reward_ledger/${operationId}`;
      d.currentPath = `reward_ledger/${operationId}`;
      d.steps[1].status = 'RUNNING';
    });

    let ledgerSnap;
    try {
      ledgerSnap = await getDoc(ledgerRef);
      updateDiag((d) => {
        d.steps[1].status = 'SUCCESS';
      });
    } catch (op1Err: any) {
      updateDiag((d) => {
        d.steps[1].status = 'FAILED';
        d.steps[1].code = op1Err?.code || 'unknown';
        d.steps[1].message = op1Err?.message || 'READ failed';
        d.failedOperation = `READ reward_ledger/${operationId}`;
        d.failedPath = `reward_ledger/${operationId}`;
        d.errorCode = op1Err?.code || 'permission-denied';
        d.errorMessage = op1Err?.message || 'READ failed';
        d.status = 'ERROR';
      });
      console.error(`[GrantTestReward:Diag] Op 2 READ reward_ledger/${operationId} FAILED:`, op1Err?.code, op1Err?.message);
      throw op1Err;
    }

    if (ledgerSnap.exists()) {
      return {
        success: true,
        alreadyProcessed: true,
        amountCents: safeAmountCents,
        operationId,
        message: `Operation ${operationId} was already processed. Duplicate reward blocked.`,
      };
    }

    // Step 3: READ creator_rewards/{targetUserId}
    updateDiag((d) => {
      d.currentOperation = `READ creator_rewards/${targetUserId}`;
      d.currentPath = `creator_rewards/${targetUserId}`;
      d.steps[2].status = 'RUNNING';
    });

    let creatorSnap;
    try {
      creatorSnap = await getDoc(creatorRef);
      updateDiag((d) => {
        d.steps[2].status = 'SUCCESS';
      });
    } catch (op2Err: any) {
      updateDiag((d) => {
        d.steps[2].status = 'FAILED';
        d.steps[2].code = op2Err?.code || 'unknown';
        d.steps[2].message = op2Err?.message || 'READ failed';
        d.failedOperation = `READ creator_rewards/${targetUserId}`;
        d.failedPath = `creator_rewards/${targetUserId}`;
        d.errorCode = op2Err?.code || 'permission-denied';
        d.errorMessage = op2Err?.message || 'READ failed';
        d.status = 'ERROR';
      });
      console.error(`[GrantTestReward:Diag] Op 3 READ creator_rewards/${targetUserId} FAILED:`, op2Err?.code, op2Err?.message);
      throw op2Err;
    }

    const nowIso = new Date().toISOString();
    let prevAvailable = 0;
    let prevTotal = 0;
    let prevTest = 0;
    const creatorExists = creatorSnap.exists();

    // Step 4: WRITE creator_rewards/{targetUserId} (CREATE or UPDATE)
    if (!creatorExists) {
      const createPayload = {
        userId: targetUserId,
        availableBalanceCents: safeAmountCents,
        totalEarnedCents: safeAmountCents,
        testRewardsGrantedCents: safeAmountCents,
        hasAdminTestData: true,
        qualifiedViewsCount: 0,
        videoRewardsCents: 0,
        referralRewardsCents: 0,
        pendingEarningsCents: 0,
        withdrawnAmountCents: 0,
        pendingPayoutCents: 0,
        successfulReferralsCount: 0,
        currency: 'USD',
        updatedAt: nowIso,
      };

      updateDiag((d) => {
        d.currentOperation = `CREATE creator_rewards/${targetUserId}`;
        d.currentPath = `creator_rewards/${targetUserId}`;
        d.steps[3].name = `4. CREATE creator_rewards/${targetUserId}`;
        d.steps[3].status = 'RUNNING';
      });

      try {
        await setDoc(creatorRef, createPayload);
        updateDiag((d) => {
          d.steps[3].status = 'SUCCESS';
        });
      } catch (op3Err: any) {
        updateDiag((d) => {
          d.steps[3].status = 'FAILED';
          d.steps[3].code = op3Err?.code || 'unknown';
          d.steps[3].message = op3Err?.message || 'CREATE failed';
          d.failedOperation = `CREATE creator_rewards/${targetUserId}`;
          d.failedPath = `creator_rewards/${targetUserId}`;
          d.errorCode = op3Err?.code || 'permission-denied';
          d.errorMessage = op3Err?.message || 'CREATE failed';
          d.status = 'ERROR';
        });
        console.error(`[GrantTestReward:Diag] Op 4 CREATE creator_rewards/${targetUserId} FAILED:`, op3Err?.code, op3Err?.message);
        throw op3Err;
      }
    } else {
      const cur = creatorSnap.data() || {};
      prevAvailable = Number(cur.availableBalanceCents) || 0;
      prevTotal = Number(cur.totalEarnedCents) || 0;
      prevTest = Number(cur.testRewardsGrantedCents) || 0;

      const updatePayload = {
        availableBalanceCents: prevAvailable + safeAmountCents,
        totalEarnedCents: prevTotal + safeAmountCents,
        testRewardsGrantedCents: prevTest + safeAmountCents,
        hasAdminTestData: true,
        updatedAt: nowIso,
      };

      updateDiag((d) => {
        d.currentOperation = `UPDATE creator_rewards/${targetUserId}`;
        d.currentPath = `creator_rewards/${targetUserId}`;
        d.steps[3].name = `4. UPDATE creator_rewards/${targetUserId}`;
        d.steps[3].status = 'RUNNING';
      });

      try {
        await updateDoc(creatorRef, updatePayload);
        updateDiag((d) => {
          d.steps[3].status = 'SUCCESS';
        });
      } catch (op3Err: any) {
        updateDiag((d) => {
          d.steps[3].status = 'FAILED';
          d.steps[3].code = op3Err?.code || 'unknown';
          d.steps[3].message = op3Err?.message || 'UPDATE failed';
          d.failedOperation = `UPDATE creator_rewards/${targetUserId}`;
          d.failedPath = `creator_rewards/${targetUserId}`;
          d.errorCode = op3Err?.code || 'permission-denied';
          d.errorMessage = op3Err?.message || 'UPDATE failed';
          d.status = 'ERROR';
        });
        console.error(`[GrantTestReward:Diag] Op 4 UPDATE creator_rewards/${targetUserId} FAILED:`, op3Err?.code, op3Err?.message);
        throw op3Err;
      }
    }

    // Step 5: CREATE reward_ledger/{operationId}
    const ledgerPayload = {
      id: operationId,
      operationId,
      eventId: operationId,
      userId: targetUserId,
      type: 'admin_test_reward',
      transactionType: 'admin_test_reward',
      isAdminTestData: true,
      amountCents: safeAmountCents,
      amountUsd: Number((safeAmountCents / 100).toFixed(2)),
      currency: 'USD',
      adminUid,
      adminEmail,
      status: 'completed',
      reason: reason || 'Admin staging test reward',
      description: `Admin test reward: ${reason || 'Staging test'} ($${(safeAmountCents / 100).toFixed(2)})`,
      createdAt: nowIso,
    };

    updateDiag((d) => {
      d.currentOperation = `CREATE reward_ledger/${operationId}`;
      d.currentPath = `reward_ledger/${operationId}`;
      d.steps[4].status = 'RUNNING';
    });

    try {
      await setDoc(ledgerRef, ledgerPayload);
      updateDiag((d) => {
        d.steps[4].status = 'SUCCESS';
      });
    } catch (op4Err: any) {
      updateDiag((d) => {
        d.steps[4].status = 'FAILED';
        d.steps[4].code = op4Err?.code || 'unknown';
        d.steps[4].message = op4Err?.message || 'CREATE failed';
        d.failedOperation = `CREATE reward_ledger/${operationId}`;
        d.failedPath = `reward_ledger/${operationId}`;
        d.errorCode = op4Err?.code || 'permission-denied';
        d.errorMessage = op4Err?.message || 'CREATE failed';
        d.status = 'ERROR';
      });
      console.error(`[GrantTestReward:Diag] Op 5 CREATE reward_ledger/${operationId} FAILED:`, op4Err?.code, op4Err?.message);
      throw op4Err;
    }

    // Step 6: CREATE adminAuditLogs/{auditId}
    const auditPayload = {
      id: auditRef.id,
      adminUid,
      adminEmail,
      action: 'GRANT_TEST_REWARD',
      targetType: 'creator_reward',
      targetId: targetUserId,
      amountCents: safeAmountCents,
      amountUsd: Number((safeAmountCents / 100).toFixed(2)),
      operationId,
      idempotencyKey: operationId,
      previousBalanceCents: prevAvailable,
      newBalanceCents: prevAvailable + safeAmountCents,
      timestamp: nowIso,
      notes: `Granted $${(safeAmountCents / 100).toFixed(2)} test reward to user ${targetUserId} (${reason || 'Admin test'}).`,
    };

    updateDiag((d) => {
      d.currentOperation = `CREATE adminAuditLogs/${auditRef.id}`;
      d.currentPath = `adminAuditLogs/${auditRef.id}`;
      d.steps[5].status = 'RUNNING';
    });

    try {
      await setDoc(auditRef, auditPayload);
      updateDiag((d) => {
        d.steps[5].status = 'SUCCESS';
        d.status = 'SUCCESS';
        d.currentOperation = 'COMPLETED_SUCCESSFULLY';
      });
    } catch (op5Err: any) {
      updateDiag((d) => {
        d.steps[5].status = 'FAILED';
        d.steps[5].code = op5Err?.code || 'unknown';
        d.steps[5].message = op5Err?.message || 'CREATE failed';
        d.failedOperation = `CREATE adminAuditLogs/${auditRef.id}`;
        d.failedPath = `adminAuditLogs/${auditRef.id}`;
        d.errorCode = op5Err?.code || 'permission-denied';
        d.errorMessage = op5Err?.message || 'CREATE failed';
        d.status = 'ERROR';
      });
      console.error(`[GrantTestReward:Diag] Op 6 CREATE adminAuditLogs/${auditRef.id} FAILED:`, op5Err?.code, op5Err?.message);
      throw op5Err;
    }

    return {
      success: true,
      alreadyProcessed: false,
      amountCents: safeAmountCents,
      operationId,
      auditId: auditRef.id,
    };
  }

  /**
   * 6. Add Test Video Metrics
   * Atomically increments testViewsCount, testQualifiedViewsCount, and recalculates cumulative
   * testVideoRewardsCents on creator_rewards/{userId} inside a Firestore transaction.
   * Treats admin-supplied totalTestViews and qualifiedTestViews as ADDITIONS (deltas)
   * on top of existing server-authoritative values so prior qualified views are never overwritten.
   * Records an auditable entry in reward_ledger with transactionType: "admin_test_reward",
   * and logs previous and resulting values to adminAuditLogs.
   */
  async addTestVideoMetrics(
    targetUserId: string,
    totalTestViews: number,
    qualifiedTestViews: number,
    reason?: string,
    customOperationId?: string,
    onDiagnosticUpdate?: (diag: GrantTestRewardDiagnostic) => void
  ): Promise<{
    success: boolean;
    alreadyProcessed?: boolean;
    addedTotalViews: number;
    addedQualifiedViews: number;
    addedRewardCents: number;
    previousTotalViews: number;
    previousQualifiedViews: number;
    newTotalViews: number;
    newQualifiedViews: number;
    totalTestViews: number;
    qualifiedTestViews: number;
    testVideoRewardsCents: number;
    operationId: string;
    auditId?: string;
    message?: string;
  }> {
    const currentUser = auth.currentUser;
    if (!currentUser || !this.isAuthorizedAdminEmail(currentUser.email)) {
      throw new Error(`Unauthorized. Admin testing tools are strictly restricted to authorized admin ${AUTHORIZED_ADMIN_EMAIL}.`);
    }

    const deltaTotalViews = Math.round(Number(totalTestViews) || 0);
    const deltaQualifiedViews = Math.round(Number(qualifiedTestViews) || 0);

    if (!Number.isFinite(deltaTotalViews) || !Number.isFinite(deltaQualifiedViews)) {
      throw new Error('Valid integer view adjustments are required.');
    }

    if (deltaQualifiedViews > 0 && deltaTotalViews > 0 && deltaQualifiedViews > deltaTotalViews) {
      throw new Error(`Qualified test views adjustment (${deltaQualifiedViews.toLocaleString()}) cannot exceed total test views adjustment (${deltaTotalViews.toLocaleString()}).`);
    }

    const operationId = customOperationId || `admin_test_reward_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const creatorRef = doc(db, 'creator_rewards', targetUserId);
    const ledgerRef = doc(db, 'reward_ledger', operationId);
    const auditRef = doc(collection(db, 'adminAuditLogs'));
    const adminUid = currentUser.uid;
    const adminEmail = AUTHORIZED_ADMIN_EMAIL;
    const nowIso = new Date().toISOString();

    const diag: GrantTestRewardDiagnostic = {
      authUid: adminUid,
      authEmail: currentUser.email || 'N/A',
      hasAdminClaim: false,
      firebaseAppName: auth.app?.name || '[DEFAULT]',
      firebaseProjectId: auth.app?.options?.projectId || 'sogo-e5ea9',
      firebaseAppId: auth.app?.options?.appId || 'N/A',
      firestoreDatabaseId: '(default)',
      currentOperation: 'INITIALIZING',
      currentPath: '',
      status: 'IN_PROGRESS',
      steps: [
        { name: '1. Check Token & Admin Custom Claim', path: 'auth.currentUser', status: 'PENDING' },
        { name: `2. READ reward_ledger/${operationId}`, path: `reward_ledger/${operationId}`, status: 'PENDING' },
        { name: `3. READ creator_rewards/${targetUserId}`, path: `creator_rewards/${targetUserId}`, status: 'PENDING' },
        { name: `4. WRITE creator_rewards/${targetUserId}`, path: `creator_rewards/${targetUserId}`, status: 'PENDING' },
        { name: `5. CREATE reward_ledger/${operationId}`, path: `reward_ledger/${operationId}`, status: 'PENDING' },
        { name: `6. CREATE adminAuditLogs/${auditRef.id}`, path: `adminAuditLogs/${auditRef.id}`, status: 'PENDING' },
      ],
      timestamp: nowIso,
    };

    const updateDiag = (fn: (d: GrantTestRewardDiagnostic) => void) => {
      if (onDiagnosticUpdate) {
        fn(diag);
        onDiagnosticUpdate({ ...diag, steps: [...diag.steps.map((s) => ({ ...s }))] });
      }
    };

    // Step 1: Verify token & custom claim
    updateDiag((d) => {
      d.currentOperation = 'CHECK_ADMIN_CLAIM';
      d.currentPath = 'auth.currentUser';
      d.steps[0].status = 'RUNNING';
    });

    try {
      await currentUser.getIdToken(true);
      const tokenResult = await getIdTokenResult(currentUser, true);
      const hasClaim = Boolean(tokenResult.claims && (tokenResult.claims.admin === true || tokenResult.claims.role === 'admin'));
      diag.hasAdminClaim = hasClaim;
      diag.claimsSummary = JSON.stringify(tokenResult.claims || {});

      if (!hasClaim) {
        throw new Error('Access denied: Refreshed token does NOT contain custom claim admin: true.');
      }
      updateDiag((d) => {
        d.steps[0].status = 'SUCCESS';
      });
    } catch (claimErr: any) {
      updateDiag((d) => {
        d.steps[0].status = 'FAILED';
        d.steps[0].code = claimErr?.code || 'unauthorized';
        d.steps[0].message = claimErr?.message || 'Admin claim check failed';
        d.failedOperation = 'CHECK_ADMIN_CLAIM';
        d.failedPath = 'auth.currentUser';
        d.errorCode = claimErr?.code || 'unauthorized';
        d.errorMessage = claimErr?.message || 'Admin claim check failed';
        d.status = 'ERROR';
      });
      console.error('[AddTestVideoMetrics:Diag] Step 1 Claim check failed:', claimErr);
      const wrapped = new Error(claimErr?.message || 'Admin claim check failed');
      (wrapped as any).diagnostic = diag;
      throw wrapped;
    }

    let alreadyProcessed = false;
    let previousCombinedTotalViews = 0;
    let previousCombinedQualifiedViews = 0;
    let newCombinedTotalViews = 0;
    let newCombinedQualifiedViews = 0;
    let newTestViews = 0;
    let newTestQualifiedViews = 0;
    let newTestVideoRewardsCents = 0;
    let addedRewardCents = 0;
    let effectiveAddedTotalViews = 0;

    // Steps 2–6: Execute inside an atomic Firestore transaction so concurrent adjustments never overwrite each other
    try {
      await runTransaction(db, async (transaction) => {
        // Step 2: Idempotency check / READ reward_ledger/{operationId}
        updateDiag((d) => {
          d.currentOperation = `READ reward_ledger/${operationId}`;
          d.currentPath = `reward_ledger/${operationId}`;
          d.steps[1].status = 'RUNNING';
        });

        let ledgerSnap;
        try {
          ledgerSnap = await transaction.get(ledgerRef);
          updateDiag((d) => {
            d.steps[1].status = 'SUCCESS';
          });
        } catch (op1Err: any) {
          updateDiag((d) => {
            d.steps[1].status = 'FAILED';
            d.steps[1].code = op1Err?.code || 'unknown';
            d.steps[1].message = op1Err?.message || 'READ failed';
            d.failedOperation = `READ reward_ledger/${operationId}`;
            d.failedPath = `reward_ledger/${operationId}`;
            d.errorCode = op1Err?.code || 'permission-denied';
            d.errorMessage = op1Err?.message || 'READ failed';
            d.status = 'ERROR';
          });
          throw op1Err;
        }

        if (ledgerSnap.exists()) {
          alreadyProcessed = true;
          return;
        }

        // Step 3: READ creator_rewards/{targetUserId} (server-authoritative existing state)
        updateDiag((d) => {
          d.currentOperation = `READ creator_rewards/${targetUserId}`;
          d.currentPath = `creator_rewards/${targetUserId}`;
          d.steps[2].status = 'RUNNING';
        });

        let creatorSnap;
        try {
          creatorSnap = await transaction.get(creatorRef);
          updateDiag((d) => {
            d.steps[2].status = 'SUCCESS';
          });
        } catch (op2Err: any) {
          updateDiag((d) => {
            d.steps[2].status = 'FAILED';
            d.steps[2].code = op2Err?.code || 'unknown';
            d.steps[2].message = op2Err?.message || 'READ failed';
            d.failedOperation = `READ creator_rewards/${targetUserId}`;
            d.failedPath = `creator_rewards/${targetUserId}`;
            d.errorCode = op2Err?.code || 'permission-denied';
            d.errorMessage = op2Err?.message || 'READ failed';
            d.status = 'ERROR';
          });
          throw op2Err;
        }

        const creatorExists = creatorSnap.exists();
        const cur = creatorExists ? (creatorSnap.data() || {}) : {};

        const prevOrganicViews = Math.max(0, Number(cur.totalViewsCount) || 0);
        const prevOrganicQualifiedViews = Math.max(0, Number(cur.qualifiedViewsCount) || 0);
        const prevTestViews = Math.max(0, Number(cur.testViewsCount) || 0);
        const prevTestQualifiedViews = Math.max(0, Number(cur.testQualifiedViewsCount) || 0);
        const prevTestVideoRewardsCents = Math.max(0, Number(cur.testVideoRewardsCents) || 0);

        // Cumulative calculation: newQualifiedViews = existingQualifiedViews + adjustment (clamped >= 0)
        newTestQualifiedViews = Math.max(0, prevTestQualifiedViews + deltaQualifiedViews);
        effectiveAddedTotalViews =
          deltaTotalViews > 0
            ? Math.max(deltaTotalViews, deltaQualifiedViews)
            : deltaTotalViews;
        newTestViews = Math.max(
          newTestQualifiedViews,
          Math.max(0, prevTestViews + effectiveAddedTotalViews)
        );

        // Rate: $0.50 per 1,000 qualified views -> floor(qualified * 50 / 1000) in integer cents
        newTestVideoRewardsCents = Math.floor((newTestQualifiedViews * 50) / 1000);
        addedRewardCents = Math.max(0, newTestVideoRewardsCents - prevTestVideoRewardsCents);

        previousCombinedTotalViews = prevOrganicViews + prevTestViews;
        previousCombinedQualifiedViews = prevOrganicQualifiedViews + prevTestQualifiedViews;
        newCombinedTotalViews = prevOrganicViews + newTestViews;
        newCombinedQualifiedViews = prevOrganicQualifiedViews + newTestQualifiedViews;

        // Step 4: WRITE creator_rewards/{targetUserId} (CREATE or UPDATE)
        if (!creatorExists) {
          const createPayload = {
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
          };

          updateDiag((d) => {
            d.currentOperation = `CREATE creator_rewards/${targetUserId}`;
            d.currentPath = `creator_rewards/${targetUserId}`;
            d.steps[3].name = `4. CREATE creator_rewards/${targetUserId}`;
            d.steps[3].status = 'RUNNING';
          });

          transaction.set(creatorRef, createPayload);
        } else {
          const updatePayload = {
            testViewsCount: newTestViews,
            testQualifiedViewsCount: newTestQualifiedViews,
            testVideoRewardsCents: newTestVideoRewardsCents,
            hasAdminTestData: true,
            updatedAt: nowIso,
          };

          updateDiag((d) => {
            d.currentOperation = `UPDATE creator_rewards/${targetUserId}`;
            d.currentPath = `creator_rewards/${targetUserId}`;
            d.steps[3].name = `4. UPDATE creator_rewards/${targetUserId}`;
            d.steps[3].status = 'RUNNING';
          });

          transaction.update(creatorRef, updatePayload);
        }

        // Step 5: CREATE reward_ledger/{operationId}
        const ledgerPayload = {
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
        };

        updateDiag((d) => {
          d.currentOperation = `CREATE reward_ledger/${operationId}`;
          d.currentPath = `reward_ledger/${operationId}`;
          d.steps[3].status = 'SUCCESS';
          d.steps[4].status = 'RUNNING';
        });

        transaction.set(ledgerRef, ledgerPayload);

        // Step 6: CREATE adminAuditLogs/{auditId}
        const auditPayload = {
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
        };

        updateDiag((d) => {
          d.currentOperation = `CREATE adminAuditLogs/${auditRef.id}`;
          d.currentPath = `adminAuditLogs/${auditRef.id}`;
          d.steps[4].status = 'SUCCESS';
          d.steps[5].status = 'RUNNING';
        });

        transaction.set(auditRef, auditPayload);
      });

      updateDiag((d) => {
        d.steps[3].status = 'SUCCESS';
        d.steps[4].status = 'SUCCESS';
        d.steps[5].status = 'SUCCESS';
        d.status = 'SUCCESS';
        d.currentOperation = 'COMPLETED_SUCCESSFULLY';
      });
    } catch (txnErr: any) {
      updateDiag((d) => {
        if (d.status !== 'ERROR') {
          d.failedOperation = d.currentOperation || `TRANSACTION creator_rewards/${targetUserId}`;
          d.failedPath = d.currentPath || `creator_rewards/${targetUserId}`;
          d.errorCode = txnErr?.code || 'permission-denied';
          d.errorMessage = txnErr?.message || 'Transaction failed';
          d.status = 'ERROR';
        }
      });
      console.error(`[AddTestVideoMetrics:Diag] Transaction FAILED:`, txnErr?.code, txnErr?.message);
      const wrapped = new Error(txnErr?.message || 'Transaction failed');
      (wrapped as any).diagnostic = diag;
      throw wrapped;
    }

    if (alreadyProcessed) {
      return {
        success: true,
        alreadyProcessed: true,
        addedTotalViews: effectiveAddedTotalViews,
        addedQualifiedViews: deltaQualifiedViews,
        addedRewardCents: 0,
        previousTotalViews: previousCombinedTotalViews,
        previousQualifiedViews: previousCombinedQualifiedViews,
        newTotalViews: newCombinedTotalViews,
        newQualifiedViews: newCombinedQualifiedViews,
        totalTestViews: newTestViews,
        qualifiedTestViews: newTestQualifiedViews,
        testVideoRewardsCents: newTestVideoRewardsCents,
        operationId,
        message: `Operation ${operationId} was already processed. Duplicate test metrics entry blocked.`,
      };
    }

    return {
      success: true,
      alreadyProcessed: false,
      addedTotalViews: effectiveAddedTotalViews,
      addedQualifiedViews: deltaQualifiedViews,
      addedRewardCents,
      previousTotalViews: previousCombinedTotalViews,
      previousQualifiedViews: previousCombinedQualifiedViews,
      newTotalViews: newCombinedTotalViews,
      newQualifiedViews: newCombinedQualifiedViews,
      totalTestViews: newTestViews,
      qualifiedTestViews: newTestQualifiedViews,
      testVideoRewardsCents: newTestVideoRewardsCents,
      operationId,
      auditId: auditRef.id,
    };
  }

  async getSystemHealth(): Promise<AdminSystemHealth> {
    const claims = await this.verifyAdminClaims(false);
    const currentUser = auth.currentUser;

    return {
      firebaseConnected: true,
      authenticatedAdmin: currentUser?.email || 'Not logged in',
      adminUid: currentUser?.uid || 'N/A',
      isCustomClaimActive: claims.isAdminClaim,
      projectId: 'sogo-e5ea9',
      cloudinaryConfigured: true,
      cloudinaryCloudName: 'eiwwjhkq',
      cloudinaryVideoPreset: 'sogo_upload',
      secretsSecurelyHidden: true,
      appVersion: 'v2.4.0-admin',
      environment: 'production',
      rulesStatus: 'Enforcing request.auth.token.admin == true',
      timestamp: new Date().toISOString(),
    };
  }

  async getAuditLogs(limitCount: number = 50): Promise<AdminAuditLog[]> {
    try {
      const q = query(
        collection(db, 'adminAuditLogs'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      const logs: AdminAuditLog[] = [];
      snap.forEach((d) => {
        logs.push({ ...(d.data() as AdminAuditLog), id: d.id });
      });
      return logs;
    } catch (err) {
      console.warn('[AdminService] Audit logs query warning:', err);
      return [];
    }
  }

  // Convenience aliases for dashboard queries
  async getUsersList(_limitCount: number = 100): Promise<AdminUserRecord[]> {
    return this.getAllUsers();
  }

  async getVideosList(_limitCount: number = 100): Promise<AdminVideoRecord[]> {
    return this.getAllVideos();
  }

  async getPostsList(_limitCount: number = 100): Promise<AdminPostRecord[]> {
    return this.getAllPosts();
  }

  async getCreatorRewardsSummary(_limitCount: number = 100): Promise<AdminCreatorSummaryItem[]> {
    return this.getAllCreatorRewards();
  }

  async getReferralsList(_limitCount: number = 100): Promise<AdminReferralItem[]> {
    return this.getAllReferrals();
  }

  async getPayoutRequests(_limitCount: number = 100): Promise<(PayoutRequest & { user?: User })[]> {
    return this.getAllPayouts();
  }

  async getReportsList(_limitCount: number = 100): Promise<AdminReportItem[]> {
    return this.getAllReports();
  }
}

export const adminService = new AdminService();
