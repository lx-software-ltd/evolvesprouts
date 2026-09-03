import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscountCodesPanel } from '@/components/admin/services/discount-codes-panel';
import { AdminApiError } from '@/lib/api-admin-client';
import { tryCopyTextToClipboard } from '@/lib/clipboard';
import type { DiscountCode } from '@/types/services';

vi.mock('@/lib/clipboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/clipboard')>();
  return {
    ...actual,
    tryCopyTextToClipboard: vi.fn(actual.tryCopyTextToClipboard),
  };
});

const mockTryCopyTextToClipboard = vi.mocked(tryCopyTextToClipboard);

vi.mock('@/hooks/use-service-instance-options', () => ({
  useServiceInstanceOptions: () => ({
    instances: [],
    isLoading: false,
    error: '',
    loadForService: vi.fn(),
    invalidate: vi.fn(),
  }),
}));

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    getPublicSiteBaseUrl: () => 'https://www.example.com',
  };
});

const baseService = {
  id: 'svc-1',
  instancesCount: 0,
  serviceType: 'training_course' as const,
  title: 'My Best Auntie',
  serviceKey: 'my-best-auntie-training-course' as string | null,
  serviceTier: null as string | null,
  locationId: null as string | null,
  bookingSystem: null,
  description: null,
  coverImageS3Key: null,
  deliveryMode: 'in_person' as const,
  status: 'published' as const,
  createdBy: 'u',
  createdAt: null,
  updatedAt: null,
  trainingDetails: {
    pricingUnit: 'per_person' as const,
    defaultPrice: '100',
    defaultCurrency: 'HKD',
  },
  eventDetails: null,
  consultationDetails: null,
};

