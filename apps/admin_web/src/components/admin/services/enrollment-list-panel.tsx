'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AdminDataTable,
  AdminDataTableBody,
  AdminDataTableCell,
  AdminDataTableHead,
  AdminDataTableHeadCell,
  AdminDataTableOperationsHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DeleteIcon } from '@/components/icons/action-icons';
import { useAutoSelectOnce } from '@/hooks/use-auto-select-once';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useEnrollmentParentPickers } from '@/hooks/use-enrollment-parent-pickers';
import { getAdminDefaultCurrencyCode } from '@/lib/config';
import {
  findEnrollmentForRelatedParty,
  relatedPartyFilterKey,
  type RelatedPartyQuery,
} from '@/lib/contact-related-links';
import {
  formatDate,
  formatEnumLabel,
  formatIsoForDatetimeLocalInput,
  getCurrencyOptions,
  parseDatetimeLocalToIsoUtc,
  resolveEnrollmentListPartyLabel,
} from '@/lib/format';
import { isAbortRequestError, listEnrollmentDiscountOptions } from '@/lib/services-api';
import { formatAmountInCurrency } from '@/lib/vendor-spend';

import type { components } from '@/types/generated/admin-api.generated';
import type { DiscountCode, Enrollment } from '@/types/services';
import { ENROLLMENT_STATUSES } from '@/types/services';

type ApiSchemas = components['schemas'];

const EMPTY_PARENT_VALUE = '';

function ensureOption(
  options: { id: string; label: string }[],
  id: string | null | undefined,
  fallbackPrefix: string
): { id: string; label: string }[] {
  if (!id?.trim()) {
    return options;
  }
  if (options.some((o) => o.id === id)) {
    return options;
  }
  return [...options, { id, label: `${fallbackPrefix} (${id})` }];
}

export interface EnrollmentListPanelProps {
  enrollments: Enrollment[];
  /** Required to load instance-eligible discount codes for the picker. */
  serviceId: string | null;
  instanceId: string | null;
  canCreate: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  isMutating: boolean;
  onLoadMore: () => Promise<void> | void;
  onCreate: (payload: ApiSchemas['CreateEnrollmentRequest']) => Promise<void> | void;
  onUpdate: (
    enrollmentId: string,
    payload: ApiSchemas['UpdateEnrollmentRequest']
  ) => Promise<void> | void;
  onDelete: (enrollmentId: string) => Promise<void> | void;
  /** When set (Contacts Operations deep link), select the matching enrollment once. */
  autoSelectParty?: RelatedPartyQuery;
}

