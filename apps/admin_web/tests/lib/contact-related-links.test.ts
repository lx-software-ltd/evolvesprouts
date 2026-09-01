import { describe, expect, it } from 'vitest';

import {
  adminContactInvoicesDeepLink,
  adminPartyInvoicesDeepLink,
  adminPartySalesConversationsDeepLink,
  adminPartyServiceInstancesDeepLink,
  adminSalesConversationsDeepLink,
  adminServiceInstancesDeepLink,
  findEnrollmentForRelatedParty,
  isSalesInboxTab,
} from '@/lib/contact-related-links';
import { CUSTOMER_INVOICE_ASSET_TAG } from '@/types/assets';

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

  it('builds services URLs with the contact query', () => {
    expect(adminServiceInstancesDeepLink('abc-123')).toBe('/services?contact=abc-123');
  });

  it('builds assets invoice URLs from the party name cell', () => {
    expect(adminContactInvoicesDeepLink('Linked Person')).toBe(
      `/assets?tag=${CUSTOMER_INVOICE_ASSET_TAG}&query=Linked+Person`
    );
    expect(adminPartyInvoicesDeepLink('Linked · Alex Smith')).toBe(
      `/assets?tag=${CUSTOMER_INVOICE_ASSET_TAG}&query=Linked+%C2%B7+Alex+Smith`
    );
    expect(adminPartyInvoicesDeepLink('  ')).toBe(`/assets?tag=${CUSTOMER_INVOICE_ASSET_TAG}`);
  });

  it('accepts only known sales inbox tabs', () => {
    expect(isSalesInboxTab('whatsapp')).toBe(true);
    expect(isSalesInboxTab('pipeline')).toBe(false);
  });

  it('builds family and organisation destination URLs', () => {
    expect(adminPartySalesConversationsDeepLink('family', 'fam-1', 'messenger')).toBe(
      '/sales?tab=messenger&family=fam-1'
    );
    expect(adminPartyServiceInstancesDeepLink('family', 'fam-1')).toBe('/services?family=fam-1');
    expect(adminPartyInvoicesDeepLink('Linked')).toBe(
      `/assets?tag=${CUSTOMER_INVOICE_ASSET_TAG}&query=Linked`
    );
    expect(adminPartySalesConversationsDeepLink('organization', 'org-1', null)).toBe(
      '/sales?tab=whatsapp&organization=org-1'
    );
    expect(adminPartyServiceInstancesDeepLink('organization', 'org-1')).toBe(
      '/services?organization=org-1'
    );
    expect(adminPartyInvoicesDeepLink('Linked Org')).toBe(
      `/assets?tag=${CUSTOMER_INVOICE_ASSET_TAG}&query=Linked+Org`
    );
  });

  it('finds the enrollment owned by the deep-link party', () => {
    const enrollments = [
      { id: 'e-contact', contactId: 'c-1', familyId: null, organizationId: null },
      { id: 'e-family', contactId: 'c-1', familyId: 'f-1', organizationId: null },
      { id: 'e-org', contactId: null, familyId: null, organizationId: 'o-1' },
    ];
    expect(findEnrollmentForRelatedParty(enrollments, { contactId: 'c-1' })?.id).toBe('e-contact');
    expect(findEnrollmentForRelatedParty(enrollments, { familyId: 'f-1' })?.id).toBe('e-family');
    expect(findEnrollmentForRelatedParty(enrollments, { organizationId: 'o-1' })?.id).toBe('e-org');
    expect(findEnrollmentForRelatedParty(enrollments, { contactId: 'missing' })).toBeNull();
    expect(findEnrollmentForRelatedParty(enrollments, {})).toBeNull();
  });
});
