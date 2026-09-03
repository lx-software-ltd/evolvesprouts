import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VendorsPanel } from '@/components/admin/finance/vendors-panel';
import type { Vendor } from '@/types/vendors';

const activeVendor: Vendor = {
  id: 'vendor-1',
  name: 'Acme Vendor',
  website: 'https://vendor.example.com',
  active: true,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
};

function renderPanel(overrides: Partial<ComponentProps<typeof VendorsPanel>> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  render(
    <VendorsPanel
      vendors={[activeVendor]}
      filters={{ query: '', active: '' }}
      isLoading={false}
      isLoadingMore={false}
      isSaving={false}
      hasMore={false}
      error=''
      onFilterChange={vi.fn()}
      onLoadMore={vi.fn()}
      onCreate={onCreate}
      onUpdate={onUpdate}
      vendorSpendByVendorId={new Map([['vendor-1', 1234.56]])}
      isVendorSpendLoading={false}
      {...overrides}
    />
  );
  return { onCreate, onUpdate };
}

describe('VendorsPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/finance');
  });

  it('renders a table-first list without a title', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Vendors' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendors' })).not.toBeInTheDocument();
    const columnHeaders = screen.getAllByRole('columnheader').map((el) => el.textContent?.trim() ?? '');
    expect(columnHeaders).toEqual(['', 'Name', 'Status', 'Total spend', 'Operations']);
    expect(screen.getAllByText('HK$1,234.56').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Make vendor inactive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New vendor' })).toBeInTheDocument();
  });

  it('deactivates a vendor from the operations column', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel({ vendorSpendByVendorId: new Map() });

    await user.click(screen.getByRole('button', { name: 'Make vendor inactive' }));

    expect(onUpdate).toHaveBeenCalledWith('vendor-1', { active: false });
  });

  it('hides the inactive action when the vendor is already inactive', () => {
    renderPanel({
      vendors: [{ ...activeVendor, name: 'Old Vendor', website: null, active: false }],
      vendorSpendByVendorId: new Map(),
    });

    expect(screen.queryByRole('button', { name: 'Make vendor inactive' })).not.toBeInTheDocument();
  });

  it('expands a vendor row into the inline editor and updates it', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderPanel();

    await user.click(screen.getByRole('button', { name: /expand acme vendor/i }));

    const nameInput = await screen.findByLabelText(/^Name/);
    expect(nameInput).toHaveValue('Acme Vendor');
    expect(screen.getByLabelText('Website')).toHaveValue('https://vendor.example.com');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    await user.clear(nameInput);
    await user.type(nameInput, 'Acme Renamed');
    await user.click(screen.getByRole('button', { name: 'Update vendor' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('vendor-1', {
        name: 'Acme Renamed',
        website: 'https://vendor.example.com',
        active: true,
      });
    });
  });

  it('creates a vendor from the draft row', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderPanel({ vendors: [], vendorSpendByVendorId: new Map() });

    await user.click(screen.getByRole('button', { name: 'New vendor' }));
    await user.type(await screen.findByLabelText(/^Name/), 'Acme Vendor');
    await user.type(screen.getByLabelText('Website'), 'https://vendor.example.com');
    await user.click(screen.getByRole('button', { name: 'Create vendor' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        name: 'Acme Vendor',
        organization_type: 'other',
        relationship_type: 'vendor',
        website: 'https://vendor.example.com',
        active: true,
      });
    });
  });
});
