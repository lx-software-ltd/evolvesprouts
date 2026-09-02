'use client';

import { useMemo, useState, type MouseEvent } from 'react';

import type { usePartners } from '@/hooks/use-partners';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useEntityInlineLocation } from '@/hooks/use-entity-inline-location';
import { InlineLocationEditor } from '@/components/admin/locations/inline-location-editor';
import type { InlineLocationEmbeddedSummary } from '@/components/admin/locations/inline-location-editor';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
import { DeleteIcon } from '@/components/icons/action-icons';
import { StatusBanner } from '@/components/status-banner';
import { Button } from '@/components/ui/button';
import { AdminCollapsibleSection } from '@/components/ui/admin-collapsible-section';
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
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Select } from '@/components/ui/select';
import { useSharedEntityTags } from '@/hooks/use-admin-catalog';
import type { EntityTagRef } from '@/lib/entity-api';
import { formatEnumLabel } from '@/lib/format';
import { INSTANCE_SLUG_PATTERN } from '@/lib/slug-utils';
import type { PartnerFilters } from '@/types/partners';
import type { GeographicAreaSummary, LocationSummary } from '@/types/services';
import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

const ORG_TYPES: ApiSchemas['EntityOrganizationType'][] = [
  'school',
  'company',
  'community_group',
  'ngo',
  'other',
];

export interface PartnersPanelProps {
  partners: ReturnType<typeof usePartners>;
  tags?: EntityTagRef[];
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  refreshLocations: () => Promise<void> | void;
  tagsLoadError?: string;
}

