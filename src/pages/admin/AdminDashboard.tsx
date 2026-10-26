import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { adminService } from '../../services/adminService';
import {
  AdminOverviewStats,
  AdminUserRecord,
  AdminVideoRecord,
  AdminPostRecord,
  AdminCreatorSummaryItem,
  AdminReferralItem,
  AdminReportItem,
  AdminAuditLog,
  AdminAnalyticsData,
} from '../../types/admin';
import { PayoutRequest, User } from '../../types';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminOverviewTab } from '../../components/admin/AdminOverviewTab';
import { AdminUsersTab } from '../../components/admin/AdminUsersTab';
import { AdminVideosTab } from '../../components/admin/AdminVideosTab';
import { AdminPostsTab } from '../../components/admin/AdminPostsTab';
import { AdminRewardsTab } from '../../components/admin/AdminRewardsTab';
import { AdminReferralsTab } from '../../components/admin/AdminReferralsTab';
import { AdminPayoutsTab } from '../../components/admin/AdminPayoutsTab';
import { AdminReportsTab } from '../../components/admin/AdminReportsTab';
import { AdminAnalyticsTab } from '../../components/admin/AdminAnalyticsTab';
import { AdminSystemTab } from '../../components/admin/AdminSystemTab';
import { AdminTestingToolsModal } from '../../components/admin/AdminTestingToolsModal';
import { registerBackInterceptor } from '../../services/backButtonService';
import { ShieldAlert, Lock, ArrowLeft, RefreshCw } from 'lucide-react';

