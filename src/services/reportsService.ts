import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export type ReportReason =
  | 'Harassment or bullying'
  | 'Hate speech'
  | 'Nudity or sexual content'
  | 'Violence or dangerous content'
  | 'Spam or scam'
  | 'False or misleading content'
  | 'Other';

export const REPORT_REASONS: ReportReason[] = [
  'Harassment or bullying',
  'Hate speech',
  'Nudity or sexual content',
  'Violence or dangerous content',
  'Spam or scam',
  'False or misleading content',
  'Other',
];

export interface SubmitReportParams {
  targetType: 'post' | 'video';
  targetId: string;
  targetAuthorId: string;
  targetAuthorUsername?: string;
  targetTitleOrCaption?: string;
  reason: ReportReason;
  details?: string;
}

export interface ReportRecord extends SubmitReportParams {
  id: string;
  reporterId: string;
  reporterUsername?: string;
  reporterEmail?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
  timestamp?: any;
}

/**
 * Submits a report for a post or Reel violating community guidelines.
 * Stores securely in Firestore `reports` collection.
 */
export async function submitReport(params: SubmitReportParams): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to submit a report.');
  }

  if (params.targetAuthorId && params.targetAuthorId === currentUser.uid) {
    throw new Error('You cannot report your own content.');
  }

  if (!params.targetId || !params.reason) {
    throw new Error('Report target ID and reason are required.');
  }

  const reportsCol = collection(db, 'reports');
  const newReportRef = doc(reportsCol);
  const nowIso = new Date().toISOString();

  const reportData: ReportRecord = {
    id: newReportRef.id,
    targetType: params.targetType,
    targetId: params.targetId,
    targetAuthorId: params.targetAuthorId,
    targetAuthorUsername: params.targetAuthorUsername || '',
    targetTitleOrCaption: (params.targetTitleOrCaption || '').slice(0, 300),
    reason: params.reason,
    details: (params.details || '').trim().slice(0, 1000),
    reporterId: currentUser.uid,
    reporterUsername: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
    reporterEmail: currentUser.email || undefined,
    status: 'pending',
    createdAt: nowIso,
    timestamp: serverTimestamp(),
  };

  await setDoc(newReportRef, reportData);
  return newReportRef.id;
}
