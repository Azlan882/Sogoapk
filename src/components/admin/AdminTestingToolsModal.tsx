import React, { useState, useEffect } from 'react';
import {
  Eye,
  UserPlus,
  Heart,
  MessageCircle,
  DollarSign,
  Video,
  X,
  CheckCircle,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { AdminUserRecord, AdminVideoRecord, AdminPostRecord, GrantTestRewardDiagnostic } from '../../types/admin';
import { registerBackInterceptor } from '../../services/backButtonService';

export type TestingToolType = 'views' | 'followers' | 'likes' | 'comments' | 'reward' | 'video_metrics';

interface AdminTestingToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  initialTool?: TestingToolType;
  initialTargetType?: 'video' | 'post' | 'user';
  initialTargetId?: string;
  initialTargetTitle?: string;
  users?: AdminUserRecord[];
  videos?: AdminVideoRecord[];
  posts?: AdminPostRecord[];
}

const SAMPLE_REALISTIC_COMMENTS = [
  'Incredible composition and lighting here!',
  'Love the mood and aesthetic on this one.',
  'Super clean execution, keep it up!',
  'The details on this are unmatched.',
  'Really inspiring content, appreciate you sharing this.',
  'Such high quality visual flow!',
  'The sound design paired with the motion is so smooth.',
  'Top tier work, definitely saving this for reference!',
];

