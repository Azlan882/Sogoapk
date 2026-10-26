import React, { useState } from 'react';
import {
  Search,
  CheckCircle,
  Clock,
  XCircle,
  TrendingUp,
  UserCheck,
  Award,
} from 'lucide-react';
import { AdminReferralItem } from '../../types/admin';

interface AdminReferralsTabProps {
  referrals: AdminReferralItem[];
  loading: boolean;
  onRefresh: () => void;
}

export const AdminReferralsTab: React.FC<AdminReferralsTabProps> = ({
  referrals,
  loading,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'qualified' | 'pending' | 'rejected'>('all');

  const filteredReferrals = referrals.filter((r) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      r.referralCode?.toLowerCase().includes(term) ||
      r.referredUsername?.toLowerCase().includes(term) ||
      r.referrerUser?.username?.toLowerCase().includes(term) ||
      r.referredUserObj?.displayName?.toLowerCase().includes(term);

    if (!matchesSearch) return false;
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  const totalReferrals = referrals.length;
  const qualifiedCount = referrals.filter((r) => r.status === 'qualified').length;
  const pendingCount = referrals.filter((r) => r.status === 'pending').length;
  const totalPaidOutCents = qualifiedCount * 50;

  return (
    <div className="space-y-4">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Total Referrals Initiated</span>
            <TrendingUp className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-2xl font-black text-white">{totalReferrals}</div>
          <span className="text-[11px] text-slate-500">Tracked signups via invite links</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Qualified Referrals</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">{qualifiedCount}</div>
          <span className="text-[11px] text-slate-500">${(totalPaidOutCents / 100).toFixed(2)} in referral bonuses granted</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Pending Qualification</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">{pendingCount}</div>
          <span className="text-[11px] text-slate-500">Awaiting referee onboarding completion</span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by code, referrer, or referee username..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(['all', 'qualified', 'pending', 'rejected'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === f
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Referrals Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-md">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Referrer</th>
              <th className="px-4 py-3">Referred User (Referee)</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Bonus</th>
              <th className="px-4 py-3">Signup Date</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  Loading referrals...
                </td>
              </tr>
            ) : filteredReferrals.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  No referral records found.
                </td>
              </tr>
            ) : (
              filteredReferrals.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-bold text-white">
                      @{item.referrerUser?.username || item.referrerId.slice(0, 10)}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {item.referrerId.slice(0, 12)}...
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-bold text-cyan-400">
                      @{item.referredUsername || item.referredUserId?.slice(0, 10)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {item.referredDisplayName || 'New Creator'}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <span className="font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 text-[11px]">
                      {item.referralCode}
                    </span>
                  </td>

                  <td className="px-4 py-3 font-semibold text-emerald-400">
                    ${((item.rewardAmountCents || 50) / 100).toFixed(2)}
                  </td>

                  <td className="px-4 py-3 text-slate-400">
                    {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A'}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {item.status === 'qualified' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle className="w-3 h-3" />
                        Qualified
                      </span>
                    ) : item.status === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        <XCircle className="w-3 h-3" />
                        Rejected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <Clock className="w-3 h-3" />
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