export function PartnersPanel({
  partners,
  tags: tagsProp,
  locations,
  geographicAreas,
  areasLoading,
  refreshLocations,
  tagsLoadError: tagsLoadErrorProp,
}: PartnersPanelProps) {
  const tagsCatalog = useSharedEntityTags({ enabled: tagsProp === undefined });
  const tags = tagsProp ?? tagsCatalog.items;
  const tagsLoadError = tagsLoadErrorProp ?? (tagsProp ? '' : tagsCatalog.error);
  const {
    partners: rows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    isSaving,
    createPartner,
    updatePartner,
    deletePartner,
  } = partners;

  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [deleteActionError, setDeleteActionError] = useState('');

  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [organizationType, setOrganizationType] =
    useState<ApiSchemas['EntityOrganizationType']>('company');
  const [partnerKey, setPartnerKey] = useState('');
  const [legalName, setLegalName] = useState('');
  const [website, setWebsite] = useState('');
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null);
  const [optimisticLocationSummary, setOptimisticLocationSummary] =
    useState<InlineLocationEmbeddedSummary | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  const selected = useMemo(
    () => rows.find((o) => o.id === selectedId) ?? null,
    [rows, selectedId]
  );

  // Client-side sort over the loaded page set only (same pattern as other admin panels).
  // Search/status filters still narrow results via the API; pagination order is not global A–Z.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [rows]
  );

  const partnerKeyTrimmed = partnerKey.trim().toLowerCase();
  const partnerKeyPatternInvalid =
    Boolean(partnerKeyTrimmed) && !INSTANCE_SLUG_PATTERN.test(partnerKeyTrimmed);

  const ownerPartnerOrganizationId = editorMode === 'edit' ? selectedId : null;

  const location = useEntityInlineLocation({
    editorMode,
    selectedId,
    stateKeyPrefix: 'partner',
    pendingLocationId,
    setPendingLocationId,
    optimisticLocationSummary,
    setOptimisticLocationSummary,
    selectedLocationSummary: selected?.location_summary,
    locations,
    geographicAreas,
    refreshLocations,
  });

  async function resetCreateForm() {
    setEditorMode('create');
    setSelectedId(null);
    setName('');
    setOrganizationType('company');
    setPartnerKey('');
    setLegalName('');
    setWebsite('');
    setPendingLocationId(null);
    setOptimisticLocationSummary(null);
    location.resetLocationDraft();
    setTagIds([]);
    setActive(true);
  }

  async function handleSubmit(): Promise<void> {
    try {
      const resolved = await location.commitLocationForSubmit();
      if (resolved.status === 'abort') {
        return;
      }
      const loc = resolved.locationId;
      if (editorMode === 'create') {
        await createPartner({
          name: name.trim(),
          organization_type: organizationType,
          relationship_type: 'partner',
          partner_key: partnerKey.trim() || null,
          legal_name: legalName.trim() || null,
          website: website.trim() || null,
          location_id: loc,
          tag_ids: tagIds,
        });
        await resetCreateForm();
        return;
      }
      if (!selected) {
        return;
      }
      await updatePartner(selected.id, {
        name: name.trim(),
        organization_type: organizationType,
        relationship_type: 'partner',
        partner_key: partnerKey.trim() || null,
        legal_name: legalName.trim() || null,
        website: website.trim() || null,
        location_id: loc,
        active,
        tag_ids: tagIds,
      });
    } catch {
      // Retry preserved.
    }
  }

  async function handleDeletePartner(
    row: ApiSchemas['AdminOrganization'],
    clickEvent: MouseEvent<HTMLButtonElement>
  ): Promise<void> {
    clickEvent.stopPropagation();
    const confirmed = await requestConfirm({
      title: 'Delete partner',
      description: `Permanently delete "${row.name}"? This removes the partner organisation from the database and cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteActionError('');
    try {
      await deletePartner(row.id);
      if (selectedId === row.id) {
        await resetCreateForm();
      }
    } catch (err) {
      setDeleteActionError(err instanceof Error ? err.message : 'Failed to delete partner');
    }
  }

  function selectRow(id: string) {
    const row = rows.find((o) => o.id === id);
    if (!row) {
      return;
    }
    setSelectedId(id);
    setEditorMode('edit');
    setName(row.name);
    setOrganizationType(row.organization_type);
    setPartnerKey(row.partner_key ?? '');
    setLegalName(row.legal_name ?? '');
    setWebsite(row.website ?? '');
    setPendingLocationId(row.location_id ?? null);
    setOptimisticLocationSummary(null);
    location.resetLocationDraft();
    setTagIds([...row.tag_ids]);
    setActive(row.active);
  }

  const listError = error || deleteActionError;
  const topBannerError = tagsLoadError;

  return (
    <div className='space-y-6'>
      {topBannerError ? (
        <StatusBanner variant='error' title='Partners'>
          {topBannerError}
        </StatusBanner>
      ) : null}

      <ConfirmDialog {...confirmDialogProps} />
      <AdminEditorCard
        title='Partner'
        description='Partner organisations for Services. Not shown under Contacts → Organisations or Finance → Vendors.'
        actions={
          <>
            {editorMode === 'edit' ? (
              <Button
                type='button'
                variant='secondary'
                onClick={() => void resetCreateForm()}
                disabled={isSaving}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              type='button'
              disabled={isSaving || !name.trim() || location.locationDraftInvalid}
              onClick={() => void handleSubmit()}
            >
              {editorMode === 'create' ? 'Create partner' : 'Update partner'}
            </Button>
          </>
        }
      >
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-4'>
          <div className='lg:col-span-2'>
            <Label htmlFor='svc-partner-name'>Name</Label>
            <Input
              id='svc-partner-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete='off'
            />
          </div>
          <div className='lg:col-span-1'>
            <Label htmlFor='svc-partner-key'>Partner key</Label>
            <Input
              id='svc-partner-key'
              value={partnerKey}
              onChange={(e) => setPartnerKey(e.target.value)}
              autoComplete='off'
              placeholder='e.g. acme-partners'
            />
            {partnerKeyPatternInvalid ? (
              <p className='mt-1 text-xs text-red-600'>
                Use lowercase letters and numbers, with single hyphens between segments (no leading or trailing
                hyphen).
              </p>
            ) : null}
          </div>
          <div className='lg:col-span-1'>
            <Label htmlFor='svc-partner-type'>Organisation type</Label>
            <Select
              id='svc-partner-type'
              value={organizationType}
              onChange={(e) =>
                setOrganizationType(e.target.value as ApiSchemas['EntityOrganizationType'])
              }
            >
              {ORG_TYPES.map((v) => (
                <option key={v} value={v}>
                  {formatEnumLabel(v)}
                </option>
              ))}
            </Select>
          </div>
          <div className='lg:col-span-2'>
            <Label htmlFor='svc-partner-legal-name'>Legal name</Label>
            <Input
              id='svc-partner-legal-name'
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              autoComplete='off'
              placeholder='Registered legal entity name (optional)'
            />
          </div>
          <div className='lg:col-span-2'>
            <Label htmlFor='svc-partner-web'>Website</Label>
            <Input
              id='svc-partner-web'
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              autoComplete='off'
            />
          </div>
          <div className='lg:col-span-1'>
            {editorMode === 'edit' ? (
              <>
                <Label htmlFor='svc-partner-active'>Status</Label>
                <Select
                  id='svc-partner-active'
                  value={active ? 'true' : 'false'}
                  onChange={(e) => setActive(e.target.value === 'true')}
                >
                  <option value='true'>Active</option>
                  <option value='false'>Archived</option>
                </Select>
              </>
            ) : null}
          </div>
          <div className='lg:col-span-4'>
            <AdminCollapsibleSection id='svc-partner-location' title='Location'>
              <InlineLocationEditor
                stateKey={location.inlineLocationStateKey}
                location={location.resolvedLocation}
                embeddedSummary={location.embeddedLocationSummary}
                areas={geographicAreas}
                areasLoading={areasLoading}
                canModify
                allowEditWhenOwnerPartnerOrganizationId={ownerPartnerOrganizationId}
                isSaving={isSaving || location.locationSaveStatus.isSaving}
                isGeocoding={location.locationGeocoding}
                saveError={location.locationSaveStatus.error}
                onDraftChange={location.onLocationDraftChange}
                onClear={location.clearPendingLocation}
                onGeocode={location.geocodeLocation}
              />
            </AdminCollapsibleSection>
          </div>
          <div className='lg:col-span-4 space-y-4'>
            <div>
              <EntityTagPicker
                id='svc-partner-tags'
                label='Tags'
                tags={tags}
                selectedIds={tagIds}
                onChange={setTagIds}
                disabled={isSaving}
                variant='collapsible'
              />
            </div>
          </div>
        </div>
      </AdminEditorCard>

      <PaginatedTableCard
        title='Partners'
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={listError}
        loadingLabel='Loading partners...'
        onLoadMore={loadMore}
        toolbar={
          <AdminTableToolbar>
            <div className='min-w-[200px] flex-1'>
              <Label htmlFor='svc-partners-search'>Search</Label>
              <Input
                id='svc-partners-search'
                value={filters.query}
                onChange={(e) => {
                  setDeleteActionError('');
                  setFilter('query', e.target.value);
                }}
                placeholder='Partner name'
              />
            </div>
            <div className='min-w-[140px]'>
              <Label htmlFor='svc-partners-active'>Status</Label>
              <Select
                id='svc-partners-active'
                value={filters.active}
                onChange={(e) => {
                  setDeleteActionError('');
                  setFilter('active', e.target.value as PartnerFilters['active']);
                }}
              >
                <option value=''>All</option>
                <option value='true'>Active</option>
                <option value='false'>Archived</option>
              </Select>
            </div>
          </AdminTableToolbar>
        }
      >
        <AdminDataTable tableClassName='min-w-[800px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Type</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {sortedRows.map((row) => (
              <tr
                key={row.id}
                className={`cursor-pointer transition ${
                  selectedId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
                onClick={() => selectRow(row.id)}
              >
                <AdminDataTableCell>{row.name}</AdminDataTableCell>
                <AdminDataTableCell>{formatEnumLabel(row.organization_type)}</AdminDataTableCell>
                <AdminDataTableCell>{row.active ? 'Active' : 'Archived'}</AdminDataTableCell>
                <AdminDataTableCell className='text-right'>
                  <div className='flex flex-wrap justify-end gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      className='h-8 min-w-8 px-0'
                      onClick={(e) => {
                        void handleDeletePartner(row, e);
                      }}
                      disabled={isSaving}
                      aria-label='Delete partner'
                      title='Delete partner'
                    >
                      <DeleteIcon className='h-4 w-4 shrink-0' aria-hidden />
                    </Button>
                  </div>
                </AdminDataTableCell>
              </tr>
            ))}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
    </div>
  );
}
