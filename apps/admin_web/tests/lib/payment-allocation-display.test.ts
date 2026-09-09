import { describe, expect, it } from 'vitest';

import { actionBadgeClassName } from '@/components/admin/audit/audit-log-badges';
import {
  getPaymentAllocationStatus,
  getPaymentAllocationStatusLabel,
  paymentAllocationBadgeClassName,
  shouldOpenAllocateDisclosure,
  shouldOpenAllocatedInvoicesDisclosure,
} from '@/lib/payment-allocation-display';

describe('getPaymentAllocationStatus', () => {
  it('returns none when nothing is allocated', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        status: 'succeeded',
        amount: '100',
        unappliedAmount: '100',
      }),
    ).toBe('none');
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        status: 'pending',
        amount: '0',
        unappliedAmount: '0.0000',
      }),
    ).toBe('none');
  });

  it('returns less when some of the payment is still unapplied', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '100.0000',
        unappliedAmount: '40',
      }),
    ).toBe('less');
  });

  it('returns in_full when unapplied is zero and some amount was allocated', () => {
    expect(
      getPaymentAllocationStatus({
        direction: 'inbound',
        amount: '100',
        unappliedAmount: '0',
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

  it('returns null for refunds, failed payments, and unparseable amounts', () => {
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
        status: 'failed',
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
    expect(getPaymentAllocationStatusLabel('none')).toBe('None');
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
    expect(paymentAllocationBadgeClassName('none', 'succeeded')).toBe(actionBadgeClassName('DELETE'));
  });

  it('uses yellow for less and pending none', () => {
    expect(paymentAllocationBadgeClassName('less')).toContain('bg-yellow-100');
    expect(paymentAllocationBadgeClassName('none', 'pending')).toContain('bg-yellow-100');
    expect(paymentAllocationBadgeClassName('none', 'pending')).toContain('text-yellow-800');
  });
});

describe('allocation disclosure defaults', () => {
  it('opens allocated invoices for in full and more', () => {
    expect(shouldOpenAllocatedInvoicesDisclosure('in_full')).toBe(true);
    expect(shouldOpenAllocatedInvoicesDisclosure('more')).toBe(true);
    expect(shouldOpenAllocatedInvoicesDisclosure('none')).toBe(false);
    expect(shouldOpenAllocatedInvoicesDisclosure('less')).toBe(false);
  });

  it('opens allocate for none and less', () => {
    expect(shouldOpenAllocateDisclosure('none')).toBe(true);
    expect(shouldOpenAllocateDisclosure('less')).toBe(true);
    expect(shouldOpenAllocateDisclosure('in_full')).toBe(false);
    expect(shouldOpenAllocateDisclosure('more')).toBe(false);
  });
});
