'use client';

import Image from 'next/image';
import {
  useMemo,
  useState,
} from 'react';

import {
  HeroQuickFactChips,
  type HeroQuickFactChip,
} from '@/components/sections/shared/hero-quick-fact-chips';
import { SectionContainer } from '@/components/sections/shared/section-container';
import { SectionHeader } from '@/components/sections/shared/section-header';
import { renderQuotedDescriptionText } from '@/components/sections/shared/render-highlighted-text';
import { SectionShell } from '@/components/sections/shared/section-shell';
import { SectionCtaAnchor } from '@/components/sections/shared/section-cta-link';
import { LandingPageBookingCtaAction } from '@/components/sections/landing-pages/shared/landing-page-booking-cta-action';
import type {
  BookingModalContent,
  LandingPagesCommonContent,
  LandingPageCtaContent,
  LandingPageLocaleContent,
  Locale,
} from '@/content';
import type {
  EventBookingModalPayload,
  LandingPageHeroEventContent,
} from '@/lib/events-data';
import { resolveHeroImageMaxWidthClass } from '@/lib/page-hero-image';
import {
  formatHeroFullDateLine,
  formatSiteTimeRange,
} from '@/lib/site-datetime';

interface LandingPageHeroProps {
  slug: string;
  content: LandingPageLocaleContent['hero'];
  ctaContent: LandingPageCtaContent;
  ctaPriceLabel?: string;
  commonContent: LandingPagesCommonContent;
  locale: Locale;
  title: string;
  eventContent: LandingPageHeroEventContent | null;
  bookingPayload: EventBookingModalPayload | null;
  isFullyBooked: boolean;
  fullyBookedCtaLabel?: string;
  fullyBookedWaitlistHref?: string;
  bookingModalContent: BookingModalContent;
  thankYouWhatsappHref?: string;
  thankYouWhatsappCtaLabel?: string;
  ariaLabel?: string;
}

const PARTNER_LOGO_EXTENSIONS = ['webp', 'svg'] as const;
const KNOWN_PARTNER_LOGO_SOURCES: Readonly<Record<string, readonly string[]>> = {
  'evolvesprouts': ['/images/evolvesprouts-logo.svg'],
  'acorn-playhouse': ['/images/partners/acorn-playhouse.webp'],
  'baumhaus': ['/images/partners/baumhaus.webp'],
  'happy-baton': ['/images/partners/happy-baton.webp'],
  'little-hk': ['/images/partners/little-hk.webp'],
};
function buildPartnerLogoSources(partner: string): string[] {
  const normalizedPartner = partner.trim().toLowerCase();
  if (!normalizedPartner) {
    return [];
  }

  const knownSources = KNOWN_PARTNER_LOGO_SOURCES[normalizedPartner];
  if (knownSources) {
    return [...knownSources];
  }

  return PARTNER_LOGO_EXTENSIONS.map(
    (extension) => `/images/partners/${normalizedPartner}.${extension}`,
  );
}

function buildPartnerLogoTestId(partner: string): string {
  return `landing-page-partner-logo-${partner.trim().toLowerCase()}`;
}

function buildDisplayedPartnerSlugs(partners: readonly string[] | undefined): string[] {
  const normalizedPartners = (partners ?? [])
    .map((partner) => partner.trim().toLowerCase())
    .filter((partner) => partner.length > 0);
  if (normalizedPartners.length === 0) {
    return [];
  }

  const dedupedPartners = Array.from(new Set(normalizedPartners));
  return [
    'evolvesprouts',
    ...dedupedPartners.filter((partner) => partner !== 'evolvesprouts'),
  ];
}

function PartnerLogo({ partner }: { partner: string }) {
  const normalizedPartner = partner.trim().toLowerCase();
  const candidateSources = useMemo(
    () => buildPartnerLogoSources(normalizedPartner),
    [normalizedPartner],
  );
  const [sourceIndex, setSourceIndex] = useState(0);

  const source = candidateSources[sourceIndex];
  if (!source) {
    return null;
  }

  const logoSizeClassName =
    normalizedPartner === 'evolvesprouts' ? 'h-16 w-auto object-contain' : 'h-8 w-auto object-contain';

  return (
    <Image
      src={source}
      alt=''
      width={160}
      height={48}
      className={logoSizeClassName}
      aria-hidden='true'
      data-testid={buildPartnerLogoTestId(normalizedPartner)}
      onError={() => {
        setSourceIndex((currentIndex) => currentIndex + 1);
      }}
    />
  );
}

function buildHeroChips(
  eventContent: LandingPageHeroEventContent | null,
  locale: Locale,
): HeroQuickFactChip[] {
  if (!eventContent) {
    return [];
  }

  const dedupedChips: HeroQuickFactChip[] = [];
  const seen = new Set<string>();

  for (const chip of [
    {
      type: 'date' as const,
      label: formatHeroFullDateLine(eventContent.startDateTime, locale),
    },
    {
      type: 'time' as const,
      label: formatSiteTimeRange(
        eventContent.startDateTime,
        eventContent.endDateTime,
        locale,
      ),
    },
    {
      type: 'location' as const,
      label: eventContent.locationLabel,
    },
    ...eventContent.categoryChips.map((value) => ({
      type: 'category' as const,
      label: value,
    })),
  ]) {
    const normalizedValue = chip.label?.trim() ?? '';
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    dedupedChips.push({
      type: chip.type,
      label: normalizedValue,
    });
  }

  return dedupedChips;
}

