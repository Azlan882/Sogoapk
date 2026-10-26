export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl: string;
  bio?: string;
  website?: string;
  birthday?: string;
  isOnboarded?: boolean;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowing?: boolean;
  following?: string[];
  isVerified?: boolean;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  isAdmin?: boolean;
  isSuspended?: boolean;
  isDisabled?: boolean;
  suspensionReason?: string;
  createdAt: string;
}

export interface PostLocationData {
  name: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
}

export interface Post {
  id: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
    isFollowing?: boolean;
  };
  imageUrl: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  caption: string;
  tags?: string[];
  location?: string;
  locationData?: PostLocationData | null;
  likesCount: number;
  commentsCount: number;
  viewsCount?: number;
  repostsCount?: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
  isReposted?: boolean;
  createdAt: string;
  // Repost / Reference metadata (present when this feed item is a Sogo repost)
  isRepost?: boolean;
  repostId?: string;
  repostType?: 'post' | 'video';
  originalPostId?: string;
  originalVideoId?: string;
  originalAuthorId?: string;
  originalCreatedAt?: string;
  sharedByUid?: string;
  repostedBy?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
  };
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
  };
  text: string;
  createdAt: string;
  likesCount?: number;
  isLiked?: boolean;
}

export interface Story {
  id: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
  };
  mediaUrl: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  originalStoryId?: string;
  referencedStoryId?: string;
  createdAt: string;
  createdAtMs?: number;
  expiresAt?: string;
  expiresAtMs?: number;
  hasSeen?: boolean;
}

export type NotificationType =
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'video_like'
  | 'video_comment'
  | 'repost'
  | 'video_repost'
  | 'referral'
  | 'sogo_stars';

export interface NotificationItem {
  id: string;
  recipientId: string;
  recipientUserId?: string;
  actorId: string;
  actorUserId?: string;
  type: NotificationType;
  fromUser: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
  };
  postId?: string;
  videoId?: string;
  targetId?: string;
  postImageUrl?: string;
  text?: string;
  timestamp: string;
  createdAt?: string;
  read: boolean;
}

export interface VideoPost {
  id: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
  };
  videoUrl: string;
  thumbnailUrl: string;
  caption: string;
  tags?: string[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  repostsCount?: number;
  isLiked?: boolean;
  isBookmarked?: boolean;
  isReposted?: boolean;
  createdAt: string;
  duration?: number;
  publicId?: string;
  isSeedContent?: boolean;
}

export interface VideoComment {
  id: string;
  videoId: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    isVerified?: boolean;
  };
  text: string;
  createdAt: string;
}

export type ActiveTab = 'home' | 'discover' | 'videos' | 'create' | 'bookmarks' | 'notifications' | 'profile';

export type CreateIntent = 'post' | 'reel' | 'story';

// ==========================================
// CREATOR REWARDS & MONETIZATION TYPES
// ==========================================

export type SogoStarMissionId =
  | 'watch_ad'
  | 'post_reels'
  | 'like_reels'
  | 'comment_reels'
  | 'watch_reels'
  | 'follow_creators'
  | 'create_posts'
  | 'comment_posts';

export interface SogoStarMissionDefinition {
  id: SogoStarMissionId;
  title: string;
  description: string;
  targetCount: number;
  rewardStars: number;
  rewardCents: number;
  rewardUsd: number;
}

export interface SogoStarMissionProgress {
  missionId: SogoStarMissionId;
  currentCount: number;
  targetCount: number;
  rewardStars: number;
  rewardCents: number;
  completed: boolean;
  rewardGranted: boolean;
  completedAt?: string | null;
  actionKeys?: string[];
}

export interface SogoStarsDailyState {
  id: string; // `${userId}_${dateKey}`
  userId: string;
  dateKey: string; // YYYY-MM-DD (UTC server calendar day)
  starsEarnedToday: number; // 0 to 500 hard cap
  maxDailyStars: number; // 500
  centsEarnedToday: number; // 0 to 50 hard cap ($0.00 to $0.50)
  completedMissionsCount: number; // 0 to 7
  totalMissionsCount: number; // 7
  missions: Record<SogoStarMissionId, SogoStarMissionProgress>;
  updatedAt: string;
}

