import type { components } from '@/types/generated/admin-api.generated';

export const AUDITABLE_AUDIT_LOG_TABLES = [
  'api_keys',
  'assets',
  'asset_access_grants',
  'calendar_manual_blocks',
] as const;

export type AuditLogsFilters = {
  table?: string;
  record_id?: string;
  user_id?: string;
  email?: string;
  action?: components['schemas']['AuditLog']['action'];
  since?: string;
};
