import React, { useState, useEffect } from 'react';
import {
  DownloadCloud,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import {
  AppVersionInfo,
  RemoteVersionConfig,
  openGooglePlayStore,
} from '../services/appVersionService';
import { registerBackInterceptor } from '../services/backButtonService';
import sogoLogo from '../assets/sogo-mark.svg';

interface ForceUpdateScreenProps {
  currentInfo: AppVersionInfo;
  remoteConfig: RemoteVersionConfig | null;
  onRecheck: () => Promise<void>;
  errorMessage?: string | null;
}

export const ForceUpdateScreen: React.FC<ForceUpdateScreenProps> = ({
  currentInfo,
  remoteConfig,
  onRecheck,
  errorMessage,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(errorMessage || null);

  useEffect(() => {
    setLocalError(errorMessage || null);
  }, [errorMessage]);

  // Intercept the Android hardware Back button to block navigation into the app
  useEffect(() => {
    const unregister = registerBackInterceptor(() => {
      // Hardware back press exits/minimizes the app rather than bypassing the force-update screen
      try {
        CapApp.exitApp();
      } catch {
        // In browser/dev, ignore
      }
      return true;
    });

    return () => {
      unregister();
    };
  }, []);

  const handleUpdateClick = () => {
    openGooglePlayStore(remoteConfig?.playStoreUrl);
  };

  const handleManualRecheck = async () => {
    setIsChecking(true);
    setLocalError(null);
    try {
      await onRecheck();
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to check update status. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleExitApp = async () => {
    try {
      await CapApp.exitApp();
    } catch {
      window.location.reload();
    }
  };

  const title = remoteConfig?.title || 'Update Required';
  const message =
    remoteConfig?.message ||
    'A newer version of SogoSocial is required to continue. Please update now from Google Play for the best performance, security, and latest features.';
  const requiredVersion =
    remoteConfig?.minVersionName || (remoteConfig?.minVersionCode ? `Build ${remoteConfig.minVersionCode}` : 'Latest');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-update-title"
      className="fixed inset-0 z-[99999] bg-[#0B0F1A] text-slate-100 flex flex-col justify-between overflow-y-auto px-6 py-10 select-none animate-in fade-in duration-200"
    >
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      {/* Top Header / App Branding */}
      <div className="flex flex-col items-center text-center pt-4">
        <div className="relative mb-4">
          <div className="w-20 h-20 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl flex items-center justify-center p-3.5 ring-4 ring-cyan-500/15">
            <img src={sogoLogo} alt="SogoSocial" className="w-full h-full object-contain drop-shadow" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center shadow-lg border-2 border-[#0B0F1A]">
            <DownloadCloud className="w-4 h-4 stroke-[2.5]" />
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-500/30 text-cyan-400 text-xs font-bold tracking-wide uppercase mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>New Version Required</span>
        </div>

        <h1 id="force-update-title" className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          {title}
        </h1>
        <p className="mt-3 text-sm text-slate-300 max-w-sm leading-relaxed mx-auto">
          {message}
        </p>
      </div>

      {/* Middle Card: Version Comparison & Release Notes */}
      <div className="my-6 max-w-sm w-full mx-auto space-y-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-md">
          <div className="grid grid-cols-2 gap-3 text-center divide-x divide-slate-800/80">
            <div className="px-2">
              <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Installed
              </span>
              <span className="block mt-1 text-sm font-bold text-slate-200">
                v{currentInfo.versionName}
              </span>
              <span className="block text-[11px] text-slate-500 font-mono">
                Build {currentInfo.versionCode}
              </span>
            </div>
            <div className="px-2">
              <span className="block text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">
                Required
              </span>
              <span className="block mt-1 text-sm font-bold text-cyan-300">
                v{requiredVersion}
              </span>
              <span className="block text-[11px] text-cyan-400/70 font-mono">
                Build {remoteConfig?.minVersionCode ?? '—'}
              </span>
            </div>
          </div>

          {remoteConfig?.releaseNotes && (
            <div className="mt-3 pt-3 border-t border-slate-800 text-left">
              <span className="block text-[11px] font-semibold text-slate-400 mb-1">
                What's new in this release:
              </span>
              <p className="text-xs text-slate-300 leading-normal line-clamp-3">
                {remoteConfig.releaseNotes}
              </p>
            </div>
          )}
        </div>

        {/* Network Error Banner with Retry */}
        {localError && (
          <div className="bg-rose-950/60 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span>{localError}</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="max-w-sm w-full mx-auto space-y-3 pb-2">
        {/* Primary Action: Update Now */}
        <button
          type="button"
          onClick={handleUpdateClick}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer"
        >
          <span>Update Now on Google Play</span>
          <ExternalLink className="w-4 h-4 stroke-[2.2]" />
        </button>

        {/* Secondary Action: Check Again */}
        <button
          type="button"
          onClick={handleManualRecheck}
          disabled={isChecking}
          className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-colors cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-cyan-400' : ''}`} />
          <span>{isChecking ? 'Checking update status...' : "I've Updated — Check Again"}</span>
        </button>

        {/* Exit App button */}
        <button
          type="button"
          onClick={handleExitApp}
          className="w-full py-2 text-center text-xs text-slate-500 hover:text-slate-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Close Application</span>
        </button>
      </div>
    </div>
  );
};
