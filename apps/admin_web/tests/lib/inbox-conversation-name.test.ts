import { describe, expect, it } from 'vitest';

import {
  adminContactDeepLink,
  formatInboxConversationName,
  readAdminContactQueryId,
} from '@/lib/inbox-conversation-name';

describe('formatInboxConversationName', () => {
  it('prefers CRM contact first and last name over the platform profile name', () => {
    expect(
      formatInboxConversationName({
        contactName: 'Jane Doe',
        profileName: 'kitie.w',
      })
    ).toBe('Jane Doe');
  });

  it('falls back to the platform profile name when no contact name is present', () => {
    expect(
      formatInboxConversationName({
        contactName: null,
        profileName: 'Kitie Wong',
      })
    ).toBe('Kitie Wong');
  });

  it('treats blank contact names as missing', () => {
    expect(
      formatInboxConversationName({
        contactName: '   ',
        profileName: 'Kitie',
      })
    ).toBe('Kitie');
  });
});

describe('admin contact deep link', () => {
  it('builds a contacts URL for the linked contact id', () => {
    expect(adminContactDeepLink('abc-123')).toBe('/contacts?contact=abc-123');
  });

  it('reads the contact query id from a search string', () => {
    expect(readAdminContactQueryId('?tab=contacts&contact=abc-123')).toBe('abc-123');
    expect(readAdminContactQueryId('')).toBe('');
  });
});
