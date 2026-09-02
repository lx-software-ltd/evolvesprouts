import { adminApiRequest } from '@/lib/api-admin-client';
import { buildAdminListPath } from '@/lib/admin-list-query';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];

export type CompletionCertificate = ApiSchemas['CompletionCertificate'];

export interface CompletionCertificateListParams {
  contactId?: string;
  serviceId?: string;
  instanceId?: string;
  status?: ApiSchemas['CompletionCertificateStatus'];
  limit?: number;
  cursor?: string;
}

export interface CompletionCertificateDraftPayload {
  contactId: string;
  serviceId: string;
  instanceId: string;
  participationDate: string;
  programTitle?: string | null;
  partnerOrganizationId?: string | null;
}

function toIssueBody(payload: CompletionCertificateDraftPayload): ApiSchemas['IssueCompletionCertificateRequest'] {
  return {
    contact_id: payload.contactId,
    service_id: payload.serviceId,
    instance_id: payload.instanceId,
    participation_date: payload.participationDate,
    program_title: payload.programTitle?.trim() || null,
    partner_organization_id: payload.partnerOrganizationId?.trim() || null,
  };
}

export async function listCompletionCertificates(
  params: CompletionCertificateListParams = {},
  signal?: AbortSignal,
): Promise<{
  items: CompletionCertificate[];
  nextCursor: string | null;
}> {
  const payload = await adminApiRequest<ApiSchemas['CompletionCertificateListResponse']>({
    endpointPath: buildAdminListPath('/v1/admin/completion-certificates', {
      filters: {
        contact_id: params.contactId,
        service_id: params.serviceId,
        instance_id: params.instanceId,
        status: params.status,
      },
      cursor: params.cursor,
      limit: params.limit,
    }),
    method: 'GET',
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    nextCursor: payload.next_cursor ?? null,
  };
}

export async function previewCompletionCertificatePdf(
  payload: CompletionCertificateDraftPayload,
  signal?: AbortSignal,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const body = await adminApiRequest<ApiSchemas['PdfDownloadResponse']>({
    endpointPath: '/v1/admin/completion-certificates/preview',
    method: 'POST',
    body: toIssueBody(payload),
    signal,
  });
  if (!body.downloadUrl || !body.expiresAt) {
    throw new Error('Preview response missing download URL.');
  }
  return { downloadUrl: body.downloadUrl, expiresAt: body.expiresAt };
}

export async function issueCompletionCertificate(
  payload: CompletionCertificateDraftPayload,
  signal?: AbortSignal,
): Promise<CompletionCertificate> {
  const body = await adminApiRequest<ApiSchemas['CompletionCertificateResponse']>({
    endpointPath: '/v1/admin/completion-certificates',
    method: 'POST',
    body: toIssueBody(payload),
    signal,
  });
  if (!body.certificate) {
    throw new Error('Issue response missing certificate.');
  }
  return body.certificate;
}

export async function getCompletionCertificatePdfDownload(
  id: string,
  signal?: AbortSignal,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const body = await adminApiRequest<ApiSchemas['PdfDownloadResponse']>({
    endpointPath: `/v1/admin/completion-certificates/${id}/pdf`,
    method: 'GET',
    signal,
  });
  if (!body.downloadUrl || !body.expiresAt) {
    throw new Error('PDF response missing download URL.');
  }
  return { downloadUrl: body.downloadUrl, expiresAt: body.expiresAt };
}

export async function voidCompletionCertificate(
  id: string,
  signal?: AbortSignal,
): Promise<CompletionCertificate> {
  const body = await adminApiRequest<ApiSchemas['CompletionCertificateResponse']>({
    endpointPath: `/v1/admin/completion-certificates/${id}/void`,
    method: 'POST',
    signal,
  });
  if (!body.certificate) {
    throw new Error('Void response missing certificate.');
  }
  return body.certificate;
}

export async function deleteCompletionCertificate(
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await adminApiRequest({
    endpointPath: `/v1/admin/completion-certificates/${id}`,
    method: 'DELETE',
    signal,
  });
}
