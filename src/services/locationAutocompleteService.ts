import { PostLocationData } from '../types';

export interface LocationSuggestion extends PostLocationData {
  name: string;
  placeId: string;
  latitude: number;
  longitude: number;
  country: string;
  subtitle?: string;
}

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 6;
const CACHE_MAX_ENTRIES = 60;

// In-memory LRU-style cache for fast repeat/backspace queries
const suggestionCache = new Map<string, LocationSuggestion[]>();

function formatCountryDisplay(country?: string, countryCode?: string): string {
  const code = (countryCode || '').trim().toUpperCase();
  const raw = (country || '').trim();
  if (
    code === 'US' ||
    raw === 'United States' ||
    raw === 'United States of America'
  ) {
    return 'USA';
  }
  if (code === 'GB' || raw === 'United Kingdom') {
    return 'UK';
  }
  if (code === 'AE' || raw === 'United Arab Emirates') {
    return 'UAE';
  }
  return raw;
}

interface ScoredLocationCandidate extends LocationSuggestion {
  primaryName: string;
  population: number;
  score: number;
}

/**
 * Searches real-world locations for autocomplete as the user types.
 * Uses OpenStreetMap Photon autocomplete API + Open-Meteo GeoNames Geocoding API in parallel
 * (no secret client API keys required; optional custom proxy override via VITE_GEOCODING_API_URL).
 */
