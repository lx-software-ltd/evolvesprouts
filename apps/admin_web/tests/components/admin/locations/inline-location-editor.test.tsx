import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  InlineLocationEditor,
  type InlineLocationEditorProps,
} from '@/components/admin/locations/inline-location-editor';

import { AdminApiError } from '@/lib/api-admin-client';

const baseArea = {
  id: 'area-1',
  parentId: null,
  name: 'Hong Kong',
  level: 'country' as const,
  code: 'HK',
  sovereignCountryId: null,
  active: true,
  displayOrder: 0,
};

const baseLocation = {
  id: 'loc-1',
  name: 'Studio',
  areaId: 'area-1',
  address: '1 Road',
  lat: 22.1,
  lng: 114.2,
  createdAt: null,
  updatedAt: null,
  lockedFromPartnerOrg: false,
  partnerOrganizationLabels: [] as string[],
  partnerOrganizationIds: [] as string[],
};

function renderEditor(overrides: Partial<InlineLocationEditorProps> = {}) {
  const onDraftChange = vi.fn();
  render(
    <InlineLocationEditor
      stateKey='t1'
      location={null}
      areas={[baseArea]}
      areasLoading={false}
      canModify
      isSaving={false}
      onClear={vi.fn()}
      onGeocode={vi.fn()}
      onDraftChange={onDraftChange}
      {...overrides}
    />
  );
  return { onDraftChange };
}

