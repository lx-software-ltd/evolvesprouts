import { useEffect, useState } from 'react';
import { act, render } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useBookingAutoOpenFromQuery,
  useBookingPageSearch,
} from '@/components/sections/shared/use-booking-auto-open-from-query';

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

/**
 * Mirrors a deep link whose cohort is not in the first client snapshot.
 * The server snapshot has no query, so the page looks openable; the client
 * search then waits until the cohort resolves.
 */
function HydrationBookingHarness() {
  const link = useBookingPageSearch();
  const [cohortReady, setCohortReady] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setCohortReady(true);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  const waitingForCohort = link.cohortSlug === 'late-cohort' && !cohortReady;
  useBookingAutoOpenFromQuery({
    bookingSystem: 'test-booking',
    canOpen: !waitingForCohort,
    onOpen: () => {
      onOpenMock();
    },
  });

  return <div data-search={link.bookingSystem} data-waiting={waitingForCohort ? 'yes' : 'no'} />;
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

  it('opens after hydration once a deep-linked cohort resolves', async () => {
    window.history.replaceState(
      {},
      '',
      '/?booking_system=test-booking&cohort=late-cohort',
    );
    const markup = renderToString(<HydrationBookingHarness />);
    expect(markup).toContain('data-search=""');
    expect(markup).toContain('data-waiting="no"');

    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <HydrationBookingHarness />);
    });
    expect(container.querySelector('[data-search="test-booking"]')).not.toBeNull();
    expect(onOpenMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.runAllTimers();
    });
    expect(container.querySelector('[data-waiting="no"]')).not.toBeNull();

    // The open is scheduled only after the cohort resolves, so it needs its own turn.
    await act(async () => {
      vi.runAllTimers();
    });
    expect(onOpenMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });
});
