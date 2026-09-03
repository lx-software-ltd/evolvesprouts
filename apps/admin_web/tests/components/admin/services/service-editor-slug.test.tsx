import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceDetailPanel } from '@/components/admin/services/service-detail-panel';
import { AdminApiError } from '@/lib/api-admin-client';
import * as servicesApi from '@/lib/services-api';
import type { ServiceDetail } from '@/types/services';

function buildService(overrides: Partial<ServiceDetail> = {}): ServiceDetail {
  return {
    id: 'service-1',
    instancesCount: 0,
    serviceType: 'training_course',
    title: 'Alpha service',
    serviceKey: 'old-slug',
    bookingSystem: null,
    description: null,
    coverImageS3Key: null,
    deliveryMode: 'online',
    status: 'draft',
    serviceTier: null,
    locationId: null,
    createdBy: 'admin',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    tagIds: [],
    assetIds: [],
    trainingDetails: {
      pricingUnit: 'per_person',
      defaultPrice: null,
      defaultCurrency: null,
    },
    eventDetails: null,
    consultationDetails: null,
    ...overrides,
  };
}

describe('ServiceDetailPanel service key', () => {
  beforeEach(() => {
    vi.spyOn(servicesApi, 'getServiceDiscountCodeUsageSummary').mockResolvedValue({
      summary: { totalCurrentUses: 0, referencingCodeCount: 0 },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lowercases service key on blur and blocks invalid patterns', () => {
    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService()}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />,
    );

    const keyInput = screen.getByLabelText('Service key');
    fireEvent.change(keyInput, { target: { value: 'My-Slug' } });
    fireEvent.blur(keyInput);

    expect(keyInput).toHaveValue('my-slug');

    fireEvent.change(keyInput, { target: { value: 'Bad_' } });
    fireEvent.blur(keyInput);

    expect(screen.getByText(/Use lowercase letters and numbers/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update service' })).toBeDisabled();
  });

  it('confirms service key change when discount usage exists', async () => {
    const user = userEvent.setup();
    vi.mocked(servicesApi.getServiceDiscountCodeUsageSummary).mockResolvedValue({
      summary: { totalCurrentUses: 2, referencingCodeCount: 1 },
      error: null,
    });
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService()}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onUploadCover={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(servicesApi.getServiceDiscountCodeUsageSummary).toHaveBeenCalledWith('service-1');
    });

    const keyInput = screen.getByLabelText('Service key');
    fireEvent.change(keyInput, { target: { value: 'new-slug' } });
    await user.click(screen.getByRole('button', { name: 'Update service' }));

    expect(
      await screen.findByText(/Changing the key will break any existing printed QR codes/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ service_key: 'new-slug' });
  });

  it('confirms service key change when discount usage summary fails to load', async () => {
    const user = userEvent.setup();
    vi.mocked(servicesApi.getServiceDiscountCodeUsageSummary).mockResolvedValue({
      summary: null,
      error: new Error('network'),
    });
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService()}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onUploadCover={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(servicesApi.getServiceDiscountCodeUsageSummary).toHaveBeenCalledWith('service-1');
    });

    expect(
      await screen.findByText(/Could not load discount code usage/),
    ).toBeInTheDocument();

    const keyInput = screen.getByLabelText('Service key');
    fireEvent.change(keyInput, { target: { value: 'new-slug' } });
    await user.click(screen.getByRole('button', { name: 'Update service' }));

    expect(
      await screen.findByText(/We couldn't verify current discount code usage/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
  });

  it('shows inline service key+tier conflict error and blocks save until key or tier changes after 409', async () => {
    const user = userEvent.setup();
    const onUpdate = vi
      .fn()
      .mockRejectedValueOnce(
        new AdminApiError({
          statusCode: 409,
          payload: {
            error:
              'Another service already uses this service key with the same tier. Change the key or use a different tier.',
            field: 'service_key_tier',
          },
          message: 'Conflict',
        }),
      )
      .mockResolvedValueOnce(undefined);

    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService({ serviceKey: 'old-slug', serviceTier: 'cohort-a' })}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onUploadCover={vi.fn()}
      />,
    );

    const keyInput = screen.getByLabelText('Service key');
    fireEvent.change(keyInput, { target: { value: 'taken-slug' } });
    await user.click(screen.getByRole('button', { name: 'Update service' }));

    expect(
      await screen.findByText(/This service key and tier are already used by another service/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update service' })).toBeDisabled();

    const tierInput = screen.getByLabelText('Service tier');
    fireEvent.change(tierInput, { target: { value: 'cohort-b' } });
    expect(screen.getByRole('button', { name: 'Update service' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Update service' }));
    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });
  });

  it('shows empty-tier conflict on tier field when API returns service_key_tier 409 for blank tier', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockRejectedValueOnce(
      new AdminApiError({
        statusCode: 409,
        payload: {
          error:
            'Another service already uses this service key with an empty tier. Set a tier or change the key.',
          field: 'service_key_tier',
        },
        message: 'Conflict',
      }),
    );

    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService({ serviceKey: 'shared-slug', serviceTier: '' })}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onUploadCover={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Update service' }));

    expect(
      await screen.findByText(/Another service uses this service key with an empty tier/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update service' })).toBeDisabled();
  });
});
