import { render, screen } from '@testing-library/react';
import { type AnchorHTMLAttributes, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SectionCtaAnchor } from '@/components/sections/shared/section-cta-link';

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

describe('SectionCtaAnchor', () => {
  it('renders the shared external link icon for external href values', () => {
    render(<SectionCtaAnchor href='https://example.com'>Visit resource</SectionCtaAnchor>);

    const link = screen.getByRole('link', { name: 'Visit resource' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.className).toContain('es-btn');
    expect(link.className).toContain('es-btn--primary');
    const label = screen.getByText('Visit resource');
    expect(label.className).toContain('es-link-external-label');
    expect(label.className).not.toContain('es-link-external-label--direction');
    const externalIcon = link.querySelector('.es-ui-icon-mask--external-link');
    expect(externalIcon).not.toBeNull();
    expect(externalIcon?.getAttribute('class')).toContain('es-link-external-icon');
  });

  it('keeps the chevron icon for internal href values', () => {
    render(<SectionCtaAnchor href='/about-us'>About us</SectionCtaAnchor>);

    const link = screen.getByRole('link', { name: 'About us' });
    expect(link).not.toHaveAttribute('target');
    expect(link.className).toContain('es-btn');
    expect(link.className).toContain('es-btn--primary');
    expect(link.querySelector('.es-ui-icon-mask--external-link')).toBeNull();
    expect(link.querySelector('.es-ui-icon-mask--chevron-right')).not.toBeNull();
  });

  it('uses currentColor for outline chevron stroke', () => {
    render(
      <SectionCtaAnchor href='/about-us' variant='outline'>
        About us
      </SectionCtaAnchor>,
    );

    const link = screen.getByRole('link', { name: 'About us' });
    const chevron = link.querySelector('.es-ui-icon-mask--chevron-right');

    expect(link.className).toContain('es-btn--outline');
    expect(chevron).not.toBeNull();
    expect(chevron?.className).toContain('es-ui-icon-mask--chevron-right');
  });

  it('keeps non-HTTP protocols without external indicator styling', () => {
    render(<SectionCtaAnchor href='mailto:ida@example.com'>Email us</SectionCtaAnchor>);

    const link = screen.getByRole('link', { name: 'Email us' });
    expect(link).toHaveAttribute('href', 'mailto:ida@example.com');
    expect(link).not.toHaveAttribute('target');
    expect(link.querySelector('.es-ui-icon-mask--external-link')).toBeNull();
    expect(screen.getByText('Email us').className).not.toContain(
      'es-link-external-label',
    );
    expect(link.querySelector('.es-ui-icon-mask--chevron-right')).not.toBeNull();
  });
});
