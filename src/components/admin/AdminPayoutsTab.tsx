import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  DollarSign,
  Search,
  Check,
  Send,
  Building,
  Mail,
  Smartphone,
} from 'lucide-react';
import { PayoutRequest, User } from '../../types';
import { adminService } from '../../services/adminService';
import { registerBackInterceptor } from '../../services/backButtonService';

interface AdminPayoutsTabProps {
  payouts: (PayoutRequest & { user?: User })[];
  loading: boolean;
  onRefresh: () => void;
}

export const AdminPayoutsTab: React.FC<AdminPayoutsTabProps> = ({
  payouts,
  loading,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'paid' | 'rejected'>('all');
  const [actionModal, setActionModal] = useState<{
    payout: PayoutRequest & { user?: User };
    action: 'approve' | 'reject' | 'mark_paid' | 'cancel';
  } | null>(null);

  // Close action modal on Android Back
  useEffect(() => {
    if (!actionModal) return;
    return registerBackInterceptor(() => {
      setActionModal(null);
      return true;
    });
  }, [actionModal]);
  const [actionNotes, setActionNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredPayouts = payouts.filter((p) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      p.id?.toLowerCase().includes(term) ||
      p.userId?.toLowerCase().includes(term) ||
      p.user?.username?.toLowerCase().includes(term) ||
      p.user?.displayName?.toLowerCase().includes(term) ||
      p.payoutDetails?.accountEmail?.toLowerCase().includes(term) ||
      p.payoutDetails?.accountHolderName?.toLowerCase().includes(term);

    if (!matchesSearch) return false;
    if (statusFilter === 'all') return true;
    return p.status === statusFilter;
  });

  const totalPendingCount = payouts.filter((p) => p.status === 'pending').length;
  const totalPendingAmount = payouts
    .filter((p) => p.status === 'pending')
    .reduce((acc, p) => acc + (Number(p.amountCents) || 0), 0);

  const totalPaidAmount = payouts
    .filter((p) => p.status === 'paid')
    .reduce((acc, p) => acc + (Number(p.amountCents) || 0), 0);

  const handleConfirmAction = async () => {
    if (!actionModal) return;
    if (actionModal.action === 'reject' && !rejectionReason.trim()) {
      setErrorMsg('Rejection reason is required.');
      return;
    }

    setProcessing(true);
    setErrorMsg(null);
    try {
      await adminService.processPayout(
        actionModal.payout.id,
        actionModal.action,
        actionNotes.trim() || undefined,
        rejectionReason.trim() || undefined
      );
      setActionModal(null);
      setActionNotes('');
      setRejectionReason('');
      onRefresh();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to update payout request.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Pending Payout Requests</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">{totalPendingCount}</div>
          <span className="text-[11px] text-slate-500">
            ${(totalPendingAmount / 100).toFixed(2)} USD awaiting review
          </span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Total Disbursed (Paid)</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">
            ${(totalPaidAmount / 100).toFixed(2)}
          </div>
          <span className="text-[11px] text-slate-500">Completed creator disbursements</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Payout Eligibility Rule</span>
            <DollarSign className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white">$50.00 &amp; 10 Referrals</div>
          <span className="text-[11px] text-slate-500">Min $50 USD balance + 10 successful referrals enforced</span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by payout ID, creator name, email, or account..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['all', 'pending', 'approved', 'paid', 'rejected'] as const).map((f) => (
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

      {/* Payouts Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-md">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Method & Details</th>
              <th className="px-4 py-3">Requested At</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Administrative Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  Loading payout requests...
                </td>
              </tr>
            ) : filteredPayouts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  No payout requests found.
                </td>
              </tr>
            ) : (
              filteredPayouts.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                  {/* Creator Info */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={item.user?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
                        alt={item.user?.displayName}
                        className="w-8 h-8 rounded-full object-cover border border-slate-700 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate max-w-[140px]">
                          {item.user?.displayName || 'Creator'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          @{item.user?.username || item.userId.slice(0, 10)}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3">
                    <span className="font-extrabold text-white text-sm">
                      ${((item.amountCents || 0) / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-500 block uppercase">USD</span>
                  </td>

                  {/* Method & Details */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-200 capitalize">
                      {item.payoutMethod === 'bank_transfer' ? (
                        <Building className="w-3.5 h-3.5 text-blue-400" />
                      ) : item.payoutMethod === 'venmo' ? (
                        <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                      ) : (
                        <Mail className="w-3.5 h-3.5 text-amber-400" />
                      )}
                      <span>{item.payoutMethod?.replace('_', ' ') || 'PayPal'}</span>
                    </div>

                    <div className="text-[11px] text-slate-400 truncate max-w-[200px] mt-0.5">
                      {item.payoutDetails?.accountEmail ||
                        item.payoutDetails?.accountHolderName ||
                        item.payoutDetails?.venmoHandle ||
                        'Details on file'}
                    </div>

                    {item.payoutDetails?.bankName && (
                      <div className="text-[10px] text-slate-500">
                        {item.payoutDetails.bankName} (***{item.payoutDetails.accountNumberLast4 || ''})
                      </div>
                    )}
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3 text-slate-400">
                    <div>{item.requestedAt ? new Date(item.requestedAt).toLocaleDateString() : 'N/A'}</div>
                    <div className="text-[10px] text-slate-500 font-mono">ID: {item.id.slice(0, 8)}...</div>
                  </td>

                  {/* Status Badge */}
                  <td className="px-4 py-3">
                    {item.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle className="w-3 h-3" />
                        Paid
                      </span>
                    ) : item.status === 'approved' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        <Check className="w-3 h-3" />
                        Approved
                      </span>
                    ) : item.status === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        <XCircle className="w-3 h-3" />
                        Rejected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <Clock className="w-3 h-3" />
                        Pending Review
                      </span>
                    )}
                  </td>

                  {/* Admin Actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {item.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setActionModal({ payout: item, action: 'approve' })}
                            className="px-2.5 py-1 rounded text-[11px] font-bold bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setActionModal({ payout: item, action: 'reject' })}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {item.status === 'approved' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setActionModal({ payout: item, action: 'mark_paid' })}
                            className="px-3 py-1 rounded text-[11px] font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer"
                          >
                            Mark Paid
                          </button>
                          <button
                            type="button"
                            onClick={() => setActionModal({ payout: item, action: 'cancel' })}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}

                      {item.status === 'rejected' && item.rejectionReason && (
                        <span className="text-[11px] text-slate-500 truncate max-w-[140px]" title={item.rejectionReason}>
                          {item.rejectionReason}
                        </span>
                      )}

                      {item.status === 'paid' && (
                        <span className="text-[11px] text-emerald-400 font-semibold">
                          Completed
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Payout Action Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white capitalize">
                  {actionModal.action.replace('_', ' ')} Payout Request
                </h3>
                <p className="text-xs text-slate-400">
                  Amount: ${((actionModal.payout.amountCents || 0) / 100).toFixed(2)} USD for @{actionModal.payout.user?.username || actionModal.payout.userId}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="text-slate-400">Disbursement Method: <strong className="text-white capitalize">{actionModal.payout.payoutMethod?.replace('_', ' ')}</strong></div>
              <div className="text-slate-400">Account: <strong className="text-cyan-300 font-mono">{actionModal.payout.payoutDetails?.accountEmail || actionModal.payout.payoutDetails?.accountHolderName || actionModal.payout.payoutDetails?.venmoHandle}</strong></div>
            </div>

            {actionModal.action === 'reject' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-rose-400">
                  Rejection Reason (Required - creator will see this)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Invalid PayPal email or incomplete tax/identity verification..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Administrative Notes (Optional - recorded in audit history)
              </label>
              <input
                type="text"
                placeholder="e.g. Bank transaction ID or processor confirmation reference..."
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
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
                className={`px-4 py-2 rounded-lg text-xs font-bold text-slate-950 transition-colors cursor-pointer disabled:opacity-50 ${
                  actionModal.action === 'reject'
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-cyan-400 hover:bg-cyan-300'
                }`}
              >
                {processing ? 'Processing...' : `Confirm ${actionModal.action.replace('_', ' ').toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
