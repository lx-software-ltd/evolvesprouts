import { render, screen } from '@testing-library/react';
import { type AnchorHTMLAttributes, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { HeroBanner } from '@/components/sections/hero-banner';
import enContent from '@/content/en.json';
import zhCNContent from '@/content/zh-CN.json';

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

describe('HeroBanner section', () => {
  it('uses migrated class-based styling and renders the provided CTA href', () => {
    const ctaHref = 'https://wa.me/123456?text=Hello';
    const { container } = render(
      <HeroBanner content={enContent.hero} ctaHref={ctaHref} />,
    );

    const section = container.querySelector('section[data-figma-node="hero-banner"]');
    expect(section).not.toBeNull();
    expect(section?.className).toContain('es-hero-section');
    expect(section?.className).toContain('es-section-shell-spacing');

    const frameBackground = container.querySelector('img.es-hero-frame-bg');
    expect(frameBackground).not.toBeNull();
    expect(frameBackground).toHaveAttribute('src', '/images/evolvesprouts-logo.svg');
    expect(frameBackground).toHaveAttribute('alt', '');
    expect(frameBackground).toHaveAttribute('aria-hidden', 'true');
    expect(frameBackground).toHaveAttribute('fetchpriority', 'low');

    const heroPhoto = screen.getByRole('img', { name: enContent.hero.imageAlt });
    expect(heroPhoto).toHaveAttribute('src', '/images/hero/child-hero.webp');
    expect(heroPhoto).toHaveAttribute('decoding', 'sync');
    expect(heroPhoto).toHaveAttribute('fetchpriority', 'high');

    const headline = screen.getByRole('heading', { level: 1 });
    expect(headline.className).toContain('es-hero-headline');
    expect(headline).toHaveTextContent(enContent.hero.title);
    expect(screen.getByText(enContent.hero.highlightPhrase)).toHaveClass(
      'es-highlight-word',
    );

    const subheadline = screen.getByText(enContent.hero.subtitle);
    expect(subheadline.className).toContain('es-hero-subheadline');

    const cta = screen.getByRole('link', { name: enContent.hero.cta });
    expect(cta).toHaveAttribute('href', ctaHref);
    const supportingParagraph = screen.getByText(enContent.hero.description);
    expect(supportingParagraph).toBeInTheDocument();
    expect(supportingParagraph.className).toContain('es-hero-subheadline');
  });

  it('applies locale-specific hero highlight phrase styling', () => {
    render(<HeroBanner content={zhCNContent.hero} />);

    expect(screen.getByText(zhCNContent.hero.highlightPhrase)).toHaveClass(
      'es-highlight-word',
    );
  });
});
