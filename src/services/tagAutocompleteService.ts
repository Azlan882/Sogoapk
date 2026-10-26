import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getCachedFeedPosts } from './postsService';

export interface TagSuggestion {
  tag: string;
  usageCount: number;
  isFromSogo: boolean;
}

interface TagStats {
  tag: string;
  count: number;
  latestTimestampMs: number;
  isFromSogo: boolean;
}

const MIN_TAG_QUERY_LENGTH = 2;
const DEFAULT_TAG_LIMIT = 6;
const TAG_INDEX_TTL_MS = 2 * 60 * 1000; // 2 minutes TTL

let cachedTagStatsMap: Map<string, TagStats> | null = null;
let lastTagIndexFetchMs = 0;
let inFlightTagIndexPromise: Promise<Map<string, TagStats>> | null = null;

// Popular fallback tags so common queries (e.g. "trav", "foo", "cri") always have rich suggestions
// alongside live tags aggregated from SogoSocial posts & reels in Firestore
const CURATED_POPULAR_TAGS: string[] = [
  'travel',
  'travelphotography',
  'travelgram',
  'travelblogger',
  'traveldiaries',
  'traveller',
  'food',
  'foodie',
  'foodphotography',
  'foodlover',
  'foodblogger',
  'foodstagram',
  'streetfood',
  'cricket',
  'cricketlovers',
  'cricketlife',
  'cricketfever',
  'photography',
  'photooftheday',
  'streetphotography',
  'filmphotography',
  'nature',
  'naturephotography',
  'naturelovers',
  'landscape',
  'mountains',
  'sunset',
  'fitness',
  'fitnessmotivation',
  'workout',
  'training',
  'gym',
  'lifestyle',
  'dailyvlog',
  'morningroutine',
  'minimalism',
  'fashion',
  'fashionstyle',
  'streetwear',
  'ootd',
  'style',
  'technology',
  'tech',
  'coding',
  'developer',
  'programming',
  'workspace',
  'setup',
  'art',
  'digitalart',
  'design',
  'graphicdesign',
  'illustration',
  'creative',
  'architecture',
  'interiordesign',
  'urban',
  'citylife',
  'music',
  'musician',
  'acoustic',
  'lofi',
  'gaming',
  'gamer',
  'esports',
  'cars',
  'supercars',
  'motorsport',
  'drifting',
  'coffee',
  'coffeelover',
  'cafe',
  'espresso',
  'pets',
  'cats',
  'dogs',
  'wildlife',
  'comedy',
  'funny',
  'entertainment',
  'satisfying',
  'diy',
  'crafts',
  'ceramics',
  'cooking',
  'homemade',
  'sports',
  'football',
  'basketball',
  'education',
  'science',
  'books',
  'reading',
  'business',
  'entrepreneur',
  'startup',
  'reels',
  'sogosocial',
  'trending',
  'explore',
  'viral',
  'cinematic',
];

const CURATED_TAG_RANK = new Map<string, number>(
  CURATED_POPULAR_TAGS.map((tag, index) => [tag, index])
);

/**
 * Normalizes a single tag string:
 * - Removes any accidental leading or duplicate '#' characters
 * - Trims whitespace and trailing commas
 * - Normalizes to lowercase (matching SogoSocial's existing tag convention)
 */
