/**
 * High-precision performance timing and diagnostic logger for SogoSocial.
 * Tracks screen initialization, Firestore query times, and render metrics.
 */

type PerfCategory = 'STARTUP' | 'HOME' | 'REELS' | 'FIRESTORE' | 'CACHE' | 'REPOST' | 'UPLOAD';

interface PerfEntry {
  category: PerfCategory;
  name: string;
  startTime: number;
  duration?: number;
  details?: Record<string, any>;
}

const APP_START_TIME = typeof performance !== 'undefined' ? performance.now() : 0;

class PerformanceTracker {
  private activeTimers: Map<string, PerfEntry> = new Map();
  private history: PerfEntry[] = [];
  private startupMilestones: Array<{ stage: string; elapsedMs: number; details?: Record<string, any> }> = [];

  milestone(stage: string, details?: Record<string, any>): number {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const elapsedMs = Math.max(0, Math.round(now - APP_START_TIME));
    this.startupMilestones.push({ stage, elapsedMs, details });
    const detailStr = details ? ` | ${JSON.stringify(details)}` : '';
    console.info(`🚀 [Startup +${elapsedMs}ms] ${stage}${detailStr}`);
    return elapsedMs;
  }

  getStartupMilestones() {
    return [...this.startupMilestones];
  }

  start(category: PerfCategory, name: string, details?: Record<string, any>): void {
    const key = `${category}:${name}`;
    const startTime = performance.now();
    this.activeTimers.set(key, { category, name, startTime, details });
    console.debug(`⏱️ [Perf - Start] [${category}] ${name}`);
  }

  end(category: PerfCategory, name: string, additionalDetails?: Record<string, any>): number {
    const key = `${category}:${name}`;
    const entry = this.activeTimers.get(key);
    const endTime = performance.now();

    if (!entry) {
      console.debug(`⏱️ [Perf] Unknown timer ended: ${key}`);
      return 0;
    }

    this.activeTimers.delete(key);
    const duration = Math.round(endTime - entry.startTime);
    const completedEntry: PerfEntry = {
      ...entry,
      duration,
      details: { ...entry.details, ...additionalDetails },
    };
    this.history.push(completedEntry);

    const detailStr = completedEntry.details ? ` | ${JSON.stringify(completedEntry.details)}` : '';
    console.info(`⚡ [Perf - ${category}] ${name}: ${duration}ms${detailStr}`);
    return duration;
  }

  mark(category: PerfCategory, name: string, details?: Record<string, any>): void {
    console.info(`🎯 [Perf - Mark] [${category}] ${name}`, details || '');
  }

  videoEvent(
    category: 'REELS' | 'HOME',
    event:
      | 'loadstart'
      | 'loadedmetadata'
      | 'loadeddata'
      | 'canplay'
      | 'playing'
      | 'waiting'
      | 'stalled'
      | 'error',
    details: {
      videoId: string;
      url: string;
      preload: string;
      readyState: number;
      networkState: number;
      preloadedBeforeVisible?: boolean;
      elapsedMs?: number;
      [key: string]: any;
    }
  ): void {
    if (typeof import.meta !== 'undefined' && import.meta.env && !import.meta.env.DEV) {
      return;
    }
    console.info(`🎬 [VideoPerf - ${category}] ${event}`, details);
  }

  summary(category?: PerfCategory): void {
    const filtered = category ? this.history.filter((h) => h.category === category) : this.history;
    console.group(`📊 [Perf Summary${category ? ` - ${category}` : ''}]`);
    console.table(
      filtered.map((item) => ({
        Category: item.category,
        Operation: item.name,
        'Duration (ms)': item.duration,
        Details: JSON.stringify(item.details || {}),
      }))
    );
    console.groupEnd();
  }
}

export const perf = new PerformanceTracker();
