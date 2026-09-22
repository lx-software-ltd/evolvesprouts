/* eslint-disable @next/next/no-img-element */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyBestAuntieBooking } from '@/components/sections/my-best-auntie/my-best-auntie-booking';
import enContent from '@/content/en.json';
import trainingCoursesFixture from '../../fixtures/my-best-auntie-training-courses.json';
import { trackAnalyticsEvent } from '@/lib/analytics';
import type { MyBestAuntieEventCohort } from '@/lib/events-data';
import { formatCohortValue, formatPartDateTimeLabel } from '@/lib/format';
import { buildWhatsappPrefilledHref } from '@/lib/site-config';

vi.mock('@/components/sections/my-best-auntie/use-my-best-auntie-cohorts', () => ({
  useMyBestAuntieCohorts: ({ initialCohorts }: { initialCohorts: MyBestAuntieEventCohort[] }) => ({
    cohorts: initialCohorts,
    isLoading: false,
    hasRequestError: false,
  }),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt?: string;
  } & Record<string, unknown>) => <img alt={alt ?? ''} {...props} />,
}));

vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackEcommerceEvent: vi.fn(),
}));

const mockedTrackAnalyticsEvent = vi.mocked(trackAnalyticsEvent);

beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-01T00:00:00Z'));
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  mockedTrackAnalyticsEvent.mockReset();
});

function formatCohortPreviewLabel(value: string): string {
  const firstDateSegment = value.split(/\s+-\s+/)[0]?.trim() ?? value.trim();

  return firstDateSegment.replace(/\s+(am|pm)$/i, '$1');
}

function formatNextCohortLabel(scheduleLabel: string, ageGroupLabel: string): string {
  return `${scheduleLabel} for ${ageGroupLabel} age group`;
}

type BookingCohort = MyBestAuntieEventCohort;

const bookingContent = enContent.myBestAuntie.booking;
const initialMbaCohorts = trainingCoursesFixture.data as MyBestAuntieEventCohort[];
const myBestAuntieModalContent = enContent.myBestAuntie.modal;
const bookingModalContent = enContent.bookingModal;
const privateProgrammeFallbackWhatsappHref = buildWhatsappPrefilledHref(
  enContent.freeIntroSession.ctaHref,
  bookingContent.privateProgrammePrefillMessage,
  enContent.freeIntroSession.phoneNumber,
) || enContent.freeIntroSession.ctaHref;
const selectedAgeGroupTitleTemplate =
  bookingModalContent.paymentModal.selectedAgeGroupTitleTemplate;

function getCohortsForAge(cohorts: MyBestAuntieEventCohort[], ageGroupId: string): BookingCohort[] {
  return cohorts
    .filter((cohort) => cohort.service_tier === ageGroupId)
    .sort((left, right) => {
      const leftDate = Date.parse(left.dates[0]?.start_datetime ?? '');
      const rightDate = Date.parse(right.dates[0]?.start_datetime ?? '');
      return leftDate - rightDate;
    });
}

function getPrimarySessionDateTimeLabel(cohort: BookingCohort): string {
  return formatPartDateTimeLabel(cohort.dates[0]?.start_datetime ?? '', 'en');
}

function formatCohortPrice(cohort: BookingCohort): string {
  const normalizedCurrency = cohort.currency.trim();
  if (/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return new Intl.NumberFormat('en-HK', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: 0,
    }).format(cohort.price);
  }

  return `${normalizedCurrency}${new Intl.NumberFormat('en-HK', {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(cohort.price)}`;
}

function formatSpacesLeftLabel(count: number): string {
  return bookingContent.spacesLeftLabelTemplate.replace('{count}', String(count));
}

function getBookingModalTitleForAgeGroup(ageGroupLabel: string): string {
  return selectedAgeGroupTitleTemplate
    .replace('{title}', myBestAuntieModalContent.title)
    .replace('{ageGroupLabel}', ageGroupLabel);
}

