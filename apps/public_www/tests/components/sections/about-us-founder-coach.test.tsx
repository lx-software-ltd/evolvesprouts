/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AboutUsFounderCoach } from '@/components/sections/about-us-founder-coach';
import enContent from '@/content/en.json';

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

describe('AboutUsFounderCoach section', () => {
  it('renders founder coach content, image, and credential chips', () => {
    render(<AboutUsFounderCoach content={enContent.aboutUs.coaches.founder} />);

    const section = document.getElementById('about-us-founder-coach');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('data-figma-node')).toBe('about-us-founder-coach');
    expect(section).toHaveClass('es-section-bg-overlay');
    expect(section).toHaveClass('es-about-us-founder-coach-section');
    expect(screen.getByText(enContent.aboutUs.coaches.founder.eyebrow)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: enContent.aboutUs.coaches.founder.title }))
      .toBeInTheDocument();
    expect(screen.getByText(enContent.aboutUs.coaches.founder.subtitle)).toBeInTheDocument();
    const portrait = screen.getByRole('img', {
      name: enContent.aboutUs.coaches.founder.imageAlt,
    });
    expect(portrait).toBeInTheDocument();
    expect(portrait).toHaveClass('scale-[2]');
    expect(portrait).toHaveClass('origin-top');
    expect(portrait).toHaveClass('object-top');

    const highlightedText = screen.getByText(enContent.aboutUs.coaches.founder.highlightedPhrase);
    expect(highlightedText).toHaveClass('es-highlight-word');

    for (const tag of enContent.aboutUs.coaches.founder.tags) {
      expect(screen.getByText(tag)).toBeInTheDocument();
    }
  });
});
