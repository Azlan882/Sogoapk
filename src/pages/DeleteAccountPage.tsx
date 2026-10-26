import React, { useState } from 'react';
import { Trash2, AlertCircle, CheckCircle2, Shield, ArrowLeft, Loader2 } from 'lucide-react';
import { submitExternalDeletionRequest } from '../services/accountDeletionService';
import sogoLogo from '../assets/sogo-mark.svg';

export const DeleteAccountPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await submitExternalDeletionRequest({
        email,
        username,
        reason,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit account deletion request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 font-sans">
      <div className="max-w-xl w-full mx-auto py-8">
        {/* SogoSocial Branding Header */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <img src={sogoLogo} alt="SogoSocial" className="w-9 h-9" />
            <div>
              <h1 className="text-xl font-black tracking-tight text-white">SogoSocial</h1>
              <p className="text-xs text-slate-400">Account Deletion & Data Privacy Portal</p>
            </div>
          </div>
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to App</span>
          </a>
        </div>

        {/* Main Content Card */}
        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          {submitted ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-white">Deletion Request Submitted</h2>
              <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
                We have received your account deletion request for <span className="text-white font-semibold">{email}</span>.
                Your account, profile information, posts, Reels, and personal data will be purged within 48 to 72 hours.
              </p>
              <div className="pt-4">
                <a
                  href="/"
                  className="inline-block py-2.5 px-6 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                >
                  Return to Home
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center gap-3 text-rose-400">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Request Account Deletion</h2>
                  <p className="text-xs text-slate-400">
                    Submit this form if you cannot access the SogoSocial mobile app.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-800/70 border border-slate-700/80 rounded-2xl text-xs text-slate-300 space-y-2 leading-relaxed">
                <div className="flex items-center gap-2 font-bold text-slate-200">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  <span>What happens when your account is deleted?</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
                  <li>Your Firebase user profile, email, and authentication credentials are permanently deleted.</li>
                  <li>All uploaded Reels, posts, comments, likes, and follows are deleted.</li>
                  <li>Personal identifiers and device notification tokens are removed.</li>
                  <li>Completed financial transaction ledgers are retained solely as required by anti-fraud and tax regulations.</li>
                </ul>
              </div>

              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="del-email" className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Account Email Address <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="del-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter the email associated with your Sogo account"
                    className="w-full p-3 bg-slate-800/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="del-username" className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Sogo Username (Optional)
                  </label>
                  <input
                    id="del-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="@username"
                    className="w-full p-3 bg-slate-800/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="del-reason" className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Reason for Deletion (Optional)
                  </label>
                  <textarea
                    id="del-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell us why you are leaving..."
                    className="w-full p-3 bg-slate-800/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 resize-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={!email || isSubmitting}
                  className="w-full py-3.5 px-6 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting Deletion Request...</span>
                    </>
                  ) : (
                    <span>Submit Account Deletion Request</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-slate-500">
        &copy; {new Date().getFullYear()} SogoSocial. All rights reserved. Google Play Data Safety Compliance.
      </footer>
    </div>
  );
};
