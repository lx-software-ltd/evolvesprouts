'use client';

import { StatusBanner } from '@/components/status-banner';
import { formatDate } from '@/lib/format';

export interface InboxThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string | null;
  sentAt: string | null;
}

export interface InboxConversationThreadProps {
  messages: InboxThreadMessage[];
  isLoading: boolean;
  error: string;
  /** Short summary line shown above the messages (counts, platform id). */
  summary?: string;
}

function formatWhen(value: string | null): string {
  if (!value) {
    return '—';
  }
  return formatDate(value);
}

/**
 * Read-only message thread rendered inside an expanded conversation row.
 * Newest first, inbound on the left tint and outbound on the green tint.
 */
export function InboxConversationThread({ messages, isLoading, error, summary }: InboxConversationThreadProps) {
  return (
    <div className='space-y-3' data-testid='inbox-conversation-thread'>
      {summary ? <p className='text-xs text-slate-500'>{summary}</p> : null}
      {error ? (
        <StatusBanner variant='error' title='Messages'>
          {error}
        </StatusBanner>
      ) : null}
      {isLoading ? <p className='text-sm text-slate-600'>Loading messages…</p> : null}
      {!isLoading && messages.length === 0 && !error ? (
        <p className='text-sm text-slate-600'>No messages captured yet.</p>
      ) : null}
      <ol className='space-y-2'>
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.direction === 'inbound'
                ? 'rounded-md border border-slate-200 bg-slate-50 p-3'
                : 'rounded-md border border-emerald-100 bg-emerald-50 p-3'
            }
          >
            <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
              {message.direction} · {message.messageType} · {formatWhen(message.sentAt)}
            </p>
            <p className='mt-1 wrap-anywhere text-sm text-slate-800'>{message.body || '(no text body)'}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
