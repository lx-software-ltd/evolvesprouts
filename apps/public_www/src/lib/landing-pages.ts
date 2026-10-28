import type {
  LandingPageContent,
  LandingPageLocaleContent,
  Locale,
} from '@/content';
import easter2026MontessoriPlayCoachingWorkshop from '@/content/landing-pages/easter-2026-montessori-play-coaching-workshop.json';
import bookAFreeCallJson from '@/content/landing-pages/book-a-free-call.json';
import may2026TheMissingPiece from '@/content/landing-pages/may-2026-the-missing-piece.json';
import nov2026MealtimesWorkshopJson from '@/content/landing-pages/nov-2026-mealtimes-workshop.json';
import { createDefaultLocaleRedirectPage } from '@/lib/locale-page';
import { RESERVED_PATH_SEGMENTS } from '@/lib/routes';

/** JSON literal chip `type` is inferred as `string`; assert to satisfy `LandingPageContent`. */
const bookAFreeCall = bookAFreeCallJson as LandingPageContent;
const nov2026MealtimesWorkshop = nov2026MealtimesWorkshopJson as LandingPageContent;

const LANDING_PAGES = {
  'book-a-free-call': bookAFreeCall,
  'easter-2026-montessori-play-coaching-workshop': easter2026MontessoriPlayCoachingWorkshop,
  'may-2026-the-missing-piece': may2026TheMissingPiece,
  'nov-2026-mealtimes-workshop': nov2026MealtimesWorkshop,
} satisfies Record<string, LandingPageContent>;

export type LandingPageSlug = keyof typeof LANDING_PAGES;

const LANDING_PAGE_SLUGS = Object.freeze(
  Object.keys(LANDING_PAGES) as LandingPageSlug[],
);

function assertNoLandingPageRouteCollisions(): void {
  for (const slug of LANDING_PAGE_SLUGS) {
    if (RESERVED_PATH_SEGMENTS.has(slug)) {
      throw new Error(
        `Landing page slug "${slug}" collides with a reserved path segment.`,
      );
    }
  }
}

assertNoLandingPageRouteCollisions();

export function getAllLandingPageSlugs(): LandingPageSlug[] {
  return [...LANDING_PAGE_SLUGS];
}

export function isValidLandingPageSlug(slug: string): slug is LandingPageSlug {
  return slug in LANDING_PAGES;
}

export function buildLandingPagePath(slug: LandingPageSlug | string): string {
  return `/${slug}`;
}

/**
 * Root (non-locale) redirect for static export. A matching `src/app/<slug>/page.tsx` must still exist.
 */
export function createLandingPageRootRedirect(slug: LandingPageSlug) {
  return createDefaultLocaleRedirectPage(buildLandingPagePath(slug));
}

export function getLandingPageContent(
  slug: string,
  locale: Locale,
): LandingPageLocaleContent | null {
  if (!isValidLandingPageSlug(slug)) {
    return null;
  }

  return LANDING_PAGES[slug][locale];
}
