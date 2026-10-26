import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  formatAuthError,
  getLatestGoogleAuthDiagnostics,
  GoogleAuthDiagnostics,
  getGoogleLoginDiagnostic,
  isGoogleLoginInFlight,
  subscribeGoogleLoginDiagnostic,
  clearGoogleLoginDiagnostic,
  formatGoogleLoginDiagnostic,
} from '../services/authService';
import sogoLogo from '../assets/sogo-mark.svg';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Film,
  Heart,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from 'lucide-react';

export interface LoginProps {
  onSuccess?: () => void;
  standalone?: boolean;
}

export const Login: React.FC<LoginProps> = ({
  onSuccess,
  standalone = false,
}) => {
  const { loginWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<GoogleAuthDiagnostics | null>(null);

  // TEMP DIAGNOSTIC: the global loading UI unmounts this component during login, so the
  // result is read from a persisted, token-free record rather than local component state.
  const [, setDiagTick] = useState(0);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(
    () => subscribeGoogleLoginDiagnostic(() => setDiagTick((t) => t + 1)),
    []
  );
  const googleDiag = getGoogleLoginDiagnostic();
  const showGoogleDiag =
    googleDiag !== null && googleDiag.stage !== 'success' && !isGoogleLoginInFlight();
  const googleDiagText = googleDiag ? formatGoogleLoginDiagnostic(googleDiag) : '';

  const handleCopyDiagnostic = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(googleDiagText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = googleDiagText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy failed');
      }
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  const handleGoogleSignIn = async () => {
    if (loading) return;
    setError(null);
    setCopyStatus('idle');
    setLoading(true);

    try {
      await loginWithGoogle();
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      console.error('Google Sign-In failed:', err);
      const friendlyMessage = formatAuthError(err);
      setError(friendlyMessage);
      setDiagnostics(getLatestGoogleAuthDiagnostics());
    } finally {
      setLoading(false);
    }
  };

  const containerClasses = standalone
    ? 'w-full max-w-md mx-auto p-6 bg-[#131B2E] border border-slate-800/80 rounded-2xl shadow-2xl'
    : 'w-full max-w-md mx-auto p-6 bg-[#131B2E]/90 border border-slate-800/60 rounded-2xl shadow-xl';

  return (
    <div className={containerClasses}>
      {/* Brand Header */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="relative mb-4">
          <div className="w-18 h-18 rounded-2xl bg-gradient-to-tr from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-500/30 flex items-center justify-center shadow-lg shadow-purple-500/10">
            <img
              src={sogoLogo}
              alt="SogoSocial"
              className="w-13 h-13 object-contain drop-shadow-md"
            />
          </div>
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-pink-500 ring-4 ring-[#131B2E]" />
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight mb-1.5">
          Sign In to SogoSocial
        </h1>
        <p className="text-sm text-slate-400 max-w-xs">
          Explore short video reels, post updates, and connect with creators around the world.
        </p>
      </div>

      {/* Feature Highlights */}
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 text-center flex flex-col items-center">
          <Film className="w-5 h-5 text-cyan-400 mb-1.5" />
          <span className="text-[11px] font-medium text-slate-300">Video Reels</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 text-center flex flex-col items-center">
          <Sparkles className="w-5 h-5 text-amber-400 mb-1.5" />
          <span className="text-[11px] font-medium text-slate-300">Trending</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 text-center flex flex-col items-center">
          <Heart className="w-5 h-5 text-rose-400 mb-1.5" />
          <span className="text-[11px] font-medium text-slate-300">Community</span>
        </div>
      </div>

      {/* TEMP DIAGNOSTIC: persistent Google login diagnostic (no tokens/secrets) */}
      {showGoogleDiag && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-100 text-xs">
          <p className="font-bold text-amber-300 text-sm mb-2">Google Login Diagnostic</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed select-text">
            {googleDiagText.split('\n').slice(1).join('\n')}
          </pre>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyDiagnostic}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-200 font-semibold cursor-pointer"
            >
              Copy Diagnostic
            </button>
            <button
              type="button"
              onClick={() => {
                setCopyStatus('idle');
                clearGoogleLoginDiagnostic();
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 cursor-pointer"
            >
              Hide
            </button>
            {copyStatus === 'copied' && <span className="text-emerald-400">Copied</span>}
            {copyStatus === 'failed' && (
              <span className="text-rose-400">Copy failed - select the text above</span>
            )}
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-sm flex flex-col gap-3 animate-in fade-in">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-rose-300">Sign-in notice</p>
              <p className="text-xs text-rose-200/90 mt-0.5 leading-relaxed">{error}</p>
              <div className="mt-2.5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-300 hover:text-rose-100 underline decoration-rose-500/50 underline-offset-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => setShowDiagnostics((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  <span>{showDiagnostics ? 'Hide Diagnostics' : 'Inspect Diagnostics'}</span>
                  {showDiagnostics ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Diagnostic Inspection Box */}
          {showDiagnostics && (
            <div className="mt-1 pt-3 border-t border-rose-900/40 text-[11px] font-mono text-slate-300 space-y-1.5 bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
              <div className="flex justify-between items-center text-slate-400 pb-1 border-b border-slate-800">
                <span className="font-semibold text-slate-200 font-sans">Android OAuth Diagnostics</span>
                <span className="text-[10px] text-slate-500">{new Date().toLocaleTimeString()}</span>
              </div>
              <div>
                <span className="text-slate-500">Package Name:</span>{' '}
                <span className="text-cyan-300">{diagnostics?.packageName || 'com.sogo.social'}</span>
              </div>
              <div>
                <span className="text-slate-500">Web Client ID:</span>{' '}
                <span className="text-slate-200">{diagnostics?.webClientIdMasked || '1035132864845-...apps.googleusercontent.com'}</span>
              </div>
              <div>
                <span className="text-slate-500">Configured:</span>{' '}
                <span className="text-emerald-400">Yes (.apps.googleusercontent.com)</span>
              </div>
              <div>
                <span className="text-slate-500">filterByAuthorizedAccounts:</span>{' '}
                <span className="text-emerald-400">false</span>
              </div>
              <div>
                <span className="text-slate-500">GCM Error:</span>{' '}
                <span className="text-rose-400">{diagnostics?.gcmErrorMessage || 'Code [16] Account reauth failed'}</span>
              </div>
              <div className="pt-1.5 border-t border-slate-800/60 text-[10px] leading-relaxed text-amber-300/90 font-sans">
                <strong>Important:</strong> Ensure the APK signing SHA-1 in your build matches the SHA-1 registered in Firebase / Google Cloud Console, and ensure your Google account is added to "Test users" if the OAuth consent screen is in Testing mode.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Google Sign-In Action */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full relative flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-900 font-semibold text-sm transition-all duration-150 shadow-md hover:shadow-lg disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-[#131B2E]"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 text-slate-700 animate-spin" />
              <span className="text-slate-800">Signing in with Google...</span>
            </>
          ) : (
            <>
              {/* Google multi-color G icon */}
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <p className="text-center text-xs text-slate-400 pt-1">
          Fast, secure, one-tap sign in with your Google Account
        </p>
      </div>

      {/* Terms & Privacy Notice */}
      <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
        <p className="text-xs text-slate-400 leading-relaxed">
          By signing in, you agree to SogoSocial&apos;s{' '}
          <a
            href="#terms"
            onClick={(e) => e.preventDefault()}
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href="#privacy"
            onClick={(e) => e.preventDefault()}
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Privacy Policy
          </a>.
        </p>
      </div>
    </div>
  );
};
