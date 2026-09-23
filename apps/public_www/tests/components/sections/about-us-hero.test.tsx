/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AboutUsHero } from '@/components/sections/about-us-hero';
import enContent from '@/content/en.json';

vi.mock('next/image', () => ({
  default: ({
    alt,
    priority: _priority,
    ...props
  }: {
    alt?: string;
    priority?: boolean;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

describe('AboutUsHero', () => {
  it('removes mobile top padding while preserving responsive section spacing', () => {
    render(<AboutUsHero content={enContent.aboutUs.hero} />);

    const section = document.getElementById('about-us-hero');
    expect(section).not.toBeNull();
    expect(section?.className).toContain('pt-0');
    expect(section?.className).toContain('sm:pt-[60px]');
  });

  it('renders hero copy and portrait image without a CTA link', () => {
    const content = enContent.aboutUs.hero;
    render(<AboutUsHero content={content} />);

    expect(screen.getByRole('heading', { name: content.title })).toBeInTheDocument();
    expect(screen.getByText(content.subtitle)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: content.imageAlt,
      }),
    ).toBeInTheDocument();
  });
});
