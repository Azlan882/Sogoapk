import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/Button';
import { VerifiedBadge } from '../components/VerifiedBadge';
import {
  Shield,
  Bell,
  Eye,
  LogOut,
  ChevronRight,
  ArrowLeft,
  Moon,
  HelpCircle,
  Sparkles,
  ShieldAlert,
  UserX,
  Trash2,
} from 'lucide-react';
import { BlockedUsersModal } from '../components/BlockedUsersModal';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import { BunnyUploadTestCard } from '../components/admin/BunnyUploadTestCard';

export interface SettingsProps {
  onBack: () => void;
  onOpenPrivacy: () => void;
  onLogout: () => void;
  onOpenCreatorRewards?: () => void;
  onOpenAdminDashboard?: () => void;
}

export type AppTheme = 'sleek-dark' | 'lively-light';

const THEME_STORAGE_KEY = 'sogo_theme';

function getSavedTheme(): AppTheme {
  if (typeof window === 'undefined') return 'lively-light';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'lively-light' || saved === 'sleek-dark') {
      return saved;
    }
  } catch {}
  return 'lively-light';
}

function applyAppTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

// Initialize persisted theme immediately when app loads
applyAppTheme(getSavedTheme());

export const Settings: React.FC<SettingsProps> = ({
  onBack,
  onOpenPrivacy,
  onLogout,
  onOpenCreatorRewards,
  onOpenAdminDashboard,
}) => {
  const { currentUser, isAdmin } = useAuth();
  const [theme, setTheme] = useState<AppTheme>(() => getSavedTheme());
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const handleThemeSelect = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {}
    applyAppTheme(nextTheme);
  };

  return (
    <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 sm:p-8 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
        <button
          type="button"
          onClick={onBack}
          className="p-2 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-colors focus:outline-none"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </div>

      {/* Account Info Card */}
      {currentUser && (
        <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={currentUser.avatarUrl}
              alt={currentUser.displayName}
              className="w-12 h-12 rounded-full object-cover border border-cyan-400/40"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-sm text-white">{currentUser.displayName}</p>
                <VerifiedBadge
                  userId={currentUser.id}
                  username={currentUser.username}
                  isVerified={currentUser.isVerified}
                  size="sm"
                />
              </div>
              <p className="text-xs text-slate-400">{currentUser.email || `@${currentUser.username}`}</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold bg-cyan-950/60 text-cyan-400 border border-cyan-800/40 px-2.5 py-1 rounded-full">
            Active
          </span>
        </div>
      )}

      {/* Preferences Section */}
      <div className="space-y-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 px-1">
          Preferences & Security
        </h3>

        <button
          type="button"
          onClick={onOpenPrivacy}
          className="w-full flex items-center justify-between p-3.5 hover:bg-slate-800/80 rounded-xl transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Privacy & Security</p>
              <p className="text-xs text-slate-400">Account visibility, permissions</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>

        <button
          type="button"
          id="settings-blocked-accounts-btn"
          onClick={() => setIsBlockedModalOpen(true)}
          className="w-full flex items-center justify-between p-3.5 hover:bg-slate-800/80 rounded-xl transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <UserX className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Blocked Accounts</p>
              <p className="text-xs text-slate-400">View and unblock restricted accounts</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>

        <div className="w-full flex items-center justify-between p-3.5 hover:bg-slate-800/80 rounded-xl transition-colors">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Push Notifications</p>
              <p className="text-xs text-slate-400">Likes, comments, and story mentions</p>
            </div>
          </div>
          <input
            type="checkbox"
            defaultChecked
            className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
          />
        </div>

        <div className="w-full flex items-center justify-between p-3.5 hover:bg-slate-800/80 rounded-xl transition-colors">
          <div className="flex items-center gap-3">
            <Eye className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Activity Status</p>
              <p className="text-xs text-slate-400">Show when you are active on SogoSocial</p>
            </div>
          </div>
          <input
            type="checkbox"
            defaultChecked
            className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
          />
        </div>

        <div className="w-full flex items-center justify-between gap-3 p-3.5 hover:bg-slate-800/80 rounded-xl transition-colors">
          <div className="flex items-center gap-3">
            <Moon className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Theme Mode</p>
              <p className="text-xs text-slate-400">
                {theme === 'lively-light' ? 'Lively Interface (Light)' : 'Sleek Interface (Dark)'}
              </p>
            </div>
          </div>
          <div
            role="group"
            aria-label="Theme Mode"
            className="inline-flex items-center gap-1 p-1 bg-slate-950/70 border border-slate-800 rounded-lg shrink-0"
          >
            <button
              type="button"
              onClick={() => handleThemeSelect('lively-light')}
              aria-pressed={theme === 'lively-light'}
              className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                theme === 'lively-light'
                  ? 'text-cyan-400 bg-slate-800 border border-slate-700 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Lively Light
            </button>
            <button
              type="button"
              onClick={() => handleThemeSelect('sleek-dark')}
              aria-pressed={theme === 'sleek-dark'}
              className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                theme === 'sleek-dark'
                  ? 'text-cyan-400 bg-slate-800 border border-slate-700 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Sleek Dark
            </button>
          </div>
        </div>
      </div>

      {/* Creator Rewards Program */}
      <div className="space-y-1 pt-2 border-t border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 px-1">
          Monetization & Rewards
        </h3>

        <button
          type="button"
          onClick={onOpenCreatorRewards}
          className="w-full flex items-center justify-between p-3.5 bg-gradient-to-r from-amber-950/30 via-slate-800/80 to-slate-800/80 hover:bg-slate-800 border border-amber-500/30 hover:border-amber-500/50 rounded-xl transition-all text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                  Creator Rewards Program
                </p>
                <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">
                  $0.50 / 1k views
                </span>
              </div>
              <p className="text-xs text-slate-400">View earnings, qualified views, referrals, and withdraw</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* SogoSocial Admin Control Panel (Restricted to Administrator azlanmalik774@gmail.com) */}
      {isAdmin && (
        <div className="space-y-1 pt-2 border-t border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 mb-2 px-1 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Administrative Control</span>
          </h3>

          <button
            type="button"
            onClick={onOpenAdminDashboard}
            className="w-full flex items-center justify-between p-3.5 bg-gradient-to-r from-rose-950/40 via-slate-800/80 to-slate-800/80 hover:bg-slate-800 border border-rose-500/40 hover:border-rose-500/60 rounded-xl transition-all text-left group cursor-pointer shadow-md"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white group-hover:text-rose-300 transition-colors">
                    Admin Control Panel
                  </p>
                  <span className="text-[10px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.5 rounded">
                    Owner
                  </span>
                </div>
                <p className="text-xs text-slate-400">Users, Videos, Payouts, Ledger adjustments & Moderation</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {/* Temporary Development-Only Media Upload Diagnostic (Never rendered in production builds) */}
      {import.meta.env.DEV && currentUser && (
        <div className="space-y-1 pt-2 border-t border-slate-800">
          <BunnyUploadTestCard />
        </div>
      )}

      {/* Support & About */}
      <div className="space-y-1 pt-2 border-t border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 px-1">
          About
        </h3>

        <div className="flex items-center justify-between p-3.5 text-slate-300">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-5 h-5 text-slate-400" />
            <span className="text-sm font-medium">SogoSocial Platform Version</span>
          </div>
          <span className="text-xs font-semibold text-slate-500">v1.2.0</span>
        </div>
      </div>

      {/* Account Deletion */}
      <div className="space-y-2 pt-2 border-t border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 mb-2 px-1 flex items-center gap-1.5">
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Account Management</span>
        </h3>

        <button
          type="button"
          id="settings-delete-account-btn"
          onClick={() => setIsDeleteModalOpen(true)}
          className="w-full flex items-center justify-between p-3.5 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40 hover:border-rose-800/60 rounded-xl transition-colors text-left group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Trash2 className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-rose-400 group-hover:text-rose-300 transition-colors">
                Delete Account
              </p>
              <p className="text-xs text-slate-400">
                Permanently delete your profile, posts, Reels, and personal data
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* Logout */}
      <div className="pt-4 border-t border-slate-800">
        <Button
          variant="outline"
          size="md"
          leftIcon={<LogOut className="w-4 h-4 text-rose-400" />}
          onClick={onLogout}
          className="w-full text-rose-400 hover:bg-rose-950/30 border-rose-900/60"
        >
          Sign Out of SogoSocial
        </Button>
      </div>

      {/* Modals */}
      <BlockedUsersModal
        isOpen={isBlockedModalOpen}
        onClose={() => setIsBlockedModalOpen(false)}
      />

      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onDeletedSuccess={() => {
          setIsDeleteModalOpen(false);
          onLogout();
        }}
      />
    </div>
  );
};
