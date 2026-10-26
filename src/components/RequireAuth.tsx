import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { LoadingState } from './LoadingState';

export interface RequireAuthProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children, fallback = null }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <LoadingState message="Checking session..." />;
  }

  if (!currentUser) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
