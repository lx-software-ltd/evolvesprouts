'use client';

import Link from 'next/link';

import { useLeadConversationHistory } from '@/hooks/use-lead-conversation-history';
import { adminSalesConversationDeepLink } from '@/lib/contact-related-links';
import { formatDate, formatEnumLabel } from '@/lib/format';

export interface LeadConversationCardProps {
  contactId: string | null;
}

/**
 * Latest inbox thread for the lead's contact; rendered inside the
 * Conversation disclosure of the lead editor (no card, no title).
 */
export function LeadConversationCard({ contactId }: LeadConversationCardProps) {
  const { conversation, messages, hasMore, isLoading, error } = useLeadConversationHistory(contactId);
  const moreHref =
    hasMore && conversation
      ? adminSalesConversationDeepLink(
          contactId ?? conversation.contactId ?? '',
          conversation.channel,
          conversation.id
        )
      : null;

  return (
    <div data-testid='lead-conversation'>
      {error ? <p className='text-sm text-red-700'>{error}</p> : null}
      {isLoading ? <p className='text-sm text-slate-600'>Loading conversations…</p> : null}
      {!isLoading && !error && !conversation ? (
        <p className='text-sm text-slate-600'>
          {contactId
            ? 'No Instagram, Messenger, or WhatsApp conversations for this contact.'
            : 'No linked contact to load conversations.'}
        </p>
      ) : null}
      {conversation ? (
        <div className='space-y-3'>
          <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
            {formatEnumLabel(conversation.channel)}
          </p>
          {messages.length === 0 ? (
            <p className='text-sm text-slate-600'>No messages captured yet.</p>
          ) : (
            <ol className='space-y-2'>
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.direction === 'outbound'
                      ? 'rounded-md border border-emerald-100 bg-emerald-50 p-3'
                      : 'rounded-md border border-slate-200 bg-white p-3'
                  }
                >
                  <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
                    {message.direction}
                    {message.sentAt ? ` · ${formatDate(message.sentAt)}` : ''}
                  </p>
                  <p className='mt-1 wrap-anywhere text-sm text-slate-800'>{message.body || '(no text body)'}</p>
                </li>
              ))}
            </ol>
          )}
          {moreHref ? (
            <Link
              href={moreHref}
              className='inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400'
            >
              Open conversation
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
