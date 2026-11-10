'use client';

import { useMemo, useState } from 'react';

import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { EnrollmentParentPickerOption } from '@/hooks/use-enrollment-parent-pickers';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import {
  formatEnumLabel,
  formatIsoForDatetimeLocalInput,
  getCurrencyOptions,
  parseDatetimeLocalToIsoUtc,
} from '@/lib/format';

import type { components } from '@/types/generated/admin-api.generated';
import type { DiscountCode, Enrollment } from '@/types/services';
import { ENROLLMENT_STATUSES } from '@/types/services';

type ApiSchemas = components['schemas'];

const ENROLLMENT_EDITOR_FORM_ID = 'enrollment-editor-form';
const EMPTY_PARENT_VALUE = '';

function sameMoney(next: string, previous: string | null | undefined): boolean {
  const left = next.trim();
  const right = (previous ?? '').trim();
  if (left === right) {
    return true;
  }
  const leftNumber = left === '' ? 0 : Number.parseFloat(left);
  const rightNumber = right === '' ? 0 : Number.parseFloat(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }
  return Math.abs(leftNumber - rightNumber) < 0.000001;
}

function sameCurrency(next: string, previous: string | null | undefined): boolean {
  return next.trim().toUpperCase() === (previous ?? '').trim().toUpperCase();
}

function ensureOption(
  options: EnrollmentParentPickerOption[],
  id: string | null | undefined,
  fallbackPrefix: string
): EnrollmentParentPickerOption[] {
  if (!id?.trim() || options.some((option) => option.id === id)) {
    return options;
  }
  return [...options, { id, label: `${fallbackPrefix} (${id})` }];
}

export interface EnrollmentEditorPickers {
  contactOptions: EnrollmentParentPickerOption[];
  families: EnrollmentParentPickerOption[];
  organizations: EnrollmentParentPickerOption[];
  loading: boolean;
  error: string;
}

export interface EnrollmentEditorPanelProps {
  mode: 'create' | 'edit';
  /** Record being edited; `null` while creating. */
  enrollment: Enrollment | null;
  pickers: EnrollmentEditorPickers;
  discountOptions: DiscountCode[];
  discountOptionsLoading: boolean;
  discountOptionsError: string;
  isSaving: boolean;
  onCreate: (payload: ApiSchemas['CreateEnrollmentRequest']) => Promise<unknown> | void;
  onUpdate: (enrollmentId: string, payload: ApiSchemas['UpdateEnrollmentRequest']) => Promise<unknown> | void;
}

/**
 * Editor rendered inside an expanded enrollment row (or the nested draft row).
 * Party pickers are chosen on create and locked afterwards, except the one
 * allowed conversion of a contact-only enrollment to a family or organisation.
 */
