import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useHorizontalCarousel } from '@/lib/hooks/use-horizontal-carousel';

interface HarnessProps {
  itemCount: number;
  enabled?: boolean;
  minItemsForNavigation?: number;
  loop?: boolean;
  snapToItem?: boolean;
}

function HookHarness({
  itemCount,
  enabled,
  minItemsForNavigation,
  loop,
  snapToItem,
}: HarnessProps) {
  const {
    carouselRef,
    hasNavigation,
    canScrollPrevious,
    canScrollNext,
    scrollByDirection,
    scrollItemIntoView,
  } = useHorizontalCarousel<HTMLDivElement>({
    itemCount,
    enabled,
    minItemsForNavigation,
    loop,
    snapToItem,
  });
  const targetRef = useRef<HTMLDivElement | null>(null);

  return (
    <div>
      <div ref={carouselRef} data-testid='track' />
      <div ref={targetRef} data-testid='target' />
      <button type='button' onClick={() => scrollByDirection('prev')}>
        Scroll previous
      </button>
      <button type='button' onClick={() => scrollByDirection('next')}>
        Scroll next
      </button>
      <button
        type='button'
        onClick={() => {
          scrollItemIntoView(targetRef.current, 'auto');
        }}
      >
        Scroll item
      </button>
      <span data-testid='state'>
        {`${String(hasNavigation)}|${String(canScrollPrevious)}|${String(canScrollNext)}`}
      </span>
    </div>
  );
}

function defineTrackMetrics(track: HTMLElement, metrics: {
  clientWidth: number;
  scrollWidth: number;
  initialScrollLeft?: number;
}) {
  let scrollLeft = metrics.initialScrollLeft ?? 0;
  const scrollBySpy = vi.fn(({ left }: { left: number }) => {
    scrollLeft += left;
  });
  const scrollToSpy = vi.fn(({ left }: { left: number }) => {
    scrollLeft = left;
  });

  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    get: () => metrics.clientWidth,
  });
  Object.defineProperty(track, 'scrollWidth', {
    configurable: true,
    get: () => metrics.scrollWidth,
  });
  Object.defineProperty(track, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  Object.defineProperty(track, 'scrollBy', {
    configurable: true,
    value: scrollBySpy,
  });
  Object.defineProperty(track, 'scrollTo', {
    configurable: true,
    value: scrollToSpy,
  });

  return {
    scrollBySpy,
    scrollToSpy,
    setScrollLeft: (value: number) => {
      scrollLeft = value;
    },
  };
}

