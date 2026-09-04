'use client';

import { ApiKeysPanel } from '@/components/admin/audit/api-keys-panel';
import { AuditLogsPanel } from '@/components/admin/audit/audit-logs-panel';
import { CognitoUsersPanel } from '@/components/admin/audit/cognito-users-panel';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { useQueryTabState } from '@/hooks/use-query-tab-state';
import { AUDITABLE_AUDIT_LOG_TABLES } from '@/types/audit-log';

type AuditView = 'logs' | 'api-keys' | 'users';

const AUDIT_VIEW_KEYS: readonly AuditView[] = ['logs', 'api-keys', 'users'];
const AUDIT_TAB_ITEMS: { key: AuditView; label: string }[] = [
  { key: 'logs', label: 'Logs' },
  { key: 'api-keys', label: 'API keys' },
  { key: 'users', label: 'Users' },
];

export function AuditLogsPage() {
  const [activeView, setActiveView] = useQueryTabState<AuditView>(AUDIT_VIEW_KEYS, 'logs');

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
      ) : activeView === 'users' ? (
        <CognitoUsersPanel />
      ) : (
        <AuditLogsPanel auditableTables={AUDITABLE_AUDIT_LOG_TABLES} />
      )}
    </div>
  );
}
