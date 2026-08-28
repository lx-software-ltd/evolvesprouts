'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BOOKING_SELECTOR_CARD_CLASSNAME } from '@/components/sections/shared/booking-selector-layout';
import { CarouselTrack } from '@/components/sections/shared/carousel-track';
import { isMorningWallClockHour } from '@/components/sections/shared/slot-picker-helpers';
import { useRovingTabindexKeyboardNav } from '@/components/sections/shared/use-roving-tabindex-keyboard-nav';
import { ButtonPrimitive } from '@/components/shared/button-primitive';
import { SectionSpinnerStatus } from '@/components/shared/section-spinner-status';
import type {
  CommonAccessibilityContent,
  LandingPageIntroCallContent,
  Locale,
} from '@/content';
import { formatContentTemplate } from '@/content/content-field-utils';
import type { IntroCallSlot } from '@/lib/public-calendar-availability-api';
import { fetchIntroCallSlots } from '@/lib/public-calendar-availability-api';
import {
  formatPartDateTimeLabel,
  PUBLIC_SITE_IANA_TIMEZONE,
  resolveDateTimeLocale,
} from '@/lib/site-datetime';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useHorizontalCarousel } from '@/lib/hooks/use-horizontal-carousel';
import { resolvePublicSiteConfig } from '@/lib/site-config';

export interface IntroCallSlotPickerProps {
  locale: Locale;
  commonAccessibility: CommonAccessibilityContent;
  pickerContent: LandingPageIntroCallContent;
  /** Same WhatsApp URL as the booking section (falls back to site config when unset). */
  whatsappHref?: string;
  onSelect: (slot: IntroCallSlot | null) => void;
  onBlockersStatusChange?: (status: 'idle' | 'loading' | 'ready' | 'error') => void;
  refreshToken?: number;
}

type FetchStatus = 'idle' | 'loading' | 'ready' | 'error';

const MAX_VISIBLE_BOOKING_DAYS = 5;

const WALL_HOUR_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: PUBLIC_SITE_IANA_TIMEZONE,
  hour: 'numeric',
  hourCycle: 'h23',
});

const SITE_YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: PUBLIC_SITE_IANA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WEEKDAY_SHORT_FORMATTERS: Record<string, Intl.DateTimeFormat> = {};
const DAY_MONTH_SHORT_FORMATTERS: Record<string, Intl.DateTimeFormat> = {};

function getWeekdayShortFormatter(resolvedLocale: string): Intl.DateTimeFormat {
  let fmt = WEEKDAY_SHORT_FORMATTERS[resolvedLocale];
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(resolvedLocale, {
      timeZone: PUBLIC_SITE_IANA_TIMEZONE,
      weekday: 'short',
    });
    WEEKDAY_SHORT_FORMATTERS[resolvedLocale] = fmt;
  }
  return fmt;
}

function getDayMonthShortFormatter(resolvedLocale: string): Intl.DateTimeFormat {
  let fmt = DAY_MONTH_SHORT_FORMATTERS[resolvedLocale];
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(resolvedLocale, {
      timeZone: PUBLIC_SITE_IANA_TIMEZONE,
      day: '2-digit',
      month: 'short',
    });
    DAY_MONTH_SHORT_FORMATTERS[resolvedLocale] = fmt;
  }
  return fmt;
}

function wallClockHourFromIso(iso: string): number {
  const parts = WALL_HOUR_FORMATTER.formatToParts(new Date(iso));
  const hourPart = parts.find((p) => p.type === 'hour');
  return hourPart ? Number.parseInt(hourPart.value, 10) : 0;
}

function isMorningSlot(slot: IntroCallSlot): boolean {
  return isMorningWallClockHour(wallClockHourFromIso(slot.startIso));
}

