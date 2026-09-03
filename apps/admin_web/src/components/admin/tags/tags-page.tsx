'use client';

import { TagEditorPanel } from '@/components/admin/tags/tag-editor-panel';
import { ArchiveIcon, DeleteIcon, RestoreIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import { useTagsPage } from '@/hooks/use-tags-page';
import type { AdminTagListFilter, AdminTagRow } from '@/lib/tags-api';

const COLUMN_COUNT = 6;

function deleteLabel(row: AdminTagRow): string {
  if (row.is_system) {
    return 'System tag';
  }
  if (row.usage_count > 0) {
    return 'Cannot delete tag while it is in use';
  }
  return 'Delete tag';
}

export function TagsPage() {
  const page = useTagsPage();
  const { expanded } = page;
  const detail = <TagEditorPanel page={page} />;

  return (
    <>
      <ConfirmDialog {...page.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Tags'
        columnCount={COLUMN_COUNT}
        rowCount={page.filteredTags.length}
        isLoading={page.isLoading}
        error={page.error || page.deleteActionError}
        errorTitle='Tags'
        emptyLabel='No tags match the current filters.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New tag'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='Search' htmlFor='tags-list-search' className='sm:basis-72'>
              <Input
                id='tags-list-search'
                value={page.listSearchQuery}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setListSearchQuery(event.target.value);
                }}
                placeholder='Name'
                autoComplete='off'
              />
            </AdminFilterField>
            <AdminFilterField label='Status' htmlFor='tags-list-filter'>
              <Select
                id='tags-list-filter'
                value={page.listFilter}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setListFilter(event.target.value as AdminTagListFilter);
                }}
              >
                <option value='all'>All</option>
                <option value='active'>Active</option>
                <option value='archived'>Archived</option>
              </Select>
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Color</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Uses</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Status</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new tag'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New tag</AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-400'>
                  —
                </AdminDataTableCell>
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
        {page.filteredTags.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          const busy = page.rowBusy?.id === row.id ? page.rowBusy.action : null;
          const status = row.archived_at ? 'Archived' : 'Active';
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
                    {row.is_system ? (
                      <span className='ml-2 text-xs font-normal text-slate-500'>(system)</span>
                    ) : null}
                    <AdminDataTableCellMeta>
                      {row.usage_count} use{row.usage_count === 1 ? '' : 's'} · {status}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='font-mono text-sm text-slate-700'>
                    {row.color ?? '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary'>{row.usage_count}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                    {status}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'archive',
                      label: busy === 'archive' ? 'Archiving tag' : 'Archive tag',
                      icon: <ArchiveIcon className='h-4 w-4' />,
                      hidden: Boolean(row.archived_at) || row.is_system,
                      disabled: page.editorIsBusy,
                      onClick: () => void page.handleArchiveRow(row),
                    },
                    {
                      key: 'restore',
                      label: busy === 'restore' ? 'Restoring tag' : 'Restore tag',
                      icon: <RestoreIcon className='h-4 w-4' />,
                      hidden: !row.archived_at || row.is_system,
                      disabled: page.editorIsBusy,
                      onClick: () => void page.handleRestore(row),
                    },
                    {
                      key: 'delete',
                      label: deleteLabel(row),
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: page.editorIsBusy || row.is_system || row.usage_count > 0,
                      onClick: () => void page.handleDeleteRow(row),
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