describe('InlineLocationEditor', () => {
  it('renders State A summary when a location is provided', () => {
    renderEditor({
      location: baseLocation,
    });

    expect(screen.getByText('1 Road · Hong Kong')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update location' })).not.toBeInTheDocument();
  });

  it('reports persistable draft after an area is selected', async () => {
    const user = userEvent.setup();
    const { onDraftChange } = renderEditor({ stateKey: 'new-empty' });

    expect(screen.queryByRole('button', { name: 'Save location' })).not.toBeInTheDocument();
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isEmpty: true, isInvalid: false, isPersistable: false })
    );

    await user.selectOptions(screen.getByLabelText('Geographic area'), 'area-1');
    await user.type(screen.getByLabelText('Address'), 'Somewhere');

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          areaId: 'area-1',
          address: 'Somewhere',
          isPersistable: true,
          isInvalid: false,
        })
      );
    });
  });

  it('geocode success updates lat/lng', async () => {
    const user = userEvent.setup();
    const onGeocode = vi.fn().mockResolvedValue({ lat: 22.3193, lng: 114.1694 });

    renderEditor({
      stateKey: 'g1',
      onGeocode,
    });

    await user.selectOptions(screen.getByLabelText('Geographic area'), 'area-1');
    await user.type(screen.getByLabelText('Address'), '1 Test Road');
    await user.click(screen.getByRole('button', { name: 'Fill coordinates from address' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Latitude')).toHaveValue('22.3193');
      expect(screen.getByLabelText('Longitude')).toHaveValue('114.1694');
    });
  });

  it('geocode 404 shows environment copy', async () => {
    const user = userEvent.setup();
    const onGeocode = vi
      .fn()
      .mockRejectedValue(new AdminApiError({ statusCode: 404, message: 'nope', payload: null }));

    renderEditor({
      stateKey: 'g404',
      onGeocode,
    });

    await user.selectOptions(screen.getByLabelText('Geographic area'), 'area-1');
    await user.type(screen.getByLabelText('Address'), 'Somewhere');
    await user.click(screen.getByRole('button', { name: 'Fill coordinates from address' }));

    await waitFor(() => {
      expect(
        screen.getByText('Geocoding is not available in this environment yet.')
      ).toBeInTheDocument();
    });
  });

  it('does not show propagation helper on create-new path', () => {
    renderEditor({ stateKey: 'new1' });

    expect(
      screen.queryByText('Editing updates this location wherever it is used.')
    ).not.toBeInTheDocument();
  });

  it('Change then edit reports a persistable draft for the existing location', async () => {
    const user = userEvent.setup();
    const { onDraftChange } = renderEditor({
      stateKey: 'patch1',
      location: {
        ...baseLocation,
        name: 'Central Studio',
        address: '1 Road',
        lat: 22,
        lng: 114,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), '2 Road');

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          existingLocationId: 'loc-1',
          areaId: 'area-1',
          address: '2 Road',
          lat: '22',
          lng: '114',
          isEditing: true,
          isPersistable: true,
        })
      );
    });
    expect(screen.queryByRole('button', { name: 'Update location' })).not.toBeInTheDocument();
  });

  it('allowClearWhenLocked shows Clear without Change', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    renderEditor({
      stateKey: 'ac1',
      location: {
        ...baseLocation,
        name: null,
        address: 'A',
        lat: null,
        lng: null,
        lockedFromPartnerOrg: true,
        partnerOrganizationLabels: ['X'],
        partnerOrganizationIds: ['org-x'],
      },
      allowClearWhenLocked: true,
      onClear,
    });

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('partner-org-locked: hides Change and Clear and shows managed note', () => {
    renderEditor({
      stateKey: 'lock1',
      location: {
        ...baseLocation,
        name: null,
        address: 'A',
        lat: null,
        lng: null,
        lockedFromPartnerOrg: true,
        partnerOrganizationLabels: ['Partner Co'],
        partnerOrganizationIds: ['org-partner'],
      },
    });

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.getByText(/Managed from the partner organisation \(Partner Co\)/)).toBeInTheDocument();
  });

  it('owner partner id unlocks Change when venue is partner-locked', async () => {
    const user = userEvent.setup();
    const { onDraftChange } = renderEditor({
      stateKey: 'own1',
      location: {
        ...baseLocation,
        name: null,
        address: 'Shared addr',
        lat: null,
        lng: null,
        lockedFromPartnerOrg: true,
        partnerOrganizationLabels: ['Me', 'Other'],
        partnerOrganizationIds: ['org-me', 'org-other'],
      },
      allowEditWhenOwnerPartnerOrganizationId: 'org-me',
    });

    expect(screen.queryByText(/Managed from the partner organisation/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(
      screen.getByText('Editing updates this address everywhere it is shown.')
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'New addr');

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          existingLocationId: 'loc-1',
          address: 'New addr',
          isPersistable: true,
        })
      );
    });
    expect(screen.queryByRole('button', { name: 'Update location' })).not.toBeInTheDocument();
  });

  it('partner-locked stays locked when owner prop does not match partner ids', () => {
    renderEditor({
      stateKey: 'mismatch',
      location: {
        ...baseLocation,
        name: null,
        address: 'A',
        lat: null,
        lng: null,
        lockedFromPartnerOrg: true,
        partnerOrganizationLabels: ['Partner Co'],
        partnerOrganizationIds: ['org-partner'],
      },
      allowEditWhenOwnerPartnerOrganizationId: 'wrong-org',
    });

    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.getByText(/Managed from the partner organisation \(Partner Co\)/)).toBeInTheDocument();
  });

  it('Clear calls onClear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    renderEditor({
      stateKey: 'clear1',
      location: {
        ...baseLocation,
        name: null,
        address: 'A',
        lat: null,
        lng: null,
      },
      onClear,
    });

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClear).toHaveBeenCalled();
  });

  it('Cancel in edit-existing restores read state', async () => {
    const user = userEvent.setup();
    const onCancelEdit = vi.fn();

    renderEditor({
      stateKey: 'cancel1',
      location: {
        ...baseLocation,
        name: null,
        address: 'Original',
        lat: null,
        lng: null,
      },
      onCancelEdit,
    });

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'Edited');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Original · Hong Kong')).toBeInTheDocument();
    expect(onCancelEdit).toHaveBeenCalled();
  });
});
