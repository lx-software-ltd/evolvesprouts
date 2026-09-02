import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';

import { AdminQueryProvider } from '@/components/admin-query-provider';
import { AuthProvider } from '@/components/auth-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Evolve Sprouts Admin',
  description: 'Admin access portal for Evolve Sprouts operations.',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const adminGtmContainerId = process.env.NEXT_PUBLIC_ADMIN_GTM_CONTAINER_ID?.trim() ?? '';
const adminGtmContainerIdJson = JSON.stringify(adminGtmContainerId);

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang='en'>
      <body className='antialiased'>
        {adminGtmContainerId ? (
          <Script id='admin-google-tag-manager' strategy='afterInteractive'>
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${adminGtmContainerIdJson});`}
          </Script>
        ) : null}
        <AdminQueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </AdminQueryProvider>
      </body>
    </html>
  );
}
