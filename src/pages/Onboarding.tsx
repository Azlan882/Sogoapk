import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import * as storageService from '../services/storageService';
import * as authService from '../services/authService';
import * as rewardsService from '../services/rewardsService';
import sogoLogo from '../assets/sogo-mark.svg';
import {
  Camera,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lock,
  Calendar,
  User as UserIcon,
  AtSign,
  ArrowRight,
  LogOut,
  RefreshCw,
  Sparkles,
  FileText,
  Gift,
} from 'lucide-react';

export interface OnboardingProps {
  user: User;
  onComplete: (profileData: {
    displayName: string;
    username: string;
    birthday: string;
    avatarUrl: string;
    bio?: string;
    website?: string;
    referralCode?: string;
  }) => Promise<void>;
  onCancel?: () => Promise<void> | void;
}

export const Onboarding: React.FC<OnboardingProps> = ({
  user,
  onComplete,
  onCancel,
}) => {
  // Pre-fill fields from Google account
  const [displayName, setDisplayName] = useState(user.displayName || '');
  
  // Suggest initial clean username
  const initialUsername = (
    user.username && !user.username.startsWith('user_')
      ? user.username
      : (user.displayName || user.email?.split('@')[0] || 'creator')
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 24)
  ) || 'sogosocial_user';

  const [username, setUsername] = useState(initialUsername);
  const [birthday, setBirthday] = useState(user.birthday || '');
  const [bio, setBio] = useState(user.bio || '');
  const [website, setWebsite] = useState(user.website || '');
  
  // Pre-fill profile photo from Google photoURL if available, else Dicebear fallback
  const initialAvatar =
    user.avatarUrl && !user.avatarUrl.includes('dicebear')
      ? user.avatarUrl
      : user.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(initialUsername)}`;

  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [avatarError, setAvatarError] = useState(false);

  // Referral code state (from URL query param ?ref= / ?referral_code= or Play Store install referrer)
  const [referralCode, setReferralCode] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('ref') || params.get('referral_code');
      if (urlCode) return urlCode.trim().toUpperCase();
    } catch {}
    return rewardsService.getPendingReferralCode() || '';
  });

  // Sync pending referral code if populated by background Play Store Install Referrer query
  useEffect(() => {
    if (!referralCode) {
      const pending = rewardsService.getPendingReferralCode();
      if (pending) {
        setReferralCode(pending);
      }
    }
  }, [referralCode]);

  // States
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [avatarUploadStatus, setAvatarUploadStatus] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Username validation states
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');
  const [usernameMessage, setUsernameMessage] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Today's date in YYYY-MM-DD for max date picker constraint
  const todayStr = new Date().toISOString().split('T')[0];

  // Debounced username availability validation
  useEffect(() => {
    const clean = username.trim().toLowerCase();

    if (!clean) {
      setUsernameStatus('invalid');
      setUsernameMessage('Username is required.');
      return;
    }

    if (clean.length < 3) {
      setUsernameStatus('invalid');
      setUsernameMessage('Username must be at least 3 characters.');
      return;
    }

    if (!/^[a-z0-9_]{3,30}$/.test(clean)) {
      setUsernameStatus('invalid');
      setUsernameMessage('Only lowercase letters, numbers, and underscores allowed.');
      return;
    }

    let isMounted = true;
    setUsernameStatus('checking');
    setUsernameMessage('Checking availability...');

    const timer = setTimeout(async () => {
      try {
        const isAvailable = await authService.checkUsernameAvailability(clean, user.id);
        if (!isMounted) return;

        if (isAvailable) {
          setUsernameStatus('available');
          setUsernameMessage(`@${clean} is available!`);
        } else {
          setUsernameStatus('taken');
          setUsernameMessage(`@${clean} is already in use.`);
        }
      } catch {
        if (!isMounted) return;
        setUsernameStatus('available');
        setUsernameMessage(`@${clean} is valid.`);
      }
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [username, user.id]);

  // Handle avatar upload using SogoSocial Cloudinary service
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 8MB for avatar)
    if (file.size > 8 * 1024 * 1024) {
      setSaveError('Avatar image must be smaller than 8MB.');
      return;
    }

    try {
      setIsUploadingImage(true);
      setAvatarUploadStatus('');
      setSaveError(null);
      setAvatarError(false);

      const uploadedUrl = await storageService.uploadAvatarImage(file, {
        onStatusChange: (status) => {
          setAvatarUploadStatus(status.phase === 'retrying' ? status.message : '');
        },
      });
      setAvatarUrl(uploadedUrl);
    } catch (err: unknown) {
      console.warn('Avatar upload failed:', err);
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Upload failed. Please check your connection and try again.'
      );
    } finally {
      setIsUploadingImage(false);
      setAvatarUploadStatus('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Form validity check
  const isNameValid = displayName.trim().length > 0;
  const isBirthdayValid = Boolean(birthday && birthday <= todayStr);
  const isUsernameValid =
    usernameStatus === 'available' ||
    (username.trim().length >= 3 && /^[a-z0-9_]{3,30}$/.test(username.trim().toLowerCase()) && usernameStatus !== 'taken' && usernameStatus !== 'invalid');

  const canSubmit =
    isNameValid &&
    isBirthdayValid &&
    isUsernameValid &&
    !isUploadingImage &&
    !isSaving;

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaveError(null);
    setIsSaving(true);

    try {
      const cleanRefCode = referralCode.trim().toUpperCase();

      // Validate referral code before saving profile so typos or self-referrals are caught clearly
      if (cleanRefCode) {
        const resolved = await rewardsService.resolveReferrerByCode(cleanRefCode);
        if (!resolved || !resolved.referrerId) {
          setSaveError('Referral code not found. Please check the code or leave it blank.');
          setIsSaving(false);
          return;
        }
        if (resolved.referrerId === user.id) {
          setSaveError('You cannot use your own referral code.');
          setIsSaving(false);
          return;
        }
        rewardsService.setPendingReferralCode(resolved.canonicalCode);
      }

      await onComplete({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        birthday: birthday.trim(),
        avatarUrl: avatarUrl.trim(),
        bio: bio.trim(),
        website: website.trim(),
        referralCode: cleanRefCode || undefined,
      });
    } catch (err: unknown) {
      console.error('Error completing profile onboarding:', err);
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Unable to save your profile. Please check your internet connection and try again.';
      setSaveError(errMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-slate-100 flex flex-col justify-between py-6 px-4 sm:px-6">
      <div className="w-full max-w-lg mx-auto">
        {/* Top App Header & Cancel Action */}
        <div className="flex items-center justify-between pb-6 mb-6 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-500/30 flex items-center justify-center shadow-md shadow-purple-500/10">
              <img src={sogoLogo} alt="SogoSocial" className="w-8 h-8 object-contain" />
            </div>
            <div>
              <span className="text-sm font-bold text-white tracking-wide">SOGOSOCIAL</span>
              <span className="block text-[11px] text-fuchsia-400 font-medium">New Account Setup</span>
            </div>
          </div>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-slate-900/80 border border-slate-800 transition-colors cursor-pointer"
              title="Sign out and return to sign in screen"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Switch Account</span>
            </button>
          )}
        </div>

        {/* Card Container */}
        <div className="bg-[#131B2E] border border-slate-800/90 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Section Heading */}
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Complete Your Profile</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Welcome to SogoSocial
            </h1>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Finish setting up your creator identity to start posting updates and exploring short video reels.
            </p>
          </div>

          {/* Save Error Alert */}
          {saveError && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs flex items-start gap-3 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-rose-300">Setup failed</p>
                <p className="mt-0.5 text-rose-200/90">{saveError}</p>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-rose-300 hover:text-rose-100 underline underline-offset-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Profile Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Profile Picture Upload Section */}
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="relative group">
                <div className="w-24 h-24 rounded-full ring-4 ring-cyan-500/30 overflow-hidden bg-slate-800 flex items-center justify-center shadow-lg shadow-cyan-500/10">
                  {avatarError ? (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-teal-800 flex items-center justify-center text-white text-2xl font-bold">
                      {displayName ? displayName.slice(0, 2).toUpperCase() : 'SO'}
                    </div>
                  ) : (
                    <img
                      src={avatarUrl}
                      alt={displayName || 'Avatar'}
                      onError={() => setAvatarError(true)}
                      className="w-full h-full object-cover"
                    />
                  )}

                  {/* Loading Overlay */}
                  {isUploadingImage && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                    </div>
                  )}
                </div>

                {/* Upload Trigger Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingImage}
                  className="absolute bottom-0 right-0 p-2 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md ring-4 ring-[#131B2E] transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                  title="Upload new photo"
                >
                  <Camera className="w-4 h-4" />
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingImage}
                  className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                >
                  {isUploadingImage
                    ? avatarUploadStatus || 'Uploading photo...'
                    : 'Change profile picture'}
                </button>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Pre-filled with your Google account photo
                </p>
              </div>
            </div>

            {/* Full Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Full Name <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your full name"
                  className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/80 border rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors ${
                    !displayName.trim() && displayName !== ''
                      ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-700/80 focus:border-cyan-500 focus:ring-cyan-500'
                  }`}
                />
              </div>
              {!displayName.trim() && (
                <p className="text-[11px] text-rose-400 mt-1">Full name is required.</p>
              )}
            </div>

            {/* Username */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-300">
                  Username <span className="text-rose-400">*</span>
                </label>
                {usernameStatus === 'checking' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                    Checking...
                  </span>
                )}
                {usernameStatus === 'available' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    Available
                  </span>
                )}
                {usernameStatus === 'taken' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                    <XCircle className="w-3 h-3" />
                    Already taken
                  </span>
                )}
                {usernameStatus === 'invalid' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                    <AlertCircle className="w-3 h-3" />
                    Invalid
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <AtSign className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="your_handle"
                  maxLength={30}
                  className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/80 border rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors ${
                    usernameStatus === 'taken' || usernameStatus === 'invalid'
                      ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                      : usernameStatus === 'available'
                      ? 'border-emerald-500/70 focus:border-emerald-400 focus:ring-emerald-400'
                      : 'border-slate-700/80 focus:border-cyan-500 focus:ring-cyan-500'
                  }`}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {usernameMessage || '3 to 30 characters. Letters, numbers, and underscores only.'}
              </p>
            </div>

            {/* Email (Read-Only) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-300">Google Email</label>
                <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400 font-semibold uppercase tracking-wider bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                  <Lock className="w-2.5 h-2.5" />
                  Verified
                </span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  readOnly
                  disabled
                  value={user.email || ''}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-400 cursor-not-allowed select-none"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Linked to your Google account and cannot be modified.
              </p>
            </div>

            {/* Birthday Date Picker */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Birthday <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Calendar className="w-4 h-4" />
                </div>
                <input
                  type="date"
                  required
                  max={todayStr}
                  min="1920-01-01"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  className={`w-full pl-10 pr-3.5 py-2.5 bg-slate-900/80 border rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors ${
                    !birthday
                      ? 'border-slate-700/80 focus:border-cyan-500 focus:ring-cyan-500'
                      : birthday > todayStr
                      ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-emerald-500/70 focus:border-emerald-400 focus:ring-emerald-400'
                  }`}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Required for account verification and age-appropriate content.
              </p>
            </div>

            {/* Bio (Optional) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-300">
                  Bio <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <span className="text-[11px] text-slate-500">{bio.length}/150</span>
              </div>
              <div className="relative">
                <div className="absolute top-2.5 left-3 pointer-events-none text-slate-400">
                  <FileText className="w-4 h-4" />
                </div>
                <textarea
                  rows={2}
                  maxLength={150}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A few words about your visual stories..."
                  className="w-full pl-10 pr-3.5 py-2 bg-slate-900/80 border border-slate-700/80 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none"
                />
              </div>
            </div>

            {/* Referral Code (Optional) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-300">
                  Referral Code <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <span className="inline-flex items-center gap-1 text-[10px] text-purple-400 font-semibold uppercase tracking-wider bg-purple-400/10 px-2 py-0.5 rounded-md border border-purple-400/20">
                  <Gift className="w-3 h-3" />
                  Creator Rewards
                </span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Gift className="w-4 h-4 text-purple-400" />
                </div>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => {
                    const nextCode = e.target.value.toUpperCase();
                    setReferralCode(nextCode);
                    if (nextCode.trim()) {
                      rewardsService.setPendingReferralCode(nextCode.trim());
                    } else {
                      rewardsService.clearPendingReferralCode();
                    }
                  }}
                  placeholder="e.g. SOGO-ALEXANDER"
                  maxLength={30}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-900/80 border border-slate-700/80 rounded-xl text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Enter an invite code from another creator to link your accounts for creator rewards.
              </p>
            </div>

            {/* Complete Sign Up Action */}
            <div className="pt-3">
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full relative flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-[#131B2E]"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Setting up your account...</span>
                  </>
                ) : (
                  <>
                    <span>Complete Sign Up</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-center text-[11px] text-slate-400 mt-2.5">
                By completing setup, your profile will be created and saved in SogoSocial.
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* Footer Notice */}
      <div className="mt-8 text-center text-xs text-slate-400">
        <p>SogoSocial Community • Designed for Creators</p>
      </div>
    </div>
  );
};