export async function searchLocations(
  rawQuery: string,
  options?: { signal?: AbortSignal; limit?: number }
): Promise<LocationSuggestion[]> {
  const query = rawQuery.trim();
  const limit = options?.limit ?? DEFAULT_LIMIT;

  if (query.length < MIN_QUERY_LENGTH) {
    return [];
  }

  const cacheKey = `${query.toLowerCase()}::${limit}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const signal = options?.signal;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const customProxyUrl = (import.meta.env?.VITE_GEOCODING_API_URL || '').trim();
  if (customProxyUrl) {
    const res = await fetch(
      `${customProxyUrl}?q=${encodeURIComponent(query)}&limit=${limit}`,
      { signal }
    );
    if (!res.ok) {
      throw new Error(`Location search failed (${res.status})`);
    }
    const data = await res.json();
    const list: LocationSuggestion[] = Array.isArray(data?.suggestions || data)
      ? (data.suggestions || data).slice(0, limit)
      : [];
    suggestionCache.set(cacheKey, list);
    return list;
  }

  const qLower = query.toLowerCase();
  // For Open-Meteo, if user typed "City, Country", search the city part before the comma
  const primaryQueryPart = query.split(',')[0].trim() || query;

  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
    query
  )}&limit=15&lang=en&osm_tag=place:city&osm_tag=place:town&osm_tag=place:state&osm_tag=place:province&osm_tag=place:country&osm_tag=place:county`;

  const openMeteoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    primaryQueryPart
  )}&count=25&language=en&format=json`;

  const [photonSettled, openMeteoSettled] = await Promise.allSettled([
    fetch(photonUrl, { signal }).then((res) => {
      if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
      return res.json();
    }),
    fetch(openMeteoUrl, { signal }).then((res) => {
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      return res.json();
    }),
  ]);

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // If both providers failed due to network error, throw so caller can handle gracefully
  if (
    photonSettled.status === 'rejected' &&
    openMeteoSettled.status === 'rejected'
  ) {
    throw new Error('Unable to reach location service');
  }

  const byKey = new Map<string, ScoredLocationCandidate>();

  const upsertCandidate = (cand: ScoredLocationCandidate) => {
    const key = `${cand.primaryName.toLowerCase()}|${cand.country.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, cand);
    } else {
      if (cand.score > existing.score) {
        existing.score = cand.score;
      }
      if (cand.population > existing.population) {
        existing.population = cand.population;
      }
      if (!existing.subtitle && cand.subtitle) {
        existing.subtitle = cand.subtitle;
      }
    }
  };

  // 1. Parse Open-Meteo GeoNames results (includes population & admin hierarchy)
  if (
    openMeteoSettled.status === 'fulfilled' &&
    Array.isArray(openMeteoSettled.value?.results)
  ) {
    for (const r of openMeteoSettled.value.results) {
      const fcode: string = r.feature_code || '';
      if (
        !fcode.startsWith('PPL') &&
        !fcode.startsWith('ADM') &&
        !fcode.startsWith('PCL')
      ) {
        continue;
      }

      const pop = Number(r.population) || 0;
      if (
        fcode.startsWith('PPL') &&
        fcode !== 'PPLC' &&
        fcode !== 'PPLA' &&
        fcode !== 'PPLA2' &&
        pop < 25000
      ) {
        continue;
      }

      const primary = (r.name || '').trim();
      const countryRaw = (r.country || '').trim();
      const countryDisp = formatCountryDisplay(countryRaw, r.country_code);
      if (!primary || !countryDisp) continue;

      const displayLabel = fcode.startsWith('PCL')
        ? primary
        : `${primary}, ${countryDisp}`;
      const matchesPrefix =
        primary.toLowerCase().startsWith(qLower) ||
        displayLabel.toLowerCase().startsWith(qLower);
      const matchesContains = displayLabel.toLowerCase().includes(qLower);
      if (!matchesPrefix && !matchesContains) continue;

      let score = 0;
      if (primary.toLowerCase() === qLower) score += 500;
      else if (primary.toLowerCase().startsWith(qLower)) score += 350;
      else if (displayLabel.toLowerCase().startsWith(qLower)) score += 250;
      else score += 80;

      if (fcode === 'PPLC') score += 260;
      else if (fcode === 'PPLA') score += 210;
      else if (fcode === 'PPLA2') score += 150;
      else if (fcode.startsWith('ADM1')) score += 220;
      else if (fcode.startsWith('ADM2')) score += 160;
      else if (fcode.startsWith('PCL')) score += 190;
      else score += 120;

      score += Math.min(300, Math.log10(Math.max(1, pop)) * 42);

      const admin1 = (r.admin1 || '').trim();
      upsertCandidate({
        name: displayLabel,
        primaryName: primary,
        subtitle:
          admin1 && admin1.toLowerCase() !== primary.toLowerCase()
            ? `${admin1}, ${countryRaw || countryDisp}`
            : countryRaw || countryDisp,
        placeId: `om_${r.id}`,
        latitude: Number(r.latitude) || 0,
        longitude: Number(r.longitude) || 0,
        country: countryRaw || countryDisp,
        population: pop,
        score,
      });

      const admin2 = (r.admin2 || '').trim();
      if (
        admin2 &&
        admin2.toLowerCase() !== primary.toLowerCase() &&
        admin2.toLowerCase().startsWith(qLower) &&
        pop >= 500000
      ) {
        upsertCandidate({
          name: `${admin2}, ${countryDisp}`,
          primaryName: admin2,
          subtitle: admin1
            ? `${admin1}, ${countryRaw || countryDisp}`
            : countryRaw || countryDisp,
          placeId: `om_adm2_${r.id}`,
          latitude: Number(r.latitude) || 0,
          longitude: Number(r.longitude) || 0,
          country: countryRaw || countryDisp,
          population: Math.round(pop * 0.5),
          score: score - 95,
        });
      }
    }
  }

  // 2. Parse Photon OpenStreetMap results (strong prefix matching for cities, states, districts)
  if (
    photonSettled.status === 'fulfilled' &&
    Array.isArray(photonSettled.value?.features)
  ) {
    for (const f of photonSettled.value.features) {
      const p = f.properties || {};
      const osmVal = p.osm_value || '';
      const coords = f.geometry?.coordinates || [0, 0];
      const primary = (p.name || '').trim();
      const countryRaw = (p.country || '').trim();
      const countryDisp = formatCountryDisplay(countryRaw, p.countrycode);
      if (!primary) continue;

      const isCountry = osmVal === 'country';
      const displayLabel = isCountry
        ? primary
        : countryDisp
        ? `${primary}, ${countryDisp}`
        : primary;
      const matchesPrefix =
        primary.toLowerCase().startsWith(qLower) ||
        displayLabel.toLowerCase().startsWith(qLower);
      const matchesContains = displayLabel.toLowerCase().includes(qLower);
      if (!matchesPrefix && !matchesContains) continue;

      let score = 0;
      if (primary.toLowerCase() === qLower) score += 460;
      else if (primary.toLowerCase().startsWith(qLower)) score += 350;
      else if (displayLabel.toLowerCase().startsWith(qLower)) score += 250;
      else score += 70;

      if (osmVal === 'city') score += 260;
      else if (osmVal === 'state' || osmVal === 'province') score += 420;
      else if (osmVal === 'country') score += 390;
      else if (osmVal === 'county' || osmVal === 'district') score += 180;
      else if (osmVal === 'town') score += 110;

      const state = (p.state || '').trim();
      upsertCandidate({
        name: displayLabel,
        primaryName: primary,
        subtitle:
          state && state.toLowerCase() !== primary.toLowerCase()
            ? `${state}, ${countryRaw || countryDisp}`
            : countryRaw || countryDisp,
        placeId: `osm_${p.osm_type || 'N'}_${p.osm_id || Math.abs(coords[0])}`,
        latitude: Number(coords[1]) || 0,
        longitude: Number(coords[0]) || 0,
        country: countryRaw || countryDisp || primary,
        population: 0,
        score,
      });

      const county = (p.county || '').trim();
      if (
        county &&
        county.toLowerCase() !== primary.toLowerCase() &&
        county.toLowerCase().startsWith(qLower)
      ) {
        upsertCandidate({
          name: countryDisp ? `${county}, ${countryDisp}` : county,
          primaryName: county,
          subtitle: state
            ? `${state}, ${countryRaw || countryDisp}`
            : countryRaw || countryDisp,
          placeId: `osm_county_${p.osm_id}`,
          latitude: Number(coords[1]) || 0,
          longitude: Number(coords[0]) || 0,
          country: countryRaw || countryDisp || primary,
          population: 0,
          score: score + 110,
        });
      }
    }
  }

  const results: LocationSuggestion[] = Array.from(byKey.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ name, placeId, latitude, longitude, country, subtitle }) => ({
      name,
      placeId,
      latitude,
      longitude,
      country,
      subtitle,
    }));

  if (suggestionCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = suggestionCache.keys().next().value;
    if (oldestKey) suggestionCache.delete(oldestKey);
  }
  suggestionCache.set(cacheKey, results);

  return results;
}
