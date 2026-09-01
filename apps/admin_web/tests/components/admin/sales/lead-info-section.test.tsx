import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LeadInfoSection } from '@/components/admin/sales/lead-info-section';
import type { LeadDetail } from '@/types/leads';

function leadFixture(overrides: Partial<LeadDetail['contact']> = {}): LeadDetail {
  return {
    id: 'lead-1',
    contact: {
      id: 'contact-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phoneRegion: null,
      phoneNationalNumber: null,
      phoneE164: null,
      instagramHandle: null,
      source: 'manual',
      sourceDetail: null,
      contactType: 'parent',
      relationshipType: 'prospect',
      ...overrides,
    },
    leadType: 'consultation',
    funnelStage: 'new',
    assignedTo: null,
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-03-01T10:00:00Z',
    convertedAt: null,
    lostAt: null,
    lostReason: null,
    daysInStage: 4,
    lastActivityAt: '2026-03-02T10:00:00Z',
    tags: [],
    family: null,
    organization: null,
    events: [],
    notes: [],
  };
}

describe('LeadInfoSection', () => {
  it('shows an em dash when the contact has no phone', () => {
    render(<LeadInfoSection lead={leadFixture()} />);
    expect(screen.getByText(/Phone:/).parentElement).toHaveTextContent('Phone: —');
  });

  it('shows a Hong Kong phone with international grouping', () => {
    render(
      <LeadInfoSection
        lead={leadFixture({
          phoneRegion: 'HK',
          phoneNationalNumber: '12345678',
          phoneE164: '+85212345678',
        })}
      />
    );
    expect(screen.getByText(/Phone:/).parentElement).toHaveTextContent('Phone: +852 1234 5678');
  });

  it('shows Instagram handles with a leading @', () => {
    render(<LeadInfoSection lead={leadFixture({ instagramHandle: 'kitie.w' })} />);
    expect(screen.getByText(/Instagram:/).parentElement).toHaveTextContent('Instagram: @kitie.w');
  });
});
