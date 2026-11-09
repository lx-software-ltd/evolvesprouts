/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { type AnchorHTMLAttributes, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { HeroBanner } from '@/components/sections/hero-banner';
import enContent from '@/content/en.json';
import zhCNContent from '@/content/zh-CN.json';

vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    priority: _priority,
    ...props
  }: {
    alt?: string;
    fill?: boolean;
    priority?: boolean;
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

    const frameBackground = container.querySelector('.es-hero-frame-bg');
    expect(frameBackground).not.toBeNull();

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
