import { adminApiRequest } from './api-admin-client';
import { asNumber, asNullableString, unwrapPayload } from './api-payload';
import { isRecord } from './type-guards';

import type { components } from '@/types/generated/admin-api.generated';

type ApiSchemas = components['schemas'];
type ApiJobList = ApiSchemas['InboxImportJobListResponse'];
type ApiJobResponse = ApiSchemas['InboxImportJobResponse'];

export type InboxImportJobStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'succeeded_with_errors'
  | 'failed';

export type InboxImportJobSummary = {
  id: string;
  kind: string | null;
  channel: string | null;
  attachmentAssetId: string | null;
  status: InboxImportJobStatus;
  errorMessage: string | null;
  counters: Record<string, number> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function parseStatus(value: unknown): InboxImportJobStatus {
  switch (asNullableString(value)) {
    case 'processing':
    case 'succeeded':
    case 'succeeded_with_errors':
    case 'failed':
      return value as InboxImportJobStatus;
    default:
      return 'pending';
  }
}

function parseCounters(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const counters: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      counters[key] = item;
    }
  }
  return counters;
}

export function parseInboxImportJob(value: unknown): InboxImportJobSummary {
  const row = isRecord(value) ? value : {};
  return {
    id: asNullableString(row.id) ?? '',
    kind: asNullableString(row.kind),
    channel: asNullableString(row.channel),
    attachmentAssetId: asNullableString(row.attachment_asset_id),
    status: parseStatus(row.status),
    errorMessage: asNullableString(row.error_message),
    counters: parseCounters(row.counters),
    createdAt: asNullableString(row.created_at),
    updatedAt: asNullableString(row.updated_at),
  };
}

export async function listInboxImportJobs(
  endpointPath: '/v1/admin/meta/import-jobs' | '/v1/admin/whatsapp/import-jobs',
  signal?: AbortSignal
): Promise<InboxImportJobSummary[]> {
  const payload = unwrapPayload(
    await adminApiRequest<ApiJobList>({
      endpointPath,
      signal,
    })
  );
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.map(parseInboxImportJob);
}

export async function createMetaImportJob(
  channel: 'facebook' | 'instagram',
  signal?: AbortSignal
): Promise<InboxImportJobSummary> {
  const payload = unwrapPayload(
    await adminApiRequest<ApiJobResponse>({
      endpointPath: '/v1/admin/meta/import-jobs',
      method: 'POST',
      body: { channel },
      expectedSuccessStatuses: [202],
      signal,
    })
  );
  return parseInboxImportJob(payload.inbox_import_job);
}

export async function createWhatsAppExportImportJob(
  input: {
    attachmentAssetId: string;
    counterpartyWaId?: string;
    businessDisplayNames?: string[];
  },
  signal?: AbortSignal
): Promise<InboxImportJobSummary> {
  const payload = unwrapPayload(
    await adminApiRequest<ApiJobResponse>({
      endpointPath: '/v1/admin/whatsapp/import-jobs',
      method: 'POST',
      body: {
        attachment_asset_id: input.attachmentAssetId,
        counterparty_wa_id: input.counterpartyWaId || undefined,
        business_display_names: input.businessDisplayNames?.length
          ? input.businessDisplayNames
          : undefined,
      },
      expectedSuccessStatuses: [202],
      signal,
    })
  );
  return parseInboxImportJob(payload.inbox_import_job);
}

export function formatInboxImportCounters(
  counters: Record<string, number> | null
): string {
  if (!counters) {
    return '';
  }
  const stored = asNumber(counters.stored, 0);
  const duplicates = asNumber(counters.duplicates, 0);
  const skipped = asNumber(counters.skipped, 0);
  return `Stored ${stored}, duplicates ${duplicates}, skipped ${skipped}.`;
}
