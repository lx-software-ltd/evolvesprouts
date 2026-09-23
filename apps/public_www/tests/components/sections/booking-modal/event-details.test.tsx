/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookingEventDetails } from '@/components/sections/booking-modal/event-details';
import enContent from '@/content/en.json';

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

describe('BookingEventDetails (event variant)', () => {
  it('replaces timeline with a price-style event schedule summary block', () => {
    const { container } = render(
      <BookingEventDetails
        locale='en'
        headingId='event-details-title'
        title='Event title'
        subtitle='Event subtitle'
        content={enContent.bookingModal.paymentModal}
        activePartRows={[
          {
            date: '21 May 2026 · 10:00 AM - 12:00 PM',
            description: 'Old-format schedule description one',
          },
          {
            date: '28 May 2026 · 10:00 AM - 12:00 PM',
            description: 'Old-format schedule description two',
          },
        ]}
        originalAmount={1280}
        venueName='Example Hall'
        venueAddress='35 Aberdeen Street, Central'
        directionHref='https://maps.google.com/?q=Example+Hall'
        detailsVariant='event'
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Event title' })).toBeInTheDocument();
    expect(screen.getByText('Event subtitle')).toBeInTheDocument();

    expect(container.querySelector('div[data-event-schedule-summary="true"]')).not.toBeNull();
    expect(container.querySelector('span[data-event-schedule-icon="true"]')?.className).toContain(
      'es-mask-calendar-danger',
    );
    expect(container.querySelectorAll('p[data-event-schedule-row="true"]')).toHaveLength(2);
    expect(screen.getByText('21 May 2026 · 10:00 AM - 12:00 PM')).toBeInTheDocument();
    expect(screen.getByText('28 May 2026 · 10:00 AM - 12:00 PM')).toBeInTheDocument();

    expect(container.querySelectorAll('span[data-course-part-chip="true"]')).toHaveLength(0);
    expect(screen.queryByText('Old-format schedule description one')).not.toBeInTheDocument();
    expect(screen.queryByText('Old-format schedule description two')).not.toBeInTheDocument();

    expect(screen.getByText('HK$1,280')).toBeInTheDocument();
    expect(container.querySelector('span.es-mask-dollar-danger')).not.toBeNull();
    expect(container.querySelector('span.es-mask-location-danger')).not.toBeNull();
  });
});
