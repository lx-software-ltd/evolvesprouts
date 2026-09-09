import { Lato, Poppins } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { SITE_COMMON } from '@/content/site-types';

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

export const metadata: Metadata = {
  title: SITE_COMMON.metadata.title,
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
  },
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' className={`${lato.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
