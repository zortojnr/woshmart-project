import { describe, expect, it } from 'vitest';
import { parseKeywordCommand } from '../../src/messaging/keyword.parser';

describe('parseKeywordCommand — valid keywords', () => {
  it('COLLECTED <order>', () => {
    expect(parseKeywordCommand('COLLECTED WM-001')).toEqual({ type: 'COLLECTED', orderNumber: 'WM-001' });
  });

  it('LAUNDRY <order>', () => {
    expect(parseKeywordCommand('LAUNDRY WM-002')).toEqual({ type: 'LAUNDRY', orderNumber: 'WM-002' });
  });

  it('READY <order>', () => {
    expect(parseKeywordCommand('READY WM-003')).toEqual({ type: 'READY', orderNumber: 'WM-003' });
  });

  it('DELIVERING <order>', () => {
    expect(parseKeywordCommand('DELIVERING WM-004')).toEqual({ type: 'DELIVERING', orderNumber: 'WM-004' });
  });

  it('DELIVERED <order> <n>pcs', () => {
    expect(parseKeywordCommand('DELIVERED WM-005 10pcs')).toEqual({
      type: 'DELIVERED',
      orderNumber: 'WM-005',
      count: 10,
    });
  });

  it('ISSUE <order> <note>, note can contain spaces', () => {
    expect(parseKeywordCommand('ISSUE WM-006 customer not answering door')).toEqual({
      type: 'ISSUE',
      orderNumber: 'WM-006',
      note: 'customer not answering door',
    });
  });

  it('is case-insensitive on the keyword and normalizes the order number to uppercase', () => {
    expect(parseKeywordCommand('collected wm-007')).toEqual({ type: 'COLLECTED', orderNumber: 'WM-007' });
  });

  it('tolerates a space before "pcs"', () => {
    expect(parseKeywordCommand('DELIVERED WM-008 3 pcs')).toEqual({
      type: 'DELIVERED',
      orderNumber: 'WM-008',
      count: 3,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseKeywordCommand('  COLLECTED WM-009  ')).toEqual({ type: 'COLLECTED', orderNumber: 'WM-009' });
  });
});

describe('parseKeywordCommand — malformed input', () => {
  it('unknown keyword returns null', () => {
    expect(parseKeywordCommand('WASHED WM-001')).toBeNull();
  });

  it('missing order number returns null', () => {
    expect(parseKeywordCommand('COLLECTED')).toBeNull();
  });

  it('DELIVERED without a count returns null', () => {
    expect(parseKeywordCommand('DELIVERED WM-001')).toBeNull();
  });

  it('DELIVERED with a non-numeric count returns null', () => {
    expect(parseKeywordCommand('DELIVERED WM-001 tenpcs')).toBeNull();
  });

  it('ISSUE without a note returns null', () => {
    expect(parseKeywordCommand('ISSUE WM-001')).toBeNull();
  });

  it('plain conversational text returns null', () => {
    expect(parseKeywordCommand('hey is my order ready?')).toBeNull();
  });

  it('empty string returns null', () => {
    expect(parseKeywordCommand('')).toBeNull();
  });
});
