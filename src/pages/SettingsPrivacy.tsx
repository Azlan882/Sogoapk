import React, { useState } from 'react';
import { ArrowLeft, Lock, MessageSquare, Share2, UserX, ShieldCheck, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { BlockedUsersModal } from '../components/BlockedUsersModal';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import { getBlockedUserIds } from '../services/blockService';

export interface SettingsPrivacyProps {
  onBack: () => void;
  onLogout?: () => void;
}

export const SettingsPrivacy: React.FC<SettingsPrivacyProps> = ({ onBack, onLogout }) => {
  const [isPrivate, setIsPrivate] = useState(false);
  const [allowCommentsFrom, setAllowCommentsFrom] = useState<'everyone' | 'following'>('everyone');
  const [allowStorySharing, setAllowStorySharing] = useState(true);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const blockedCount = getBlockedUserIds().length;

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  return (
    <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 sm:p-8 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
        <button
          type="button"
          onClick={onBack}
          className="p-2 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-colors focus:outline-none"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">Privacy & Security</h1>
          <p className="text-xs text-slate-400">Manage your visibility and data protections</p>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-3 bg-emerald-950/40 text-emerald-300 border border-emerald-800/60 rounded-xl text-xs font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Privacy preferences saved successfully!
        </div>
      )}

      {/* Account Privacy */}
      <div className="space-y-4">
        <div className="flex items-start justify-between p-4 bg-slate-800/60 rounded-2xl border border-slate-700/80">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-slate-400 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-white">Private Account</p>
              <p className="text-xs text-slate-400 max-w-sm mt-0.5 leading-relaxed">
                When your account is private, only approved followers can view your feed publications and stories.
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="w-4 h-4 accent-cyan-400 rounded cursor-pointer mt-1"
          />
        </div>

        {/* Comment Controls */}
        <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700/80 space-y-3">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-5 h-5 text-slate-400" />
            <h3 className="text-sm font-bold text-white">Comments Control</h3>
          </div>
          <p className="text-xs text-slate-400">Who can leave comments on your posts:</p>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="comments_pref"
                checked={allowCommentsFrom === 'everyone'}
                onChange={() => setAllowCommentsFrom('everyone')}
                className="accent-cyan-400"
              />
              Everyone on SogoSocial
            </label>
            <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="comments_pref"
                checked={allowCommentsFrom === 'following'}
                onChange={() => setAllowCommentsFrom('following')}
                className="accent-cyan-400"
              />
              People you follow
            </label>
          </div>
        </div>

        {/* Sharing Permissions */}
        <div className="flex items-start justify-between p-4 bg-slate-800/60 rounded-2xl border border-slate-700/80">
          <div className="flex items-start gap-3">
            <Share2 className="w-5 h-5 text-slate-400 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-white">Story Resharing</p>
              <p className="text-xs text-slate-400 max-w-sm mt-0.5 leading-relaxed">
                Allow other people to share your posts or stories to their messaging channels.
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={allowStorySharing}
            onChange={(e) => setAllowStorySharing(e.target.checked)}
            className="w-4 h-4 accent-cyan-400 rounded cursor-pointer mt-1"
          />
        </div>

        {/* Blocked Accounts */}
        <button
          type="button"
          onClick={() => setIsBlockedModalOpen(true)}
          className="w-full flex items-center justify-between p-4 bg-slate-800/60 hover:bg-slate-800/90 rounded-2xl border border-slate-700/80 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <UserX className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm font-bold text-white">Blocked Accounts</p>
              <p className="text-xs text-slate-400">
                {blockedCount} {blockedCount === 1 ? 'user' : 'users'} currently blocked
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>

        {/* Delete Account */}
        <button
          type="button"
          onClick={() => setIsDeleteModalOpen(true)}
          className="w-full flex items-center justify-between p-4 bg-rose-950/20 hover:bg-rose-950/40 rounded-2xl border border-rose-900/40 transition-colors text-left cursor-pointer group"
        >
          <div className="flex items-center gap-3">
            <Trash2 className="w-5 h-5 text-rose-400" />
            <div>
              <p className="text-sm font-bold text-rose-400 group-hover:text-rose-300">Delete Account</p>
              <p className="text-xs text-slate-400">Permanently remove profile and all personal data</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="pt-2 flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave}>
          Save Preferences
        </Button>
      </div>

      <BlockedUsersModal
        isOpen={isBlockedModalOpen}
        onClose={() => setIsBlockedModalOpen(false)}
      />

      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onDeletedSuccess={() => {
          setIsDeleteModalOpen(false);
          onLogout ? onLogout() : onBack();
        }}
      />
    </div>
  );
};
