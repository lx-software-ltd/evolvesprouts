import { Lato, Poppins } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';

import { DEFAULT_LOCALE } from '@/content';
import enContent from '@/content/en.json';
import { GoogleTagManager } from '@/components/shared/google-tag-manager';
import { MetaPixel } from '@/components/shared/meta-pixel';
import {
  DEFAULT_SOCIAL_IMAGE,
  DEFAULT_SOCIAL_IMAGE_HEIGHT,
  DEFAULT_SOCIAL_IMAGE_WIDTH,
  getSiteHost,
  getSiteOrigin,
  SITE_TITLE_SUFFIX,
} from '@/lib/seo';
import './globals.css';

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || '';
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '';

function resolveGtmAllowedHosts(): string {
  const configuredHosts = process.env.NEXT_PUBLIC_GTM_ALLOWED_HOSTS;
  if (!configuredHosts || configuredHosts.trim() === '') {
    return getSiteHost();
  }

  return configuredHosts;
}

function resolveMetaPixelAllowedHosts(): string {
  const configuredHosts = process.env.NEXT_PUBLIC_META_PIXEL_ALLOWED_HOSTS;
  if (!configuredHosts || configuredHosts.trim() === '') {
    return getSiteHost();
  }

  return configuredHosts;
}

const lato = Lato({
  subsets: ['latin'],
  variable: '--font-lato',
  weight: ['400', '700'],
  style: ['normal'],
  display: 'swap',
  preload: true,
});

const poppins = Poppins({
  subsets: ['latin'],
  variable: '--font-poppins',
  weight: ['600', '700'],
  style: ['normal'],
  display: 'swap',
  preload: true,
});

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getSiteOrigin()),
    title: enContent.seo.fallbackTitle,
    description: enContent.seo.fallbackDescription,
    icons: {
      icon: '/favicon.ico',
      shortcut: '/favicon.ico',
    },
    openGraph: {
      title: enContent.seo.fallbackTitle,
      description: enContent.seo.fallbackDescription,
      siteName: SITE_TITLE_SUFFIX,
      type: 'website',
      images: [
        {
          url: DEFAULT_SOCIAL_IMAGE,
          alt: enContent.seo.defaultSocialImageAlt,
          width: DEFAULT_SOCIAL_IMAGE_WIDTH,
          height: DEFAULT_SOCIAL_IMAGE_HEIGHT,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: enContent.seo.fallbackTitle,
      description: enContent.seo.fallbackDescription,
      images: [DEFAULT_SOCIAL_IMAGE],
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const gtmAllowedHosts = resolveGtmAllowedHosts();
  const metaPixelAllowedHosts = resolveMetaPixelAllowedHosts();

  return (
    <html
      lang={DEFAULT_LOCALE}
      suppressHydrationWarning
      className={`${lato.variable} ${poppins.variable}`}
      {...(GTM_ID
        ? {
            'data-gtm-id': GTM_ID,
            'data-gtm-allowed-hosts': gtmAllowedHosts,
          }
        : {})}
      {...(META_PIXEL_ID
        ? {
            'data-meta-pixel-id': META_PIXEL_ID,
            'data-meta-pixel-allowed-hosts': metaPixelAllowedHosts,
          }
        : {})}
    >
      <body className='antialiased' suppressHydrationWarning>
        <Script src='/scripts/set-html-lang.js' strategy='beforeInteractive' />
        <Script src='/scripts/hide-css-sensitive-duplicates.js' strategy='afterInteractive' />
        <GoogleTagManager />
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
