import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBookingAutoOpenFromQuery } from '@/components/sections/shared/use-booking-auto-open-from-query';

function BookingAutoOpenHarness({ canOpen }: { canOpen: boolean }) {
  useBookingAutoOpenFromQuery({
    bookingSystem: 'test-booking',
    canOpen,
    onOpen: () => {
      onOpenMock();
    },
  });

  return null;
}

const onOpenMock = vi.fn();

describe('useBookingAutoOpenFromQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?booking_system=test-booking');
    onOpenMock.mockReset();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
  });

  it('opens once across re-renders with unstable onOpen closures', async () => {
    const { rerender } = render(<BookingAutoOpenHarness canOpen />);

    rerender(<BookingAutoOpenHarness canOpen />);
    rerender(<BookingAutoOpenHarness canOpen />);
    rerender(<BookingAutoOpenHarness canOpen />);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(onOpenMock).toHaveBeenCalledTimes(1);
  });

  it('opens once after canOpen flips true across multiple renders', async () => {
    const { rerender } = render(<BookingAutoOpenHarness canOpen={false} />);

    rerender(<BookingAutoOpenHarness canOpen={false} />);
    rerender(<BookingAutoOpenHarness canOpen />);
    rerender(<BookingAutoOpenHarness canOpen />);
    rerender(<BookingAutoOpenHarness canOpen />);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(onOpenMock).toHaveBeenCalledTimes(1);
  });

  it('still opens when canOpen drops before the scheduled open', async () => {
    const { rerender } = render(<BookingAutoOpenHarness canOpen />);

    rerender(<BookingAutoOpenHarness canOpen={false} />);

    await act(async () => {
      vi.runAllTimers();
    });
    expect(onOpenMock).not.toHaveBeenCalled();

    rerender(<BookingAutoOpenHarness canOpen />);

    await act(async () => {
      vi.runAllTimers();
    });
    expect(onOpenMock).toHaveBeenCalledTimes(1);
  });
});
