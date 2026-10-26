import { useState, useEffect, useRef, useCallback } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppShell } from './layouts/AppShell';
import { ActiveTab, Post, CreateIntent } from './types';
import * as notificationsService from './services/notificationsService';
import { Home } from './pages/Home';
import { Discover } from './pages/Discover';
import { CreatePost } from './pages/CreatePost';
import { Videos } from './pages/Videos';
import { Bookmarks } from './pages/Bookmarks';
import { Notifications } from './pages/Notifications';
import { Profile, ProfileSubTab } from './pages/Profile';
import { PostDetail } from './pages/PostDetail';
import { Settings } from './pages/Settings';
import { SettingsPrivacy } from './pages/SettingsPrivacy';
import { CreatorRewards } from './pages/CreatorRewards';
import { Login } from './pages/Login';
import { Splash } from './pages/Splash';
import { Onboarding } from './pages/Onboarding';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import * as rewardsService from './services/rewardsService';
import * as postsService from './services/postsService';
import { initAppBackButton, executeTopInterceptor } from './services/backButtonService';
import { extractPostIdFromUrl, extractVideoIdFromUrl } from './services/shareService';
import { App as CapApp } from '@capacitor/app';
import { checkAppVersion, VersionCheckResult } from './services/appVersionService';
import { ForceUpdateScreen } from './components/ForceUpdateScreen';
import sogoLogo from './assets/sogo-mark.svg';
import { perf } from './utils/perfLogger';
import { scrollFeedToTop } from './lib/utils';
import {
  initSogoStarsNotificationListeners,
  syncSogoStarsReminder,
  cancelSogoStarsReminder,
  shouldOpenStarsOnLaunch,
} from './services/sogoStarsNotificationService';
import {
  preloadCreatorRewardsInterstitial,
  showCreatorRewardsInterstitial,
} from './services/interstitialAdService';
import { tryShowAppOpenAd } from './services/appOpenAdService';
import { initInstallReferrerAttribution } from './services/installReferrerService';

// Initialize Android notification listeners immediately so cold start taps are captured
initSogoStarsNotificationListeners();

interface ScreenState {
  tab: ActiveTab;
  subView: 'none' | 'settings' | 'settings-privacy' | 'creator-rewards' | 'admin';
  selectedPost: Post | null;
  selectedVideoId: string | null;
  selectedVideoUserId: string | null;
  viewingUserId: string | null;
  profileSubTab: ProfileSubTab;
  createIntent: CreateIntent;
}

