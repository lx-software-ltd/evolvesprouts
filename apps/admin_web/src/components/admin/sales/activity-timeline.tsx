import type { AdminUser, LeadEvent } from '@/types/leads';

import { formatDate, formatEnumLabel } from '@/lib/format';

export interface ActivityTimelineProps {
  events: LeadEvent[];
  users: AdminUser[];
  isLoading?: boolean;
}

function resolveActorLabel(createdBy: string | null, users: AdminUser[]): string {
  if (!createdBy) {
    return 'System';
  }
  const match = users.find((user) => user.sub === createdBy);
  if (!match) {
    return createdBy;
  }
  return match.name || match.email || match.sub;
}

/** Lead event list; rendered inside the Activity disclosure of the lead editor. */
export function ActivityTimeline({ events, users, isLoading = false }: ActivityTimelineProps) {
  if (isLoading && events.length === 0) {
    return <p className='text-sm text-slate-600'>Loading activity…</p>;
  }
  return (
    <ol className='space-y-3' aria-label='Activity timeline'>
      {events.length === 0 ? (
        <li className='text-sm text-slate-600'>No activity yet.</li>
      ) : (
        events.map((event) => (
          <li key={event.id} className='border-l-2 border-slate-200 pl-3'>
            <p className='text-sm font-medium text-slate-900'>{formatEnumLabel(event.eventType)}</p>
            <p className='text-xs text-slate-600'>
              By {resolveActorLabel(event.createdBy, users)} • {formatDate(event.createdAt)}
            </p>
          </li>
        ))
      )}
    </ol>
  );
}