export const AdminTestingToolsModal: React.FC<AdminTestingToolsModalProps> = ({
  isOpen,
  onClose,
  onRefresh,
  initialTool = 'views',
  initialTargetType,
  initialTargetId,
  initialTargetTitle,
  users = [],
  videos = [],
  posts = [],
}) => {
  const [selectedTool, setSelectedTool] = useState<TestingToolType>(initialTool);
  const [targetId, setTargetId] = useState<string>(initialTargetId || '');
  const [targetType, setTargetType] = useState<'video' | 'post' | 'user'>(
    initialTargetType || (initialTool === 'views' ? 'video' : initialTool === 'followers' || initialTool === 'reward' ? 'user' : 'video')
  );

  // Form states (kept as raw strings for fluid typing and backspacing)
  const [viewsCount, setViewsCount] = useState<string>('100');
  const [followersCount, setFollowersCount] = useState<string>('10');
  const [likesCount, setLikesCount] = useState<string>('25');
  const [commentText, setCommentText] = useState<string>('');
  const [rewardAmountDollars, setRewardAmountDollars] = useState<string>('5.00');
  const [rewardReason, setRewardReason] = useState<string>('Admin staging test reward grant');
  const [testTotalViews, setTestTotalViews] = useState<string>('10000');
  const [testQualifiedViews, setTestQualifiedViews] = useState<string>('8000');
  const [testMetricsReason, setTestMetricsReason] = useState<string>('Admin test video metrics staging calculation');

  const [processing, setProcessing] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diagnosticReport, setDiagnosticReport] = useState<GrantTestRewardDiagnostic | null>(null);

  // Live calculation for video metrics ($0.50 per 1,000 qualified views)
  const parsedTotalViews = parseInt(testTotalViews.trim(), 10) || 0;
  const parsedQualifiedViews = parseInt(testQualifiedViews.trim(), 10) || 0;
  const calculatedRewardCents = Math.floor((parsedQualifiedViews * 50) / 1000);
  const calculatedRewardDollars = (calculatedRewardCents / 100).toFixed(2);
  const isViewsInvalid = parsedQualifiedViews > parsedTotalViews;

  // Close modal when hardware Back button is pressed
  useEffect(() => {
    if (!isOpen) return;
    return registerBackInterceptor(() => {
      onClose();
      return true;
    });
  }, [isOpen, onClose]);

  // Controlled text input change helpers that preserve typing/backspacing
  const handleDigitOnlyChange = (setter: React.Dispatch<React.SetStateAction<string>>) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const val = e.target.value;
    // Allow empty string (so user can freely backspace) or digits only
    if (val === '' || /^\d+$/.test(val)) {
      setter(val);
    }
  };

  const handleDollarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty string or numbers with optional single decimal point e.g. "5", "5.", "5.5", "5.50"
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setRewardAmountDollars(val);
    }
  };

  // Sync state when modal opens or initial props change
  useEffect(() => {
    if (isOpen) {
      setSelectedTool(initialTool);
      if (initialTargetId) {
        setTargetId(initialTargetId);
      } else {
        // Pick smart default target if available
        if ((initialTool === 'views' || (initialTool === 'likes' && targetType === 'video') || (initialTool === 'comments' && targetType === 'video')) && videos.length > 0) {
          setTargetId(videos[0].id);
        } else if ((initialTool === 'followers' || initialTool === 'reward' || initialTool === 'video_metrics') && users.length > 0) {
          setTargetId(users[0].id);
        } else if (initialTool === 'likes' && targetType === 'post' && posts.length > 0) {
          setTargetId(posts[0].id);
        }
      }
      if (initialTargetType) setTargetType(initialTargetType);
      setSuccessMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen, initialTool, initialTargetId, initialTargetType, videos, users, posts, targetType]);

  // Adjust targetType when tool changes
  const handleSelectTool = (tool: TestingToolType) => {
    setSelectedTool(tool);
    setSuccessMessage(null);
    setErrorMessage(null);

    if (tool === 'views') {
      setTargetType('video');
      if (!initialTargetId && videos.length > 0) setTargetId(videos[0].id);
    } else if (tool === 'followers' || tool === 'reward' || tool === 'video_metrics') {
      setTargetType('user');
      if (!initialTargetId && users.length > 0) setTargetId(users[0].id);
    } else if (tool === 'likes' || tool === 'comments') {
      if (targetType === 'user') {
        setTargetType('video');
        if (videos.length > 0) setTargetId(videos[0].id);
      }
    }
  };

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (!targetId) {
      setErrorMessage('Please select or specify a target ID.');
      return;
    }

    setProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setDiagnosticReport(null);

    try {
      if (selectedTool === 'views') {
        const rawTrimmed = viewsCount.trim();
        const parsed = parseInt(rawTrimmed, 10);
        if (!rawTrimmed || isNaN(parsed) || parsed < 1) {
          setErrorMessage('Please enter a valid views count of at least 1.');
          setProcessing(false);
          return;
        }
        const safeCount = Math.min(500000, parsed);
        const res = await adminService.addTestViews(targetId, safeCount);
        setSuccessMessage(`Successfully added ${res.addedViews} test views to video ${targetId.slice(0, 10)}... (distinguishable via testViewsCount).`);
      } else if (selectedTool === 'followers') {
        const rawTrimmed = followersCount.trim();
        const parsed = parseInt(rawTrimmed, 10);
        if (!rawTrimmed || isNaN(parsed) || parsed < 1) {
          setErrorMessage('Please enter a valid followers count of at least 1.');
          setProcessing(false);
          return;
        }
        const safeCount = Math.min(50000, parsed);
        const res = await adminService.addTestFollowers(targetId, safeCount);
        setSuccessMessage(`Successfully added ${res.addedFollowers} test followers to user ${targetId.slice(0, 10)}... (no fake Auth accounts created).`);
      } else if (selectedTool === 'likes') {
        const rawTrimmed = likesCount.trim();
        const parsed = parseInt(rawTrimmed, 10);
        if (!rawTrimmed || isNaN(parsed) || parsed < 1) {
          setErrorMessage('Please enter a valid likes count of at least 1.');
          setProcessing(false);
          return;
        }
        const safeCount = Math.min(50000, parsed);
        const res = await adminService.addTestLikes(targetType as 'video' | 'post', targetId, safeCount);
        setSuccessMessage(`Successfully added ${res.addedLikes} test likes to ${targetType} ${targetId.slice(0, 10)}... (distinguishable via testLikesCount).`);
      } else if (selectedTool === 'comments') {
        const text = commentText.trim() || SAMPLE_REALISTIC_COMMENTS[Math.floor(Math.random() * SAMPLE_REALISTIC_COMMENTS.length)];
        const res = await adminService.addTestComment(targetType as 'video' | 'post', targetId, text);
        setSuccessMessage(`Successfully added synthetic comment from ${res.comment?.user?.displayName || 'creator'} without notification spam.`);
        setCommentText('');
      } else if (selectedTool === 'reward') {
        const rawTrimmed = rewardAmountDollars.trim();
        const parsedDollars = parseFloat(rawTrimmed);
        if (!rawTrimmed || isNaN(parsedDollars) || parsedDollars <= 0) {
          setErrorMessage('Please enter a valid dollar amount greater than $0.00');
          setProcessing(false);
          return;
        }
        const cents = Math.round(parsedDollars * 100);
        if (cents <= 0) {
          setErrorMessage('Please enter a valid dollar amount greater than $0.00');
          setProcessing(false);
          return;
        }
        const res = await adminService.grantTestReward(
          targetId,
          cents,
          rewardReason.trim() || 'Admin staging test reward',
          undefined,
          (diag) => {
            setDiagnosticReport({ ...diag });
          }
        );
        if (res.alreadyProcessed) {
          setErrorMessage(`Notice: Operation ${res.operationId} was already processed. Duplicate reward was blocked.`);
        } else {
          setSuccessMessage(`Successfully granted $${(cents / 100).toFixed(2)} test reward to user ${targetId.slice(0, 10)}... Recorded in reward_ledger with transactionType: "admin_test_reward".`);
        }
      } else if (selectedTool === 'video_metrics') {
        const total = parseInt(testTotalViews.trim(), 10);
        const qualified = parseInt(testQualifiedViews.trim(), 10);

        if (isNaN(total) || total < 0) {
          setErrorMessage('Please enter a valid non-negative number for Total Test Views.');
          setProcessing(false);
          return;
        }
        if (isNaN(qualified) || qualified < 0) {
          setErrorMessage('Please enter a valid non-negative number for Qualified Test Views.');
          setProcessing(false);
          return;
        }
        if (qualified > total) {
          setErrorMessage(`Qualified test views (${qualified.toLocaleString()}) cannot exceed total test views (${total.toLocaleString()}).`);
          setProcessing(false);
          return;
        }

        const res = await adminService.addTestVideoMetrics(
          targetId,
          total,
          qualified,
          testMetricsReason.trim() || 'Admin test video metrics staging calculation',
          undefined,
          (diag) => {
            setDiagnosticReport({ ...diag });
          }
        );

        if (res.alreadyProcessed) {
          setErrorMessage(`Notice: Operation ${res.operationId} was already processed. Duplicate test metrics entry blocked.`);
        } else {
          setSuccessMessage(
            `Successfully added +${res.addedQualifiedViews.toLocaleString()} qualified views (Previous: ${res.previousQualifiedViews.toLocaleString()} → New Total: ${res.newQualifiedViews.toLocaleString()} qualified views, $${(res.testVideoRewardsCents / 100).toFixed(2)} cumulative video reward). Recorded in reward_ledger with transactionType: "admin_test_reward".`
          );
        }
      }

      onRefresh();
    } catch (err: any) {
      if (err?.diagnostic) {
        setDiagnosticReport(err.diagnostic);
      }
      setErrorMessage(err.message || 'Operation failed.');
    } finally {
      setProcessing(false);
    }
  };

  const handlePickRandomComment = () => {
    const random = SAMPLE_REALISTIC_COMMENTS[Math.floor(Math.random() * SAMPLE_REALISTIC_COMMENTS.length)];
    setCommentText(random);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Admin Testing & Staging Console
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Staging Safe
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Controlled testing tools with separate test markers, ledger tagging, and audit trail.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tool Selection Tabs */}
        <div className="px-5 pt-4 bg-slate-900/90 border-b border-slate-800/80 overflow-x-auto">
          <div className="flex items-center gap-1.5 pb-3">
            <button
              type="button"
              onClick={() => handleSelectTool('views')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTool === 'views'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>1. Add Views</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTool('followers')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTool === 'followers'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>2. Add Followers</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTool('likes')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTool === 'likes'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              <span>3. Add Likes</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTool('comments')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTool === 'comments'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>4. Add Comments</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTool('reward')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTool === 'reward'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>5. Grant Reward</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTool('video_metrics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                selectedTool === 'video_metrics'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>6. Test Video Metrics</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Target Selection Card */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                Target Entity
              </span>
              {(selectedTool === 'likes' || selectedTool === 'comments') && (
                <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetType('video');
                      if (videos.length > 0) setTargetId(videos[0].id);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      targetType === 'video' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'
                    }`}
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetType('post');
                      if (posts.length > 0) setTargetId(posts[0].id);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      targetType === 'post' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'
                    }`}
                  >
                    Post
                  </button>
                </div>
              )}
            </div>

            {/* Quick Picker dropdown or manual target ID */}
            {targetType === 'video' && videos.length > 0 ? (
              <div className="space-y-1">
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full p-2 text-xs bg-slate-900 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                >
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.caption ? `"${v.caption.slice(0, 35)}..."` : 'Video'} (ID: {v.id.slice(0, 8)}... | {v.viewsCount || 0} views)
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-500 font-mono">
                  Active Target ID: {targetId}
                </div>
              </div>
            ) : targetType === 'user' && users.length > 0 ? (
              <div className="space-y-1">
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full p-2 text-xs bg-slate-900 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      @{u.username || 'user'} - {u.displayName || u.email || u.id} ({u.followersCount || 0} followers | ${(Number(u.availableBalanceCents || 0) / 100).toFixed(2)})
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-500 font-mono">
                  Active Target UID: {targetId}
                </div>
              </div>
            ) : targetType === 'post' && posts.length > 0 ? (
              <div className="space-y-1">
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full p-2 text-xs bg-slate-900 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                >
                  {posts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.caption ? `"${p.caption.slice(0, 35)}..."` : 'Post'} (ID: {p.id.slice(0, 8)}... | @{p.user?.username})
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-500 font-mono">
                  Active Target ID: {targetId}
                </div>
              </div>
            ) : (
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={`Enter target ${targetType} ID...`}
                className="w-full p-2 text-xs bg-slate-900 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
              />
            )}

            {initialTargetTitle && (
              <div className="text-[11px] text-cyan-400 font-medium truncate">
                Selected: {initialTargetTitle}
              </div>
            )}
          </div>

          {/* Tool 1: Add Views Form */}
          {selectedTool === 'views' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  Staging Safe Views Pattern
                </div>
                Increments <code className="text-white">viewsCount</code> and separate{' '}
                <code className="text-white">testViewsCount</code>. Deliberately skips creating fake watch
                sessions in <code className="text-white">video_watch_sessions</code> so monetization anti-cheat remains pristine.
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Views to Add
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[100, 500, 1000, 5000].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setViewsCount(String(count))}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        viewsCount === String(count)
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      +{count.toLocaleString()}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={viewsCount}
                  onChange={handleDigitOnlyChange(setViewsCount)}
                  placeholder="e.g. 100"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* Tool 2: Add Followers Form */}
          {selectedTool === 'followers' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  Staging Safe Followers Pattern
                </div>
                Increments <code className="text-white">followersCount</code> and separate{' '}
                <code className="text-white">testFollowersCount</code>. Does{' '}
                <strong className="text-white">NOT</strong> create fake Firebase Auth accounts or corrupt authentication databases.
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Followers to Add
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[10, 25, 50, 100].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setFollowersCount(String(count))}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        followersCount === String(count)
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      +{count}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={followersCount}
                  onChange={handleDigitOnlyChange(setFollowersCount)}
                  placeholder="e.g. 10"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* Tool 3: Add Likes Form */}
          {selectedTool === 'likes' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  Staging Safe Likes Pattern
                </div>
                Increments <code className="text-white">likesCount</code> and separate{' '}
                <code className="text-white">testLikesCount</code> on the {targetType} record.
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Likes to Add
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[10, 25, 50, 100].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setLikesCount(String(count))}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        likesCount === String(count)
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      +{count}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={likesCount}
                  onChange={handleDigitOnlyChange(setLikesCount)}
                  placeholder="e.g. 25"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* Tool 4: Add Comments Form */}
          {selectedTool === 'comments' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  Realistic Synthetic Comment Pattern
                </div>
                Creates realistic synthetic comment with high-fidelity name and profile. Explicitly skips
                triggering user push notifications to avoid spamming the author.
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Comment Text
                  </label>
                  <button
                    type="button"
                    onClick={handlePickRandomComment}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Random Realistic Suggestion</span>
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Enter comment text or click above for a random realistic suggestion..."
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder-slate-500"
                />
              </div>
            </div>
          )}

          {/* Tool 5: Grant Test Reward Form */}
          {selectedTool === 'reward' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-xs text-emerald-300">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Authoritative Test Reward Ledger Pattern
                </div>
                Credits creator reward balance and records transaction in <code className="text-white">reward_ledger</code> with{' '}
                <code className="text-white">transactionType: "admin_test_reward"</code>. Audited in{' '}
                <code className="text-white">adminAuditLogs</code>.
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Reward Amount (USD $)
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {['5.00', '10.00', '25.00', '50.00'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setRewardAmountDollars(amt)}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        rewardAmountDollars === amt
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={rewardAmountDollars}
                  onChange={handleDollarChange}
                  placeholder="e.g. 5.00"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Testing Audit Reason
                </label>
                <input
                  type="text"
                  value={rewardReason}
                  onChange={(e) => setRewardReason(e.target.value)}
                  placeholder="e.g. Creator payout workflow staging verification"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* Tool 6: Add Test Video Metrics Form */}
          {selectedTool === 'video_metrics' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-300">
                <div className="font-bold flex items-center gap-1.5 mb-1 text-amber-400">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  Staging Safe Video Metrics Pattern
                </div>
                Applies test video metrics (<code className="text-white">testViewsCount</code>,{' '}
                <code className="text-white">testQualifiedViewsCount</code>, and{' '}
                <code className="text-white">testVideoRewardsCents</code>) to{' '}
                <code className="text-white">creator_rewards/{targetId || '{userId}'}</code> with{' '}
                <code className="text-white">hasAdminTestData: true</code>. Creates an auditable transaction in{' '}
                <code className="text-white">reward_ledger</code> with{' '}
                <code className="text-white">transactionType: "admin_test_reward"</code> and{' '}
                <code className="text-white">isAdminTestData: true</code>. Organic analytics, genuine rewards, and fraud filters remain completely untouched.
              </div>

              {/* Total Test Views */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Total Test Views
                  </label>
                  <span className="text-[10px] text-slate-400">Lifetime gross views</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[5000, 10000, 50000, 100000].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setTestTotalViews(String(count))}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        testTotalViews === String(count)
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {count >= 1000 ? `${count / 1000}k` : count}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={testTotalViews}
                  onChange={handleDigitOnlyChange(setTestTotalViews)}
                  placeholder="e.g. 10000"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              {/* Qualified Test Views */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Qualified Test Views
                  </label>
                  <span className="text-[10px] text-slate-400">Meets watch time & anti-fraud</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[4000, 8000, 40000, 80000].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setTestQualifiedViews(String(count))}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        testQualifiedViews === String(count)
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {count >= 1000 ? `${count / 1000}k` : count}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={testQualifiedViews}
                  onChange={handleDigitOnlyChange(setTestQualifiedViews)}
                  placeholder="e.g. 8000"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              {/* Live Calculation Display */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/40 space-y-2">
                <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    Live Reward Calculation
                  </span>
                  <span className="text-amber-400 font-bold font-mono text-[11px]">
                    $0.50 per 1,000 qualified views
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 py-1">
                  <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block">Total Views</span>
                    <span className="text-sm font-bold text-white font-mono">
                      {parsedTotalViews.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block">Qualified Views</span>
                    <span className="text-sm font-bold text-amber-400 font-mono">
                      {parsedQualifiedViews.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block">Test Reward</span>
                    <span className="text-sm font-bold text-emerald-400 font-mono">
                      ${calculatedRewardDollars}
                    </span>
                  </div>
                </div>

                {/* Mathematical Equation Breakdown */}
                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 text-[11px] font-mono text-slate-300 flex items-center justify-between">
                  <span className="text-slate-400">Formula:</span>
                  <span className="text-white font-semibold">
                    ({parsedQualifiedViews.toLocaleString()} ÷ 1,000) × $0.50 = <span className="text-emerald-400">${calculatedRewardDollars}</span>
                    <span className="text-slate-500 text-[10px] ml-1">({calculatedRewardCents.toLocaleString()}¢)</span>
                  </span>
                </div>

                {isViewsInvalid && (
                  <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Qualified views ({parsedQualifiedViews.toLocaleString()}) cannot exceed total views ({parsedTotalViews.toLocaleString()}).</span>
                  </div>
                )}
              </div>

              {/* Audit Reason */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Testing Audit Reason
                </label>
                <input
                  type="text"
                  value={testMetricsReason}
                  onChange={(e) => setTestMetricsReason(e.target.value)}
                  placeholder="e.g. Creator video rewards staging verification"
                  className="w-full p-2.5 text-xs bg-slate-950 text-white rounded-lg border border-slate-800 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* On-Screen Diagnostic Trace Panel for Grant Test Reward & Test Video Metrics */}
          {(selectedTool === 'reward' || selectedTool === 'video_metrics') && diagnosticReport && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {selectedTool === 'reward'
                      ? 'Grant Test Reward Diagnostic Trace'
                      : 'Test Video Metrics Diagnostic Trace'}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    diagnosticReport.status === 'SUCCESS'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : diagnosticReport.status === 'ERROR'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                  }`}
                >
                  {diagnosticReport.status}
                </span>
              </div>

              {/* Identity & Claims */}
              <div className="grid grid-cols-1 gap-1 text-[11px] text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                {/* Runtime Firebase Configuration Target */}
                <div className="py-1 border-b border-slate-800/60 bg-slate-950/60 -mx-1 px-2 rounded space-y-0.5 text-[10px]">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Firebase App Name:</span>
                    <span className="text-amber-300 font-mono font-semibold">{diagnosticReport.firebaseAppName || '[DEFAULT]'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Firebase Project ID:</span>
                    <span className="text-amber-300 font-mono font-semibold">{diagnosticReport.firebaseProjectId || 'sogo-e5ea9'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Firebase App ID:</span>
                    <span className="text-amber-300 font-mono truncate max-w-[200px]">{diagnosticReport.firebaseAppId || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Firestore Database ID:</span>
                    <span className="text-amber-300 font-mono font-semibold">{diagnosticReport.firestoreDatabaseId || '(default)'}</span>
                  </div>
                  {diagnosticReport.initializedAppsSummary && (
                    <div className="pt-0.5 text-[9px] text-slate-400 truncate">
                      <span>Initialized Apps: </span>
                      <span className="text-slate-300 font-mono">{diagnosticReport.initializedAppsSummary}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                  <span className="text-slate-400">1. Current Auth UID:</span>
                  <span className="text-white font-bold truncate max-w-[240px]">{diagnosticReport.authUid}</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                  <span className="text-slate-400">2. Current Auth Email:</span>
                  <span className="text-white font-bold">{diagnosticReport.authEmail}</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                  <span className="text-slate-400">3. Refreshed Token admin=true:</span>
                  <span
                    className={`font-bold ${
                      diagnosticReport.hasAdminClaim ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {diagnosticReport.hasAdminClaim ? 'YES (admin: true)' : 'NO (claim missing)'}
                  </span>
                </div>
                {diagnosticReport.claimsSummary && (
                  <div className="py-0.5 border-b border-slate-800/50 text-[10px] break-all">
                    <span className="text-slate-400">Token Claims: </span>
                    <span className="text-cyan-200">{diagnosticReport.claimsSummary}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-400">4. Current Attempt:</span>
                  <span className="text-cyan-300 font-bold truncate max-w-[240px]">{diagnosticReport.currentOperation}</span>
                </div>
              </div>

              {/* Step Checklist */}
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Operation Breakdown
                </span>
                <div className="space-y-1">
                  {diagnosticReport.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg flex items-center justify-between text-[11px] ${
                        step.status === 'SUCCESS'
                          ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40'
                          : step.status === 'FAILED'
                          ? 'bg-rose-950/40 text-rose-300 border border-rose-800/50'
                          : step.status === 'RUNNING'
                          ? 'bg-cyan-950/40 text-cyan-300 border border-cyan-800/50 animate-pulse'
                          : 'bg-slate-900/50 text-slate-500'
                      }`}
                    >
                      <div className="truncate mr-2">
                        <span className="font-semibold">{step.name}</span>
                        <span className="text-[10px] text-slate-400 block font-normal truncate">
                          {step.path}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold uppercase shrink-0">
                        {step.status === 'SUCCESS' && '✓ SUCCESS'}
                        {step.status === 'FAILED' && '✗ FAILED'}
                        {step.status === 'RUNNING' && '⋯ RUNNING'}
                        {step.status === 'PENDING' && '○ PENDING'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Failure Details */}
              {diagnosticReport.failedOperation && (
                <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-700/70 text-rose-200 text-[11px] space-y-1">
                  <div className="font-bold text-rose-300 flex items-center gap-1.5 pb-1 border-b border-rose-800/60">
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                    <span>Exact Denial / Failure Point:</span>
                  </div>
                  <div className="pt-1">
                    <span className="text-rose-400">Failed Operation: </span>
                    <span className="text-white font-bold">{diagnosticReport.failedOperation}</span>
                  </div>
                  <div>
                    <span className="text-rose-400">Document Path: </span>
                    <span className="text-white font-bold">{diagnosticReport.failedPath}</span>
                  </div>
                  <div>
                    <span className="text-rose-400">error.code: </span>
                    <span className="text-amber-300 font-bold">{diagnosticReport.errorCode || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-rose-400">error.message: </span>
                    <span className="text-rose-100">{diagnosticReport.errorMessage || 'Unknown error'}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feedback messages */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">
            Admin: azlanmalik774@gmail.com
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={processing || !targetId || (selectedTool === 'video_metrics' && isViewsInvalid)}
              onClick={handleExecute}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 ${
                selectedTool === 'video_metrics'
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : selectedTool === 'reward'
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {processing
                  ? 'Executing...'
                  : selectedTool === 'views'
                  ? `Add ${viewsCount.trim() ? (parseInt(viewsCount, 10) || 0).toLocaleString() : '0'} Test Views`
                  : selectedTool === 'followers'
                  ? `Add ${followersCount.trim() || '0'} Test Followers`
                  : selectedTool === 'likes'
                  ? `Add ${likesCount.trim() || '0'} Test Likes`
                  : selectedTool === 'comments'
                  ? 'Post Synthetic Comment'
                  : selectedTool === 'reward'
                  ? `Grant $${(parseFloat(rewardAmountDollars) || 0).toFixed(2)} Test Reward`
                  : `Apply Test Video Metrics ($${calculatedRewardDollars})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
