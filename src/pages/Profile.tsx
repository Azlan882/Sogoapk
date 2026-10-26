import React, { useState, useEffect, useRef } from 'react';
import { User, Post, VideoPost, CreatorRewardsSummary } from '../types';
import { ProfileHeader } from '../components/ProfileHeader';
import ProfileBannerAd from '../components/ProfileBannerAd';
import { ImageGrid } from '../components/ImageGrid';
import { LoadingState } from '../components/LoadingState';
import { Button } from '../components/Button';
import { useAuth } from '../hooks/useAuth';
import { Login } from './Login';
import * as postsService from '../services/postsService';
import * as usersService from '../services/usersService';
import * as videosService from '../services/videosService';
import * as rewardsService from '../services/rewardsService';
import * as storageService from '../services/storageService';
import { registerBackInterceptor } from '../services/backButtonService';
import { Grid, Bookmark, Heart, X, Check, Film, Play, Eye, Sparkles, ChevronRight, DollarSign, ShieldCheck, ShieldAlert, AlertCircle, CheckCircle2, Camera, Loader2, Trash2 } from 'lucide-react';
import { warmCloudinaryVideoPlayback } from '../lib/utils';
import { DeleteAccountModal } from '../components/DeleteAccountModal';

export type ProfileSubTab = 'posts' | 'videos' | 'saved' | 'liked';

export interface ProfileProps {
  userId?: string;
  initialTab?: ProfileSubTab;
  onTabChange?: (tab: ProfileSubTab) => void;
  onPostClick: (post: Post) => void;
  onVideoClick?: (videoId: string, ownerUserId: string) => void;
  onSettingsClick: () => void;
  onNavigateVideos?: () => void;
  onCreatorRewardsClick?: () => void;
  onAdminDashboardClick?: () => void;
  onLoginSuccess?: () => void;
}

