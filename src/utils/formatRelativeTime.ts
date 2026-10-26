import { useState, useEffect } from 'react';

export type TimestampInput =
  | string
  | number
  | Date
  | { toDate?: () => Date; toMillis?: () => number; seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number }
  | null
  | undefined;

/**
 * Safely parses a Firestore Timestamp, serialized Timestamp object, JavaScript Date,
 * millisecond number, or ISO date string into epoch milliseconds.
 * Returns null if the input is null, undefined, or invalid.
 */
export function parseTimestampToMs(timestamp: TimestampInput): number | null {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return null;
  }

  if (timestamp instanceof Date) {
    const ms = timestamp.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof timestamp === 'number') {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    // Support both Unix milliseconds (>= 1e11) and Unix seconds (< 1e11)
    return timestamp < 1e11 ? Math.floor(timestamp * 1000) : timestamp;
  }

  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 1e11 ? Math.floor(numeric * 1000) : numeric;
      }
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof timestamp === 'object') {
    const obj = timestamp as Record<string, unknown>;

    if (typeof obj.toMillis === 'function') {
      try {
        const ms = (obj.toMillis as () => number)();
        if (typeof ms === 'number' && Number.isFinite(ms)) {
          return ms;
        }
      } catch {
        // Fall through to other checks
      }
    }

    if (typeof obj.toDate === 'function') {
      try {
        const date = (obj.toDate as () => Date)();
        if (date instanceof Date && Number.isFinite(date.getTime())) {
          return date.getTime();
        }
      } catch {
        // Fall through to other checks
      }
    }

    const rawSeconds = obj.seconds ?? obj._seconds;
    if (rawSeconds !== undefined && rawSeconds !== null) {
      const sec = Number(rawSeconds);
      const nano = Number(obj.nanoseconds ?? obj._nanoseconds ?? 0);
      if (Number.isFinite(sec) && sec > 0) {
        const extraMs = Number.isFinite(nano) ? Math.floor(nano / 1e6) : 0;
        return Math.floor(sec * 1000) + extraMs;
      }
    }
  }

  return null;
}

/**
 * Formats a creation timestamp into a compact relative time string:
 * - < 60 seconds -> "Just now"
 * - < 60 minutes -> "Xm"
 * - < 24 hours   -> "Xh"
 * - < 7 days     -> "Xd"
 * - < 4 weeks    -> "Xw"
 * - < 12 months  -> "Xmo"
 * - >= 12 months -> "Xy"
 *
 * Returns an empty string "" if the timestamp is missing or invalid.
 */
export function formatRelativeTime(timestamp: TimestampInput, nowMs: number = Date.now()): string {
  const targetMs = parseTimestampToMs(timestamp);
  if (targetMs === null) {
    return '';
  }

  const diffInSeconds = Math.floor((nowMs - targetMs) / 1000);

  // Handle recent uploads and slight client/server clock skew gracefully
  if (diffInSeconds < 60) {
    return 'Just now';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays}d`;
  }

  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) {
    return `${diffInWeeks}w`;
  }

  const diffInMonths = Math.max(1, Math.floor(diffInDays / 30));
  if (diffInDays < 365 && diffInMonths < 12) {
    return `${diffInMonths}mo`;
  }

  const diffInYears = Math.max(1, Math.floor(diffInDays / 365));
  return `${diffInYears}y`;
}

/**
 * Lightweight hook that returns a live-updating relative time string
 * on a local interval (default every 45 seconds) without triggering any Firestore reads.
 * Cleans up the interval automatically on unmount.
 */
export function useRelativeTime(timestamp: TimestampInput, refreshIntervalMs = 45_000): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (parseTimestampToMs(timestamp) === null) return;

    const timerId = setInterval(() => {
      setTick((t) => t + 1);
    }, refreshIntervalMs);

    return () => {
      clearInterval(timerId);
    };
  }, [timestamp, refreshIntervalMs]);

  return formatRelativeTime(timestamp);
}
