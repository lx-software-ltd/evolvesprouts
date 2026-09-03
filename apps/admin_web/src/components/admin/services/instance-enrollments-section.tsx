'use client';

import { useCallback, useMemo, useState } from 'react';

import { StatusBanner } from '@/components/status-banner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toErrorMessage } from '@/hooks/hook-errors';
import { useAutoSelectOnce } from '@/hooks/use-auto-select-once';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useEnrollmentDiscountOptions } from '@/hooks/use-enrollment-discount-options';
import { useEnrollmentList } from '@/hooks/use-enrollment-list';
import { useEnrollmentMutations } from '@/hooks/use-enrollment-mutations';
import { useEnrollmentParentPickers } from '@/hooks/use-enrollment-parent-pickers';
import { createInitialCustomerPaymentAfterEnrollmentCreate } from '@/lib/billing-api';
import {
  findEnrollmentForRelatedParty,
  relatedPartyFilterKey,
  type RelatedPartyQuery,
} from '@/lib/contact-related-links';
import { resolveEnrollmentListPartyLabel } from '@/lib/format';

import type { Enrollment } from '@/types/services';

import { EnrollmentEditorPanel } from './enrollment-editor-panel';
import { ENROLLMENT_DRAFT_ID, EnrollmentsRecordTable } from './enrollments-record-table';

export interface InstanceEnrollmentsSectionProps {
  serviceId: string;
  instanceId: string;
  /** When set (Contacts Operations deep link), expand the matching enrollment once. */
  autoSelectParty?: RelatedPartyQuery;
  /** Called after any enrollment change so the instance row can refresh its capacity. */
  onEnrollmentsChanged?: () => Promise<void> | void;
}

/**
 * Enrollments of one instance, mounted lazily inside the instance editor's
 * Enrollments disclosure. Owns the list, the parent/discount pickers, the
 * mutations (including the automatic customer payment after create), and the
 * single open enrollment row.
 */
export function InstanceEnrollmentsSection({
  serviceId,
  instanceId,
  autoSelectParty,
  onEnrollmentsChanged,
}: InstanceEnrollmentsSectionProps) {
  const list = useEnrollmentList(serviceId, instanceId);
  const pickers = useEnrollmentParentPickers(true);
  const discount = useEnrollmentDiscountOptions(serviceId, instanceId);
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customerPaymentError, setCustomerPaymentError] = useState('');

  const mutations = useEnrollmentMutations({
    onSuccess: async (detail) => {
      if (detail.operation === 'delete' && detail.enrollmentId) {
        list.removeEnrollmentFromList(detail.enrollmentId);
      } else if (detail.enrollment) {
        list.upsertEnrollmentInList(detail.enrollment);
      }
      await list.refetch();
      await onEnrollmentsChanged?.();
      if (detail.operation === 'create' && detail.enrollment) {
        try {
          setCustomerPaymentError('');
          await createInitialCustomerPaymentAfterEnrollmentCreate(detail.enrollment);
        } catch (error) {
          setCustomerPaymentError(
            toErrorMessage(
              error,
              'Enrollment was saved, but automatic customer payment failed. Record it from Finance.',
              { honorBackendMessage: true }
            )
          );
        }
      }
    },
  });

  const partyLabel = useCallback(
    (enrollment: Enrollment) =>
      resolveEnrollmentListPartyLabel(
        enrollment,
        pickers.labelByContactId,
        pickers.labelByFamilyId,
        pickers.labelByOrganizationId
      ),
    [pickers.labelByContactId, pickers.labelByFamilyId, pickers.labelByOrganizationId]
  );

  const partyFilterKey = relatedPartyFilterKey(autoSelectParty ?? {});
  const matchedEnrollment = useMemo(
    () => (autoSelectParty ? findEnrollmentForRelatedParty(list.enrollments, autoSelectParty) : null),
    [autoSelectParty, list.enrollments]
  );
  const autoSelectKey = partyFilterKey && matchedEnrollment ? `${instanceId}:${partyFilterKey}:${matchedEnrollment.id}` : '';
  const expandMatchedEnrollment = useCallback(() => {
    if (matchedEnrollment) {
      setExpandedId(matchedEnrollment.id);
    }
  }, [matchedEnrollment]);
  useAutoSelectOnce(autoSelectKey, Boolean(autoSelectKey) && !list.isLoading, expandMatchedEnrollment);

  const toggleRow = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  async function handleDelete(enrollment: Enrollment) {
    const confirmed = await requestConfirm({
      title: 'Delete enrollment',
      description: `Delete the enrollment for "${partyLabel(enrollment)}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await mutations.deleteEnrollmentEntry(serviceId, instanceId, enrollment.id);
    if (expandedId === enrollment.id) {
      setExpandedId(null);
    }
  }

  const expandedEnrollment =
    expandedId && expandedId !== ENROLLMENT_DRAFT_ID
      ? (list.enrollments.find((entry) => entry.id === expandedId) ?? null)
      : null;
  const editorMode: 'create' | 'edit' = expandedEnrollment ? 'edit' : 'create';

  const detail = (
    <EnrollmentEditorPanel
      key={expandedEnrollment?.id ?? ENROLLMENT_DRAFT_ID}
      mode={editorMode}
      enrollment={expandedEnrollment}
      pickers={pickers}
      discountOptions={discount.options}
      discountOptionsLoading={discount.isLoading}
      discountOptionsError={discount.error}
      isSaving={mutations.isLoading}
      onCreate={async (payload) => {
        await mutations.createEnrollmentEntry(serviceId, instanceId, payload);
        setExpandedId(null);
      }}
      onUpdate={(enrollmentId, payload) => mutations.updateEnrollmentEntry(serviceId, instanceId, enrollmentId, payload)}
    />
  );

  return (
    <div className='space-y-3'>
      {customerPaymentError ? (
        <StatusBanner variant='error' title='Customer payment'>
          {customerPaymentError}
        </StatusBanner>
      ) : null}
      <EnrollmentsRecordTable
        enrollments={list.enrollments}
        isLoading={list.isLoading}
        isLoadingMore={list.isLoadingMore}
        hasMore={list.hasMore}
        isMutating={mutations.isLoading}
        error={list.error || mutations.error}
        expandedId={expandedId}
        detail={detail}
        discountOptions={discount.options}
        partyLabel={partyLabel}
        onLoadMore={list.loadMore}
        onToggle={toggleRow}
        onDelete={(enrollment) => void handleDelete(enrollment)}
      />
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