function buildTestCohort(
  serviceTier: string,
  cohort: string,
  startDateTime: string,
): MyBestAuntieEventCohort {
  const baseCohort =
    initialMbaCohorts.find((entry) => entry.service_tier === serviceTier)
    ?? initialMbaCohorts[0];
  if (!baseCohort) {
    throw new Error('Test fixture must include at least one cohort.');
  }

  const slug = `my-best-auntie-${serviceTier}-${cohort}`;
  const startDate = new Date(startDateTime);
  const buildDatePart = (part: number, dayOffset: number) => {
    const startMs = startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000;
    const endMs = startMs + 2 * 60 * 60 * 1000;
    return {
      part,
      start_datetime: new Date(startMs).toISOString(),
      end_datetime: new Date(endMs).toISOString(),
    };
  };

  return {
    ...baseCohort,
    slug,
    service_tier: serviceTier,
    title: `My Best Auntie Training Course ${serviceTier}`,
    cohort,
    spaces_left: 8,
    is_fully_booked: false,
    dates: [
      buildDatePart(1, 0),
      buildDatePart(2, 7),
      buildDatePart(3, 14),
    ],
  };
}

describe('MyBestAuntieBooking section', () => {
  it('does not auto-open the booking modal when only a referral query param is present', async () => {
    window.history.replaceState(
      {},
      '',
      '/en/services/my-best-auntie-training-course?ref=SAVE10#my-best-auntie-booking',
    );

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('auto-opens payment modal when booking_system query targets my-best-auntie booking', async () => {
    window.history.replaceState(
      {},
      '',
      '/en/services/my-best-auntie-training-course?booking_system=my-best-auntie-booking#my-best-auntie-booking',
    );

    const { rerender } = render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    rerender(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );
    rerender(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    expect(
      await screen.findByRole('dialog', {
        name: getBookingModalTitleForAgeGroup(bookingContent.ageOptions[0]!.label),
      }),
    ).toBeInTheDocument();
  });

  it('uses default section shell top spacing classes', () => {
    const { container } = render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const section = container.querySelector('section#my-best-auntie-booking');
    expect(section?.className).not.toContain('pt-0');
    expect(section?.className).not.toContain('sm:pt-[60px]');
    expect(section?.className).toContain('es-section-shell-spacing');
  });

  it('updates date cards by selected age group and keeps cohort date in subtitle-lg style', () => {
    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const firstAgeOption = bookingContent.ageOptions[0];
    const secondAgeOption = bookingContent.ageOptions[1];
    if (!firstAgeOption || !secondAgeOption) {
      throw new Error('Test content must include age options.');
    }
    const firstAgeCohorts = getCohortsForAge(initialMbaCohorts, firstAgeOption.id);
    const secondAgeCohorts = getCohortsForAge(initialMbaCohorts, secondAgeOption.id);
    const firstAgeFirstCohort = firstAgeCohorts[0];
    const secondAgeFirstCohort = secondAgeCohorts[0];
    const secondAgeSecondCohort = secondAgeCohorts[1];

    if (!firstAgeFirstCohort || !secondAgeFirstCohort || !secondAgeSecondCohort) {
      throw new Error('Test content must include age and cohort mappings.');
    }

    const formattedFirstCohortDate = formatCohortPreviewLabel(
      getPrimarySessionDateTimeLabel(firstAgeFirstCohort),
    );
    const formattedSecondCohortDate = formatCohortPreviewLabel(
      getPrimarySessionDateTimeLabel(secondAgeFirstCohort),
    );
    const formattedSecondAgeSecondCohortDate = formatCohortPreviewLabel(
      getPrimarySessionDateTimeLabel(secondAgeSecondCohort),
    );
    const firstCohortPriceLabel = formatCohortPrice(firstAgeFirstCohort);
    const nextCohortCard = screen.getByTestId('my-best-auntie-next-cohort-card');
    expect(nextCohortCard.className).toContain('rounded-inner');
    expect(nextCohortCard.className).toContain('border');
    expect(
      screen.getByText(
        formatNextCohortLabel(
          bookingContent.scheduleLabel,
          firstAgeOption.label,
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(formattedFirstCohortDate)).toBeInTheDocument();
    expect(screen.getByText(formattedFirstCohortDate).className).toContain(
      'es-type-subtitle-lg',
    );
    expect(within(nextCohortCard).getByText(firstCohortPriceLabel)).toBeInTheDocument();
    const dateSelectorRegion = screen.getByRole('region', {
      name: bookingContent.dateSelectorLabel,
    });
    expect(within(dateSelectorRegion).getAllByRole('button')).toHaveLength(3);

    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(firstAgeFirstCohort.cohort, 'en')),
      }).className,
    ).toContain('es-btn--state-active');

    fireEvent.click(
      screen.getByRole('button', {
        name: secondAgeOption.label,
      }),
    );
    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
      'booking_age_selected',
      expect.objectContaining({
        sectionId: 'my-best-auntie-booking',
        ctaLocation: 'selector',
      }),
    );

    expect(
      screen.getByText(
        formatNextCohortLabel(
          bookingContent.scheduleLabel,
          secondAgeOption.label,
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(formattedSecondCohortDate)).toBeInTheDocument();
    expect(within(dateSelectorRegion).getAllByRole('button')).toHaveLength(
      secondAgeCohorts.length,
    );
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(secondAgeFirstCohort.cohort, 'en')),
      }).className,
    ).toContain('es-btn--state-active');
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(secondAgeSecondCohort.cohort, 'en')),
      }).className,
    ).toContain('es-btn--state-inactive');

    fireEvent.click(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(secondAgeSecondCohort.cohort, 'en')),
      }),
    );
    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
      'booking_date_selected',
      expect.objectContaining({
        sectionId: 'my-best-auntie-booking',
        ctaLocation: 'selector',
      }),
    );

    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(secondAgeSecondCohort.cohort, 'en')),
      }).className,
    ).toContain('es-btn--state-active');
    expect(screen.getByText(formattedSecondCohortDate)).toBeInTheDocument();
    expect(screen.queryByText(formattedSecondAgeSecondCohortDate)).not.toBeInTheDocument();
  });

  it('shows no date cards for age groups without cohorts and disables CTA', () => {
    const cohortsWithoutThreeToSix = initialMbaCohorts.filter(
      (cohort) => cohort.service_tier !== '3-6',
    );

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={cohortsWithoutThreeToSix}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: '3-6',
      }),
    );

    const dateSelectorRegion = screen.getByRole('region', {
      name: bookingContent.dateSelectorLabel,
    });
    expect(within(dateSelectorRegion).queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.getByRole('button', {
        name: bookingContent.confirmAndPayLabel,
      }),
    ).toBeDisabled();
    expect(screen.getByText(bookingContent.noCohortsLabel)).toBeInTheDocument();
    expect(screen.queryByText('HK$9,000')).not.toBeInTheDocument();
  });

  it('removes right-column selector shadows, keeps date cards in two lines, keeps CTA width to copy, and hides date arrows for three dates', () => {
    const { container } = render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const selectorButtons = container.querySelectorAll('button[aria-pressed]');
    expect(selectorButtons.length).toBeGreaterThan(0);
    for (const selectorButton of selectorButtons) {
      expect(selectorButton.getAttribute('style')).toBeNull();
    }

    const ctaButton = screen.getByRole('button', {
      name: bookingContent.confirmAndPayLabel,
    });
    expect(ctaButton.className).not.toContain('w-full');
    expect(ctaButton.className).toContain('es-btn--primary');

    const firstAgeOption = bookingContent.ageOptions[0];
    if (!firstAgeOption) {
      throw new Error('Test content must include first age option.');
    }
    const secondDateOption = getCohortsForAge(
      initialMbaCohorts,
      firstAgeOption.id,
    )[1];
    if (!secondDateOption) {
      throw new Error('Test content must include second date option.');
    }
    const secondDateButton = screen.getByRole('button', {
      name: new RegExp(formatCohortValue(secondDateOption.cohort, 'en')),
    });
    expect(secondDateButton.className).toContain('es-btn--selection');
    expect(secondDateButton.className).toContain('es-btn--state-inactive');
    const secondDateCardContent = secondDateButton.querySelector('div.w-full');
    expect(secondDateCardContent).not.toBeNull();
    expect(secondDateCardContent?.className).toContain('flex-col');
    expect(secondDateCardContent?.className).toContain('items-center');
    const dateLine = secondDateCardContent?.firstElementChild;
    const availabilityLine = secondDateCardContent?.lastElementChild;
    expect(dateLine?.className).toContain('justify-center');
    expect(availabilityLine?.className).toContain('text-center');
    expect(dateLine?.textContent).toContain(formatCohortValue(secondDateOption.cohort, 'en'));
    expect(availabilityLine?.textContent).toContain(
      formatSpacesLeftLabel(secondDateOption.spaces_left),
    );

    expect(screen.queryByLabelText('Scroll dates left')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Scroll dates right')).not.toBeInTheDocument();
  });

  it('uses one shared date-style selector shell for both age and date cards', () => {
    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const firstAgeOption = bookingContent.ageOptions[0];
    if (!firstAgeOption) {
      throw new Error('Test content must include first age option.');
    }
    const firstDateOption = getCohortsForAge(
      initialMbaCohorts,
      firstAgeOption.id,
    )[0];
    if (!firstDateOption) {
      throw new Error('Test content must include first age and date options.');
    }

    const firstAgeButton = screen.getByRole('button', {
      name: firstAgeOption.label,
    });
    const dateSelectorRegion = screen.getByRole('region', {
      name: bookingContent.dateSelectorLabel,
    });
    const firstDateButton = within(dateSelectorRegion).getByRole('button', {
      name: new RegExp(formatCohortValue(firstDateOption.cohort, 'en')),
    });

    for (const button of [firstAgeButton, firstDateButton]) {
      expect(button.className).toContain('es-my-best-auntie-booking-selector-card');
      expect(button.className).toContain('es-btn--selection');
    }

    expect(firstAgeButton.className).toContain('w-[140px]');
    expect(firstAgeButton.className).toContain('sm:w-[168px]');
    expect(firstAgeButton.className).not.toContain('rounded-lg');
  });

  it('doubles age icon size and uses wider age icon/text spacing', () => {
    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const firstAgeOption = bookingContent.ageOptions[0];
    if (!firstAgeOption) {
      throw new Error('Test content must include first age option.');
    }
    const firstAgeButton = screen.getByRole('button', {
      name: firstAgeOption.label,
    });
    expect(firstAgeButton.className).toContain('es-btn--selection');
    expect(firstAgeButton.className).toContain('es-btn--state-active');
    const firstAgeIcon = firstAgeButton.querySelector(
      `img[src="${firstAgeOption.iconSrc}"]`,
    );

    expect(firstAgeIcon).not.toBeNull();
    expect(firstAgeIcon).toHaveAttribute('width', '48');
    expect(firstAgeIcon).toHaveAttribute('height', '48');
    expect(firstAgeIcon?.className).toContain('h-12');
    expect(firstAgeIcon?.className).toContain('w-12');

    const iconRowClassName = firstAgeIcon?.closest('div')?.className ?? '';
    expect(iconRowClassName).toContain('sm:gap-10');
    expect(iconRowClassName).toContain('justify-start');
    const ageLabelClassName = firstAgeButton.querySelector('span')?.className ?? '';
    expect(ageLabelClassName).toContain('text-lg');
  });

  it('shows at most the next three future cohorts for each age group', () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-05-01T00:00:00Z'));
    const cohorts: MyBestAuntieEventCohort[] = [
      buildTestCohort('1-3', 'past-26', '2026-04-30T01:00:00Z'),
      buildTestCohort('1-3', 'today-26', '2026-05-01T01:00:00Z'),
      buildTestCohort('1-3', 'may-26', '2026-05-16T01:00:00Z'),
      buildTestCohort('1-3', 'jun-26', '2026-06-13T01:00:00Z'),
      buildTestCohort('1-3', 'jul-26', '2026-07-11T01:00:00Z'),
      buildTestCohort('1-3', 'aug-26', '2026-08-08T01:00:00Z'),
      buildTestCohort('0-1', 'may-26', '2026-05-17T01:00:00Z'),
      buildTestCohort('0-1', 'jun-26', '2026-06-14T01:00:00Z'),
      buildTestCohort('3-6', 'may-26', '2026-05-16T04:00:00Z'),
    ];

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={cohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const dateSelectorRegion = screen.getByRole('region', {
      name: bookingContent.dateSelectorLabel,
    });
    expect(within(dateSelectorRegion).getAllByRole('button')).toHaveLength(2);
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue('may-26', 'en')),
      }),
    ).toBeInTheDocument();
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue('jun-26', 'en')),
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1-3' }));
    expect(within(dateSelectorRegion).getAllByRole('button')).toHaveLength(3);
    for (const cohort of ['may-26', 'jun-26', 'jul-26']) {
      expect(
        within(dateSelectorRegion).getByRole('button', {
          name: new RegExp(formatCohortValue(cohort, 'en')),
        }),
      ).toBeInTheDocument();
    }
    for (const cohort of ['past-26', 'today-26', 'aug-26']) {
      expect(
        within(dateSelectorRegion).queryByRole('button', {
          name: new RegExp(formatCohortValue(cohort, 'en')),
        }),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Scroll dates left')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Scroll dates right')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3-6' }));
    expect(within(dateSelectorRegion).getAllByRole('button')).toHaveLength(1);
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue('may-26', 'en')),
      }),
    ).toBeInTheDocument();
  });

  it('tracks confirm-and-pay click and modal open events', async () => {
    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: bookingContent.confirmAndPayLabel,
      }),
    );

    expect(await screen.findByRole('dialog', {
      name: getBookingModalTitleForAgeGroup(bookingContent.ageOptions[0]!.label),
    })).toBeInTheDocument();
    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
      'booking_confirm_pay_click',
      expect.objectContaining({
        sectionId: 'my-best-auntie-booking',
        ctaLocation: 'booking_section',
      }),
    );
    expect(mockedTrackAnalyticsEvent).toHaveBeenCalledWith(
      'booking_modal_open',
      expect.objectContaining({
        sectionId: 'my-best-auntie-booking',
        ctaLocation: 'booking_section',
      }),
    );
  });

  it('renders private programme CTA as outline link with dedicated WhatsApp message', () => {
    const privateProgrammeWhatsappHref = 'https://wa.me/15550001234?text=private-programme';
    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
        privateProgrammeWhatsappHref={privateProgrammeWhatsappHref}
      />,
    );

    const privateProgrammeCta = screen.getByRole('link', {
      name: bookingContent.privateProgrammeCtaLabel,
    });
    expect(privateProgrammeCta.className).toContain('es-btn--primary');
    expect(privateProgrammeCta.className).toContain('es-btn--outline');
    expect(privateProgrammeCta).toHaveAttribute('href', privateProgrammeWhatsappHref);
    const externalLabel = privateProgrammeCta.querySelector('.es-link-external-label');
    expect(externalLabel).not.toBeNull();
    expect(externalLabel?.className).toContain('es-link-external-label--with-icon');
    const externalIcon = privateProgrammeCta.querySelector('.es-ui-icon-mask--external-link');
    expect(externalIcon).not.toBeNull();
  });

  it('renders sold-out date cards as disabled with stamp and skips them for initial selection', () => {
    const soldOutCohorts = initialMbaCohorts.map((cohort) => {
      if (cohort.service_tier === '0-1' && cohort.cohort === '04-26') {
        return { ...cohort, is_fully_booked: true, spaces_left: 0 };
      }
      return cohort;
    });
    const soldOutCohort = soldOutCohorts.find(
      (cohort) => cohort.service_tier === '0-1' && cohort.cohort === '04-26',
    );
    expect(soldOutCohort).toBeDefined();

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={soldOutCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    const dateSelectorRegion = screen.getByRole('region', {
      name: bookingContent.dateSelectorLabel,
    });

    const soldOutButton = within(dateSelectorRegion).getByRole('button', {
      name: new RegExp(formatCohortValue(soldOutCohort!.cohort, 'en')),
    });
    expect(soldOutButton.getAttribute('aria-disabled')).toBe('true');
    expect(soldOutButton.className).toContain('pointer-events-none');

    const soldOutCardContent = soldOutButton.querySelector('div.flex.w-full');
    expect(soldOutCardContent?.className).toContain('opacity-40');

    const stampText = within(soldOutButton).getByText(bookingContent.soldOutStampLabel);
    expect(stampText).toBeInTheDocument();
    expect(stampText.className).toContain('es-cohort-sold-out-stamp-text');

    const firstAvailableCohort = getCohortsForAge(soldOutCohorts, '0-1').find(
      (cohort) => !cohort.is_fully_booked,
    );
    expect(firstAvailableCohort).toBeDefined();
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(firstAvailableCohort!.cohort, 'en')),
      }).className,
    ).toContain('es-btn--state-active');
  });

  it('does not show a copy link control in the confirm-and-pay modal', async () => {
    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: bookingContent.confirmAndPayLabel }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('opens the confirm-and-pay modal on the deep-linked age group and cohort', async () => {
    window.history.replaceState(
      {},
      '',
      '/en/services/my-best-auntie-training-course/?booking_system=my-best-auntie-booking&service_tier=1-3&cohort=my-best-auntie-1-3-apr-26#my-best-auntie-booking',
    );

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={initialMbaCohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    expect(
      await screen.findByRole('dialog', { name: getBookingModalTitleForAgeGroup('1-3') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1-3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not auto-open when the deep-linked cohort is sold out', async () => {
    const soldOutSlug = 'my-best-auntie-1-3-apr-26';
    const cohorts = initialMbaCohorts.map((entry) =>
      entry.slug === soldOutSlug ? { ...entry, is_fully_booked: true, spaces_left: 0 } : entry,
    );
    window.history.replaceState(
      {},
      '',
      `/en/services/my-best-auntie-training-course/?booking_system=my-best-auntie-booking&cohort=${soldOutSlug}`,
    );

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={cohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1-3' })).toHaveAttribute('aria-pressed', 'true');
    });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    const dateSelectorRegion = screen.getByRole('region', {
      name: bookingContent.dateSelectorLabel,
    });
    const preferredCohort = getCohortsForAge(cohorts, '1-3').find(
      (entry) => !entry.is_fully_booked,
    );
    expect(preferredCohort).toBeDefined();
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(preferredCohort!.cohort, 'en')),
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: bookingContent.confirmAndPayLabel })).toBeEnabled();
  });

  it('keeps a deep-linked cohort selectable when it is past the three-date cap', async () => {
    const lateCohort = buildTestCohort('0-1', 'aug-26', '2026-08-01T01:00:00Z');
    const cohorts = [
      buildTestCohort('0-1', 'may-26', '2026-05-01T01:00:00Z'),
      buildTestCohort('0-1', 'jun-26', '2026-06-01T01:00:00Z'),
      buildTestCohort('0-1', 'jul-26', '2026-07-01T01:00:00Z'),
      lateCohort,
    ];
    window.history.replaceState(
      {},
      '',
      `/en/services/my-best-auntie-training-course/?booking_system=my-best-auntie-booking&cohort=${lateCohort.slug}`,
    );

    render(
      <MyBestAuntieBooking
        locale='en'
        content={bookingContent}
        initialCohorts={cohorts}
        modalContent={myBestAuntieModalContent}
        bookingModalContent={bookingModalContent}
      />,
    );

    expect(
      await screen.findByRole('dialog', { name: getBookingModalTitleForAgeGroup('0-1') }),
    ).toBeInTheDocument();
    const dateSelectorRegion = screen.getByRole('region', { name: bookingContent.dateSelectorLabel });
    expect(within(dateSelectorRegion).getAllByRole('button')).toHaveLength(4);
    expect(
      within(dateSelectorRegion).getByRole('button', {
        name: new RegExp(formatCohortValue(lateCohort.cohort, 'en')),
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