export interface CreatorRewardsSummary {
  userId: string;
  availableBalanceCents: number; // e.g. 3750 = $37.50 USD
  totalEarnedCents: number; // e.g. 5250 = $52.50 USD
  videoRewardsCents: number; // e.g. 3200 = $32.00 USD
  referralRewardsCents: number; // e.g. 550 = $5.50 USD
  sogoStarsTotal?: number; // Lifetime Sogo Stars earned
  sogoStarsToday?: number; // Today's Sogo Stars earned (max 500)
  sogoStarsDateKey?: string; // YYYY-MM-DD
  sogoStarsRewardsCents?: number; // Lifetime USD cents earned from Sogo Stars
  pendingEarningsCents: number; // e.g. 0
  withdrawnAmountCents: number; // e.g. 1500 = $15.00 USD
  pendingPayoutCents: number; // e.g. 0
  totalViewsCount?: number; // Lifetime organic video views
  qualifiedViewsCount: number; // e.g. 64,000 qualified views
  successfulReferralsCount: number; // e.g. 11 referrals
  currency: 'USD';
  updatedAt: string;
  // Admin testing & staging metrics (distinguishable from genuine organic metrics)
  testViewsCount?: number;
  testQualifiedViewsCount?: number;
  testVideoRewardsCents?: number;
  testRewardsGrantedCents?: number;
  hasAdminTestData?: boolean;
  // Raw baselines preserved when normalizing for idempotent display calculations
  rawAvailableBalanceCents?: number;
  rawTotalEarnedCents?: number;
  rawVideoRewardsCents?: number;
  rawSogoStarsRewardsCents?: number;
  // Canonical authoritative display metrics
  displayAvailableBalanceCents?: number;
  displayTotalEarnedCents?: number;
  displayVideoRewardsCents?: number;
  displayQualifiedViews?: number;
  displayTotalViews?: number;
  displaySogoStarsTotal?: number;
  displaySogoStarsRewardsCents?: number;
}

export type RewardLedgerType =
  | 'video_reward'
  | 'referral_reward'
  | 'sogo_stars_reward'
  | 'payout'
  | 'payout_refund'
  | 'admin_test_reward'
  | 'bonus';
export type RewardLedgerStatus = 'pending' | 'approved' | 'completed' | 'rejected';

export interface RewardLedgerItem {
  id: string;
  userId: string;
  type: RewardLedgerType;
  transactionType?: string;
  isAdminTestData?: boolean;
  amountCents: number; // In integer cents. Positive for earnings, negative for payouts
  amountUsd: number; // Formatted float USD e.g. 0.50
  currency: 'USD';
  videoId?: string;
  videoCaption?: string;
  qualifiedViews?: number;
  referredUserId?: string;
  referredUsername?: string;
  payoutRequestId?: string;
  starsEarned?: number;
  missionId?: SogoStarMissionId;
  dateKey?: string;
  description: string;
  status: RewardLedgerStatus;
  eventId: string; // Idempotency key
  createdAt: string;
}

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';
export type PayoutMethod = 'paypal' | 'bank_transfer' | 'venmo';

export interface PayoutDetails {
  accountEmail?: string;
  accountHolderName?: string;
  bankName?: string;
  routingOrIban?: string;
  accountNumberLast4?: string;
  venmoHandle?: string;
}

export interface PayoutRequest {
  id: string;
  userId: string;
  amountCents: number; // Must be >= 5000 cents ($50.00 USD)
  amountUsd: number;
  currency: 'USD';
  payoutMethod: PayoutMethod;
  payoutDetails: PayoutDetails;
  status: PayoutStatus;
  requestedAt: string;
  processedAt?: string;
  rejectionReason?: string;
  notes?: string;
  successfulReferralsCount?: number; // Must be >= 10 successful referrals at time of request
}

export type ReferralStatus = 'pending' | 'qualified' | 'rejected';

export interface ReferralRecord {
  id: string; // Document ID (usually referred user's ID)
  referralCode: string;
  referrerId: string;
  referredUserId: string;
  referredUsername: string;
  referredDisplayName: string;
  referredAvatarUrl?: string;
  status: ReferralStatus;
  rewardAmountCents: number; // 10 cents ($0.10 USD)
  rewardGranted: boolean;
  createdAt: string;
  qualifiedAt?: string;
  reason?: string;
}

export interface WatchSessionTelemetry {
  sessionId: string;
  videoId: string;
  creatorUid: string;
  viewerUid: string;
  watchDurationSeconds: number;
  videoDurationSeconds?: number;
  timestamp: string;
  isQualifiedCandidate: boolean;
  clientIpHash?: string;
}
