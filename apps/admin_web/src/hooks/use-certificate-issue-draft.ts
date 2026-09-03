'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toErrorMessage } from '@/hooks/hook-errors';
import { useServiceInstanceOptions } from '@/hooks/use-service-instance-options';
import { ADMIN_API_MAX_LIST_LIMIT } from '@/lib/admin-list-query';
import {
  previewCompletionCertificatePdf,
  type CompletionCertificateDraftPayload,
} from '@/lib/completion-certificates-api';
import { resolveEnrollmentListPartyLabel } from '@/lib/format';
import { isAbortRequestError, listEnrollments } from '@/lib/services-api';
import type { Enrollment } from '@/types/services';

const PREVIEW_DEBOUNCE_MS = 500;

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
  partnerOrganizationId: string
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

export interface UseCertificateIssueDraftInput {
  /** Wrap field setters so the owning row hook can flag unsaved changes. */
  track: <TValue>(setter: (value: TValue) => void) => (value: TValue) => void;
  issueCertificate: (payload: CompletionCertificateDraftPayload) => Promise<unknown>;
  /** Called after a successful issue so the caller can collapse the draft row. */
  onIssued: () => void;
}

/**
 * Draft state for issuing a completion certificate: service → instance →
 * completed enrollment cascade, partner defaulting, and a debounced PDF
 * preview that re-renders whenever the draft becomes valid.
 */
export function useCertificateIssueDraft({ track, issueCertificate, onIssued }: UseCertificateIssueDraftInput) {
  const instanceOptions = useServiceInstanceOptions();
  const { instances, isLoading: instancesLoading, loadForService } = instanceOptions;

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
  const previewAbortRef = useRef<AbortController | null>(null);

  const selectedInstance = useMemo(() => instances.find((i) => i.id === instanceId) ?? null, [instances, instanceId]);

  const activePartners = useMemo(
    () => (selectedInstance?.partnerOrganizations ?? []).filter((p) => p.active),
    [selectedInstance]
  );

  const enrolledContactOptions = useMemo(() => {
    const emptyMaps = new Map<string, string>();
    const options: { contactId: string; label: string }[] = [];
    for (const enrollment of completedEnrollments) {
      const cid = enrollment.contactId?.trim();
      if (!cid) {
        continue;
      }
      const label = resolveEnrollmentListPartyLabel(enrollment, emptyMaps, emptyMaps, emptyMaps);
      options.push({ contactId: cid, label: label || cid });
    }
    return options;
  }, [completedEnrollments]);

  useEffect(() => {
    if (!serviceId.trim()) {
      setInstanceId('');
      setContactId('');
      setCompletedEnrollments([]);
      setEnrollmentsError('');
      void loadForService(null);
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
          setEnrollmentsError(toErrorMessage(caught, 'Failed to load completed enrollments for this instance.'));
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
    const defaultTitle = selectedInstance.resolvedTitle?.trim() || selectedInstance.title?.trim() || '';
    setProgramTitle(defaultTitle);
    if (activePartners.length === 1) {
      setPartnerOrganizationId(activePartners[0].id);
    } else if (partnerOrganizationId && !activePartners.some((p) => p.id === partnerOrganizationId)) {
      setPartnerOrganizationId('');
    }
  }, [selectedInstance, activePartners, partnerOrganizationId]);

  const draftPayload = buildDraftPayload(
    contactId,
    serviceId,
    instanceId,
    participationDate,
    programTitle,
    partnerOrganizationId
  );
  const partnerRequired = activePartners.length > 0;

  const refreshPreview = useCallback(async () => {
    if (!draftPayload) {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    if (partnerRequired && !draftPayload.partnerOrganizationId) {
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
      const { downloadUrl } = await previewCompletionCertificatePdf(draftPayload, controller.signal);
      setPreviewUrl(downloadUrl);
    } catch (caught) {
      if (isAbortRequestError(caught)) {
        return;
      }
      setPreviewUrl('');
      setPreviewError(toErrorMessage(caught, 'Could not render certificate preview.'));
    } finally {
      if (!controller.signal.aborted) {
        setPreviewLoading(false);
      }
    }
  }, [draftPayload, partnerRequired]);

  useEffect(() => {
    if (!draftPayload) {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    const handle = setTimeout(() => {
      void refreshPreview();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draftPayload, refreshPreview]);

  const reset = useCallback(() => {
    previewAbortRef.current?.abort();
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
    setPreviewLoading(false);
    setPreviewError('');
  }, []);

  async function handleIssue(): Promise<void> {
    if (!draftPayload) {
      setEditorError('Service, instance, enrolled contact, and participation date are required.');
      return;
    }
    if (partnerRequired && !draftPayload.partnerOrganizationId) {
      setEditorError('Select a partner organisation.');
      return;
    }
    setEditorError('');
    try {
      await issueCertificate(draftPayload);
      onIssued();
    } catch (caught) {
      setEditorError(toErrorMessage(caught, 'Could not issue certificate.'));
    }
  }

  return {
    instances,
    instancesLoading,
    enrolledContactOptions,
    enrollmentsLoading,
    enrollmentsError,
    activePartners,
    partnerRequired,
    draftPayload,
    editorError,
    previewUrl,
    previewLoading,
    previewError,
    refreshPreview,
    reset,
    handleIssue,
    fields: {
      serviceId,
      setServiceId: track((value: string) => {
        setServiceId(value);
        setInstanceId('');
        setContactId('');
      }),
      instanceId,
      setInstanceId: track(setInstanceId),
      contactId,
      setContactId: track(setContactId),
      programTitle,
      setProgramTitle: track(setProgramTitle),
      participationDate,
      setParticipationDate: track(setParticipationDate),
      partnerOrganizationId,
      setPartnerOrganizationId: track(setPartnerOrganizationId),
    },
  };
}
