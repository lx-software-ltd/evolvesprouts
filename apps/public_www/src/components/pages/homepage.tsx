import type { Locale, SiteContent } from '@/content';
import { PageLayout } from '@/components/shared/page-layout';
import { FreeIntroSession } from '@/components/sections/free-intro-session';
import { RealTalk } from '@/components/sections/real-talk';
import { HeroBanner } from '@/components/sections/hero-banner';
import { AboutUsIntro } from '@/components/sections/about-us-intro';
import { Services } from '@/components/sections/services';
import { TestimonialsFeatured } from '@/components/sections/testimonials-featured';
import { DeferredTestimonials } from '@/components/sections/deferred-testimonials';
import { localizeHref } from '@/lib/locale-routing';
import { ROUTES } from '@/lib/routes';

interface HomePageProps {
  locale: Locale;
  content: SiteContent;
}

function resolveNavbarBookNowHref(bookNow: SiteContent['navbar']['bookNow']): string | undefined {
  if (
    'href' in bookNow
    && typeof bookNow.href === 'string'
    && bookNow.href.trim() !== ''
  ) {
    return bookNow.href;
  }

  return undefined;
}

export function HomePage({ locale, content }: HomePageProps) {
  const heroCtaHref = localizeHref(
    content.hero.ctaHref || ROUTES.servicesMyBestAuntieTrainingCourse,
    locale,
  );
  const navbarCtaHref = resolveNavbarBookNowHref(content.navbar.bookNow)
    || content.whatsappContact.href
    || ROUTES.servicesMyBestAuntieTrainingCourse;
  const homepageNavbarContent = {
    ...content.navbar,
    bookNow: {
      ...content.navbar.bookNow,
      href: navbarCtaHref,
    },
  };

  return (
    <PageLayout
      navbarContent={homepageNavbarContent}
      footerContent={content.footer}
    >
      <HeroBanner content={content.hero} ctaHref={heroCtaHref} />
      <RealTalk
        content={content.realTalk}
        commonAccessibility={content.common.accessibility}
      />
      <AboutUsIntro content={content.aboutUs.intro} />
      <Services
        content={content.services}
      />
      <TestimonialsFeatured content={content.testimonials.featured} />
      <DeferredTestimonials
        content={content.testimonials}
        commonAccessibility={content.common.accessibility}
      />
      <FreeIntroSession content={content.freeIntroSession} />
    </PageLayout>
  );
}
