import React from 'react';
import { Header } from '../components/Header';
import { BottomNavigation } from '../components/BottomNavigation';
import { ActiveTab, CreateIntent } from '../types';

export interface AppShellProps {
  children: React.ReactNode;
  currentTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onNavigateCreate?: (intent: CreateIntent) => void;
  showCreateButton?: boolean;
  unreadNotificationsCount?: number;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  currentTab,
  onTabChange,
  onNavigateCreate,
  showCreateButton,
  unreadNotificationsCount = 0,
}) => {
  const isVideoFeed = currentTab === 'videos';

  return (
    <div className={`min-h-screen flex flex-col bg-[#0B0F1A] text-slate-200 ${isVideoFeed ? 'pb-16' : 'pb-20 sm:pb-24'}`}>
      {/* Top Header (omitted in immersive Reels view where Reels has its own overlay header) */}
      {!isVideoFeed && (
        <Header
          currentTab={currentTab}
          onTabChange={onTabChange}
          onNavigateCreate={onNavigateCreate}
          showCreateButton={showCreateButton}
          unreadNotificationsCount={unreadNotificationsCount}
        />
      )}

      {/* Main Content Area */}
      <main
        className={
          isVideoFeed
            ? 'flex-1 w-full max-w-md mx-auto p-0 relative overflow-hidden'
            : 'flex-1 w-full max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6'
        }
      >
        {children}
      </main>

      {/* Persistent Bottom Bar */}
      <BottomNavigation
        currentTab={currentTab}
        onTabChange={onTabChange}
        unreadNotificationsCount={unreadNotificationsCount}
      />
    </div>
  );
};
