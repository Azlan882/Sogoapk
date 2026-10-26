import React from 'react';
import { Home, Bell, User, Film } from 'lucide-react';
import { ActiveTab } from '../types';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import { Avatar } from './Avatar';

export interface BottomNavigationProps {
  currentTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  unreadNotificationsCount?: number;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  currentTab,
  onTabChange,
  unreadNotificationsCount = 0,
}) => {
  const { currentUser } = useAuth();

  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    isProfile?: boolean;
    showBadge?: boolean;
  }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'videos', label: 'Reels', icon: Film },
    { id: 'notifications', label: 'Notifications', icon: Bell, showBadge: true },
    { id: 'profile', label: 'Profile', icon: User, isProfile: true },
  ];

  return (
    <nav
      aria-label="Bottom Navigation"
      className="fixed bottom-0 inset-x-0 z-30 bg-[#0F172A]/95 backdrop-blur-md border-t border-slate-800 px-2 py-1.5 sm:py-2"
    >
      <div className="max-w-md mx-auto grid grid-cols-4 items-center">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const IconComponent = item.icon;

          if (item.isProfile && currentUser) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className="flex flex-col items-center justify-center py-1.5 focus:outline-none group cursor-pointer"
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <div
                  className={cn(
                    'p-0.5 rounded-full transition-all',
                    isActive ? 'ring-2 ring-cyan-400' : 'opacity-70 group-hover:opacity-100'
                  )}
                >
                  <Avatar
                    src={currentUser.avatarUrl}
                    alt={currentUser.displayName}
                    size="xs"
                  />
                </div>
                <span
                  className={cn(
                    'text-[10px] mt-1 font-medium transition-colors',
                    isActive ? 'text-cyan-400 font-bold' : 'text-slate-400 group-hover:text-slate-200'
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className="flex flex-col items-center justify-center py-1.5 focus:outline-none group cursor-pointer"
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative flex items-center justify-center">
                <IconComponent
                  className={cn(
                    'w-5 h-5 transition-transform duration-150',
                    isActive
                      ? 'text-cyan-400 stroke-[2.5px] scale-105'
                      : 'text-slate-400 group-hover:text-slate-200'
                  )}
                />
                {item.showBadge && unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-2 h-2 bg-cyan-400 rounded-full ring-2 ring-[#0F172A] animate-pulse" />
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] mt-1 font-medium transition-colors',
                  isActive ? 'text-cyan-400 font-bold' : 'text-slate-400 group-hover:text-slate-200'
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
