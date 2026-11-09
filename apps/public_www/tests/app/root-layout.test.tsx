import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Lato: () => ({ variable: '--font-lato' }),
  Poppins: () => ({ variable: '--font-poppins' }),
}));
vi.mock('next/script', () => ({
  __esModule: true,
  default: ({ src }: { src: string }) => <span data-testid='next-script' data-src={src} />,
}));

import { DEFAULT_LOCALE } from '@/content';
import RootLayout from '@/app/layout';

function renderLayout() {
  return renderToStaticMarkup(
    <RootLayout>
      <div>content</div>
    </RootLayout>,
  );
}

describe('RootLayout', () => {
  it('uses the default locale as the static html lang attribute', () => {
    expect(renderLayout()).toContain(`lang="${DEFAULT_LOCALE}"`);
  });

  it('includes the set-html-lang script for runtime locale detection', () => {
    expect(renderLayout()).toContain('data-src="/scripts/set-html-lang.js"');
  });
});
