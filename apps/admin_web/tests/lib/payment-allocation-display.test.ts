import { describe, expect, it } from 'vitest';

import { actionBadgeClassName } from '@/components/admin/audit/audit-log-badges';
import {
  getPaymentAllocationStatus,
  getPaymentAllocationStatusLabel,
  paymentAllocationBadgeClassName,
} from '@/lib/payment-allocation-display';

describe('getPaymentAllocationStatus', () => {
  it('returns less when some or all of the payment is unapplied', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '100',
        unappliedAmount: '100',
      }),
    ).toBe('less');
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '100.0000',
        unappliedAmount: '40',
      }),
    ).toBe('less');
  });

  it('returns in_full when unapplied is zero', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '100',
        unappliedAmount: '0',
      }),
    ).toBe('in_full');
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '0',
        unappliedAmount: '0.0000',
      }),
    ).toBe('in_full');
  });

  it('returns more when unapplied is negative', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '100',
        unappliedAmount: '-10',
      }),
    ).toBe('more');
  });

  it('returns null for refunds and unparseable amounts', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'refund',
        amount: '10',
        unappliedAmount: '10',
      }),
    ).toBeNull();
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '10',
        unappliedAmount: '',
      }),
    ).toBeNull();
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: 'NaN',
        unappliedAmount: '0',
      }),
    ).toBeNull();
  });
});

describe('getPaymentAllocationStatusLabel', () => {
  it('maps statuses to table copy', () => {
    expect(getPaymentAllocationStatusLabel('less')).toBe('Less');
    expect(getPaymentAllocationStatusLabel('in_full')).toBe('In full');
    expect(getPaymentAllocationStatusLabel('more')).toBe('More');
    expect(getPaymentAllocationStatusLabel(null)).toBe('—');
  });
});

describe('paymentAllocationBadgeClassName', () => {
  it('matches audit INSERT green and DELETE red', () => {
    expect(paymentAllocationBadgeClassName('in_full')).toBe(actionBadgeClassName('INSERT'));
    expect(paymentAllocationBadgeClassName('more')).toBe(actionBadgeClassName('DELETE'));
  });

  it('uses yellow for less', () => {
    expect(paymentAllocationBadgeClassName('less')).toContain('bg-yellow-100');
    expect(paymentAllocationBadgeClassName('less')).toContain('text-yellow-800');
  });
});
