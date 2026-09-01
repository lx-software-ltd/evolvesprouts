'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatGeocodeErrorMessage } from '@/hooks/hook-errors';
import { formatEntityVenueLocationLabel, formatEnumLabel } from '@/lib/format';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';

import {
  computeLatLngErrors,
  evaluateInlineLocationDraft,
  type InlineLocationDraft,
} from '@/components/admin/locations/inline-location-validation';

export type { InlineLocationDraft };

export interface InlineLocationEmbeddedSummary {
  id: string;
  name: string | null;
  address: string | null;
  areaName: string;
  areaId?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface InlineLocationEditorProps {
  /** Changes when the owning editor switches row or create vs edit — resets draft state. */
  stateKey: string;
  location: LocationSummary | null;
  embeddedSummary?: InlineLocationEmbeddedSummary | null;
  areas: GeographicAreaSummary[];
  areasLoading: boolean;
  canModify: boolean;
  isSaving: boolean;
  /** When false and the block is read-only (e.g. contact linked to family/org), show this note under the summary. */
  readOnlyNote?: string | null;
  onRequestEdit?(): void;
  onCancelEdit?(): void;
  onDraftChange?(draft: InlineLocationDraft): void;
  onClear(): void;
  onGeocode(args: { area_id: string; address: string }): Promise<{ lat: number; lng: number }>;
  /** When true, geocode runs are in flight (disables actions). */
  isGeocoding?: boolean;
  /** Hook-level error (e.g. create/update location failed on parent submit). */
  saveError?: string;
  /** Allow Clear to unlink the owner when the linked venue is partner-org locked (Change stays hidden). */
  allowClearWhenLocked?: boolean;
  /** Extra line under the partner-managed copy when the location is partner-locked (for example orgs screen). */
  lockedSummaryExtra?: string | null;
  /**
   * When set, a partner org with this id may edit a venue that is otherwise partner-locked
   * (same row in ``partnerOrganizationIds``).
   */
  allowEditWhenOwnerPartnerOrganizationId?: string | null;
  /**
   * When `canModify` is false and there is no contact-level location to show, render these
   * lines instead of an em dash (for example family/org venue summaries on a linked contact).
   */
  readOnlyLockedLines?: { lines: string[]; footerNote?: string | null } | null;
}

function resolveDisplaySummary(
  location: LocationSummary | null,
  embedded: InlineLocationEmbeddedSummary | null | undefined,
  areaNameForLocation: string
): { line1: string; labels: string[] } | null {
  if (location) {
    const line1 = formatEntityVenueLocationLabel({
      id: location.id,
      name: location.name,
      address: location.address,
      areaName: areaNameForLocation,
    });
    return { line1, labels: location.partnerOrganizationLabels };
  }
  if (embedded) {
    const line1 = formatEntityVenueLocationLabel({
      id: embedded.id,
      name: embedded.name,
      address: embedded.address,
      areaName: embedded.areaName,
    });
    return { line1, labels: [] };
  }
  return null;
}

function seedDraftFromLocation(loc: LocationSummary) {
  return {
    areaId: loc.areaId,
    address: loc.address ?? '',
    lat: loc.lat !== null ? String(loc.lat) : '',
    lng: loc.lng !== null ? String(loc.lng) : '',
  };
}

function seedDraftFromEmbedded(emb: InlineLocationEmbeddedSummary) {
  return {
    areaId: emb.areaId ?? '',
    address: emb.address ?? '',
    lat: emb.lat != null ? String(emb.lat) : '',
    lng: emb.lng != null ? String(emb.lng) : '',
  };
}

function deriveInitialDraft(
  canModify: boolean,
  location: LocationSummary | null,
  embeddedSummary: InlineLocationEmbeddedSummary | null | undefined
): { isEditing: boolean; areaId: string; address: string; lat: string; lng: string } {
  if (!canModify) {
    return { isEditing: false, areaId: '', address: '', lat: '', lng: '' };
  }
  if (location) {
    const s = seedDraftFromLocation(location);
    return { isEditing: false, ...s };
  }
  if (embeddedSummary) {
    const s = seedDraftFromEmbedded(embeddedSummary);
    return { isEditing: false, ...s };
  }
  return { isEditing: true, areaId: '', address: '', lat: '', lng: '' };
}

type InnerProps = Omit<InlineLocationEditorProps, 'stateKey'>;

function InlineLocationEditorInner({
  location,
  embeddedSummary,
  areas,
  areasLoading,
  canModify,
  isSaving,
  readOnlyNote,
  onRequestEdit,
  onCancelEdit,
  onDraftChange,
  onClear,
  onGeocode,
  isGeocoding = false,
  saveError = '',
  allowClearWhenLocked = false,
  lockedSummaryExtra,
  allowEditWhenOwnerPartnerOrganizationId = null,
  readOnlyLockedLines = null,
}: InnerProps) {
  const initial = deriveInitialDraft(canModify, location, embeddedSummary);
  const [isEditing, setIsEditing] = useState(initial.isEditing);
  const [areaId, setAreaIdState] = useState(initial.areaId);
  const [address, setAddressState] = useState(initial.address);
  const [lat, setLatState] = useState(initial.lat);
  const [lng, setLngState] = useState(initial.lng);
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
    return [...areas].sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.name.localeCompare(b.name);
    });
  }, [areas]);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const areaNameForLocation = location ? areaById.get(location.areaId)?.name ?? '' : '';

  const ownerPartnerId = allowEditWhenOwnerPartnerOrganizationId ?? '';
  const ownerCanEditLockedVenue =
    Boolean(ownerPartnerId) &&
    Boolean(location?.partnerOrganizationIds?.includes(ownerPartnerId));
  const lockedFromPartner = Boolean(location?.lockedFromPartnerOrg) && !ownerCanEditLockedVenue;
  const effectiveReadOnly = !canModify || lockedFromPartner;

  const {
    latParseError,
    lngParseError,
    latRangeError,
    lngRangeError,
    onlyOneCoordinate,
  } = computeLatLngErrors(lat, lng);

  const areasReady = !areasLoading && areaOptions.length > 0;

  const displaySummary = resolveDisplaySummary(location, embeddedSummary, areaNameForLocation);

  useEffect(() => {
    if (!onDraftChange) {
      return;
    }
    onDraftChange(
      evaluateInlineLocationDraft({
        areaId,
        address,
        lat,
        lng,
        existingLocationId: location?.id ?? embeddedSummary?.id ?? null,
        isEditing,
        readOnly: effectiveReadOnly,
      })
    );
  }, [
    address,
    areaId,
    effectiveReadOnly,
    embeddedSummary?.id,
    isEditing,
    lat,
    lng,
    location?.id,
    onDraftChange,
  ]);

  function handleRequestEdit() {
    if (effectiveReadOnly) {
      return;
    }
    if (location) {
      const s = seedDraftFromLocation(location);
      setAreaIdState(s.areaId);
      setAddressState(s.address);
      setLatState(s.lat);
      setLngState(s.lng);
    } else if (embeddedSummary) {
      const s = seedDraftFromEmbedded(embeddedSummary);
      setAreaIdState(s.areaId);
      setAddressState(s.address);
      setLatState(s.lat);
      setLngState(s.lng);
    }
    setGeocodeError('');
    setIsEditing(true);
    onRequestEdit?.();
  }

  function handleCancelEdit() {
    if (!location && !embeddedSummary) {
      setAreaIdState('');
      setAddressState('');
      setLatState('');
      setLngState('');
      setGeocodeError('');
      setIsEditing(true);
      onCancelEdit?.();
      return;
    }
    if (location) {
      const s = seedDraftFromLocation(location);
      setAreaIdState(s.areaId);
      setAddressState(s.address);
      setLatState(s.lat);
      setLngState(s.lng);
    } else if (embeddedSummary) {
      const s = seedDraftFromEmbedded(embeddedSummary);
      setAreaIdState(s.areaId);
      setAddressState(s.address);
      setLatState(s.lat);
      setLngState(s.lng);
    }
    setGeocodeError('');
    setIsEditing(false);
    onCancelEdit?.();
  }

  async function handleFillCoordinates() {
    const trimmedAddress = address.trim();
    if (!areaId || !trimmedAddress || !areasReady || isGeocoding || isSaving) {
      return;
    }
    setGeocodeError('');
    try {
      const result = await onGeocode({ area_id: areaId, address: trimmedAddress });
      setLatState(String(result.lat));
      setLngState(String(result.lng));
    } catch (error) {
      setGeocodeError(
        formatGeocodeErrorMessage(
          error,
          'Geocoding failed. Check the address and geographic area, then try again.'
        )
      );
    }
  }

  const showReadBlock = Boolean(displaySummary) && !isEditing;
  const showEditForm = canModify && !effectiveReadOnly && (isEditing || (!location && !embeddedSummary));
  const showChangeButton = canModify && !lockedFromPartner;
  const showClearButton = canModify && (!lockedFromPartner || allowClearWhenLocked);

  if (!canModify && readOnlyLockedLines && readOnlyLockedLines.lines.length > 0) {
    return (
      <div className='space-y-2'>
        <Label>Location</Label>
        <div className='space-y-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800'>
          {readOnlyLockedLines.lines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
        {readOnlyLockedLines.footerNote ? (
          <p className='text-sm text-slate-600'>{readOnlyLockedLines.footerNote}</p>
        ) : null}
        {readOnlyNote ? <p className='text-sm text-slate-600'>{readOnlyNote}</p> : null}
      </div>
    );
  }

  if (!canModify && displaySummary) {
    return (
      <div className='space-y-2'>
        <Label>Location</Label>
        <div className='rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800'>
          <div>{displaySummary.line1}</div>
        </div>
        {lockedFromPartner ? (
          <p className='text-sm text-slate-600'>
            Managed from the partner organisation
            {location && location.partnerOrganizationLabels.length > 0
              ? ` (${location.partnerOrganizationLabels.join(', ')})`
              : ''}
            .
          </p>
        ) : null}
        {lockedFromPartner && lockedSummaryExtra ? (
          <p className='text-sm text-slate-600'>{lockedSummaryExtra}</p>
        ) : null}
        {readOnlyNote ? <p className='text-sm text-slate-600'>{readOnlyNote}</p> : null}
      </div>
    );
  }

  if (!canModify && !displaySummary) {
    return (
      <div className='space-y-2'>
        <Label>Location</Label>
        <p className='text-sm text-slate-600'>—</p>
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      <div>
        <Label>Location</Label>
        {showReadBlock && displaySummary ? (
          <div className='mt-2 space-y-2'>
            <div className='rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800'>
              <div>{displaySummary.line1}</div>
            </div>
            {lockedFromPartner ? (
              <p className='text-sm text-slate-600'>
                Managed from the partner organisation
                {location && location.partnerOrganizationLabels.length > 0
                  ? ` (${location.partnerOrganizationLabels.join(', ')})`
                  : ''}
                .
              </p>
            ) : null}
            {lockedFromPartner && lockedSummaryExtra ? (
              <p className='text-sm text-slate-600'>{lockedSummaryExtra}</p>
            ) : null}
            {showChangeButton || showClearButton ? (
              <div className='flex flex-wrap gap-2'>
                {showChangeButton ? (
                  <Button type='button' size='sm' variant='secondary' disabled={isSaving} onClick={handleRequestEdit}>
                    Change
                  </Button>
                ) : null}
                {showClearButton ? (
                  <Button
                    type='button'
                    size='sm'
                    variant='danger'
                    disabled={isSaving}
                    onClick={() => {
                      onClear();
                      setIsEditing(true);
                      setAreaIdState('');
                      setAddressState('');
                      setLatState('');
                      setLngState('');
                      setGeocodeError('');
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {showEditForm ? (
          <div className='mt-2 space-y-3'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <div>
                <Label htmlFor='inline-loc-area'>Geographic area</Label>
                <Select
                  id='inline-loc-area'
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                  disabled={areasLoading || isSaving}
                >
                  <option value=''>{areasLoading ? 'Loading areas…' : 'Select an area'}</option>
                  {areaOptions.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name} ({formatEnumLabel(area.level)})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor='inline-loc-address'>Address</Label>
                <Input
                  id='inline-loc-address'
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div>
                <Label htmlFor='inline-loc-lat'>Latitude</Label>
                <Input
                  id='inline-loc-lat'
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  disabled={isSaving}
                  inputMode='decimal'
                />
              </div>
              <div>
                <Label htmlFor='inline-loc-lng'>Longitude</Label>
                <Input
                  id='inline-loc-lng'
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  disabled={isSaving}
                  inputMode='decimal'
                />
              </div>
            </div>
            {location || embeddedSummary ? (
              <p className='text-sm text-slate-600'>Editing updates this location wherever it is used.</p>
            ) : null}
            {location && location.partnerOrganizationLabels.length > 1 ? (
              <p className='text-sm text-slate-600'>Editing updates this address everywhere it is shown.</p>
            ) : null}
            {saveError ? <AdminInlineError>{saveError}</AdminInlineError> : null}
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
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                size='sm'
                variant='secondary'
                disabled={
                  isSaving ||
                  isGeocoding ||
                  !areasReady ||
                  !areaId ||
                  !address.trim()
                }
                onClick={() => void handleFillCoordinates()}
              >
                {isGeocoding ? 'Looking up…' : 'Fill coordinates from address'}
              </Button>
              {location || embeddedSummary ? (
                <Button type='button' size='sm' variant='secondary' disabled={isSaving} onClick={handleCancelEdit}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function InlineLocationEditor({ stateKey, ...rest }: InlineLocationEditorProps) {
  return <InlineLocationEditorInner key={stateKey} {...rest} />;
}
