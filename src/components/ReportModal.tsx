import React, { useState } from 'react';
import { Flag, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { REPORT_REASONS, ReportReason, submitReport } from '../services/reportsService';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'post' | 'video';
  targetId: string;
  targetAuthorId: string;
  targetAuthorUsername?: string;
  targetTitleOrCaption?: string;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetAuthorId,
  targetAuthorUsername,
  targetTitleOrCaption,
}) => {
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReason || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await submitReport({
        targetType,
        targetId,
        targetAuthorId,
        targetAuthorUsername,
        targetTitleOrCaption,
        reason: selectedReason,
        details,
      });

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSelectedReason(null);
        setDetails('');
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    if (isSubmitting) return;
    setSuccess(false);
    setErrorMessage(null);
    setSelectedReason(null);
    setDetails('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={handleModalClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl relative text-slate-100 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={handleModalClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 active:bg-slate-700 transition-colors cursor-pointer"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        {success ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-white">Report Submitted</h3>
            <p className="text-sm text-slate-300 max-w-xs mx-auto">
              Thank you for keeping SogoSocial safe. Our moderation team will review this content promptly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 pb-2 border-b border-slate-800">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <Flag className="w-5 h-5" />
              </div>
              <div>
                <h3 id="report-modal-title" className="text-base font-bold text-white">
                  Report {targetType === 'video' ? 'Reel' : 'Post'}
                </h3>
                <p className="text-xs text-slate-400">
                  {targetAuthorUsername ? `@${targetAuthorUsername}` : 'Select a violation reason'}
                </p>
              </div>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Reason Options */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Why are you reporting this?
              </label>
              <div className="space-y-1.5 mt-1 max-h-52 overflow-y-auto pr-1">
                {REPORT_REASONS.map((reason) => {
                  const isSelected = selectedReason === reason;
                  return (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setSelectedReason(reason)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-between cursor-pointer border ${
                        isSelected
                          ? 'report-reason-selected bg-rose-500/20 border-rose-500 text-rose-300 shadow-xs'
                          : 'report-reason-unselected bg-slate-800/80 hover:bg-slate-800 border-slate-700/80 text-slate-200'
                      }`}
                    >
                      <span className="truncate pr-2">{reason}</span>
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ml-2 transition-colors ${
                          isSelected
                            ? 'border-rose-500 bg-rose-500'
                            : 'border-slate-500 bg-slate-900 report-radio-unselected'
                        }`}
                      >
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Additional Details */}
            <div className="space-y-1.5">
              <label htmlFor="report-details" className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Additional Details (Optional)
              </label>
              <textarea
                id="report-details"
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Provide any additional context for moderators..."
                maxLength={1000}
                className="w-full p-3 bg-slate-800/80 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 resize-none transition-colors"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={handleModalClose}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 border border-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!selectedReason || isSubmitting}
                className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-rose-600/20 flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Submit Report</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
