// Bundle definitions (docs/PRD.md §6.1). Bundle-only for MVP — per-item pricing is
// explicitly PRD §6.2 "Phase 2 (product), inactive at MVP launch", out of scope here.

export type BundleId = 'starter' | 'weekly' | 'family' | 'household';

export interface BundleDefinition {
  id: BundleId;
  name: string;
  itemsLabel: string;
  priceKobo: number;
}

export const BUNDLES: Record<BundleId, BundleDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter Bundle',
    itemsLabel: '10 items',
    priceKobo: 200_000,
  },
  weekly: {
    id: 'weekly',
    name: 'Weekly Bundle',
    itemsLabel: '20 items',
    priceKobo: 380_000,
  },
  family: {
    id: 'family',
    name: 'Family Bundle',
    itemsLabel: '30 items',
    priceKobo: 550_000,
  },
  household: {
    id: 'household',
    name: 'Household Bundle',
    itemsLabel: '10 items + bedsheet + 2 pillowcases',
    priceKobo: 300_000,
  },
};

// Reply "1"/"2"/"3"/"4" maps to this order — matches the numbered list in the
// "Coverage confirmed" message copy (PRD.md §10) exactly.
export const BUNDLE_MENU_ORDER: BundleId[] = ['starter', 'weekly', 'family', 'household'];

export function getBundleByMenuReply(reply: string): BundleDefinition | null {
  const trimmed = reply.trim();
  if (!/^[1-4]$/.test(trimmed)) {
    return null;
  }
  const bundleId = BUNDLE_MENU_ORDER[Number.parseInt(trimmed, 10) - 1];
  return bundleId ? BUNDLES[bundleId] : null;
}
