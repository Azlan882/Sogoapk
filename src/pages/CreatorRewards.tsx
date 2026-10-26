import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Users,
  Video,
  Eye,
  Gift,
  HelpCircle,
  Copy,
  Check,
  Share2,
  AlertCircle,
  Clock,
  CheckCircle2,
  CreditCard,
  Building2,
  ShieldCheck,
  ChevronRight,
  Info,
  Sparkles,
  Star,
  ArrowUpRight,
  RefreshCw,
  X,
  Play,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { registerBackInterceptor } from '../services/backButtonService';
import {
  CreatorRewardsSummary,
  RewardLedgerItem,
  RewardLedgerType,
  PayoutRequest,
  PayoutMethod,
  ReferralRecord,
  SogoStarsDailyState,
} from '../types';
import * as rewardsService from '../services/rewardsService';
import * as sogoStarsService from '../services/sogoStarsService';
import { getUserVideos } from '../services/videosService';
import { playRewardedAd } from '../services/rewardedAdService';
import { Button } from '../components/Button';
import { cn } from '../lib/utils';

export interface CreatorRewardsProps {
  onBack: () => void;
  initialFocus?: 'stars' | 'overview';
}

export const CreatorRewards: React.FC<CreatorRewardsProps> = ({ onBack, initialFocus }) => {
  const { currentUser } = useAuth();

  const [summary, setSummary] = useState<CreatorRewardsSummary>(() =>
    currentUser ? rewardsService.getInitialRewardsSummary(currentUser.id) : ({} as CreatorRewardsSummary)
  );
  const [ledger, setLedger] = useState<RewardLedgerItem[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [dailyStars, setDailyStars] = useState<SogoStarsDailyState>(() =>
    sogoStarsService.getInitialSogoStarsDailyState(currentUser?.id || '')
  );

  // Daily Rewarded Ad Task State
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adMessage, setAdMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'ledger' | 'referrals' | 'payouts'>('overview');
  const [ledgerFilter, setLedgerFilter] = useState<RewardLedgerType | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [organicTotalViews, setOrganicTotalViews] = useState<number>(0);

  // Modals
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [withdrawValidationPopup, setWithdrawValidationPopup] =
    useState<rewardsService.WithdrawalValidationPopup | null>(null);

  // Withdraw form state
  const [withdrawMethod, setWithdrawMethod] = useState<PayoutMethod>('paypal');
  const [withdrawAmountDollars, setWithdrawAmountDollars] = useState<number>(50);
  const [accountEmail, setAccountEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [routingOrIban, setRoutingOrIban] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [venmoHandle, setVenmoHandle] = useState('');
  const [withdrawNotes, setWithdrawNotes] = useState('');
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  // Referral copy state
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const userId = currentUser?.id || '';
  const referralCode = currentUser ? rewardsService.getReferralCodeForUser(currentUser) : 'SOGO-CREATOR';
  const referralLink = rewardsService.getReferralLink(referralCode);

  // Register Android hardware & in-app back interceptor for modals and sub-tabs
  useEffect(() => {
    if (
      !showWithdrawModal &&
      !showHowItWorksModal &&
      !withdrawValidationPopup &&
      activeTab === 'overview'
    ) {
      return;
    }

    return registerBackInterceptor(() => {
      if (withdrawValidationPopup) {
        setWithdrawValidationPopup(null);
        return true;
      }
      if (showWithdrawModal) {
        setShowWithdrawModal(false);
        return true;
      }
      if (showHowItWorksModal) {
        setShowHowItWorksModal(false);
        return true;
      }
      if (activeTab !== 'overview') {
        setActiveTab('overview');
        return true;
      }
      return false;
    });
  }, [showWithdrawModal, showHowItWorksModal, withdrawValidationPopup, activeTab]);

  // Focus Sogo Stars section if navigated specifically to Stars
  useEffect(() => {
    if (initialFocus === 'stars') {
      setActiveTab('overview');
      const timer = setTimeout(() => {
        const el = document.getElementById('sogo-stars-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initialFocus]);

  // Load initial data
  const loadData = async (showLoadingState = true) => {
    if (!userId) return;
    if (showLoadingState) setIsLoading(true);
    try {
      const [sum, led, pay, refs, userVideos, starsState] = await Promise.all([
        rewardsService.getCreatorRewards(userId),
        rewardsService.getRewardLedger(userId, ledgerFilter),
        rewardsService.getPayoutRequests(userId),
        rewardsService.getUserReferrals(userId),
        getUserVideos(userId).catch(() => []),
        sogoStarsService.getSogoStarsDailyState(userId),
      ]);
      const vidsTotalViews = (userVideos || []).reduce(
        (acc, v) => acc + (Number(v.viewsCount) || 0),
        0
      );
      setOrganicTotalViews(vidsTotalViews);
      setSummary(sum);
      setLedger(led);
      setPayouts(pay);
      setReferrals(refs);
      setDailyStars(starsState);
    } catch (err) {
      console.warn('Failed to load rewards dashboard data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to live rewards summary and referral updates
    if (userId) {
      const unsubRewards = rewardsService.subscribeToCreatorRewards(userId, (liveSummary) => {
        setSummary(liveSummary);
      });
      const unsubReferrals = rewardsService.subscribeToUserReferrals(userId, (liveRefs) => {
        setReferrals(liveRefs);
        rewardsService.getRewardLedger(userId, ledgerFilter).then(setLedger).catch(() => {});
      });
      const unsubStars = sogoStarsService.subscribeToSogoStarsDaily(userId, (liveStars) => {
        setDailyStars(liveStars);
        rewardsService.getRewardLedger(userId, ledgerFilter).then(setLedger).catch(() => {});
      });
      return () => {
        unsubRewards();
        unsubReferrals();
        unsubStars();
      };
    }
  }, [userId]);

  // Refetch ledger when filter changes
  useEffect(() => {
    if (userId) {
      rewardsService.getRewardLedger(userId, ledgerFilter).then(setLedger);
    }
  }, [userId, ledgerFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData(false);
  };

  const handleWatchRewardedAd = async () => {
    if (isWatchingAd) return;
    if (!currentUser?.id) {
      setAdMessage({ type: 'error', text: 'Please sign in to earn Stars.' });
      return;
    }

    const watchAdMission = dailyStars.missions?.watch_ad;
    if (watchAdMission?.completed && watchAdMission?.rewardGranted) {
      setAdMessage({
        type: 'info',
        text: 'You have already claimed your daily ad reward today. Check back tomorrow!',
      });
      return;
    }

    if (dailyStars.starsEarnedToday >= sogoStarsService.MAX_DAILY_SOGO_STARS) {
      setAdMessage({
        type: 'info',
        text: 'You have reached the maximum daily limit of 500 Stars today. Check back tomorrow!',
      });
      return;
    }

    setAdMessage(null);
    setIsWatchingAd(true);

    try {
      const adResult = await playRewardedAd(currentUser.id);

      if (!adResult.rewardEarned) {
        setAdMessage({
          type: 'error',
          text:
            adResult.errorMessage ||
            'Ad was closed before completion. Stars were not awarded. Tap to retry.',
        });
        setIsWatchingAd(false);
        return;
      }

      // Ad was fully watched and reward confirmed by AdMob SDK!
      // Now execute atomic Firestore transaction to claim exactly 100 Stars:
      const claimResult = await sogoStarsService.claimRewardedAdStars(currentUser.id);

      if (claimResult.success) {
        setAdMessage({
          type: 'success',
          text: `🎉 You earned +${claimResult.starsAwarded} Sogo Stars! Added to your balance.`,
        });
        if (claimResult.state) {
          setDailyStars(claimResult.state);
        }
        rewardsService.getCreatorRewards(currentUser.id).then(setSummary).catch(() => {});
      } else if (claimResult.alreadyClaimed) {
        setAdMessage({
          type: 'info',
          text: 'Daily rewarded ad already claimed today. Check back tomorrow!',
        });
        if (claimResult.state) {
          setDailyStars(claimResult.state);
        }
      } else {
        setAdMessage({
          type: 'error',
          text: claimResult.error || 'Failed to claim Stars reward. Please try again.',
        });
      }
    } catch (err: any) {
      console.warn('Watch ad error:', err);
      setAdMessage({
        type: 'error',
        text: err?.message || 'Could not show rewarded ad. Please try again.',
      });
    } finally {
      setIsWatchingAd(false);
    }
  };

  // Canonical Display Calculations (Single Source of Truth via rewardsService.getDisplayRewardsMetrics)
  const reconciledSummary = rewardsService.reconcileSummaryWithSogoStars(summary, dailyStars);
  const displayMetrics = rewardsService.getDisplayRewardsMetrics(reconciledSummary, organicTotalViews);
  const {
    displayTotalViews,
    displayQualifiedViews,
    displayVideoRewardsCents,
    displayReferralRewardsCents,
    displaySogoStarsRewardsCents,
    displaySogoStarsTotal,
    displayTotalEarnedCents,
    displayAvailableBalanceCents,
  } = displayMetrics;

  // Payout eligibility calculations (Requires BOTH >= $50.00 USD available balance AND >= 10 successful referrals)
  const eligibility = rewardsService.evaluatePayoutEligibility(
    summary,
    referrals,
    displayAvailableBalanceCents
  );
  const availableCents = eligibility.availableBalanceCents;
  const minPayoutCents = eligibility.minBalanceCents; // 5000 cents ($50.00)
  const successfulReferrals = eligibility.successfulReferralsCount;
  const minPayoutReferrals = eligibility.minReferralsCount; // 10 successful referrals

  // Filter out internal admin test entries from user-facing ledger view
  const visibleLedger = ledger.filter(
    (item) => !item.isAdminTestData && item.type !== 'admin_test_reward'
  );

  // Copy referral code
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      // Fallback
    }
  };

  // Copy referral link
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Fallback
    }
  };

  // Native share
  const handleShareLink = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on SogoSocial!',
          text: `Join SogoSocial with my creator referral code ${referralCode} and start earning!`,
          url: referralLink,
        });
      } catch {}
    } else {
      handleCopyLink();
    }
  };

  // Handle Withdraw button click:
  // Step 1: Check successful referrals (< 10 -> "You need at least 10 successful referrals to make a withdrawal.")
  // Step 2: Check available balance (< $50 -> "The minimum payment threshold is $50.")
  // Step 3: Proceed to existing withdrawal modal/form
  const handleWithdrawClick = () => {
    setWithdrawError(null);
    const validation = rewardsService.validateWithdrawalEligibility(
      reconciledSummary,
      referrals,
      displayAvailableBalanceCents
    );

    if (!validation.allowed) {
      setWithdrawValidationPopup(validation);
      return;
    }

    setWithdrawAmountDollars(rewardsService.centsToUsd(availableCents) || 50);
    setShowWithdrawModal(true);
  };

  // Handle "Invite Friend" button from 10 followers requirement popup:
  // Closes popup and automatically scrolls down to the existing Sogo referral code section
  const handleInviteFriend = () => {
    setWithdrawValidationPopup(null);
    setActiveTab('overview');

    setTimeout(() => {
      const el = document.getElementById('creator-referral-code-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }, 120);
  };

  // Handle Withdraw submission
  const handleSubmitWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setWithdrawError(null);
    const amountCents = Math.round(withdrawAmountDollars * 100);

    if (successfulReferrals < minPayoutReferrals) {
      setWithdrawError('You need at least 10 followers to withdraw.');
      return;
    }

    if (availableCents < minPayoutCents || amountCents < minPayoutCents) {
      setWithdrawError('You need at least $50 in available Creator Rewards balance before you can withdraw.');
      return;
    }

    if (amountCents > availableCents) {
      setWithdrawError(`Amount exceeds available balance (${rewardsService.formatCentsToUsd(availableCents)})`);
      return;
    }

    setIsSubmittingPayout(true);
    try {
      const res = await rewardsService.submitPayoutRequest({
        userId,
        amountCents,
        payoutMethod: withdrawMethod,
        payoutDetails: {
          accountEmail: withdrawMethod === 'paypal' ? accountEmail.trim() : undefined,
          accountHolderName: withdrawMethod === 'bank_transfer' ? accountHolderName.trim() : undefined,
          bankName: withdrawMethod === 'bank_transfer' ? bankName.trim() : undefined,
          routingOrIban: withdrawMethod === 'bank_transfer' ? routingOrIban.trim() : undefined,
          accountNumberLast4: withdrawMethod === 'bank_transfer' ? accountNumber.trim().slice(-4) : undefined,
          venmoHandle: withdrawMethod === 'venmo' ? venmoHandle.trim() : undefined,
        },
        notes: withdrawNotes.trim(),
      });

      if (res.success) {
        setWithdrawSuccess(true);
        setTimeout(() => {
          setWithdrawSuccess(false);
          setShowWithdrawModal(false);
          loadData(false);
        }, 2200);
      } else {
        setWithdrawError(res.error || 'Failed to submit payout request');
      }
    } catch (err: any) {
      setWithdrawError(err?.message || 'Error submitting payout');
    } finally {
      setIsSubmittingPayout(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-slate-100 pb-20">
      {/* Top App Bar */}
      <header className="sticky top-0 z-30 bg-[#0F172A]/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent">
                Creator Rewards
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wide">
                Monetization
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              aria-label="Refresh Data"
              title="Refresh Balances"
            >
              <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin text-amber-400')} />
            </button>
            <button
              type="button"
              onClick={() => setShowHowItWorksModal(true)}
              className="p-2 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-xl transition-colors"
              aria-label="How it Works"
              title="Rewards Rules & FAQ"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        {/* ⭐ Sogo Stars Daily Engagement Missions Section */}
        <section
          id="sogo-stars-section"
          className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-amber-950/30 via-slate-900/95 to-slate-900 border border-amber-500/30 shadow-lg space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                <Star className="w-5 h-5 fill-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-extrabold text-white tracking-tight">
                    ⭐ Sogo Stars
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    1,000 Stars = $1.00 USD
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Complete daily Sogo activity missions to earn up to 500 Stars ($0.50 USD) per day directly into your Creator Rewards balance.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 shrink-0">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                  Today&apos;s Stars ({dailyStars.dateKey})
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-lg font-extrabold text-amber-400 font-mono">
                    {dailyStars.starsEarnedToday}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 font-mono">
                    / {sogoStarsService.MAX_DAILY_SOGO_STARS} ⭐
                  </span>
                </div>
              </div>
              <div className="h-7 w-px bg-slate-800" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                  Added Today
                </div>
                <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                  +{sogoStarsService.formatStarsUsd(dailyStars.starsEarnedToday)}
                </div>
              </div>
            </div>
          </div>

          {/* Daily 500 Stars Cap Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                Daily Star Limit Progress ({dailyStars.completedMissionsCount}/{sogoStarsService.SOGO_STAR_MISSIONS.length} missions completed)
              </span>
              <span className="font-mono font-bold text-amber-300">
                {dailyStars.starsEarnedToday} / 500 Stars ({sogoStarsService.formatStarsUsd(dailyStars.starsEarnedToday)} / $0.50 max)
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((dailyStars.starsEarnedToday / sogoStarsService.MAX_DAILY_SOGO_STARS) * 100)
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* Daily Missions List (Watch an Ad + 7 Activity Missions) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {sogoStarsService.SOGO_STAR_MISSIONS.map((missionDef) => {
              const isWatchAd = missionDef.id === 'watch_ad';
              const prog = dailyStars.missions?.[missionDef.id] || {
                missionId: missionDef.id,
                currentCount: 0,
                targetCount: missionDef.targetCount,
                rewardStars: missionDef.rewardStars,
                rewardCents: missionDef.rewardCents,
                completed: false,
                rewardGranted: false,
              };
              const currentCount = Math.min(missionDef.targetCount, prog.currentCount || 0);
              const isCompleted = Boolean(prog.completed || currentCount >= missionDef.targetCount);
              const pct = Math.min(100, Math.round((currentCount / missionDef.targetCount) * 100));

              // Dedicated interactive card for the "Watch an Ad — Earn 100 Sogo Stars" task
              if (isWatchAd) {
                return (
                  <div
                    key={missionDef.id}
                    className={cn(
                      'col-span-1 sm:col-span-2 p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 shadow-sm',
                      isCompleted
                        ? 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-amber-950/30 border-amber-500/30 hover:border-amber-500/50'
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={cn(
                            'p-2.5 rounded-xl border shrink-0',
                            isCompleted
                              ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/25'
                              : 'bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/25'
                          )}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
                          ) : (
                            <Play className="w-5 h-5 text-amber-500 dark:text-amber-400 fill-amber-500/20 dark:fill-amber-400/20" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs sm:text-sm font-bold text-slate-100 dark:text-white">
                              {missionDef.title}
                            </h4>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30 uppercase tracking-wide">
                              Daily Rewarded Ad
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {isCompleted
                              ? 'Daily reward claimed! Available again tomorrow at 00:00 UTC (1 reward per calendar day).'
                              : missionDef.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-right">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold font-mono border',
                              isCompleted
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'
                            )}
                          >
                            +{missionDef.rewardStars} ⭐
                          </span>
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            +${missionDef.rewardUsd.toFixed(2)} USD
                          </div>
                        </div>

                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            <Check className="w-3.5 h-3.5" />
                            Claimed Today
                          </span>
                        ) : dailyStars.starsEarnedToday >= sogoStarsService.MAX_DAILY_SOGO_STARS ? (
                          <span className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                            Daily Cap Reached
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleWatchRewardedAd}
                            disabled={isWatchingAd}
                            className={cn(
                              'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-950 transition-all cursor-pointer shadow-md active:scale-95',
                              isWatchingAd
                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 cursor-not-allowed'
                                : 'bg-gradient-to-r from-amber-400 to-yellow-400 hover:from-amber-300 hover:to-yellow-300'
                            )}
                          >
                            {isWatchingAd ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Loading Ad…</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>Watch Ad (+100 ⭐)</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {adMessage && (
                      <div
                        className={cn(
                          'mt-1 p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2',
                          adMessage.type === 'success'
                            ? 'bg-emerald-500/10 dark:bg-emerald-950/40 border-emerald-500/40 text-emerald-700 dark:text-emerald-200'
                            : adMessage.type === 'info'
                            ? 'bg-amber-500/10 dark:bg-amber-950/40 border-amber-500/40 text-amber-700 dark:text-amber-200'
                            : 'bg-rose-500/10 dark:bg-rose-950/40 border-rose-500/40 text-rose-700 dark:text-rose-200'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {adMessage.type === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                          ) : adMessage.type === 'info' ? (
                            <Info className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" />
                          )}
                          <span>{adMessage.text}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAdMessage(null)}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1"
                          aria-label="Dismiss message"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={missionDef.id}
                  className={cn(
                    'p-3.5 rounded-xl border transition-colors flex flex-col justify-between gap-2.5',
                    isCompleted
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : 'bg-slate-950/70 border-slate-800/90 hover:border-slate-700'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <Star className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                          {missionDef.title}
                        </h4>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {missionDef.description}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold font-mono border',
                          isCompleted
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        )}
                      >
                        +{missionDef.rewardStars} ⭐
                      </span>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        +${missionDef.rewardUsd.toFixed(2)} USD
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-semibold text-slate-300">
                        Progress: {currentCount} / {missionDef.targetCount}
                      </span>
                      {isCompleted ? (
                        <span className="font-bold text-emerald-400">
                          Completed ✓
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          {missionDef.targetCount - currentCount} remaining
                        </span>
                      )}
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all duration-300',
                          isCompleted ? 'bg-emerald-400' : 'bg-amber-400'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Available Balance Hero Card */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#131E3A] via-[#101A2E] to-[#0A1124] border border-amber-500/25 p-5 sm:p-6 shadow-xl shadow-amber-950/20">
          {/* Subtle Ambient Radial Glow */}
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Available Balance
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                  <Sparkles className="w-3 h-3" />
                  SogoSocial Verified
                </span>
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-mono">
                  {rewardsService.formatCentsToUsd(displayAvailableBalanceCents)}
                </span>
                <span className="text-sm font-semibold text-slate-400">USD</span>
              </div>

              <p className="text-xs text-slate-400 mt-1">
                Earned from qualified video views and verified creator referrals.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <Button
                variant="primary"
                onClick={handleWithdrawClick}
                className="px-6 py-3 font-bold text-sm shadow-md transition-all bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-amber-500/25 cursor-pointer"
                leftIcon={<ArrowUpRight className="w-4 h-4 stroke-[2.5]" />}
              >
                Withdraw
              </Button>
            </div>
          </div>
        </section>

        {/* Earnings Breakdown & Activity Bento Grid */}
        <section className="space-y-3">
          {/* Primary Earnings Breakdown: Total Earned = Video Rewards + Referral Rewards + Stars Earnings */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Total Earned */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Total Earned</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {rewardsService.formatCentsToUsd(displayTotalEarnedCents)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Lifetime gross earnings</p>
              </div>
            </div>

            {/* Video Rewards */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Video Rewards</span>
                <Video className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {rewardsService.formatCentsToUsd(displayVideoRewardsCents)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">$0.50 per 1k qualified views</p>
              </div>
            </div>

            {/* Referral Rewards */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Referral Rewards</span>
                <Gift className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {rewardsService.formatCentsToUsd(displayReferralRewardsCents)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">$0.10 per onboarded creator</p>
              </div>
            </div>

            {/* Stars Earnings ⭐ */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold flex items-center gap-1">
                  Stars Earnings <span aria-hidden="true">⭐</span>
                </span>
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {rewardsService.formatCentsToUsd(displaySogoStarsRewardsCents)}
                </p>
                <p className="text-xs font-semibold text-amber-400 font-mono mt-0.5">
                  {displaySogoStarsTotal.toLocaleString()} {displaySogoStarsTotal === 1 ? 'Star' : 'Stars'}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">From Stars received</p>
              </div>
            </div>
          </div>

          {/* Secondary Performance & Payout Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Qualified Views */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Qualified Views</span>
                <TrendingUp className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {displayQualifiedViews.toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Meets watch time & anti-fraud</p>
              </div>
            </div>

            {/* Successful Referrals */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Successful Referrals</span>
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {successfulReferrals.toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Verified onboarded creators
                </p>
              </div>
            </div>

            {/* Pending Payout */}
            <div className="col-span-2 sm:col-span-1 p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-semibold">Pending Payout</span>
                <Clock className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {rewardsService.formatCentsToUsd(summary.pendingPayoutCents || 0)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Currently processing</p>
              </div>
            </div>
          </div>
        </section>

        {/* Video Performance Statistics Section */}
        <section className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Video className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Video Performance Statistics
                </h3>
                <p className="text-[11px] text-slate-400">
                  Verified audience views and monetized qualified playback across your published videos.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Total Views */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <div className="flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-200">Total Views</span>
                </div>
                <span className="text-[10px] text-slate-500 uppercase font-mono">Gross Lifetime</span>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
                  {displayTotalViews.toLocaleString()}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Total raw video views recorded across all published videos.
                </p>
              </div>
            </div>

            {/* Qualified Views */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-semibold text-slate-200">Qualified Views</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  $0.50 / 1k views
                </span>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-extrabold text-amber-400 font-mono">
                  {displayQualifiedViews.toLocaleString()}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Views meeting watch duration and anti-fraud criteria for rewards.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-800 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={cn(
              'px-4 py-2.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer border-b-2',
              activeTab === 'overview'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            )}
          >
            Overview & Rules
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={cn(
              'px-4 py-2.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer border-b-2',
              activeTab === 'ledger'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            )}
          >
            Reward Ledger ({visibleLedger.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('referrals')}
            className={cn(
              'px-4 py-2.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer border-b-2',
              activeTab === 'referrals'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            )}
          >
            Referral Program ({referrals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payouts')}
            className={cn(
              'px-4 py-2.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer border-b-2',
              activeTab === 'payouts'
                ? 'text-amber-400 border-amber-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            )}
          >
            Payout History ({payouts.length})
          </button>
        </div>

        {/* TAB 1: OVERVIEW & RULES */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Rates Explainer Banner */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                SogoSocial Creator Program Rates
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Monetize your creative content with transparent, auditable rates:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <div className="text-xs font-semibold text-cyan-400">Video Rewards</div>
                  <div className="text-lg font-bold text-white font-mono mt-0.5">$0.50 USD</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Per 1,000 qualified video views ($0.0005 per qualified view)
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <div className="text-xs font-semibold text-purple-400">Referral Rewards</div>
                  <div className="text-lg font-bold text-white font-mono mt-0.5">
                    {rewardsService.formatCentsToUsd(rewardsService.REFERRAL_REWARD_CENTS)} USD
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    For every creator who signs up with your code & completes onboarding
                  </div>
                </div>
              </div>
            </div>

            {/* Qualified View Standards Checklist */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Zero-Trust View Qualification Standards
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                To prevent fraud and protect platform economics, raw video views and qualified reward views are tracked separately:
              </p>

              <ul className="mt-3 space-y-2 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Meaningful Consumption:</strong> The viewer must watch at least 5 seconds continuously (or 50% of short videos). Instant bounces are discarded.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Authenticated Viewers:</strong> Only logged-in, legitimate SogoSocial accounts are eligible.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>No Self-Views:</strong> Watching your own videos does not generate earnings.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>24-Hour Cooldown:</strong> Multiple views or refreshes of the same video by the same account within 24 hours are consolidated.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Anti-Bot Velocity Filter:</strong> High-frequency automated skipping or script farms are quarantined.
                  </span>
                </li>
              </ul>
            </div>

            {/* Referral Quick Share Card */}
            <div
              id="creator-referral-code-section"
              className="p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border border-purple-500/30 scroll-mt-24 transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">Your Creator Referral Code</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Share your code to earn $0.10 for every friend who joins
                  </p>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 font-mono font-bold text-xs">
                  {referralCode}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap sm:flex-nowrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyCode}
                  leftIcon={copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  className="flex-1"
                >
                  {copiedCode ? 'Code Copied!' : 'Copy Code'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyLink}
                  leftIcon={copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  className="flex-1"
                >
                  {copiedLink ? 'Link Copied!' : 'Copy Link'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleShareLink}
                  leftIcon={<Share2 className="w-3.5 h-3.5" />}
                  className="flex-1 bg-purple-600 hover:bg-purple-500"
                >
                  Share
                </Button>
              </div>
              <p className="text-[10px] text-purple-300/70 mt-2">
                Link directs to Google Play Store with your unique referral code attached.
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: AUDITABLE REWARD LEDGER */}
        {activeTab === 'ledger' && (
          <div className="space-y-3">
            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {(['all', 'video_reward', 'referral_reward', 'sogo_stars_reward', 'payout'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setLedgerFilter(type)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer',
                    ledgerFilter === type
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  )}
                >
                  {type === 'all'
                    ? 'All Transactions'
                    : type === 'video_reward'
                    ? 'Video Rewards'
                    : type === 'referral_reward'
                    ? 'Referral Rewards'
                    : type === 'sogo_stars_reward'
                    ? '⭐ Sogo Stars'
                    : 'Payouts'}
                </button>
              ))}
            </div>

            {visibleLedger.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
                <Info className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">No Ledger Transactions Yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Publish reels and invite creators with your referral link to begin accumulating verified reward credits.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleLedger.map((item) => {
                  const isPositive = item.amountCents >= 0;
                  return (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={cn(
                            'p-2 rounded-lg shrink-0 mt-0.5',
                            item.type === 'video_reward'
                              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                              : item.type === 'referral_reward'
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : item.type === 'sogo_stars_reward'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          )}
                        >
                          {item.type === 'video_reward' ? (
                            <Video className="w-4 h-4" />
                          ) : item.type === 'referral_reward' ? (
                            <Gift className="w-4 h-4" />
                          ) : item.type === 'sogo_stars_reward' ? (
                            <Star className="w-4 h-4 fill-amber-400" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-200 truncate">
                            {item.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 flex-wrap font-mono">
                            <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                            <span>•</span>
                            <span className="truncate max-w-[140px] text-slate-600">
                              ID: {item.eventId || item.id}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={cn(
                            'text-sm font-bold font-mono',
                            isPositive ? 'text-emerald-400' : 'text-slate-200'
                          )}
                        >
                          {isPositive ? '+' : '-'}
                          {rewardsService.formatCentsToUsd(Math.abs(item.amountCents))}
                        </span>
                        <div className="mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {item.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: REFERRAL PROGRAM */}
        {activeTab === 'referrals' && (
          <div className="space-y-4">
            {/* Referral Banner */}
            <div className="p-5 rounded-xl bg-gradient-to-br from-purple-950/50 via-slate-900 to-slate-900 border border-purple-500/30">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Invite & Earn
                  </span>
                  <h3 className="text-base font-bold text-white mt-2">
                    Earn $0.10 USD for Every Creator You Refer
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-lg">
                    When a new creator signs up using your referral code and finishes their profile, you immediately receive a $0.10 verified credit.
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20 hidden sm:block shrink-0">
                  <Users className="w-8 h-8" />
                </div>
              </div>

              {/* Share Box */}
              <div className="mt-4 p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Your Referral Code</span>
                  <p className="text-sm font-mono font-bold text-amber-400 truncate">{referralCode}</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopyCode}
                    leftIcon={copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  >
                    {copiedCode ? 'Copied' : 'Copy Code'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopyLink}
                    leftIcon={copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  >
                    {copiedLink ? 'Link Copied' : 'Copy Link'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleShareLink}
                    leftIcon={<Share2 className="w-3.5 h-3.5" />}
                    className="bg-purple-600 hover:bg-purple-500"
                  >
                    Share
                  </Button>
                </div>
              </div>
            </div>

            {/* Referred Creators List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                Attributed Creators ({referrals.length})
              </h4>

              {referrals.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
                  <Users className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                  <p className="text-sm font-semibold text-slate-300">No Referrals Yet</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Share your unique referral link to start inviting your creator network.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {referrals.map((r) => (
                    <div
                      key={r.id}
                      className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 overflow-hidden">
                          {r.referredAvatarUrl ? (
                            <img
                              src={r.referredAvatarUrl}
                              alt={r.referredDisplayName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            r.referredDisplayName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">{r.referredDisplayName}</p>
                          <p className="text-[11px] text-slate-400">@{r.referredUsername}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={cn(
                            'text-xs font-bold font-mono',
                            r.rewardGranted ? 'text-emerald-400' : 'text-slate-400'
                          )}
                        >
                          {r.rewardGranted
                            ? `+${rewardsService.formatCentsToUsd(r.rewardAmountCents ?? rewardsService.REFERRAL_REWARD_CENTS)} USD`
                            : 'Pending'}
                        </span>
                        <div className="mt-0.5">
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase',
                              r.status === 'qualified'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            )}
                          >
                            {r.status === 'qualified' ? 'Verified' : 'Pending Profile'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PAYOUT HISTORY */}
        {activeTab === 'payouts' && (
          <div className="space-y-3">
            {payouts.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
                <CreditCard className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">No Payout Requests</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  When you reach at least $50.00 USD in available balance and 10 successful referrals, you can request a payout via PayPal, Bank Wire, or Venmo.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {payouts.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white font-mono">
                          {rewardsService.formatCentsToUsd(p.amountCents)}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded uppercase font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {p.payoutMethod.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                        <span>Requested: {new Date(p.requestedAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="font-mono text-slate-500">ID: {p.id}</span>
                      </div>

                      {p.rejectionReason && (
                        <p className="text-xs text-rose-400 mt-1">
                          Notice: {p.rejectionReason}
                        </p>
                      )}
                    </div>

                    <div className="text-left sm:text-right">
                      <span
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full uppercase font-bold inline-block',
                          p.status === 'paid'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : p.status === 'pending'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : p.status === 'approved'
                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        )}
                      >
                        {p.status}
                      </span>
                      {p.processedAt && (
                        <p className="text-[10px] text-slate-500 mt-1">
                          Processed: {new Date(p.processedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* WITHDRAWAL VALIDATION POPUP MODAL */}
      {withdrawValidationPopup && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setWithdrawValidationPopup(null)}
        >
          <div
            className="w-full max-w-md bg-[#0F172A] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-validation-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'p-2.5 rounded-xl border shrink-0',
                    withdrawValidationPopup.reasonCode === 'referrals_below_minimum'
                      ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                      : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  )}
                >
                  {withdrawValidationPopup.reasonCode === 'referrals_below_minimum' ? (
                    <Users className="w-5 h-5" />
                  ) : (
                    <DollarSign className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 id="withdraw-validation-title" className="text-base font-bold text-white">
                    {withdrawValidationPopup.reasonCode === 'referrals_below_minimum'
                      ? 'Creator Rewards Withdrawal Check'
                      : (withdrawValidationPopup.title || '$50 Minimum Balance Required')}
                  </h3>
                  {withdrawValidationPopup.reasonCode !== 'referrals_below_minimum' && (
                    <p className="text-xs text-slate-400">
                      Creator Rewards Withdrawal Check
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWithdrawValidationPopup(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
              {withdrawValidationPopup.reasonCode === 'referrals_below_minimum' ? (
                <>
                  <h4 className="text-base font-bold text-white">
                    10 Referrals Required
                  </h4>
                  <p className="text-sm font-medium text-slate-200 leading-relaxed">
                    You need at least 10 referrals for your first withdrawal on Sogo.
                  </p>
                  <p className="text-xs font-semibold text-slate-400 pt-2.5 border-t border-slate-800/80">
                    Successful referrals: {withdrawValidationPopup.successfulReferralsCount ?? successfulReferrals ?? 0} / 10
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-white leading-relaxed">
                    {withdrawValidationPopup.message ||
                      'You need at least $50 in available Creator Rewards balance before you can withdraw.'}
                  </p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Available balance</span>
                      <span className="font-mono font-bold text-amber-400">
                        {rewardsService.formatCentsToUsd(withdrawValidationPopup.availableBalanceCents)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Minimum withdrawal</span>
                      <span className="font-mono font-bold text-slate-200">
                        $50.00
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {withdrawValidationPopup.reasonCode === 'referrals_below_minimum' ? (
              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  type="button"
                  onClick={handleInviteFriend}
                  leftIcon={<Users className="w-4 h-4" />}
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5"
                >
                  Invite Friend
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  onClick={() => setWithdrawValidationPopup(null)}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5"
                >
                  OK
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WITHDRAW MODAL */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0F172A] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Request Payout</h3>
                  <p className="text-xs text-slate-400">
                    Available: {rewardsService.formatCentsToUsd(availableCents)} • Referrals: {successfulReferrals}/{minPayoutReferrals} Verified
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWithdrawModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {withdrawSuccess ? (
              <div className="py-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6 stroke-[3]" />
                </div>
                <h4 className="text-base font-bold text-white">Payout Requested Successfully!</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Your withdrawal of {rewardsService.formatCentsToUsd(withdrawAmountDollars * 100)} has been queued. Funds are reserved and will be disbursed to your account.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmitWithdraw} className="space-y-4">
                {withdrawError && (
                  <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{withdrawError}</span>
                  </div>
                )}

                {/* Amount Selection */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Withdrawal Amount (Min $50.00 USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                    <input
                      type="number"
                      min={50}
                      max={rewardsService.centsToUsd(availableCents)}
                      step="0.50"
                      value={withdrawAmountDollars}
                      onChange={(e) => setWithdrawAmountDollars(Number(e.target.value))}
                      className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono font-bold focus:border-amber-400 focus:outline-none"
                      required
                    />
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setWithdrawAmountDollars(50)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-semibold text-slate-300 hover:bg-slate-700"
                    >
                      $50 (Min)
                    </button>
                    {availableCents >= 10000 && (
                      <button
                        type="button"
                        onClick={() => setWithdrawAmountDollars(100)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-semibold text-slate-300 hover:bg-slate-700"
                      >
                        $100
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setWithdrawAmountDollars(rewardsService.centsToUsd(availableCents))}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-semibold text-amber-400 hover:bg-slate-700"
                    >
                      All Available ({rewardsService.formatCentsToUsd(availableCents)})
                    </button>
                  </div>
                </div>

                {/* Payout Method */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Select Payout Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setWithdrawMethod('paypal')}
                      className={cn(
                        'p-2.5 rounded-xl border text-center transition-all cursor-pointer',
                        withdrawMethod === 'paypal'
                          ? 'bg-amber-500/10 border-amber-500 text-amber-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <CreditCard className="w-4 h-4 mx-auto mb-1" />
                      <span className="text-xs block">PayPal</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setWithdrawMethod('bank_transfer')}
                      className={cn(
                        'p-2.5 rounded-xl border text-center transition-all cursor-pointer',
                        withdrawMethod === 'bank_transfer'
                          ? 'bg-amber-500/10 border-amber-500 text-amber-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <Building2 className="w-4 h-4 mx-auto mb-1" />
                      <span className="text-xs block">Bank Transfer</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setWithdrawMethod('venmo')}
                      className={cn(
                        'p-2.5 rounded-xl border text-center transition-all cursor-pointer',
                        withdrawMethod === 'venmo'
                          ? 'bg-amber-500/10 border-amber-500 text-amber-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <Sparkles className="w-4 h-4 mx-auto mb-1" />
                      <span className="text-xs block">Venmo</span>
                    </button>
                  </div>
                </div>

                {/* Dynamic Details based on method */}
                {withdrawMethod === 'paypal' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      PayPal Account Email
                    </label>
                    <input
                      type="email"
                      placeholder="your.email@example.com"
                      value={accountEmail}
                      onChange={(e) => setAccountEmail(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                      required
                    />
                  </div>
                )}

                {withdrawMethod === 'bank_transfer' && (
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Account Holder Name
                      </label>
                      <input
                        type="text"
                        placeholder="Legal Full Name"
                        value={accountHolderName}
                        onChange={(e) => setAccountHolderName(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          Bank Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Chase"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          Routing / IBAN
                        </label>
                        <input
                          type="text"
                          placeholder="Routing number"
                          value={routingOrIban}
                          onChange={(e) => setRoutingOrIban(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Account Number
                      </label>
                      <input
                        type="text"
                        placeholder="Account number"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                        required
                      />
                    </div>
                  </div>
                )}

                {withdrawMethod === 'venmo' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Venmo Handle
                    </label>
                    <input
                      type="text"
                      placeholder="@your-username"
                      value={venmoHandle}
                      onChange={(e) => setVenmoHandle(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Notes or Reference (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Monthly creator withdrawal"
                    value={withdrawNotes}
                    onChange={(e) => setWithdrawNotes(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    disabled={isSubmittingPayout}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                  >
                    {isSubmittingPayout ? 'Submitting...' : 'Confirm Withdrawal'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* HOW IT WORKS / RULES MODAL */}
      {showHowItWorksModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0F172A] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-white">How Creator Rewards Work</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHowItWorksModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div>
                <h4 className="font-bold text-amber-400 text-sm mb-1">1. Video Reward Rate</h4>
                <p className="leading-relaxed text-slate-400">
                  Creators earn <strong>$0.50 USD per 1,000 qualified video views</strong> ($0.0005 per qualified view).
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[11px]">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">1,000 views = $0.50</div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">10,000 views = $5.00</div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">50,000 views = $25.00</div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">100,000 views = $50.00</div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-amber-400 text-sm mb-1">2. Qualified Views vs. Raw Views</h4>
                <p className="leading-relaxed text-slate-400">
                  Not all raw view impressions qualify for monetization. SogoSocial enforces a Zero-Trust anti-fraud policy:
                </p>
                <ul className="list-disc pl-4 mt-1.5 space-y-1 text-slate-400">
                  <li>Viewer must be logged in to an active SogoSocial account.</li>
                  <li>Watching your own video does not generate rewards.</li>
                  <li>Viewer must watch for at least 5 continuous seconds (or 50% of short videos).</li>
                  <li>24-hour cooldown: an account can only qualify for the same video once every 24 hours.</li>
                  <li>Bot detection and velocity limits exclude rapid automated skips.</li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-purple-400 text-sm mb-1">3. Referral Program</h4>
                <p className="leading-relaxed text-slate-400">
                  Earn <strong>$0.10 USD</strong> for every creator who joins SogoSocial with your referral code and finishes onboarding their profile. Self-referrals are strictly disallowed.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-cyan-400 text-sm mb-1">4. Payout Eligibility & Policy</h4>
                <p className="leading-relaxed text-slate-400">
                  To request a withdrawal, creators must satisfy <strong>both</strong> payout requirements:
                </p>
                <ul className="list-disc pl-4 mt-1.5 space-y-1 text-slate-400">
                  <li>
                    <strong>Minimum Available Balance:</strong> At least <strong>$50.00 USD</strong> in available reward balance.
                  </li>
                  <li>
                    <strong>Minimum Successful Referrals:</strong> At least <strong>10 verified referrals</strong> of creators who joined with your code and completed onboarding.
                  </li>
                </ul>
                <p className="leading-relaxed text-slate-400 mt-1.5">
                  Once both requirements are met, withdrawals can be requested via PayPal, Bank Wire, or Venmo and are reviewed within 1–3 business days.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowHowItWorksModal(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white"
              >
                Got It
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
