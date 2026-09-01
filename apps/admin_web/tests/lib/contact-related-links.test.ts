import { describe, expect, it } from 'vitest';

import {
  adminContactInvoicesDeepLink,
  adminSalesConversationsDeepLink,
  adminServiceInstancesDeepLink,
  isSalesInboxTab,
} from '@/lib/contact-related-links';

describe('contact related deep links', () => {
  it('builds a sales inbox URL for the preferred channel', () => {
    expect(adminSalesConversationsDeepLink('abc-123', 'instagram')).toBe(
      '/sales?tab=instagram&contact=abc-123'
    );
  });

  it('defaults to WhatsApp when the channel is missing', () => {
    expect(adminSalesConversationsDeepLink('abc-123', null)).toBe(
      '/sales?tab=whatsapp&contact=abc-123'
    );
  });

  it('builds services and finance URLs with the contact query', () => {
    expect(adminServiceInstancesDeepLink('abc-123')).toBe('/services?contact=abc-123');
    expect(adminContactInvoicesDeepLink('abc-123')).toBe('/finance?contact=abc-123');
  });

  it('accepts only known sales inbox tabs', () => {
    expect(isSalesInboxTab('whatsapp')).toBe(true);
    expect(isSalesInboxTab('pipeline')).toBe(false);
  });
});
