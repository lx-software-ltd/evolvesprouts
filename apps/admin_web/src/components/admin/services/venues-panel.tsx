'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Select } from '@/components/ui/select';
import { DeleteIcon } from '@/components/icons/action-icons';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useGeocodeVenueAddress } from '@/hooks/use-geocode-venue-address';
import { formatGeocodeErrorMessage } from '@/hooks/hook-errors';
import { formatEnumLabel, formatLocationLabel } from '@/lib/format';
import { computeLatLngErrors, parseOptionalCoordinate } from '@/components/admin/locations/inline-location-validation';

import type { components } from '@/types/generated/admin-api.generated';
import type { GeographicAreaSummary, LocationSummary, VenueFilters } from '@/types/services';

type ApiSchemas = components['schemas'];

export interface VenuesPanelProps {
  venues: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  filters: VenueFilters;
  isLoading: boolean;
  isLoadingMore: boolean;
  isSaving: boolean;
  hasMore: boolean;
  error: string;
  onFilterChange: <TKey extends keyof VenueFilters>(key: TKey, value: VenueFilters[TKey]) => void;
  onLoadMore: () => Promise<void> | void;
  onCreate: (payload: ApiSchemas['CreateLocationRequest']) => Promise<unknown> | void;
  onUpdate: (venueId: string, payload: ApiSchemas['UpdateLocationRequest']) => Promise<unknown> | void;
  onUpdatePartial: (
    venueId: string,
    payload: ApiSchemas['PartialUpdateLocationRequest']
  ) => Promise<unknown> | void;
  onDelete: (venueId: string) => Promise<void> | void;
}

