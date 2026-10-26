import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Save,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  AppVersionInfo,
  RemoteVersionConfig,
  DEFAULT_VERSION_CONFIG,
  getCurrentAppVersionInfo,
  fetchRemoteVersionConfig,
  saveRemoteVersionConfig,
  PLAY_STORE_URL,
} from '../../services/appVersionService';
import { useAuth } from '../../hooks/useAuth';

export const AppVersionControlCard: React.FC = () => {
  const { currentUser } = useAuth();
  const [currentAppInfo, setCurrentAppInfo] = useState<AppVersionInfo | null>(null);
  const [remoteConfig, setRemoteConfig] = useState<RemoteVersionConfig>(DEFAULT_VERSION_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Form states
  const [minVersionCode, setMinVersionCode] = useState<number>(DEFAULT_VERSION_CONFIG.minVersionCode);
  const [minVersionName, setMinVersionName] = useState<string>(DEFAULT_VERSION_CONFIG.minVersionName || '1.0');
  const [forceUpdate, setForceUpdate] = useState<boolean>(false);
  const [title, setTitle] = useState<string>(DEFAULT_VERSION_CONFIG.title);
  const [description, setDescription] = useState<string>(DEFAULT_VERSION_CONFIG.message);
  const [releaseNotes, setReleaseNotes] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [appInfo, fetchedConfig] = await Promise.all([
        getCurrentAppVersionInfo(),
        fetchRemoteVersionConfig(),
      ]);
      setCurrentAppInfo(appInfo);

      const activeConfig = fetchedConfig || DEFAULT_VERSION_CONFIG;
      setRemoteConfig(activeConfig);
      setMinVersionCode(activeConfig.minVersionCode);
      setMinVersionName(activeConfig.minVersionName || '1.0');
      setForceUpdate(Boolean(activeConfig.forceUpdate));
      setTitle(activeConfig.title || DEFAULT_VERSION_CONFIG.title);
      setDescription(activeConfig.message || DEFAULT_VERSION_CONFIG.message);
      setReleaseNotes(activeConfig.releaseNotes || '');
    } catch (err: any) {
      setMessage({
        text: err?.message || 'Failed to load remote version config from Firestore.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const parsedCode = Number(minVersionCode);
    if (isNaN(parsedCode) || parsedCode < 1) {
      setMessage({ text: 'Minimum version code must be a valid positive integer.', type: 'error' });
      setSaving(false);
      return;
    }

    try {
      await saveRemoteVersionConfig(
        {
          minVersionCode: parsedCode,
          minVersionName: minVersionName.trim() || '1.0',
          forceUpdate,
          title: title.trim(),
          message: description.trim(),
          releaseNotes: releaseNotes.trim(),
          playStoreUrl: PLAY_STORE_URL,
        },
        currentUser?.email || 'azlanmalik774@gmail.com'
      );

      setMessage({
        text: `Successfully updated /app_config/version. Minimum required build code is now ${parsedCode} (Mandatory update: ${
          forceUpdate ? 'ACTIVE' : 'INACTIVE'
        }).`,
        type: 'success',
      });
      await loadData();
    } catch (err: any) {
      setMessage({
        text: err?.message || 'Error saving version configuration to Firestore.',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const isCurrentAppOutdated =
    forceUpdate && currentAppInfo && currentAppInfo.versionCode < Number(minVersionCode);

  return (
    <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>App Version & Force Update Control</span>
              {forceUpdate ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30">
                  Enforcing Updates
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Updates Optional
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">
              Remote configuration stored in Firestore at <code className="text-cyan-300 font-mono">/app_config/version</code>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Status banner */}
      {message && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Metadata cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-medium block">Installed App Version</span>
          <div className="text-sm font-bold text-white">
            v{currentAppInfo?.versionName || '1.0'}
            <span className="ml-1.5 text-xs text-slate-400 font-mono">
              (Build {currentAppInfo?.versionCode || 13})
            </span>
          </div>
          <span className="text-[11px] text-slate-500 font-mono block truncate">
            {currentAppInfo?.packageName || 'com.sogo.social'}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-medium block">Remote Minimum Build Code</span>
          <div className="text-sm font-bold text-cyan-300">
            Build {remoteConfig.minVersionCode}
            <span className="ml-1.5 text-xs text-slate-400 font-sans">
              (v{remoteConfig.minVersionName || '1.0'})
            </span>
          </div>
          <span className="text-[11px] text-slate-500 block">
            Builds &lt; {remoteConfig.minVersionCode} are {remoteConfig.forceUpdate ? 'blocked' : 'allowed'}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-medium block">Live Simulation Status</span>
          <div className="text-sm font-bold">
            {isCurrentAppOutdated ? (
              <span className="text-rose-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Update Required for this device
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                App is up to date
              </span>
            )}
          </div>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 truncate"
          >
            <span>Google Play Store Listing</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        </div>
      </div>

      {/* Form Controls */}
      <form onSubmit={handleSave} className="space-y-4 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Minimum Required Version Code (Android <code className="text-cyan-300">versionCode</code>)
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={minVersionCode}
              onChange={(e) => setMinVersionCode(parseInt(e.target.value, 10) || 1)}
              required
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white font-mono focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Any installed app with build code lower than this number will be required to update.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Display Version Name (e.g. 1.0.1)
            </label>
            <input
              type="text"
              value={minVersionName}
              onChange={(e) => setMinVersionName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              placeholder="1.0"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              User-facing version string displayed on the update page.
            </p>
          </div>
        </div>

        {/* Force Update Toggle */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-white block">
              Enforce Mandatory Update Blocker
            </span>
            <span className="text-[11px] text-slate-400 block">
              When ON, users on builds below the minimum version code cannot enter the app until updated.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setForceUpdate(!forceUpdate)}
            className="flex items-center gap-2 cursor-pointer focus:outline-none"
          >
            {forceUpdate ? (
              <ToggleRight className="w-8 h-8 text-cyan-400" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-slate-600" />
            )}
          </button>
        </div>

        {/* Title and Message */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Update Screen Headline
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              placeholder="Update Required"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Update Screen Message
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              placeholder="A newer version of SogoSocial is required to continue..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              What's New / Release Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              placeholder="Security enhancements, bug fixes, performance improvements..."
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <Save className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
            <span>{saving ? 'Saving to Firestore...' : 'Save & Publish Version Rules'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
