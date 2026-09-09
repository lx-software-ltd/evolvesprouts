/** Display labels for customer payment allocation vs payment amount. */

export type PaymentAllocationStatus = 'less' | 'in_full' | 'more';

export type PaymentAllocationBadgeInput = {
  amount?: string | null;
  unappliedAmount?: string | null;
  direction?: string | null;
};

const AMOUNT_EPSILON = 1e-9;

function parseDecimal(raw: string | null | undefined): number | null {
  const t = (raw ?? '').trim();
  if (t === '') {
    return null;
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare allocated amount (`amount - unappliedAmount`) to the payment amount.
 * Refunds are not invoice allocations; callers should render an em dash.
 */
export function getPaymentAllocationStatus(
  payment: PaymentAllocationBadgeInput,
): PaymentAllocationStatus | null {
  const direction = (payment.direction ?? '').trim().toLowerCase();
  if (direction === 'refund') {
    return null;
  }
  const amount = parseDecimal(payment.amount);
  const unapplied = parseDecimal(payment.unappliedAmount);
  if (amount === null || unapplied === null) {
    return null;
  }
  if (unapplied < -AMOUNT_EPSILON) {
    return 'more';
  }
  if (unapplied > AMOUNT_EPSILON) {
    return 'less';
  }
  return 'in_full';
}

export function getPaymentAllocationStatusLabel(status: PaymentAllocationStatus | null): string {
  if (status === 'less') {
    return 'Less';
  }
  if (status === 'in_full') {
    return 'In full';
  }
  if (status === 'more') {
    return 'More';
  }
  return '—';
}

/** Pill colors match audit ActionBadge (INSERT green, DELETE red); Less uses yellow. */
export function paymentAllocationBadgeClassName(status: PaymentAllocationStatus): string {
  if (status === 'less') {
    return 'bg-yellow-100 text-yellow-800';
  }
  if (status === 'in_full') {
    return 'bg-green-100 text-green-800';
  }
  return 'bg-red-100 text-red-800';
}