export const Profile: React.FC<ProfileProps> = ({
  userId,
  initialTab = 'posts',
  onTabChange,
  onPostClick,
  onVideoClick,
  onSettingsClick,
  onNavigateVideos,
  onCreatorRewardsClick,
  onAdminDashboardClick,
  onLoginSuccess,
}) => {
  const { currentUser, updateProfile, isAdmin } = useAuth();
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [userVideos, setUserVideos] = useState<VideoPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileSubTab>(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleSelectTab = (tab: ProfileSubTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  // Close edit profile drawer on Android Back
  useEffect(() => {
    if (!isEditing) return;

    return registerBackInterceptor(() => {
      if (isEditing) {
        setIsEditing(false);
        return true;
      }
      return false;
    });
  }, [isEditing]);

  // Edit form states
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>('');
  const [avatarPreviewError, setAvatarPreviewError] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarUploadStatus, setAvatarUploadStatus] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [rewardsSummary, setRewardsSummary] = useState<CreatorRewardsSummary | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const avatarPreviewUrlRef = useRef<string>('');
  const uploadedAvatarCacheRef = useRef<{ file: File; url: string } | null>(null);
  const isSubmittingProfileRef = useRef<boolean>(false);

  useEffect(() => {
    avatarPreviewUrlRef.current = avatarPreviewUrl;
  }, [avatarPreviewUrl]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrlRef.current) {
        URL.revokeObjectURL(avatarPreviewUrlRef.current);
      }
    };
  }, []);

  const isViewingOwnProfile = !userId || (Boolean(currentUser && userId === currentUser.id));

  // If viewing own profile and unauthenticated, show Sign In / Sign Up screen
  if (isViewingOwnProfile && !currentUser) {
    return (
      <div className="py-4">
        <Login standalone={false} onSuccess={onLoginSuccess} />
      </div>
    );
  }

  const targetId = userId || currentUser?.id;
  const isCurrentUser = Boolean(currentUser && currentUser.id === targetId);

  useEffect(() => {
    async function loadProfile() {
      if (!targetId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const fetchedUser = await usersService.getUser(targetId);
        const user = fetchedUser || (isCurrentUser && currentUser ? currentUser : null);

        setProfileUser(user);

        if (user) {
          const [posts, bookmarks, videos] = await Promise.all([
            postsService.getUserPosts(user.id),
            postsService.getBookmarkedPosts(),
            videosService.getUserVideos(user.id, currentUser?.id),
          ]);
          setUserPosts(posts);
          setSavedPosts(bookmarks);
          setUserVideos(videos);

          setEditDisplayName(user.displayName);
          setEditBio(user.bio || '');
          setEditWebsite(user.website || '');
          setEditAvatarUrl(user.avatarUrl);

          if (isCurrentUser) {
            rewardsService.getCreatorRewards(user.id).then(setRewardsSummary).catch(() => {});
          }
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfile();

    // Real-time subscription to creator rewards summary for current user
    let unsubscribeRewards: (() => void) | undefined;
    if (isCurrentUser && currentUser?.id) {
      unsubscribeRewards = rewardsService.subscribeToCreatorRewards(currentUser.id, (updated) => {
        setRewardsSummary(updated);
      });
    }

    const handleFollowChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetUserId: string; isFollowing: boolean }>;
      if (customEvent.detail && customEvent.detail.targetUserId === targetId) {
        setProfileUser((prev) =>
          prev
            ? {
                ...prev,
                isFollowing: customEvent.detail.isFollowing,
                followersCount: customEvent.detail.isFollowing
                  ? prev.followersCount + 1
                  : Math.max(0, prev.followersCount - 1),
              }
            : null
        );
      }
    };

    const handleProfileUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{ userId: string; displayName: string; user: Partial<User> }>;
      if (customEvent.detail && customEvent.detail.userId === targetId) {
        setProfileUser((prev) => (prev ? { ...prev, ...customEvent.detail.user } : null));
        if (customEvent.detail.displayName) {
          setEditDisplayName(customEvent.detail.displayName);
        }
      }
    };

    const handleRepostCreated = (e: Event) => {
      const customEvent = e as CustomEvent<{ repost: Post }>;
      const repost = customEvent.detail?.repost;
      if (repost && (repost.sharedByUid === targetId || repost.repostedBy?.id === targetId)) {
        setUserPosts((prev) => {
          if (prev.some((p) => p.id === repost.id)) return prev;
          return [repost, ...prev];
        });
      }
    };

    const handleRepostRemoved = (e: Event) => {
      const customEvent = e as CustomEvent<{ repostId: string }>;
      const repostId = customEvent.detail?.repostId;
      if (repostId) {
        setUserPosts((prev) => prev.filter((p) => p.id !== repostId && p.repostId !== repostId));
      }
    };

    const handleVerificationChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ userId: string; isVerified: boolean }>;
      if (customEvent.detail && customEvent.detail.userId === targetId) {
        setProfileUser((prev) =>
          prev ? { ...prev, isVerified: customEvent.detail.isVerified } : null
        );
      }
    };

    const handleBookmarkChanged = () => {
      postsService.getBookmarkedPosts().then(setSavedPosts).catch(() => {});
    };

    const handleVideoUpdatedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ video: VideoPost }>;
      const updated = customEvent.detail?.video;
      if (!updated) return;
      setUserVideos((prev) =>
        prev.map((v) => (v.id === updated.id ? updated : v))
      );
      postsService.getBookmarkedPosts().then(setSavedPosts).catch(() => {});
    };

    const handleVideoDeletedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ videoId: string }>;
      const deletedId = customEvent.detail?.videoId;
      if (!deletedId) return;
      setUserVideos((prev) => prev.filter((v) => v.id !== deletedId));
      setSavedPosts((prev) =>
        prev.filter((p) => p.id !== deletedId && p.originalVideoId !== deletedId)
      );
    };

    window.addEventListener('sogo_follow_changed', handleFollowChanged);
    window.addEventListener('sogo_profile_updated', handleProfileUpdated);
    window.addEventListener('sogo_repost_created', handleRepostCreated);
    window.addEventListener('sogo_repost_removed', handleRepostRemoved);
    window.addEventListener('sogo:user_verification_changed', handleVerificationChanged);
    window.addEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
    window.addEventListener('sogo_video_updated', handleVideoUpdatedEvent);
    window.addEventListener('sogo_video_deleted', handleVideoDeletedEvent);
    return () => {
      window.removeEventListener('sogo_follow_changed', handleFollowChanged);
      window.removeEventListener('sogo_profile_updated', handleProfileUpdated);
      window.removeEventListener('sogo_repost_created', handleRepostCreated);
      window.removeEventListener('sogo_repost_removed', handleRepostRemoved);
      window.removeEventListener('sogo:user_verification_changed', handleVerificationChanged);
      window.removeEventListener('sogo_video_bookmark_changed', handleBookmarkChanged);
      window.removeEventListener('sogo_video_updated', handleVideoUpdatedEvent);
      window.removeEventListener('sogo_video_deleted', handleVideoDeletedEvent);
      if (unsubscribeRewards) {
        unsubscribeRewards();
      }
    };
  }, [targetId, isCurrentUser, currentUser]);

  const handleFollowToggle = async (uid: string) => {
    const isNowFollowing = await usersService.toggleFollowUser(uid, currentUser);
    setProfileUser((prev) =>
      prev
        ? {
            ...prev,
            isFollowing: isNowFollowing,
            followersCount: isNowFollowing
              ? prev.followersCount + 1
              : Math.max(0, prev.followersCount - 1),
          }
        : null
    );
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Handle canceling the picker safely without altering current state
    if (!file) return;

    const validExt = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(file.name || '');
    const validMime = Boolean(file.type && file.type.startsWith('image/'));

    if (!validMime && !validExt) {
      setSaveError('Please select a valid image file (JPG, PNG, or WebP).');
      setSaveSuccess(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      return;
    }

    if (file.size === 0) {
      setSaveError('Selected image file is empty. Please choose another photo.');
      setSaveSuccess(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setSaveError('Image is too large. Please select a profile picture under 10MB.');
      setSaveSuccess(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      return;
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    const localPreview = URL.createObjectURL(file);
    setSelectedAvatarFile(file);
    setAvatarPreviewUrl(localPreview);
    setAvatarPreviewError(false);
    setAvatarUploadProgress(0);
    setSaveError(null);
    setSaveSuccess(false);

    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  };

  const resetPendingAvatarSelection = () => {
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setSelectedAvatarFile(null);
    setAvatarPreviewUrl('');
    setAvatarPreviewError(false);
    setIsUploadingAvatar(false);
    setAvatarUploadProgress(0);
    setAvatarUploadStatus('');
    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileUser || isSaving || isUploadingAvatar || isSubmittingProfileRef.current) return;

    // Security: Only the authenticated user can edit their own profile & avatar
    if (!isCurrentUser || !currentUser || currentUser.id !== profileUser.id) {
      setSaveError('Unauthorized: You can only edit your own profile.');
      setSaveSuccess(false);
      return;
    }

    const trimmedName = editDisplayName.trim();
    if (!trimmedName) {
      setSaveError('Display Name cannot be empty.');
      setSaveSuccess(false);
      return;
    }

    isSubmittingProfileRef.current = true;
    setSaveError(null);
    setSaveSuccess(false);
    setIsSaving(true);

    const oldName = profileUser.displayName;
    console.log('[PROFILE NAME SAVE]', {
      uid: profileUser.id,
      oldName,
      newName: trimmedName,
      hasNewAvatarFile: Boolean(selectedAvatarFile),
      firestoreWrite: 'starting',
    });

    try {
      let finalAvatarUrl = editAvatarUrl.trim() || profileUser.avatarUrl;

      // Upload new profile picture to Cloudinary ONLY if the user selected a new image file
      if (selectedAvatarFile) {
        // Prevent uploading the exact same file multiple times on retry
        if (
          uploadedAvatarCacheRef.current &&
          uploadedAvatarCacheRef.current.file === selectedAvatarFile &&
          uploadedAvatarCacheRef.current.url.startsWith('https://')
        ) {
          finalAvatarUrl = uploadedAvatarCacheRef.current.url;
        } else {
          setIsUploadingAvatar(true);
          setAvatarUploadProgress(0);
          setAvatarUploadStatus('');
          try {
            const uploadedUrl = await storageService.uploadAvatarImage(selectedAvatarFile, {
              onProgress: (percent) => setAvatarUploadProgress(percent),
              onStatusChange: (status) => {
                setAvatarUploadStatus(status.phase === 'retrying' ? status.message : '');
              },
            });
            if (!uploadedUrl || !uploadedUrl.startsWith('https://')) {
              throw new Error('Failed to obtain a valid HTTPS image URL from Cloudinary.');
            }
            finalAvatarUrl = uploadedUrl;
            uploadedAvatarCacheRef.current = { file: selectedAvatarFile, url: uploadedUrl };
            setEditAvatarUrl(uploadedUrl);
          } finally {
            setIsUploadingAvatar(false);
            setAvatarUploadStatus('');
          }
        }
      }

      const updatedData = {
        displayName: trimmedName,
        bio: editBio.trim(),
        website: editWebsite.trim(),
        avatarUrl: finalAvatarUrl,
      };

      const updatedUser = await usersService.updateUserProfile(profileUser.id, updatedData);
      setProfileUser(updatedUser);

      // Immediately update avatar and displayName on loaded profile posts and videos
      setUserPosts((prev) =>
        prev.map((p) => {
          let next = p;
          if (p.user?.id === updatedUser.id || (!p.isRepost && p.userId === updatedUser.id)) {
            next = {
              ...next,
              user: {
                ...next.user,
                displayName: updatedUser.displayName,
                avatarUrl: updatedUser.avatarUrl,
              },
            };
          }
          if (p.repostedBy?.id === updatedUser.id || p.sharedByUid === updatedUser.id) {
            next = {
              ...next,
              repostedBy: next.repostedBy
                ? {
                    ...next.repostedBy,
                    displayName: updatedUser.displayName,
                    avatarUrl: updatedUser.avatarUrl,
                  }
                : next.repostedBy,
            };
          }
          return next;
        })
      );

      setUserVideos((prev) =>
        prev.map((v) =>
          v.userId === updatedUser.id || v.user?.id === updatedUser.id
            ? {
                ...v,
                user: {
                  ...v.user,
                  displayName: updatedUser.displayName,
                  avatarUrl: updatedUser.avatarUrl,
                },
              }
            : v
        )
      );

      if (isCurrentUser) {
        await updateProfile(updatedData);
      }

      resetPendingAvatarSelection();

      console.log('[PROFILE NAME SAVE]', {
        uid: profileUser.id,
        oldName,
        newName: trimmedName,
        avatarUrl: updatedUser.avatarUrl,
        firestoreWrite: 'success',
        localStateUpdate: 'success',
        finalDisplayedName: updatedUser.displayName,
      });

      // Only show "Saved changes ✓" after both Cloudinary upload and Firestore write succeed
      setSaveSuccess(true);
      setTimeout(() => {
        setIsEditing(false);
        setSaveSuccess(false);
      }, 1000);
    } catch (err: any) {
      console.error('[PROFILE NAME SAVE] Error updating profile:', err);
      setSaveSuccess(false);
      setSaveError(err?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
      setIsSaving(false);
      isSubmittingProfileRef.current = false;
    }
  };

  if (loading) {
    return <LoadingState message="Loading profile..." />;
  }

  if (!profileUser) {
    return (
      <div className="py-12 text-center text-slate-400">
        <p className="text-sm">Profile not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProfileHeader
        user={{
          ...profileUser,
          postsCount: Math.max(profileUser.postsCount || 0, userPosts.length),
        }}
        isCurrentUser={isCurrentUser}
        onEditProfile={() => {
          if (profileUser) {
            setEditDisplayName(profileUser.displayName);
            setEditBio(profileUser.bio || '');
            setEditWebsite(profileUser.website || '');
            setEditAvatarUrl(profileUser.avatarUrl || '');
          }
          resetPendingAvatarSelection();
          setSaveError(null);
          setSaveSuccess(false);
          setIsEditing(true);
        }}
        onFollowToggle={handleFollowToggle}
        onSettingsClick={onSettingsClick}
      />

      <ProfileBannerAd />

      {/* SogoSocial Creator Rewards Program Banner (Own Profile) */}
      {isCurrentUser && (
        <div
          onClick={onCreatorRewardsClick}
          className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-[#172340] via-[#101A2E] to-[#151D30] border border-amber-500/30 hover:border-amber-500/50 transition-all cursor-pointer shadow-lg shadow-amber-950/10 flex items-center justify-between gap-3 group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-105 transition-transform shrink-0">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-white tracking-tight">
                  Creator Rewards Program
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase">
                  $0.50 / 1k views
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                {rewardsSummary
                  ? `Earned: ${rewardsService.formatCentsToUsd(rewardsService.getDisplayRewardsMetrics(rewardsSummary).displayTotalEarnedCents)} • ${rewardsService.getDisplayRewardsMetrics(rewardsSummary).displayQualifiedViews.toLocaleString()} qualified views`
                  : 'Track qualified video views, referrals, and request payouts'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs font-bold text-amber-400 shrink-0 group-hover:translate-x-0.5 transition-transform">
            <span>Dashboard</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* SogoSocial Admin Dashboard Entry Point (Admin Only - Requires Verified admin: true Claim) */}
      {isCurrentUser && isAdmin && (
        <div
          onClick={onAdminDashboardClick}
          className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-950/40 via-[#191024] to-slate-900 border border-rose-500/40 hover:border-rose-500/60 transition-all flex items-center justify-between gap-3 cursor-pointer group shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white group-hover:text-rose-300 transition-colors">
                  SogoSocial Admin Control Panel
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase">
                  Owner
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Manage platform users, video moderation, rewards liability & payouts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs font-bold text-rose-400 shrink-0 group-hover:translate-x-0.5 transition-transform">
            <span>Admin</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* SogoSocial Admin Pending Claim Verification (azlanmalik774@gmail.com only) */}
      {isCurrentUser && !isAdmin && currentUser?.email?.toLowerCase().trim() === 'azlanmalik774@gmail.com' && (
        <div
          onClick={onAdminDashboardClick}
          className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-500/40 hover:border-amber-500/60 transition-all flex items-center justify-between gap-3 cursor-pointer group shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-300">
                  Admin Setup: Pending Custom Claim
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase">
                  Action Required
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Account recognized (azlanmalik774@gmail.com). Click to check status or force-refresh ID token.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs font-bold text-amber-400 shrink-0 group-hover:translate-x-0.5 transition-transform">
            <span>Diagnose</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        <button
          type="button"
          onClick={() => handleSelectTab('posts')}
          className={`flex-1 py-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'posts'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Grid className="w-4 h-4" />
          <span>Posts ({userPosts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectTab('videos')}
          className={`flex-1 py-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'videos'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Film className="w-4 h-4" />
          <span>Videos ({userVideos.length})</span>
        </button>

        {isCurrentUser && (
          <button
            type="button"
            onClick={() => handleSelectTab('saved')}
            className={`flex-1 py-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'saved'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bookmark className="w-4 h-4" />
            <span>Saved ({savedPosts.length})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleSelectTab('liked')}
          className={`flex-1 py-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'liked'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Heart className="w-4 h-4" />
          <span>Appreciated</span>
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'posts' && (
          <ImageGrid
            posts={userPosts}
            onPostClick={onPostClick}
            emptyMessage="No visual moments shared yet."
          />
        )}

        {activeTab === 'videos' && (
          userVideos.length === 0 ? (
            <div className="py-14 text-center text-slate-400">
              <Film className="w-10 h-10 mx-auto text-slate-600 mb-2 stroke-[1.5]" />
              <p className="text-sm font-medium">No videos published yet</p>
              {isCurrentUser && onNavigateVideos && (
                <button
                  type="button"
                  onClick={onNavigateVideos}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-xl text-xs font-bold border border-cyan-500/30 transition-colors cursor-pointer"
                >
                  Go to Reels
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
              {userVideos.map((video) => (
                <div
                  key={video.id}
                  onClick={() => {
                    const ownerUserId = profileUser.id || video.userId;
                    videosService.primeUserVideosInCache(ownerUserId, userVideos);
                    videosService.primeVideoInCache(video);
                    warmCloudinaryVideoPlayback(video.videoUrl, video.thumbnailUrl, false);
                    if (onVideoClick) {
                      onVideoClick(video.id, ownerUserId);
                    } else if (onNavigateVideos) {
                      onNavigateVideos();
                    }
                  }}
                  className="relative aspect-9/16 rounded-xl overflow-hidden bg-slate-950 group cursor-pointer border border-slate-800/80 hover:border-cyan-500/50 transition-all"
                >
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.caption || 'Video'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-slate-900 flex items-center justify-center text-slate-600">
                      <Film className="w-6 h-6" />
                    </div>
                  )}

                  {/* Play badge */}
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white">
                    <Play className="w-3 h-3 fill-white ml-0.5" />
                  </div>

                  {/* Views & Likes count overlay */}
                  <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-[10px] text-white font-semibold">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3 h-3 text-cyan-400" />
                      {video.viewsCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="w-3 h-3 text-red-400 fill-red-400" />
                      {video.likesCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'saved' && (
          <ImageGrid
            posts={savedPosts}
            onPostClick={onPostClick}
            emptyMessage="No saved bookmarks."
          />
        )}

        {activeTab === 'liked' && (
          <ImageGrid
            posts={userPosts.filter((p) => p.likesCount > 0)}
            onPostClick={onPostClick}
            emptyMessage="No liked posts yet."
          />
        )}
      </div>

      {/* Edit Profile Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-4 text-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="font-bold text-base text-white">Edit Profile</h2>
              <button
                type="button"
                disabled={isSaving || isUploadingAvatar}
                onClick={() => {
                  resetPendingAvatarSelection();
                  setIsEditing(false);
                  setSaveError(null);
                  setSaveSuccess(false);
                }}
                className="p-1 rounded-full text-slate-400 hover:text-white cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {saveError && (
              <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            {saveSuccess && (
              <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-xs font-semibold text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Saved changes ✓</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Edit Profile Picture Picker */}
              <div className="flex flex-col items-center text-center pb-3 border-b border-slate-800/80 space-y-2.5">
                <div className="relative group">
                  <div
                    onClick={() => {
                      if (!isSaving && !isUploadingAvatar) {
                        avatarInputRef.current?.click();
                      }
                    }}
                    className="w-24 h-24 rounded-full ring-4 ring-cyan-500/30 overflow-hidden bg-slate-800 flex items-center justify-center shadow-lg shadow-cyan-500/10 cursor-pointer"
                  >
                    {(avatarPreviewUrl || editAvatarUrl || profileUser.avatarUrl) && !avatarPreviewError ? (
                      <img
                        src={avatarPreviewUrl || editAvatarUrl || profileUser.avatarUrl}
                        alt={editDisplayName || profileUser.displayName || 'Profile picture'}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarPreviewError(true)}
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-800 flex items-center justify-center text-white text-xl font-bold select-none">
                        {(editDisplayName || profileUser.displayName || 'U').slice(0, 2).toUpperCase()}
                      </div>
                    )}

                    {/* Upload / Saving Spinner Overlay */}
                    {isUploadingAvatar && (
                      <div className="absolute inset-0 bg-black/65 backdrop-blur-xs flex flex-col items-center justify-center gap-1">
                        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                        <span className="text-[10px] font-bold text-cyan-300">
                          {avatarUploadProgress}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Camera Icon Overlay */}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={isSaving || isUploadingAvatar}
                    className="absolute bottom-0 right-0 p-2 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md ring-4 ring-slate-900 transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                    title="Change Profile Picture"
                  >
                    <Camera className="w-4 h-4" />
                  </button>

                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarFileSelect}
                    className="hidden"
                  />
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={isSaving || isUploadingAvatar}
                      className="text-xs font-bold text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isUploadingAvatar
                        ? avatarUploadStatus || `Uploading photo… ${avatarUploadProgress}%`
                        : 'Change Profile Picture'}
                    </button>

                    {selectedAvatarFile && !isSaving && !isUploadingAvatar && (
                      <button
                        type="button"
                        onClick={resetPendingAvatarSelection}
                        className="text-xs font-semibold text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500">
                    {selectedAvatarFile
                      ? `Selected: ${selectedAvatarFile.name} (${(selectedAvatarFile.size / (1024 * 1024)).toFixed(2)} MB)`
                      : 'JPG, PNG or WebP up to 10MB'}
                  </p>
                </div>

                {/* Upload Progress Bar */}
                {isUploadingAvatar && (
                  <div className="w-full max-w-xs space-y-1 pt-1">
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-150"
                        style={{ width: `${avatarUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Display Name</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  disabled={isSaving || isUploadingAvatar}
                  className="w-full px-3.5 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Bio</label>
                <textarea
                  rows={3}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  disabled={isSaving || isUploadingAvatar}
                  placeholder="Share a short summary about your craft..."
                  className="w-full px-3.5 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Website</label>
                <input
                  type="url"
                  value={editWebsite}
                  onChange={(e) => setEditWebsite(e.target.value)}
                  disabled={isSaving || isUploadingAvatar}
                  placeholder="https://yourportfolio.com"
                  className="w-full px-3.5 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSaving || isUploadingAvatar}
                  onClick={() => {
                    resetPendingAvatarSelection();
                    setIsEditing(false);
                    setSaveError(null);
                    setSaveSuccess(false);
                  }}
                >
                  Cancel
                </Button>
                {saveSuccess ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-600 text-white cursor-default"
                    rightIcon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Saved changes ✓
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={isSaving || isUploadingAvatar}
                    rightIcon={isSaving || isUploadingAvatar ? undefined : <Check className="w-4 h-4" />}
                  >
                    {isUploadingAvatar
                      ? avatarUploadStatus || `Uploading (${avatarUploadProgress}%)...`
                      : isSaving
                      ? 'Saving...'
                      : 'Save Changes'}
                  </Button>
                )}
              </div>

              {/* Account Management: Delete Account */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                    Delete Account
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Permanently delete your profile and all content
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    setIsDeleteAccountModalOpen(true);
                  }}
                  className="text-rose-400 border-rose-900/60 hover:bg-rose-950/30 text-xs"
                  leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                >
                  Delete Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      <DeleteAccountModal
        isOpen={isDeleteAccountModalOpen}
        onClose={() => setIsDeleteAccountModalOpen(false)}
        onDeletedSuccess={() => {
          setIsDeleteAccountModalOpen(false);
          window.location.reload();
        }}
      />
    </div>
  );
};
