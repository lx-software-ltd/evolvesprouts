'use client';

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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCalendarManualBlocks, type CalendarBlockPeriod } from '@/hooks/use-calendar-manual-blocks';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';

const EDITOR_FORM_ID = 'calendar-manual-blocks-editor-form';
const COLUMN_COUNT = 5;

const PERIOD_LABELS: Record<CalendarBlockPeriod, string> = {
  am: 'Morning (AM)',
  pm: 'Afternoon (PM)',
  both: 'Full day (both)',
};

function BlockEditor({ page }: { page: ReturnType<typeof useCalendarManualBlocks> }) {
  return (
    <AdminEditorPanel
      status={page.saveError ? <AdminInlineError>{page.saveError}</AdminInlineError> : null}
      actions={
        <AdminEditorActions
          mode={page.editorMode}
          formId={EDITOR_FORM_ID}
          isSaving={page.isSaving}
          submitDisabled={page.editorIsBusy || !page.blockDate.trim()}
          submitLabel={page.editorMode === 'create' ? 'Create block' : 'Update block'}
        />
      }
    >
      <form
        id={EDITOR_FORM_ID}
        onSubmit={(event) => {
          event.preventDefault();
          void page.handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='Date' htmlFor='calendar-block-date'>
            <Input
              id='calendar-block-date'
              type='date'
              value={page.blockDate}
              onChange={(event) => page.setBlockDate(event.target.value)}
            />
          </AdminField>
          <AdminField label='Period' htmlFor='calendar-block-period'>
            <Select
              id='calendar-block-period'
              value={page.period}
              onChange={(event) => page.setPeriod(event.target.value as CalendarBlockPeriod)}
            >
              {(Object.keys(PERIOD_LABELS) as CalendarBlockPeriod[]).map((value) => (
                <option key={value} value={value}>
                  {PERIOD_LABELS[value]}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Note (optional)' htmlFor='calendar-block-note' span={2}>
            <Input
              id='calendar-block-note'
              type='text'
              autoComplete='off'
              value={page.note}
              onChange={(event) => page.setNote(event.target.value)}
              maxLength={500}
            />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
}

export function CalendarManualBlocksPage() {
  const page = useCalendarManualBlocks();
  const { expanded } = page;
  const detail = <BlockEditor page={page} />;

  return (
    <>
      <ConfirmDialog {...page.confirmDialogProps} />
      <AdminDiscardChangesDialog prompt={expanded.discardPrompt} />
      <AdminRecordTable
        aria-label='Manual blocks'
        columnCount={COLUMN_COUNT}
        rowCount={page.rows.length}
        isLoading={page.isLoading}
        error={page.error || page.deleteActionError}
        errorTitle='Manual blocks'
        emptyLabel='No manual blocks in this range.'
        filters={
          <AdminFilterBar
            trailing={
              <AdminCreateButton
                label='New block'
                active={expanded.isDraftOpen}
                onClick={() => (expanded.isDraftOpen ? expanded.collapse() : expanded.openDraft())}
              />
            }
          >
            <AdminFilterField label='From' htmlFor='calendar-list-from'>
              <Input
                id='calendar-list-from'
                type='date'
                value={page.listFrom}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setListFrom(event.target.value);
                }}
              />
            </AdminFilterField>
            <AdminFilterField label='To' htmlFor='calendar-list-to'>
              <Input
                id='calendar-list-to'
                type='date'
                value={page.listTo}
                onChange={(event) => {
                  page.setDeleteActionError('');
                  page.setListTo(event.target.value);
                }}
              />
            </AdminFilterField>
          </AdminFilterBar>
        }
        head={
          <tr>
            <AdminDataTableHeadCell className='w-10' />
            <AdminDataTableHeadCell>Date</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Period</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Note</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </tr>
        }
      >
        {expanded.isDraftOpen ? (
          <AdminExpandableRow
            id={DRAFT_RECORD_ID}
            label='new block'
            expanded
            isDraft
            onToggle={expanded.collapse}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>New block</AdminDataTableCell>
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
        {page.rows.map((row) => {
          const isOpen = expanded.isExpanded(row.id);
          const periodLabel = row.period.toUpperCase();
          return (
            <AdminExpandableRow
              key={row.id}
              id={row.id}
              label={`${periodLabel} block on ${row.block_date}`}
              expanded={isOpen}
              onToggle={() => expanded.toggle(row.id)}
              columnCount={COLUMN_COUNT}
              cells={
                <>
                  <AdminDataTableCell className='font-medium text-slate-900'>
                    {row.block_date}
                    <AdminDataTableCellMeta>
                      {periodLabel}
                      {row.note?.trim() ? ` · ${row.note.trim()}` : ''}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='uppercase'>
                    {row.period}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='text-slate-700'>
                    {row.note?.trim() || '—'}
                  </AdminDataTableCell>
                </>
              }
              actions={
                <AdminRowActions
                  actions={[
                    {
                      key: 'delete',
                      label: 'Delete block',
                      icon: <DeleteIcon className='h-4 w-4' />,
                      tone: 'danger',
                      disabled: page.editorIsBusy,
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
