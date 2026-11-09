/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { type AnchorHTMLAttributes, type ReactNode } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Footer } from '@/components/sections/footer';
import enContent from '@/content/en.json';

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    scroll: _scroll,
    ...props
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
    scroll?: boolean;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('Footer external links', () => {
  const originalLinkedinUrl = process.env.NEXT_PUBLIC_LINKEDIN_URL;
  const originalInstagramUrl = process.env.NEXT_PUBLIC_INSTAGRAM_URL;
  const originalWhatsappUrl = process.env.NEXT_PUBLIC_WHATSAPP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_LINKEDIN_URL = 'https://www.linkedin.com/company/evolve-sprouts';
    process.env.NEXT_PUBLIC_INSTAGRAM_URL = 'https://www.instagram.com/evolvesprouts';
    process.env.NEXT_PUBLIC_WHATSAPP_URL = 'https://wa.me/15550001234';
  });

  afterEach(() => {
    if (typeof originalLinkedinUrl === 'string') {
      process.env.NEXT_PUBLIC_LINKEDIN_URL = originalLinkedinUrl;
    } else {
      delete process.env.NEXT_PUBLIC_LINKEDIN_URL;
    }

    if (typeof originalInstagramUrl === 'string') {
      process.env.NEXT_PUBLIC_INSTAGRAM_URL = originalInstagramUrl;
    } else {
      delete process.env.NEXT_PUBLIC_INSTAGRAM_URL;
    }

    if (typeof originalWhatsappUrl === 'string') {
      process.env.NEXT_PUBLIC_WHATSAPP_URL = originalWhatsappUrl;
    } else {
      delete process.env.NEXT_PUBLIC_WHATSAPP_URL;
    }
  });

  it('adds the shared external icon to social links only', () => {
    render(<Footer content={enContent.footer} />);

    const sharedContainers = document.querySelectorAll('.es-layout-container');
    expect(sharedContainers.length).toBeGreaterThan(0);

    const linkedInLinks = screen.getAllByRole('link', { name: 'LinkedIn' });
    expect(linkedInLinks.length).toBeGreaterThan(0);
    for (const link of linkedInLinks) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.querySelector('span:last-of-type')?.className).toContain(
        'es-link-external-label',
      );
      const externalIcon = link.querySelector('.es-ui-icon-mask--external-link');
      expect(externalIcon).not.toBeNull();
      expect(externalIcon?.getAttribute('class')).toContain('es-link-external-icon');
    }
    const linkedInSocialIcons = document.querySelectorAll(
      'img[src="/images/contact-linkedin.svg"]',
    );
    expect(linkedInSocialIcons.length).toBeGreaterThan(0);
    const instagramSocialIcons = document.querySelectorAll(
      'img[src="/images/contact-instagram.svg"]',
    );
    expect(instagramSocialIcons.length).toBeGreaterThan(0);
    const whatsappSocialIcons = document.querySelectorAll(
      'img[src="/images/contact-whatsapp.svg"]',
    );
    expect(whatsappSocialIcons.length).toBeGreaterThan(0);
    const whatsappLinks = screen.getAllByRole('link', { name: 'WhatsApp' });
    expect(whatsappLinks.length).toBeGreaterThan(0);
    for (const link of whatsappLinks) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.className).toContain('whitespace-nowrap');
    }
    expect(screen.queryByRole('link', { name: 'Facebook' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Tiktok/i })).toBeNull();

    const homeLinks = screen.getAllByRole('link', { name: 'Home' });
    expect(homeLinks.length).toBeGreaterThan(0);
    for (const link of homeLinks) {
      expect(link.querySelector('span:last-of-type')?.className ?? '').not.toContain(
        'es-link-external-label',
      );
      expect(link.querySelector('.es-ui-icon-mask--external-link')).toBeNull();
    }

    for (const link of linkedInLinks) {
      expect(link.className).toContain('whitespace-nowrap');
    }
    const instagramLinks = screen.getAllByRole('link', { name: 'Instagram' });
    expect(instagramLinks.length).toBeGreaterThan(0);
    for (const link of instagramLinks) {
      expect(link.className).toContain('whitespace-nowrap');
    }
    const contactUsLinks = screen.getAllByRole('link', { name: 'Contact Us' });
    expect(contactUsLinks.length).toBeGreaterThan(0);
    for (const link of contactUsLinks) {
      expect(link.className).not.toContain('whitespace-nowrap');
    }
  });

  it('keeps mobile logo non-interactive and full-width accordion tap targets', () => {
    render(<Footer content={enContent.footer} />);

    const footerTopSection = document.querySelector('footer section');
    expect(footerTopSection?.className).toContain('es-section-shell-spacing');

    const mobileFooterSection = document.querySelector('div.sm\\:hidden');
    expect(mobileFooterSection).not.toBeNull();
    expect(mobileFooterSection).toHaveAttribute(
      'data-css-fallback',
      'hide-when-css-missing',
    );
    expect(
      mobileFooterSection?.querySelector('div.pointer-events-none'),
    ).not.toBeNull();
    const mobileLogo = mobileFooterSection?.querySelector(
      'img[src="/images/evolvesprouts-logo.svg"]',
    ) as HTMLImageElement | null;
    expect(mobileLogo).not.toBeNull();
    expect(mobileLogo?.className).toContain('-mt-[100px]');
    expect(mobileLogo?.className).toContain('-mb-[50px]');
    expect(mobileLogo?.className).toContain('lg:-my-[100px]');

    const cssFallbackElements = document.querySelectorAll(
      '[data-css-fallback="hide-when-css-missing"]',
    );
    expect(cssFallbackElements).toHaveLength(2);

    const accordionSummaries = document.querySelectorAll('summary');
    expect(accordionSummaries.length).toBeGreaterThan(0);
    for (const summary of accordionSummaries) {
      expect(summary.className).toContain('w-full');
    }
  });

  it('removes desktop gap around the centered logo column', () => {
    render(<Footer content={enContent.footer} />);

    const desktopGrid = document.querySelector(
      'div.hidden.grid-cols-1',
    ) as HTMLDivElement | null;
    expect(desktopGrid).not.toBeNull();
    expect(desktopGrid?.className).toContain('lg:gap-x-0');
    expect(desktopGrid?.className).toContain(
      'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,500px)_minmax(0,1fr)_minmax(0,1fr)]',
    );

    const desktopColumns = desktopGrid?.querySelectorAll('section') ?? [];
    expect(desktopColumns).toHaveLength(4);
    expect(desktopColumns[1]?.className).toContain('lg:pl-6');
    expect(desktopColumns[2]?.className).not.toContain('lg:pl-6');
    expect(desktopColumns[3]?.className).toContain('lg:pl-6');
  });

  it('keeps connect links visible with internal fallback hrefs when env social URLs are missing', () => {
    delete process.env.NEXT_PUBLIC_LINKEDIN_URL;
    delete process.env.NEXT_PUBLIC_INSTAGRAM_URL;
    delete process.env.NEXT_PUBLIC_WHATSAPP_URL;

    render(<Footer content={enContent.footer} />);

    const linkedInLinks = screen.getAllByRole('link', { name: 'LinkedIn' });
    expect(linkedInLinks.length).toBeGreaterThan(0);
    for (const link of linkedInLinks) {
      expect(link).toHaveAttribute('href', '/en/contact-us/');
    }

    const instagramLinks = screen.getAllByRole('link', { name: 'Instagram' });
    expect(instagramLinks.length).toBeGreaterThan(0);
    for (const link of instagramLinks) {
      expect(link).toHaveAttribute('href', '/en/contact-us/');
    }

    const whatsappLinks = screen.getAllByRole('link', { name: 'WhatsApp' });
    expect(whatsappLinks.length).toBeGreaterThan(0);
    for (const link of whatsappLinks) {
      expect(link).toHaveAttribute('href', '/en/contact-us/');
    }
  });
});
