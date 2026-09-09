/** Display labels for customer payment allocation vs payment amount. */

export type PaymentAllocationStatus = 'none' | 'less' | 'in_full' | 'more';

export type PaymentAllocationBadgeInput = {
  amount?: string | null;
  unappliedAmount?: string | null;
  direction?: string | null;
  status?: string | null;
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
 * Refunds and failed payments are not invoice allocations; callers should render an em dash.
 */
export function getPaymentAllocationStatus(
  payment: PaymentAllocationBadgeInput,
): PaymentAllocationStatus | null {
  const direction = (payment.direction ?? '').trim().toLowerCase();
  if (direction === 'refund') {
    return null;
  }
  const paymentStatus = (payment.status ?? '').trim().toLowerCase();
  if (paymentStatus === 'failed') {
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
  const allocated = amount - unapplied;
  if (allocated <= AMOUNT_EPSILON) {
    return 'none';
  }
  if (unapplied > AMOUNT_EPSILON) {
    return 'less';
  }
  return 'in_full';
}

export function getPaymentAllocationStatusLabel(status: PaymentAllocationStatus | null): string {
  if (status === 'none') {
    return 'None';
  }
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

/**
 * Pill colors match audit ActionBadge (INSERT green, DELETE red).
 * Less and pending None use yellow; succeeded None uses red.
 */
export function paymentAllocationBadgeClassName(
  status: PaymentAllocationStatus,
  paymentStatus?: string | null,
): string {
  if (status === 'none') {
    const st = (paymentStatus ?? '').trim().toLowerCase();
    if (st === 'pending') {
      return 'bg-yellow-100 text-yellow-800';
    }
    return 'bg-red-100 text-red-800';
  }
  if (status === 'less') {
    return 'bg-yellow-100 text-yellow-800';
  }
  if (status === 'in_full') {
    return 'bg-green-100 text-green-800';
  }
  return 'bg-red-100 text-red-800';
}

export function shouldOpenAllocatedInvoicesDisclosure(
  status: PaymentAllocationStatus | null,
): boolean {
  return status === 'in_full' || status === 'more';
}

export function shouldOpenAllocateDisclosure(status: PaymentAllocationStatus | null): boolean {
  return status === 'none' || status === 'less';
}