describe('useHorizontalCarousel', () => {
  it('skips navigation wiring when enabled is false', () => {
    render(<HookHarness itemCount={5} enabled={false} />);

    expect(screen.getByTestId('state')).toHaveTextContent('false|false|false');
  });

  it('disables navigation when item count does not pass the threshold', () => {
    render(<HookHarness itemCount={1} />);

    expect(screen.getByTestId('state')).toHaveTextContent('false|false|false');
  });

  it('updates previous/next navigation state on resize and scroll', async () => {
    render(<HookHarness itemCount={5} />);

    const track = screen.getByTestId('track');
    const { setScrollLeft } = defineTrackMetrics(track, {
      clientWidth: 400,
      scrollWidth: 1000,
      initialScrollLeft: 0,
    });

    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('true|false|true');
    });

    setScrollLeft(600);
    fireEvent.scroll(track);
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
    });
  });

  it('uses the shared viewport-based scroll step when navigating', async () => {
    render(<HookHarness itemCount={5} />);

    const track = screen.getByTestId('track');
    const { scrollBySpy } = defineTrackMetrics(track, {
      clientWidth: 500,
      scrollWidth: 1600,
      initialScrollLeft: 0,
    });

    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('true|false|true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Scroll next' }));

    expect(scrollBySpy).toHaveBeenCalledWith({
      left: 400,
      behavior: 'smooth',
    });
  });

  it('loops from start/end boundaries when loop mode is enabled', async () => {
    render(<HookHarness itemCount={5} loop />);

    const track = screen.getByTestId('track');
    const { setScrollLeft } = defineTrackMetrics(track, {
      clientWidth: 400,
      scrollWidth: 1000,
      initialScrollLeft: 0,
    });

    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('true|true|true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Scroll previous' }));
    expect(track.scrollLeft).toBe(600);

    setScrollLeft(600);
    fireEvent.scroll(track);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll next' }));
    expect(track.scrollLeft).toBe(0);
  });

  it('auto-loops on scroll settle when loop is enabled and user swipes to boundary', () => {
    vi.useFakeTimers();
    try {
      render(<HookHarness itemCount={5} loop />);

      const track = screen.getByTestId('track');
      const { setScrollLeft } = defineTrackMetrics(track, {
        clientWidth: 400,
        scrollWidth: 1000,
        initialScrollLeft: 0,
      });

      act(() => {
        vi.advanceTimersByTime(20);
      });

      setScrollLeft(200);
      fireEvent.scroll(track);
      setScrollLeft(400);
      fireEvent.scroll(track);
      setScrollLeft(600);
      fireEvent.scroll(track);

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(track.scrollLeft).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-loop from start on initial render', () => {
    vi.useFakeTimers();
    try {
      render(<HookHarness itemCount={5} loop />);

      const track = screen.getByTestId('track');
      defineTrackMetrics(track, {
        clientWidth: 400,
        scrollWidth: 1000,
        initialScrollLeft: 0,
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(track.scrollLeft).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can scroll an item into view with centered alignment via container scrollTo', () => {
    render(<HookHarness itemCount={5} />);

    const track = screen.getByTestId('track');
    const target = screen.getByTestId('target');

    const scrollToSpy = vi.fn();
    Object.defineProperty(track, 'scrollTo', {
      configurable: true,
      value: scrollToSpy,
    });
    Object.defineProperty(track, 'scrollLeft', {
      configurable: true,
      get: () => 0,
    });
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 400, top: 0, bottom: 100,
      width: 400, height: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 300, right: 400, top: 0, bottom: 100,
      width: 100, height: 100, x: 300, y: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Scroll item' }));

    expect(scrollToSpy).toHaveBeenCalledWith({
      left: 150,
      behavior: 'auto',
    });
  });

  describe('snapToItem mode', () => {
    function buildSnapHarness(itemPositions: number[], containerWidth: number) {
      render(<HookHarness itemCount={itemPositions.length} snapToItem />);

      const track = screen.getByTestId('track');
      const totalWidth = itemPositions[itemPositions.length - 1]! + containerWidth / 3;
      const { scrollToSpy, setScrollLeft } = defineTrackMetrics(track, {
        clientWidth: containerWidth,
        scrollWidth: totalWidth,
        initialScrollLeft: 0,
      });

      const wrapper = document.createElement('ul');
      track.appendChild(wrapper);

      itemPositions.forEach((position) => {
        const item = document.createElement('li');
        wrapper.appendChild(item);
        vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => {
          const left = position - track.scrollLeft;
          return {
            left,
            right: left + containerWidth / 3,
            top: 0,
            bottom: 100,
            width: containerWidth / 3,
            height: 100,
            x: left,
            y: 0,
            toJSON: () => ({}),
          };
        });
      });

      vi.spyOn(track, 'getBoundingClientRect').mockImplementation(() => ({
        left: 0,
        right: containerWidth,
        top: 0,
        bottom: 100,
        width: containerWidth,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));

      return { track, scrollToSpy, setScrollLeft };
    }

    it('scrolls to the next item position on next click', async () => {
      const positions = [0, 375, 750, 1125, 1500, 1875];
      const { scrollToSpy } = buildSnapHarness(positions, 1100);

      fireEvent(window, new Event('resize'));
      await waitFor(() => {
        expect(screen.getByTestId('state')).toHaveTextContent('true|false|true');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Scroll next' }));

      expect(scrollToSpy).toHaveBeenCalledWith({
        left: 375,
        behavior: 'smooth',
      });
    });

    it('scrolls to the previous item position on prev click', async () => {
      const positions = [0, 375, 750, 1125, 1500, 1875];
      const { scrollToSpy, setScrollLeft } = buildSnapHarness(positions, 1100);

      setScrollLeft(750);
      fireEvent(window, new Event('resize'));
      await waitFor(() => {
        expect(screen.getByTestId('state')).toHaveTextContent('true|true|true');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Scroll previous' }));

      expect(scrollToSpy).toHaveBeenCalledWith({
        left: 375,
        behavior: 'smooth',
      });
    });

    it('clamps next scroll to maxScrollLeft', async () => {
      const positions = [0, 374, 748, 1122, 1496, 1870, 2244, 2618];
      const containerWidth = 1100;
      const { track, scrollToSpy, setScrollLeft } = buildSnapHarness(positions, containerWidth);
      const maxScrollLeft = track.scrollWidth - containerWidth;

      setScrollLeft(1496);
      fireEvent(window, new Event('resize'));
      await waitFor(() => {
        expect(screen.getByTestId('state')).toHaveTextContent('true|true|true');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Scroll next' }));

      const calledLeft = scrollToSpy.mock.calls[0]?.[0]?.left ?? -1;
      expect(calledLeft).toBeLessThanOrEqual(maxScrollLeft);
      expect(calledLeft).toBeGreaterThan(1496);
    });

    it('does not use scrollBy in snapToItem mode', async () => {
      const positions = [0, 375, 750];
      render(<HookHarness itemCount={3} snapToItem />);

      const track = screen.getByTestId('track');
      const { scrollBySpy } = defineTrackMetrics(track, {
        clientWidth: 1100,
        scrollWidth: 1500,
        initialScrollLeft: 0,
      });

      const wrapper = document.createElement('ul');
      track.appendChild(wrapper);
      positions.forEach((position) => {
        const item = document.createElement('li');
        wrapper.appendChild(item);
        vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => ({
          left: position - track.scrollLeft,
          right: position - track.scrollLeft + 350,
          top: 0, bottom: 100, width: 350, height: 100, x: position - track.scrollLeft, y: 0,
          toJSON: () => ({}),
        }));
      });
      vi.spyOn(track, 'getBoundingClientRect').mockImplementation(() => ({
        left: 0, right: 1100, top: 0, bottom: 100, width: 1100, height: 100, x: 0, y: 0,
        toJSON: () => ({}),
      }));

      fireEvent(window, new Event('resize'));
      await waitFor(() => {
        expect(screen.getByTestId('state')).toHaveTextContent('true|false|true');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Scroll next' }));

      expect(scrollBySpy).not.toHaveBeenCalled();
    });
  });
});
