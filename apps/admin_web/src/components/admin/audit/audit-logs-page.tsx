'use client';

import { useState } from 'react';

import { ApiKeysPanel } from '@/components/admin/audit/api-keys-panel';
import { AuditLogsPanel } from '@/components/admin/audit/audit-logs-panel';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { AUDITABLE_AUDIT_LOG_TABLES } from '@/types/audit-log';

type AuditView = 'logs' | 'api-keys';

const AUDIT_TAB_ITEMS: { key: AuditView; label: string }[] = [
  { key: 'logs', label: 'Logs' },
  { key: 'api-keys', label: 'API keys' },
];

export function AuditLogsPage() {
  const [activeView, setActiveView] = useState<AuditView>('logs');

  return (
    <div className='space-y-6'>
      <AdminTabStrip
        aria-label='Audit views'
        items={AUDIT_TAB_ITEMS}
        activeKey={activeView}
        onChange={setActiveView}
      />
      {activeView === 'api-keys' ? (
        <ApiKeysPanel />
      ) : (
        <AuditLogsPanel auditableTables={AUDITABLE_AUDIT_LOG_TABLES} />
      )}
    </div>
  );
}