function buildCode(overrides: Partial<DiscountCode> = {}): DiscountCode {
  return {
    id: 'dc-1',
    code: 'SAVE10',
    description: null,
    discountType: 'percentage',
    discountValue: '10',
    currency: null,
    validFrom: null,
    validUntil: null,
    maxUses: null,
    currentUses: 0,
    createdBy: 'u',
    active: true,
    serviceId: null,
    instanceId: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof DiscountCodesPanel>> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(
    <DiscountCodesPanel
      codes={[]}
      filters={{ active: '', search: '', scope: '' }}
      isLoading={false}
      isLoadingMore={false}
      isSaving={false}
      hasMore={false}
      error=''
      serviceOptions={[{ ...baseService }]}
      onFilterChange={vi.fn()}
      onLoadMore={vi.fn()}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      {...overrides}
    />
  );
  return { onCreate, onUpdate, onDelete };
}

async function openDraft() {
  fireEvent.click(screen.getByRole('button', { name: 'New code' }));
  return screen.findByLabelText(/^Code/);
}

describe('DiscountCodesPanel', () => {
  beforeEach(() => {
    mockTryCopyTextToClipboard.mockImplementation(async (text: string) => {
      const mod = await vi.importActual<typeof import('@/lib/clipboard')>('@/lib/clipboard');
      return mod.tryCopyTextToClipboard(text);
    });
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/services');
  });

  it('renders a table-first list without an editor card until a row or the draft opens', () => {
    renderPanel({ codes: [buildCode()] });

    expect(screen.getByRole('region', { name: 'Discount codes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
    const columnHeaders = screen.getAllByRole('columnheader').map((el) => el.textContent?.trim() ?? '');
    expect(columnHeaders).toEqual([
      '',
      'Code',
      'Valid from',
      'Valid until',
      'Value',
      'Uses',
      'Status',
      'Operations',
    ]);
    expect(screen.getByRole('button', { name: 'Expand SAVE10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy discount code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('includes service and instance selects and sends scope in create payload', async () => {
    const { onCreate } = renderPanel();

    const codeInput = await openDraft();
    fireEvent.change(codeInput, { target: { value: 'TEST' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Applies to service'), {
      target: { value: 'svc-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create code' }));

    await vi.waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });
    const payload = onCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.service_id).toBe('svc-1');
    expect(payload.instance_id).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('offers the referral QR action in the overflow menu for every discount row', async () => {
    const user = userEvent.setup();
    renderPanel({ codes: [buildCode()] });

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(screen.getByRole('menuitem', { name: 'Link and QR' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete discount code' })).toBeInTheDocument();
  });

  it('shows archived service title in editor when row expanded while picker omits archived services until then', async () => {
    const user = userEvent.setup();
    const archived = {
      ...baseService,
      id: 'svc-archived',
      title: 'MBA Archived',
      status: 'archived' as const,
    };
    renderPanel({
      codes: [buildCode({ id: 'dc-arch', code: 'ARCH', serviceId: 'svc-archived' })],
      serviceDirectoryForDisplay: [archived],
    });

    await user.click(screen.getByRole('button', { name: 'New code' }));
    const draftSelect = (await screen.findByLabelText('Applies to service')) as HTMLSelectElement;
    expect([...draftSelect.options].some((opt) => opt.textContent?.includes('MBA Archived'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Expand ARCH' }));

    const serviceSelect = (await screen.findByLabelText('Applies to service')) as HTMLSelectElement;
    expect(serviceSelect.value).toBe('svc-archived');
    expect([...serviceSelect.options].some((opt) => opt.textContent?.includes('MBA Archived'))).toBe(true);
    expect(screen.getByLabelText(/^Code/)).toBeDisabled();
    expect(screen.queryByText('Codes cannot be changed after creation.')).not.toBeInTheDocument();
  });

  it('prompts before scope change when the code has current uses', async () => {
    const user = userEvent.setup();
    const svc2 = { ...baseService, id: 'svc-2', title: 'Other' };
    const { onUpdate } = renderPanel({
      codes: [buildCode({ code: 'USED', currentUses: 3, serviceId: 'svc-1' })],
      serviceOptions: [{ ...baseService }, svc2],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand USED' }));
    fireEvent.change(await screen.findByLabelText('Applies to service'), { target: { value: 'svc-2' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update code' }));

    expect(await screen.findByText(/Changing scope won't retroactively affect past bookings/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    expect(onUpdate.mock.calls[0][1]).toMatchObject({ service_id: 'svc-2' });
  });

  it('referral type sets value and currency, disables inputs, and submits defaults', async () => {
    const { onCreate } = renderPanel();

    const codeInput = await openDraft();
    fireEvent.change(codeInput, { target: { value: 'REFNEW' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'referral' } });

    const valueInput = screen.getByLabelText('Value') as HTMLInputElement;
    expect(valueInput).toBeDisabled();
    expect(valueInput.value).toBe('0');
    const currencySelect = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect(currencySelect.value).toBe('HKD');
    expect(currencySelect).toBeDisabled();

    const createBtn = screen.getByRole('button', { name: 'Create code' });
    expect(createBtn).not.toBeDisabled();

    fireEvent.click(createBtn);

    await vi.waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      discount_type: 'referral',
      discount_value: '0',
      currency: 'HKD',
    });
  });

  it('switching away from referral clears value and re-enables value input', async () => {
    renderPanel();

    await openDraft();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'referral' } });
    expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('0');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'percentage' } });
    expect((screen.getByLabelText(/^Value/) as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText(/^Value/)).not.toBeDisabled();
  });

  it('renders Referral in the value column for referral rows', () => {
    renderPanel({
      codes: [buildCode({ id: 'dc-ref', code: 'TRACK', discountType: 'referral', discountValue: '0', currency: 'HKD' })],
    });

    const dataRow = screen.getByTestId('admin-row-dc-ref');
    expect(dataRow.textContent).toContain('Referral');
  });

  it('opens referral QR dialog with row discount type for ref param', async () => {
    const user = userEvent.setup();
    renderPanel({
      codes: [buildCode({ id: 'dc-ref', discountType: 'referral', discountValue: '0', currency: 'HKD', serviceId: 'svc-1' })],
    });

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Link and QR' }));

    await vi.waitFor(() => {
      expect(
        screen.getByRole('link', {
          name: 'https://www.example.com/en/services/my-best-auntie-training-course?ref=SAVE10',
        })
      ).toBeInTheDocument();
    });
  });

  it('shows copy success state on the row copy button when clipboard succeeds', async () => {
    vi.useFakeTimers();
    mockTryCopyTextToClipboard.mockResolvedValue(true);
    try {
      renderPanel({ codes: [buildCode({ id: 'dc-copy', currency: 'HKD' })] });

      fireEvent.click(screen.getByRole('button', { name: 'Copy discount code' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Discount code copied' })).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Copy discount code' })).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes a code from the overflow menu after confirmation', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderPanel({ codes: [buildCode({ id: 'dc-del', code: 'GONE' })] });

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete discount code' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('dc-del');
    });
  });

  it('retries create with COPY, COPY2, … until duplicate 409 stops', async () => {
    const duplicateErr = new AdminApiError({
      statusCode: 409,
      payload: { error: 'duplicate', field: 'code' },
      message: 'A discount code with this value already exists',
    });
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(duplicateErr)
      .mockRejectedValueOnce(duplicateErr)
      .mockResolvedValueOnce(undefined);
    renderPanel({ onCreate });

    const codeInput = await openDraft();
    fireEvent.change(codeInput, { target: { value: 'DUP' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create code' }));

    await vi.waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(3);
    });
    expect(onCreate.mock.calls[0][0]).toMatchObject({ code: 'DUP' });
    expect(onCreate.mock.calls[1][0]).toMatchObject({ code: 'DUPCOPY' });
    expect(onCreate.mock.calls[2][0]).toMatchObject({ code: 'DUPCOPY2' });
  });
});
