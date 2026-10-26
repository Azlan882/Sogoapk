import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import * as authService from '../services/authService';
import * as rewardsService from '../services/rewardsService';
import * as usersService from '../services/usersService';
import { adminService, AUTHORIZED_ADMIN_EMAIL } from '../services/adminService';
import { initBlockService } from '../services/blockService';
import { auth } from '../lib/firebase';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  needsOnboarding: boolean;
  isAdmin: boolean;
  isAdminClaimActive: boolean;
  refreshAdminStatus: () => Promise<void>;
  syncAdminRole: () => Promise<{ success: boolean; message: string }>;
  loginWithGoogle: () => Promise<User>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void> | void;
  completeOnboarding: (profileData: {
    displayName: string;
    username: string;
    birthday: string;
    avatarUrl: string;
    bio?: string;
    website?: string;
    referralCode?: string;
  }) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminClaimActive, setIsAdminClaimActive] = useState<boolean>(false);
  const checkedAdminUidRef = React.useRef<string | null>(null);

  const checkAdminClaims = useCallback(async (forceRefresh: boolean = true) => {
    try {
      const result = await adminService.verifyAdminClaims(forceRefresh);
      setIsAdminClaimActive(result.isAdminClaim);
      return result.isAdminClaim;
    } catch {
      setIsAdminClaimActive(false);
      return false;
    }
  }, []);

  useEffect(() => {
    try {
      const cached = localStorage.getItem('sogo_auth_user');
      if (cached) {
        setCurrentUser(JSON.parse(cached));
      }
    } catch {}

    // Initialize Capacitor SocialLogin plugin once on startup
    authService.initializeSocialLogin();
    void usersService.syncVerifiedUsersFromFirestore();

    const unsubscribe = authService.subscribeToAuthState((user, isVerified) => {
      if (user && isVerified !== false) {
        setCurrentUser(user);
        initBlockService(user.id);
        setLoading(false);

        if (adminService.isAuthorizedAdminEmail(user.email)) {
          if (checkedAdminUidRef.current !== user.id) {
            checkedAdminUidRef.current = user.id;
            // Verify admin claims asynchronously in the background so startup is never blocked
            void checkAdminClaims(false);
          }
        } else {
          checkedAdminUidRef.current = null;
          setIsAdminClaimActive(false);
        }
      } else {
        checkedAdminUidRef.current = null;
        setCurrentUser(null);
        initBlockService();
        setIsAdminClaimActive(false);
        setLoading(false);
      }
    });

    const handleProfileUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        userId: string;
        displayName?: string;
        avatarUrl?: string;
        user?: Partial<User>;
      }>;
      const detail = customEvent.detail;
      if (!detail?.userId) return;
      setCurrentUser((prev) => {
        if (!prev || prev.id !== detail.userId) return prev;
        return {
          ...prev,
          ...(detail.user || {}),
          ...(detail.displayName ? { displayName: detail.displayName } : {}),
          ...(detail.avatarUrl ? { avatarUrl: detail.avatarUrl } : {}),
        };
      });
    };

    const handleVerificationChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ userId: string; isVerified: boolean }>;
      const detail = customEvent.detail;
      if (!detail?.userId) return;
      setCurrentUser((prev) => {
        if (!prev || prev.id !== detail.userId) return prev;
        return {
          ...prev,
          isVerified: detail.isVerified,
        };
      });
    };

    window.addEventListener('sogo_profile_updated', handleProfileUpdated);
    window.addEventListener('sogo:user_verification_changed', handleVerificationChanged);

    return () => {
      unsubscribe();
      window.removeEventListener('sogo_profile_updated', handleProfileUpdated);
      window.removeEventListener('sogo:user_verification_changed', handleVerificationChanged);
    };
  }, [checkAdminClaims]);

  const refreshAdminStatus = async () => {
    await checkAdminClaims(true);
  };

  const syncAdminRole = async (): Promise<{ success: boolean; message: string }> => {
    const res = await adminService.syncAdminClaim();
    await checkAdminClaims(true);
    return res;
  };

  const loginWithGoogle = async (): Promise<User> => {
    setLoading(true);
    try {
      const user = await authService.loginWithGoogle();
      setCurrentUser(user);
      if (adminService.isAuthorizedAdminEmail(user.email)) {
        await checkAdminClaims(true);
      }
      return user;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await authService.logout();
    setCurrentUser(null);
    setIsAdminClaimActive(false);
  };

  const updateProfile = async (data: Partial<User>) => {
    if (currentUser) {
      const updated = { ...currentUser, ...data };
      setCurrentUser(updated);
      try {
        await authService.saveCurrentUser(updated);
      } catch (err) {
        console.warn('Could not persist updated profile in auth context:', err);
      }
    }
  };

  const completeOnboarding = async (profileData: {
    displayName: string;
    username: string;
    birthday: string;
    avatarUrl: string;
    bio?: string;
    website?: string;
    referralCode?: string;
  }): Promise<User> => {
    if (!currentUser?.id) {
      throw new Error('No authenticated user session found.');
    }
    const updated = await authService.completeUserProfile(currentUser.id, profileData);

    // Process referral attribution AFTER /users/{uid} with isOnboarded: true is committed to Firestore
    // and BEFORE setCurrentUser(updated) unmounts <Onboarding />
    const activeRefCode =
      profileData.referralCode?.trim() || rewardsService.getPendingReferralCode();
    if (activeRefCode) {
      const regResult = await rewardsService.registerReferral({
        referralCode: activeRefCode,
        referredUser: updated,
      });
      if (!regResult.success && profileData.referralCode?.trim()) {
        throw new Error(regResult.message || 'Failed to apply referral code.');
      }
      if (regResult.success) {
        await rewardsService.qualifyReferral(updated.id);
      }
    }

    setCurrentUser(updated);
    return updated;
  };

  const needsOnboarding = Boolean(
    currentUser &&
    currentUser.id &&
    !currentUser.id.startsWith('user_') &&
    currentUser.isOnboarded !== true &&
    !currentUser.birthday
  );

  // Strictly check that user email is the authorized admin email AND custom claim admin === true
  const isEmailAdmin = Boolean(currentUser?.email && currentUser.email.toLowerCase().trim() === AUTHORIZED_ADMIN_EMAIL);
  const isAdmin = Boolean(isEmailAdmin && isAdminClaimActive);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
        needsOnboarding,
        isAdmin,
        isAdminClaimActive,
        refreshAdminStatus,
        syncAdminRole,
        loginWithGoogle,
        logout,
        updateProfile,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

