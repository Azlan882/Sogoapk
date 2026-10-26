import React, { useState, useEffect } from 'react';
import { UserX, Loader2 } from 'lucide-react';
import { blockUser } from '../services/blockService';
import { getUser } from '../services/usersService';
import { Avatar } from './Avatar';

interface BlockConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUserId: string;
  targetUsername?: string;
  targetDisplayName?: string;
  targetAvatarUrl?: string;
  onBlockedSuccess?: () => void;
}

export const BlockConfirmModal: React.FC<BlockConfirmModalProps> = ({
  isOpen,
  onClose,
  targetUserId,
  targetUsername,
  targetDisplayName,
  targetAvatarUrl,
  onBlockedSuccess,
}) => {
  const [isBlocking, setIsBlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    displayName?: string;
    username?: string;
    avatarUrl?: string;
  }>({
    displayName: targetDisplayName,
    username: targetUsername,
    avatarUrl: targetAvatarUrl,
  });

  useEffect(() => {
    setProfile({
      displayName: targetDisplayName,
      username: targetUsername,
      avatarUrl: targetAvatarUrl,
    });

    if (isOpen && targetUserId && (!targetDisplayName || !targetAvatarUrl)) {
      getUser(targetUserId)
        .then((u) => {
          if (u) {
            setProfile((prev) => ({
              displayName: prev.displayName || u.displayName,
              username: prev.username || u.username,
              avatarUrl: prev.avatarUrl || u.avatarUrl,
            }));
          }
        })
        .catch(() => {});
    }
  }, [isOpen, targetUserId, targetDisplayName, targetAvatarUrl, targetUsername]);

  if (!isOpen) return null;

  const rawDisplayName = profile.displayName?.trim();
  const rawUsername = profile.username?.trim() || targetUsername?.trim() || '';
  const resolvedDisplayName = rawDisplayName || rawUsername || 'User';

  const cleanUsername = rawUsername
    ? rawUsername.startsWith('@')
      ? rawUsername
      : `@${rawUsername}`
    : '';

  const handleConfirmBlock = async () => {
    setIsBlocking(true);
    setError(null);
    try {
      await blockUser(targetUserId, {
        username: profile.username || targetUsername,
        displayName: profile.displayName || targetDisplayName,
        avatarUrl: profile.avatarUrl || targetAvatarUrl,
      });
      onBlockedSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to block user. Please try again.');
    } finally {
      setIsBlocking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs sm:max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl relative text-slate-100 text-center space-y-3.5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Existing block icon */}
        <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto shadow-xs">
          <UserX className="w-6 h-6" />
        </div>

        {/* 2. Target user's profile picture/avatar */}
        <div className="flex justify-center -mt-0.5">
          <Avatar
            src={profile.avatarUrl}
            alt={resolvedDisplayName}
            size="lg"
            className="ring-2 ring-slate-700 shadow-md"
          />
        </div>

        {/* 3. Target user's display name and @username */}
        <div className="space-y-0.5">
          <h3
            id="block-dialog-title"
            className="text-base sm:text-lg font-bold text-white truncate max-w-[260px] mx-auto"
          >
            {resolvedDisplayName}
          </h3>
          {cleanUsername && (
            <p className="text-xs sm:text-sm font-semibold text-slate-400 truncate max-w-[260px] mx-auto">
              {cleanUsername}
            </p>
          )}
        </div>

        {/* 4. Short confirmation message */}
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed px-1">
          They won't appear in your feed, and their content will be hidden from you.
        </p>

        {/* Error message if failure */}
        {error && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 text-left">
            {error}
          </div>
        )}

        {/* 5. Existing Cancel and Block buttons at the bottom */}
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isBlocking}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 border border-slate-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmBlock}
            disabled={isBlocking}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 transition-all shadow-md shadow-rose-600/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isBlocking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Blocking...</span>
              </>
            ) : (
              <span>Block</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
