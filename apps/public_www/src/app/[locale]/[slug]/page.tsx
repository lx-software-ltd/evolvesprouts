import { notFound } from 'next/navigation';

import {
  isValidLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from '@/content';
import { LandingPage } from '@/components/pages/landing-pages/landing-page';
import { BookFreeCallLandingPage } from '@/components/pages/landing-pages/book-a-free-call';
import {
  HELPER_TRAINING_LANDING_PAGE_SLUG,
  HelperTrainingLandingPage,
} from '@/components/pages/landing-pages/helper-training-hong-kong';
import { StructuredDataScript } from '@/components/shared/structured-data-script';
import { fetchMyBestAuntieCohortsForPage } from '@/lib/fetch-my-best-auntie-cohorts';
import {
  getMenuLabel,
  resolveLocalePageContext,
} from '@/lib/locale-page';
import {
  fetchLandingPageCalendarPayload,
  getLandingPageBookingEventContentFromPayload,
  getLandingPageHeroEventContentFromPayload,
  getLandingPageStructuredDataContentFromPayload,
} from '@/lib/events-data';
import {
  buildLandingPagePath,
  getAllLandingPageSlugs,
  getLandingPageContent,
  isValidLandingPageSlug,
} from '@/lib/landing-pages';
import { ROUTES } from '@/lib/routes';
import { buildLocalizedMetadata } from '@/lib/seo';
import { buildBreadcrumbSchema } from '@/lib/structured-data';

interface LandingPageRouteProps {
  params: Promise<{ locale: string; slug: string }>;
}

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((locale) =>
    getAllLandingPageSlugs().map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({ params }: LandingPageRouteProps) {
  const { locale: rawLocale, slug } = await params;
  if (!isValidLocale(rawLocale) || !isValidLandingPageSlug(slug)) {
    notFound();
  }

  const locale: Locale = rawLocale;
  const pageContent = getLandingPageContent(slug, locale);
  if (!pageContent) {
    notFound();
  }

  return buildLocalizedMetadata({
    locale,
    path: buildLandingPagePath(slug),
    title: pageContent.meta.title,
    description: pageContent.meta.description,
    socialImage: {
      url: pageContent.meta.socialImage.url,
      alt: pageContent.meta.socialImage.alt,
    },
  });
}

export default async function LandingPageRoute({ params }: LandingPageRouteProps) {
  const resolvedParams = await params;
  const { locale, content: siteContent } = await resolveLocalePageContext(
    Promise.resolve({ locale: resolvedParams.locale }),
  );
  if (!isValidLandingPageSlug(resolvedParams.slug)) {
    notFound();
  }

  const landingPageSlug = resolvedParams.slug;
  const pageContent = getLandingPageContent(landingPageSlug, locale);
  if (!pageContent) {
    notFound();
  }

  const pagePath = buildLandingPagePath(landingPageSlug);

  const breadcrumbScript = (
    <StructuredDataScript
      id={`landing-page-breadcrumb-jsonld-${locale}`}
      data={buildBreadcrumbSchema({
        locale,
        items: [
          {
            name: getMenuLabel(siteContent, ROUTES.home),
            path: ROUTES.home,
          },
          {
            name: pageContent.meta.title,
            path: pagePath,
          },
        ],
      })}
    />
  );

  if (landingPageSlug === HELPER_TRAINING_LANDING_PAGE_SLUG) {
    const cohorts = await fetchMyBestAuntieCohortsForPage({
      reportContext: HELPER_TRAINING_LANDING_PAGE_SLUG,
      locale,
    });

    return (
      <>
        <HelperTrainingLandingPage
          locale={locale}
          pagePath={pagePath}
          siteContent={siteContent}
          pageContent={pageContent}
          cohorts={cohorts}
        />
        {breadcrumbScript}
      </>
    );
  }

  const { payload: calendarPayload } = await fetchLandingPageCalendarPayload({
    slug: landingPageSlug,
  });

  const heroEventContent = getLandingPageHeroEventContentFromPayload(
    calendarPayload,
    landingPageSlug,
    locale,
  );
  const bookingEventContent = getLandingPageBookingEventContentFromPayload(
    calendarPayload,
    landingPageSlug,
    locale,
  );
  const structuredDataContent = getLandingPageStructuredDataContentFromPayload(
    calendarPayload,
    landingPageSlug,
    locale,
  );

  const isBookFreeCall = landingPageSlug === 'book-a-free-call';

  return (
    <>
      {isBookFreeCall ? (
        <BookFreeCallLandingPage
          locale={locale}
          pagePath={pagePath}
          siteContent={siteContent}
          pageContent={pageContent}
        />
      ) : (
        <LandingPage
          locale={locale}
          slug={landingPageSlug}
          pagePath={pagePath}
          siteContent={siteContent}
          pageContent={pageContent}
          heroEventContent={heroEventContent}
          bookingEventContent={bookingEventContent}
          structuredDataContent={structuredDataContent}
        />
      )}
      {breadcrumbScript}
    </>
  );
}
