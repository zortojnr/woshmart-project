// Coverage zone keyword-matching (docs/PRD.md §7). No geocoding/maps API in Phase 1
// — the customer's stated area is matched against a fixed keyword list.

export type CoverageStatus = 'full' | 'waitlist' | 'unavailable';

interface ZoneDefinition {
  status: CoverageStatus;
  canonicalName: string;
  keywords: string[];
}

const ZONES: ZoneDefinition[] = [
  { status: 'full', canonicalName: 'Maitumbi', keywords: ['maitumbi'] },
  { status: 'full', canonicalName: 'Bosso', keywords: ['bosso'] },
  { status: 'full', canonicalName: 'Tunga', keywords: ['new tunga', 'tunga'] },
  { status: 'full', canonicalName: 'Mobil area', keywords: ['mobil'] },
  { status: 'waitlist', canonicalName: 'Kpakungu', keywords: ['kpakungu'] },
  { status: 'unavailable', canonicalName: 'Chanchaga', keywords: ['chanchaga'] },
];

export interface ZoneMatch {
  status: CoverageStatus | 'unknown';
  canonicalName: string | null;
}

// Only 'full' counts as in-coverage; 'waitlist', 'unavailable', and unmatched input
// all fall through to the out-of-coverage/waitlist-offer response (PRD.md §11.1).
export function matchZone(rawInput: string): ZoneMatch {
  const normalized = rawInput.trim().toLowerCase();

  for (const zone of ZONES) {
    if (zone.keywords.some((keyword) => normalized.includes(keyword))) {
      return { status: zone.status, canonicalName: zone.canonicalName };
    }
  }

  return { status: 'unknown', canonicalName: null };
}
