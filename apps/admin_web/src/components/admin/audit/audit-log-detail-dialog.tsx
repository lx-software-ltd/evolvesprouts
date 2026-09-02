'use client';

import { ActionBadge, SourceBadge } from '@/components/admin/audit/audit-log-badges';
import { AdminDialog } from '@/components/ui/admin-dialog';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

import type { components } from '@/types/generated/admin-api.generated';

type AuditLog = components['schemas']['AuditLog'];

interface AuditLogDetailDialogProps {
  log: AuditLog;
  onClose: () => void;
}

function formatJson(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) {
    return '—';
  }
  return JSON.stringify(obj, null, 2);
}

export function AuditLogDetailDialog({ log, onClose }: AuditLogDetailDialogProps) {
  const actorLabel = log.user_email || log.user_id || null;

  return (
    <AdminDialog
      open
      title='Audit log detail'
      description='Full row payload including old and new values when present.'
      dialogRole='dialog'
      contentClassName='w-full max-w-3xl'
      onClose={onClose}
      footer={
        <div className='flex justify-end'>
          <Button type='button' variant='primary' onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className='max-h-[min(70vh,32rem)] space-y-4 overflow-y-auto pr-1'>
        <div className='grid grid-cols-2 gap-4 text-sm'>
          <div>
            <span className='font-medium text-slate-500'>ID</span>
            <p className='mt-1 break-all font-mono text-xs'>{log.id}</p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Timestamp</span>
            <p className='mt-1'>{formatDate(log.timestamp)}</p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Table</span>
            <p className='mt-1'>{log.table_name}</p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Record ID</span>
            <p className='mt-1 break-all font-mono text-xs'>{log.record_id}</p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Action</span>
            <p className='mt-1'>
              <ActionBadge action={log.action} />
            </p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Source</span>
            <p className='mt-1'>
              <SourceBadge source={log.source} />
            </p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Actor</span>
            <p className='mt-1 break-all font-mono text-xs'>{actorLabel || '—'}</p>
          </div>
          <div>
            <span className='font-medium text-slate-500'>Request ID</span>
            <p className='mt-1 break-all font-mono text-xs'>{log.request_id || '—'}</p>
          </div>
        </div>

        {log.changed_fields && log.changed_fields.length > 0 ? (
          <div>
            <span className='font-medium text-slate-500'>Changed fields</span>
            <div className='mt-1 flex flex-wrap gap-1'>
              {log.changed_fields.map((field) => (
                <span
                  key={field}
                  className='rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700'
                >
                  {field}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {log.old_values && Object.keys(log.old_values).length > 0 ? (
          <div>
            <span className='font-medium text-slate-500'>Old values</span>
            <pre className='mt-1 max-h-40 overflow-auto rounded bg-red-50 p-3 text-xs text-red-900'>
              {formatJson(log.old_values as Record<string, unknown>)}
            </pre>
          </div>
        ) : null}

        {log.new_values && Object.keys(log.new_values).length > 0 ? (
          <div>
            <span className='font-medium text-slate-500'>New values</span>
            <pre className='mt-1 max-h-40 overflow-auto rounded bg-green-50 p-3 text-xs text-green-900'>
              {formatJson(log.new_values as Record<string, unknown>)}
            </pre>
          </div>
        ) : null}

        {log.ip_address || log.user_agent ? (
          <div className='border-t border-slate-200 pt-4'>
            <span className='font-medium text-slate-500'>Client</span>
            <div className='mt-1 text-sm'>
              {log.ip_address ? <p>IP: {log.ip_address}</p> : null}
              {log.user_agent ? (
                <p className='break-all text-xs text-slate-500'>{log.user_agent}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </AdminDialog>
  );
}
