import React from 'react';
import { User } from '../types';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { formatNumber } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';

export interface UserCardProps {
  user: User;
  onFollowToggle: (userId: string) => void;
  onUserClick?: (userId: string) => void;
}

export const UserCard: React.FC<UserCardProps> = ({ user, onFollowToggle, onUserClick }) => {
  return (
    <div className="flex items-center justify-between p-3.5 bg-slate-900 rounded-xl border border-slate-800 shadow-sm hover:border-slate-700 transition-all">
      <div className="flex items-center gap-3 min-w-0 pr-3">
        <Avatar
          src={user.avatarUrl}
          alt={user.displayName}
          size="md"
          onClick={() => onUserClick?.(user.id)}
        />
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onUserClick?.(user.id)}
            className="font-bold text-sm text-white hover:underline flex items-center gap-1 truncate text-left focus:outline-none"
          >
            <span className="truncate">{user.displayName}</span>
            <VerifiedBadge
              userId={user.id}
              username={user.username}
              isVerified={user.isVerified}
              size="sm"
            />
          </button>
          <p className="text-xs text-slate-400 truncate">@{user.username}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
            {formatNumber(user.followersCount)} followers
          </p>
        </div>
      </div>

      <Button
        variant={user.isFollowing ? 'secondary' : 'primary'}
        size="sm"
        onClick={() => onFollowToggle(user.id)}
        className="shrink-0 text-xs px-3 py-1"
      >
        {user.isFollowing ? 'Following' : 'Follow'}
      </Button>
    </div>
  );
};
