import React, { useEffect, useState } from 'react';
import {
  resolveUserVerified,
  syncVerifiedUsersFromFirestore,
} from '../services/usersService';

export interface VerifiedBadgeProps {
  userId?: string;
  username?: string;
  isVerified?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

/**
 * Reusable SogoSocial Verified Blue Tick badge component.
 * Automatically resolves and stays in sync with the user's authoritative
 * Firestore verification status across Profile, Home feed, Posts, Reels,
 * Stories, Comments, Notifications, Search results, and Admin views.
 */
export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  userId,
  username,
  isVerified,
  size = 'sm',
  className = '',
  title = 'Verified SogoSocial Account',
}) => {
  const [verified, setVerified] = useState<boolean>(() =>
    resolveUserVerified(userId, isVerified, username)
  );

  useEffect(() => {
    setVerified(resolveUserVerified(userId, isVerified, username));
  }, [userId, username, isVerified]);

  useEffect(() => {
    // Ensure authoritative verified map is synced from Firestore in background
    syncVerifiedUsersFromFirestore().then(() => {
      setVerified(resolveUserVerified(userId, isVerified, username));
    });

    const handleVerificationUpdated = () => {
      setVerified(resolveUserVerified(userId, isVerified, username));
    };

    window.addEventListener('sogo_verification_updated', handleVerificationUpdated);
    window.addEventListener('sogo_profile_updated', handleVerificationUpdated);
    return () => {
      window.removeEventListener('sogo_verification_updated', handleVerificationUpdated);
      window.removeEventListener('sogo_profile_updated', handleVerificationUpdated);
    };
  }, [userId, username, isVerified]);

  if (!verified) return null;

  const sizeClasses: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
    xs: 'w-3.5 h-3.5',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-5.5 h-5.5',
  };

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 select-none ${sizeClasses[size]} ${className}`}
      title={title}
      aria-label="Verified"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-full h-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10.5" className="fill-[#1DA1F2]" />
        <path
          d="M8.2 12.3L10.8 14.9L16.2 9.5"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
};
