import { describe, expect, it } from 'vitest';
import {
  calculateLogisticsFee,
  calculateSmallBasketFee,
  computeQuote,
  FREE_LOGISTICS_THRESHOLD_KOBO,
  LOGISTICS_FEE_KOBO,
} from '../../../src/domain/pricing/pricing.service';

describe('pricing.service — each bundle', () => {
  it.each([
    ['starter', 200_000, 100_000, 300_000],
    ['weekly', 380_000, 100_000, 480_000],
    ['family', 550_000, 0, 550_000],
    ['household', 300_000, 100_000, 400_000],
  ] as const)('%s bundle: service ₦%i kobo, logistics ₦%i kobo, grand total ₦%i kobo', (bundleId, serviceTotalKobo, expectedLogisticsKobo, expectedGrandTotalKobo) => {
    const quote = computeQuote(bundleId);

    expect(quote.serviceTotalKobo).toBe(serviceTotalKobo);
    expect(quote.smallBasketFeeKobo).toBe(0);
    expect(quote.logisticsFeeKobo).toBe(expectedLogisticsKobo);
    expect(quote.grandTotalKobo).toBe(expectedGrandTotalKobo);
  });

  it('Family bundle (₦5,500) qualifies for free logistics — the only bundle above the ₦5,000 threshold', () => {
    const quote = computeQuote('family');
    expect(quote.logisticsFeeKobo).toBe(0);
    expect(quote.grandTotalKobo).toBe(quote.serviceTotalKobo);
  });
});

describe('pricing.service — free-logistics threshold boundary (PRD.md §6.3: "above ₦5,000")', () => {
  it('exactly at the threshold (₦5,000) is NOT "above" it — logistics fee still applies', () => {
    expect(calculateLogisticsFee(FREE_LOGISTICS_THRESHOLD_KOBO)).toBe(LOGISTICS_FEE_KOBO);
  });

  it('one kobo below the threshold — logistics fee applies', () => {
    expect(calculateLogisticsFee(FREE_LOGISTICS_THRESHOLD_KOBO - 1)).toBe(LOGISTICS_FEE_KOBO);
  });

  it('one kobo above the threshold — logistics is free', () => {
    expect(calculateLogisticsFee(FREE_LOGISTICS_THRESHOLD_KOBO + 1)).toBe(0);
  });
});

describe('pricing.service — small-basket surcharge (PRD.md §6.3/§6.4: Phase 2 product feature, inactive at MVP)', () => {
  it('never applies at MVP, even for a hypothetical service total under the ₦1,500 surcharge line', () => {
    expect(calculateSmallBasketFee(100_000)).toBe(0);
  });

  it('never applies right at the surcharge boundary either', () => {
    expect(calculateSmallBasketFee(150_000)).toBe(0);
    expect(calculateSmallBasketFee(149_999)).toBe(0);
  });

  it('is always 0 for every real bundle, since bundle-only orders can never be below the boundary anyway', () => {
    for (const bundleId of ['starter', 'weekly', 'family', 'household'] as const) {
      expect(computeQuote(bundleId).smallBasketFeeKobo).toBe(0);
    }
  });
});
