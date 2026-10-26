import { User, VideoPost, Post, CreatorRewardsSummary, PayoutRequest, ReferralRecord } from './index';

export interface AdminOverviewStats {
  totalUsers: number;
  newUsersToday: number;
  activeUsers: number;
  totalVideos: number;
  videosUploadedToday: number;
  totalPosts: number;
  totalVideoViews: number;
  qualifiedRewardViews: number;
  totalCreatorRewardsCents: number;
  totalReferralRewardsCents: number;
  pendingPayoutsCount: number;
  totalPayoutAmountPendingCents: number;
  totalRewardLiabilityCents: number;
}

export interface AdminUserRecord extends User {
  uploadedVideosCount?: number;
  uploadedPostsCount?: number;
  availableBalanceCents?: number;
  totalEarnedCents?: number;
  reportsCount?: number;
  isSuspended?: boolean;
  isDisabled?: boolean;
  suspensionReason?: string;
  disabledReason?: string;
  testFollowersCount?: number;
  testRewardsGrantedCents?: number;
  hasAdminTestData?: boolean;
}

export interface AdminVideoRecord extends VideoPost {
  isRemoved?: boolean;
  removalReason?: string;
  isSuspicious?: boolean;
  suspiciousReason?: string;
  qualifiedViewsCount?: number;
  estimatedRewardCents?: number;
  testViewsCount?: number;
  testLikesCount?: number;
  testCommentsCount?: number;
  hasAdminTestData?: boolean;
}

export interface AdminPostRecord extends Post {
  isRemoved?: boolean;
  removalReason?: string;
  reportsCount?: number;
  testLikesCount?: number;
  testCommentsCount?: number;
  hasAdminTestData?: boolean;
}

export interface AdminCreatorSummaryItem extends CreatorRewardsSummary {
  user?: User;
  testRewardsGrantedCents?: number;
  hasAdminTestData?: boolean;
}

export interface AdminReferralItem extends ReferralRecord {
  referrerUser?: Partial<User>;
  referredUserObj?: Partial<User>;
}

export type ReportTargetType = 'user' | 'video' | 'post';
export type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed';

export interface AdminReportItem {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetTitleOrCaption?: string;
  targetAuthorId?: string;
  targetAuthorUsername?: string;
  reason: string;
  details?: string;
  reporterId: string;
  reporterUsername?: string;
  reporterEmail?: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt?: string;
  reviewedBy?: string;
  resolutionNotes?: string;
}

export interface AdminAuditLog {
  id: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  notes?: string;
  timestamp: string;
  affectedUserId?: string;
  amountCents?: number;
  amountUsd?: number;
  before?: any;
  after?: any;
  targetUsername?: string;
  caption?: string;
  idempotencyKey?: string;
}

export interface DailyAnalyticsPoint {
  date: string;
  newUsers: number;
  videoUploads: number;
  postUploads: number;
  videoViews: number;
  qualifiedViews: number;
  rewardLiabilityUsd: number;
}

export interface AdminAnalyticsData {
  userGrowth?: { date: string; totalUsers: number; activeUsers: number }[];
  contentVelocity?: { date: string; videosUploaded: number; postsUploaded: number }[];
  viewMetrics?: { date: string; totalViews: number; qualifiedViews: number }[];
}

export interface AdminSystemHealth {
  firebaseConnected: boolean;
  authenticatedAdmin: string;
  adminUid: string;
  isCustomClaimActive: boolean;
  projectId: string;
  cloudinaryConfigured: boolean;
  cloudinaryCloudName: string;
  cloudinaryVideoPreset: string;
  secretsSecurelyHidden: boolean;
  appVersion: string;
  environment: string;
  rulesStatus: string;
  timestamp: string;
}

export interface GrantTestRewardDiagnostic {
  authUid: string;
  authEmail: string;
  hasAdminClaim: boolean;
  claimsSummary?: string;
  firebaseAppName?: string;
  firebaseProjectId?: string;
  firebaseAppId?: string;
  firestoreDatabaseId?: string;
  initializedAppsSummary?: string;
  currentOperation: string;
  currentPath: string;
  status: 'IDLE' | 'IN_PROGRESS' | 'SUCCESS' | 'ERROR';
  steps: Array<{
    name: string;
    path: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
    code?: string;
    message?: string;
  }>;
  failedOperation?: string;
  failedPath?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
}