export function EnrollmentEditorPanel({
  mode,
  enrollment,
  pickers,
  discountOptions,
  discountOptionsLoading,
  discountOptionsError,
  isSaving,
  onCreate,
  onUpdate,
}: EnrollmentEditorPanelProps) {
  const defaultCurrencyCode = getAdminDefaultCurrencyCode();
  const currencyOptions = getCurrencyOptions();
  const isEditMode = mode === 'edit' && enrollment !== null;

  const [contactId, setContactId] = useState(enrollment?.contactId ?? '');
  const [familyId, setFamilyId] = useState(enrollment?.familyId ?? '');
  const [organizationId, setOrganizationId] = useState(enrollment?.organizationId ?? '');
  const [status, setStatus] = useState<ApiSchemas['EnrollmentStatus']>(enrollment?.status ?? 'registered');
  const [amountPaid, setAmountPaid] = useState(enrollment?.amountPaid ?? '');
  const [currency, setCurrency] = useState(enrollment?.currency ?? defaultCurrencyCode);
  const [discountCodeId, setDiscountCodeId] = useState(enrollment?.discountCodeId ?? '');
  const [notes, setNotes] = useState(enrollment?.notes ?? '');
  const [enrolledAtLocal, setEnrolledAtLocal] = useState(
    enrollment ? formatIsoForDatetimeLocalInput(enrollment.enrolledAt) : ''
  );
  const [enrolledAtError, setEnrolledAtError] = useState('');
  const [billLater, setBillLater] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('fps');
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [sendInvoiceEmail, setSendInvoiceEmail] = useState(false);

  /** Structural party is contact-only; API allows a single conversion to family or organization. */
  const canPromoteContactEnrollment = Boolean(
    isEditMode && enrollment?.contactId?.trim() && !enrollment?.familyId?.trim() && !enrollment?.organizationId?.trim()
  );

  const contactSelectOptions = useMemo(
    () => ensureOption(pickers.contactOptions, enrollment?.contactId ?? null, 'Contact'),
    [pickers.contactOptions, enrollment?.contactId]
  );
  const familySelectOptions = useMemo(
    () => ensureOption(pickers.families, enrollment?.familyId ?? null, 'Family'),
    [pickers.families, enrollment?.familyId]
  );
  const organizationSelectOptions = useMemo(
    () => ensureOption(pickers.organizations, enrollment?.organizationId ?? null, 'Organization'),
    [pickers.organizations, enrollment?.organizationId]
  );
  const discountSelectOptions = useMemo(
    () =>
      ensureOption(
        discountOptions.map((row) => ({
          id: row.id,
          label: row.description?.trim() ? `${row.code} — ${row.description.trim()}` : row.code,
        })),
        enrollment?.discountCodeId ?? null,
        'Discount'
      ),
    [discountOptions, enrollment?.discountCodeId]
  );

  const buildCreatePayload = (): ApiSchemas['CreateEnrollmentRequest'] => ({
    contact_id: contactId.trim() || null,
    family_id: familyId.trim() || null,
    organization_id: organizationId.trim() || null,
    discount_code_id: discountCodeId.trim() || null,
    status,
    amount_paid: amountPaid.trim() || null,
    currency: currency.trim() || null,
    notes: notes.trim() || null,
    bill_later: billLater,
    payment_method: paymentMethod,
    payment_received: paymentReceived,
    send_invoice_email: sendInvoiceEmail,
  });

  const buildUpdatePayload = (enrolledIso: string): ApiSchemas['UpdateEnrollmentRequest'] => {
    const base: ApiSchemas['UpdateEnrollmentRequest'] = {
      status,
      notes: notes.trim() || null,
      enrolled_at: enrolledIso,
    };
    if (!sameMoney(amountPaid, enrollment?.amountPaid)) {
      base.amount_paid = amountPaid.trim() || null;
    }
    if (!sameCurrency(currency, enrollment?.currency)) {
      base.currency = currency.trim() || null;
    }
    const nextDiscount = discountCodeId.trim() || null;
    const previousDiscount = enrollment?.discountCodeId?.trim() || null;
    if (nextDiscount !== previousDiscount) {
      base.discount_code_id = nextDiscount;
    }
    const nextFamily = familyId.trim();
    const nextOrganization = organizationId.trim();
    if (canPromoteContactEnrollment && nextFamily) {
      base.promote_to_family_id = nextFamily;
    } else if (canPromoteContactEnrollment && nextOrganization) {
      base.promote_to_organization_id = nextOrganization;
    }
    return base;
  };

  async function handleSubmit() {
    try {
      if (!isEditMode || !enrollment) {
        await onCreate(buildCreatePayload());
        return;
      }
      const enrolledIso = parseDatetimeLocalToIsoUtc(enrolledAtLocal);
      if (!enrolledIso) {
        setEnrolledAtError('Choose a valid enrolled date and time.');
        return;
      }
      setEnrolledAtError('');
      await onUpdate(enrollment.id, buildUpdatePayload(enrolledIso));
    } catch {
      // Keep the form visible so users can correct and retry.
    }
  }

  const hasParty = Boolean(contactId.trim() || familyId.trim() || organizationId.trim());
  const amountValue = Number.parseFloat(amountPaid);
  const isFreeCharge = amountPaid.trim() === '' || !Number.isFinite(amountValue) || amountValue <= 0;
  const showChargeFields = !isEditMode && !billLater && !isFreeCharge;
  const submitDisabled = isEditMode ? false : pickers.loading || !hasParty;
  const partyLocked = isEditMode && !canPromoteContactEnrollment;

  return (
    <AdminEditorPanel
      status={
        <>
          {pickers.error ? <AdminInlineError>{pickers.error}</AdminInlineError> : null}
          {discountOptionsError ? <AdminInlineError>{discountOptionsError}</AdminInlineError> : null}
        </>
      }
      actions={
        <AdminEditorActions
          mode={mode}
          formId={ENROLLMENT_EDITOR_FORM_ID}
          isSaving={isSaving}
          submitDisabled={submitDisabled}
          submitLabel={isEditMode ? 'Update enrollment' : 'Add enrollment'}
        />
      }
    >
      <form
        id={ENROLLMENT_EDITOR_FORM_ID}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <AdminFieldGrid columns={4}>
          <AdminField label='Contact' htmlFor='enrollment-contact'>
            <Select
              id='enrollment-contact'
              value={contactId || EMPTY_PARENT_VALUE}
              onChange={(event) => setContactId(event.target.value === EMPTY_PARENT_VALUE ? '' : event.target.value)}
              disabled={isEditMode || pickers.loading}
              aria-busy={pickers.loading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {contactSelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Family' htmlFor='enrollment-family'>
            <Select
              id='enrollment-family'
              value={familyId || EMPTY_PARENT_VALUE}
              onChange={(event) => {
                const resolved = event.target.value === EMPTY_PARENT_VALUE ? '' : event.target.value;
                setFamilyId(resolved);
                if (resolved.trim()) {
                  setOrganizationId('');
                }
              }}
              disabled={pickers.loading || partyLocked}
              aria-busy={pickers.loading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {familySelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Organization' htmlFor='enrollment-organization'>
            <Select
              id='enrollment-organization'
              value={organizationId || EMPTY_PARENT_VALUE}
              onChange={(event) => {
                const resolved = event.target.value === EMPTY_PARENT_VALUE ? '' : event.target.value;
                setOrganizationId(resolved);
                if (resolved.trim()) {
                  setFamilyId('');
                }
              }}
              disabled={pickers.loading || partyLocked}
              aria-busy={pickers.loading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {organizationSelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField
            label='Enrolled at'
            htmlFor='enrollment-enrolled-at'
            error={enrolledAtError || undefined}
            hint={isEditMode ? undefined : 'Set automatically when the enrollment is created.'}
          >
            <Input
              id='enrollment-enrolled-at'
              type='datetime-local'
              value={isEditMode ? enrolledAtLocal : ''}
              onChange={(event) => setEnrolledAtLocal(event.target.value)}
              disabled={!isEditMode || isSaving}
            />
          </AdminField>
        </AdminFieldGrid>
        <p className='text-xs text-slate-500'>
          {canPromoteContactEnrollment
            ? 'This enrollment is contact-only. You may convert it once to a family or organization using the Family or Organization field (not both). The contact cannot be changed here.'
            : 'Contact, family, and organization are chosen when creating an enrollment and cannot be changed afterward (except converting a contact-only enrollment once).'}
        </p>
        <AdminFieldGrid columns={4}>
          <AdminField label='Status' htmlFor='enrollment-status'>
            <Select
              id='enrollment-status'
              value={status}
              onChange={(event) => setStatus(event.target.value as ApiSchemas['EnrollmentStatus'])}
            >
              {ENROLLMENT_STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {formatEnumLabel(entry)}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Amount paid' htmlFor='enrollment-amount'>
            <Input
              id='enrollment-amount'
              value={amountPaid}
              inputMode='decimal'
              onChange={(event) => setAmountPaid(event.target.value)}
            />
          </AdminField>
          <AdminField label='Currency' htmlFor='enrollment-currency'>
            <Select id='enrollment-currency' value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField label='Discount code' htmlFor='enrollment-discount'>
            <Select
              id='enrollment-discount'
              value={discountCodeId || EMPTY_PARENT_VALUE}
              onChange={(event) =>
                setDiscountCodeId(event.target.value === EMPTY_PARENT_VALUE ? '' : event.target.value)
              }
              disabled={discountOptionsLoading}
              aria-busy={discountOptionsLoading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {discountSelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </AdminField>
        </AdminFieldGrid>
        {isEditMode && enrollment ? (
          <AdminFieldGrid columns={2}>
            <AdminField label='Invoice' htmlFor='enrollment-invoice'>
              <Input
                id='enrollment-invoice'
                value={
                  enrollment.invoiceNumber ??
                  (enrollment.invoiceStatus ? formatEnumLabel(enrollment.invoiceStatus) : '—')
                }
                readOnly
              />
            </AdminField>
            <AdminField label='Payment' htmlFor='enrollment-payment'>
              <Input
                id='enrollment-payment'
                value={enrollment.paymentStatus ? formatEnumLabel(enrollment.paymentStatus) : '—'}
                readOnly
              />
            </AdminField>
          </AdminFieldGrid>
        ) : null}
        {showChargeFields ? (
          <AdminFieldGrid columns={2}>
            <AdminField label='Payment method' htmlFor='enrollment-payment-method'>
              <Select
                id='enrollment-payment-method'
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value='fps'>FPS</option>
                <option value='bank_transfer'>Bank transfer</option>
                <option value='cash'>Cash</option>
                <option value='cheque'>Cheque</option>
              </Select>
            </AdminField>
            <AdminField label='Payment received' htmlFor='enrollment-payment-received'>
              <div className='flex h-10 items-center gap-2'>
                <input
                  id='enrollment-payment-received'
                  type='checkbox'
                  className='h-4 w-4 rounded border-slate-300 text-slate-900'
                  checked={paymentReceived}
                  onChange={(event) => setPaymentReceived(event.target.checked)}
                />
                <label htmlFor='enrollment-payment-received' className='text-sm text-slate-700'>
                  Money is already received
                </label>
              </div>
            </AdminField>
          </AdminFieldGrid>
        ) : null}
        {!isEditMode ? (
          <AdminFieldGrid columns={2}>
            <AdminField label='Bill later' htmlFor='enrollment-bill-later'>
              <div className='flex h-10 items-center gap-2'>
                <input
                  id='enrollment-bill-later'
                  type='checkbox'
                  className='h-4 w-4 rounded border-slate-300 text-slate-900'
                  checked={billLater}
                  onChange={(event) => setBillLater(event.target.checked)}
                />
                <label htmlFor='enrollment-bill-later' className='text-sm text-slate-700'>
                  Merge this onto an invoice later
                </label>
              </div>
            </AdminField>
            {showChargeFields ? (
              <AdminField label='Email invoice' htmlFor='enrollment-email-invoice'>
                <div className='flex h-10 items-center gap-2'>
                  <input
                    id='enrollment-email-invoice'
                    type='checkbox'
                    className='h-4 w-4 rounded border-slate-300 text-slate-900'
                    checked={sendInvoiceEmail}
                    onChange={(event) => setSendInvoiceEmail(event.target.checked)}
                  />
                  <label htmlFor='enrollment-email-invoice' className='text-sm text-slate-700'>
                    Email the invoice when it is issued
                  </label>
                </div>
              </AdminField>
            ) : null}
          </AdminFieldGrid>
        ) : null}
        <AdminFieldGrid columns={1}>
          <AdminField label='Notes' htmlFor='enrollment-notes'>
            <Textarea id='enrollment-notes' value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </AdminField>
        </AdminFieldGrid>
      </form>
    </AdminEditorPanel>
  );
}
