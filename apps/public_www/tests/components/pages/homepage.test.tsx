import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HomePage } from '@/components/pages/homepage';
import { getContent } from '@/content';
import enContent from '@/content/en.json';

const WHATSAPP_URL_ENV_KEY = 'NEXT_PUBLIC_WHATSAPP_URL';
const BUSINESS_PHONE_ENV_KEY = 'NEXT_PUBLIC_BUSINESS_PHONE_NUMBER';
const originalWhatsappUrlEnv = process.env[WHATSAPP_URL_ENV_KEY];
const originalBusinessPhoneEnv = process.env[BUSINESS_PHONE_ENV_KEY];

afterEach(() => {
  if (typeof originalWhatsappUrlEnv === 'string') {
    process.env[WHATSAPP_URL_ENV_KEY] = originalWhatsappUrlEnv;
  } else {
    delete process.env[WHATSAPP_URL_ENV_KEY];
  }

  if (typeof originalBusinessPhoneEnv === 'string') {
    process.env[BUSINESS_PHONE_ENV_KEY] = originalBusinessPhoneEnv;
  } else {
    delete process.env[BUSINESS_PHONE_ENV_KEY];
  }
});

const heroBannerPropsSpy = vi.fn<
  (props: { content: { title: string }; ctaHref?: string }) => void
>();
const pageLayoutPropsSpy = vi.fn<
  (props: { navbarContent: { bookNow: { href: string; label: string } } }) => void
>();
const freeIntroSessionPropsSpy = vi.fn<
  (props: { content: { title: string; ctaHref: string } }) => void
>();
const servicesPropsSpy = vi.fn<
  (props: {
    content: { title: string };
    commonAccessibility?: { carouselRoleDescription?: string };
  }) => void
>();

vi.mock('@/components/shared/page-layout', () => ({
  PageLayout: ({
    children,
    navbarContent,
  }: {
    children: ReactNode;
    navbarContent: { bookNow: { href: string; label: string } };
  }) => {
    pageLayoutPropsSpy({ navbarContent });
    return <div data-testid='page-layout'>{children}</div>;
  },
}));
vi.mock('@/components/sections/hero-banner', () => ({
  HeroBanner: ({
    content,
    ctaHref,
  }: {
    content: { title: string };
    ctaHref?: string;
  }) => {
    heroBannerPropsSpy({ content, ctaHref });
    return <section data-testid='hero-banner'>{content.title}</section>;
  },
}));
vi.mock('@/components/sections/real-talk', () => ({
  RealTalk: ({ content }: { content: { title: string } }) => (
    <section data-testid='real-talk'>{content.title}</section>
  ),
}));
vi.mock('@/components/sections/about-us-intro', () => ({
  AboutUsIntro: ({ content }: { content: { title: string; description: string } }) => (
    <section data-testid='about-us-intro'>
      <h2>{content.title}</h2>
      <p>{content.description}</p>
    </section>
  ),
}));
vi.mock('@/components/sections/services', () => ({
  Services: ({
    content,
    commonAccessibility,
  }: {
    content: { title: string };
    commonAccessibility?: { carouselRoleDescription?: string };
  }) => {
    servicesPropsSpy({ content, commonAccessibility });
    return <section data-testid='services'>{content.title}</section>;
  },
}));
vi.mock('@/components/sections/testimonials-featured', () => ({
  TestimonialsFeatured: ({
    content,
  }: {
    content: { quote: string; author: string };
  }) => (
    <section data-testid='testimonials-featured'>
      {content.quote}
      {content.author}
    </section>
  ),
}));
vi.mock('@/components/sections/deferred-testimonials', () => ({
  DeferredTestimonials: ({ content }: { content: { title: string } }) => (
    <section data-testid='deferred-testimonials'>{content.title}</section>
  ),
}));
vi.mock('@/components/sections/free-intro-session', () => ({
  FreeIntroSession: ({ content }: { content: { title: string; ctaHref: string } }) => {
    freeIntroSessionPropsSpy({ content });
    return <section data-testid='free-intro-session'>{content.title}</section>;
  },
}));

