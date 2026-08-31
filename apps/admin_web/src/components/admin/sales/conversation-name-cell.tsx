'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';

import { adminContactDeepLink, formatInboxConversationName } from '@/lib/inbox-conversation-name';

export function ConversationNameCell({
  contactId,
  contactName,
  profileName,
}: {
  contactId: string | null;
  contactName: string | null;
  profileName: string | null;
}) {
  const label = formatInboxConversationName({ contactName, profileName }) || '—';
  const linkedContactId = contactId?.trim() ?? '';
  if (!linkedContactId) {
    return label;
  }

  return (
    <Link
      href={adminContactDeepLink(linkedContactId)}
      className='font-medium text-slate-900 underline-offset-2 hover:underline'
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
      }}
    >
      {label}
    </Link>
  );
}
