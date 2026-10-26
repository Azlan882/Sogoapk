import React, { useState, useEffect } from 'react';
import { NotificationItem, Post } from '../types';
import { Avatar } from '../components/Avatar';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { timeAgo } from '../lib/utils';
import { Heart, MessageCircle, UserPlus, Sparkles, Check, Film, Bell, ArrowRight, Repeat2, Gift } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import * as notificationsService from '../services/notificationsService';
import * as postsService from '../services/postsService';

export interface NotificationsProps {
  onUserClick?: (userId: string) => void;
  onPostClick?: (post: Post) => void;
  onVideoClick?: (videoId?: string) => void;
}

export const Notifications: React.FC<NotificationsProps> = ({
  onUserClick,
  onPostClick,
  onVideoClick,
}) => {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  // Subscribe in real-time to Firestore notifications (strictly in-app, filtering out device-only notifications)
  useEffect(() => {
    if (!currentUser?.id) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = notificationsService.subscribeNotifications(
      currentUser.id,
      (items) => {
        setNotifications(items.filter((n) => n.type !== 'sogo_stars'));
        setLoading(false);
      },
      (err) => {
        console.warn('Could not listen for real-time notifications:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.id]);

  useEffect(() => {
    const handleProfileUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        userId: string;
        displayName?: string;
        avatarUrl?: string;
        user?: { displayName?: string; avatarUrl?: string };
      }>;
      const detail = customEvent.detail;
      if (!detail?.userId) return;
      const newName = detail.displayName || detail.user?.displayName;
      const newAvatar = detail.avatarUrl || detail.user?.avatarUrl;

      setNotifications((prev) =>
        prev.map((n) => {
          if (n.actorUserId === detail.userId || n.fromUser?.id === detail.userId) {
            return {
              ...n,
              fromUser: {
                ...n.fromUser,
                ...(newName ? { displayName: newName } : {}),
                ...(newAvatar ? { avatarUrl: newAvatar } : {}),
              },
            };
          }
          return n;
        })
      );
    };

    window.addEventListener('sogo_profile_updated', handleProfileUpdated);
    return () => {
      window.removeEventListener('sogo_profile_updated', handleProfileUpdated);
    };
  }, []);

  const markAllAsRead = async () => {
    if (!currentUser?.id) return;
    // Optimistic UI update
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await notificationsService.markAllNotificationsAsRead(currentUser.id);
  };

  const handleNotificationClick = async (notif: NotificationItem) => {
    // 1. Mark as read in Firestore
    if (!notif.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
      notificationsService.markNotificationAsRead(notif.id).catch((err) => {
        console.warn('Failed to mark notification as read:', err);
      });
    }

    setNavigatingId(notif.id);

    try {
      // 2. Route based on notification type and target ID
      if (
        notif.type === 'video_like' ||
        notif.type === 'video_comment' ||
        notif.type === 'video_repost' ||
        notif.videoId
      ) {
        if (onVideoClick) {
          onVideoClick(notif.videoId);
        }
        return;
      }

      if (notif.postId) {
        const post = await postsService.getPostById(notif.postId);
        if (post && onPostClick) {
          onPostClick(post);
          return;
        }
      }

      // Default or follow action: navigate to actor profile
      if (onUserClick) {
        onUserClick(notif.actorUserId || notif.fromUser.id);
      }
    } finally {
      setNavigatingId(null);
    }
  };

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'like':
        return <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />;
      case 'video_like':
        return <Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500" />;
      case 'comment':
        return <MessageCircle className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400/20" />;
      case 'video_comment':
        return <MessageCircle className="w-3.5 h-3.5 text-teal-400 fill-teal-400/20" />;
      case 'repost':
      case 'video_repost':
        return <Repeat2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'referral':
        return <Gift className="w-3.5 h-3.5 text-purple-400" />;
      case 'follow':
        return <UserPlus className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  const getMessage = (notif: NotificationItem) => {
    switch (notif.type) {
      case 'like':
        return 'liked your post';
      case 'video_like':
        return 'liked your Reel';
      case 'comment':
        return notif.text ? `commented: "${notif.text}"` : 'commented on your post';
      case 'video_comment':
        return notif.text ? `commented: "${notif.text}"` : 'commented on your Reel';
      case 'repost':
        return 'reposted your post';
      case 'video_repost':
        return 'reposted your Reel';
      case 'follow':
        return 'started following you';
      case 'referral':
        return notif.text || 'joined using your invite code';
      default:
        return 'interacted with your profile';
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Notifications</h1>
            <p className="text-xs text-slate-400">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
                : 'All caught up!'}
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs text-slate-400">Loading notifications...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 px-4 bg-slate-900/40 rounded-2xl border border-slate-800/60">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Bell className="w-6 h-6 opacity-40" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">No notifications yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            When someone likes, comments, reposts, or follows your profile, you'll see it here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/50 space-y-1">
          {notifications.map((notif) => {
            const isNavigating = navigatingId === notif.id;

            return (
              <div
                key={notif.id}
                onClick={() => handleNotificationClick(notif)}
                className={`flex items-center justify-between py-3.5 px-3 -mx-2 rounded-xl transition-all cursor-pointer group hover:bg-slate-800/60 ${
                  !notif.read
                    ? 'bg-cyan-950/25 border border-cyan-500/20 shadow-xs'
                    : 'border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    <Avatar
                      src={notif.fromUser.avatarUrl}
                      alt={notif.fromUser.displayName}
                      size="md"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUserClick?.(notif.actorUserId || notif.fromUser.id);
                      }}
                    />
                    <div className="absolute -bottom-1 -right-1 p-1 bg-slate-900 rounded-full border border-slate-700 shadow-xs">
                      {getIcon(notif.type)}
                    </div>
                  </div>

                  <div className="min-w-0 text-sm flex-1">
                    <p className="text-slate-300 leading-snug break-words line-clamp-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUserClick?.(notif.actorUserId || notif.fromUser.id);
                        }}
                        className="font-bold text-white hover:underline mr-1 inline-flex items-center gap-1 align-baseline focus:outline-none"
                      >
                        <span>{notif.fromUser.displayName}</span>
                        <VerifiedBadge
                          userId={notif.actorUserId || notif.fromUser.id}
                          username={notif.fromUser.username}
                          isVerified={notif.fromUser.isVerified}
                          size="xs"
                        />
                      </button>
                      <span className="text-slate-400">{getMessage(notif)}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">
                        {timeAgo(notif.timestamp || notif.createdAt)}
                      </span>
                      {!notif.read && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-cyan-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Right preview: Post/Video thumbnail or Arrow */}
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {notif.postImageUrl ? (
                    <div className="relative group/thumb">
                      <img
                        src={notif.postImageUrl}
                        alt="Content reference"
                        className="w-12 h-12 rounded-lg object-cover border border-slate-800 group-hover/thumb:border-cyan-500/50 transition-colors"
                      />
                      {(notif.type === 'video_like' || notif.type === 'video_comment' || notif.videoId) && (
                        <div className="absolute bottom-0.5 right-0.5 p-0.5 bg-black/70 rounded text-cyan-400">
                          <Film className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
