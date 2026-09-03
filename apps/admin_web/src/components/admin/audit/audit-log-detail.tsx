'use client';

import { ActionBadge, SourceBadge } from '@/components/admin/audit/audit-log-badges';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminReadOnlyValue as Value } from '@/components/ui/admin-read-only-value';
import { formatDate } from '@/lib/format';

import type { components } from '@/types/generated/admin-api.generated';

type AuditLog = components['schemas']['AuditLog'];

function formatJson(obj: Record<string, unknown> | null | undefined): string {
  return obj ? JSON.stringify(obj, null, 2) : '—';
}

/** Full audit row payload, rendered inside the expanded log row. */
export function AuditLogDetail({ log }: { log: AuditLog }) {
  const actorLabel = log.user_email || log.user_id || null;

  return (
    <AdminEditorPanel>
      <AdminFieldGrid columns={4}>
        <Value label='Timestamp'>{formatDate(log.timestamp)}</Value>
        <Value label='Table'>{log.table_name}</Value>
        <Value label='Action'>
          <ActionBadge action={log.action} />
        </Value>
        <Value label='Source'>
          <SourceBadge source={log.source} />
        </Value>
        <Value label='Record ID' mono>
          {log.record_id}
        </Value>
        <Value label='Log ID' mono>
          {log.id}
        </Value>
        <Value label='Actor' mono>
          {actorLabel || '—'}
        </Value>
        <Value label='Request ID' mono>
          {log.request_id || '—'}
        </Value>
      </AdminFieldGrid>

      {log.changed_fields && log.changed_fields.length > 0 ? (
        <Value label='Changed fields'>
          <div className='flex flex-wrap gap-1'>
            {log.changed_fields.map((field) => (
              <span key={field} className='rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700'>
                {field}
              </span>
            ))}
          </div>
        </Value>
      ) : null}

      <AdminFieldGrid columns={2}>
        {log.old_values && Object.keys(log.old_values).length > 0 ? (
          <Value label='Old values'>
            <pre className='max-h-60 overflow-auto rounded bg-red-50 p-3 text-xs text-red-900'>
              {formatJson(log.old_values as Record<string, unknown>)}
            </pre>
          </Value>
        ) : null}
        {log.new_values && Object.keys(log.new_values).length > 0 ? (
          <Value label='New values'>
            <pre className='max-h-60 overflow-auto rounded bg-green-50 p-3 text-xs text-green-900'>
              {formatJson(log.new_values as Record<string, unknown>)}
            </pre>
          </Value>
        ) : null}
      </AdminFieldGrid>

      {log.ip_address || log.user_agent ? (
        <Value label='Client'>
          {log.ip_address ? <p>IP: {log.ip_address}</p> : null}
          {log.user_agent ? <p className='wrap-anywhere text-xs text-slate-500'>{log.user_agent}</p> : null}
        </Value>
      ) : null}
    </AdminEditorPanel>
  );
}
