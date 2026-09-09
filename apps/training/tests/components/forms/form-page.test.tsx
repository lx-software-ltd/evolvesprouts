import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormPage } from '@/components/forms/form-page';
import { FORMS_COMMON, getFormContent } from '@/lib/forms';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const form = getFormContent('workshop-feedback');

describe('FormPage branding', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links the logo to the public website home when origin is configured', () => {
    if (!form) {
      throw new Error('Expected workshop-feedback form content');
    }
    vi.stubEnv('NEXT_PUBLIC_PUBLIC_WWW_ORIGIN', 'https://www.evolvesprouts.com');

    render(<FormPage form={form} common={FORMS_COMMON} />);

    const link = screen.getByRole('link', { name: 'Go to the Evolve Sprouts website' });
    expect(link).toHaveAttribute('href', 'https://www.evolvesprouts.com/en/');
    expect(screen.getByRole('img', { name: 'Evolve Sprouts' })).toBeInTheDocument();
  });

  it('renders the logo without a link when public origin is unset', () => {
    if (!form) {
      throw new Error('Expected workshop-feedback form content');
    }
    vi.stubEnv('NEXT_PUBLIC_PUBLIC_WWW_ORIGIN', '');

    render(<FormPage form={form} common={FORMS_COMMON} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('img', { name: 'Evolve Sprouts' })).toBeInTheDocument();
  });

  it('applies English fallbacks to the page title on personalised forms', () => {
    render(
      <FormPage
        form={{
          title: 'Hello {contactFirstName}',
          slug: 'family-check-in',
          requiresContact: true,
          questions: [
            {
              id: 'q1',
              type: 'text',
              question: 'How is {children.firstName}?',
            },
          ],
        }}
        common={FORMS_COMMON}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello there');
    expect(screen.getByText('How is your child?')).toBeInTheDocument();
  });
});
