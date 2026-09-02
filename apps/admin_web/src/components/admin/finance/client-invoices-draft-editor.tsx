'use client';

import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  CUSTOMIZED_DRAFT_INVOICE_FORM_ID,
  CustomizedDraftInvoiceCard,
} from '@/components/admin/finance/customized-draft-invoice-card';
import {
  DRAFT_FORM_ID,
  defaultLineAmount,
  enrollmentNeedsAmountConfirmation,
} from '@/components/admin/finance/client-invoices-utils';
import {
  ENROLLMENT_PICKER_INSTANCE_SERVICE_HEADER,
  INSTANCE_TABLE_TIER_COHORT_HEADER,
  formatBillingEnrollmentPartyCell,
  formatEnrollmentPickerInstanceServiceDisplay,
  formatTierCohortDisplay,
  localTodayYmd,
} from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type {
  ClientInvoicesDraftEditorSlice,
  ClientInvoicesPanelBusy,
  ClientInvoicesPanelCurrency,
  ClientInvoicesPanelIds,
} from '@/hooks/client-invoices-panel-types';

export interface ClientInvoicesDraftEditorProps {
  ids: ClientInvoicesPanelIds;
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  draft: ClientInvoicesDraftEditorSlice;
}

export function ClientInvoicesDraftEditor({
  ids,
  currency,
  busy,
  draft,
}: ClientInvoicesDraftEditorProps) {
  const { draftFilterId, draftModeId, draftInvoiceDateId } = ids;
  const { currencyOptions, defaultCurrency } = currency;
  const { busyAction, editorBusy } = busy;
  const {
    draftCreationMode,
    setDraftCreationMode,
    customizedFormSubmitEnabled,
    setCustomizedFormSubmitEnabled,
    enrollmentFilter,
    setEnrollmentFilter,
    enrollmentPickerRows,
    enrollmentPickerTruncated,
    enrollmentPickerLoading,
    enrollmentPickerError,
    selectedEnrollmentIds,
    setSelectedEnrollmentIds,
    lineOverrideByEnrollmentId,
    setLineOverrideByEnrollmentId,
    draftInvoiceDateMin,
    draftInvoiceDateMax,
    draftInvoiceDate,
    setDraftInvoiceDate,
    selectableFilteredRows,
    selectedEnrollmentRows,
    draftSelectionIssue,
    draftAmountIssue,
    handleCreateDraft,
    refreshBillingLists,
    setBusy,
    setActionError,
    setSelectedInvoiceId,
    setAllocateInvoiceId,
    setAllocateLineId,
    setActionMessage,
  } = draft;

  return (
    <AdminEditorCard
      title='Create draft invoice'
      description='Choose enrollment-based (merge selected enrollments) or customized (manual lines, not linked to enrollments). One primary action submits the visible form.'
      actions={
        <Button
          type='submit'
          form={
            draftCreationMode === 'enrollment'
              ? DRAFT_FORM_ID
              : CUSTOMIZED_DRAFT_INVOICE_FORM_ID
          }
          disabled={
            editorBusy ||
            (draftCreationMode === 'enrollment' &&
              (Boolean(draftSelectionIssue) || Boolean(draftAmountIssue))) ||
            (draftCreationMode === 'customized' && !customizedFormSubmitEnabled)
          }
          aria-label={
            draftCreationMode === 'enrollment'
              ? 'Create draft invoice from selected enrollments'
              : 'Create draft invoice from custom lines'
          }
        >
          {busyAction === 'draft' || busyAction === 'customized'
            ? 'Creating…'
            : 'Create draft invoice'}
        </Button>
      }
    >
      <div className='space-y-4'>
        <div className='min-w-[200px] max-w-md'>
          <Label htmlFor={draftModeId}>Draft type</Label>
          <Select
            id={draftModeId}
            className='mt-1 w-full'
            value={draftCreationMode}
            onChange={(e) => {
              const v =
                e.target.value === 'customized' ? 'customized' : 'enrollment';
              setDraftCreationMode(v);
              if (v === 'enrollment') {
                setCustomizedFormSubmitEnabled(false);
              }
            }}
            disabled={editorBusy}
          >
            <option value='enrollment'>Enrollment-based</option>
            <option value='customized'>Customized (manual lines)</option>
          </Select>
        </div>
        {draftCreationMode === 'enrollment' ? (
          <form
            id={DRAFT_FORM_ID}
            className='space-y-4'
            onSubmit={(e) => void handleCreateDraft(e)}
          >
            <p className='text-sm text-slate-600'>
              Shown: enrollments from the last two years (730 rolling days by
              enrolled date), excluding cancelled and any row already on a draft
              or issued invoice. Selected rows must share bill-to and currency
              on the server.
            </p>
            <AdminTableToolbar marginBottom='none'>
              <div className='min-w-[220px] flex-1'>
                <Label htmlFor={draftFilterId}>Filter enrollments</Label>
                <Input
                  id={draftFilterId}
                  className='mt-1'
                  value={enrollmentFilter}
                  onChange={(e) => setEnrollmentFilter(e.target.value)}
                  placeholder='Search name, email, title, tier, cohort…'
                  disabled={editorBusy}
                />
              </div>
            </AdminTableToolbar>
            {enrollmentPickerTruncated ? (
              <p className='text-sm text-amber-800' role='status'>
                Enrollment list may be incomplete (server capped additional
                pages). Narrow your filter or contact support for full exports.
              </p>
            ) : null}
            {enrollmentPickerError ? (
              <p className='text-sm text-red-800' role='alert'>
                {enrollmentPickerError}
              </p>
            ) : null}
            <section aria-label='Enrollment picker'>
              <AdminDataTable>
                <AdminDataTableHead>
                  <tr>
                    <AdminDataTableHeadCell>
                      <input
                        type='checkbox'
                        aria-label='Select all visible enrollments'
                        checked={
                          selectableFilteredRows.length > 0 &&
                          selectableFilteredRows.every((row) =>
                            selectedEnrollmentIds.has(row.enrollmentId),
                          )
                        }
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelectedEnrollmentIds((prev) => {
                            const next = new Set(prev);
                            if (checked) {
                              for (const row of selectableFilteredRows) {
                                next.add(row.enrollmentId);
                              }
                            } else {
                              for (const row of selectableFilteredRows) {
                                next.delete(row.enrollmentId);
                              }
                            }
                            return next;
                          });
                        }}
                        disabled={
                          editorBusy ||
                          enrollmentPickerLoading ||
                          selectableFilteredRows.length === 0
                        }
                      />
                    </AdminDataTableHeadCell>
                    <AdminDataTableHeadCell>Party</AdminDataTableHeadCell>
                    <AdminDataTableHeadCell>
                      {ENROLLMENT_PICKER_INSTANCE_SERVICE_HEADER}
                    </AdminDataTableHeadCell>
                    <AdminDataTableHeadCell className='max-w-[14rem]'>
                      {INSTANCE_TABLE_TIER_COHORT_HEADER}
                    </AdminDataTableHeadCell>
                    <AdminDataTableHeadCell className='text-right'>
                      Price
                    </AdminDataTableHeadCell>
                    <AdminDataTableHeadCell>Enrolled</AdminDataTableHeadCell>
                  </tr>
                </AdminDataTableHead>
                <AdminDataTableBody>
                  {enrollmentPickerLoading ? (
                    <tr>
                      <AdminDataTableCell
                        colSpan={6}
                        className='py-6 text-sm text-slate-600'
                      >
                        Loading enrollments…
                      </AdminDataTableCell>
                    </tr>
                  ) : enrollmentPickerRows.length === 0 ? (
                    <tr>
                      <AdminDataTableCell
                        colSpan={6}
                        className='py-6 text-sm text-slate-600'
                      >
                        No enrollments match this filter.
                      </AdminDataTableCell>
                    </tr>
                  ) : selectableFilteredRows.length === 0 ? (
                    <tr>
                      <AdminDataTableCell
                        colSpan={6}
                        className='py-6 text-sm text-slate-600'
                      >
                        All matching enrollments are already on a draft or
                        issued invoice.
                      </AdminDataTableCell>
                    </tr>
                  ) : (
                    selectableFilteredRows.map((row) => {
                      const checked = selectedEnrollmentIds.has(
                        row.enrollmentId,
                      );
                      const amountPaidTrimmed = row.amountPaid?.trim() ?? '';
                      const currencyCode =
                        (row.currency ?? defaultCurrency)
                          .trim()
                          .toUpperCase() || defaultCurrency;
                      const parsedAmount = Number.parseFloat(amountPaidTrimmed);
                      const priceLabel =
                        amountPaidTrimmed !== '' &&
                        Number.isFinite(parsedAmount)
                          ? formatAmountInCurrency(parsedAmount, currencyCode)
                          : '—';
                      const tierCohortDisplay = formatTierCohortDisplay(
                        row.serviceTierName,
                        row.instanceCohort,
                      );
                      const instanceServiceDisplay =
                        formatEnrollmentPickerInstanceServiceDisplay(row);
                      const partyCellDisplay =
                        formatBillingEnrollmentPartyCell(row);
                      return (
                        <tr key={row.enrollmentId}>
                          <AdminDataTableCell className='align-top'>
                            <input
                              type='checkbox'
                              aria-label={`Select enrollment ${row.enrollmentId}`}
                              checked={checked}
                              disabled={editorBusy}
                              onChange={(event) => {
                                const nextChecked = event.target.checked;
                                setSelectedEnrollmentIds((prev) => {
                                  const next = new Set(prev);
                                  if (nextChecked) {
                                    next.add(row.enrollmentId);
                                  } else {
                                    next.delete(row.enrollmentId);
                                  }
                                  return next;
                                });
                              }}
                            />
                          </AdminDataTableCell>
                          <AdminDataTableCell className='min-w-0 max-w-[22rem] break-words align-top text-sm'>
                            {partyCellDisplay !== '' ? partyCellDisplay : '—'}
                          </AdminDataTableCell>
                          <AdminDataTableCell className='align-top text-sm'>
                            {instanceServiceDisplay !== ''
                              ? instanceServiceDisplay
                              : '—'}
                          </AdminDataTableCell>
                          <AdminDataTableCell className='max-w-[14rem] min-w-0 break-words align-top text-sm'>
                            {tierCohortDisplay !== '' ? tierCohortDisplay : '—'}
                          </AdminDataTableCell>
                          <AdminDataTableCell className='align-top text-right text-sm tabular-nums'>
                            {priceLabel}
                          </AdminDataTableCell>
                          <AdminDataTableCell className='align-top whitespace-nowrap text-sm'>
                            {row.enrolledAt ? row.enrolledAt.slice(0, 10) : '—'}
                          </AdminDataTableCell>
                        </tr>
                      );
                    })
                  )}
                </AdminDataTableBody>
              </AdminDataTable>
            </section>
            {draftSelectionIssue ? (
              <p className='text-sm text-amber-800'>{draftSelectionIssue}</p>
            ) : null}
            {draftAmountIssue ? (
              <p className='text-sm text-amber-800'>{draftAmountIssue}</p>
            ) : null}
            <div className='space-y-2'>
              <Label>Line totals override</Label>
              <p className='text-xs text-slate-600'>
                Defaults follow each enrollment&apos;s amount. Adjust selected
                rows only.
              </p>
              {selectedEnrollmentRows.length === 0 ? (
                <p className='text-sm text-slate-600'>
                  Select enrollments above to override line amounts.
                </p>
              ) : (
                <div className='space-y-2'>
                  {selectedEnrollmentRows.map((row) => {
                    const needsAmt = enrollmentNeedsAmountConfirmation(row);
                    const partyCellDisplay =
                      formatBillingEnrollmentPartyCell(row);
                    const tierCohortDisplay = formatTierCohortDisplay(
                      row.serviceTierName,
                      row.instanceCohort,
                    );
                    const instanceServiceDisplay =
                      formatEnrollmentPickerInstanceServiceDisplay(row);
                    const partyPart =
                      partyCellDisplay !== '' ? partyCellDisplay : '—';
                    const servicePart =
                      instanceServiceDisplay !== ''
                        ? instanceServiceDisplay
                        : '—';
                    const tierPart =
                      tierCohortDisplay !== '' ? tierCohortDisplay : '—';
                    const lineOverrideEnrollmentLabel = `${partyPart} · ${servicePart} · ${tierPart}`;
                    return (
                      <div
                        key={row.enrollmentId}
                        className={`flex flex-wrap items-center gap-x-4 gap-y-2 border px-3 py-2 ${
                          needsAmt
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-slate-200'
                        }`}
                      >
                        <span className='min-w-0 flex-1 text-sm break-words'>
                          {lineOverrideEnrollmentLabel}
                        </span>
                        {needsAmt ? (
                          <p className='w-full basis-full text-xs text-amber-900'>
                            This enrollment has no recorded amount; enter a line
                            total (use 0 for a zero-dollar line).
                          </p>
                        ) : null}
                        <div className='ml-auto flex shrink-0 items-center gap-2'>
                          <Label
                            className='sr-only'
                            htmlFor={`billing-line-override-${row.enrollmentId}`}
                          >
                            Line total for {lineOverrideEnrollmentLabel}
                          </Label>
                          <Input
                            id={`billing-line-override-${row.enrollmentId}`}
                            className='w-36 font-mono text-sm tabular-nums'
                            inputMode='decimal'
                            value={
                              lineOverrideByEnrollmentId[row.enrollmentId] ??
                              defaultLineAmount(row)
                            }
                            onChange={(e) =>
                              setLineOverrideByEnrollmentId((prev) => ({
                                ...prev,
                                [row.enrollmentId]: e.target.value,
                              }))
                            }
                            disabled={editorBusy}
                          />
                          <span className='text-xs text-slate-600'>
                            {row.currency}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </form>
        ) : (
          <CustomizedDraftInvoiceCard
            defaultCurrency={defaultCurrency}
            currencyOptions={currencyOptions}
            editorBusy={editorBusy}
            loadParents={draftCreationMode === 'customized'}
            draftInvoiceDate={draftInvoiceDate}
            onRequestBusy={(busy) => setBusy(busy ? 'customized' : null)}
            onDraftError={(msg) => setActionError(msg)}
            onValidityChange={setCustomizedFormSubmitEnabled}
            onCreated={async (invoiceId) => {
              setActionError('');
              setSelectedInvoiceId(invoiceId);
              setAllocateInvoiceId('');
              setAllocateLineId('');
              setActionMessage(`Draft invoice created: ${invoiceId}`);
              setDraftInvoiceDate(localTodayYmd());
              await refreshBillingLists();
            }}
          />
        )}
        <div className='min-w-[180px] max-w-xs'>
          <Label htmlFor={draftInvoiceDateId}>Invoice date</Label>
          <Input
            id={draftInvoiceDateId}
            form={
              draftCreationMode === 'enrollment'
                ? DRAFT_FORM_ID
                : CUSTOMIZED_DRAFT_INVOICE_FORM_ID
            }
            type='date'
            className='mt-1 w-full'
            value={draftInvoiceDate}
            onChange={(e) => setDraftInvoiceDate(e.target.value)}
            onBlur={(e) => {
              if (e.target.value === '') {
                setDraftInvoiceDate(localTodayYmd());
              }
            }}
            min={draftInvoiceDateMin}
            max={draftInvoiceDateMax}
            disabled={editorBusy}
          />
        </div>
      </div>
    </AdminEditorCard>
  );
}
