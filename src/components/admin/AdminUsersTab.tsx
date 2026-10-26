import React, { useState, useEffect } from 'react';
import {
  Search,
  UserX,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  BadgeCheck,
  Loader2,
  XCircle,
} from 'lucide-react';
import { AdminUserRecord } from '../../types/admin';
import { adminService } from '../../services/adminService';
import { AdminTestingToolsModal } from './AdminTestingToolsModal';
import { VerifiedBadge } from '../VerifiedBadge';
import { registerBackInterceptor } from '../../services/backButtonService';

interface AdminUsersTabProps {
  users: AdminUserRecord[];
  loading: boolean;
  onRefresh: () => void;
  onSelectCreator: (userId: string) => void;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  users,
  loading,
  onRefresh,
  onSelectCreator,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'verified' | 'active' | 'suspended' | 'disabled'
  >('all');
  const [selectedUser, setSelectedUser] = useState<AdminUserRecord | null>(null);
  const [actionModal, setActionModal] = useState<{
    user: AdminUserRecord;
    action: 'suspend' | 'unsuspend' | 'disable' | 'restore';
  } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [verifyingUserId, setVerifyingUserId] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [testingUser, setTestingUser] = useState<AdminUserRecord | null>(null);
  const [testingToolPreset, setTestingToolPreset] = useState<'followers' | 'reward'>('followers');

