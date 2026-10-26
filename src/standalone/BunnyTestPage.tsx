import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  FileImage,
  Shield,
  ShieldAlert,
  ShieldCheck,
  LogIn,
  LogOut,
  User as UserIcon,
  Globe,
  Radio,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

interface CorsCheckResult {
  origin: string;
  status: 'checking' | 'allowed' | 'forbidden' | 'error';
  httpCode?: number;
  allowOriginHeader?: string | null;
  message?: string;
}

interface WorkerHealthResult {
  status: 'checking' | 'running' | 'unreachable';
  httpCode?: number;
  data?: any;
}

export const BunnyTestPage: React.FC = () => {
  const workerBaseUrl =
    'https://sogosocial-bunny-test.malikqayyum882.workers.dev';

  // Optional Firebase diagnostics. Firebase tokens do not authorize this test upload.
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Enter the test Worker token at runtime; never hardcode it in this file.
  const [testUploadToken, setTestUploadToken] = useState('');

  const [workerHealth, setWorkerHealth] =
    useState<WorkerHealthResult>({ status: 'checking' });
  const [currentOriginCors, setCurrentOriginCors] =
    useState<CorsCheckResult>({
      origin: typeof window !== 'undefined'
        ? window.location.origin
        : 'unknown',
      status: 'checking',
    });
  const [isCheckingCors, setIsCheckingCors] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    httpStatus: number | null;
    httpStatusText: string;
    latencyMs: number | null;
    rawResponse: string | null;
    parsedJson: any | null;
    cdnUrl: string | null;
    error: string | null;
    corsBlocked: boolean;
  } | null>(null);
  const [cdnUrlCopied, setCdnUrlCopied] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        try {
          setIdToken(await currentUser.getIdToken());
        } catch (e: any) {
          setAuthError(e?.message || 'Failed to fetch Firebase ID token');
        }
      } else {
        setIdToken(null);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    void checkWorkerHealthAndCors();
  }, []);

  const checkWorkerHealthAndCors = async () => {
    setIsCheckingCors(true);

    try {
      const res = await fetch(`${workerBaseUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);

      setWorkerHealth({
        status: res.ok ? 'running' : 'unreachable',
        httpCode: res.status,
        data,
      });
    } catch {
      setWorkerHealth({ status: 'unreachable', httpCode: 0 });
    }

    const currentOrigin =
      typeof window !== 'undefined' ? window.location.origin : 'unknown';

    try {
      const res = await fetch(`${workerBaseUrl}/upload`, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });

      const allowHeader = res.headers.get('access-control-allow-origin');

      setCurrentOriginCors({
        origin: currentOrigin,
        status: res.status === 204 || res.status === 200
          ? 'allowed'
          : 'forbidden',
        httpCode: res.status,
        allowOriginHeader: allowHeader,
        message: res.status === 204 || res.status === 200
          ? `Preflight responded HTTP ${res.status}.`
          : `Preflight returned HTTP ${res.status}.`,
      });
    } catch (err: any) {
      setCurrentOriginCors({
        origin: currentOrigin,
        status: 'error',
        httpCode: 0,
        message: `Browser could not read the preflight response: ${
          err?.message || 'Network error'
        }`,
      });
    }

    setIsCheckingCors(false);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      setIdToken(await cred.user.getIdToken(true));
    } catch (err: any) {
      setAuthError(err?.message || 'Google sign-in failed');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setIdToken(null);
      setSelectedFile(null);

      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }

      setLocalPreviewUrl(null);
      setUploadResult(null);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to sign out');
    }
  };

  const handleRefreshToken = async () => {
    if (!auth.currentUser) return;

    try {
      setAuthError(null);
      setIdToken(await auth.currentUser.getIdToken(true));
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to refresh token');
    }
  };

  const handleCopyToken = async () => {
    if (!idToken) return;

    try {
      await navigator.clipboard.writeText(idToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = idToken;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setValidationError(null);
    setUploadResult(null);
    setCdnUrlCopied(false);

    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ];
    const mime = file.type?.toLowerCase().trim() || '';

    if (!allowed.includes(mime)) {
      setValidationError(
        `Unsupported file type "${file.type || 'unknown'}". Allowed: JPEG, PNG, WebP, GIF.`,
      );
      setSelectedFile(null);

      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);

      setLocalPreviewUrl(null);
      setImageDimensions(null);
      return;
    }

    const maxBytes = 5 * 1024 * 1024;

    if (file.size > maxBytes) {
      setValidationError(
        `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 5 MB limit.`,
      );
      setSelectedFile(null);

      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);

      setLocalPreviewUrl(null);
      setImageDimensions(null);
      return;
    }

    setSelectedFile(file);

    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);

    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objectUrl);

    const img = new Image();
    img.onload = () => {
      setImageDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.src = objectUrl;
  };

  const handleGenerateSampleImage = () => {
    setValidationError(null);
    setUploadResult(null);
    setCdnUrlCopied(false);

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 400, 400);
    grad.addColorStop(0, '#0284c7');
    grad.addColorStop(0.5, '#6366f1');
    grad.addColorStop(1, '#ec4899');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 400);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SogoSocial Bunny Test', 200, 180);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px monospace';
    ctx.fillText(
      new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      200,
      220,
    );
    ctx.fillText('Isolated Diagnostic Sample', 200, 245);

    canvas.toBlob((blob) => {
      if (!blob) {
        setValidationError('Could not generate the sample image.');
        return;
      }

      const file = new File(
        [blob],
        `bunny-test-${Date.now()}.jpg`,
        { type: 'image/jpeg' },
      );

      setSelectedFile(file);

      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);

      setLocalPreviewUrl(URL.createObjectURL(file));
      setImageDimensions({ width: 400, height: 400 });
    }, 'image/jpeg', 0.9);
  };

  const handleExecuteUpload = async () => {
    if (!selectedFile) {
      setValidationError('Please select or generate a test image first.');
      return;
    }

    if (!testUploadToken.trim()) {
      setValidationError(
        'Enter the test token configured in the Cloudflare test Worker.',
      );
      return;
    }

    setIsUploading(true);
    setValidationError(null);
    setUploadResult(null);
    setCdnUrlCopied(false);

    const startTime = performance.now();

    try {
      const formData = new FormData();
      formData.append('file', selectedFile, selectedFile.name);

      const response = await fetch(`${workerBaseUrl}/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${testUploadToken.trim()}`,
        },
        body: formData,
      });

      const latencyMs = Math.round(performance.now() - startTime);
      const rawText = await response.text();

      let jsonResult: any = null;

      try {
        jsonResult = JSON.parse(rawText);
      } catch {
        jsonResult = null;
      }

      if (
        response.ok &&
        jsonResult?.success === true &&
        jsonResult?.imageUrl
      ) {
        setUploadResult({
          httpStatus: response.status,
          httpStatusText: response.statusText || 'OK',
          latencyMs,
          rawResponse: rawText,
          parsedJson: jsonResult,
          cdnUrl: jsonResult.imageUrl,
          error: null,
          corsBlocked: false,
        });
      } else {
        setUploadResult({
          httpStatus: response.status,
          httpStatusText: response.statusText || 'Error',
          latencyMs,
          rawResponse: rawText,
          parsedJson: jsonResult,
          cdnUrl: null,
          error:
            jsonResult?.error ||
            jsonResult?.message ||
            rawText ||
            `Server returned HTTP ${response.status}`,
          corsBlocked: false,
        });
      }
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      const errString = err?.message || String(err);
      const isCors =
        errString.includes('Failed to fetch') ||
        errString.includes('NetworkError') ||
        errString.includes('CORS');

      setUploadResult({
        httpStatus: null,
        httpStatusText: isCors
          ? 'Browser CORS / Network Error'
          : 'Network Failure',
        latencyMs,
        rawResponse: null,
        parsedJson: null,
        cdnUrl: null,
        error: isCors
          ? `The browser could not complete the request. Check the test Worker's CORS settings. Origin: ${window.location.origin}.`
          : `Fetch failed: ${errString}`,
        corsBlocked: isCors,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyCdnUrl = async () => {
    if (!uploadResult?.cdnUrl) return;

    try {
      await navigator.clipboard.writeText(uploadResult.cdnUrl);
      setCdnUrlCopied(true);
      setTimeout(() => setCdnUrlCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = uploadResult.cdnUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCdnUrlCopied(true);
      setTimeout(() => setCdnUrlCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800/80 bg-slate-950/80 sticky top-0 z-50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400"
              title="Return to SogoSocial Feed"
            >
              <ArrowLeft className="w-5 h-5" />
            </a>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base">
                  SogoSocial
                </span>
                <span className="text-[11px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                  Bunny Diagnostic
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Temporary Standalone Media Upload &amp; CORS Test Page
              </p>
            </div>
          </div>
          <a
            href="/"
            className="text-xs text-cyan-400 px-3 py-1.5 rounded-lg border border-cyan-900/60"
          >
            Open App Feed
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start gap-3 text-xs">
          <Shield className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-white">
              Isolated, non-destructive testing
            </span>
            <p className="text-slate-400 leading-relaxed">
              This page tests the separate Cloudflare test Worker and Bunny
              Storage Zone <code className="text-cyan-300">sogosocialmedia</code>,
              delivered via{' '}
              <code className="text-cyan-300">
                sogosocial-cdn-pk26.b-cdn.net
              </code>.
              It does not write to Firestore, change production settings, or
              alter Cloudinary uploads.
            </p>
          </div>
        </div>

        <section className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                <UserIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">
                  1. Optional Firebase Diagnostics
                </h2>
                <p className="text-xs text-slate-400">
                  Firebase sign-in is not required for the Bunny test upload.
                </p>
              </div>
            </div>
            {user && (
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-1.5 text-xs text-rose-400 px-2.5 py-1 rounded-lg border border-rose-900/40"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            )}
          </div>

          {authLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
              Checking Firebase Auth session...
            </div>
          ) : user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-cyan-950 text-cyan-400 flex items-center justify-center">
                    {user.email ? user.email[0].toUpperCase() : 'U'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm truncate">
                    {user.displayName || 'Firebase User'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {user.email || user.uid}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Firebase ID Token (diagnostics only)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRefreshToken}
                      className="text-[11px] text-cyan-400 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Refresh
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyToken}
                      className="text-[11px] text-slate-300 flex items-center gap-1"
                    >
                      {tokenCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {tokenCopied ? 'Copied' : 'Copy Token'}
                    </button>
                  </div>
                </div>
                <div className="font-mono text-[11px] text-slate-400 break-all">
                  {idToken
                    ? `${idToken.substring(0, 48)}...${idToken.substring(idToken.length - 24)} (${idToken.length} chars)`
                    : 'Retrieving token...'}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl bg-slate-950 border border-dashed border-slate-800 text-center space-y-3">
              <LogIn className="w-5 h-5 mx-auto text-blue-400" />
              <p className="text-xs text-slate-400">
                Google sign-in is optional for this isolated test.
              </p>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-slate-900 text-xs font-medium"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                Sign in with Google
              </button>
            </div>
          )}

          {authError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 inline mr-2" />
              {authError}
            </div>
          )}
        </section>

        <section className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">
                2. Test Worker Health &amp; CORS
              </h2>
              <p className="text-xs text-slate-400 break-all">
                {workerBaseUrl}
              </p>
            </div>
            <button
              type="button"
              onClick={checkWorkerHealthAndCors}
              disabled={isCheckingCors}
              className="flex items-center gap-1.5 text-xs text-slate-300 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingCors ? 'animate-spin' : ''}`} />
              Re-check
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-slate-400 font-semibold">Worker Health</div>
              <div className={workerHealth.status === 'running' ? 'text-emerald-400' : 'text-amber-400'}>
                {workerHealth.status === 'running'
                  ? 'Running'
                  : workerHealth.status === 'checking'
                    ? 'Checking...'
                    : 'Unreachable'}
              </div>
              <div className="font-mono text-slate-300 break-words">
                HTTP {workerHealth.httpCode ?? '—'}
              </div>
              <pre className="text-[10px] text-slate-400 whitespace-pre-wrap break-words">
                {workerHealth.data ? JSON.stringify(workerHealth.data, null, 2) : 'No response yet'}
              </pre>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-slate-400 font-semibold">Browser CORS</div>
              <div className={currentOriginCors.status === 'allowed' ? 'text-emerald-400' : 'text-amber-400'}>
                {currentOriginCors.status === 'allowed'
                  ? `HTTP ${currentOriginCors.httpCode}`
                  : currentOriginCors.status === 'checking'
                    ? 'Checking...'
                    : 'Check needed'}
              </div>
              <div className="font-mono text-cyan-300 break-words">
                {currentOriginCors.origin}
              </div>
              <p className="text-[11px] text-slate-400 break-words">
                {currentOriginCors.message || 'Checking OPTIONS response'}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-slate-400 font-semibold">Bunny Storage Zone</div>
              <div className="font-mono text-slate-200">sogosocialmedia</div>
              <div className="text-[11px] text-slate-400">
                Singapore: https://sg.storage.bunnycdn.com
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-slate-400 font-semibold">Bunny CDN</div>
              <div className="font-mono text-emerald-400 break-all">
                https://sogosocial-cdn-pk26.b-cdn.net
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-white">3. Select Test Image</h2>
              <p className="text-xs text-slate-400">
                JPEG, PNG, WebP or GIF • Maximum 5 MB
              </p>
            </div>
            {selectedFile && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
                  setLocalPreviewUrl(null);
                  setImageDimensions(null);
                  setUploadResult(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="text-xs text-slate-400 px-2 py-1 rounded border border-slate-800"
              >
                Clear
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!selectedFile ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-6 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 flex flex-col items-center text-center gap-2"
              >
                <Upload className="w-5 h-5 text-cyan-400" />
                <span className="text-xs font-semibold">Choose Image from Device</span>
                <span className="text-[11px] text-slate-500">Browse gallery or files</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateSampleImage}
                className="p-6 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 flex flex-col items-center text-center gap-2"
              >
                <Sparkles className="w-5 h-5 text-purple-400" />
                <span className="text-xs font-semibold">Generate Sample Image</span>
                <span className="text-[11px] text-slate-500">Creates a 400×400 test JPEG</span>
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-4">
              {localPreviewUrl && (
                <img
                  src={localPreviewUrl}
                  alt="Preview"
                  className="w-24 h-24 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 space-y-1 text-xs">
                <div className="font-semibold text-white break-words">
                  {selectedFile.name}
                </div>
                <div className="text-slate-400">
                  Size: {(selectedFile.size / 1024).toFixed(1)} KB
                </div>
                {imageDimensions && (
                  <div className="text-slate-400">
                    Dimensions: {imageDimensions.width} × {imageDimensions.height}px
                  </div>
                )}
                <div className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Image validated
                </div>
              </div>
            </div>
          )}

          {validationError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 inline mr-2" />
              {validationError}
            </div>
          )}
        </section>

        <section className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0A1220] to-slate-900 border border-cyan-900/50 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white">
              4. Execute Isolated Bunny Upload
            </h2>
            <p className="text-xs text-slate-400">
              Uses the separate test Worker token. Firebase sign-in is not used.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              Test Worker Token
            </label>
            <input
              type="password"
              autoComplete="off"
              value={testUploadToken}
              onChange={(e) => setTestUploadToken(e.target.value)}
              placeholder="Enter the TEST_UPLOAD_TOKEN value"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-3 text-sm text-white"
            />
            <p className="text-[11px] text-slate-400">
              Enter the value configured in Cloudflare under the test Worker
              secret named TEST_UPLOAD_TOKEN. Never commit the token to source code.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExecuteUpload}
            disabled={isUploading || !selectedFile || !testUploadToken.trim()}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Execute Bunny Upload Test
              </>
            )}
          </button>

          {uploadResult && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                <div>
                  <span className="text-slate-400">HTTP Status: </span>
                  <strong className={uploadResult.httpStatus === 200 ? 'text-emerald-400' : 'text-rose-400'}>
                    {uploadResult.httpStatus
                      ? `${uploadResult.httpStatus} ${uploadResult.httpStatusText}`
                      : uploadResult.httpStatusText}
                  </strong>
                </div>
                {uploadResult.latencyMs !== null && (
                  <span className="text-slate-400">
                    Latency: {uploadResult.latencyMs} ms
                  </span>
                )}
              </div>

              {uploadResult.cdnUrl && (
                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-900/60 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
                    <CheckCircle className="w-4 h-4" />
                    Upload Successful — Hosted on Bunny CDN
                  </div>

                  <input
                    type="text"
                    readOnly
                    value={uploadResult.cdnUrl}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300"
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyCdnUrl}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-2"
                    >
                      {cdnUrlCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {cdnUrlCopied ? 'Copied' : 'Copy URL'}
                    </button>
                    <a
                      href={uploadResult.cdnUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open Image
                    </a>
                  </div>

                  <div className="max-w-xs rounded-xl overflow-hidden border border-emerald-900/60">
                    <img
                      src={uploadResult.cdnUrl}
                      alt="Uploaded to Bunny CDN"
                      className="w-full max-h-64 object-contain"
                    />
                  </div>
                </div>
              )}

              {uploadResult.error && (
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/60 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-rose-300">
                    <AlertCircle className="w-4 h-4" />
                    Upload Error
                  </div>
                  <p className="font-mono text-[11px] text-rose-300 break-words">
                    {uploadResult.error}
                  </p>
                </div>
              )}

              {uploadResult.rawResponse && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-slate-400 text-[11px] font-semibold">
                    Worker Response Body
                  </div>
                  <pre className="font-mono text-[11px] text-slate-300 bg-slate-900 p-2 rounded overflow-x-auto max-h-40">
                    {uploadResult.parsedJson
                      ? JSON.stringify(uploadResult.parsedJson, null, 2)
                      : uploadResult.rawResponse}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-950/80 px-4 py-3 text-center text-xs text-slate-500">
        SogoSocial Bunny Diagnostic • Zone:{' '}
        <code className="text-cyan-400">sogosocialmedia</code> • Endpoint:{' '}
        <code className="text-cyan-400">https://sg.storage.bunnycdn.com</code>{' '}
        • CDN: <code className="text-cyan-400">sogosocial-cdn-pk26.b-cdn.net</code>
      </footer>
    </div>
  );
};