function takeEventChipsOfType(
  unusedEventChips: HeroQuickFactChip[],
  type: HeroQuickFactChip['type'],
): HeroQuickFactChip[] {
  if (type === 'category') {
    const taken = unusedEventChips.filter((chip) => chip.type === 'category');
    unusedEventChips.splice(
      0,
      unusedEventChips.length,
      ...unusedEventChips.filter((chip) => chip.type !== 'category'),
    );
    return taken;
  }

  const index = unusedEventChips.findIndex((chip) => chip.type === type);
  if (index < 0) {
    return [];
  }
  return unusedEventChips.splice(index, 1);
}

function pushUniqueHeroChip(
  merged: HeroQuickFactChip[],
  seen: Set<string>,
  chip: HeroQuickFactChip,
): void {
  const label = chip.label.trim();
  if (!label || seen.has(label)) {
    return;
  }
  seen.add(label);
  merged.push({
    type: chip.type,
    label,
  });
}

function mergeLandingPageHeroChips(
  jsonChips: LandingPageLocaleContent['hero']['quickFactChips'],
  eventChips: HeroQuickFactChip[],
): HeroQuickFactChip[] {
  const specs = jsonChips ?? [];
  const usesCustomOrder = specs.some((chip) => chip.from === 'event');

  if (!usesCustomOrder) {
    const fromJson: HeroQuickFactChip[] = specs
      .map((chip) => ({
        type: chip.type,
        label: chip.label?.trim() ?? '',
      }))
      .filter((chip) => chip.label.length > 0);

    const seen = new Set<string>();
    const merged: HeroQuickFactChip[] = [];
    for (const chip of [...fromJson, ...eventChips]) {
      pushUniqueHeroChip(merged, seen, chip);
    }
    return merged;
  }

  const unusedEventChips = [...eventChips];
  const seen = new Set<string>();
  const merged: HeroQuickFactChip[] = [];

  for (const spec of specs) {
    if (spec.from === 'event') {
      const taken = takeEventChipsOfType(unusedEventChips, spec.type);
      if (taken.length > 0) {
        for (const chip of taken) {
          pushUniqueHeroChip(merged, seen, chip);
        }
        continue;
      }
    }

    const fallbackLabel = spec.label?.trim() ?? '';
    if (fallbackLabel) {
      pushUniqueHeroChip(merged, seen, {
        type: spec.type,
        label: fallbackLabel,
      });
    }
  }

  return merged;
}

export function LandingPageHero({
  slug,
  content,
  ctaContent,
  ctaPriceLabel,
  commonContent,
  locale,
  title,
  eventContent,
  bookingPayload,
  isFullyBooked,
  fullyBookedCtaLabel,
  fullyBookedWaitlistHref,
  bookingModalContent,
  thankYouWhatsappHref,
  thankYouWhatsappCtaLabel,
  ariaLabel,
}: LandingPageHeroProps) {
  const heroImageMaxWidthClassName = useMemo(
    () => resolveHeroImageMaxWidthClass(content),
    [content],
  );
  const chips = useMemo(
    () =>
      mergeLandingPageHeroChips(
        content.quickFactChips,
        buildHeroChips(eventContent, locale),
      ),
    [content.quickFactChips, eventContent, locale],
  );
  const partnerSlugs = useMemo(
    () => buildDisplayedPartnerSlugs(eventContent?.partners),
    [eventContent?.partners],
  );

  return (
    <SectionShell
      id='landing-page-hero'
      ariaLabel={ariaLabel ?? title}
      dataFigmaNode='landing-page-hero'
      className='es-landing-page-hero-section es-bg-surface-white overflow-x-clip'
    >
      <SectionContainer className='grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]'>
        <div className='space-y-5'>
          <SectionHeader
            eyebrow={content.eyebrow}
            title={title}
            titleAs='h1'
            align='left'
          />
          {content.subtitle ? (
            <p className='es-type-subtitle-lg es-text-heading'>{content.subtitle}</p>
          ) : null}
          {partnerSlugs.length > 0 ? (
            <div
              data-testid='landing-page-hero-partners'
              className='flex flex-wrap items-center gap-5'
            >
              {partnerSlugs.map((partner) => (
                <PartnerLogo
                  key={partner}
                  partner={partner}
                />
              ))}
            </div>
          ) : null}
          <p className='es-type-body'>{renderQuotedDescriptionText(content.description)}</p>
          <HeroQuickFactChips
            chips={chips}
            data-testid='landing-page-hero-chips'
          />
          {content.ctaAnchorHref && content.ctaAnchorLabel ? (
            <SectionCtaAnchor
              href={content.ctaAnchorHref}
              className='mt-3 w-fit'
            >
              {content.ctaAnchorLabel}
            </SectionCtaAnchor>
          ) : (
            <LandingPageBookingCtaAction
              locale={locale}
              slug={slug}
              content={ctaContent}
              ctaPriceLabel={ctaPriceLabel}
              commonContent={commonContent}
              bookingPayload={bookingPayload}
              isFullyBooked={isFullyBooked}
              fullyBookedCtaLabel={fullyBookedCtaLabel}
              fullyBookedWaitlistHref={fullyBookedWaitlistHref}
              bookingModalContent={bookingModalContent}
              thankYouWhatsappHref={thankYouWhatsappHref}
              thankYouWhatsappCtaLabel={thankYouWhatsappCtaLabel}
              analyticsSectionId='landing-page-hero'
              ctaLocation='landing_page'
              buttonClassName='mt-3'
            />
          )}
        </div>
        <div
          className={`es-landing-page-hero-image-wrap mx-auto w-full justify-self-center ${heroImageMaxWidthClassName}`}
        >
          <Image
            src={content.imageSrc}
            alt={content.imageAlt}
            width={1200}
            height={900}
            priority
            fetchPriority='high'
            sizes='(max-width: 1024px) 100vw, 60vw'
            className='relative z-10 h-auto w-full rounded-panel'
          />
        </div>
      </SectionContainer>
    </SectionShell>
  );
}
