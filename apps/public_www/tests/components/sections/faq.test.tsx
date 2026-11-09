import { fireEvent, render, screen, within } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { type AnchorHTMLAttributes, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Faq } from '@/components/sections/faq';
import enContent from '@/content/en.json';
import { ROUTES } from '@/lib/routes';

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

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/zh-CN/about-us'),
}));

describe('Faq section', () => {
  it('uses the migrated FAQ section background class', () => {
    const { container } = render(<Faq content={enContent.faq} />);

    const section = container.querySelector('section[data-figma-node="faq"]');
    expect(
      section,
    ).not.toBeNull();
    expect(section?.className).toContain('es-section-bg-overlay');
    expect(section?.className).toContain('es-faq-section');
    const layoutContainers = section?.querySelectorAll('div.es-layout-container') ?? [];
    expect(layoutContainers).toHaveLength(1);
  });

  it('renders the fallback prompt as a blue card with contact CTA', () => {
    render(<Faq content={enContent.faq} />);

    const fallbackQuestion = enContent.faq.questions.find(
      (item) => item.question === 'Have not found what you need?',
    );
    if (!fallbackQuestion) {
      throw new Error('Expected fallback FAQ prompt in content fixture');
    }

    const questionHeading = screen.getByRole('heading', {
      level: 3,
      name: fallbackQuestion.question,
    });
    expect(questionHeading.className).toContain('es-faq-contact-question');

    const card = questionHeading.closest('article');
    expect(card).not.toBeNull();
    expect(card?.className).toContain('es-faq-contact-card');
    expect(card?.querySelector('div[class*="border-l"]')).toBeNull();

    const answer = screen.getByText(fallbackQuestion.answer);
    expect(answer.className).toContain('es-faq-contact-answer');

    const contactCta = within(card as HTMLElement).getByRole('link', {
      name: 'Contact Us',
    });
    expect(contactCta).toHaveAttribute('href', '/zh-CN/contact-us/');
    expect(contactCta.className).toContain('es-btn');
    expect(contactCta.className).toContain('es-btn--primary');
  });

  it('uses shared button states for category buttons and a grey search input', () => {
    const { container } = render(<Faq content={enContent.faq} />);

    const firstLabel = enContent.faq.labels[0];
    const secondLabel = enContent.faq.labels[1];
    if (!firstLabel || !secondLabel) {
      throw new Error('Expected at least two FAQ labels in content fixture');
    }

    const activeLabelButton = screen.getByRole('button', {
      name: firstLabel.label,
    });
    const inactiveLabelButton = screen.getByRole('button', {
      name: secondLabel.label,
    });

    expect(activeLabelButton.className).toContain('es-btn');
    expect(activeLabelButton.className).toContain('es-btn--pill');
    expect(activeLabelButton.className).toContain('es-btn--state-active');
    expect(inactiveLabelButton.className).toContain('es-btn');
    expect(inactiveLabelButton.className).toContain('es-btn--pill');
    expect(inactiveLabelButton.className).toContain('es-btn--state-inactive');

    const searchInput = screen.getByRole('textbox', {
      name: enContent.faq.searchPlaceholder,
    });
    expect(searchInput.className).toContain('es-bg-surface-neutral');
    expect(searchInput.className).not.toMatch(/\bpy-/);

    const searchWrapper = container.querySelector('div.mt-8.rounded-full');
    expect(searchWrapper?.className).toContain('es-bg-surface-neutral');
  });

  it('clears search and shows cards for the selected topic when clicking a label', () => {
    render(<Faq content={enContent.faq} />);

    const secondLabel = enContent.faq.labels[1];
    if (!secondLabel) {
      throw new Error('Expected second FAQ label in fixture');
    }

    const searchInput = screen.getByRole('textbox', {
      name: enContent.faq.searchPlaceholder,
    }) as HTMLInputElement;
    fireEvent.change(searchInput, {
      target: { value: 'zzzzzzzz-no-results' },
    });
    expect(searchInput.value).toBe('zzzzzzzz-no-results');
    expect(screen.getByText(enContent.faq.emptySearchResultsLabel)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: secondLabel.label }));

    expect(searchInput.value).toBe('');
    expect(screen.queryByText(enContent.faq.emptySearchResultsLabel)).toBeNull();

    const visibleQuestionHeadings = screen.getAllByRole('heading', { level: 3 });
    expect(visibleQuestionHeadings.length).toBeGreaterThan(0);

    for (const heading of visibleQuestionHeadings) {
      const text = heading.textContent;
      const question = enContent.faq.questions.find((entry) => entry.question === text);
      expect(question).toBeDefined();
      expect(question?.labelIds).toContain(secondLabel.id);
    }
  });

  it('shows consultation-only FAQs on the consultations service path', () => {
    vi.mocked(usePathname).mockReturnValue(`/en${ROUTES.servicesConsultations}`);

    render(<Faq content={enContent.faq} />);

    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'Do I need to have a helper to book a consultation?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        level: 3,
        name: 'What will my child gain from the My Best Auntie course?',
      }),
    ).toBeNull();
  });

  it('shows MBA-only FAQs on the training course service path', () => {
    vi.mocked(usePathname).mockReturnValue(`/en${ROUTES.servicesMyBestAuntieTrainingCourse}`);

    render(<Faq content={enContent.faq} />);

    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'What will my child gain from the My Best Auntie course?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        level: 3,
        name: 'Do I need to have a helper to book a consultation?',
      }),
    ).toBeNull();
  });
});
