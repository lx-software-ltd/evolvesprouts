'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { StatusBanner } from '@/components/status-banner';
import { DeleteIcon } from '@/components/icons/action-icons';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useServiceInstanceOptions } from '@/hooks/use-service-instance-options';
import type { useCompletionCertificates } from '@/hooks/use-completion-certificates';
import { toErrorMessage } from '@/hooks/hook-errors';
import { ADMIN_API_MAX_LIST_LIMIT } from '@/lib/admin-list-query';
import {
  getCompletionCertificatePdfDownload,
  previewCompletionCertificatePdf,
  type CompletionCertificate,
  type CompletionCertificateDraftPayload,
} from '@/lib/completion-certificates-api';
import {
  formatDate,
  formatDiscountCodeInstanceOptionLabel,
  formatServiceTitleWithTier,
  resolveEnrollmentListPartyLabel,
} from '@/lib/format';
import { isAbortRequestError, listEnrollments } from '@/lib/services-api';

import type { Enrollment, ServiceSummary } from '@/types/services';

export interface CertificatesPanelProps {
  certificates: ReturnType<typeof useCompletionCertificates>;
  serviceOptions: ServiceSummary[];
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDraftPayload(
  contactId: string,
  serviceId: string,
  instanceId: string,
  participationDate: string,
  programTitle: string,
  partnerOrganizationId: string,
): CompletionCertificateDraftPayload | null {
  if (!contactId.trim() || !serviceId.trim() || !instanceId.trim() || !participationDate.trim()) {
    return null;
  }
  return {
    contactId: contactId.trim(),
    serviceId: serviceId.trim(),
    instanceId: instanceId.trim(),
    participationDate: participationDate.trim(),
    programTitle: programTitle.trim() || null,
    partnerOrganizationId: partnerOrganizationId.trim() || null,
  };
}

export function CertificatesPanel({ certificates, serviceOptions }: CertificatesPanelProps) {
  const {
    certificates: rows,
    filters,
    setFilter,
    isLoading,
    isLoadingMore,
    isSaving,
    error,
    hasMore,
    loadMore,
    issueCertificate,
    voidCertificate,
    deleteCertificate,
  } = certificates;

  const instanceOptions = useServiceInstanceOptions();
  const { instances, isLoading: instancesLoading, loadForService } = instanceOptions;
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();

  const [contactId, setContactId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [completedEnrollments, setCompletedEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);
  const [enrollmentsError, setEnrollmentsError] = useState('');
  const [partnerOrganizationId, setPartnerOrganizationId] = useState('');
  const [programTitle, setProgramTitle] = useState('');
  const [participationDate, setParticipationDate] = useState(todayIsoDate());
  const [editorError, setEditorError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === instanceId) ?? null,
    [instances, instanceId],
  );

  const activePartners = useMemo(
    () => (selectedInstance?.partnerOrganizations ?? []).filter((p) => p.active),
    [selectedInstance],
  );

  const enrolledContactOptions = useMemo(() => {
    const emptyMaps = new Map<string, string>();
    const options: { contactId: string; label: string }[] = [];
    for (const enrollment of completedEnrollments) {
      const cid = enrollment.contactId?.trim();
      if (!cid) {
        continue;
      }
      const label = resolveEnrollmentListPartyLabel(
        enrollment,
        emptyMaps,
        emptyMaps,
        emptyMaps,
      );
      options.push({
        contactId: cid,
        label: label || cid,
      });
    }
    return options;
  }, [completedEnrollments]);

  useEffect(() => {
    if (!serviceId.trim()) {
      setInstanceId('');
      setContactId('');
      setCompletedEnrollments([]);
      setEnrollmentsError('');
      loadForService(null);
      return;
    }
    void loadForService(serviceId);
  }, [serviceId, loadForService]);

  useEffect(() => {
    const sid = serviceId.trim();
    const iid = instanceId.trim();
    if (!sid || !iid) {
      setCompletedEnrollments([]);
      setEnrollmentsError('');
      setContactId('');
      return;
    }
    setContactId('');
    let cancelled = false;
    setEnrollmentsLoading(true);
    setEnrollmentsError('');
    void (async () => {
      try {
        const page = await listEnrollments(sid, iid, { status: 'completed', limit: ADMIN_API_MAX_LIST_LIMIT });
        if (!cancelled) {
          setCompletedEnrollments(page.items);
        }
      } catch (caught) {
        if (!cancelled) {
          setCompletedEnrollments([]);
          setEnrollmentsError(
            toErrorMessage(caught, 'Failed to load completed enrollments for this instance.'),
          );
        }
      } finally {
        if (!cancelled) {
          setEnrollmentsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, instanceId]);

  useEffect(() => {
    if (!selectedInstance) {
      setPartnerOrganizationId('');
      return;
    }
    const defaultTitle =
      selectedInstance.resolvedTitle?.trim() ||
      selectedInstance.title?.trim() ||
      '';
    setProgramTitle(defaultTitle);
    if (activePartners.length === 1) {
      setPartnerOrganizationId(activePartners[0].id);
    } else if (
      partnerOrganizationId &&
      !activePartners.some((p) => p.id === partnerOrganizationId)
    ) {
      setPartnerOrganizationId('');
    }
  }, [selectedInstance, activePartners, partnerOrganizationId]);

  const draftPayload = buildDraftPayload(
    contactId,
    serviceId,
    instanceId,
    participationDate,
    programTitle,
    partnerOrganizationId,
  );

  const refreshPreview = useCallback(async () => {
    if (!draftPayload) {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    if (activePartners.length > 0 && !draftPayload.partnerOrganizationId) {
      setPreviewUrl('');
      setPreviewError('Select a partner organisation for this instance.');
      return;
    }
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const { downloadUrl } = await previewCompletionCertificatePdf(
        draftPayload,
        controller.signal,
      );
      setPreviewUrl(downloadUrl);
    } catch (caught) {
      if (isAbortRequestError(caught)) {
        return;
      }
      setPreviewUrl('');
      setPreviewError(
        toErrorMessage(caught, 'Could not render certificate preview.'),
      );
    } finally {
      if (!controller.signal.aborted) {
        setPreviewLoading(false);
      }
    }
  }, [draftPayload, activePartners.length]);

  useEffect(() => {
    if (!draftPayload) {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    const handle = setTimeout(() => {
      void refreshPreview();
    }, 500);
    return () => clearTimeout(handle);
  }, [draftPayload, refreshPreview]);

  function resetEditor() {
    setContactId('');
    setCompletedEnrollments([]);
    setEnrollmentsError('');
    setServiceId('');
    setInstanceId('');
    setPartnerOrganizationId('');
    setProgramTitle('');
    setParticipationDate(todayIsoDate());
    setEditorError('');
    setPreviewUrl('');
    setPreviewError('');
    setSelectedRowId(null);
  }

  async function handleIssue() {
    if (!draftPayload) {
      setEditorError('Service, instance, enrolled contact, and participation date are required.');
      return;
    }
    if (activePartners.length > 0 && !draftPayload.partnerOrganizationId) {
      setEditorError('Select a partner organisation.');
      return;
    }
    setEditorError('');
    try {
      await issueCertificate(draftPayload);
      resetEditor();
    } catch (caught) {
      setEditorError(toErrorMessage(caught, 'Could not issue certificate.'));
    }
  }

  async function handleDownloadRow(row: CompletionCertificate) {
    if (row.status !== 'issued') {
      return;
    }
    try {
      const { downloadUrl } = await getCompletionCertificatePdfDownload(row.id);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setEditorError(toErrorMessage(caught, 'Could not download certificate.'));
    }
  }

  async function handleVoidRow(row: CompletionCertificate) {
    const ok = await requestConfirm({
      title: 'Void certificate?',
      description: `Void the certificate for ${row.recipient_display_name}? The contact will no longer show the award badge.`,
      confirmLabel: 'Void',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await voidCertificate(row.id);
    } catch (caught) {
      setEditorError(toErrorMessage(caught, 'Could not void certificate.'));
    }
  }

  async function handleDeleteRow(row: CompletionCertificate) {
    const ok = await requestConfirm({
      title: 'Delete certificate?',
      description: `Permanently delete the certificate record for ${row.recipient_display_name}?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await deleteCertificate(row.id);
      if (selectedRowId === row.id) {
        resetEditor();
      }
    } catch (caught) {
      setEditorError(toErrorMessage(caught, 'Could not delete certificate.'));
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <ConfirmDialog {...confirmDialogProps} />
      {error ? (
        <StatusBanner variant='error' title='Certificates'>
          {error}
        </StatusBanner>
      ) : null}
      <AdminEditorCard
        title='Issue certificate'
        description='Choose service, instance, and a contact with a completed enrollment. Preview updates when the form is valid.'
        actions={
          <>
            <Button type='button' variant='secondary' onClick={() => void refreshPreview()} disabled={previewLoading}>
              Refresh preview
            </Button>
            <Button type='button' onClick={() => void handleIssue()} disabled={isSaving || !draftPayload}>
              Issue certificate
            </Button>
          </>
        }
      >
        {editorError ? (
          <StatusBanner variant='error' title='Certificate'>
            {editorError}
          </StatusBanner>
        ) : null}
        <div className='grid gap-4 md:grid-cols-3'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cert-service-id'>Service</Label>
            <Select
              id='cert-service-id'
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setInstanceId('');
                setContactId('');
              }}
            >
              <option value=''>Select service</option>
              {serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatServiceTitleWithTier(s.title, s.serviceTier)}
                </option>
              ))}
            </Select>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cert-instance-id'>Instance</Label>
            <Select
              id='cert-instance-id'
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              disabled={!serviceId || instancesLoading}
            >
              <option value=''>Select instance</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {formatDiscountCodeInstanceOptionLabel(inst)}
                </option>
              ))}
            </Select>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cert-contact-enrolled'>Contact enrolled</Label>
            <Select
              id='cert-contact-enrolled'
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={!serviceId || !instanceId || enrollmentsLoading}
            >
              <option value=''>
                {enrollmentsLoading
                  ? 'Loading enrollments…'
                  : !serviceId || !instanceId
                    ? 'Select service and instance first'
                    : enrolledContactOptions.length === 0
                      ? 'No completed contact enrollments'
                      : 'Select enrolled contact'}
              </option>
              {enrolledContactOptions.map((o) => (
                <option key={o.contactId} value={o.contactId}>
                  {o.label}
                </option>
              ))}
            </Select>
            {enrollmentsError ? (
              <p className='text-sm text-destructive'>{enrollmentsError}</p>
            ) : null}
          </div>
        </div>
        <div className='mt-4 grid gap-4 md:grid-cols-2'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cert-program-title'>Program title</Label>
            <Input
              id='cert-program-title'
              value={programTitle}
              onChange={(e) => setProgramTitle(e.target.value)}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cert-participation-date'>Participation date</Label>
            <Input
              id='cert-participation-date'
              type='date'
              value={participationDate}
              onChange={(e) => setParticipationDate(e.target.value)}
            />
          </div>
        </div>
        {activePartners.length > 0 ? (
          <div className='mt-4 flex max-w-md flex-col gap-2'>
            <Label htmlFor='cert-partner-id'>Partner</Label>
            <Select
              id='cert-partner-id'
              value={partnerOrganizationId}
              onChange={(e) => setPartnerOrganizationId(e.target.value)}
            >
              <option value=''>Select partner</option>
              {activePartners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className='mt-4 flex flex-col gap-2'>
          <p className='text-sm font-medium text-foreground'>Preview</p>
          {previewLoading ? <p className='text-sm text-muted-foreground'>Rendering preview…</p> : null}
          {previewError ? (
            <StatusBanner variant='error' title='Preview'>
              {previewError}
            </StatusBanner>
          ) : null}
          {previewUrl ? (
            <iframe
              title='Certificate preview'
              src={previewUrl}
              className='certificates-preview-frame h-[32rem] w-full rounded-md border border-border bg-muted'
            />
          ) : (
            <p className='text-sm text-muted-foreground'>
              Complete the form to see a certificate preview.
            </p>
          )}
        </div>
      </AdminEditorCard>

      <PaginatedTableCard
        title='Issued certificates'
        description='Void removes the award badge from the contact. Delete permanently removes the record.'
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        error={error}
        onLoadMore={loadMore}
        loadingLabel='Loading certificates…'
        toolbar={
          <AdminTableToolbar>
            <div className='flex flex-wrap items-end gap-3'>
              <div className='flex min-w-[10rem] flex-col gap-1'>
                <Label htmlFor='cert-filter-status'>Status</Label>
                <Select
                  id='cert-filter-status'
                  value={filters.status}
                  onChange={(e) =>
                    setFilter('status', e.target.value as typeof filters.status)
                  }
                >
                  <option value=''>All</option>
                  <option value='issued'>Issued</option>
                  <option value='voided'>Voided</option>
                </Select>
              </div>
            </div>
          </AdminTableToolbar>
        }
      >
        <AdminDataTable>
          <AdminDataTableHead>
            <AdminDataTableHeadCell>Recipient</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Program</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Instance</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Participation</AdminDataTableHeadCell>
            <AdminDataTableHeadCell>Status</AdminDataTableHeadCell>
            <AdminDataTableOperationsHeadCell />
          </AdminDataTableHead>
          <AdminDataTableBody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={selectedRowId === row.id ? 'bg-muted/50' : undefined}
                onClick={() => setSelectedRowId(row.id)}
              >
                <AdminDataTableCell>{row.recipient_display_name}</AdminDataTableCell>
                <AdminDataTableCell>{row.program_title}</AdminDataTableCell>
                <AdminDataTableCell>{row.instance_label}</AdminDataTableCell>
                <AdminDataTableCell>{formatDate(row.participation_date)}</AdminDataTableCell>
                <AdminDataTableCell>{row.status}</AdminDataTableCell>
                <AdminDataTableCell align='right'>
                  <div className='flex justify-end gap-1'>
                    {row.status === 'issued' ? (
                      <>
                        <Button
                          type='button'
                          variant='secondary'
                          size='sm'
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDownloadRow(row);
                          }}
                        >
                          Download
                        </Button>
                        <Button
                          type='button'
                          variant='secondary'
                          size='sm'
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleVoidRow(row);
                          }}
                        >
                          Void
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type='button'
                      size='sm'
                      variant='danger'
                      aria-label='Delete certificate'
                      title='Delete certificate'
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteRow(row);
                      }}
                    >
                      <DeleteIcon className='h-4 w-4' />
                    </Button>
                  </div>
                </AdminDataTableCell>
              </tr>
            ))}
          </AdminDataTableBody>
        </AdminDataTable>
      </PaginatedTableCard>
    </div>
  );
}
