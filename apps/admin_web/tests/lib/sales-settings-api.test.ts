import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdminApiRequest } = vi.hoisted(() => ({
  mockAdminApiRequest: vi.fn(),
}));

vi.mock('@/lib/api-admin-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-admin-client')>(
    '@/lib/api-admin-client'
  );
  return {
    ...actual,
    adminApiRequest: mockAdminApiRequest,
  };
});

import { getSalesSettings, updateSalesSettings } from '@/lib/sales-settings-api';

const settingsRow = {
  default_assigned_to: 'user-1',
  notify_assignee_on_assignment: true,
  helper_detector_enabled: false,
  updated_at: '2026-09-01T12:00:00Z',
  updated_by: 'admin-1',
};

describe('sales-settings-api', () => {
  beforeEach(() => {
    mockAdminApiRequest.mockReset();
  });

  it('loads sales settings', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({ settings: settingsRow });

    const settings = await getSalesSettings();

    expect(settings.default_assigned_to).toBe('user-1');
    expect(settings.notify_assignee_on_assignment).toBe(true);
    expect(settings.helper_detector_enabled).toBe(false);
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/leads/settings',
        method: 'GET',
      })
    );
  });

  it('saves sales settings', async () => {
    mockAdminApiRequest.mockResolvedValueOnce({
      settings: { ...settingsRow, notify_assignee_on_assignment: false },
    });

    const settings = await updateSalesSettings({
      default_assigned_to: 'user-1',
      notify_assignee_on_assignment: false,
    });

    expect(settings.notify_assignee_on_assignment).toBe(false);
    expect(mockAdminApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/admin/leads/settings',
        method: 'PATCH',
        body: {
          default_assigned_to: 'user-1',
          notify_assignee_on_assignment: false,
        },
      })
    );
  });
});
