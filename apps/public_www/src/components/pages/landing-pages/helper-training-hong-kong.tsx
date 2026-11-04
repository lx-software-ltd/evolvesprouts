import type {
  Locale,
  LandingPageLocaleContent,
  SiteContent,
} from '@/content';
import { formatContentTemplate } from '@/content/content-field-utils';
import { LandingPage } from '@/components/pages/landing-pages/landing-page';
import type { LandingPageHeroWhatsappCta } from '@/components/sections/landing-pages/landing-page-hero';
import { MyBestAuntieBooking } from '@/components/sections/my-best-auntie/my-best-auntie-booking';
import type { MyBestAuntieEventCohort } from '@/lib/events-data';
import { formatCurrencyDisplayPrefix } from '@/lib/format';
import { resolveMyBestAuntieHeroCohortSummary } from '@/lib/my-best-auntie-cohort-summary';
import {
  buildWhatsappPrefilledHref,
  resolvePublicSiteConfig,
} from '@/lib/site-config';

export const HELPER_TRAINING_LANDING_PAGE_SLUG = 'helper-training-hong-kong';

export interface HelperTrainingLandingPageProps {
  locale: Locale;
  pagePath: string;
  siteContent: SiteContent;
  pageContent: LandingPageLocaleContent;
  cohorts: MyBestAuntieEventCohort[];
}

type HeroChips = NonNullable<LandingPageLocaleContent['hero']['quickFactChips']>;

/**
 * Price and next-cohort chips come from the CRM calendar so the hero never shows a
 * stale figure; static JSON chips (duration, visits, certification) follow them.
 */
export function buildHelperTrainingHeroChips(
  pageContent: LandingPageLocaleContent,
  cohorts: MyBestAuntieEventCohort[],
  locale: Locale,
): HeroChips {
  const courseBooking = pageContent.courseBooking;
  const staticChips = pageContent.hero.quickFactChips ?? [];
  if (!courseBooking) {
    return staticChips;
  }

  const { lowestPrice, priceCurrency, nextCohortLabel } =
    resolveMyBestAuntieHeroCohortSummary(cohorts, locale);
  const dynamicChips: HeroChips[number][] = [];

  if (lowestPrice !== undefined) {
    dynamicChips.push({
      type: 'price',
      label: formatContentTemplate(courseBooking.priceChipTemplate, {
        currency: formatCurrencyDisplayPrefix(priceCurrency ?? 'HKD'),
        price: lowestPrice.toLocaleString('en-HK'),
      }),
    });
  }
  if (nextCohortLabel) {
    dynamicChips.push({
      type: 'cohort',
      label: formatContentTemplate(courseBooking.nextCohortChipTemplate, {
        cohortLabel: nextCohortLabel,
      }),
    });
  }

  return [...dynamicChips, ...staticChips];
}

export function HelperTrainingLandingPage({
  locale,
  pagePath,
  siteContent,
  pageContent,
  cohorts,
}: HelperTrainingLandingPageProps) {
  const courseBooking = pageContent.courseBooking;
  if (!courseBooking) {
    throw new Error(
      `${HELPER_TRAINING_LANDING_PAGE_SLUG} landing page requires courseBooking content`,
    );
  }

  const publicSiteConfig = resolvePublicSiteConfig();
  const whatsappBaseHref =
    publicSiteConfig.whatsappUrl?.trim() || siteContent.whatsappContact.href.trim();
  const whatsappHref =
    buildWhatsappPrefilledHref(
      whatsappBaseHref,
      courseBooking.whatsappPrefillMessage,
      siteContent.freeIntroSession.phoneNumber,
    ) || whatsappBaseHref;
  const heroWhatsappCta: LandingPageHeroWhatsappCta | null = whatsappHref
    ? { href: whatsappHref, label: courseBooking.whatsappCtaLabel }
    : null;

  const privateProgrammeWhatsappHref =
    buildWhatsappPrefilledHref(
      whatsappBaseHref,
      siteContent.myBestAuntie.booking.privateProgrammePrefillMessage,
      siteContent.freeIntroSession.phoneNumber,
    ) || whatsappBaseHref;

  const heroPageContent: LandingPageLocaleContent = {
    ...pageContent,
    hero: {
      ...pageContent.hero,
      quickFactChips: buildHelperTrainingHeroChips(pageContent, cohorts, locale),
    },
  };

  return (
    <LandingPage
      locale={locale}
      slug={HELPER_TRAINING_LANDING_PAGE_SLUG}
      pagePath={pagePath}
      siteContent={siteContent}
      pageContent={heroPageContent}
      heroEventContent={null}
      bookingEventContent={null}
      structuredDataContent={null}
      layoutVariant='course-booking'
      heroWhatsappCta={heroWhatsappCta}
      bookingSectionAfterHero={(
        <MyBestAuntieBooking
          locale={locale}
          content={siteContent.myBestAuntie.booking}
          initialCohorts={cohorts}
          modalContent={siteContent.myBestAuntie.modal}
          bookingModalContent={siteContent.bookingModal}
          commonAccessibility={siteContent.common.accessibility}
          thankYouWhatsappHref={publicSiteConfig.whatsappUrl}
          thankYouWhatsappCtaLabel={siteContent.contactUs.form.contactMethodLinks.whatsapp}
          privateProgrammeWhatsappHref={privateProgrammeWhatsappHref}
        />
      )}
    />
  );
}
