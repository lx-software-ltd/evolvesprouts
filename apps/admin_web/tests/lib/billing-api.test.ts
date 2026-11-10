import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAdminApiRequest = vi.fn();

vi.mock('@/lib/api-admin-client', () => ({
  adminApiRequest: (...args: unknown[]) => mockAdminApiRequest(...args),
}));

import {
  compareBillingEnrollmentPickerRowsByEnrolledAtDesc,
  listCustomerInvoices,
  listRecentEnrollmentsForInvoicing,
} from '@/lib/billing-api';

describe('compareBillingEnrollmentPickerRowsByEnrolledAtDesc', () => {
  const minimalRow = {
    enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    partyDisplayName: 'Party',
    invoiceLinked: false,
    currency: 'HKD',
    billToMergeKey: 'contact|||',
  };

  it('orders newest enrolledAt first', () => {
    const older = {
      ...minimalRow,
      enrollmentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      enrolledAt: '2024-06-01T00:00:00Z',
    };
    const newer = {
      ...minimalRow,
      enrollmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      enrolledAt: '2025-06-01T00:00:00Z',
    };
    expect(compareBillingEnrollmentPickerRowsByEnrolledAtDesc(older, newer)).toBeGreaterThan(0);
    expect(compareBillingEnrollmentPickerRowsByEnrolledAtDesc(newer, older)).toBeLessThan(0);
  });
});

describe('listRecentEnrollmentsForInvoicing', () => {
  beforeEach(() => {
    mockAdminApiRequest.mockReset();
  });

  const minimalRow = {
    enrollmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    partyDisplayName: 'Party',
    invoiceLinked: false,
    currency: 'HKD',
    billToMergeKey: 'contact|||',
  };

  it('aggregates multiple pages when truncated', async () => {
    mockAdminApiRequest
      .mockResolvedValueOnce({
        items: [
          {
            ...minimalRow,
            enrollmentId: '11111111-1111-1111-1111-111111111111',
            enrolledAt: '2025-01-15T00:00:00+00:00',
          },
        ],
        truncated: true,
        next_cursor: 'c1',
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...minimalRow,
            enrollmentId: '22222222-2222-2222-2222-222222222222',
            enrolledAt: '2026-02-01T00:00:00+00:00',
          },
        ],
        truncated: false,
        next_cursor: null,
      });

    const out = await listRecentEnrollmentsForInvoicing();
    expect(mockAdminApiRequest).toHaveBeenCalledTimes(2);
    expect(out.items).toHaveLength(2);
    expect(out.truncated).toBe(true);
    expect(out.items.map((r) => r.enrollmentId)).toEqual([
      '22222222-2222-2222-2222-222222222222',
      '11111111-1111-1111-1111-111111111111',
    ]);
  });

  it('keeps first page when a later page fails', async () => {
    mockAdminApiRequest
      .mockResolvedValueOnce({
        items: [minimalRow],
        truncated: true,
        next_cursor: 'c1',
      })
      .mockRejectedValueOnce(new Error('Server error'));

    const out = await listRecentEnrollmentsForInvoicing();
    expect(out.items).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  it('rethrows when the first page fails', async () => {
    mockAdminApiRequest.mockRejectedValueOnce(new Error('Unavailable'));

    await expect(listRecentEnrollmentsForInvoicing()).rejects.toThrow('Unavailable');
  });
});

describe('listCustomerInvoices', () => {
  beforeEach(() => {
    mockAdminApiRequest.mockReset();
  });

  it('passes settlement query param through to the admin API', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    await listCustomerInvoices({ settlement: 'partially_paid' });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/billing/invoices?settlement=partially_paid',
        method: 'GET',
      }),
    );
  });

  it('passes settlement=no_charge through to the admin API', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    await listCustomerInvoices({ settlement: 'no_charge' });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/billing/invoices?settlement=no_charge',
        method: 'GET',
      }),
    );
  });

  it('passes settlement=not_completed through to the admin API', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    await listCustomerInvoices({ settlement: 'not_completed' });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/billing/invoices?settlement=not_completed',
        method: 'GET',
      }),
    );
  });

  it('passes contact_id query param through to the admin API', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    await listCustomerInvoices({ contactId: '11111111-1111-1111-1111-111111111111' });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath:
          '/v1/admin/billing/invoices?contact_id=11111111-1111-1111-1111-111111111111',
        method: 'GET',
      }),
    );
  });

  it('passes family_id query param through to the admin API', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ items: [], next_cursor: null });

    await listCustomerInvoices({ familyId: '22222222-2222-2222-2222-222222222222' });

    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath:
          '/v1/admin/billing/invoices?family_id=22222222-2222-2222-2222-222222222222',
        method: 'GET',
      }),
    );
  });
});
