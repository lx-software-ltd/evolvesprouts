/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LandingPageHero } from '@/components/sections/landing-pages/landing-page-hero';
import enContent from '@/content/en.json';
import easterWorkshopContent from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';
import missingPieceContent from '@/content/landing-pages/may-2026-the-missing-piece.json';
import type { EventBookingModalPayload } from '@/lib/events-data';

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

describe('LandingPageHero section', () => {
  it('renders section shell identifiers and hero content', async () => {
    const eventContent = {
      title: 'Easter 2026 Montessori Play Coaching Workshop',
      startDateTime: '2026-04-06T02:00:00Z',
      endDateTime: '2026-04-06T03:00:00Z',
      locationLabel: 'Wan Chai',
      partners: ['happy-baton', 'baumhaus'],
      categoryChips: ['Workshop'],
    };
    const expectedDateChip = 'Monday 06 April 2026';
    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Hong_Kong',
    });
    const expectedTimeChip = `${timeFormatter.format(new Date(eventContent.startDateTime))} - ${timeFormatter.format(new Date(eventContent.endDateTime))}`;
    const ctaPriceLabel = 'HK$350';
    const resolvedCtaLabel = easterWorkshopContent.en.cta.buttonLabelTemplate.replace(
      '{price}',
      ctaPriceLabel,
    );
    const bookingPayload: EventBookingModalPayload = {
      variant: 'event',
      bookingSystem: 'event-booking',
      serviceKey: 'easter-workshop-test',
      instanceSlug: 'easter-workshop-test-instance',
      title: eventContent.title,
      subtitle: 'A practical workshop',
      originalAmount: 350,
      locationName: 'Baumhaus',
      locationAddress: "Example Hall, 1/F, Example Tower, 1 Sample Street, Hong Kong",
      directionHref:
        'https://www.google.com/maps/dir/?api=1&destination=Example+Hall,+1+Sample+Street,+Hong+Kong',
      dateParts: [
        {
          id: 'session-1',
          startDateTime: eventContent.startDateTime,
          endDateTime: eventContent.endDateTime,
          description: 'A practical workshop',
        },
      ],
      selectedDateLabel: '06 Apr 2026',
      selectedDateStartTime: eventContent.startDateTime,
    };

    render(
      <LandingPageHero
        slug='easter-2026-montessori-play-coaching-workshop'
        content={easterWorkshopContent.en.hero}
        ctaContent={easterWorkshopContent.en.cta}
        ctaPriceLabel={ctaPriceLabel}
        commonContent={enContent.landingPages.common}
        locale='en'
        title={eventContent.title}
        eventContent={eventContent}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    const section = document.getElementById('landing-page-hero');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('data-figma-node')).toBe('landing-page-hero');
    expect(section).toHaveClass('es-landing-page-hero-section');
    expect(section).toHaveClass('es-bg-surface-white');
    expect(screen.getByRole('heading', { name: eventContent.title }))
      .toBeInTheDocument();
    expect(document.querySelector('.es-type-subtitle-lg')).toBeNull();
    expect(screen.getByText(easterWorkshopContent.en.hero.description)).toBeInTheDocument();
    expect(await screen.findByText(expectedDateChip)).toBeInTheDocument();
    expect(await screen.findByText(expectedTimeChip)).toBeInTheDocument();
    expect(await screen.findByText('Wan Chai')).toBeInTheDocument();
    expect(await screen.findByText('Workshop')).toBeInTheDocument();
    expect(document.querySelector('img[src="/images/calendar.svg"]')).toBeInTheDocument();
    expect(document.querySelector('img[src="/images/clock.svg"]')).toBeInTheDocument();
    expect(document.querySelector('img[src="/images/location.svg"]')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: resolvedCtaLabel }),
    ).toBeInTheDocument();
    const partnerContainer = screen.getByTestId('landing-page-hero-partners');
    expect(partnerContainer).toBeInTheDocument();
    const partnerLogos = partnerContainer.querySelectorAll('[data-testid^="landing-page-partner-logo-"]');
    expect(partnerLogos.item(0)).toHaveAttribute(
      'data-testid',
      'landing-page-partner-logo-evolvesprouts',
    );
    expect(screen.getByTestId('landing-page-partner-logo-evolvesprouts')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-partner-logo-evolvesprouts')).toHaveClass('h-16');
    expect(screen.getByTestId('landing-page-partner-logo-happy-baton')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-partner-logo-happy-baton')).toHaveClass('h-8');
    expect(screen.getByTestId('landing-page-partner-logo-baumhaus')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-partner-logo-baumhaus')).toHaveClass('h-8');
    expect(screen.queryByText('Helpers Welcome')).not.toBeInTheDocument();
    const heroImage = screen.getByRole('img', { name: easterWorkshopContent.en.hero.imageAlt });
    const heroImageMaxWidthClass = `max-w-[${easterWorkshopContent.en.hero.imageMaxWidthPercent}%]`;
    expect(heroImage).toBeInTheDocument();
    expect(heroImage.parentElement).toHaveClass(
      'es-landing-page-hero-image-wrap',
      'mx-auto',
      'w-full',
      'justify-self-center',
      heroImageMaxWidthClass,
    );
    expect(heroImage.parentElement?.parentElement).toHaveClass(
      'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]',
    );
  });

  it('does not render subtitle block when subtitle is empty', () => {
    const eventContent = {
      title: 'Easter 2026 Montessori Play Coaching Workshop',
      startDateTime: '2026-04-06T02:00:00Z',
      endDateTime: '2026-04-06T03:00:00Z',
      locationLabel: 'Wan Chai',
      partners: [],
      categoryChips: ['Workshop'],
    };
    const bookingPayload: EventBookingModalPayload = {
      variant: 'event',
      bookingSystem: 'event-booking',
      serviceKey: 'easter-workshop-test',
      instanceSlug: 'easter-workshop-test-instance',
      title: eventContent.title,
      subtitle: 'A practical workshop',
      originalAmount: 350,
      locationName: 'Baumhaus',
      locationAddress: "Example Hall, 1/F, Example Tower, 1 Sample Street, Hong Kong",
      directionHref:
        'https://www.google.com/maps/dir/?api=1&destination=Example+Hall,+1+Sample+Street,+Hong+Kong',
      dateParts: [
        {
          id: 'session-1',
          startDateTime: eventContent.startDateTime,
          endDateTime: eventContent.endDateTime,
          description: 'A practical workshop',
        },
      ],
      selectedDateLabel: '06 Apr 2026',
      selectedDateStartTime: eventContent.startDateTime,
    };

    render(
      <LandingPageHero
        slug='easter-2026-montessori-play-coaching-workshop'
        content={{
          ...easterWorkshopContent.en.hero,
          subtitle: '',
        }}
        ctaContent={easterWorkshopContent.en.cta}
        ctaPriceLabel='HK$350'
        commonContent={enContent.landingPages.common}
        locale='en'
        title={eventContent.title}
        eventContent={eventContent}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    expect(document.querySelector('.es-type-subtitle-lg')).toBeNull();
  });

  it('renders Evolve Sprouts and little-hk partner logos for the Missing Piece landing page', () => {
    const eventContent = {
      title: 'The Missing Piece',
      startDateTime: '2026-05-16T01:00:00Z',
      endDateTime: '2026-05-16T02:00:00Z',
      locationLabel: 'Wong Chuk Hang',
      partners: ['little-hk'],
      categoryChips: ['Workshop'],
    };
    const bookingPayload: EventBookingModalPayload = {
      variant: 'event',
      bookingSystem: 'event-booking',
      serviceKey: 'the-missing-piece-test',
      instanceSlug: 'the-missing-piece-test-instance',
      title: eventContent.title,
      subtitle: 'Workshop',
      originalAmount: 150,
      locationName: 'Acorn Playhouse',
      locationAddress: '1/F, 1 Sample Street, Hong Kong',
      directionHref:
        'https://www.google.com/maps/dir/?api=1&destination=1%2FF%2C+1+Sample+Street%2C+Hong+Kong',
      dateParts: [
        {
          id: 'session-1',
          startDateTime: eventContent.startDateTime,
          endDateTime: eventContent.endDateTime,
          description: 'Workshop',
        },
      ],
      selectedDateLabel: '16 May 2026',
      selectedDateStartTime: eventContent.startDateTime,
    };

    render(
      <LandingPageHero
        slug='may-2026-the-missing-piece'
        content={missingPieceContent.en.hero}
        ctaContent={missingPieceContent.en.cta}
        ctaPriceLabel='HK$150'
        commonContent={enContent.landingPages.common}
        locale='en'
        title={eventContent.title}
        eventContent={eventContent}
        bookingPayload={bookingPayload}
        isFullyBooked={false}
        bookingModalContent={enContent.bookingModal}
      />,
    );

    const partnerContainer = screen.getByTestId('landing-page-hero-partners');
    const partnerLogos = partnerContainer.querySelectorAll('[data-testid^="landing-page-partner-logo-"]');
    expect(partnerLogos).toHaveLength(2);
    expect(screen.getByTestId('landing-page-partner-logo-evolvesprouts')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-partner-logo-little-hk')).toBeInTheDocument();
    expect(screen.getByTestId('landing-page-partner-logo-little-hk')).toHaveClass('h-8');
    const heroImage = screen.getByRole('img', { name: missingPieceContent.en.hero.imageAlt });
    expect(heroImage).toHaveAttribute('src', missingPieceContent.en.hero.imageSrc);
  });
});
