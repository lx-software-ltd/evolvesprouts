'use client';

import { useLeadConversationHistory } from '@/hooks/use-lead-conversation-history';
import { formatDate, formatEnumLabel } from '@/lib/format';
import { Card } from '@/components/ui/card';

export interface LeadConversationCardProps {
  contactId: string | null;
}

export function LeadConversationCard({ contactId }: LeadConversationCardProps) {
  const { messages, isLoading, error } = useLeadConversationHistory(contactId);

  return (
    <Card title='Conversation' className='h-full'>
      {error ? <p className='text-sm text-red-700'>{error}</p> : null}
      {isLoading ? <p className='text-sm text-slate-600'>Loading conversations…</p> : null}
      {!isLoading && !error && messages.length === 0 ? (
        <p className='text-sm text-slate-600'>
          {contactId
            ? 'No Instagram, Messenger, or WhatsApp conversations for this contact.'
            : 'No linked contact to load conversations.'}
        </p>
      ) : null}
      {messages.length > 0 ? (
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
                {formatEnumLabel(message.channel)} · {message.direction} · {formatDate(message.sentAt)}
              </p>
              <p className='mt-1 text-sm text-slate-800'>{message.body || '(no text body)'}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}
