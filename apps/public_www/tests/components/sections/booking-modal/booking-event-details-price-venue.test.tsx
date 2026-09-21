import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingEventDetailsPriceVenue } from '@/components/sections/booking-modal/booking-event-details-price-venue';
import enContent from '@/content/en.json';

describe('BookingEventDetailsPriceVenue', () => {
  const payment = enContent.bookingModal.paymentModal;

  it('uses success dollar mask and hides refund hint when price is free', () => {
    const { container } = render(
      <BookingEventDetailsPriceVenue
        locale='en'
        content={payment}
        originalAmount={0}
        venueName='Venue'
        venueAddress='1 Road'
      />,
    );

    expect(
      container.querySelector('.es-mask-dollar-success'),
    ).not.toBeNull();
    expect(container.querySelector('.es-mask-dollar-danger')).toBeNull();
    expect(screen.getByText(payment.priceBreakdownFreeLabel)).toBeInTheDocument();
    expect(screen.queryByText(payment.refundHint)).not.toBeInTheDocument();
  });

  it('uses danger dollar mask and shows refund hint when price is paid', () => {
    const { container } = render(
      <BookingEventDetailsPriceVenue
        locale='en'
        content={payment}
        originalAmount={9000}
        venueName='Venue'
        venueAddress='1 Road'
      />,
    );

    expect(
      container.querySelector('.es-mask-dollar-danger'),
    ).not.toBeNull();
    expect(container.querySelector('.es-mask-dollar-success')).toBeNull();
    expect(screen.getByText(payment.refundHint)).toBeInTheDocument();
  });

  it('shows only the to-be-confirmed venue name and hides directions', () => {
    render(
      <BookingEventDetailsPriceVenue
        locale='en'
        content={payment}
        originalAmount={9000}
        venueName={payment.locationToBeConfirmedLabel}
        venueAddress=''
        directionHref=''
      />,
    );

    expect(screen.getByText(payment.locationToBeConfirmedLabel)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: payment.directionLabel })).not.toBeInTheDocument();
  });
});