export function VenuesPanel({
  venues,
  geographicAreas,
  areasLoading,
  filters,
  isLoading,
  isLoadingMore,
  isSaving,
  hasMore,
  error,
  onFilterChange,
  onLoadMore,
  onCreate,
  onUpdate,
  onUpdatePartial,
  onDelete,
}: VenuesPanelProps) {
  const { geocode: geocodeLocation, isGeocoding } = useGeocodeVenueAddress();
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [areaId, setAreaIdState] = useState('');
  const [address, setAddressState] = useState('');
  const [lat, setLatState] = useState('');
  const [lng, setLngState] = useState('');
  const [geocodeError, setGeocodeError] = useState('');
  const setAreaId = (v: string) => {
    setGeocodeError('');
    setAreaIdState(v);
  };
  const setAddress = (v: string) => {
    setGeocodeError('');
    setAddressState(v);
  };
  const setLat = (v: string) => {
    setGeocodeError('');
    setLatState(v);
  };
  const setLng = (v: string) => {
    setGeocodeError('');
    setLngState(v);
  };

  const areaOptions = useMemo(() => {
    return [...geographicAreas].sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.name.localeCompare(b.name);
    });
  }, [geographicAreas]);

  const areaById = useMemo(() => new Map(geographicAreas.map((a) => [a.id, a])), [geographicAreas]);

  const selectedVenue = useMemo(
    () => venues.find((entry) => entry.id === selectedVenueId) ?? null,
    [venues, selectedVenueId]
  );
  const selectedVenueLocked = selectedVenue?.lockedFromPartnerOrg ?? false;

  const areasReady = !areasLoading && areaOptions.length > 0;
  const latTrim = lat.trim();
  const lngTrim = lng.trim();
  const latNum = parseOptionalCoordinate(lat);
  const lngNum = parseOptionalCoordinate(lng);
  const {
    latParseError,
    lngParseError,
    latRangeError,
    lngRangeError,
    coordinatesInvalid,
    onlyOneCoordinate,
  } = computeLatLngErrors(lat, lng);
  const canSubmit =
    areasReady &&
    Boolean(areaId) &&
    !coordinatesInvalid &&
    !onlyOneCoordinate;

  const resetCreateForm = () => {
    setEditorMode('create');
    setSelectedVenueId(null);
    setName('');
    setAreaIdState('');
    setAddressState('');
    setLatState('');
    setLngState('');
    setGeocodeError('');
  };

  const fillCoordinatesFromAddress = async () => {
    const trimmedAddress = address.trim();
    if (!areaId || !trimmedAddress || !areasReady) {
      return;
    }
    setGeocodeError('');
    try {
      const result = await geocodeLocation({
        area_id: areaId,
        address: trimmedAddress,
      });
      setLat(String(result.lat));
      setLng(String(result.lng));
    } catch (error) {
      setGeocodeError(
        formatGeocodeErrorMessage(
          error,
          'Geocoding failed. Check the address and geographic area, then try again.'
        )
      );
    }
  };

  const handleSubmit = async () => {
    if (!areaId || coordinatesInvalid || onlyOneCoordinate) {
      return;
    }
    const latValue: number | null = latTrim === '' ? null : latNum;
    const lngValue: number | null = lngTrim === '' ? null : lngNum;
    const payload: ApiSchemas['CreateLocationRequest'] = {
      area_id: areaId,
      name: name.trim() || null,
      address: address.trim() || null,
      lat: latValue,
      lng: lngValue,
    };
    try {
      if (editorMode === 'create') {
        await onCreate(payload);
        resetCreateForm();
        return;
      }
      if (!selectedVenue) {
        return;
      }
      if (selectedVenue.lockedFromPartnerOrg) {
        await onUpdatePartial(selectedVenue.id, {
          area_id: areaId,
          address: address.trim() || null,
          lat: latValue,
          lng: lngValue,
        });
        return;
      }
      await onUpdate(selectedVenue.id, payload);
    } catch {
      // Keep inline form state visible to let users retry.
    }
  };

  const applyVenueSelection = (entry: LocationSummary) => {
    setSelectedVenueId(entry.id);
    setEditorMode('edit');
    setName(entry.name ?? '');
    setAreaId(entry.areaId);
    setAddress(entry.address ?? '');
    setLat(entry.lat !== null ? String(entry.lat) : '');
    setLng(entry.lng !== null ? String(entry.lng) : '');
  };

  const handleDeleteVenue = async (entry: LocationSummary) => {
    const label = formatLocationLabel(entry);
    const confirmed = await requestConfirm({
      title: 'Delete venue',
      description: `Delete ${label}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await onDelete(entry.id);
    if (selectedVenueId === entry.id) {
      resetCreateForm();
    }
  };

  const editorFormId = 'venues-editor-form';

  return (
    <div className='space-y-6'>
      <AdminEditorCard
        title='Venue'
        description='Create a venue or select a row below to update. Geographic area is required.'
        actions={
          <>
            <Button
              type='button'
              variant='secondary'
              disabled={isSaving || !areasReady || !areaId || !address.trim()}
              loading={isGeocoding}
              loadingLabel='Looking up…'
              onClick={() => void fillCoordinatesFromAddress()}
            >
              Fill coordinates from address
            </Button>
            {editorMode === 'edit' ? (
              <Button type='button' variant='secondary' onClick={resetCreateForm} disabled={isSaving}>
                Cancel
              </Button>
            ) : null}
            <Button
              type='submit'
              form={editorFormId}
              disabled={isSaving || !canSubmit}
            >
              {editorMode === 'create' ? 'Create venue' : 'Update venue'}
            </Button>
          </>
        }
      >
        <form
          id={editorFormId}
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <div>
              <Label htmlFor='venue-name'>Location name</Label>
              <Input
                id='venue-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSaving || selectedVenueLocked}
                placeholder='e.g. Central Studio'
              />
              {selectedVenueLocked && selectedVenue ? (
                <p className='mt-1 text-sm text-slate-600'>
                  Name is managed from the partner organisation
                  {selectedVenue.partnerOrganizationLabels.length > 0
                    ? ` (${selectedVenue.partnerOrganizationLabels.join(', ')})`
                    : ''}
                  .
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor='venue-area'>Geographic area</Label>
              <Select
                id='venue-area'
                value={areaId}
                onChange={(event) => setAreaId(event.target.value)}
                disabled={!areasReady || isSaving}
              >
                <option value=''>{areasLoading ? 'Loading areas…' : 'Select an area'}</option>
                {areaOptions.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name} ({formatEnumLabel(area.level)})
                  </option>
                ))}
              </Select>
            </div>
            <div className='sm:col-span-2'>
              <Label htmlFor='venue-address'>Address</Label>
              <Input
                id='venue-address'
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <div>
              <Label htmlFor='venue-lat'>Latitude</Label>
              <Input
                id='venue-lat'
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                disabled={isSaving}
                inputMode='decimal'
              />
            </div>
            <div>
              <Label htmlFor='venue-lng'>Longitude</Label>
              <Input
                id='venue-lng'
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                disabled={isSaving}
                inputMode='decimal'
              />
            </div>
          </div>
          {geocodeError ? <AdminInlineError>{geocodeError}</AdminInlineError> : null}
          {(latParseError || lngParseError) ? (
            <AdminInlineError>Latitude and longitude must be valid numbers.</AdminInlineError>
          ) : null}
          {onlyOneCoordinate ? (
            <AdminInlineError>Provide both latitude and longitude, or leave both empty.</AdminInlineError>
          ) : null}
          {(latRangeError || lngRangeError) ? (
            <AdminInlineError>
              Latitude must be between -90 and 90; longitude between -180 and 180.
            </AdminInlineError>
          ) : null}
        </form>
      </AdminEditorCard>

      <PaginatedTableCard
        title='Venues'
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        loadingLabel='Loading venues...'
        onLoadMore={onLoadMore}
        toolbar={
          <AdminTableToolbar>
            <div className='min-w-[160px]'>
              <Label htmlFor='venues-filter-area'>Area</Label>
              <Select
                id='venues-filter-area'
                value={filters.areaId}
                onChange={(event) => onFilterChange('areaId', event.target.value)}
              >
                <option value=''>All areas</option>
                {areaOptions.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className='min-w-[200px] flex-1'>
              <Label htmlFor='venues-filter-search'>Search</Label>
              <Input
                id='venues-filter-search'
                value={filters.search}
                onChange={(event) => onFilterChange('search', event.target.value)}
                placeholder='Name or address'
              />
            </div>
          </AdminTableToolbar>
        }
      >
        <AdminDataTable tableClassName='min-w-[520px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Address</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Area</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {venues.map((row) => {
              const area = areaById.get(row.areaId);
              return (
                <tr
                  key={row.id}
                  className={`cursor-pointer transition ${
                    selectedVenueId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => applyVenueSelection(row)}
                >
                  <AdminDataTableCell>{row.name?.trim() || '—'}</AdminDataTableCell>
                  <AdminDataTableCell>{row.address?.trim() || '—'}</AdminDataTableCell>
                  <AdminDataTableCell>{area?.name ?? row.areaId}</AdminDataTableCell>
                  <AdminDataTableCell className='text-right' onClick={(event) => event.stopPropagation()}>
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      disabled={isSaving || row.lockedFromPartnerOrg}
                      onClick={() => void handleDeleteVenue(row)}
                      aria-label='Delete venue'
                      title='Delete venue'
                    >
                      <DeleteIcon className='h-4 w-4' />
                    </Button>
                  </AdminDataTableCell>
                </tr>
              );
            })}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