describe('HomePage', () => {
  it('composes homepage sections with the expected content slices', () => {
    process.env[WHATSAPP_URL_ENV_KEY] = 'https://wa.me/message/ZQHVW4DEORD5A1?src=qr';
    delete process.env[BUSINESS_PHONE_ENV_KEY];
    heroBannerPropsSpy.mockClear();
    pageLayoutPropsSpy.mockClear();
    freeIntroSessionPropsSpy.mockClear();
    servicesPropsSpy.mockClear();
    render(<HomePage locale='en' content={getContent('en')} />);

    expect(screen.getByTestId('page-layout')).toBeInTheDocument();
    expect(screen.getByTestId('hero-banner')).toBeInTheDocument();
    expect(screen.getByTestId('real-talk')).toBeInTheDocument();
    expect(screen.getByTestId('about-us-intro')).toBeInTheDocument();
    expect(screen.getByTestId('services')).toBeInTheDocument();
    expect(screen.getByTestId('testimonials-featured')).toBeInTheDocument();
    expect(screen.getByTestId('deferred-testimonials')).toBeInTheDocument();
    expect(screen.getByTestId('free-intro-session')).toBeInTheDocument();
    expect(screen.getByText(enContent.hero.title)).toBeInTheDocument();
    expect(screen.getByText(enContent.aboutUs.intro.title)).toBeInTheDocument();
    expect(screen.getByText(enContent.aboutUs.intro.description)).toBeInTheDocument();
    expect(
      screen.getByTestId('services'),
    ).toHaveTextContent(enContent.services.title);
    expect(heroBannerPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ctaHref: '/en/services/my-best-auntie-training-course/',
      }),
    );
    expect(heroBannerPropsSpy).toHaveBeenCalledTimes(1);
    expect(pageLayoutPropsSpy).toHaveBeenCalledTimes(1);
    expect(freeIntroSessionPropsSpy).toHaveBeenCalledTimes(1);
    expect(servicesPropsSpy).toHaveBeenCalledTimes(1);

    const heroProps = heroBannerPropsSpy.mock.calls[0][0];
    const pageLayoutProps = pageLayoutPropsSpy.mock.calls[0][0];
    const freeIntroProps = freeIntroSessionPropsSpy.mock.calls[0][0];
    expect(pageLayoutProps.navbarContent.bookNow.href).toBe(
      '/book-a-free-call#intro-call-booking',
    );
    expect(pageLayoutProps.navbarContent.bookNow.href).not.toBe(heroProps.ctaHref);
    expect(pageLayoutProps.navbarContent.bookNow.label).toBe(
      enContent.navbar.bookNow.label,
    );
    expect(freeIntroProps.content.ctaHref).toBe('/book-a-free-call#intro-call-booking');

    const heroElement = screen.getByTestId('hero-banner');
    const realTalkElement = screen.getByTestId('real-talk');
    const idaIntroElement = screen.getByTestId('about-us-intro');
    const servicesElement = screen.getByTestId('services');
    const featuredQuoteElement = screen.getByTestId('testimonials-featured');
    const testimonialsElement = screen.getByTestId('deferred-testimonials');
    expect(heroElement.compareDocumentPosition(realTalkElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(realTalkElement.compareDocumentPosition(idaIntroElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(servicesElement.compareDocumentPosition(featuredQuoteElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(featuredQuoteElement.compareDocumentPosition(testimonialsElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(featuredQuoteElement).toHaveTextContent(enContent.testimonials.featured.quote);
    expect(featuredQuoteElement).toHaveTextContent(enContent.testimonials.featured.author);
  });

  it('uses locale navbar prefill message when business phone is configured', () => {
    process.env[WHATSAPP_URL_ENV_KEY] = 'https://wa.me/message/ZQHVW4DEORD5A1?src=qr';
    process.env[BUSINESS_PHONE_ENV_KEY] = '+1 555 000 1234';
    heroBannerPropsSpy.mockClear();
    pageLayoutPropsSpy.mockClear();
    freeIntroSessionPropsSpy.mockClear();
    servicesPropsSpy.mockClear();

    const localizedContent = getContent('zh-HK');
    render(<HomePage locale='zh-HK' content={localizedContent} />);

    expect(pageLayoutPropsSpy).toHaveBeenCalledTimes(1);
    expect(freeIntroSessionPropsSpy).toHaveBeenCalledTimes(1);
    expect(servicesPropsSpy).toHaveBeenCalledTimes(1);
    const pageLayoutProps = pageLayoutPropsSpy.mock.calls[0][0];
    const freeIntroProps = freeIntroSessionPropsSpy.mock.calls[0][0];
    expect(pageLayoutProps.navbarContent.bookNow.href).toBe(
      '/book-a-free-call#intro-call-booking',
    );
    expect(freeIntroProps.content.ctaHref).toBe('/book-a-free-call#intro-call-booking');

    expect(pageLayoutProps.navbarContent.bookNow.label).toBe(
      localizedContent.navbar.bookNow.label,
    );
  });
});
