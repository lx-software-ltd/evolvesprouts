'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { DeleteIcon } from '@/components/icons/action-icons';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { toErrorMessage } from '@/hooks/hook-errors';
import {
  CONSULTATION_BOOKING_BLOCK_PURPOSE,
  createCalendarManualBlock,
  deleteCalendarManualBlock,
  listCalendarManualBlocks,
  updateCalendarManualBlock,
  type AdminCalendarManualBlockRow,
} from '@/lib/calendar-manual-blocks-api';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type BlockPeriod = ApiSchemas['CreateAdminCalendarManualBlockRequest']['period'];

const EDITOR_FORM_ID = 'calendar-manual-blocks-editor-form';

function ymdFromLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  return {
    from: ymdFromLocalDate(from),
    to: ymdFromLocalDate(to),
  };
}

export function CalendarManualBlocksPage() {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const range = useMemo(() => defaultDateRange(), []);
  const [listFrom, setListFrom] = useState(range.from);
  const [listTo, setListTo] = useState(range.to);
  const [rows, setRows] = useState<AdminCalendarManualBlockRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blockDate, setBlockDate] = useState('');
  const [period, setPeriod] = useState<BlockPeriod>('am');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const editorIsBusy = isSaving || deleteBusyId !== null;

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError('');
    if (listTo < listFrom) {
      setError('“To” must be on or after “From”.');
      setIsLoading(false);
      return;
    }
    try {
      const items = await listCalendarManualBlocks({
        purpose: CONSULTATION_BOOKING_BLOCK_PURPOSE,
        from: listFrom,
        to: listTo,
      });
      setRows(items);
    } catch (caught) {
      const message = toErrorMessage(caught, 'Failed to load blocks.', { honorBackendMessage: true });
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [listFrom, listTo]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const resetCreateForm = () => {
    setEditorMode('create');
    setSelectedId(null);
    setBlockDate('');
    setPeriod('am');
    setNote('');
    setSaveError('');
  };

  const applyRowSelection = (row: AdminCalendarManualBlockRow) => {
    setEditorMode('edit');
    setSelectedId(row.id);
    setBlockDate(row.block_date);
    setPeriod(row.period as BlockPeriod);
    setNote(row.note?.trim() ?? '');
    setSaveError('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError('');
    setIsSaving(true);
    try {
      if (editorMode === 'create') {
        const body: ApiSchemas['CreateAdminCalendarManualBlockRequest'] = {
          purpose: CONSULTATION_BOOKING_BLOCK_PURPOSE,
          blockDate: blockDate.trim(),
          period,
          note: note.trim() === '' ? null : note.trim(),
        };
        await createCalendarManualBlock(body);
        resetCreateForm();
        await loadRows();
        return;
      }
      if (!selectedId) {
        return;
      }
      const prev = rows.find((r) => r.id === selectedId);
      const body: Partial<ApiSchemas['UpdateAdminCalendarManualBlockRequest']> = {};
      const nextDate = blockDate.trim();
      const nextPeriod = period;
      const nextNoteTrim = note.trim();
      if (nextDate && nextDate !== (prev?.block_date ?? '')) {
        body.blockDate = nextDate;
      }
      if (nextPeriod !== (prev?.period as BlockPeriod | undefined)) {
        body.period = nextPeriod;
      }
      const prevNote = prev?.note?.trim() ?? '';
      if (nextNoteTrim !== prevNote) {
        body.note = nextNoteTrim === '' ? null : nextNoteTrim;
      }
      if (Object.keys(body).length === 0) {
        setSaveError('Change at least one field before saving.');
        return;
      }
      await updateCalendarManualBlock(
        selectedId,
        body as ApiSchemas['UpdateAdminCalendarManualBlockRequest'],
      );
      await loadRows();
    } catch (caught) {
      const message = toErrorMessage(caught, 'Save failed.', { honorBackendMessage: true });
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRow = async (row: AdminCalendarManualBlockRow) => {
    const confirmed = await requestConfirm({
      title: 'Remove manual block?',
      description: `Delete the ${row.period.toUpperCase()} block on ${row.block_date}? Session-derived blocks may still apply.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setDeleteBusyId(row.id);
    setError('');
    try {
      await deleteCalendarManualBlock(row.id);
      if (selectedId === row.id) {
        resetCreateForm();
      }
      await loadRows();
    } catch (caught) {
      const message = toErrorMessage(caught, 'Delete failed.', { honorBackendMessage: true });
      setError(message);
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div className='space-y-6'>
      <AdminEditorCard
        title='Manual calendar block'
        description='Adds extra half-day blocks for family consultation booking (merged with event and training session slots on the public site). Session occupancy always wins; removing a manual row does not override an overlapping course or event.'
        actions={
          editorMode === 'edit' ? (
            <>
              <Button type='button' variant='secondary' disabled={editorIsBusy} onClick={resetCreateForm}>
                Cancel
              </Button>
              <Button
                type='submit'
                form={EDITOR_FORM_ID}
                disabled={editorIsBusy || !blockDate.trim()}
                loading={isSaving}
              >
                Save changes
              </Button>
            </>
          ) : (
            <Button type='submit' form={EDITOR_FORM_ID} disabled={editorIsBusy || !blockDate.trim()}>
              {isSaving ? 'Creating…' : 'Create block'}
            </Button>
          )
        }
      >
        <form id={EDITOR_FORM_ID} className='space-y-4' onSubmit={(event) => void handleSubmit(event)}>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <Label htmlFor='calendar-block-date'>Date</Label>
              <Input
                id='calendar-block-date'
                type='date'
                value={blockDate}
                onChange={(event) => setBlockDate(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor='calendar-block-period'>Period</Label>
              <Select
                id='calendar-block-period'
                value={period}
                onChange={(event) => setPeriod(event.target.value as BlockPeriod)}
              >
                <option value='am'>Morning (AM)</option>
                <option value='pm'>Afternoon (PM)</option>
                <option value='both'>Full day (both)</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor='calendar-block-note'>Note (optional)</Label>
            <Textarea
              id='calendar-block-note'
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          {saveError ? <p className='text-sm text-red-600'>{saveError}</p> : null}
        </form>
      </AdminEditorCard>

      <PaginatedTableCard
        title='Manual blocks'
        isLoading={isLoading}
        isLoadingMore={false}
        hasMore={false}
        error={error}
        loadingLabel='Loading blocks…'
        onLoadMore={() => {}}
        toolbar={
          <AdminTableToolbar>
            <div>
              <Label htmlFor='calendar-list-from'>From</Label>
              <Input
                id='calendar-list-from'
                type='date'
                value={listFrom}
                onChange={(event) => setListFrom(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor='calendar-list-to'>To</Label>
              <Input
                id='calendar-list-to'
                type='date'
                value={listTo}
                onChange={(event) => setListTo(event.target.value)}
              />
            </div>
            <Button type='button' variant='secondary' onClick={() => void loadRows()}>
              Refresh
            </Button>
          </AdminTableToolbar>
        }
      >
        <AdminDataTable tableClassName='min-w-[640px]'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Date</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>AM/PM</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Note</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {rows.length === 0 && !isLoading ? (
              <tr>
                <AdminDataTableCell colSpan={4} className='py-6 text-slate-600'>
                  No manual blocks in this range.
                </AdminDataTableCell>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`cursor-pointer transition ${
                  selectedId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
                onClick={() => applyRowSelection(row)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    applyRowSelection(row);
                  }
                }}
              >
                <AdminDataTableCell className='font-medium text-slate-900'>{row.block_date}</AdminDataTableCell>
                <AdminDataTableCell className='uppercase'>{row.period}</AdminDataTableCell>
                <AdminDataTableCell className='text-slate-700'>{row.note?.trim() || '—'}</AdminDataTableCell>
                <AdminDataTableCell className='text-right' onClick={(event) => event.stopPropagation()}>
                  <Button
                    type='button'
                    size='sm'
                    variant='danger'
                    className='h-8 min-w-8 px-0'
                    disabled={editorIsBusy || deleteBusyId === row.id}
                    onClick={() => void handleDeleteRow(row)}
                    aria-label='Delete block'
                    title='Delete block'
                  >
                    <DeleteIcon className='h-4 w-4 shrink-0' aria-hidden />
                  </Button>
                </AdminDataTableCell>
              </tr>
            ))}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
