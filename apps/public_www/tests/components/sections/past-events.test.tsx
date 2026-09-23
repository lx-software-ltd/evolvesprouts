import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PastEvents } from '@/components/sections/past-events';
import enContent from '@/content/en.json';
import {
  createPublicCrmApiClient,
  type CrmApiClient,
} from '@/lib/crm-api-client';

vi.mock('@/lib/crm-api-client', () => ({
  createPublicCrmApiClient: vi.fn(),
  isAbortRequestError: (error: unknown) =>
    error instanceof Error && error.name === 'AbortError',
}));

describe('PastEvents section', () => {
  const mockedCreateCrmApiClient = vi.mocked(createPublicCrmApiClient);

  beforeEach(() => {
    mockedCreateCrmApiClient.mockReset();
    mockedCreateCrmApiClient.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders past events section heading and empty state', () => {
    render(
      <PastEvents
        content={enContent.events}
      />,
    );

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: enContent.events.past.title,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(enContent.events.past.emptyStateLabel)).toBeInTheDocument();
  });

  it('shows loading state while events request is pending', () => {
    const pendingRequest = vi.fn(() => new Promise<unknown>(() => {}));
    const mockApiClient: CrmApiClient = {
      request: pendingRequest,
    };
    mockedCreateCrmApiClient.mockReturnValue(mockApiClient);

    render(
      <PastEvents
        content={enContent.events}
      />,
    );

    expect(
      screen.getByRole('status', {
        name: enContent.events.loadingLabel,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('past-events-loading-gear')).toHaveClass('animate-spin');
  });

  it('hides reserve and fully booked actions for past events cards', async () => {
    const mockApiClient: CrmApiClient = {
      request: vi.fn().mockResolvedValue({
        status: 'success',
        data: [
          {
            title: 'Past event with booking metadata',
            location: 'physical',
            address: 'Example Hall, Hong Kong',
            address_url: 'https://maps.google.com/?q=Example+Hall+Hong+Kong',
            dates: [
              {
                start_datetime: '2024-02-01T09:00:00Z',
                end_datetime: '2024-02-01T10:00:00Z',
              },
            ],
            is_fully_booked: true,
          },
        ],
      }),
    };
    mockedCreateCrmApiClient.mockReturnValue(mockApiClient);

    render(
      <PastEvents
        content={enContent.events}
      />,
    );

    await screen.findByText('Past event with booking metadata');

    expect(
      screen.queryByRole('link', {
        name: enContent.events.card.ctaLabel,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(enContent.events.card.fullyBookedLabel),
    ).not.toBeInTheDocument();
  });
});
