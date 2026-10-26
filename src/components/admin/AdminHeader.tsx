import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  ArrowLeft,
  Lock,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface AdminHeaderProps {
  activeTab: string;
  onSelectTab: (tab: any) => void;
  onBackToApp: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenTestingTools?: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  activeTab,
  onSelectTab,
  onBackToApp,
  onRefresh,
  refreshing,
  onOpenTestingTools,
}) => {
  const { currentUser, isAdminClaimActive, syncAdminRole } = useAuth();
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<string | null>(null);

  const handleSyncClaim = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncAdminRole();
      setSyncMsg(res.message);
      setTimeout(() => setSyncMsg(null), 5000);
    } catch (e: any) {
      setSyncMsg(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const navItems = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'videos', label: 'Videos', icon: '🎬' },
    { id: 'posts', label: 'Posts', icon: '📝' },
    { id: 'rewards', label: 'Creator Rewards', icon: '💰' },
    { id: 'referrals', label: 'Referrals', icon: '🤝' },
    { id: 'payouts', label: 'Payouts', icon: '💳' },
    { id: 'reports', label: 'Moderation', icon: '🛡️' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
    { id: 'system', label: 'System & Health', icon: '⚙️' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0B111E]/95 backdrop-blur-md border-b border-slate-800/80">
      {/* Top Banner Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToApp}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-700/80 hover:border-slate-600 transition-colors cursor-pointer"
            title="Return to SogoSocial"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to App</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-cyan-950/30">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  SogoSocial Control Panel
                </h1>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  Admin Only
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Authoritative platform administration & moderation system
              </p>
            </div>
          </div>
        </div>

        {/* Admin Account & Token Security Pill */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-700/70 text-xs">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[11px] text-slate-300 truncate max-w-[150px] sm:max-w-[220px]">
              {currentUser?.email || 'azlanmalik774@gmail.com'}
            </span>

            {isAdminClaimActive ? (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                title="Custom Claim { admin: true } active and verified"
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Claim Active</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleSyncClaim}
                disabled={syncing}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors cursor-pointer"
                title="Click to sync custom claim { admin: true }"
              >
                <ShieldAlert className="w-3 h-3 text-amber-400" />
                <span>{syncing ? 'Syncing...' : 'Sync Admin Claim'}</span>
              </button>
            )}
          </div>

          {onOpenTestingTools && (
            <button
              type="button"
              onClick={onOpenTestingTools}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer"
              title="Open Admin Testing Tools Console"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Testing Tools</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh current dashboard data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="bg-cyan-950/80 border-b border-cyan-800/40 px-4 py-1.5 text-center text-xs text-cyan-300">
          {syncMsg}
        </div>
      )}

      {/* Horizontal Tab Navigation */}
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-slate-800/60 py-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
};
