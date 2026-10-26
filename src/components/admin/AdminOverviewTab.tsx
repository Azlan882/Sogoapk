import React from 'react';
import {
  Users,
  Video,
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  AlertCircle,
  Eye,
  Award,
  CreditCard,
  UserCheck,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';
import { AdminOverviewStats } from '../../types/admin';

interface AdminOverviewTabProps {
  stats: AdminOverviewStats;
  loading: boolean;
  onNavigateTab: (tab: string) => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  stats,
  loading,
  onNavigateTab,
}) => {
  const formatUsd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const metricCards = [
    {
      title: 'Total Users',
      value: stats.totalUsers.toLocaleString(),
      subtext: `+${stats.newUsersToday} joined today`,
      icon: Users,
      color: 'from-blue-500/20 to-cyan-500/20',
      border: 'border-blue-500/30',
      text: 'text-blue-400',
      tab: 'users',
    },
    {
      title: 'Active Accounts',
      value: stats.activeUsers.toLocaleString(),
      subtext: `${stats.totalUsers ? Math.round((stats.activeUsers / stats.totalUsers) * 100) : 0}% onboarded/active`,
      icon: UserCheck,
      color: 'from-emerald-500/20 to-teal-500/20',
      border: 'border-emerald-500/30',
      text: 'text-emerald-400',
      tab: 'users',
    },
    {
      title: 'Total Videos',
      value: stats.totalVideos.toLocaleString(),
      subtext: `+${stats.videosUploadedToday} uploaded today`,
      icon: Video,
      color: 'from-purple-500/20 to-indigo-500/20',
      border: 'border-purple-500/30',
      text: 'text-purple-400',
      tab: 'videos',
    },
    {
      title: 'Total Posts',
      value: stats.totalPosts.toLocaleString(),
      subtext: 'Feed photo & text publications',
      icon: FileText,
      color: 'from-pink-500/20 to-rose-500/20',
      border: 'border-pink-500/30',
      text: 'text-pink-400',
      tab: 'posts',
    },
    {
      title: 'Total Video Views',
      value: stats.totalVideoViews.toLocaleString(),
      subtext: 'Cumulative reel plays',
      icon: Eye,
      color: 'from-sky-500/20 to-blue-500/20',
      border: 'border-sky-500/30',
      text: 'text-sky-400',
      tab: 'videos',
    },
    {
      title: 'Qualified Reward Views',
      value: stats.qualifiedRewardViews.toLocaleString(),
      subtext: 'Passed fraud & 5s view limits',
      icon: Award,
      color: 'from-amber-500/20 to-yellow-500/20',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
      tab: 'rewards',
    },
    {
      title: 'Creator Rewards Granted',
      value: formatUsd(stats.totalCreatorRewardsCents),
      subtext: 'All-time rewards earned by creators',
      icon: DollarSign,
      color: 'from-emerald-500/20 to-green-500/20',
      border: 'border-emerald-500/30',
      text: 'text-emerald-400',
      tab: 'rewards',
    },
    {
      title: 'Referral Rewards Paid',
      value: formatUsd(stats.totalReferralRewardsCents),
      subtext: '$0.10 per qualified referral',
      icon: TrendingUp,
      color: 'from-teal-500/20 to-emerald-500/20',
      border: 'border-teal-500/30',
      text: 'text-teal-400',
      tab: 'referrals',
    },
    {
      title: 'Pending Payouts',
      value: stats.pendingPayoutsCount.toString(),
      subtext: `${formatUsd(stats.totalPayoutAmountPendingCents)} awaiting approval`,
      icon: Clock,
      color: stats.pendingPayoutsCount > 0 ? 'from-amber-500/25 to-rose-500/25' : 'from-slate-800 to-slate-800',
      border: stats.pendingPayoutsCount > 0 ? 'border-amber-500/50' : 'border-slate-800',
      text: stats.pendingPayoutsCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400',
      tab: 'payouts',
    },
    {
      title: 'Total Platform Liability',
      value: formatUsd(stats.totalRewardLiabilityCents),
      subtext: 'Available balances + pending payouts',
      icon: CreditCard,
      color: 'from-rose-500/20 to-orange-500/20',
      border: 'border-rose-500/30',
      text: 'text-rose-400',
      tab: 'rewards',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Platform Liability & Action Alert */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-[#121E36] via-[#0E172A] to-[#121B2F] border border-cyan-500/30 shadow-xl shadow-cyan-950/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              SogoSocial System Real-Time Health
            </h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Operational
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl">
            Live database synchronizer running. Authentication custom claim rules active.
            All creator rewards and payout transitions are auditable and server-authoritative.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {stats.pendingPayoutsCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigateTab('payouts')}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-amber-950/30"
            >
              <AlertCircle className="w-4 h-4" />
              <span>Review {stats.pendingPayoutsCount} Payouts</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigateTab('reports')}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer flex items-center gap-1.5"
          >
            <span>Moderation Center</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {metricCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigateTab(card.tab)}
              className={`p-4 rounded-xl bg-gradient-to-br ${card.color} border ${card.border} hover:scale-[1.02] transition-all cursor-pointer group shadow-sm`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-300">{card.title}</span>
                <div className={`p-1.5 rounded-lg bg-slate-900/60 ${card.text}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {loading ? '...' : card.value}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span>{card.subtext}</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Access Workflows */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          onClick={() => onNavigateTab('users')}
          className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <Users className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">User Directory & Status</h3>
          </div>
          <p className="text-xs text-slate-400">
            Search users, inspect verified emails, inspect video/post counts, manage suspensions, and disable compromised accounts.
          </p>
        </div>

        <div
          onClick={() => onNavigateTab('rewards')}
          className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Creator Rewards Liability</h3>
          </div>
          <p className="text-xs text-slate-400">
            View full platform balance liability, inspect individual creator balances, view qualified views, and make auditable balance adjustments.
          </p>
        </div>

        <div
          onClick={() => onNavigateTab('system')}
          className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Security & System Health</h3>
          </div>
          <p className="text-xs text-slate-400">
            Verify Firebase custom claims, inspect Cloudinary settings (with API secrets secured), view Firestore rules status, and inspect recent audit logs.
          </p>
        </div>
      </div>
    </div>
  );
};
