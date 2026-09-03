'use client';

import { useMemo } from 'react';

import type { usePartners } from '@/hooks/use-partners';
import { usePartnerPanelEditor } from '@/hooks/use-partner-panel-editor';
import { useSharedEntityTags } from '@/hooks/use-admin-catalog';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { EntityInlineLocationSection } from '@/components/admin/contacts/shared/entity-inline-location-section';
import { EntityTagPicker } from '@/components/admin/contacts/entity-tag-picker';
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
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { EntityTagRef } from '@/lib/entity-api';
import { formatEnumLabel } from '@/lib/format';
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

const COLUMN_COUNT = 5;
const EDITOR_FORM_ID = 'svc-partner-editor-form';

export interface PartnersPanelProps {
  partners: ReturnType<typeof usePartners>;
  tags?: EntityTagRef[];
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  refreshLocations: () => Promise<void> | void;
  tagsLoadError?: string;
}

/**
 * Table-first partner organisations (Services only; not shown under Contacts →
 * Organisations or Finance → Vendors). Each row expands into its editor with
 * Location and Tags as disclosures; Delete lives in the Operations column.
 */
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
  const { partners: rows, filters, setFilter, isLoading, isLoadingMore, hasMore, error, loadMore } = partners;

  const editor = usePartnerPanelEditor({ partners, locations, geographicAreas, refreshLocations });
  const {
    expanded,
    editorMode,
    selectedId,
    name,
    setName,
    organizationType,
    setOrganizationType,
    partnerKey,
    setPartnerKey,
    partnerKeyPatternInvalid,
    legalName,
    setLegalName,
    website,
    setWebsite,
    tagIds,
    setTagIds,
    active,
    setActive,
    isSaving,
    canSubmit,
    location,
    handleSubmit,
    handleDeletePartner,
  } = editor;

  // Client-side sort over the loaded page set only (same pattern as other admin panels).
  // Search/status filters still narrow results via the API; pagination order is not global A–Z.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [rows]
  );

  const ownerPartnerOrganizationId = editorMode === 'edit' ? selectedId : null;

  const detail = (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode={editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={isSaving}
          submitDisabled={!canSubmit}
          submitLabel={editorMode === 'create' ? 'Create partner' : 'Update partner'}
        />
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
        <AdminFieldGrid columns={4}>
          <AdminField label='Name' htmlFor='svc-partner-name' span={2} required>
            <Input
              id='svc-partner-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete='off'
              disabled={isSaving}
            />
          </AdminField>
          <AdminField
            label='Partner key'
            htmlFor='svc-partner-key'
            errorId='svc-partner-key-error'
            error={
              partnerKeyPatternInvalid
                ? 'Use lowercase letters and numbers, with single hyphens between segments (no leading or trailing hyphen).'
                : null
            }
          >
            <Input
              id='svc-partner-key'
              value={partnerKey}
              onChange={(e) => setPartnerKey(e.target.value)}
              autoComplete='off'
              placeholder='e.g. acme-partners'
              disabled={isSaving}
              aria-invalid={partnerKeyPatternInvalid || undefined}
              aria-describedby={partnerKeyPatternInvalid ? 'svc-partner-key-error' : undefined}
            />
          </AdminField>
          <AdminField label='Organisation type' htmlFor='svc-partner-type'>
            <Select
              id='svc-partner-type'
              value={organizationType}
              onChange={(e) => setOrganizationType(e.target.value as ApiSchemas['EntityOrganizationType'])}
              disabled={isSaving}
            >
              {ORG_TYPES.map((v) => (
                <option key={v} value={v}>
                  {formatEnumLabel(v)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Legal name' htmlFor='svc-partner-legal-name' span={2}>
            <Input
              id='svc-partner-legal-name'
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              autoComplete='off'
              placeholder='Registered legal entity name (optional)'
              disabled={isSaving}
            />
          </AdminField>
          <AdminField label='Website' htmlFor='svc-partner-web' span={editorMode === 'edit' ? 1 : 2}>
            <Input
              id='svc-partner-web'
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              autoComplete='off'
              disabled={isSaving}
            />
          </AdminField>
          {editorMode === 'edit' ? (
            <AdminField label='Status' htmlFor='svc-partner-active'>
              <Select
                id='svc-partner-active'
                value={active ? 'true' : 'false'}
                onChange={(e) => setActive(e.target.value === 'true')}
                disabled={isSaving}
              >
                <option value='true'>Active</option>
                <option value='false'>Archived</option>
              </Select>
            </AdminField>
          ) : null}
        </AdminFieldGrid>
      </form>

      <EntityInlineLocationSection
        sectionId='svc-partner-location'
        stateKey={location.inlineLocationStateKey}
        location={location.resolvedLocation}
        embeddedSummary={location.embeddedLocationSummary}
        areas={geographicAreas}
        areasLoading={areasLoading}
        isSaving={isSaving || location.locationSaveStatus.isSaving}
        isGeocoding={location.locationGeocoding}
        saveError={location.locationSaveStatus.error}
        allowEditWhenOwnerPartnerOrganizationId={ownerPartnerOrganizationId}
        onDraftChange={location.onLocationDraftChange}
        onClear={location.clearPendingLocation}
        onGeocode={location.geocodeLocation}
      />

      <EntityTagPicker
        id='svc-partner-tags'
        label='Tags'
        tags={tags}
        selectedIds={tagIds}
        onChange={setTagIds}
        disabled={isSaving}
        variant='collapsible'
      />
    </AdminEditorPanel>
  );

  const listError = [error, editor.deleteActionError, tagsLoadError].filter(Boolean).join(' • ');

  return (
    <>
      <ConfirmDialog {...editor.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Partners'
        columnCount={COLUMN_COUNT}
        rowCount={sortedRows.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        error={listError}
        errorTitle='Partners'
        emptyLabel='No partners match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New partner'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='svc-partners-search' className='sm:basis-72'>
              <Input
                id='svc-partners-search'
                value={filters.query}
                autoComplete='off'
                onChange={(e) => {
                  editor.setDeleteActionError('');
                  setFilter('query', e.target.value);
                }}
                placeholder='Partner name'
              />
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='svc-partners-active'>
              <Select
                id='svc-partners-active'
                value={filters.active}
                onChange={(e) => {
                  editor.setDeleteActionError('');
                  setFilter('active', e.target.value as PartnerFilters['active']);
                }}
              >
                <option value=''>All</option>
                <option value='true'>Active</option>
                <option value='false'>Archived</option>
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Type</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new partner'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New partner</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={detail}
          />
        ) : null}
        {sortedRows.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          const typeLabel = formatEnumLabel(row.organization_type);
          const statusLabel = row.active ? 'Active' : 'Archived';
          return (
            <AdminExpandableRow
              key={row.id}
              id={row.id}
              label={row.name}
              expanded={isOpen}
              onToggle={() => expanded.toggle(row.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {row.name}
                    <AdminDataTableCellMeta>
                      {typeLabel} · {statusLabel}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {typeLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {statusLabel}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'delete',
                      label: 'Delete partner',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: isSaving,
                      onClick: () => void handleDeletePartner(row),
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
