import { describe, expect, it } from 'vitest';

import helperTraining from '@/content/landing-pages/helper-training-hong-kong.json';

const LOCALES = ['en', 'zh-CN', 'zh-HK'] as const;

describe('helper-training-hong-kong landing page locale JSON', () => {
  it('keeps top-level and courseBooking keys aligned across locales', () => {
    const topLevelEn = Object.keys(helperTraining.en).sort();
    const courseBookingEn = Object.keys(helperTraining.en.courseBooking).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(helperTraining[locale]).sort(), locale).toEqual(topLevelEn);
      expect(Object.keys(helperTraining[locale].courseBooking).sort(), locale).toEqual(
        courseBookingEn,
      );
    }
  });

  it('anchors the hero CTA to the My Best Auntie booking section in every locale', () => {
    for (const locale of LOCALES) {
      const block = helperTraining[locale];
      expect(block.hero.ctaAnchorHref).toBe('#my-best-auntie-booking');
      expect(block.hero.ctaAnchorLabel.trim()).toBeTruthy();
    }
  });

  it('does not define outline, cta or introCall blocks (paid page uses the cohort picker)', () => {
    for (const locale of LOCALES) {
      const block = helperTraining[locale] as Record<string, unknown>;
      expect(block.outline).toBeUndefined();
      expect(block.cta).toBeUndefined();
      expect(block.introCall).toBeUndefined();
    }
  });

  it('keeps static chips to duration, visits and certification so price and cohort come from the CRM', () => {
    for (const locale of LOCALES) {
      const chips = helperTraining[locale].hero.quickFactChips;
      expect(chips.map((chip) => chip.type)).toEqual(['duration', 'visits', 'category']);
      for (const chip of chips) {
        expect(chip.label.trim(), locale).toBeTruthy();
      }
    }
  });

  it('uses {currency}/{price} and {cohortLabel} placeholders in the chip templates', () => {
    for (const locale of LOCALES) {
      const { courseBooking } = helperTraining[locale];
      expect(courseBooking.priceChipTemplate).toContain('{currency}');
      expect(courseBooking.priceChipTemplate).toContain('{price}');
      expect(courseBooking.nextCohortChipTemplate).toContain('{cohortLabel}');
      expect(courseBooking.whatsappCtaLabel.trim()).toBeTruthy();
      expect(courseBooking.whatsappPrefillMessage.trim()).toBeTruthy();
    }
  });

  it('never hardcodes a price in copy (the CRM cohort is the single source of truth)', () => {
    for (const locale of LOCALES) {
      const serialized = JSON.stringify(helperTraining[locale]);
      expect(serialized, locale).not.toMatch(/HK\$\s?\d/);
      expect(serialized, locale).not.toMatch(/\d{1,3},\d{3}/);
    }
  });
});
