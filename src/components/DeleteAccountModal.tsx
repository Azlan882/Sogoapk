import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { deleteUserAccount } from '../services/accountDeletionService';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeletedSuccess: () => void;
}

export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
  isOpen,
  onClose,
  onDeletedSuccess,
}) => {
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isConfirmed = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    if (!isConfirmed || isDeleting) return;

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await deleteUserAccount((step) => {
        setCurrentStep(step);
      });
      onDeletedSuccess();
    } catch (err: any) {
      console.error('[DeleteAccountModal] Deletion error:', err);
      setErrorMessage(
        err?.message ||
          'Failed to complete account deletion. If your login has expired, please re-sign in and try again.'
      );
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-rose-900/40 rounded-3xl p-6 shadow-2xl relative text-slate-100 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        {!isDeleting && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Header Icon */}
        <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
          <Trash2 className="w-7 h-7" />
        </div>

        {/* Title & Warning */}
        <div className="text-center space-y-2">
          <h3 id="delete-account-title" className="text-lg font-bold text-white">
            Permanently Delete Account?
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            This action is permanent and cannot be undone. All your posts, Reels, profile information, comments, and personal data will be completely deleted.
          </p>
        </div>

        {/* Data Retention Notice */}
        <div className="p-3 bg-slate-800/80 border border-slate-750 rounded-xl text-xs text-slate-400 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Data Retention Notice</span>
          </div>
          <p className="leading-normal">
            Non-personal financial audit records (such as completed payout ledgers and transaction IDs) are retained solely to comply with applicable tax, accounting, and anti-fraud regulations.
          </p>
        </div>

        {/* Error Feedback */}
        {errorMessage && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        {/* Progress Display */}
        {isDeleting ? (
          <div className="py-6 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-rose-500 mx-auto" />
            <p className="text-sm font-semibold text-white">
              {currentStep || 'Processing account deletion...'}
            </p>
            <p className="text-xs text-slate-400">Please do not close the app.</p>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label htmlFor="confirm-delete-input" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                To confirm, type <span className="text-rose-400 font-bold">DELETE</span> below:
              </label>
              <input
                id="confirm-delete-input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className="w-full p-3 bg-slate-800/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono tracking-wider text-center"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!isConfirmed}
                className="flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Account</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
