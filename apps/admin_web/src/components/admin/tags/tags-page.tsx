'use client';

import { ArchiveIcon, DeleteIcon } from '@/components/icons/action-icons';
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
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTagsPage } from '@/hooks/use-tags-page';
import type { AdminTagListFilter } from '@/lib/tags-api';

const EDITOR_FORM_ID = 'tags-editor-form';

export function TagsPage() {
  const page = useTagsPage();

  return (
    <div className='space-y-6'>
      <AdminEditorCard
        title='Tag'
        description='Tags apply across contacts, families, organisations, services, instances, and assets. Archived tags stay on existing records but no longer appear in pickers. Use Archive or Restore in the table (or Restore in the editor) to change archive state. Tags in use cannot be deleted until usage is zero—archive them instead. System tags (expense_attachment, client_document) cannot be renamed, archived, or deleted.'
        actions={
          page.editorMode === 'edit' ? (
            <>
              {page.showRestoreInEditor ? (
                <Button
                  type='button'
                  variant='secondary'
                  disabled={page.editorIsBusy}
                  loading={page.restoreBusyId === page.selectedTagId}
                  loadingLabel='Restoring…'
                  onClick={() => page.selectedRow && void page.handleRestore(page.selectedRow)}
                >
                  Restore
                </Button>
              ) : null}
              <Button type='button' variant='secondary' disabled={page.editorIsBusy} onClick={page.resetCreateForm}>
                Cancel
              </Button>
              <Button
                type='submit'
                form={EDITOR_FORM_ID}
                disabled={page.editorIsBusy || !page.name.trim()}
                loading={page.isSaving}
              >
                Save changes
              </Button>
            </>
          ) : (
            <Button
              type='submit'
              form={EDITOR_FORM_ID}
              disabled={page.editorIsBusy || !page.name.trim()}
              loading={page.isSaving}
            >
              Create tag
            </Button>
          )
        }
      >
        <form id={EDITOR_FORM_ID} className='space-y-4' onSubmit={(event) => void page.handleSubmit(event)}>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-start'>
            <div className='min-w-0 flex-1'>
              <Label htmlFor='tag-name'>Name</Label>
              <Input
                id='tag-name'
                value={page.name}
                onChange={(event) => page.setName(event.target.value)}
                maxLength={100}
                required
                autoComplete='off'
                disabled={Boolean(page.isEditingSystemTag)}
              />
              {page.isEditingSystemTag ? (
                <p className='mt-1 text-sm text-slate-600'>This system-managed tag name cannot be changed.</p>
              ) : null}
            </div>
            <div className='min-w-0 flex-1 sm:max-w-[220px]'>
              <Label htmlFor='tag-color'>Color (#RRGGBB)</Label>
              <Input
                id='tag-color'
                value={page.color}
                onChange={(event) => page.setColor(event.target.value)}
                placeholder='#336699'
                maxLength={7}
                autoComplete='off'
              />
            </div>
          </div>
          <div>
            <Label htmlFor='tag-description'>Description</Label>
            <Textarea
              id='tag-description'
              value={page.description}
              onChange={(event) => page.setDescription(event.target.value)}
              rows={2}
              maxLength={255}
            />
          </div>
          {page.saveError ? <p className='text-sm text-red-600'>{page.saveError}</p> : null}
        </form>
      </AdminEditorCard>

      <PaginatedTableCard
        title='Tags'
        isLoading={page.isLoading}
        isLoadingMore={false}
        hasMore={false}
        error={page.error}
        loadingLabel='Loading tags…'
        onLoadMore={() => {}}
        toolbar={
          <AdminTableToolbar>
            <div className='min-w-[200px] flex-1'>
              <Label htmlFor='tags-list-search'>Search</Label>
              <Input
                id='tags-list-search'
                value={page.listSearchQuery}
                onChange={(event) => page.setListSearchQuery(event.target.value)}
                placeholder='Name'
                autoComplete='off'
              />
            </div>
            <div className='min-w-[160px]'>
              <Label htmlFor='tags-list-filter'>Status</Label>
              <Select
                id='tags-list-filter'
                value={page.listFilter}
                onChange={(event) => page.setListFilter(event.target.value as AdminTagListFilter)}
              >
                <option value='all'>All</option>
                <option value='active'>Active</option>
                <option value='archived'>Archived</option>
              </Select>
            </div>
          </AdminTableToolbar>
        }
      >
        <AdminDataTable tableClassName='min-w-[720px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Color</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Uses</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {page.filteredTags.map((row) => (
              <tr
                key={row.id}
                className={`cursor-pointer transition ${
                  page.selectedTagId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
                onClick={() => page.applyRowSelection(row)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    page.applyRowSelection(row);
                  }
                }}
              >
                <AdminDataTableCell className='font-medium text-slate-900'>
                  {row.name}
                  {row.is_system ? (
                    <span className='ml-2 text-xs font-normal text-slate-500'>(system)</span>
                  ) : null}
                </AdminDataTableCell>
                <AdminDataTableCell className='font-mono text-sm text-slate-700'>{row.color ?? '—'}</AdminDataTableCell>
                <AdminDataTableCell>{row.usage_count}</AdminDataTableCell>
                <AdminDataTableCell className='text-sm text-slate-700'>
                  {row.archived_at ? 'Archived' : 'Active'}
                </AdminDataTableCell>
                <AdminDataTableCell className='text-right' onClick={(event) => event.stopPropagation()}>
                  <div className='flex justify-end gap-1'>
                    {row.archived_at && !row.is_system ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        disabled={page.editorIsBusy}
                        loading={page.restoreBusyId === row.id}
                        loadingLabel='Restoring…'
                        onClick={() => void page.handleRestore(row)}
                      >
                        Restore
                      </Button>
                    ) : null}
                    {!row.archived_at && !row.is_system ? (
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        className='h-8 min-w-8 px-0'
                        disabled={page.editorIsBusy || page.archiveBusyId === row.id}
                        onClick={() => void page.handleArchiveRow(row)}
                        aria-label='Archive tag'
                        title='Archive'
                      >
                        <ArchiveIcon className='h-4 w-4 shrink-0' aria-hidden />
                      </Button>
                    ) : null}
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      className='h-8 min-w-8 px-0'
                      disabled={
                        page.editorIsBusy ||
                        page.deleteBusyId === row.id ||
                        row.is_system ||
                        row.usage_count > 0
                      }
                      onClick={() => void page.handleDeleteRow(row)}
                      aria-label={
                        row.is_system
                          ? 'System tag'
                          : row.usage_count > 0
                            ? 'Cannot delete tag while it is in use'
                            : 'Delete tag'
                      }
                      title={
                        row.is_system
                          ? 'System-managed tags cannot be removed'
                          : row.usage_count > 0
                            ? 'Remove all uses before deleting, or archive the tag'
                            : 'Delete tag'
                      }
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
      <ConfirmDialog {...page.confirmDialogProps} />
    </div>
  );
}
