'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEntityPanelEditorShell } from '@/hooks/use-entity-panel-editor-shell';
import { useExpandedRecordForm } from '@/hooks/use-expanded-record-form';
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
export type CalendarBlockPeriod = ApiSchemas['CreateAdminCalendarManualBlockRequest']['period'];

export const ADMIN_CALENDAR_BLOCK_QUERY_PARAM = 'block';

function ymdFromLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  return { from: ymdFromLocalDate(from), to: ymdFromLocalDate(to) };
}

/** Manual half-day consultation blocks: list by date range, create, edit, delete. */
export function useCalendarManualBlocks() {
  const {
    confirmDialogProps,
    requestConfirm,
    deleteActionError,
    setDeleteActionError,
    editorMode,
    selectedId,
    expanded,
    clearDirty,
    track,
  } = useEntityPanelEditorShell({ paramName: ADMIN_CALENDAR_BLOCK_QUERY_PARAM });
  const range = useMemo(() => defaultDateRange(), []);
  const [listFrom, setListFrom] = useState(range.from);
  const [listTo, setListTo] = useState(range.to);
  const [rows, setRows] = useState<AdminCalendarManualBlockRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [blockDate, setBlockDate] = useState('');
  const [period, setPeriod] = useState<CalendarBlockPeriod>('am');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setError('');
    if (listTo < listFrom) {
      setError('“To” must be on or after “From”.');
      setIsLoading(false);
      return;
    }
    try {
      setRows(
        await listCalendarManualBlocks({
          purpose: CONSULTATION_BOOKING_BLOCK_PURPOSE,
          from: listFrom,
          to: listTo,
        })
      );
    } catch (caught) {
      setError(toErrorMessage(caught, 'Failed to load blocks.', { honorBackendMessage: true }));
    } finally {
      setIsLoading(false);
    }
  }, [listFrom, listTo]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const resetForm = useCallback(() => {
    setBlockDate('');
    setPeriod('am');
    setNote('');
    setSaveError('');
    clearDirty();
  }, [clearDirty]);

  const applyRow = useCallback(
    (row: AdminCalendarManualBlockRow) => {
      setBlockDate(row.block_date);
      setPeriod(row.period as CalendarBlockPeriod);
      setNote(row.note?.trim() ?? '');
      setSaveError('');
      clearDirty();
    },
    [clearDirty]
  );

  useExpandedRecordForm<AdminCalendarManualBlockRow>({
    expandedId: expanded.expandedId,
    rows,
    isLoading,
    applyRow,
    reset: resetForm,
    collapse: expanded.collapse,
  });

  const handleSubmit = async () => {
    setSaveError('');
    setIsSaving(true);
    try {
      const nextNote = note.trim() === '' ? null : note.trim();
      if (editorMode === 'create') {
        await createCalendarManualBlock({
          purpose: CONSULTATION_BOOKING_BLOCK_PURPOSE,
          blockDate: blockDate.trim(),
          period,
          note: nextNote,
        });
        clearDirty();
        expanded.collapse();
        await loadRows();
        return;
      }
      if (!selectedId) {
        return;
      }
      const prev = rows.find((r) => r.id === selectedId);
      const body: Partial<ApiSchemas['UpdateAdminCalendarManualBlockRequest']> = {};
      const nextDate = blockDate.trim();
      if (nextDate && nextDate !== (prev?.block_date ?? '')) {
        body.blockDate = nextDate;
      }
      if (period !== (prev?.period as CalendarBlockPeriod | undefined)) {
        body.period = period;
      }
      if ((nextNote ?? '') !== (prev?.note?.trim() ?? '')) {
        body.note = nextNote;
      }
      if (Object.keys(body).length === 0) {
        setSaveError('Change at least one field before saving.');
        return;
      }
      await updateCalendarManualBlock(
        selectedId,
        body as ApiSchemas['UpdateAdminCalendarManualBlockRequest']
      );
      clearDirty();
      await loadRows();
    } catch (caught) {
      setSaveError(toErrorMessage(caught, 'Save failed.', { honorBackendMessage: true }));
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
    setDeleteActionError('');
    try {
      await deleteCalendarManualBlock(row.id);
      if (selectedId === row.id) {
        clearDirty();
        expanded.collapse();
      }
      await loadRows();
    } catch (caught) {
      setDeleteActionError(toErrorMessage(caught, 'Delete failed.', { honorBackendMessage: true }));
    } finally {
      setDeleteBusyId(null);
    }
  };

  return {
    confirmDialogProps,
    expanded,
    editorMode,
    listFrom,
    setListFrom,
    listTo,
    setListTo,
    rows,
    isLoading,
    error,
    deleteActionError,
    setDeleteActionError,
    saveError,
    blockDate,
    setBlockDate: track(setBlockDate),
    period,
    setPeriod: track(setPeriod),
    note,
    setNote: track(setNote),
    isSaving,
    deleteBusyId,
    editorIsBusy: isSaving || deleteBusyId !== null,
    handleSubmit,
    handleDeleteRow,
  };
}
