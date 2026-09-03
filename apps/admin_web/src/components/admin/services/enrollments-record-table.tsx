'use client';

import type { ReactNode } from 'react';

import { DeleteIcon } from '@/components/icons/action-icons';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminFilterBar } from '@/components/ui/admin-filter-bar';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions } from '@/components/ui/admin-row-actions';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import { formatDate, formatEnumLabel } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type { DiscountCode, Enrollment } from '@/types/services';

/** Row id of the unsaved enrollment; distinct from the instance table's draft id. */
export const ENROLLMENT_DRAFT_ID = 'enrollment-draft';

const COLUMN_COUNT = 7;

function formatEnrollmentAmount(enrollment: Enrollment, defaultCurrencyCode: string): string {
  const amountRaw = enrollment.amountPaid?.trim() ?? '';
  const parsedAmount = Number.parseFloat(amountRaw);
  const currencyCode = (enrollment.currency ?? defaultCurrencyCode).trim().toUpperCase() || defaultCurrencyCode;
  return amountRaw !== '' && Number.isFinite(parsedAmount) ? formatAmountInCurrency(parsedAmount, currencyCode) : '—';
}

export interface EnrollmentsRecordTableProps {
  enrollments: Enrollment[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  isMutating: boolean;
  error: string;
  /** `ENROLLMENT_DRAFT_ID`, an enrollment id, or `null` when no row is open. */
  expandedId: string | null;
  /** Editor for the open row; rendered inside the expansion. */
  detail: ReactNode;
  discountOptions: DiscountCode[];
  partyLabel: (enrollment: Enrollment) => string;
  onLoadMore: () => Promise<void> | void;
  onToggle: (id: string) => void;
  onDelete: (enrollment: Enrollment) => void;
}

/**
 * Enrollments as a nested table-first list inside the expanded instance row:
 * `New enrollment` opens a draft row, clicking an enrollment opens its editor
 * beneath it, and Delete lives in the Operations column.
 */
export function EnrollmentsRecordTable({
  enrollments,
  isLoading,
  isLoadingMore,
  hasMore,
  isMutating,
  error,
  expandedId,
  detail,
  discountOptions,
  partyLabel,
  onLoadMore,
  onToggle,
  onDelete,
}: EnrollmentsRecordTableProps) {
  const defaultCurrencyCode = getAdminDefaultCurrencyCode();
  const isDraftOpen = expandedId === ENROLLMENT_DRAFT_ID;

  function discountLabel(enrollment: Enrollment): string {
    if (!enrollment.discountCodeId) {
      return '—';
    }
    return discountOptions.find((code) => code.id === enrollment.discountCodeId)?.code ?? enrollment.discountCodeId;
  }

  return (
    <AdminRecordTable
      embedded
      aria-label='Enrollments'
      columnCount={COLUMN_COUNT}
      rowCount={enrollments.length}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      error={error}
      errorTitle='Enrollments'
      emptyLabel='No enrollments yet for this instance.'
      filters={
        <AdminFilterBar
          trailing={
            <AdminCreateButton label='New enrollment' active={isDraftOpen} onClick={() => onToggle(ENROLLMENT_DRAFT_ID)} />
          }
        />
      }
      head={
        <tr>
          <AdminDataTableHeadCell className='w-10' />
          <AdminDataTableHeadCell>Party</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Status</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Amount</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='tertiary'>Discount</AdminDataTableHeadCell>
          <AdminDataTableHeadCell priority='secondary'>Enrolled at</AdminDataTableHeadCell>
          <AdminDataTableOperationsHeadCell />
        </tr>
      }
    >
      {isDraftOpen ? (
        <AdminExpandableRow
          id={ENROLLMENT_DRAFT_ID}
          label='new enrollment'
          expanded
          isDraft
          onToggle={() => onToggle(ENROLLMENT_DRAFT_ID)}
          columnCount={COLUMN_COUNT}
          cells={
            <>
              <AdminDataTableCell className='font-medium text-slate-900'>New enrollment</AdminDataTableCell>
              <AdminDataTableCell priority='secondary' className='text-slate-400'>
                —
              </AdminDataTableCell>
              <AdminDataTableCell priority='secondary' className='text-slate-400'>
                —
              </AdminDataTableCell>
              <AdminDataTableCell priority='tertiary' className='text-slate-400'>
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
      {enrollments.map((enrollment) => {
        const isOpen = expandedId === enrollment.id;
        const party = partyLabel(enrollment);
        const statusLabel = formatEnumLabel(enrollment.status);
        const amountLabel = formatEnrollmentAmount(enrollment, defaultCurrencyCode);
        const enrolledLabel = formatDate(enrollment.enrolledAt);
        return (
          <AdminExpandableRow
            key={enrollment.id}
            id={enrollment.id}
            label={party}
            expanded={isOpen}
            onToggle={() => onToggle(enrollment.id)}
            columnCount={COLUMN_COUNT}
            cells={
              <>
                <AdminDataTableCell className='font-medium text-slate-900'>
                  {party}
                  <AdminDataTableCellMeta>
                    {statusLabel} · {amountLabel} · {enrolledLabel}
                  </AdminDataTableCellMeta>
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-700'>
                  {statusLabel}
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='tabular-nums text-slate-700'>
                  {amountLabel}
                </AdminDataTableCell>
                <AdminDataTableCell priority='tertiary' className='text-slate-700'>
                  {discountLabel(enrollment)}
                </AdminDataTableCell>
                <AdminDataTableCell priority='secondary' className='text-slate-700'>
                  {enrolledLabel}
                </AdminDataTableCell>
              </>
            }
            actions={
              <AdminRowActions
                actions={[
                  {
                    key: 'delete',
                    label: 'Delete enrollment',
                    icon: <DeleteIcon className='h-4 w-4' />,
                    tone: 'danger',
                    disabled: isMutating,
                    onClick: () => onDelete(enrollment),
                  },
                ]}
              />
            }
            detail={isOpen ? detail : null}
          />
        );
      })}
    </AdminRecordTable>
  );
}
