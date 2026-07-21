// Bundle lookup, fee calculation, minimum order rule (docs/PRD.md §6). All amounts in
// kobo (see src/lib/money.ts for the number-vs-BigInt note).
import { BUNDLES, type BundleDefinition, type BundleId } from './bundles.config';

export const LOGISTICS_FEE_KOBO = 100_000; // ₦1,000 round-trip pickup + delivery (PRD.md §6.3)

// PRD.md §6.3: "Orders above ₦5,000 service total" — strictly greater than, matching
// the word "above". ₦5,000 authoritative per the doc's own flag (an earlier draft
// section had ₦10,000; ₦5,000 is confirmed correct there).
export const FREE_LOGISTICS_THRESHOLD_KOBO = 500_000;

export interface Quote {
  bundle: BundleDefinition;
  serviceTotalKobo: number;
  smallBasketFeeKobo: number;
  logisticsFeeKobo: number;
  grandTotalKobo: number;
}

export function getBundle(bundleId: BundleId): BundleDefinition {
  return BUNDLES[bundleId];
}

export function calculateLogisticsFee(serviceTotalKobo: number): number {
  return serviceTotalKobo > FREE_LOGISTICS_THRESHOLD_KOBO ? 0 : LOGISTICS_FEE_KOBO;
}

// PRD.md §6.3/§6.4: the small-basket surcharge (₦500 under ₦1,500 service total) is
// explicitly "Phase 2 only, inactive at MVP launch" — bundle-only orders never trigger
// it anyway (the cheapest bundle is ₦2,000), but the function exists so the quote
// message's conditional line has one clear source of truth to ask, not a hardcoded 0
// scattered around.
export function calculateSmallBasketFee(_serviceTotalKobo: number): number {
  return 0;
}

export function computeQuote(bundleId: BundleId): Quote {
  const bundle = getBundle(bundleId);
  const serviceTotalKobo = bundle.priceKobo;
  const smallBasketFeeKobo = calculateSmallBasketFee(serviceTotalKobo);
  const logisticsFeeKobo = calculateLogisticsFee(serviceTotalKobo);
  const grandTotalKobo = serviceTotalKobo + smallBasketFeeKobo + logisticsFeeKobo;

  return { bundle, serviceTotalKobo, smallBasketFeeKobo, logisticsFeeKobo, grandTotalKobo };
}
