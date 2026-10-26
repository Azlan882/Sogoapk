import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Award,
  Search,
  PlusCircle,
  MinusCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  ArrowDownRight,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { AdminCreatorSummaryItem } from '../../types/admin';
import { adminService } from '../../services/adminService';
import * as rewardsService from '../../services/rewardsService';
import { RewardLedgerItem } from '../../types';
import { registerBackInterceptor } from '../../services/backButtonService';
import { AdminTestingToolsModal } from './AdminTestingToolsModal';

interface AdminRewardsTabProps {
  rewards: AdminCreatorSummaryItem[];
  loading: boolean;
  onRefresh: () => void;
  focusedUserId?: string | null;
}

export const AdminRewardsTab: React.FC<AdminRewardsTabProps> = ({
  rewards,
  loading,
  onRefresh,
  focusedUserId,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [adjustModal, setAdjustModal] = useState<AdminCreatorSummaryItem | null>(null);
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
  const [adjustAmountDollars, setAdjustAmountDollars] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [ledgerModal, setLedgerModal] = useState<AdminCreatorSummaryItem | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<RewardLedgerItem[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [testingTargetItem, setTestingTargetItem] = useState<AdminCreatorSummaryItem | null>(null);

  // Intercept back button for open modals in Admin Rewards
  useEffect(() => {
    if (!adjustModal && !ledgerModal && !testingTargetItem) return;

    return registerBackInterceptor(() => {
      if (adjustModal) {
        setAdjustModal(null);
        return true;
      }
      if (ledgerModal) {
        setLedgerModal(null);
        return true;
      }
      if (testingTargetItem) {
        setTestingTargetItem(null);
        return true;
      }
      return false;
    });
  }, [adjustModal, ledgerModal, testingTargetItem]);

  // Calculate totals
  let totalAvailableCents = 0;
  let totalPendingPayoutCents = 0;
  let totalWithdrawnCents = 0;
  let totalAllTimeCents = 0;
  let totalQualifiedViews = 0;

  rewards.forEach((r) => {
    const metrics = rewardsService.getDisplayRewardsMetrics(r);
    totalAvailableCents += metrics.displayAvailableBalanceCents;
    totalPendingPayoutCents += Number(r.pendingPayoutCents) || 0;
    totalWithdrawnCents += Number(r.withdrawnAmountCents) || 0;
    totalAllTimeCents += metrics.displayTotalEarnedCents;
    totalQualifiedViews += metrics.displayQualifiedViews;
  });

  const totalOutstandingLiabilityCents = totalAvailableCents + totalPendingPayoutCents;

  const filteredRewards = rewards.filter((r) => {
    const term = (focusedUserId || searchTerm).toLowerCase().trim();
    return (
      !term ||
      r.userId?.toLowerCase().includes(term) ||
      r.user?.username?.toLowerCase().includes(term) ||
      r.user?.displayName?.toLowerCase().includes(term)
    );
  });

  const handleOpenLedger = async (item: AdminCreatorSummaryItem) => {
    setLedgerModal(item);
    setLoadingLedger(true);
    try {
      const entries = await rewardsService.getRewardLedger(item.userId);
      setLedgerEntries(entries);
    } catch (e) {
      console.warn('Failed to load ledger:', e);
      setLedgerEntries([]);
    } finally {
      setLoadingLedger(false);
    }
  };

  const handleConfirmAdjustment = async () => {
    if (!adjustModal) return;
    const amountNum = parseFloat(adjustAmountDollars);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg('Please enter a valid dollar amount greater than 0.');
      return;
    }
    if (!adjustReason.trim()) {
      setErrorMsg('Administrative reason is required.');
      return;
    }

    setProcessing(true);
    setErrorMsg(null);
    try {
      const cents = Math.round(amountNum * 100) * (adjustType === 'add' ? 1 : -1);
      await adminService.adjustCreatorReward(
        adjustModal.userId,
        cents,
        adjustReason.trim()
      );
      setAdjustModal(null);
      setAdjustAmountDollars('');
      setAdjustReason('');
      onRefresh();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to adjust reward balance.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Platform Liability Overview Card */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-[#172440] via-[#101A2E] to-[#121E36] border border-amber-500/40 shadow-xl shadow-amber-950/20">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Platform Creator Rewards Liability
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Authoritative balance reserve. All disbursements must match verified qualified video views and referrals.
            </p>
          </div>

          <div className="text-right">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Total Outstanding Liability
            </span>
            <span className="text-2xl sm:text-3xl font-black text-amber-400">
              ${(totalOutstandingLiabilityCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-slate-400 block text-[11px]">Available Balances</span>
            <span className="text-base font-bold text-emerald-400">
              ${(totalAvailableCents / 100).toFixed(2)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-slate-400 block text-[11px]">Pending Payouts</span>
            <span className="text-base font-bold text-amber-400">
              ${(totalPendingPayoutCents / 100).toFixed(2)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-slate-400 block text-[11px]">Withdrawn & Paid</span>
            <span className="text-base font-bold text-cyan-400">
              ${(totalWithdrawnCents / 100).toFixed(2)}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-slate-400 block text-[11px]">All-Time Granted</span>
            <span className="text-base font-bold text-white">
              ${(totalAllTimeCents / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search creator by username, name, or UID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        {focusedUserId && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            Clear User Focus
          </button>
        )}
      </div>

      {/* Creators Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-md">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3 text-right">Available Balance</th>
              <th className="px-4 py-3 text-right">Pending Payout</th>
              <th className="px-4 py-3 text-right">Total Earned</th>
              <th className="px-4 py-3 text-center">Qualified Views</th>
              <th className="px-4 py-3 text-right">Referral Bonuses</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  Loading creator balances...
                </td>
              </tr>
            ) : filteredRewards.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  No creator reward records found.
                </td>
              </tr>
            ) : (
              filteredRewards.map((item) => {
                const metrics = rewardsService.getDisplayRewardsMetrics(item);
                return (
                <tr key={item.userId} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={item.user?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
                        alt={item.user?.displayName}
                        className="w-8 h-8 rounded-full object-cover border border-slate-700 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate max-w-[150px]">
                          {item.user?.displayName || 'Creator'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          @{item.user?.username || item.userId.slice(0, 10)}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className="font-extrabold text-emerald-400">
                      {rewardsService.formatCentsToUsd(metrics.displayAvailableBalanceCents)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className={(item.pendingPayoutCents || 0) > 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                      {rewardsService.formatCentsToUsd(item.pendingPayoutCents || 0)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-white">
                      {rewardsService.formatCentsToUsd(metrics.displayTotalEarnedCents)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                      {metrics.displayQualifiedViews.toLocaleString()}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right text-slate-300">
                    {rewardsService.formatCentsToUsd(item.referralRewardsCents || 0)}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTestingTargetItem(item)}
                        className="px-2 py-1 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors cursor-pointer flex items-center gap-1"
                        title="Grant Staging Test Reward"
                      >
                        <Sparkles className="w-3 h-3 text-emerald-400" />
                        <span>Test</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenLedger(item)}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                      >
                        Ledger
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAdjustModal(item);
                          setErrorMsg(null);
                        }}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors cursor-pointer"
                      >
                        Adjust
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Adjust Balance Modal */}
      {adjustModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Manual Balance Adjustment</h3>
                <p className="text-xs text-slate-400">
                  Target: @{adjustModal.user?.username || adjustModal.userId}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Current Available:</span>
              <span className="font-bold text-emerald-400">
                {rewardsService.formatCentsToUsd(
                  rewardsService.getDisplayRewardsMetrics(adjustModal).displayAvailableBalanceCents
                )}{' '}
                USD
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustType('add')}
                  className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    adjustType === 'add'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Credit / Bonus</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType('subtract')}
                  className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    adjustType === 'subtract'
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <MinusCircle className="w-4 h-4" />
                  <span>Debit / Clawback</span>
                </button>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Amount in USD ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 25.00"
                  value={adjustAmountDollars}
                  onChange={(e) => setAdjustAmountDollars(e.target.value)}
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Administrative Reason (Required for Audit Log)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Promotion prize bonus, manual view reconciliation, or fraud clawback..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>
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
                  setAdjustModal(null);
                  setErrorMsg(null);
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={handleConfirmAdjustment}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
              >
                {processing ? 'Applying...' : 'Apply Balance Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ledger Modal */}
      {ledgerModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Creator Reward Ledger History</h3>
                <p className="text-xs text-slate-400">
                  Target: @{ledgerModal.user?.username || ledgerModal.userId} ({ledgerModal.user?.displayName})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLedgerModal(null)}
                className="text-slate-400 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {loadingLedger ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  Loading ledger entries...
                </div>
              ) : ledgerEntries.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No ledger transactions recorded yet for this creator.
                </div>
              ) : (
                ledgerEntries.map((entry) => {
                  const isPositive = (entry.amountCents || 0) >= 0;
                  return (
                    <div
                      key={entry.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              entry.type === 'admin_test_reward' || entry.isAdminTestData
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : entry.type === 'video_view'
                                ? 'bg-blue-500/20 text-blue-300'
                                : entry.type === 'referral'
                                ? 'bg-teal-500/20 text-teal-300'
                                : entry.type === 'payout'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-purple-500/20 text-purple-300'
                            }`}
                          >
                            {entry.type === 'admin_test_reward' ? 'TEST REWARD' : entry.type}
                          </span>
                          <span className="text-slate-200 font-medium">
                            {entry.description || 'Transaction'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 block">
                          {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'N/A'}
                        </span>
                      </div>

                      <div className="text-right">
                        <span
                          className={`font-mono font-bold ${
                            isPositive ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          ${(Math.abs(entry.amountCents || 0) / 100).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-500 block uppercase">
                          {entry.status || 'completed'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setLedgerModal(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Admin Testing Tools Modal */}
      {testingTargetItem && (
        <AdminTestingToolsModal
          isOpen={Boolean(testingTargetItem)}
          onClose={() => setTestingTargetItem(null)}
          onRefresh={onRefresh}
          initialTool="reward"
          initialTargetType="user"
          initialTargetId={testingTargetItem.userId}
          initialTargetTitle={`@${testingTargetItem.user?.username || 'creator'} (${testingTargetItem.user?.displayName || testingTargetItem.userId})`}
        />
      )}
    </div>
  );
};
