'use client';

import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
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

const PICKER_COLUMN_COUNT = 6;

export interface ClientInvoicesDraftEditorProps {
  ids: ClientInvoicesPanelIds;
  currency: ClientInvoicesPanelCurrency;
  busy: ClientInvoicesPanelBusy;
  draft: ClientInvoicesDraftEditorSlice;
}

/**
 * Body of the "New invoice" draft row. Draft type and invoice date sit in
 * the first field row; the enrollment picker (or the customized line form)
 * follows, and one primary action submits whichever form is visible.
 */
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
    handleCustomizedCreated,
    setInvoiceEditorDirty,
    setBusy,
    setActionError,
  } = draft;

  const activeFormId =
    draftCreationMode === 'enrollment' ? DRAFT_FORM_ID : CUSTOMIZED_DRAFT_INVOICE_FORM_ID;
  const isCreating = busyAction === 'draft' || busyAction === 'customized';
  const submitDisabled =
    editorBusy ||
    (draftCreationMode === 'enrollment' &&
      (Boolean(draftSelectionIssue) || Boolean(draftAmountIssue))) ||
    (draftCreationMode === 'customized' && !customizedFormSubmitEnabled);

  const pickerEmptyLabel =
    enrollmentPickerRows.length === 0
      ? 'No enrollments match this filter.'
      : 'All matching enrollments are already on a draft or issued invoice.';

  return (
    <AdminEditorPanel
      actions={
        <AdminEditorActions
          mode='create'
          formId={activeFormId}
          isSaving={isCreating}
          savingLabel='Creating…'
          submitDisabled={submitDisabled}
          submitLabel='Create draft invoice'
        />
      }
    >
      <AdminFieldGrid columns={4}>
        <AdminField label='Draft type' htmlFor={draftModeId}>
          <Select
            id={draftModeId}
            className='mt-1 w-full'
            value={draftCreationMode}
            onChange={(e) => {
              const v = e.target.value === 'customized' ? 'customized' : 'enrollment';
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
        </AdminField>
        <AdminField label='Invoice date' htmlFor={draftInvoiceDateId}>
          <Input
            id={draftInvoiceDateId}
            form={activeFormId}
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
        </AdminField>
        {draftCreationMode === 'enrollment' ? (
          <AdminField
            label='Filter enrollments'
            htmlFor={draftFilterId}
            span={2}
            hint='Enrollments from the last two years, excluding cancelled ones and rows already on a draft or issued invoice.'
          >
            <Input
              id={draftFilterId}
              className='mt-1'
              value={enrollmentFilter}
              onChange={(e) => setEnrollmentFilter(e.target.value)}
              placeholder='Search name, email, title, tier, cohort…'
              disabled={editorBusy}
              autoComplete='off'
            />
          </AdminField>
        ) : null}
      </AdminFieldGrid>

      {draftCreationMode === 'enrollment' ? (
        <form id={DRAFT_FORM_ID} className='space-y-4' onSubmit={(e) => void handleCreateDraft(e)}>
          {enrollmentPickerTruncated ? (
            <p className='text-sm text-amber-800' role='status'>
              Enrollment list may be incomplete (server capped additional pages). Narrow your filter
              or contact support for full exports.
            </p>
          ) : null}
          <AdminRecordTable
            embedded
            aria-label='Enrollment picker'
            columnCount={PICKER_COLUMN_COUNT}
            rowCount={selectableFilteredRows.length}
            isLoading={enrollmentPickerLoading}
            error={enrollmentPickerError}
            errorTitle='Enrollments'
            emptyLabel={pickerEmptyLabel}
            head={
              <tr>
                <AdminDataTableHeadCell className='w-10'>
                  <input
                    type='checkbox'
                    aria-label='Select all visible enrollments'
                    checked={
                      selectableFilteredRows.length > 0 &&
                      selectableFilteredRows.every((row) => selectedEnrollmentIds.has(row.enrollmentId))
                    }
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setInvoiceEditorDirty(true);
                      setSelectedEnrollmentIds((prev) => {
                        const next = new Set(prev);
                        for (const row of selectableFilteredRows) {
                          if (checked) {
                            next.add(row.enrollmentId);
                          } else {
                            next.delete(row.enrollmentId);
                          }
                        }
                        return next;
                      });
                    }}
                    disabled={editorBusy || enrollmentPickerLoading || selectableFilteredRows.length === 0}
                  />
                </AdminDataTableHeadCell>
                <AdminDataTableHeadCell>Party</AdminDataTableHeadCell>
                <AdminDataTableHeadCell priority='secondary'>
                  {ENROLLMENT_PICKER_INSTANCE_SERVICE_HEADER}
                </AdminDataTableHeadCell>
                <AdminDataTableHeadCell priority='tertiary'>{INSTANCE_TABLE_TIER_COHORT_HEADER}</AdminDataTableHeadCell>
                <AdminDataTableHeadCell className='text-right'>Price</AdminDataTableHeadCell>
                <AdminDataTableHeadCell priority='tertiary'>Enrolled</AdminDataTableHeadCell>
              </tr>
            }
          >
            {selectableFilteredRows.map((row) => {
              const checked = selectedEnrollmentIds.has(row.enrollmentId);
              const amountPaidTrimmed = row.amountPaid?.trim() ?? '';
              const currencyCode = (row.currency ?? defaultCurrency).trim().toUpperCase() || defaultCurrency;
              const parsedAmount = Number.parseFloat(amountPaidTrimmed);
              const priceLabel =
                amountPaidTrimmed !== '' && Number.isFinite(parsedAmount)
                  ? formatAmountInCurrency(parsedAmount, currencyCode)
                  : '—';
              const tierCohortDisplay = formatTierCohortDisplay(row.serviceTierName, row.instanceCohort);
              const instanceServiceDisplay = formatEnrollmentPickerInstanceServiceDisplay(row);
              const partyCellDisplay = formatBillingEnrollmentPartyCell(row);
              const enrolledLabel = row.enrolledAt ? row.enrolledAt.slice(0, 10) : '—';
              return (
                <tr key={row.enrollmentId} className={checked ? 'bg-slate-50' : undefined}>
                  <AdminDataTableCell className='w-10 align-top'>
                    <input
                      type='checkbox'
                      aria-label={`Select enrollment ${row.enrollmentId}`}
                      checked={checked}
                      disabled={editorBusy}
                      onChange={(event) => {
                        const nextChecked = event.target.checked;
                        setInvoiceEditorDirty(true);
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
                  <AdminDataTableCell className='align-top text-sm'>
                    <span className='wrap-anywhere'>{partyCellDisplay !== '' ? partyCellDisplay : '—'}</span>
                    <AdminDataTableCellMeta>
                      {instanceServiceDisplay !== '' ? instanceServiceDisplay : '—'}
                    </AdminDataTableCellMeta>
                    <AdminDataTableCellMeta until='tertiary'>
                      {tierCohortDisplay !== '' ? tierCohortDisplay : '—'} · {enrolledLabel}
                    </AdminDataTableCellMeta>
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='secondary' className='align-top text-sm'>
                    {instanceServiceDisplay !== '' ? instanceServiceDisplay : '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='align-top text-sm'>
                    {tierCohortDisplay !== '' ? tierCohortDisplay : '—'}
                  </AdminDataTableCell>
                  <AdminDataTableCell className='align-top text-right text-sm tabular-nums'>{priceLabel}</AdminDataTableCell>
                  <AdminDataTableCell priority='tertiary' className='align-top text-sm whitespace-nowrap'>
                    {enrolledLabel}
                  </AdminDataTableCell>
                </tr>
              );
            })}
          </AdminRecordTable>
          {draftSelectionIssue ? <AdminInlineError>{draftSelectionIssue}</AdminInlineError> : null}
          {draftAmountIssue ? <AdminInlineError>{draftAmountIssue}</AdminInlineError> : null}
          {selectedEnrollmentRows.length > 0 ? (
            <div className='space-y-2'>
              <Label>Line totals</Label>
              <p className='text-xs text-slate-500'>
                Defaults follow each enrollment&apos;s amount; adjust only what differs.
              </p>
              <div className='space-y-2'>
                {selectedEnrollmentRows.map((row) => {
                  const needsAmt = enrollmentNeedsAmountConfirmation(row);
                  const partyCellDisplay = formatBillingEnrollmentPartyCell(row);
                  const tierCohortDisplay = formatTierCohortDisplay(row.serviceTierName, row.instanceCohort);
                  const instanceServiceDisplay = formatEnrollmentPickerInstanceServiceDisplay(row);
                  const partyPart = partyCellDisplay !== '' ? partyCellDisplay : '—';
                  const servicePart = instanceServiceDisplay !== '' ? instanceServiceDisplay : '—';
                  const tierPart = tierCohortDisplay !== '' ? tierCohortDisplay : '—';
                  const lineOverrideEnrollmentLabel = `${partyPart} · ${servicePart} · ${tierPart}`;
                  const inputId = `billing-line-override-${row.enrollmentId}`;
                  return (
                    <div
                      key={row.enrollmentId}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 ${
                        needsAmt ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span className='min-w-0 flex-1 text-sm wrap-anywhere'>{lineOverrideEnrollmentLabel}</span>
                      {needsAmt ? (
                        <p className='w-full basis-full text-xs text-amber-900'>
                          This enrollment has no recorded amount; enter a line total (use 0 for a zero-dollar
                          line).
                        </p>
                      ) : null}
                      <div className='ml-auto flex shrink-0 items-center gap-2'>
                        <Label className='sr-only' htmlFor={inputId}>
                          Line total for {lineOverrideEnrollmentLabel}
                        </Label>
                        <Input
                          id={inputId}
                          className='w-36 font-mono text-sm tabular-nums'
                          inputMode='decimal'
                          value={lineOverrideByEnrollmentId[row.enrollmentId] ?? defaultLineAmount(row)}
                          onChange={(e) => {
                            setInvoiceEditorDirty(true);
                            setLineOverrideByEnrollmentId((prev) => ({
                              ...prev,
                              [row.enrollmentId]: e.target.value,
                            }));
                          }}
                          disabled={editorBusy}
                        />
                        <span className='text-xs text-slate-600'>{row.currency}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </form>
      ) : (
        <CustomizedDraftInvoiceCard
          defaultCurrency={defaultCurrency}
          currencyOptions={currencyOptions}
          editorBusy={editorBusy}
          loadParents
          draftInvoiceDate={draftInvoiceDate}
          onRequestBusy={(isBusy) => setBusy(isBusy ? 'customized' : null)}
          onDraftError={(msg) => setActionError(msg)}
          onValidityChange={setCustomizedFormSubmitEnabled}
          onDirtyChange={setInvoiceEditorDirty}
          onCreated={handleCustomizedCreated}
        />
      )}
    </AdminEditorPanel>
  );
}
