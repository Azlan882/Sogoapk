import React, { useState } from 'react';
import { User } from '../types';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { UserCard } from './UserCard';
import { formatNumber } from '../lib/utils';
import { Settings, Globe, Edit3, X, Users, Loader2 } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';
import * as usersService from '../services/usersService';
import { useAuth } from '../hooks/useAuth';

export interface ProfileHeaderProps {
  user: User;
  isCurrentUser: boolean;
  onEditProfile?: () => void;
  onFollowToggle?: (userId: string) => void;
  onSettingsClick?: () => void;
  onUserClick?: (userId: string) => void;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  user,
  isCurrentUser,
  onEditProfile,
  onFollowToggle,
  onSettingsClick,
  onUserClick,
}) => {
  const { currentUser } = useAuth();
  const [followModalType, setFollowModalType] = useState<'followers' | 'following' | null>(null);
  const [followList, setFollowList] = useState<User[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const handleOpenFollowModal = async (type: 'followers' | 'following') => {
    setFollowModalType(type);
    setLoadingList(true);
    try {
      const list =
        type === 'followers'
          ? await usersService.getUserFollowers(user.id, currentUser?.id)
          : await usersService.getUserFollowing(user.id, currentUser?.id);
      setFollowList(list);
    } catch {
      setFollowList([]);
    } finally {
      setLoadingList(false);
    }
  };

  const handleListFollowToggle = async (targetUserId: string) => {
    if (!currentUser) return;
    try {
      const isNowFollowing = await usersService.toggleFollowUser(targetUserId, {
        id: currentUser.id,
        username: currentUser.username,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
      });
      setFollowList((prev) =>
        prev.map((u) =>
          u.id === targetUserId
            ? {
                ...u,
                isFollowing: isNowFollowing,
                followersCount: isNowFollowing
                  ? u.followersCount + 1
                  : Math.max(0, u.followersCount - 1),
              }
            : u
        )
      );
    } catch {}
  };

  return (
    <>
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 sm:p-6 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar
              src={user.avatarUrl}
              alt={user.displayName}
              size="xl"
              hasStory={false}
            />
          </div>

          {/* Info & Stats */}
          <div className="flex-1 w-full">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-xl font-bold text-white">{user.displayName}</h1>
                  <VerifiedBadge
                    userId={user.id}
                    username={user.username}
                    isVerified={user.isVerified}
                    size="lg"
                  />
                </div>
                <p className="text-sm text-slate-400">@{user.username}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {isCurrentUser ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Edit3 className="w-4 h-4" />}
                      onClick={onEditProfile}
                    >
                      Edit Profile
                    </Button>
                    <button
                      type="button"
                      onClick={onSettingsClick}
                      className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
                      aria-label="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <Button
                    variant={user.isFollowing ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => onFollowToggle?.(user.id)}
                  >
                    {user.isFollowing ? 'Following' : 'Follow'}
                  </Button>
                )}
              </div>
            </div>

            {/* Bio & Link */}
            {user.bio && (
              <p className="text-sm text-slate-300 mt-3 leading-relaxed max-w-xl">
                {user.bio}
              </p>
            )}

            {user.website && (
              <a
                href={user.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:underline mt-2"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{user.website.replace(/^https?:\/\//, '')}</span>
              </a>
            )}

            {/* Numerical Stats */}
            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-800">
              <div className="text-center sm:text-left">
                <span className="block text-base font-bold text-white">
                  {formatNumber(user.postsCount)}
                </span>
                <span className="text-xs text-slate-500">Posts</span>
              </div>
              <button
                type="button"
                onClick={() => handleOpenFollowModal('followers')}
                className="text-center sm:text-left hover:opacity-80 transition-opacity focus:outline-none cursor-pointer"
              >
                <span className="block text-base font-bold text-white">
                  {formatNumber(user.followersCount)}
                </span>
                <span className="text-xs text-slate-500 hover:text-cyan-400 transition-colors">
                  Followers
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenFollowModal('following')}
                className="text-center sm:text-left hover:opacity-80 transition-opacity focus:outline-none cursor-pointer"
              >
                <span className="block text-base font-bold text-white">
                  {formatNumber(user.followingCount)}
                </span>
                <span className="text-xs text-slate-500 hover:text-cyan-400 transition-colors">
                  Following
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Followers / Following Modal */}
      {followModalType && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setFollowModalType(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white capitalize">
                  {followModalType}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFollowModalType(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {loadingList ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <span className="text-xs">Loading {followModalType}...</span>
                </div>
              ) : followList.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-xs">
                  No {followModalType} to show yet.
                </div>
              ) : (
                followList.map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    onFollowToggle={handleListFollowToggle}
                    onUserClick={(uid) => {
                      setFollowModalType(null);
                      onUserClick?.(uid);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
