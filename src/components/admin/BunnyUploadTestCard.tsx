import React, { useState, useRef } from 'react';
import {
  Upload,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  FileImage,
  Sparkles,
  Info,
} from 'lucide-react';
import { testBunnyImageUpload } from '../../services/storageService';
import { useAuth } from '../../hooks/useAuth';

export const BunnyUploadTestCard: React.FC = () => {
  const { currentUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCdnUrl, setUploadedCdnUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset previous execution results
    setErrorMessage(null);
    setUploadedCdnUrl(null);
    setCopied(false);

    // Validate type: JPEG, PNG, WebP, GIF
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const mimeType = file.type?.toLowerCase().trim() || '';
    if (!allowedTypes.includes(mimeType)) {
      setErrorMessage(
        `Unsupported file type "${file.type || 'unknown'}". Allowed formats: JPEG, PNG, WebP, GIF.`
      );
      setSelectedFile(null);
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setLocalPreviewUrl(null);
      return;
    }

    // Validate size: 5 MB max
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      setErrorMessage(`File size (${sizeMb} MB) exceeds maximum allowed limit of 5 MB.`);
      setSelectedFile(null);
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setLocalPreviewUrl(null);
      return;
    }

    // Valid file selected
    setSelectedFile(file);
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(URL.createObjectURL(file));
  };

  const handleExecuteUpload = async () => {
    if (!selectedFile) {
      setErrorMessage('Please select a valid image file first.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setUploadedCdnUrl(null);
    setCopied(false);

    try {
      const cdnUrl = await testBunnyImageUpload(selectedFile);
      setUploadedCdnUrl(cdnUrl);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Upload failed with an unknown error.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!uploadedCdnUrl) return;
    try {
      await navigator.clipboard.writeText(uploadedCdnUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      const el = document.createElement('textarea');
      el.value = uploadedCdnUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setUploadedCdnUrl(null);
    setErrorMessage(null);
    setCopied(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0A1220] to-slate-900 border border-cyan-900/40 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight">
                Bunny.net Storage & CDN Upload Test
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                Developer Diagnostic
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Isolated test to verify Cloudflare Worker (<code className="text-cyan-300">/upload</code>) & Bunny Storage Zone (<code className="text-cyan-300">sogosocial-media-s3</code>) without altering production Cloudinary pipelines.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/bunny-test.html"
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium px-2.5 py-1 rounded-lg border border-cyan-800/60 bg-cyan-950/40 transition-colors flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Standalone Test Page
          </a>
          {selectedFile && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isUploading}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded-lg border border-slate-800 hover:border-slate-700 disabled:opacity-50"
            >
              Reset Form
            </button>
          )}
        </div>
      </div>

      {/* Target Infrastructure Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-semibold block">Cloudflare Worker Endpoint</span>
          <div className="font-mono text-cyan-300 text-[11px] truncate">
            https://sogosocial-upload.malikqayyum882.workers.dev/upload
          </div>
          <span className="text-[10px] text-slate-500">Method: POST • Auth: Bearer ID Token</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-semibold block">Target Storage Zone</span>
          <div className="font-mono text-slate-200 text-[11px]">sogosocial-media-s3</div>
          <span className="text-[10px] text-slate-500">Proxy-buffered via Worker</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-semibold block">Singapore Storage Endpoint</span>
          <div className="font-mono text-cyan-300 text-[11px] truncate">
            https://sg-s3.storage.bunnycdn.com
          </div>
          <span className="text-[10px] text-slate-500">Singapore Region (sg-s3)</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-slate-400 font-semibold block">Bunny CDN Hostname</span>
          <div className="font-mono text-emerald-400 text-[11px] truncate">
            https://sogosocial-media-cdn.b-cdn.net
          </div>
          <span className="text-[10px] text-slate-500">Public pull zone</span>
        </div>
      </div>

      {/* Current User Session Status */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Authenticated Developer:</span>
          <span className="font-mono font-bold text-white">
            {currentUser?.email || 'Signed in via Firebase Auth'}
          </span>
          {currentUser?.id && (
            <span className="text-[10px] text-slate-500 font-mono">({currentUser.id.slice(0, 10)}...)</span>
          )}
        </div>
        <div className="text-[11px] text-cyan-400 flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />
          <span>Valid token ready</span>
        </div>
      </div>

      {/* File Picker & Manual Action Section */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileSelect}
          disabled={isUploading}
          className="hidden"
          id="bunny-dev-file-input"
        />

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <FileImage className="w-4 h-4 text-cyan-400" />
            <span>{selectedFile ? 'Change Test Image' : 'Select Test Image (JPEG/PNG/WebP/GIF)'}</span>
          </button>

          <button
            type="button"
            onClick={handleExecuteUpload}
            disabled={!selectedFile || isUploading}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md hover:shadow-cyan-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>Uploading to Worker...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Execute Test Upload</span>
              </>
            )}
          </button>

          <span className="text-[11px] text-slate-500 italic self-center">
            Never runs automatically. Click button to execute.
          </span>
        </div>

        {/* Selected File Details */}
        {selectedFile && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-900 border border-slate-800">
            {localPreviewUrl && (
              <img
                src={localPreviewUrl}
                alt="Selected preview"
                className="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0"
              />
            )}
            <div className="min-w-0 flex-1 text-xs space-y-0.5">
              <p className="font-semibold text-white truncate">{selectedFile.name}</p>
              <p className="text-[11px] text-slate-400 font-mono">
                {(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'image'}
              </p>
            </div>
            <span className="text-[11px] text-cyan-400 font-semibold shrink-0">
              Ready to upload
            </span>
          </div>
        )}
      </div>

      {/* Success Output */}
      {uploadedCdnUrl && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>Upload Succeeded! Image verified on Bunny CDN.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy URL'}</span>
              </button>
              <a
                href={uploadedCdnUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open CDN Link</span>
              </a>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950 border border-emerald-900/50 text-xs font-mono text-emerald-300 break-all select-all">
            {uploadedCdnUrl}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs text-slate-400 font-medium">Live CDN Render Test:</span>
            <div className="relative group">
              <img
                src={uploadedCdnUrl}
                alt="Uploaded on Bunny CDN"
                className="w-16 h-16 rounded-xl object-cover border border-emerald-500/50 shadow-md"
              />
            </div>
            <span className="text-[11px] text-slate-400">
              Image loaded directly from Bunny CDN pull zone.
            </span>
          </div>
        </div>
      )}

      {/* Error Output */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2 text-xs">
          <div className="flex items-start gap-2 text-rose-300 font-bold">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <div className="space-y-1">
              <span>Upload Test Error</span>
              <p className="font-normal font-mono text-[11px] text-rose-200 break-all">
                {errorMessage}
              </p>
            </div>
          </div>

          {errorMessage.toLowerCase().includes('cors') && (
            <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-900/60 text-[11px] text-rose-200 space-y-1">
              <p className="font-semibold text-rose-300 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                <span>CORS Preflight Advice:</span>
              </p>
              <p>
                The Cloudflare Worker needs to respond to HTTP <code>OPTIONS</code> requests with appropriate <code>Access-Control-Allow-Origin</code>, <code>Access-Control-Allow-Methods: POST, OPTIONS</code>, and <code>Access-Control-Allow-Headers: Authorization, Content-Type</code>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Safety Notice */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-800/80">
        <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span>
          Strict isolation: This diagnostic tool does not write to Firestore posts, reels, or user profile records. Production uploads remain 100% on Cloudinary.
        </span>
      </div>
    </div>
  );
};