export function IntroCallSlotPicker({
  locale,
  commonAccessibility,
  pickerContent,
  whatsappHref,
  onSelect,
  onBlockersStatusChange,
  refreshToken = 0,
}: IntroCallSlotPickerProps) {
  const [slots, setSlots] = useState<IntroCallSlot[]>([]);
  const [status, setStatus] = useState<FetchStatus>('idle');
  /** User-picked day; when null or stale, ``resolvedDayYmd`` falls back to the first available day. */
  const [cursorDayYmd, setCursorDayYmd] = useState<string | null>(null);
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  /** Mirrors ``selectedSlotIso`` so we can clear without impure setState side effects. */
  const selectedSlotIsoRef = useRef<string | null>(null);
  const dayRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lastReportedStatusRef = useRef<FetchStatus | null>(null);

  const slotTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en-HK' : locale, {
        timeZone: PUBLIC_SITE_IANA_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [locale],
  );

  const dayFormatters = useMemo(() => {
    const resolved = resolveDateTimeLocale(locale);
    const weekdayFmt = getWeekdayShortFormatter(resolved);
    const dayMonthFmt = getDayMonthShortFormatter(resolved);
    return {
      accessibleLabel(iso: string): string {
        const d = new Date(iso);
        return `${weekdayFmt.format(d)} ${dayMonthFmt.format(d)}`;
      },
      weekdayShort(iso: string): string {
        return weekdayFmt.format(new Date(iso));
      },
      dateLine(iso: string): string {
        return dayMonthFmt.format(new Date(iso));
      },
    };
  }, [locale]);

  const setStatusBoth = useCallback(
    (next: FetchStatus) => {
      setStatus(next);
      onBlockersStatusChange?.(next);
    },
    [onBlockersStatusChange],
  );

  useEffect(() => {
    if (lastReportedStatusRef.current === status) {
      return;
    }
    lastReportedStatusRef.current = status;
    trackAnalyticsEvent('intro_call_slot_picker_status_change', {
      sectionId: 'intro-call-booking',
      ctaLocation: 'intro_call_slot_picker',
      params: { status },
    });
  }, [status]);

  useEffect(() => {
    // Per-attempt timeout and retry live inside fetchIntroCallSlots; this controller
    // only signals unmount.
    const controller = new AbortController();

    const loadingFrame = window.requestAnimationFrame(() => {
      setStatusBoth('loading');
    });

    fetchIntroCallSlots(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) {
          return;
        }
        if (res.fetchFailed) {
          setStatusBoth('error');
          setSlots([]);
          return;
        }
        const sorted = [...res.slots].sort((a, b) => a.startIso.localeCompare(b.startIso));
        setSlots(sorted);
        setStatusBoth('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setStatusBoth('error');
        setSlots([]);
      });

    return () => {
      window.cancelAnimationFrame(loadingFrame);
      controller.abort();
    };
  }, [refreshToken, setStatusBoth]);

  const slotsByDayFull = useMemo(() => {
    const map = new Map<string, IntroCallSlot[]>();
    for (const s of slots) {
      const ymd = SITE_YMD_FORMATTER.format(new Date(s.startIso));
      const arr = map.get(ymd) ?? [];
      arr.push(s);
      map.set(ymd, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.startIso.localeCompare(b.startIso));
    }
    return map;
  }, [slots]);

  const dayKeys = useMemo(() => {
    const sorted = Array.from(slotsByDayFull.keys()).sort();
    return sorted.slice(0, MAX_VISIBLE_BOOKING_DAYS);
  }, [slotsByDayFull]);

  const { carouselRef: dayCarouselRef } = useHorizontalCarousel<HTMLDivElement>({
    itemCount: dayKeys.length,
    enabled: status === 'ready' && slots.length > 0,
  });

  const slotsByDay = useMemo(() => {
    const map = new Map<string, IntroCallSlot[]>();
    for (const ymd of dayKeys) {
      const arr = slotsByDayFull.get(ymd);
      if (arr) {
        map.set(ymd, arr);
      }
    }
    return map;
  }, [dayKeys, slotsByDayFull]);

  const resolvedDayYmd = useMemo(() => {
    if (dayKeys.length === 0) {
      return null;
    }
    if (cursorDayYmd && dayKeys.includes(cursorDayYmd)) {
      return cursorDayYmd;
    }
    return dayKeys[0] ?? null;
  }, [cursorDayYmd, dayKeys]);

  const daySlots = useMemo(
    () => (resolvedDayYmd ? slotsByDay.get(resolvedDayYmd) ?? [] : []),
    [resolvedDayYmd, slotsByDay],
  );
  const morningSlots = useMemo(
    () => daySlots.filter((s) => isMorningSlot(s)),
    [daySlots],
  );
  const afternoonSlots = useMemo(
    () => daySlots.filter((s) => !isMorningSlot(s)),
    [daySlots],
  );

  const whatsappUrl =
    whatsappHref?.trim()
    || resolvePublicSiteConfig().whatsappUrl?.trim()
    || '';

  const summaryText = useMemo(() => {
    if (!selectedSlotIso) {
      return '';
    }
    const slot = slots.find((s) => s.startIso === selectedSlotIso);
    if (!slot) {
      return '';
    }
    return formatPartDateTimeLabel(slot.startIso, locale);
  }, [locale, selectedSlotIso, slots]);

  const clearTimeSelection = useCallback(() => {
    if (selectedSlotIsoRef.current !== null) {
      selectedSlotIsoRef.current = null;
      onSelect(null);
    }
    setSelectedSlotIso(null);
  }, [onSelect]);

  const selectDayWithoutRoving = useCallback(
    (ymd: string) => {
      if (ymd !== resolvedDayYmd) {
        clearTimeSelection();
      }
      setCursorDayYmd(ymd);
    },
    [clearTimeSelection, resolvedDayYmd],
  );

  const {
    rovingIndex: safeRovingDayIndex,
    setRovingIndex: setRovingDayIndex,
    handleItemKeyDown: handleDayKeyDown,
  } = useRovingTabindexKeyboardNav({
    itemCount: dayKeys.length,
    itemRefs: dayRefs,
    onIndexChange: (next) => {
      const ymd = dayKeys[next];
      if (ymd) {
        selectDayWithoutRoving(ymd);
      }
    },
  });

  const selectDay = useCallback(
    (ymd: string, index: number) => {
      selectDayWithoutRoving(ymd);
      setRovingDayIndex(index);
    },
    [selectDayWithoutRoving, setRovingDayIndex],
  );

  if (status === 'loading' || status === 'idle') {
    return (
      <SectionSpinnerStatus
        label={pickerContent.loadingLabel}
        testId='intro-call-slots-loading'
      />
    );
  }

  if (status === 'error') {
    const message =
      pickerContent.loadErrorMessage ?? pickerContent.emptySlotsMessagePrefix;
    return (
      <div className='space-y-3' role='alert'>
        <p className='es-type-body'>
          {message}{' '}
          <a
            href={whatsappUrl}
            className='es-focus-ring es-inline-cta-link font-semibold'
            rel='noopener noreferrer'
          >
            {pickerContent.whatsappAfterBookLabel}
          </a>
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className='space-y-3'>
        <p className='es-type-body'>
          {pickerContent.emptySlotsMessagePrefix}{' '}
          <a
            href={whatsappUrl}
            className='es-focus-ring es-inline-cta-link font-semibold'
            rel='noopener noreferrer'
          >
            {pickerContent.whatsappAfterBookLabel}
          </a>
        </p>
      </div>
    );
  }

  function slotGridAriaLabel(periodLabel: string): string {
    return formatContentTemplate(pickerContent.slotGroupAriaLabelTemplate, {
      period: periodLabel,
      section: pickerContent.bookingSectionTitle,
    });
  }

  function renderSlotGrid(slotsChunk: IntroCallSlot[], offsetIndex: number, partLabel: string) {
    return (
      <div
        className='grid grid-cols-2 gap-3 md:grid-cols-3'
        role='group'
        aria-label={slotGridAriaLabel(partLabel)}
      >
        {slotsChunk.map((slot, sidx) => {
          const start = new Date(slot.startIso);
          const label = slotTimeFormatter.format(start);
          const pressed = selectedSlotIso === slot.startIso;
          const globalIdx = offsetIndex + sidx;
          return (
            <ButtonPrimitive
              key={slot.startIso}
              type='button'
              buttonRef={(el) => {
                slotRefs.current[globalIdx] = el;
              }}
              variant='selection'
              state={pressed ? 'active' : 'inactive'}
              aria-pressed={pressed}
              className='es-intro-call-slot-selection-btn rounded-md min-h-11 px-3 py-2.5 text-base sm:text-sm'
              onClick={() => {
                selectedSlotIsoRef.current = slot.startIso;
                setSelectedSlotIso(slot.startIso);
                onSelect(slot);
                trackAnalyticsEvent('intro_call_slot_selected', {
                  sectionId: 'intro-call-booking',
                  ctaLocation: 'intro_call_slot_picker',
                  params: { slot_start: slot.startIso },
                });
              }}
            >
              {label}
            </ButtonPrimitive>
          );
        })}
      </div>
    );
  }

  return (
    <div className='min-w-0 max-w-full space-y-4'>
      <div className='relative mt-0 w-full min-w-0 max-w-full'>
        <CarouselTrack
          carouselRef={dayCarouselRef}
          testId='intro-call-day-carousel'
          ariaLabel={formatContentTemplate(commonAccessibility.carouselLabelTemplate, {
            title: pickerContent.bookingSectionTitle,
          })}
          ariaRoleDescription={commonAccessibility.carouselRoleDescription}
          className='max-w-full min-w-0 pb-2 pr-1'
        >
          <ul className='flex w-max min-w-full list-none gap-3 p-0'>
            {dayKeys.map((ymd, idx) => {
              const count = slotsByDay.get(ymd)?.length ?? 0;
              if (count === 0) {
                return null;
              }
              const sample = slotsByDay.get(ymd)?.[0];
              if (!sample) {
                return null;
              }
              const dayAccessibleLabel = dayFormatters.accessibleLabel(sample.startIso);
              const weekdayShort = dayFormatters.weekdayShort(sample.startIso);
              const dateLine = dayFormatters.dateLine(sample.startIso);
              const isSelected = ymd === resolvedDayYmd;
              return (
                <li key={ymd} className='shrink-0 snap-center'>
                  <ButtonPrimitive
                    type='button'
                    buttonRef={(el) => {
                      dayRefs.current[idx] = el;
                    }}
                    variant='selection'
                    state={isSelected ? 'active' : 'inactive'}
                    aria-pressed={isSelected}
                    aria-label={dayAccessibleLabel}
                    tabIndex={safeRovingDayIndex === idx ? 0 : -1}
                    onClick={() => {
                      selectDay(ymd, idx);
                    }}
                    onKeyDown={(e) => handleDayKeyDown(e, idx)}
                    className={`${BOOKING_SELECTOR_CARD_CLASSNAME} relative min-h-[88px] w-[120px] text-center sm:min-h-0 sm:w-[134.4px]`}
                  >
                    <div className='flex w-full flex-col items-center gap-2'>
                      <div className='flex items-center justify-center gap-2'>
                        <span
                          className={`h-6 w-6 shrink-0 es-mask-calendar-current ${isSelected ? 'es-btn-selection-icon-active' : 'es-btn-selection-icon-inactive'}`}
                          aria-hidden='true'
                        />
                        <p className='text-base font-semibold es-text-heading whitespace-nowrap'>
                          {weekdayShort}
                        </p>
                      </div>
                      <p className='text-center text-sm sm:text-sm es-text-heading'>{dateLine}</p>
                    </div>
                  </ButtonPrimitive>
                </li>
              );
            })}
          </ul>
        </CarouselTrack>
      </div>

      {resolvedDayYmd && daySlots.length > 0 ? (
        <div className='space-y-4'>
          {morningSlots.length > 0 ? (
            <div className='space-y-2'>
              <p className='text-sm font-semibold es-text-heading'>
                {pickerContent.morningSectionLabel}
              </p>
              {renderSlotGrid(morningSlots, 0, pickerContent.morningSectionLabel)}
            </div>
          ) : null}
          {afternoonSlots.length > 0 ? (
            <div className='space-y-2'>
              <p className='text-sm font-semibold es-text-heading'>
                {pickerContent.afternoonSectionLabel}
              </p>
              {renderSlotGrid(
                afternoonSlots,
                morningSlots.length,
                pickerContent.afternoonSectionLabel,
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className='sr-only' aria-live='polite'>
        {summaryText}
      </p>
    </div>
  );
}