export function normalizeTag(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/#+/g, '')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Parses a raw comma/space-separated tags string into a deduplicated list of normalized tags.
 * Preserves insertion order and prevents duplicate tags in the same post.
 */
export function parseNormalizedTags(input: string): string[] {
  if (!input || !input.trim()) return [];
  const rawParts = input.split(/[\s,]+/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of rawParts) {
    const normalized = normalizeTag(part);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Extracts the active partial tag being typed at the end of the Tags input,
 * along with the already-completed tags in the input.
 */
export function getActiveTagContext(input: string): {
  activeQuery: string;
  completedTags: string[];
  hasTrailingSeparator: boolean;
} {
  if (!input) {
    return { activeQuery: '', completedTags: [], hasTrailingSeparator: false };
  }

  // If the input ends with a comma or whitespace, the user finished a tag and hasn't typed the next one yet
  const hasTrailingSeparator = /[\s,]$/.test(input);
  if (hasTrailingSeparator) {
    return {
      activeQuery: '',
      completedTags: parseNormalizedTags(input),
      hasTrailingSeparator: true,
    };
  }

  // Split by last separator (comma or whitespace)
  const lastSepMatch = input.match(/^(.*[\s,])([^\s,]+)$/);
  if (!lastSepMatch) {
    const activeQuery = normalizeTag(input);
    return {
      activeQuery,
      completedTags: [],
      hasTrailingSeparator: false,
    };
  }

  const beforePart = lastSepMatch[1];
  const lastToken = lastSepMatch[2];
  return {
    activeQuery: normalizeTag(lastToken),
    completedTags: parseNormalizedTags(beforePart),
    hasTrailingSeparator: false,
  };
}

/**
 * Replaces the active partial token in the Tags input with the selected autocomplete tag,
 * deduplicating all tags and appending ", " so the user can immediately type another tag.
 */
export function applySelectedTagToInput(
  currentInput: string,
  selectedTag: string
): string {
  const cleanSelected = normalizeTag(selectedTag);
  if (!cleanSelected) return currentInput;

  const { completedTags } = getActiveTagContext(currentInput);
  const seen = new Set<string>();
  const finalTags: string[] = [];

  for (const t of completedTags) {
    if (t && !seen.has(t)) {
      seen.add(t);
      finalTags.push(t);
    }
  }
  if (!seen.has(cleanSelected)) {
    seen.add(cleanSelected);
    finalTags.push(cleanSelected);
  }

  return `${finalTags.join(', ')}, `;
}

function addTagObservation(
  map: Map<string, TagStats>,
  rawTag: string,
  createdAtIso?: string,
  isFromSogo = true
) {
  const norm = normalizeTag(rawTag);
  if (!norm || norm.length < 2) return;

  const tsMs = createdAtIso ? new Date(createdAtIso).getTime() || 0 : 0;
  const existing = map.get(norm);
  if (existing) {
    if (isFromSogo) {
      existing.count += 1;
      existing.isFromSogo = true;
      if (tsMs > existing.latestTimestampMs) {
        existing.latestTimestampMs = tsMs;
      }
    }
  } else {
    map.set(norm, {
      tag: norm,
      count: isFromSogo ? 1 : 0,
      latestTimestampMs: tsMs,
      isFromSogo,
    });
  }
}

function ingestDocumentTagsAndHashtags(
  map: Map<string, TagStats>,
  tags?: unknown,
  caption?: unknown,
  createdAt?: unknown
) {
  const createdIso = typeof createdAt === 'string' ? createdAt : undefined;
  const perDocSeen = new Set<string>();

  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (typeof t === 'string') {
        const norm = normalizeTag(t);
        if (norm && !perDocSeen.has(norm)) {
          perDocSeen.add(norm);
          addTagObservation(map, norm, createdIso, true);
        }
      }
    }
  }

  if (typeof caption === 'string' && caption.includes('#')) {
    const matches = caption.match(/#([a-zA-Z0-9_]+)/g);
    if (matches) {
      for (const m of matches) {
        const norm = normalizeTag(m);
        if (norm && !perDocSeen.has(norm)) {
          perDocSeen.add(norm);
          addTagObservation(map, norm, createdIso, true);
        }
      }
    }
  }
}

async function getOrBuildTagIndex(): Promise<Map<string, TagStats>> {
  const now = Date.now();
  if (cachedTagStatsMap && now - lastTagIndexFetchMs < TAG_INDEX_TTL_MS) {
    return cachedTagStatsMap;
  }

  if (inFlightTagIndexPromise) {
    return inFlightTagIndexPromise;
  }

  inFlightTagIndexPromise = (async () => {
    const statsMap = new Map<string, TagStats>();

    // 1. Seed with any locally cached feed posts first (0ms)
    try {
      const localPosts = getCachedFeedPosts();
      for (const p of localPosts) {
        if (p.isRepost) continue;
        ingestDocumentTagsAndHashtags(statsMap, p.tags, p.caption, p.createdAt);
      }
    } catch {}

    // 2. Query Firestore posts and videos collections to aggregate real SogoSocial tags
    try {
      const postsRef = collection(db, 'posts');
      const videosRef = collection(db, 'videos');

      const [postsSnap, videosSnap] = await Promise.allSettled([
        getDocs(query(postsRef, orderBy('createdAt', 'desc'), limit(80))).catch(() =>
          getDocs(query(postsRef, limit(80)))
        ),
        getDocs(query(videosRef, orderBy('createdAt', 'desc'), limit(80))).catch(() =>
          getDocs(query(videosRef, limit(80)))
        ),
      ]);

      // Reset map before counting Firestore docs so local cached posts aren't double-counted
      if (
        (postsSnap.status === 'fulfilled' && !postsSnap.value.empty) ||
        (videosSnap.status === 'fulfilled' && !videosSnap.value.empty)
      ) {
        statsMap.clear();
      }

      if (postsSnap.status === 'fulfilled') {
        for (const d of postsSnap.value.docs) {
          const data = d.data();
          if (data.isRepost) continue;
          ingestDocumentTagsAndHashtags(
            statsMap,
            data.tags,
            data.caption,
            data.createdAt
          );
        }
      }

      if (videosSnap.status === 'fulfilled') {
        for (const d of videosSnap.value.docs) {
          const data = d.data();
          ingestDocumentTagsAndHashtags(
            statsMap,
            data.tags,
            data.caption,
            data.createdAt
          );
        }
      }
    } catch {
      // Gracefully fall back to local cache + curated tags if Firestore read fails
    }

    // 3. Ensure curated popular hashtags are also available in the index
    for (const curated of CURATED_POPULAR_TAGS) {
      addTagObservation(statsMap, curated, undefined, false);
    }

    cachedTagStatsMap = statsMap;
    lastTagIndexFetchMs = Date.now();
    return statsMap;
  })();

  try {
    return await inFlightTagIndexPromise;
  } finally {
    inFlightTagIndexPromise = null;
  }
}

/**
 * Immediately records newly published tags into the in-memory tag index
 * so custom tags created by the user appear in subsequent autocomplete searches.
 */
export function recordUsedTagsInCache(tags: string[]): void {
  if (!tags || tags.length === 0 || !cachedTagStatsMap) return;
  const nowIso = new Date().toISOString();
  for (const t of tags) {
    addTagObservation(cachedTagStatsMap, t, nowIso, true);
  }
}

/**
 * Searches SogoSocial tags matching the user's partial tag query.
 * Prioritizes:
 * 1. Exact/prefix matches over substring matches
 * 2. Tags actually used in SogoSocial (weighted by usage count + recency)
 */
export async function searchTags(
  rawQuery: string,
  options?: {
    excludeTags?: string[];
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<TagSuggestion[]> {
  const q = normalizeTag(rawQuery);
  const maxResults = options?.limit ?? DEFAULT_TAG_LIMIT;

  if (q.length < MIN_TAG_QUERY_LENGTH) {
    return [];
  }

  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const excluded = new Set(
    (options?.excludeTags || []).map((t) => normalizeTag(t)).filter(Boolean)
  );

  const statsMap = await getOrBuildTagIndex();

  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const scored: { item: TagSuggestion; score: number }[] = [];

  for (const stats of statsMap.values()) {
    if (excluded.has(stats.tag)) continue;

    const isExact = stats.tag === q;
    const isPrefix = stats.tag.startsWith(q);
    const isSubstring = !isPrefix && stats.tag.includes(q);

    if (!isPrefix && !isSubstring) continue;

    let score = 0;
    if (isExact) score += 600;
    else if (isPrefix) score += 400;
    else score += 120;

    // Prioritize tags actually used in SogoSocial posts & reels
    if (stats.isFromSogo && stats.count > 0) {
      score += 150 + Math.min(250, stats.count * 25);
    }

    // Slight boost for more recently used tags
    if (stats.latestTimestampMs > 0) {
      score += 25;
    }

    const curatedRank = CURATED_TAG_RANK.get(stats.tag);
    if (curatedRank !== undefined) {
      score += Math.max(1, 100 - curatedRank);
    }

    scored.push({
      item: {
        tag: stats.tag,
        usageCount: stats.count,
        isFromSogo: stats.isFromSogo,
      },
      score,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.tag.localeCompare(b.item.tag);
  });

  return scored.slice(0, maxResults).map((s) => s.item);
}
