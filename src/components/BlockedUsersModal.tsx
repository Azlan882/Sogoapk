import React, { useState, useEffect } from 'react';
import { UserX, X, Loader2, CheckCircle2 } from 'lucide-react';
import { BlockedUserRecord, getBlockedUsersList, unblockUser } from '../services/blockService';

interface BlockedUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BlockedUsersModal: React.FC<BlockedUsersModalProps> = ({ isOpen, onClose }) => {
  const [blockedList, setBlockedList] = useState<BlockedUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadList();
    }
  }, [isOpen]);

  const loadList = async () => {
    setLoading(true);
    try {
      const list = await getBlockedUsersList();
      setBlockedList(list);
    } finally {
      setLoading(false);
    }
  };

  const handleUnblock = async (userId: string, username?: string) => {
    setUnblockingId(userId);
    try {
      await unblockUser(userId);
      setBlockedList((prev) => prev.filter((u) => u.blockedUserId !== userId));
      setSuccessMessage(username ? `@${username} unblocked.` : 'User unblocked.');
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err: any) {
      console.error('Failed to unblock user:', err);
    } finally {
      setUnblockingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="blocked-users-modal-title"
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl relative text-slate-100 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center">
              <UserX className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h3 id="blocked-users-modal-title" className="text-base font-bold text-white">
                Blocked Accounts
              </h3>
              <p className="text-xs text-slate-400">
                {blockedList.length} {blockedList.length === 1 ? 'account' : 'accounts'} blocked
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback message */}
        {successMessage && (
          <div className="mt-3 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2 mt-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              <span className="text-xs">Loading blocked accounts...</span>
            </div>
          ) : blockedList.length === 0 ? (
            <div className="py-12 text-center space-y-2 text-slate-400">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700/80 flex items-center justify-center mx-auto text-slate-500">
                <UserX className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-300">No Blocked Accounts</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                When you block accounts, they will be listed here and you can unblock them at any time.
              </p>
            </div>
          ) : (
            blockedList.map((user) => (
              <div
                key={user.blockedUserId}
                className="flex items-center justify-between p-3 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-750 rounded-2xl transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  {user.blockedAvatarUrl ? (
                    <img
                      src={user.blockedAvatarUrl}
                      alt={user.blockedUsername || 'User'}
                      className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-700 text-slate-300 font-bold flex items-center justify-center shrink-0 text-sm">
                      {(user.blockedUsername || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {user.blockedDisplayName || user.blockedUsername || 'Sogo User'}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      @{user.blockedUsername || user.blockedUserId.slice(0, 8)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleUnblock(user.blockedUserId, user.blockedUsername)}
                  disabled={unblockingId === user.blockedUserId}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-200 hover:text-white bg-slate-700 hover:bg-slate-650 active:bg-slate-600 border border-slate-600 transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {unblockingId === user.blockedUserId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Unblock'
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
