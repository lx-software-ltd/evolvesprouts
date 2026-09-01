import { formatInboxImportCounters, type InboxImportJobSummary } from '@/lib/inbox-import-api';
import { StatusBanner } from '@/components/status-banner';

function bannerVariant(
  status: InboxImportJobSummary['status']
): 'info' | 'success' | 'error' {
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'succeeded' || status === 'succeeded_with_errors') {
    return 'success';
  }
  return 'info';
}

function statusLabel(status: InboxImportJobSummary['status']): string {
  switch (status) {
    case 'pending':
      return 'Import queued';
    case 'processing':
      return 'Import running';
    case 'succeeded':
      return 'Import finished';
    case 'succeeded_with_errors':
      return 'Import finished with skips';
    case 'failed':
      return 'Import failed';
    default:
      return 'Import';
  }
}

export function InboxImportStatus({ job }: { job: InboxImportJobSummary | null }) {
  if (!job) {
    return null;
  }
  const counters = formatInboxImportCounters(job.counters);
  return (
    <StatusBanner variant={bannerVariant(job.status)} title={statusLabel(job.status)}>
      {[job.errorMessage, counters].filter(Boolean).join(' ')}
    </StatusBanner>
  );
}
