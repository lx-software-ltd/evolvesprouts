/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AboutUsMyHistory } from '@/components/sections/about-us-my-history';
import enContent from '@/content/en.json';

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

describe('AboutUsMyHistory section', () => {
  it('uses shared overlay and section classes for the muted background', () => {
    render(<AboutUsMyHistory content={enContent.aboutUs.myHistory} />);

    const section = screen.getByRole('region', {
      name: enContent.aboutUs.myHistory.title,
    });

    expect(section.className).toContain('es-section-bg-overlay');
    expect(section.className).toContain('es-my-history-section');
  });

  it('renders each story paragraph from blank-line separated content', () => {
    render(<AboutUsMyHistory content={enContent.aboutUs.myHistory} />);

    const paragraphs = enContent.aboutUs.myHistory.description
      .split(/\n\s*\n/g)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);

    for (const paragraph of paragraphs) {
      expect(screen.getByText(paragraph)).toBeInTheDocument();
    }
  });

  it('interleaves mobile images into the story flow', () => {
    const { container } = render(<AboutUsMyHistory content={enContent.aboutUs.myHistory} />);

    const paragraphs = enContent.aboutUs.myHistory.description
      .split(/\n\s*\n/g)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    const firstMobileImage = container.querySelector('img.lg\\:hidden');
    const lastParagraph = screen.getByText(paragraphs[paragraphs.length - 1]);

    expect(firstMobileImage).toBeTruthy();
    expect(
      (firstMobileImage?.compareDocumentPosition(lastParagraph) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (firstMobileImage?.compareDocumentPosition(lastParagraph) ?? 0) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(0);
  });

  it('renders the updated stacked story images', () => {
    render(<AboutUsMyHistory content={enContent.aboutUs.myHistory} />);

    const imageOneVariants = screen.getAllByAltText(
      'A brief history image from Evolve Sprouts 1',
    );
    expect(imageOneVariants).toHaveLength(2);
    expect(
      imageOneVariants.some(
        (image) =>
          image.getAttribute('src') === '/images/about-us/founder-ims.webp',
      ),
    ).toBe(true);

    const imageTwoVariants = screen.getAllByAltText(
      'A brief history image from Evolve Sprouts 2',
    );
    expect(imageTwoVariants).toHaveLength(2);
    expect(
      imageTwoVariants.some(
        (image) =>
          image.getAttribute('src') ===
          '/images/about-us/founder-my-best-auntie-1.webp',
      ),
    ).toBe(true);

    const imageThreeVariants = screen.getAllByAltText(
      'A brief history image from Evolve Sprouts 3',
    );
    expect(imageThreeVariants).toHaveLength(2);
    expect(
      imageThreeVariants.some(
        (image) =>
          image.getAttribute('src') ===
          '/images/about-us/founder-my-best-auntie-2.webp',
      ),
    ).toBe(true);

    const storyImages = screen.getAllByRole('img', {
      name: /a brief history image from evolve sprouts/i,
    });
    expect(storyImages.length).toBeGreaterThan(0);

    for (const storyImage of storyImages) {
      expect(storyImage.className).toContain('rounded-card-sm');
      expect(storyImage.className).toContain('border');
      expect(storyImage.className).toContain('es-border-warm-3');
      expect(storyImage.className).toContain('brightness-[1.1]');
      expect(storyImage.className).toContain('contrast-[1.15]');
      expect(storyImage.className).toContain('saturate-[1.05]');
    }
  });
});