  // Local overrides map so verified toggles reflect immediately before parent refresh completes
  const [verifiedOverrides, setVerifiedOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Sync selectedUser if users list refreshes
    if (selectedUser) {
      const updated = users.find((u) => u.id === selectedUser.id);
      if (updated) {
        const effectiveVerified =
          verifiedOverrides[updated.id] !== undefined
            ? verifiedOverrides[updated.id]
            : Boolean(updated.isVerified);
        setSelectedUser({ ...updated, isVerified: effectiveVerified });
      }
    }
  }, [users, verifiedOverrides]);

  // Intercept back button for open modals in Admin Users
  useEffect(() => {
    if (!actionModal && !testingUser && !selectedUser) return;

    return registerBackInterceptor(() => {
      if (actionModal) {
        setActionModal(null);
        return true;
      }
      if (testingUser) {
        setTestingUser(null);
        return true;
      }
      if (selectedUser) {
        setSelectedUser(null);
        return true;
      }
      return false;
    });
  }, [actionModal, testingUser, selectedUser]);

  const handleCopyUid = (uid: string) => {
    navigator.clipboard.writeText(uid);
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 2000);
  };

  const getEffectiveVerified = (u: AdminUserRecord): boolean => {
    if (verifiedOverrides[u.id] !== undefined) {
      return verifiedOverrides[u.id];
    }
    return Boolean(u.isVerified);
  };

  const handleToggleVerification = async (user: AdminUserRecord) => {
    if (!user?.id || verifyingUserId) return;
    const currentVerified = getEffectiveVerified(user);
    const nextVerified = !currentVerified;

    setVerifyingUserId(user.id);
    setVerificationFeedback(null);

    try {
      await adminService.setUserVerification(
        user.id,
        nextVerified,
        nextVerified
          ? `Granted Blue Tick to @${user.username || user.id}`
          : `Removed Blue Tick from @${user.username || user.id}`
      );

      setVerifiedOverrides((prev) => ({ ...prev, [user.id]: nextVerified }));
      if (selectedUser?.id === user.id) {
        setSelectedUser((prev) => (prev ? { ...prev, isVerified: nextVerified } : null));
      }

      setVerificationFeedback({
        type: 'success',
        message: nextVerified
          ? `Blue Tick granted to ${user.displayName || `@${user.username}`} (@${user.username})`
          : `Blue Tick removed from ${user.displayName || `@${user.username}`} (@${user.username})`,
      });

      onRefresh();
    } catch (err: any) {
      setVerificationFeedback({
        type: 'error',
        message: err?.message || 'Failed to update Blue Tick verification status.',
      });
    } finally {
      setVerifyingUserId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      u.username?.toLowerCase().includes(term) ||
      u.displayName?.toLowerCase().includes(term) ||
      u.email?.toLowerCase().includes(term) ||
      u.id?.toLowerCase().includes(term);

    if (!matchesSearch) return false;

    const isVerified = getEffectiveVerified(u);
    if (statusFilter === 'verified') return isVerified;
    if (statusFilter === 'suspended') return Boolean(u.isSuspended);
    if (statusFilter === 'disabled') return Boolean(u.isDisabled);
    if (statusFilter === 'active') return !u.isSuspended && !u.isDisabled;
    return true;
  });

  const handleConfirmAction = async () => {
    if (!actionModal) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      await adminService.performUserModeration(
        actionModal.user.id,
        actionModal.action,
        actionReason.trim() || `Administrative ${actionModal.action}`
      );
      setActionModal(null);
      setActionReason('');
      onRefresh();
    } catch (e: any) {
      setErrorMsg(e.message || 'Action failed.');
    } finally {
      setProcessing(false);
    }
  };

  const totalVerifiedCount = users.filter((u) => getEffectiveVerified(u)).length;

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by username, display name, email, or UID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['all', 'verified', 'active', 'suspended', 'disabled'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                statusFilter === filter
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {filter === 'verified' && (
                <BadgeCheck
                  className={`w-3.5 h-3.5 ${
                    statusFilter === 'verified' ? 'text-slate-950' : 'text-[#1DA1F2]'
                  }`}
                />
              )}
              <span>{filter}</span>
              {filter === 'verified' && (
                <span
                  className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    statusFilter === 'verified'
                      ? 'bg-slate-950/20 text-slate-950'
                      : 'bg-slate-900 text-cyan-400'
                  }`}
                >
                  {totalVerifiedCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Verification Status Feedback Banner */}
      {verificationFeedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
            verificationFeedback.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {verificationFeedback.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{verificationFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setVerificationFeedback(null)}
            className="text-slate-400 hover:text-white text-xs font-bold px-2 py-0.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Users Count Summary */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          Showing <strong className="text-white">{filteredUsers.length}</strong> of{' '}
          <strong className="text-white">{users.length}</strong> users
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <VerifiedBadge isVerified={true} size="xs" />
          <span>
            Verified accounts: <strong className="text-white">{totalVerifiedCount}</strong>
          </span>
        </span>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-md">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email & Auth</th>
              <th className="px-4 py-3 text-center">Videos</th>
              <th className="px-4 py-3 text-center">Posts</th>
              <th className="px-4 py-3">Earnings</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Verification & Moderation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  Loading user records...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  No users found matching your filters.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => {
                const isAzlanAdmin =
                  user.email?.toLowerCase().trim() === 'azlanmalik774@gmail.com';
                const isVerified = getEffectiveVerified(user);
                const isTogglingVerify = verifyingUserId === user.id;

                return (
                  <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                    {/* User Identity */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            user.avatarUrl ||
                            'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'
                          }
                          alt={user.displayName}
                          className="w-9 h-9 rounded-full object-cover border border-slate-700 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white truncate max-w-[140px]">
                              {user.displayName || 'Unnamed User'}
                            </span>
                            {isVerified && (
                              <VerifiedBadge
                                userId={user.id}
                                username={user.username}
                                isVerified={true}
                                size="sm"
                              />
                            )}
                            {isAzlanAdmin && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                OWNER
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-slate-400">
                            <span>@{user.username || 'user'}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyUid(user.id)}
                              className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                              title="Copy UID"
                            >
                              {copiedUid === user.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Email & Auth */}
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-200 truncate max-w-[180px]">
                        {user.email || 'No email recorded'}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {user.id.slice(0, 14)}...
                      </div>
                    </td>

                    {/* Activity */}
                    <td className="px-4 py-3 text-center">
                      <span className="font-semibold text-white">
                        {user.uploadedVideosCount || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-semibold text-white">
                        {user.uploadedPostsCount || 0}
                      </span>
                    </td>

                    {/* Earnings */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-emerald-400">
                        ${((user.availableBalanceCents || 0) / 100).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Total: ${((user.totalEarnedCents || 0) / 100).toFixed(2)}
                      </div>
                    </td>

                    {/* Status Badges */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {user.isDisabled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            <UserX className="w-3 h-3" />
                            Disabled
                          </span>
                        ) : user.isSuspended ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            Suspended
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Check className="w-3 h-3" />
                            Active
                          </span>
                        )}

                        {isVerified && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#1DA1F2]/15 text-[#38BDF8] border border-[#1DA1F2]/35">
                            <VerifiedBadge isVerified={true} size="xs" />
                            <span>Verified</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Verification & Moderation Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {/* Grant / Remove Blue Tick Button */}
                        <button
                          type="button"
                          disabled={Boolean(verifyingUserId)}
                          onClick={() => handleToggleVerification(user)}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50 ${
                            isVerified
                              ? 'bg-[#1DA1F2]/15 text-[#38BDF8] hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30 border-[#1DA1F2]/40'
                              : 'bg-slate-800 text-sky-400 hover:bg-[#1DA1F2]/20 border-sky-500/30'
                          }`}
                          title={
                            isVerified
                              ? `Remove Blue Tick from @${user.username}`
                              : `Grant Blue Tick to @${user.username}`
                          }
                        >
                          {isTogglingVerify ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <VerifiedBadge isVerified={true} size="xs" />
                          )}
                          <span>{isVerified ? 'Unverify' : 'Verify'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setTestingToolPreset('followers');
                            setTestingUser(user);
                          }}
                          className="px-2 py-1 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1"
                          title="Admin Test Tools (Followers, Reward)"
                        >
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          <span>Test</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setSelectedUser({
                              ...user,
                              isVerified,
                            })
                          }
                          className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                        >
                          Details
                        </button>

                        {!isAzlanAdmin && (
                          <>
                            {user.isSuspended ? (
                              <button
                                type="button"
                                onClick={() => setActionModal({ user, action: 'unsuspend' })}
                                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors cursor-pointer"
                              >
                                Unsuspend
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setActionModal({ user, action: 'suspend' })}
                                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                              >
                                Suspend
                              </button>
                            )}

                            {user.isDisabled ? (
                              <button
                                type="button"
                                onClick={() => setActionModal({ user, action: 'restore' })}
                                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors cursor-pointer"
                              >
                                Restore
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setActionModal({ user, action: 'disable' })}
                                className="px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-colors cursor-pointer"
                              >
                                Disable
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* User Details Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">User Inspector</h3>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center gap-4 min-w-0">
                <img
                  src={
                    selectedUser.avatarUrl ||
                    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'
                  }
                  alt={selectedUser.displayName}
                  className="w-14 h-14 rounded-full object-cover border-2 border-cyan-500/40 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-bold text-white truncate">
                      {selectedUser.displayName}
                    </h4>
                    {getEffectiveVerified(selectedUser) && (
                      <VerifiedBadge
                        userId={selectedUser.id}
                        username={selectedUser.username}
                        isVerified={true}
                        size="sm"
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-400">@{selectedUser.username}</p>
                  <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">
                    {selectedUser.email || 'No email'}
                  </p>
                </div>
              </div>

              {/* Blue Tick Verification Control inside User Inspector */}
              <button
                type="button"
                disabled={Boolean(verifyingUserId)}
                onClick={() => handleToggleVerification(selectedUser)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50 ${
                  getEffectiveVerified(selectedUser)
                    ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border-rose-500/30'
                    : 'bg-[#1DA1F2]/20 text-[#38BDF8] hover:bg-[#1DA1F2]/30 border-[#1DA1F2]/40'
                }`}
              >
                {verifyingUserId === selectedUser.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <VerifiedBadge isVerified={true} size="xs" />
                )}
                <span>
                  {getEffectiveVerified(selectedUser)
                    ? 'Remove Blue Tick'
                    : 'Grant Blue Tick'}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">UID</span>
                <span className="font-mono text-slate-200 break-all select-all">
                  {selectedUser.id}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">Verification Status</span>
                <span className="text-slate-200 font-semibold flex items-center gap-1.5 mt-0.5">
                  {getEffectiveVerified(selectedUser) ? (
                    <>
                      <VerifiedBadge isVerified={true} size="xs" />
                      <span className="text-[#38BDF8]">Verified (Blue Tick Active)</span>
                    </>
                  ) : (
                    <span className="text-slate-400">Unverified</span>
                  )}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">Followers / Following</span>
                <span className="text-slate-200">
                  {selectedUser.followersCount || 0} / {selectedUser.followingCount || 0}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 block">Creator Available Balance</span>
                <span className="font-bold text-emerald-400">
                  ${((selectedUser.availableBalanceCents || 0) / 100).toFixed(2)}
                </span>
              </div>
            </div>

            {selectedUser.suspensionReason && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                <strong>Suspension Reason:</strong> {selectedUser.suspensionReason}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setTestingToolPreset('followers');
                  setTestingUser(selectedUser);
                }}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1.5"
                title="Open Admin Testing Tools for this user"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Test Tools</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectCreator(selectedUser.id);
                  setSelectedUser(null);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors cursor-pointer"
              >
                Inspect Creator Rewards
              </button>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Reason Modal for Moderation */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white capitalize">
                  Confirm {actionModal.action} User
                </h3>
                <p className="text-xs text-slate-400">
                  Target: @{actionModal.user.username} ({actionModal.user.displayName})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300">
              This action will take effect immediately in Firebase Auth and Firestore. All changes
              are recorded in the immutable admin audit log.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Administrative Reason (Required for audit log)
              </label>
              <textarea
                rows={3}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="e.g. Terms of Service violation, spam reports, or fraudulent views..."
                className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-xs text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setActionModal(null);
                  setErrorMsg(null);
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={handleConfirmAction}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {processing ? 'Processing...' : `Confirm ${actionModal.action.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Testing Tools Modal */}
      {testingUser && (
        <AdminTestingToolsModal
          isOpen={Boolean(testingUser)}
          onClose={() => setTestingUser(null)}
          onRefresh={onRefresh}
          initialTool={testingToolPreset}
          initialTargetType="user"
          initialTargetId={testingUser.id}
          initialTargetTitle={`@${testingUser.username || 'user'} (${
            testingUser.displayName || testingUser.id
          })`}
          users={users}
        />
      )}
    </div>
  );
};
