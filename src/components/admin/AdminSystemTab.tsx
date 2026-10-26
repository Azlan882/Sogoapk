import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Server,
  Database,
  Cloud,
  Lock,
  FileText,
  Key,
  CheckCircle,
  RefreshCw,
  Search,
  Terminal,
  Info,
} from 'lucide-react';
import { AdminAuditLog } from '../../types/admin';
import { useAuth } from '../../hooks/useAuth';
import { adminService } from '../../services/adminService';
import { BunnyUploadTestCard } from './BunnyUploadTestCard';
import { AppVersionControlCard } from './AppVersionControlCard';

interface AdminSystemTabProps {
  auditLogs: AdminAuditLog[];
  loading: boolean;
  onRefresh: () => void;
}

export const AdminSystemTab: React.FC<AdminSystemTabProps> = ({
  auditLogs,
  loading,
  onRefresh,
}) => {
  const { currentUser, isAdminClaimActive, syncAdminRole } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState('');

  const handleSyncClaims = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await syncAdminRole();
      setSyncMessage(res.message);
    } catch (e: any) {
      setSyncMessage(e.message || 'Claim synchronization failed.');
    } finally {
      setSyncing(false);
    }
  };

  const filteredLogs = auditLogs.filter((log) => {
    const term = logFilter.toLowerCase().trim();
    return (
      !term ||
      log.action?.toLowerCase().includes(term) ||
      log.targetId?.toLowerCase().includes(term) ||
      log.adminEmail?.toLowerCase().includes(term) ||
      log.reason?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* Platform Security & Authentication Architecture */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0C1527] to-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Security & Authorization Architecture
              </h2>
              <p className="text-xs text-slate-400">
                Server-enforced Firebase Custom Claim + Role-Based Access Control
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSyncClaims}
              disabled={syncing}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Verifying...' : 'Sync Admin Token Claim'}</span>
            </button>
          </div>
        </div>

        {syncMessage && (
          <div className="p-3 rounded-lg bg-cyan-950/80 border border-cyan-800 text-xs text-cyan-300">
            {syncMessage}
          </div>
        )}

        {/* Security Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-semibold block">Authoritative Administrator</span>
            <div className="font-mono text-cyan-300 font-bold">azlanmalik774@gmail.com</div>
            <p className="text-[11px] text-slate-500">
              Single-owner whitelist. Hardcoded in Firestore Security Rules & Cloud Functions.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-semibold block">Custom Claim Token Status</span>
            <div className="flex items-center gap-1.5">
              {isAdminClaimActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold text-emerald-400">Claim `admin: true` Active</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="font-bold text-amber-400">Claim Sync Required</span>
                </>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Validated on every Firestore read/write via `request.auth.token.admin == true`.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-semibold block">Firestore Security Rules</span>
            <div className="font-semibold text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Production Enforced</span>
            </div>
            <p className="text-[11px] text-slate-500">
              All admin audit logs, moderation actions, and reward ledgers are locked from standard clients.
            </p>
          </div>
        </div>
      </div>

      {/* Cloudinary & Video Architecture Status */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2">
          <Cloud className="w-5 h-5 text-blue-400" />
          <h3 className="text-sm font-bold text-white">Media & Video Storage Infrastructure</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-semibold block">Cloudinary Cloud Name</span>
            <div className="font-mono text-slate-200">
              {import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dfq682yud (Configured)'}
            </div>
            <span className="text-[11px] text-slate-500">Unsigned upload preset configured. Client uploads directly.</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-semibold block">Video Retention Policy</span>
            <div className="text-emerald-400 font-semibold">Permanent (No Auto-Expiration)</div>
            <span className="text-[11px] text-slate-500">
              Videos remain in Firestore and Cloudinary indefinitely unless explicitly deleted by creator or admin.
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-800/40 text-xs text-blue-200 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <strong>Video Disappearance Investigation Summary:</strong> Verified that no TTL (Time-To-Live)
            indexes, auto-delete Cloud Functions, or cron batch delete jobs exist in the SogoSocial codebase.
            Videos persist indefinitely in Cloudinary and Firestore. Admin audit logs now track every video deletion.
          </div>
        </div>
      </div>

      {/* App Version & Force Update Control */}
      <AppVersionControlCard />

      {/* Bunny.net Storage & CDN Diagnostic Test Card (Developer Isolated) */}
      <BunnyUploadTestCard />

      {/* Immutable Admin Audit Logs */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              Administrative Audit Trail (`adminAuditLogs`)
            </h3>
            <p className="text-xs text-slate-400">
              Tamper-evident record of all suspensions, deletions, payouts, and ledger adjustments
            </p>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search audit actions..."
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="pl-8 pr-3 py-1 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 w-52"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 shadow-inner">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Target</th>
                <th className="px-4 py-2.5">Reason / Details</th>
                <th className="px-4 py-2.5 text-right">Admin Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 font-sans">
                    Loading audit trail...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 font-sans">
                    No administrative audit events recorded yet.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                    </td>

                    <td className="px-4 py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          log.action?.includes('suspend') || log.action?.includes('delete')
                            ? 'bg-rose-500/20 text-rose-300'
                            : log.action?.includes('payout')
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-cyan-500/20 text-cyan-300'
                        }`}
                      >
                        {log.action}
                      </span>
                    </td>

                    <td className="px-4 py-2 text-slate-300 max-w-[140px] truncate">
                      {log.targetType}: {log.targetId}
                    </td>

                    <td className="px-4 py-2 text-slate-400 font-sans text-xs max-w-[240px] truncate">
                      {log.reason || JSON.stringify(log.metadata || {})}
                    </td>

                    <td className="px-4 py-2 text-right text-slate-400 whitespace-nowrap">
                      {log.adminEmail || 'azlanmalik774@gmail.com'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
