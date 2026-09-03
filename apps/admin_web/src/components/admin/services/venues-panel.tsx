'use client';

import { useCallback, useMemo, useState } from 'react';

import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import { useGeocodeVenueAddress } from '@/hooks/use-geocode-venue-address';
import { formatGeocodeErrorMessage } from '@/hooks/hook-errors';
import { formatEnumLabel, formatLocationLabel } from '@/lib/format';
import { computeLatLngErrors, parseOptionalCoordinate } from '@/components/admin/locations/inline-location-validation';

import type { components } from '@/types/generated/admin-api.generated';
import type { GeographicAreaSummary, LocationSummary, VenueFilters } from '@/types/services';

type ApiSchemas = components['schemas'];

/** Query parameter that mirrors the expanded venue row (`?venue=<id>` or `?venue=new`). */
export const ADMIN_VENUE_QUERY_PARAM = 'venue';

const COLUMN_COUNT = 5;
const EDITOR_FORM_ID = 'venue-editor-form';

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

/**
 * Table-first venues list: area and search filters with `New venue` on top,
 * one expandable row per venue with its editor (name, area, address,
 * coordinates) beneath, and Delete in the Operations column.
 */
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
  const shell = useEntityPanelEditorShell({ paramName: ADMIN_VENUE_QUERY_PARAM });
  const {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    selectedId,
    expanded,
    track,
    clearDirty,
  } = shell;
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [geocodeError, setGeocodeError] = useState('');
  const [deletingVenueId, setDeletingVenueId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('');
    setAreaId('');
    setAddress('');
    setLat('');
    setLng('');
    setGeocodeError('');
    clearDirty();
  }, [clearDirty]);
  const applyRow = useCallback(
    (venue: LocationSummary) => {
      setName(venue.name ?? '');
      setAreaId(venue.areaId);
      setAddress(venue.address ?? '');
      setLat(venue.lat !== null ? String(venue.lat) : '');
      setLng(venue.lng !== null ? String(venue.lng) : '');
      setGeocodeError('');
      clearDirty();
    },
    [clearDirty]
  );
  useExpandedRecordForm<LocationSummary>({
    expandedId: expanded.expandedId,
    rows: venues,
    isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
  });

  const setNameTracked = track(setName);
  const setAreaIdTracked = track((value: string) => {
    setGeocodeError('');
    setAreaId(value);
  });
  const setAddressTracked = track((value: string) => {
    setGeocodeError('');
    setAddress(value);
  });
  const setLatTracked = track((value: string) => {
    setGeocodeError('');
    setLat(value);
  });
  const setLngTracked = track((value: string) => {
    setGeocodeError('');
    setLng(value);
  });

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
    () => venues.find((entry) => entry.id === selectedId) ?? null,
    [venues, selectedId]
  );
  const selectedVenueLocked = selectedVenue?.lockedFromPartnerOrg ?? false;

  const areasReady = !areasLoading && areaOptions.length > 0;
  const latTrim = lat.trim();
  const lngTrim = lng.trim();
  const latNum = parseOptionalCoordinate(lat);
  const lngNum = parseOptionalCoordinate(lng);
  const { latParseError, lngParseError, latRangeError, lngRangeError, coordinatesInvalid, onlyOneCoordinate } =
    computeLatLngErrors(lat, lng);
  const canSubmit = areasReady && Boolean(areaId) && !coordinatesInvalid && !onlyOneCoordinate;

  const fillCoordinatesFromAddress = async () => {
    const trimmedAddress = address.trim();
    if (!areaId || !trimmedAddress || !areasReady) {
      return;
    }
    setGeocodeError('');
    try {
      const result = await geocodeLocation({ area_id: areaId, address: trimmedAddress });
      setLatTracked(String(result.lat));
      setLngTracked(String(result.lng));
    } catch (caught) {
      setGeocodeError(
        formatGeocodeErrorMessage(caught, 'Geocoding failed. Check the address and geographic area, then try again.')
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
        clearDirty();
        expanded.collapse();
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
      } else {
        await onUpdate(selectedVenue.id, payload);
      }
      clearDirty();
    } catch {
      // Keep inline form state visible to let users retry.
    }
  };

  const handleDeleteVenue = async (entry: LocationSummary) => {
    const confirmed = await requestConfirm({
      title: 'Delete venue',
      description: `Delete ${formatLocationLabel(entry)}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    setDeletingVenueId(entry.id);
    try {
      await onDelete(entry.id);
      if (selectedId === entry.id) {
        clearDirty();
        expanded.collapse();
      }
    } catch (caught) {
      setDeleteActionError(caught instanceof Error ? caught.message : 'Failed to delete venue');
    } finally {
      setDeletingVenueId(null);
    }
  };

  const validationError = latParseError || lngParseError
    ? 'Latitude and longitude must be valid numbers.'
    : onlyOneCoordinate
      ? 'Provide both latitude and longitude, or leave both empty.'
      : latRangeError || lngRangeError
        ? 'Latitude must be between -90 and 90; longitude between -180 and 180.'
        : '';

  const detail = (
    <AdminEditorPanel
      status={
        geocodeError || validationError ? (
          <AdminInlineError>{geocodeError || validationError}</AdminInlineError>
        ) : null
      }
      actions={
        <AdminEditorActions
          mode={editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={isSaving}
          submitDisabled={!canSubmit}
          submitLabel={editorMode === 'create' ? 'Create venue' : 'Update venue'}
        >
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
        </AdminEditorActions>
      }
    >
      <form
        id={EDITOR_FORM_ID}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <AdminFieldGrid columns={2}>
          <AdminField
            label='Location name'
            htmlFor='venue-name'
            hint={
              selectedVenueLocked && selectedVenue
                ? `Name is managed from the partner organisation${
                    selectedVenue.partnerOrganizationLabels.length > 0
                      ? ` (${selectedVenue.partnerOrganizationLabels.join(', ')})`
                      : ''
                  }.`
                : undefined
            }
          >
            <Input
              id='venue-name'
              value={name}
              onChange={(event) => setNameTracked(event.target.value)}
              disabled={isSaving || selectedVenueLocked}
              placeholder='e.g. Central Studio'
            />
          </AdminField>
          <AdminField label='Geographic area' htmlFor='venue-area' required>
            <Select
              id='venue-area'
              value={areaId}
              onChange={(event) => setAreaIdTracked(event.target.value)}
              disabled={!areasReady || isSaving}
            >
              <option value=''>{areasLoading ? 'Loading areas…' : 'Select an area'}</option>
              {areaOptions.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name} ({formatEnumLabel(area.level)})
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>
        <AdminFieldGrid columns={1}>
          <AdminField label='Address' htmlFor='venue-address'>
            <Input
              id='venue-address'
              value={address}
              onChange={(event) => setAddressTracked(event.target.value)}
              disabled={isSaving}
            />
          </AdminField>
        </AdminFieldGrid>
        <AdminFieldGrid columns={2}>
          <AdminField label='Latitude' htmlFor='venue-lat'>
            <Input
              id='venue-lat'
              value={lat}
              onChange={(event) => setLatTracked(event.target.value)}
              disabled={isSaving}
              inputMode='decimal'
            />
          </AdminField>
          <AdminField label='Longitude' htmlFor='venue-lng'>
            <Input
              id='venue-lng'
              value={lng}
              onChange={(event) => setLngTracked(event.target.value)}
              disabled={isSaving}
              inputMode='decimal'
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );

  const listError = [error, deleteActionError].filter(Boolean).join(' • ');

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Venues'
        columnCount={COLUMN_COUNT}
        rowCount={venues.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={listError}
        errorTitle='Venues'
        emptyLabel='No venues match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New venue'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='venues-filter-search' className='sm:basis-72'>
              <Input
                id='venues-filter-search'
                value={filters.search}
                autoComplete='off'
                onChange={(event) => onFilterChange('search', event.target.value)}
                placeholder='Name or address'
              />
            </AdminFilterField>
            <AdminFilterField label='Area' htmlFor='venues-filter-area' className='sm:basis-48'>
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
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Address</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Area</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new venue'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New venue</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={detail}
          />
        ) : null}
        {venues.map((venue) => {
          const isOpen = expanded.isExpanded(venue.id);
          const areaName = areaById.get(venue.areaId)?.name ?? venue.areaId;
          const addressLabel = venue.address?.trim() || '—';
          const isDeleting = deletingVenueId === venue.id;
          return (
            <AdminExpandableRow
              key={venue.id}
              id={venue.id}
              label={formatLocationLabel(venue)}
              expanded={isOpen}
              onToggle={() => expanded.toggle(venue.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {venue.name?.trim() || '—'}
                    <AdminDataTableCellMeta>
                      {addressLabel} · {areaName}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {addressLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {areaName}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'delete',
                      label: venue.lockedFromPartnerOrg
                        ? 'Venue is managed by a partner organisation'
                        : isDeleting
                          ? 'Deleting venue'
                          : 'Delete venue',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isSaving || isDeleting || venue.lockedFromPartnerOrg,
                      onClick: () => void handleDeleteVenue(venue),
                    },
                  ]}
                />
              }
              detail={isOpen ? detail : null}
            />
          );
        })}
      </AdminRecordTable>
    </>
  );
}
