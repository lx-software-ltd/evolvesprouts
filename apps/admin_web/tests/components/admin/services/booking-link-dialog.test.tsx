import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookingLinkDialog } from '@/components/admin/services/booking-link-dialog';
import { trackAdminAnalyticsEvent } from '@/lib/admin-analytics';

vi.mock('@/lib/admin-analytics', () => ({
  trackAdminAnalyticsEvent: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getPublicSiteBaseUrl: () => 'https://www.example.com',
}));

vi.mock('@/lib/qr-code-image', () => ({
  generatePublicSiteQrPngDataUrl: vi.fn(async () => 'data:image/png;base64,AA'),
}));

const instanceProps = {
  parentServiceKey: 'my-best-auntie-training-course',
  parentServiceType: 'training_course',
  parentServiceTier: '1-3',
  slug: 'my-best-auntie-1-3-apr-26',
};

describe('BookingLinkDialog', () => {
  afterEach(() => {
    vi.mocked(trackAdminAnalyticsEvent).mockClear();
    vi.restoreAllMocks();
  });

  it('shows the cohort booking URL and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<BookingLinkDialog open onClose={() => {}} {...instanceProps} />);

    const preview = await screen.findByRole('link', {
      name: 'https://www.example.com/en/services/my-best-auntie-training-course/?booking_system=my-best-auntie-booking&service_tier=1-3&cohort=my-best-auntie-1-3-apr-26#my-best-auntie-booking',
    });
    expect(preview).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Locale'), { target: { value: 'zh-HK' } });

    expect(
      await screen.findByRole('link', {
        name: 'https://www.example.com/zh-HK/services/my-best-auntie-training-course/?booking_system=my-best-auntie-booking&service_tier=1-3&cohort=my-best-auntie-1-3-apr-26#my-best-auntie-booking',
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'https://www.example.com/zh-HK/services/my-best-auntie-training-course/?booking_system=my-best-auntie-booking&service_tier=1-3&cohort=my-best-auntie-1-3-apr-26#my-best-auntie-booking',
      );
    });
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it('records an open once per dialog, including after a locale change', () => {
    const onClose = vi.fn();
    const view = render(<BookingLinkDialog open onClose={onClose} {...instanceProps} />);

    expect(trackAdminAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(trackAdminAnalyticsEvent).toHaveBeenCalledWith(
      'admin_booking_link_opened',
      expect.objectContaining({ locale: 'en' }),
    );

    fireEvent.change(screen.getByLabelText('Locale'), { target: { value: 'zh-HK' } });
    expect(trackAdminAnalyticsEvent).toHaveBeenCalledTimes(1);

    view.rerender(<BookingLinkDialog open={false} onClose={onClose} {...instanceProps} />);
    view.rerender(<BookingLinkDialog open onClose={onClose} {...instanceProps} />);
    expect(trackAdminAnalyticsEvent).toHaveBeenCalledTimes(2);
  });
});
