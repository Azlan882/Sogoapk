import React, { useState, useEffect } from 'react';
import { Plus, Camera, Film, CircleDot } from 'lucide-react';
import { ActiveTab, CreateIntent } from '../types';
import { registerBackInterceptor } from '../services/backButtonService';
import { cn } from '../lib/utils';
import sogoLogo from '../assets/sogo-mark.svg';

export interface HeaderProps {
  currentTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onNavigateCreate?: (intent: CreateIntent) => void;
  showCreateButton?: boolean;
  unreadNotificationsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  onNavigateCreate,
  showCreateButton,
}) => {
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const isHomeHeader = showCreateButton !== undefined ? showCreateButton : currentTab === 'home';

  // Close Create menu automatically when navigating away from Home
  useEffect(() => {
    if (!isHomeHeader) {
      setIsCreateMenuOpen(false);
    }
  }, [isHomeHeader, currentTab]);

  // Register Android hardware Back button & Escape key interceptor while Create menu is open
  useEffect(() => {
    if (!isCreateMenuOpen) return;

    const unregisterBack = registerBackInterceptor(() => {
      setIsCreateMenuOpen(false);
      return true;
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCreateMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unregisterBack();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCreateMenuOpen]);

  const handleSelectCreateIntent = (intent: CreateIntent) => {
    setIsCreateMenuOpen(false);
    if (onNavigateCreate) {
      onNavigateCreate(intent);
    } else {
      onTabChange('create');
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#0F172A]/90 backdrop-blur-md border-b border-slate-800 transition-all">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Brand Logo */}
          <button
            type="button"
            onClick={() => {
              setIsCreateMenuOpen(false);
              onTabChange('home');
            }}
            className="flex items-center gap-2.5 focus:outline-none group cursor-pointer"
          >
            <img
              src={sogoLogo}
              alt="SogoSocial"
              className="w-9 h-9 object-contain drop-shadow-md group-hover:scale-105 transition-transform"
            />
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              SogoSocial
            </span>
          </button>

          {/* Top-Right Create (+) Button on Home */}
          {isHomeHeader && (
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => setIsCreateMenuOpen((prev) => !prev)}
                aria-label="Create"
                aria-haspopup="menu"
                aria-expanded={isCreateMenuOpen}
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center border transition-all focus:outline-none cursor-pointer',
                  isCreateMenuOpen
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-lg shadow-cyan-500/25'
                    : 'bg-slate-800/90 hover:bg-slate-800 text-slate-100 hover:text-cyan-400 border-slate-700/80'
                )}
              >
                <Plus
                  className={cn(
                    'w-5 h-5 stroke-[2.5px] transition-transform duration-200',
                    isCreateMenuOpen && 'rotate-45'
                  )}
                />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Top-Right (+) Create Menu Overlay */}
      {isHomeHeader && isCreateMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setIsCreateMenuOpen(false)}
            aria-hidden="true"
          />

          <div className="fixed inset-x-0 top-14 z-50 pointer-events-none">
            <div className="max-w-2xl mx-auto relative px-4">
              <div
                role="menu"
                aria-label="Create"
                className="pointer-events-auto absolute right-4 top-2 w-44 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-150"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelectCreateIntent('post')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-105 transition-transform">
                    <Camera className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold text-slate-100 group-hover:text-cyan-400 transition-colors">
                    Post
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelectCreateIntent('reel')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0 group-hover:scale-105 transition-transform">
                    <Film className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold text-slate-100 group-hover:text-purple-400 transition-colors">
                    Reel
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelectCreateIntent('story')}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-800 active:bg-slate-800 transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 group-hover:scale-105 transition-transform">
                    <CircleDot className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold text-slate-100 group-hover:text-amber-400 transition-colors">
                    Story
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};