export function EnrollmentListPanel({
  enrollments,
  serviceId,
  instanceId,
  canCreate,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  isMutating,
  onLoadMore,
  onCreate,
  onUpdate,
  onDelete,
  autoSelectParty,
}: EnrollmentListPanelProps) {
  const defaultCurrencyCode = getAdminDefaultCurrencyCode();
  const currencyOptions = getCurrencyOptions();
  const {
    contactOptions,
    families,
    organizations,
    loading: parentPickersLoading,
    error: parentPickersError,
    labelByContactId,
    labelByFamilyId,
    labelByOrganizationId,
  } = useEnrollmentParentPickers(canCreate);
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string | null>(null);
  const [contactId, setContactId] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [status, setStatus] = useState<ApiSchemas['EnrollmentStatus']>('registered');
  const [amountPaid, setAmountPaid] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [discountCodeId, setDiscountCodeId] = useState('');
  const [discountOptions, setDiscountOptions] = useState<DiscountCode[]>([]);
  const [discountOptionsLoading, setDiscountOptionsLoading] = useState(false);
  const [discountOptionsError, setDiscountOptionsError] = useState('');
  const [notes, setNotes] = useState('');
  const [enrolledAtLocal, setEnrolledAtLocal] = useState('');
  const [enrolledAtError, setEnrolledAtError] = useState('');

  const selectedEnrollment = useMemo(
    () => enrollments.find((entry) => entry.id === selectedEnrollmentId) ?? null,
    [enrollments, selectedEnrollmentId]
  );
  const isEditMode = Boolean(selectedEnrollment);

  /** Structural party is contact-only; API allows a single conversion to family or organization. */
  const canPromoteContactEnrollment = Boolean(
    selectedEnrollment?.contactId?.trim() &&
      !selectedEnrollment?.familyId?.trim() &&
      !selectedEnrollment?.organizationId?.trim()
  );

  const contactSelectOptions = useMemo(
    () => ensureOption(contactOptions, selectedEnrollment?.contactId ?? null, 'Contact'),
    [contactOptions, selectedEnrollment?.contactId]
  );
  const familySelectOptions = useMemo(
    () => ensureOption(families, selectedEnrollment?.familyId ?? null, 'Family'),
    [families, selectedEnrollment?.familyId]
  );
  const organizationSelectOptions = useMemo(
    () => ensureOption(organizations, selectedEnrollment?.organizationId ?? null, 'Organization'),
    [organizations, selectedEnrollment?.organizationId]
  );

  const loadDiscountOptions = useCallback(async () => {
    if (!serviceId?.trim() || !instanceId?.trim()) {
      setDiscountOptions([]);
      setDiscountOptionsError('');
      setDiscountOptionsLoading(false);
      return;
    }
    setDiscountOptionsLoading(true);
    setDiscountOptionsError('');
    try {
      const rows = await listEnrollmentDiscountOptions(serviceId.trim(), instanceId.trim());
      setDiscountOptions(rows);
    } catch (err) {
      if (isAbortRequestError(err)) {
        return;
      }
      setDiscountOptions([]);
      setDiscountOptionsError(err instanceof Error ? err.message : 'Failed to load discount codes');
    } finally {
      setDiscountOptionsLoading(false);
    }
  }, [serviceId, instanceId]);

  useEffect(() => {
    void loadDiscountOptions();
  }, [loadDiscountOptions]);

  const discountSelectOptions = useMemo(
    () =>
      ensureOption(
        discountOptions.map((row) => ({
          id: row.id,
          label: row.description?.trim() ? `${row.code} — ${row.description.trim()}` : row.code,
        })),
        selectedEnrollment?.discountCodeId ?? null,
        'Discount'
      ),
    [discountOptions, selectedEnrollment?.discountCodeId]
  );

  const formatEnrollmentParentCell = useCallback(
    (enrollment: Enrollment) =>
      resolveEnrollmentListPartyLabel(
        enrollment,
        labelByContactId,
        labelByFamilyId,
        labelByOrganizationId
      ),
    [labelByContactId, labelByFamilyId, labelByOrganizationId]
  );

  const resetCreateForm = () => {
    setSelectedEnrollmentId(null);
    setContactId('');
    setFamilyId('');
    setOrganizationId('');
    setStatus('registered');
    setAmountPaid('');
    setCurrency('HKD');
    setDiscountCodeId('');
    setNotes('');
    setEnrolledAtLocal('');
    setEnrolledAtError('');
  };

  const buildCreatePayload = (): ApiSchemas['CreateEnrollmentRequest'] => ({
    contact_id: contactId.trim() || null,
    family_id: familyId.trim() || null,
    organization_id: organizationId.trim() || null,
    discount_code_id: discountCodeId.trim() || null,
    status,
    amount_paid: amountPaid.trim() || null,
    currency: currency.trim() || null,
    notes: notes.trim() || null,
  });

  const buildUpdatePayload = (): ApiSchemas['UpdateEnrollmentRequest'] => {
    const enrolledIso = parseDatetimeLocalToIsoUtc(enrolledAtLocal);
    const base: ApiSchemas['UpdateEnrollmentRequest'] = {
      status,
      amount_paid: amountPaid.trim() || null,
      currency: currency.trim() || null,
      notes: notes.trim() || null,
    };
    if (enrolledIso) {
      base.enrolled_at = enrolledIso;
    }
    const nextDiscount = discountCodeId.trim() || null;
    const prev = selectedEnrollment?.discountCodeId?.trim() || null;
    if (nextDiscount !== prev) {
      base.discount_code_id = nextDiscount;
    }
    const nextFamily = familyId.trim();
    const nextOrg = organizationId.trim();
    if (canPromoteContactEnrollment && nextFamily) {
      base.promote_to_family_id = nextFamily;
    } else if (canPromoteContactEnrollment && nextOrg) {
      base.promote_to_organization_id = nextOrg;
    }
    return base;
  };

  const handleSave = async () => {
    try {
      if (!isEditMode) {
        await onCreate(buildCreatePayload());
        resetCreateForm();
        return;
      }
      if (!selectedEnrollment) {
        return;
      }
      const enrolledIso = parseDatetimeLocalToIsoUtc(enrolledAtLocal);
      if (!enrolledIso) {
        setEnrolledAtError('Choose a valid enrolled date and time.');
        return;
      }
      setEnrolledAtError('');
      await onUpdate(selectedEnrollment.id, buildUpdatePayload());
    } catch {
      // Keep inline form state visible to let users retry.
    }
  };

  const applyEnrollmentSelection = (enrollment: Enrollment) => {
    setSelectedEnrollmentId(enrollment.id);
    setContactId(enrollment.contactId ?? '');
    setFamilyId(enrollment.familyId ?? '');
    setOrganizationId(enrollment.organizationId ?? '');
    setStatus(enrollment.status);
    setAmountPaid(enrollment.amountPaid ?? '');
    setCurrency(enrollment.currency ?? 'HKD');
    setDiscountCodeId(enrollment.discountCodeId ?? '');
    setNotes(enrollment.notes ?? '');
    setEnrolledAtLocal(formatIsoForDatetimeLocalInput(enrollment.enrolledAt));
    setEnrolledAtError('');
  };

  const partyFilterKey = relatedPartyFilterKey(autoSelectParty ?? {});
  const matchedEnrollment = useMemo(
    () => (autoSelectParty ? findEnrollmentForRelatedParty(enrollments, autoSelectParty) : null),
    [autoSelectParty, enrollments]
  );
  const autoSelectKey =
    instanceId && partyFilterKey && matchedEnrollment
      ? `${instanceId}:${partyFilterKey}:${matchedEnrollment.id}`
      : '';
  useAutoSelectOnce(autoSelectKey, Boolean(autoSelectKey) && !isLoading, () => {
    if (matchedEnrollment) {
      applyEnrollmentSelection(matchedEnrollment);
    }
  });

  const handleDeleteEnrollment = async (enrollment: Enrollment) => {
    const confirmed = await requestConfirm({
      title: 'Delete enrollment',
      description: `Delete enrollment "${enrollment.id}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await onDelete(enrollment.id);
    if (selectedEnrollmentId === enrollment.id) {
      resetCreateForm();
    }
  };

  return (
    <>
      <AdminEditorCard
        title='Enrollment'
        description='Add or update an enrollment using the same fields below.'
        actions={
          <>
            {isEditMode ? (
              <Button type='button' variant='secondary' disabled={isMutating} onClick={resetCreateForm}>
                Cancel
              </Button>
            ) : null}
            {isEditMode ? (
              <Button
                type='button'
                disabled={!selectedEnrollment}
                loading={isMutating}
                onClick={() => void handleSave()}
              >
                Update enrollment
              </Button>
            ) : (
              <Button
                type='button'
                disabled={
                  !canCreate ||
                  isMutating ||
                  parentPickersLoading ||
                  (!contactId.trim() && !familyId.trim() && !organizationId.trim())
                }
                onClick={() => void handleSave()}
              >
                {isMutating ? 'Adding...' : 'Add enrollment'}
              </Button>
            )}
          </>
        }
      >
        {!canCreate ? (
          <p className='text-xs text-slate-500'>
            Select a service and instance before creating or editing enrollments.
          </p>
        ) : null}
        {canCreate && parentPickersError ? (
          <p className='text-xs text-red-600' role='alert'>
            {parentPickersError}
          </p>
        ) : null}
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-4'>
          <div>
            <Label htmlFor='enrollment-contact'>Contact</Label>
            <Select
              id='enrollment-contact'
              value={contactId || EMPTY_PARENT_VALUE}
              onChange={(event) => {
                const next = event.target.value;
                setContactId(next === EMPTY_PARENT_VALUE ? '' : next);
              }}
              disabled={isEditMode || parentPickersLoading}
              aria-busy={parentPickersLoading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {contactSelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='enrollment-family'>Family</Label>
            <Select
              id='enrollment-family'
              value={familyId || EMPTY_PARENT_VALUE}
              onChange={(event) => {
                const next = event.target.value;
                const resolved = next === EMPTY_PARENT_VALUE ? '' : next;
                setFamilyId(resolved);
                if (resolved.trim()) {
                  setOrganizationId('');
                }
              }}
              disabled={
                parentPickersLoading || (isEditMode && !canPromoteContactEnrollment)
              }
              aria-busy={parentPickersLoading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {familySelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='enrollment-organization'>Organization</Label>
            <Select
              id='enrollment-organization'
              value={organizationId || EMPTY_PARENT_VALUE}
              onChange={(event) => {
                const next = event.target.value;
                const resolved = next === EMPTY_PARENT_VALUE ? '' : next;
                setOrganizationId(resolved);
                if (resolved.trim()) {
                  setFamilyId('');
                }
              }}
              disabled={
                parentPickersLoading || (isEditMode && !canPromoteContactEnrollment)
              }
              aria-busy={parentPickersLoading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {organizationSelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='enrollment-enrolled-at'>Enrolled at</Label>
            <Input
              id='enrollment-enrolled-at'
              type='datetime-local'
              value={isEditMode ? enrolledAtLocal : ''}
              onChange={(event) => setEnrolledAtLocal(event.target.value)}
              disabled={!isEditMode || !canCreate || isMutating}
            />
          </div>
        </div>
        {enrolledAtError ? (
          <p className='text-xs text-red-600' role='alert'>
            {enrolledAtError}
          </p>
        ) : null}
        <p className='text-xs text-slate-500'>
          {canPromoteContactEnrollment ? (
            <>
              This enrollment is contact-only. You may convert it once to family or organization using the
              Family or Organization field (not both). Contact cannot be changed here. Enrolled at can be
              edited when updating.
            </>
          ) : (
            <>
              Contact, family, and organization are chosen when creating an enrollment and cannot be changed
              afterward (except converting a contact-only enrollment once). Enrolled at can be edited when
              updating an enrollment.
            </>
          )}
        </p>
        {canCreate && discountOptionsError ? (
          <p className='text-xs text-red-600' role='alert'>
            {discountOptionsError}
          </p>
        ) : null}
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          <div>
            <Label htmlFor='enrollment-status'>Status</Label>
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
          </div>
          <div>
            <Label htmlFor='enrollment-amount'>Amount paid</Label>
            <Input id='enrollment-amount' value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} />
          </div>
          <div>
            <Label htmlFor='enrollment-currency'>Currency</Label>
            <Select
              id='enrollment-currency'
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor='enrollment-discount'>Discount code</Label>
            <Select
              id='enrollment-discount'
              value={discountCodeId || EMPTY_PARENT_VALUE}
              onChange={(event) => {
                const next = event.target.value;
                setDiscountCodeId(next === EMPTY_PARENT_VALUE ? '' : next);
              }}
              disabled={!canCreate || discountOptionsLoading}
              aria-busy={discountOptionsLoading}
            >
              <option value={EMPTY_PARENT_VALUE}>None</option>
              {discountSelectOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor='enrollment-notes'>Notes</Label>
          <Textarea id='enrollment-notes' value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </div>
      </AdminEditorCard>

      <PaginatedTableCard
        title='Enrollments'
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        loadingLabel='Loading enrollments...'
        onLoadMore={onLoadMore}
      >
        <AdminDataTable tableClassName='w-full table-fixed'>
          <AdminDataTableHead>
            <tr>
              <AdminDataTableHeadCell>Party</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Amount</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Discount</AdminDataTableHeadCell>
              <AdminDataTableHeadCell>Enrolled at</AdminDataTableHeadCell>
              <AdminDataTableOperationsHeadCell />
            </tr>
          </AdminDataTableHead>
          <AdminDataTableBody>
            {enrollments.map((enrollment) => {
              const amountRaw = enrollment.amountPaid?.trim() ?? '';
              const parsedAmount = Number.parseFloat(amountRaw);
              const currencyCode =
                (enrollment.currency ?? defaultCurrencyCode).trim().toUpperCase() || defaultCurrencyCode;
              const amountDisplay =
                amountRaw !== '' && Number.isFinite(parsedAmount)
                  ? formatAmountInCurrency(parsedAmount, currencyCode)
                  : '—';
              return (
                <tr
                  key={enrollment.id}
                  className={`cursor-pointer transition ${
                    selectedEnrollmentId === enrollment.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => applyEnrollmentSelection(enrollment)}
                >
                  <AdminDataTableCell>{formatEnrollmentParentCell(enrollment)}</AdminDataTableCell>
                  <AdminDataTableCell>{formatEnumLabel(enrollment.status)}</AdminDataTableCell>
                  <AdminDataTableCell>{amountDisplay}</AdminDataTableCell>
                  <AdminDataTableCell>
                    {enrollment.discountCodeId
                      ? (discountOptions.find((c) => c.id === enrollment.discountCodeId)?.code ??
                          enrollment.discountCodeId)
                      : '-'}
                  </AdminDataTableCell>
                  <AdminDataTableCell>{formatDate(enrollment.enrolledAt)}</AdminDataTableCell>
                  <AdminDataTableCell className='whitespace-nowrap text-right'>
                    <div className='flex justify-end gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='danger'
                        disabled={isMutating}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteEnrollment(enrollment);
                        }}
                        aria-label='Delete enrollment'
                        title='Delete enrollment'
                      >
                        <DeleteIcon className='h-4 w-4' />
                      </Button>
                    </div>
                  </AdminDataTableCell>
                </tr>
              );
            })}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
