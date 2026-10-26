import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle,
  XCircle,
  Clock,
  Filter,
  Search,
  UserX,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { AdminReportItem } from '../../types/admin';
import { adminService } from '../../services/adminService';

interface AdminReportsTabProps {
  reports: AdminReportItem[];
  loading: boolean;
  onRefresh: () => void;
}

export const AdminReportsTab: React.FC<AdminReportsTabProps> = ({
  reports,
  loading,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved' | 'dismissed'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'user' | 'video' | 'post'>('all');
  const [selectedReport, setSelectedReport] = useState<AdminReportItem | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredReports = reports.filter((r) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      r.reason?.toLowerCase().includes(term) ||
      r.targetId?.toLowerCase().includes(term) ||
      r.reporterUsername?.toLowerCase().includes(term) ||
      r.details?.toLowerCase().includes(term);

    if (!matchesSearch) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (typeFilter !== 'all' && r.targetType !== typeFilter) return false;
    return true;
  });

  const handleResolve = async (status: 'resolved' | 'dismissed') => {
    if (!selectedReport) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      await adminService.resolveReport(selectedReport.id, status, resolutionNotes);
      setSelectedReport(null);
      setResolutionNotes('');
      onRefresh();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to update report.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header filter bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search reports by reason, reporter, or target ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['all', 'pending', 'resolved', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === s
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Reports Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-md">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Violation Reason</th>
              <th className="px-4 py-3">Reporter</th>
              <th className="px-4 py-3">Reported Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  Loading reports...
                </td>
              </tr>
            ) : filteredReports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  No moderation reports found.
                </td>
              </tr>
            ) : (
              filteredReports.map((report) => (
                <tr key={report.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                      {report.targetType}
                    </span>
                    <div className="font-mono text-[10px] text-slate-500 mt-0.5">
                      {report.targetId}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{report.reason}</div>
                    {report.details && (
                      <div className="text-[11px] text-slate-400 line-clamp-1">{report.details}</div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-slate-400">
                    <div>@{report.reporterUsername || 'user'}</div>
                    <div className="text-[10px] text-slate-500">{report.reporterEmail || 'N/A'}</div>
                  </td>

                  <td className="px-4 py-3 text-slate-400">
                    {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : 'N/A'}
                  </td>

                  <td className="px-4 py-3">
                    {report.status === 'resolved' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle className="w-3 h-3" />
                        Resolved
                      </span>
                    ) : report.status === 'dismissed' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400">
                        <XCircle className="w-3 h-3" />
                        Dismissed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        <Clock className="w-3 h-3" />
                        Pending
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReport(report);
                        setResolutionNotes(report.resolutionNotes || '');
                        setErrorMsg(null);
                      }}
                      className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Review & Resolution Modal */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                <h3 className="text-sm font-bold text-white">Review Moderation Report</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="text-slate-400 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-slate-400">Violation:</div>
                <div className="text-sm font-bold text-rose-300 mt-0.5">{selectedReport.reason}</div>
                {selectedReport.details && (
                  <p className="text-slate-300 mt-1">{selectedReport.details}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Target Type</span>
                  <span className="font-bold text-white capitalize">{selectedReport.targetType}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px]">Reporter</span>
                  <span className="font-bold text-cyan-300">@{selectedReport.reporterUsername || 'user'}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Resolution Notes (Recorded in audit log)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Warning issued, content removed, or report unfounded..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-300 text-xs">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={processing}
                onClick={() => handleResolve('dismissed')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Dismiss Report
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedReport(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => handleResolve('resolved')}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer"
                >
                  {processing ? 'Saving...' : 'Mark Resolved'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