function MainNavigator() {
  const { currentUser, loading, needsOnboarding, logout, completeOnboarding } = useAuth();
  const [currentTab, setCurrentTab] = useState<ActiveTab>('home');
  const [createIntent, setCreateIntent] = useState<CreateIntent>('post');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedVideoUserId, setSelectedVideoUserId] = useState<string | null>(null);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [profileSubTab, setProfileSubTab] = useState<ProfileSubTab>('posts');
  const [subView, setSubView] = useState<'none' | 'settings' | 'settings-privacy' | 'creator-rewards' | 'admin'>('none');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isResolvingDeepLink, setIsResolvingDeepLink] = useState(false);
  const [deepLinkMessage, setDeepLinkMessage] = useState<string | null>(null);
  const [homeRefreshTrigger, setHomeRefreshTrigger] = useState(0);
  const [creatorRewardsInitialFocus, setCreatorRewardsInitialFocus] = useState<'stars' | 'overview'>('overview');

  // In-app screen history stack for hardware Back button & in-app back navigation
  const isPoppingRef = useRef(false);
  const historyStackRef = useRef<ScreenState[]>([
    {
      tab: 'home',
      subView: 'none',
      selectedPost: null,
      selectedVideoId: null,
      selectedVideoUserId: null,
      viewingUserId: null,
      profileSubTab: 'posts',
      createIntent: 'post',
    },
  ]);

  // Track state changes to record history entries
  useEffect(() => {
    if (isPoppingRef.current) {
      return;
    }

    const currentState: ScreenState = {
      tab: currentTab,
      subView,
      selectedPost,
      selectedVideoId,
      selectedVideoUserId,
      viewingUserId,
      profileSubTab,
      createIntent: currentTab === 'create' ? createIntent : 'post',
    };

    const stack = historyStackRef.current;
    const top = stack[stack.length - 1];

    const isSame =
      top &&
      top.tab === currentState.tab &&
      top.subView === currentState.subView &&
      top.selectedPost?.id === currentState.selectedPost?.id &&
      top.selectedVideoId === currentState.selectedVideoId &&
      top.selectedVideoUserId === currentState.selectedVideoUserId &&
      top.viewingUserId === currentState.viewingUserId &&
      top.profileSubTab === currentState.profileSubTab &&
      top.createIntent === currentState.createIntent;

    if (!isSame) {
      // If user navigated directly to the root home feed (with no active subviews or detail screens),
      // reset the history stack so pressing Back from Home exits rather than ping-ponging
      if (
        currentState.tab === 'home' &&
        currentState.subView === 'none' &&
        !currentState.selectedPost &&
        !currentState.selectedVideoId &&
        !currentState.selectedVideoUserId &&
        !currentState.viewingUserId
      ) {
        historyStackRef.current = [currentState];
      } else {
        // When switching sub-tabs inside the same Profile view, update the top profile entry in place
        // so pressing Back from a Reel returns directly to the Profile sub-tab without stepping through every sub-tab click
        if (
          top &&
          top.tab === 'profile' &&
          currentState.tab === 'profile' &&
          top.subView === 'none' &&
          currentState.subView === 'none' &&
          !top.selectedPost &&
          !currentState.selectedPost &&
          !top.selectedVideoId &&
          !currentState.selectedVideoId &&
          !top.selectedVideoUserId &&
          !currentState.selectedVideoUserId &&
          top.viewingUserId === currentState.viewingUserId
        ) {
          historyStackRef.current[stack.length - 1] = currentState;
          return;
        }
        historyStackRef.current.push(currentState);
        if (historyStackRef.current.length > 50) {
          historyStackRef.current.shift();
        }
      }
    }
  }, [currentTab, subView, selectedPost, selectedVideoId, selectedVideoUserId, viewingUserId, profileSubTab, createIntent]);

  const handleScreenBack = useCallback((): boolean => {
    const stack = historyStackRef.current;

    // Pop the current state if previous history exists
    if (stack.length > 1) {
      stack.pop();
      const targetState = stack[stack.length - 1];

      if (targetState) {
        isPoppingRef.current = true;
        setCurrentTab(targetState.tab);
        setSubView(targetState.subView);
        setSelectedPost(targetState.selectedPost);
        setSelectedVideoId(targetState.selectedVideoId);
        setSelectedVideoUserId(targetState.selectedVideoUserId);
        setViewingUserId(targetState.viewingUserId);
        setProfileSubTab(targetState.profileSubTab);
        setCreateIntent(targetState.tab === 'create' ? targetState.createIntent : 'post');

        setTimeout(() => {
          isPoppingRef.current = false;
        }, 50);

        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/post')) {
          try {
            window.history.pushState(null, '', '/');
          } catch {}
        }

        return true; // Successfully navigated back
      }
    }

    // If stack has <= 1 entry but user is on a non-root screen (e.g. reload or direct deep-link),
    // navigate to Home root before allowing exit
    if (
      currentTab !== 'home' ||
      subView !== 'none' ||
      selectedPost !== null ||
      selectedVideoId !== null ||
      selectedVideoUserId !== null ||
      viewingUserId !== null
    ) {
      isPoppingRef.current = true;
      const rootState: ScreenState = {
        tab: 'home',
        subView: 'none',
        selectedPost: null,
        selectedVideoId: null,
        selectedVideoUserId: null,
        viewingUserId: null,
        profileSubTab: 'posts',
        createIntent: 'post',
      };
      historyStackRef.current = [rootState];
      setCurrentTab('home');
      setSubView('none');
      setSelectedPost(null);
      setSelectedVideoId(null);
      setSelectedVideoUserId(null);
      setViewingUserId(null);
      setProfileSubTab('posts');
      setCreateIntent('post');

      setTimeout(() => {
        isPoppingRef.current = false;
      }, 50);

      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/post')) {
        try {
          window.history.pushState(null, '', '/');
        } catch {}
      }

      return true;
    }

    // Already at root screen with no previous in-app history left -> allow exit/minimize
    return false;
  }, [currentTab, subView, selectedPost, selectedVideoId, selectedVideoUserId, viewingUserId]);

  const handleAppBack = useCallback(() => {
    if (executeTopInterceptor()) {
      return;
    }
    handleScreenBack();
  }, [handleScreenBack]);

  const handleScreenBackRef = useRef(handleScreenBack);
  handleScreenBackRef.current = handleScreenBack;

  // Initialize single Capacitor Android back button listener
  useEffect(() => {
    const cleanup = initAppBackButton(() => {
      return handleScreenBackRef.current();
    });
    return cleanup;
  }, []);

  // Handle shared post deep links (web URLs /post/:id, ?postId=, Capacitor App Links)
  useEffect(() => {
    let isMounted = true;

    async function resolvePostDeepLink(postId: string) {
      if (!postId || !postId.trim()) return;
      setIsResolvingDeepLink(true);
      try {
        const post = await postsService.getPostById(postId.trim());
        if (isMounted) {
          if (post) {
            if (post.isRepost && post.originalVideoId) {
              setSelectedVideoId(post.originalVideoId);
              setSelectedPost(null);
              setCurrentTab('videos');
              setSubView('none');
              return;
            }
            const canonicalId = post.originalPostId || post.id;
            const targetPost =
              post.isRepost && post.originalPostId
                ? (await postsService.getPostById(post.originalPostId)) || post
                : post;
            setSelectedPost(targetPost);
            setCurrentTab('home');
            setSubView('none');
            if (typeof window !== 'undefined' && !window.location.pathname.includes(canonicalId)) {
              try {
                window.history.replaceState({ postId: canonicalId }, '', `/post/${canonicalId}`);
              } catch {}
            }
          } else {
            setDeepLinkMessage('Shared post not found or has been removed.');
            setTimeout(() => {
              if (isMounted) setDeepLinkMessage(null);
            }, 4000);
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/post')) {
              try {
                window.history.replaceState(null, '', '/');
              } catch {}
            }
          }
        }
      } catch (err) {
        console.warn('Error resolving shared post deep link:', err);
      } finally {
        if (isMounted) {
          setIsResolvingDeepLink(false);
        }
      }
    }

    // 1. Initial browser URL check on web / webview launch
    try {
      const initialPostId = extractPostIdFromUrl(window.location.href);
      if (initialPostId) {
        resolvePostDeepLink(initialPostId);
      } else {
        const initialVideoId = extractVideoIdFromUrl(window.location.href);
        if (initialVideoId) {
          setSelectedVideoId(initialVideoId);
          setCurrentTab('videos');
        }
      }
    } catch (e) {
      console.error('Error parsing initial browser URL for deep link:', e);
    }

    // 2. Capacitor native App Launch URL check (for cold starts when launched via App Link)
    try {
      CapApp.getLaunchUrl().then((launchData) => {
        if (launchData?.url && isMounted) {
          const launchPostId = extractPostIdFromUrl(launchData.url);
          if (launchPostId) {
            resolvePostDeepLink(launchPostId);
          } else {
            const launchVideoId = extractVideoIdFromUrl(launchData.url);
            if (launchVideoId) {
              setSelectedVideoId(launchVideoId);
              setCurrentTab('videos');
            }
          }
        }
      }).catch(() => {});
    } catch {}

    // 3. Capacitor App Link event listener (for warm starts when app is already open)
    let appUrlOpenHandle: any = null;
    try {
      CapApp.addListener('appUrlOpen', (event) => {
        if (event?.url && isMounted) {
          const eventPostId = extractPostIdFromUrl(event.url);
          if (eventPostId) {
            resolvePostDeepLink(eventPostId);
          } else {
            const eventVideoId = extractVideoIdFromUrl(event.url);
            if (eventVideoId) {
              setSelectedVideoId(eventVideoId);
              setCurrentTab('videos');
              setSelectedPost(null);
              setSubView('none');
            }
          }
        }
      }).then((handle) => {
        appUrlOpenHandle = handle;
      }).catch(() => {});
    } catch {}

    // 4. Browser popstate listener for back/forward buttons
    const handlePopState = (e: PopStateEvent) => {
      if (!isMounted) return;
      if (e.state?.postId) {
        postsService.getPostById(e.state.postId).then((p) => {
          if (p && isMounted) setSelectedPost(p);
        });
      } else if (window.location.pathname === '/' || window.location.pathname === '') {
        setSelectedPost(null);
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      isMounted = false;
      window.removeEventListener('popstate', handlePopState);
      if (appUrlOpenHandle) {
        appUrlOpenHandle.remove?.().catch(() => {});
      }
    };
  }, []);

  // Capture URL referral param, Play Store install referrer, or admin route on mount
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get('ref') || urlParams.get('referral_code');
      if (refCode) {
        rewardsService.setPendingReferralCode(refCode);
      }
      if (urlParams.get('admin') === 'true' || window.location.hash === '#admin') {
        setSubView('admin');
      }
    } catch {}

    // Asynchronously query Google Play Install Referrer on Android on first launch (non-blocking)
    void initInstallReferrerAttribution();
  }, []);

  // Process any pending referral code stored in localStorage once user is authenticated, onboarded, and main UI is rendered
  useEffect(() => {
    if (loading || !currentUser?.id || needsOnboarding) return;
    const pendingCode = rewardsService.getPendingReferralCode();
    if (!pendingCode) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await rewardsService.registerReferral({
            referralCode: pendingCode,
            referredUser: currentUser,
          });
          if (!cancelled && res.success) {
            await rewardsService.qualifyReferral(currentUser.id);
          }
        } catch (err) {
          console.warn('Pending referral code reconciliation note:', err);
        }
      })();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, currentUser?.id, needsOnboarding]);

  // Subscribe to real-time notifications asynchronously after the main UI becomes usable
  useEffect(() => {
    if (loading || !currentUser?.id) {
      if (!currentUser?.id) setUnreadCount(0);
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let firstSnapshotLogged = false;

    const timer = setTimeout(() => {
      unsubscribe = notificationsService.subscribeNotifications(
        currentUser.id,
        (items) => {
          const unread = items.filter((n) => !n.read).length;
          setUnreadCount(unread);
          if (!firstSnapshotLogged) {
            firstSnapshotLogged = true;
            perf.milestone('Notifications available', { count: items.length, unread });
          }
        }
      );
    }, 250);

    return () => {
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };
  }, [loading, currentUser?.id]);

  // Schedule device-level Android mobile notification for Sogo Stars (every 24h, stable ID 70701)
  useEffect(() => {
    if (loading) return;

    if (currentUser?.id && !needsOnboarding) {
      syncSogoStarsReminder(currentUser.id).catch((err) => {
        console.warn('Sogo Stars Android notification schedule error:', err);
      });
    } else if (!currentUser) {
      cancelSogoStarsReminder().catch((err) => {
        console.warn('Sogo Stars Android reminder cancel error:', err);
      });
    }
  }, [loading, currentUser?.id, needsOnboarding]);

  // Handle Sogo Stars notification tap action (works when open, in background, and cold start)
  useEffect(() => {
    const handleOpenStars = () => {
      setCreatorRewardsInitialFocus('stars');
      setSelectedPost(null);
      setSelectedVideoId(null);
      setSelectedVideoUserId(null);
      setSubView('creator-rewards');
    };

    // If app cold started from tapping the Android notification, route immediately
    if (shouldOpenStarsOnLaunch()) {
      handleOpenStars();
    }

    window.addEventListener('sogo_open_stars', handleOpenStars);
    return () => {
      window.removeEventListener('sogo_open_stars', handleOpenStars);
    };
  }, []);

  // Preload Creator Rewards interstitial ad in the background when user is authenticated
  useEffect(() => {
    if (!loading && currentUser && !needsOnboarding) {
      const timer = setTimeout(() => {
        preloadCreatorRewardsInterstitial().catch(() => {});
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [loading, currentUser?.id, needsOnboarding]);

  // Evaluate App Open ad on app launch for returning users
  useEffect(() => {
    if (!loading && currentUser && !needsOnboarding) {
      const timer = setTimeout(() => {
        tryShowAppOpenAd('launch').catch(() => {});
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [loading, currentUser?.id, needsOnboarding]);

  // Duplicate-tap guard & unified handler for opening Creator Rewards from Profile or Settings
  const isOpeningCreatorRewardsRef = useRef(false);
  const handleOpenCreatorRewards = useCallback(async () => {
    if (isOpeningCreatorRewardsRef.current) {
      return;
    }
    isOpeningCreatorRewardsRef.current = true;
    try {
      await showCreatorRewardsInterstitial();
      setSubView('creator-rewards');
    } finally {
      setTimeout(() => {
        isOpeningCreatorRewardsRef.current = false;
      }, 600);
    }
  }, []);

  // Prevent flashing the main app before authentication, Firestore, or deep link are established
  if (loading || isResolvingDeepLink) {
    return (
      <div className="fixed inset-0 bg-[#0B0F1A] flex flex-col items-center justify-center text-white px-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-500/30 flex items-center justify-center mb-4 shadow-xl shadow-purple-500/10 animate-pulse">
          <img src={sogoLogo} alt="SogoSocial" className="w-11 h-11 object-contain" />
        </div>
        <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs text-slate-400 font-medium tracking-wide">
          {isResolvingDeepLink ? 'Loading shared post...' : 'Connecting to SogoSocial...'}
        </p>
      </div>
    );
  }

  // If user is authenticated via Google but profile is incomplete/new, route to Onboarding screen
  if (currentUser && needsOnboarding) {
    return (
      <Onboarding
        user={currentUser}
        onComplete={async (profileData) => {
          await completeOnboarding(profileData);
          setCurrentTab('home');
          setSelectedPost(null);
          setSelectedVideoId(null);
          setViewingUserId(null);
          setSubView('none');
        }}
        onCancel={async () => {
          await logout();
        }}
      />
    );
  }

  // Handle viewing another user's profile
  const handleUserClick = (userId: string) => {
    setCreateIntent('post');
    setViewingUserId(userId);
    setProfileSubTab('posts');
    setSelectedPost(null);
    setSelectedVideoId(null);
    setSelectedVideoUserId(null);
    setSubView('none');
    setCurrentTab('profile');
  };

  // Navigate to Publication/Create screen with an explicit creation intent ('post' | 'reel' | 'story')
  const handleNavigateCreate = (intent: CreateIntent = 'post') => {
    setCreateIntent(intent);
    setSelectedPost(null);
    setSelectedVideoId(null);
    setSelectedVideoUserId(null);
    setSubView('none');
    setCurrentTab('create');
  };

  const handleTabChange = (tab: ActiveTab) => {
    // Normal tab navigation (including bottom bar / header Create) always uses default 'post' intent
    setCreateIntent('post');

    if (tab === 'home') {
      const isAlreadyOnHomeFeed =
        currentTab === 'home' &&
        subView === 'none' &&
        selectedPost === null &&
        selectedVideoId === null &&
        selectedVideoUserId === null;

      if (isAlreadyOnHomeFeed) {
        // Case 1 & 3: Already on Home -> immediately scroll to top and trigger lightweight refresh
        scrollFeedToTop('smooth');
        setHomeRefreshTrigger((prev) => prev + 1);
        return;
      }

      // Case 2: Navigating to Home from another tab or detail/subview -> open Home at top
      setCurrentTab('home');
      setSelectedPost(null);
      setSelectedVideoId(null);
      setSelectedVideoUserId(null);
      setSubView('none');
      setViewingUserId(null);
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/post')) {
        try {
          window.history.pushState(null, '', '/');
        } catch {}
      }
      scrollFeedToTop('auto');
      return;
    }

    setCurrentTab(tab);
    setSelectedPost(null);
    setSelectedVideoId(null);
    setSelectedVideoUserId(null);
    setSubView('none');
    if (tab === 'profile') {
      setViewingUserId(null); // Return to own profile
      setProfileSubTab('posts');
    }
  };

  const handlePostClick = (post: Post) => {
    setCreateIntent('post');
    if (post.repostType === 'video' && post.originalVideoId) {
      setSelectedPost(null);
      setSelectedVideoId(post.originalVideoId);
      setSelectedVideoUserId(null);
      setCurrentTab('videos');
      return;
    }

    const canonicalId = post.originalPostId || post.id;
    const canonicalPost: Post = post.isRepost
      ? {
          ...post,
          id: canonicalId,
          isRepost: false,
          repostId: undefined,
          repostedBy: undefined,
          createdAt: post.originalCreatedAt || post.createdAt,
        }
      : post;

    setSelectedPost(canonicalPost);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      try {
        window.history.pushState({ postId: canonicalId }, '', `/post/${canonicalId}`);
      } catch {}
    }
  };

  // Render Subviews or Active Tab
  if (subView === 'admin') {
    return <AdminDashboard onBackToApp={handleAppBack} />;
  }

  const renderContent = () => {
    if (subView === 'settings-privacy') {
      return (
        <SettingsPrivacy
          onBack={handleAppBack}
          onLogout={async () => {
            await logout();
            setCreateIntent('post');
            setSubView('none');
            setCurrentTab('profile');
          }}
        />
      );
    }

    if (subView === 'creator-rewards') {
      return (
        <CreatorRewards
          onBack={handleAppBack}
          initialFocus={creatorRewardsInitialFocus}
        />
      );
    }

    if (subView === 'settings') {
      return (
        <Settings
          onBack={handleAppBack}
          onOpenPrivacy={() => setSubView('settings-privacy')}
          onOpenCreatorRewards={handleOpenCreatorRewards}
          onOpenAdminDashboard={() => setSubView('admin')}
          onLogout={async () => {
            await logout();
            setCreateIntent('post');
            setSubView('none');
            setCurrentTab('profile');
          }}
        />
      );
    }

    if (selectedPost) {
      return (
        <PostDetail
          post={selectedPost}
          onBack={handleAppBack}
          onUserClick={handleUserClick}
        />
      );
    }

    switch (currentTab) {
      case 'home':
        return (
          <Home
            onPostClick={handlePostClick}
            onUserClick={handleUserClick}
            onNavigateCreate={(intent) => handleNavigateCreate(intent ?? 'post')}
            onVideoClick={(videoId) => {
              setCreateIntent('post');
              setSelectedVideoUserId(null);
              if (videoId) setSelectedVideoId(videoId);
              setCurrentTab('videos');
            }}
            refreshTrigger={homeRefreshTrigger}
          />
        );
      case 'discover':
        return (
          <Discover
            onPostClick={handlePostClick}
            onUserClick={handleUserClick}
          />
        );
      case 'videos':
        return (
          <Videos
            key={selectedVideoUserId ? `profile-${selectedVideoUserId}-${selectedVideoId || ''}` : 'global-videos'}
            onUserClick={(userId, videoId) => {
              if (!userId) return;
              setCreateIntent('post');
              // When watching the main Reels feed and tapping a creator's avatar/name,
              // directly open that creator's Reels scoped to userId (preserving the active videoId).
              // If already viewing that creator's scoped Reels, open their Profile directly on the Videos tab.
              if (selectedVideoUserId !== userId) {
                setViewingUserId(userId);
                setProfileSubTab('videos');
                setSelectedPost(null);
                setSelectedVideoId(videoId || selectedVideoId || null);
                setSelectedVideoUserId(userId);
                setSubView('none');
                setCurrentTab('videos');
              } else {
                setViewingUserId(userId);
                setProfileSubTab('videos');
                setSelectedPost(null);
                setSelectedVideoId(null);
                setSelectedVideoUserId(null);
                setSubView('none');
                setCurrentTab('profile');
              }
            }}
            onNavigateCreate={(intent) => handleNavigateCreate(intent ?? 'reel')}
            initialVideoId={selectedVideoId}
            profileUserId={selectedVideoUserId}
            onBack={selectedVideoId || selectedVideoUserId ? handleAppBack : undefined}
          />
        );
      case 'create':
        if (!currentUser) {
          return (
            <div className="max-w-md mx-auto py-8 px-4">
              <Login onSuccess={() => setCurrentTab('create')} />
            </div>
          );
        }
        return (
          <CreatePost
            initialMode={createIntent}
            onCreated={(type) => {
              setCreateIntent('post');
              if (type === 'video') {
                setSelectedVideoUserId(null);
                setCurrentTab('videos');
              } else {
                setCurrentTab('home');
              }
            }}
            onCancel={() => {
              setCreateIntent('post');
              handleAppBack();
            }}
          />
        );
      case 'bookmarks':
        return (
          <Bookmarks
            onPostClick={handlePostClick}
            onExploreClick={() => {
              setCreateIntent('post');
              setCurrentTab('discover');
            }}
          />
        );
      case 'notifications':
        return (
          <Notifications
            onUserClick={handleUserClick}
            onPostClick={handlePostClick}
            onVideoClick={(videoId) => {
              setCreateIntent('post');
              setSelectedVideoUserId(null);
              if (videoId) setSelectedVideoId(videoId);
              setCurrentTab('videos');
            }}
          />
        );
      case 'profile':
        return (
          <Profile
            userId={viewingUserId || currentUser?.id}
            initialTab={profileSubTab}
            onTabChange={setProfileSubTab}
            onPostClick={handlePostClick}
            onVideoClick={(videoId, ownerUserId) => {
              setCreateIntent('post');
              setSelectedVideoId(videoId);
              setSelectedVideoUserId(ownerUserId || viewingUserId || currentUser?.id || null);
              setCurrentTab('videos');
            }}
            onSettingsClick={() => setSubView('settings')}
            onNavigateVideos={() => {
              setCreateIntent('post');
              setSelectedVideoId(null);
              setSelectedVideoUserId(null);
              setCurrentTab('videos');
            }}
            onCreatorRewardsClick={handleOpenCreatorRewards}
            onAdminDashboardClick={() => setSubView('admin')}
            onLoginSuccess={() => {
              setCreateIntent('post');
              setCurrentTab('home');
              setViewingUserId(null);
              setProfileSubTab('posts');
              setSelectedPost(null);
              setSelectedVideoId(null);
              setSelectedVideoUserId(null);
              setSubView('none');
            }}
          />
        );
      default:
        return (
          <Home
            onPostClick={handlePostClick}
            onUserClick={handleUserClick}
            onNavigateCreate={(intent) => handleNavigateCreate(intent ?? 'post')}
            onVideoClick={(videoId) => {
              setCreateIntent('post');
              setSelectedVideoUserId(null);
              if (videoId) setSelectedVideoId(videoId);
              setCurrentTab('videos');
            }}
            refreshTrigger={homeRefreshTrigger}
          />
        );
    }
  };

  return (
    <AppShell
      currentTab={currentTab}
      onTabChange={handleTabChange}
      onNavigateCreate={handleNavigateCreate}
      showCreateButton={currentTab === 'home' && subView === 'none' && !selectedPost}
      unreadNotificationsCount={unreadCount}
    >
      {deepLinkMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-rose-500/90 text-white border border-rose-400/40 px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-xs font-semibold backdrop-blur-md animate-in fade-in slide-in-from-top-3">
          <span>{deepLinkMessage}</span>
        </div>
      )}
      {renderContent()}
    </AppShell>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(false);
  const [versionCheck, setVersionCheck] = useState<VersionCheckResult | null>(null);
  const [versionCheckError, setVersionCheckError] = useState<string | null>(null);

  const runVersionCheck = useCallback(async () => {
    try {
      const result = await checkAppVersion();
      setVersionCheck(result);
      if (result.error) {
        setVersionCheckError(result.error);
      } else {
        setVersionCheckError(null);
      }
    } catch (err: any) {
      setVersionCheckError(err?.message || 'Failed to check version status');
    }
  }, []);

  // 1. Initial version check on startup
  useEffect(() => {
    runVersionCheck();
  }, [runVersionCheck]);

  // 2. Re-check version on app resume (Capacitor App state change and document visibility)
  useEffect(() => {
    let appStateHandle: any = null;

    const setupListener = async () => {
      try {
        appStateHandle = await CapApp.addListener('appStateChange', (state) => {
          if (state.isActive) {
            runVersionCheck();
            void tryShowAppOpenAd('resume');
          }
        });
      } catch {
        // Fallback in web/preview environments
      }
    };

    setupListener();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runVersionCheck();
        void tryShowAppOpenAd('resume');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (appStateHandle && typeof appStateHandle.remove === 'function') {
        appStateHandle.remove().catch(() => {});
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [runVersionCheck]);

  // If a mandatory update is required, block app access with the ForceUpdateScreen
  if (versionCheck?.isUpdateRequired) {
    return (
      <ForceUpdateScreen
        currentInfo={versionCheck.currentInfo}
        remoteConfig={versionCheck.remoteConfig}
        onRecheck={runVersionCheck}
        errorMessage={versionCheckError}
      />
    );
  }

  if (showSplash) {
    return <Splash onFinish={() => setShowSplash(false)} />;
  }

  return (
    <AuthProvider>
      <MainNavigator />
    </AuthProvider>
  );
}

