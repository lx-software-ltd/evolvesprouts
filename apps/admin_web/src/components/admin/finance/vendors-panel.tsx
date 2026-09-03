'use client';

import { useCallback, useState } from 'react';

import { VendorInactiveIcon } from '@/components/icons/action-icons';
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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
import { formatAmountInDefaultCurrency } from '@/lib/vendor-spend';

import type { components } from '@/types/generated/admin-api.generated';
import type { Vendor, VendorFilters } from '@/types/vendors';

type ApiSchemas = components['schemas'];

/** Query parameter that mirrors the expanded vendor row (`?vendor=<id>` or `?vendor=new`). */
export const ADMIN_VENDOR_QUERY_PARAM = 'vendor';

const COLUMN_COUNT = 5;
const EDITOR_FORM_ID = 'vendor-editor-form';

interface VendorsPanelProps {
  vendors: Vendor[];
  filters: VendorFilters;
  isLoading: boolean;
  isLoadingMore: boolean;
  isSaving: boolean;
  hasMore: boolean;
  error: string;
  onFilterChange: <TKey extends keyof VendorFilters>(key: TKey, value: VendorFilters[TKey]) => void;
  onLoadMore: () => Promise<void> | void;
  onCreate: (payload: ApiSchemas['CreateAdminOrganizationRequest']) => Promise<unknown> | void;
  onUpdate: (vendorId: string, payload: ApiSchemas['UpdateAdminOrganizationRequest']) => Promise<unknown> | void;
  vendorSpendByVendorId: Map<string, number>;
  isVendorSpendLoading: boolean;
  vendorSpendError?: string;
}

/**
 * Table-first vendors list: filters and `New vendor` on top, one expandable
 * row per vendor with the editor (Name, Website, Status) beneath it.
 */
export function VendorsPanel({
  vendors,
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
  vendorSpendByVendorId,
  isVendorSpendLoading,
  vendorSpendError,
}: VendorsPanelProps) {
  const shell = useEntityPanelEditorShell({ paramName: ADMIN_VENDOR_QUERY_PARAM });
  const { expanded, editorMode, selectedId, track, clearDirty } = shell;
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [active, setActive] = useState(true);
  const [deactivatingVendorId, setDeactivatingVendorId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('');
    setWebsite('');
    setActive(true);
    clearDirty();
  }, [clearDirty]);
  const applyRow = useCallback(
    (vendor: Vendor) => {
      setName(vendor.name);
      setWebsite(vendor.website ?? '');
      setActive(vendor.active);
      clearDirty();
    },
    [clearDirty]
  );
  useExpandedRecordForm<Vendor>({
    expandedId: expanded.expandedId,
    rows: vendors,
    isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
  });

  const setNameTracked = track(setName);
  const setWebsiteTracked = track(setWebsite);
  const setActiveTracked = track(setActive);

  async function handleSubmit() {
    try {
      if (editorMode === 'create') {
        await onCreate({
          name: name.trim(),
          organization_type: 'other',
          relationship_type: 'vendor',
          website: website.trim() || null,
          active,
        });
        clearDirty();
        expanded.collapse();
        return;
      }
      if (!selectedId) {
        return;
      }
      await onUpdate(selectedId, {
        name: name.trim(),
        website: website.trim() || null,
        active,
      });
      clearDirty();
    } catch {
      // Keep inline form state so users can retry.
    }
  }

  async function handleDeactivateVendor(vendorId: string) {
    setDeactivatingVendorId(vendorId);
    try {
      await onUpdate(vendorId, { active: false });
      if (selectedId === vendorId) {
        setActive(false);
      }
    } catch {
      // Errors surface via list/refetch; user can retry.
    } finally {
      setDeactivatingVendorId(null);
    }
  }

  const detail = (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode={editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={isSaving}
          submitDisabled={!name.trim()}
          submitLabel={editorMode === 'create' ? 'Create vendor' : 'Update vendor'}
        />
      }
    >
      <form
        id={EDITOR_FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='Name' htmlFor='vendor-name' span={2} required>
            <Input id='vendor-name' value={name} onChange={(event) => setNameTracked(event.target.value)} required />
          </AdminField>
          <AdminField label='Website' htmlFor='vendor-website'>
            <Input
              id='vendor-website'
              value={website}
              inputMode='url'
              onChange={(event) => setWebsiteTracked(event.target.value)}
            />
          </AdminField>
          <AdminField label='Status' htmlFor='vendor-active'>
            <Select
              id='vendor-active'
              value={active ? 'true' : 'false'}
              onChange={(event) => setActiveTracked(event.target.value === 'true')}
            >
              <option value='true'>Active</option>
              <option value='false'>Inactive</option>
            </Select>
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );

  function spendLabel(vendorId: string): string {
    return isVendorSpendLoading ? '…' : formatAmountInDefaultCurrency(vendorSpendByVendorId.get(vendorId) ?? 0);
  }

  return (
    <>
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Vendors'
        columnCount={COLUMN_COUNT}
        rowCount={vendors.length}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        error={error}
        errorTitle='Vendors'
        emptyLabel='No vendors match the current filters.'
        filters={
          <AdminFilterBar
            summary={
              vendorSpendError ? (
                <span className='text-amber-700' role='status'>
                  {vendorSpendError}
                </span>
              ) : null
            }
            trailing={
              <AdminCreateButton
                label='New vendor'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='vendors-search' className='sm:basis-72'>
              <Input
                id='vendors-search'
                value={filters.query}
                autoComplete='off'
                onChange={(event) => onFilterChange('query', event.target.value)}
                placeholder='Vendor name'
              />
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='vendors-active' className='sm:basis-40'>
              <Select
                id='vendors-active'
                value={filters.active}
                onChange={(event) => onFilterChange('active', event.target.value as VendorFilters['active'])}
              >
                <option value=''>All</option>
                <option value='true'>Active</option>
                <option value='false'>Inactive</option>
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Status</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary' className='text-right'>
              Total spend
            </AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new vendor'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New vendor</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-right text-slate-400'>
                  —
                </AdminDataTableCell>
              </>
            }
            actions={null}
            detail={detail}
          />
        ) : null}
        {vendors.map((vendor) => {
          const isOpen = expanded.isExpanded(vendor.id);
          const statusLabel = vendor.active ? 'Active' : 'Inactive';
          const isDeactivating = deactivatingVendorId === vendor.id;
          return (
            <AdminExpandableRow
              key={vendor.id}
              id={vendor.id}
              label={vendor.name}
              expanded={isOpen}
              onToggle={() => expanded.toggle(vendor.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {vendor.name}
                    <AdminDataTableCellMeta>
                      {statusLabel} · {spendLabel(vendor.id)}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {statusLabel}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-right tabular-nums'>
                    {spendLabel(vendor.id)}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'deactivate',
                      label: isDeactivating ? 'Making vendor inactive' : 'Make vendor inactive',
                      icon: <VendorInactiveIcon className='h-4 w-4 shrink-0' aria-hidden />,
                      tone: 'danger',
                      hidden: !vendor.active,
                      disabled: isSaving || isDeactivating,
                      onClick: () => void handleDeactivateVendor(vendor.id),
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