interface AdminDashboardProps {
  onBackToApp: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBackToApp }) => {
  const { currentUser, isAdmin, isAdminClaimActive, loading: authLoading, refreshAdminStatus, syncAdminRole } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('overview');
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [refreshingToken, setRefreshingToken] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [isTestingModalOpen, setIsTestingModalOpen] = useState<boolean>(false);

  // Handle hardware Back button and in-app back inside Admin Dashboard
  useEffect(() => {
    if (!isTestingModalOpen && !focusedUserId && activeTab === 'overview') {
      return;
    }

    return registerBackInterceptor(() => {
      if (isTestingModalOpen) {
        setIsTestingModalOpen(false);
        return true;
      }
      if (focusedUserId) {
        setFocusedUserId(null);
        return true;
      }
      if (activeTab !== 'overview') {
        setActiveTab('overview');
        return true;
      }
      return false;
    });
  }, [isTestingModalOpen, focusedUserId, activeTab]);

  // Data states
  const [stats, setStats] = useState<AdminOverviewStats>({
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
  });

  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [videos, setVideos] = useState<AdminVideoRecord[]>([]);
  const [posts, setPosts] = useState<AdminPostRecord[]>([]);
  const [rewards, setRewards] = useState<AdminCreatorSummaryItem[]>([]);
  const [referrals, setReferrals] = useState<AdminReferralItem[]>([]);
  const [payouts, setPayouts] = useState<(PayoutRequest & { user?: User })[]>([]);
  const [reports, setReports] = useState<AdminReportItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalyticsData>({
    userGrowth: [],
    contentVelocity: [],
    viewMetrics: [],
    rewardDistribution: [],
  });

  const [dataLoading, setDataLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const [
        overviewRes,
        usersRes,
        videosRes,
        postsRes,
        rewardsRes,
        referralsRes,
        payoutsRes,
        reportsRes,
        auditRes,
      ] = await Promise.allSettled([
        adminService.getOverviewStats(),
        adminService.getUsersList(100),
        adminService.getVideosList(100),
        adminService.getPostsList(100),
        adminService.getCreatorRewardsSummary(100),
        adminService.getReferralsList(100),
        adminService.getPayoutRequests(100),
        adminService.getReportsList(100),
        adminService.getAuditLogs(100),
      ]);

      if (overviewRes.status === 'fulfilled') setStats(overviewRes.value);
      if (usersRes.status === 'fulfilled') {
        console.log('[AdminDashboard] usersRes FULFILLED with count:', usersRes.value.length, {
          firstUser: usersRes.value[0],
          allIds: usersRes.value.map((u) => u.id),
        });
        setUsers(usersRes.value);
      } else {
        console.error('[AdminDashboard] usersRes REJECTED with reason:', usersRes.reason);
        setLoadError(`Failed to load users: ${usersRes.reason?.message || usersRes.reason || 'Unknown error'}`);
      }
      if (videosRes.status === 'fulfilled') setVideos(videosRes.value);
      if (postsRes.status === 'fulfilled') setPosts(postsRes.value);
      if (rewardsRes.status === 'fulfilled') setRewards(rewardsRes.value);
      if (referralsRes.status === 'fulfilled') setReferrals(referralsRes.value);
      if (payoutsRes.status === 'fulfilled') setPayouts(payoutsRes.value);
      if (reportsRes.status === 'fulfilled') setReports(reportsRes.value);
      if (auditRes.status === 'fulfilled') setAuditLogs(auditRes.value);
    } catch (e: any) {
      console.error('Error fetching admin data:', e);
      setLoadError(e.message || 'Failed to fetch admin data');
    } finally {
      setDataLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      loadAdminData();
    }
  }, [isAdmin, loadAdminData]);

  // Handle Unauthorized Access (Security Boundary)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#090D16] text-white flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-400 font-medium">Verifying Administrative Credentials...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    const isTargetAdmin = currentUser?.email?.toLowerCase().trim() === 'azlanmalik774@gmail.com';

    const handleForceRefreshToken = async () => {
      setRefreshingToken(true);
      setSyncStatusMsg(null);
      try {
        await refreshAdminStatus();
        setSyncStatusMsg('ID token refreshed. Checking admin claim...');
      } catch (err: any) {
        setSyncStatusMsg(`Refresh error: ${err.message}`);
      } finally {
        setRefreshingToken(false);
      }
    };

    const handleSyncClaim = async () => {
      setRefreshingToken(true);
      setSyncStatusMsg(null);
      try {
        const res = await syncAdminRole();
        setSyncStatusMsg(res.message);
      } catch (err: any) {
        setSyncStatusMsg(`Sync error: ${err.message}`);
      } finally {
        setRefreshingToken(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#080B11] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900/90 border border-rose-500/30 text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
            <Lock className="w-7 h-7" />
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white tracking-tight">Access Restricted</h2>
            <p className="text-xs text-slate-400">
              This area is restricted exclusively to authorized SogoSocial platform administrators with verified Firebase Auth custom claims.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400 break-all text-left space-y-1.5">
            <div>Current Account: <span className="text-slate-200">{currentUser?.email || 'Guest / Not Signed In'}</span></div>
            <div>Admin Authorized: <span className="text-cyan-400 font-bold">azlanmalik774@gmail.com</span></div>
            <div>Custom Claim (admin: true): <span className={isAdminClaimActive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{isAdminClaimActive ? 'Active' : 'Not Detected in Token'}</span></div>
          </div>

          {isTargetAdmin && (
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <p className="text-xs text-amber-400 font-medium">
                Admin email recognized! If the admin custom claim was recently assigned in Firebase, force refresh your token below:
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleForceRefreshToken}
                  disabled={refreshingToken}
                  className="w-full py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshingToken ? 'animate-spin' : ''}`} />
                  <span>Force Refresh Token & Check Claim</span>
                </button>
                <button
                  type="button"
                  onClick={handleSyncClaim}
                  disabled={refreshingToken}
                  className="w-full py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span>Sync via Cloud Function</span>
                </button>
              </div>
              {syncStatusMsg && (
                <p className="text-[11px] text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-left font-mono">
                  {syncStatusMsg}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onBackToApp}
            className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to SogoSocial</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30">
      {/* Admin Header */}
      <AdminHeader
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setFocusedUserId(null);
        }}
        onBackToApp={onBackToApp}
        onRefresh={loadAdminData}
        refreshing={refreshing}
        onOpenTestingTools={() => setIsTestingModalOpen(true)}
      />

      {/* Main Tab Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {loadError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={loadAdminData}
              className="px-3 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-xs font-bold cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <AdminOverviewTab
            stats={stats}
            loading={dataLoading}
            onNavigateTab={(tab) => {
              setActiveTab(tab);
              setFocusedUserId(null);
            }}
          />
        )}

        {activeTab === 'users' && (
          <AdminUsersTab
            users={users}
            loading={dataLoading}
            onRefresh={loadAdminData}
            onSelectCreator={(userId) => {
              setFocusedUserId(userId);
              setActiveTab('rewards');
            }}
          />
        )}

        {activeTab === 'videos' && (
          <AdminVideosTab
            videos={videos}
            loading={dataLoading}
            onRefresh={loadAdminData}
          />
        )}

        {activeTab === 'posts' && (
          <AdminPostsTab
            posts={posts}
            loading={dataLoading}
            onRefresh={loadAdminData}
          />
        )}

        {activeTab === 'rewards' && (
          <AdminRewardsTab
            rewards={rewards}
            loading={dataLoading}
            onRefresh={loadAdminData}
            focusedUserId={focusedUserId}
          />
        )}

        {activeTab === 'referrals' && (
          <AdminReferralsTab
            referrals={referrals}
            loading={dataLoading}
            onRefresh={loadAdminData}
          />
        )}

        {activeTab === 'payouts' && (
          <AdminPayoutsTab
            payouts={payouts}
            loading={dataLoading}
            onRefresh={loadAdminData}
          />
        )}

        {activeTab === 'reports' && (
          <AdminReportsTab
            reports={reports}
            loading={dataLoading}
            onRefresh={loadAdminData}
          />
        )}

        {activeTab === 'analytics' && (
          <AdminAnalyticsTab
            analytics={analytics}
            loading={dataLoading}
          />
        )}

        {activeTab === 'system' && (
          <AdminSystemTab
            auditLogs={auditLogs}
            loading={dataLoading}
            onRefresh={loadAdminData}
          />
        )}
      </main>

      {/* Admin Testing Tools Console (Global Header Trigger) */}
      <AdminTestingToolsModal
        isOpen={isTestingModalOpen}
        onClose={() => setIsTestingModalOpen(false)}
        onRefresh={loadAdminData}
        users={users}
        videos={videos}
        posts={posts}
      />
    </div>
  );
};
