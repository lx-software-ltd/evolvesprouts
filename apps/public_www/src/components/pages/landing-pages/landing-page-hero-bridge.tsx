'use client';

import { useContext } from 'react';

import {
  LandingPageHero,
  type LandingPageHeroWhatsappCta,
} from '@/components/sections/landing-pages/landing-page-hero';
import type {
  BookingModalContent,
  LandingPagesCommonContent,
  LandingPageCtaContent,
  LandingPageLocaleContent,
  Locale,
} from '@/content';
import { LandingPageCalendarContext } from '@/lib/landing-page-calendar-context';

interface LandingPageHeroBridgeProps {
  slug: string;
  content: LandingPageLocaleContent['hero'];
  ctaContent: LandingPageCtaContent;
  commonContent: LandingPagesCommonContent;
  locale: Locale;
  metaTitle: string;
  bookingModalContent: BookingModalContent;
  whatsappCta?: LandingPageHeroWhatsappCta | null;
  ariaLabel?: string;
}

export function LandingPageHeroBridge({
  slug,
  content,
  ctaContent,
  commonContent,
  locale,
  metaTitle,
  bookingModalContent,
  whatsappCta,
  ariaLabel,
}: LandingPageHeroBridgeProps) {
  const calendar = useContext(LandingPageCalendarContext);
  if (!calendar) {
    return null;
  }

  const { heroEventContent, bookingEventContent, sharedCtaProps } = calendar;
  const isFullyBooked = bookingEventContent?.status === 'fully_booked';

  return (
    <LandingPageHero
      slug={slug}
      content={content}
      ctaContent={ctaContent}
      ctaPriceLabel={bookingEventContent?.ctaPriceLabel}
      commonContent={commonContent}
      locale={locale}
      title={heroEventContent?.title ?? metaTitle}
      eventContent={heroEventContent}
      bookingPayload={bookingEventContent?.bookingPayload ?? null}
      isFullyBooked={isFullyBooked}
      fullyBookedCtaLabel={ctaContent.fullyBookedButtonLabel}
      fullyBookedWaitlistHref={sharedCtaProps.fullyBookedWaitlistHref}
      bookingModalContent={bookingModalContent}
      thankYouWhatsappHref={sharedCtaProps.thankYouWhatsappHref}
      thankYouWhatsappCtaLabel={sharedCtaProps.thankYouWhatsappCtaLabel}
      whatsappCta={whatsappCta}
      ariaLabel={ariaLabel}
    />
  );
}
