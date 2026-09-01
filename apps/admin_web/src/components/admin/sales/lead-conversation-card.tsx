'use client';

import Link from 'next/link';

import { useLeadConversationHistory } from '@/hooks/use-lead-conversation-history';
import { adminSalesConversationDeepLink } from '@/lib/contact-related-links';
import { formatDate, formatEnumLabel } from '@/lib/format';
import { Card } from '@/components/ui/card';

export interface LeadConversationCardProps {
  contactId: string | null;
}

function conversationHref(
  contactId: string | null,
  channel: 'whatsapp' | 'instagram' | 'messenger',
  conversationId: string
): string {
  return adminSalesConversationDeepLink(contactId ?? '', channel, conversationId);
}

export function LeadConversationCard({ contactId }: LeadConversationCardProps) {
  const { conversations, overflow, hasMore, isLoading, error } = useLeadConversationHistory(contactId);
  const moreHref =
    hasMore && overflow
      ? conversationHref(contactId ?? overflow.contactId, overflow.channel, overflow.id)
      : hasMore && conversations[0]
        ? conversationHref(contactId ?? conversations[0].contactId, conversations[0].channel, conversations[0].id)
        : null;

  return (
    <Card title='Conversation' className='h-full'>
      {error ? <p className='text-sm text-red-700'>{error}</p> : null}
      {isLoading ? <p className='text-sm text-slate-600'>Loading conversations…</p> : null}
      {!isLoading && !error && conversations.length === 0 ? (
        <p className='text-sm text-slate-600'>
          {contactId
            ? 'No Instagram, Messenger, or WhatsApp conversations for this contact.'
            : 'No linked contact to load conversations.'}
        </p>
      ) : null}
      {conversations.length > 0 ? (
        <ol className='space-y-2'>
          {conversations.map((conversation) => (
            <li key={`${conversation.channel}:${conversation.id}`}>
              <Link
                href={conversationHref(
                  contactId ?? conversation.contactId,
                  conversation.channel,
                  conversation.id
                )}
                className={
                  conversation.latestDirection === 'outbound'
                    ? 'block rounded-md border border-emerald-100 bg-emerald-50 p-3'
                    : 'block rounded-md border border-slate-200 bg-slate-50 p-3'
                }
              >
                <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
                  {formatEnumLabel(conversation.channel)}
                  {conversation.latestDirection ? ` · ${conversation.latestDirection}` : ''}
                  {conversation.lastMessageAt ? ` · ${formatDate(conversation.lastMessageAt)}` : ''}
                </p>
                <p className='mt-1 text-sm text-slate-800'>
                  {conversation.latestBody || '(no text body)'}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      {moreHref ? (
        <p className='mt-3'>
          <Link
            href={moreHref}
            className='text-sm font-semibold text-slate-700 underline-offset-2 hover:underline'
          >
            Open full conversation
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
