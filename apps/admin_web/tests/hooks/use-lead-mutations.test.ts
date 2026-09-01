import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateLead, mockUpdateLead, mockUpdateAdminContact, mockCreateLeadNote } = vi.hoisted(
  () => ({
    mockCreateLead: vi.fn(),
    mockUpdateLead: vi.fn(),
    mockUpdateAdminContact: vi.fn(),
    mockCreateLeadNote: vi.fn(),
  })
);

vi.mock('@/lib/leads-api', () => ({
  createLead: mockCreateLead,
  updateLead: mockUpdateLead,
  createLeadNote: mockCreateLeadNote,
}));

vi.mock('@/lib/entity-api', () => ({
  updateAdminContact: mockUpdateAdminContact,
}));

import { useLeadMutations } from '@/hooks/use-lead-mutations';

describe('useLeadMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the linked contact then the lead', async () => {
    mockUpdateAdminContact.mockResolvedValueOnce({ id: 'contact-1' });
    mockUpdateLead.mockResolvedValueOnce({ id: 'lead-1' });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useLeadMutations({ onSuccess }));

    await act(async () => {
      await result.current.updateLeadEntry('lead-1', {
        funnel_stage: 'engaged',
        assigned_to: 'user-1',
        lost_reason: null,
        contact: {
          id: 'contact-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          source: 'manual',
          contact_type: 'parent',
        },
      });
    });

    expect(mockUpdateAdminContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        first_name: 'Jane',
        source: 'manual',
        contact_type: 'parent',
      })
    );
    expect(mockUpdateLead).toHaveBeenCalledWith('lead-1', {
      funnel_stage: 'engaged',
      assigned_to: 'user-1',
      lost_reason: null,
    });
    expect(onSuccess).toHaveBeenCalledWith('lead-1');
  });

  it('omits referral source from the contact patch', async () => {
    mockUpdateAdminContact.mockResolvedValueOnce({ id: 'contact-1' });
    mockUpdateLead.mockResolvedValueOnce({ id: 'lead-1' });

    const { result } = renderHook(() => useLeadMutations());

    await act(async () => {
      await result.current.updateLeadEntry('lead-1', {
        funnel_stage: 'new',
        contact: {
          id: 'contact-1',
          first_name: 'Jane',
          source: 'referral',
        },
      });
    });

    expect(mockUpdateAdminContact).toHaveBeenCalledWith(
      'contact-1',
      expect.not.objectContaining({ source: 'referral' })
    );
  });
});
