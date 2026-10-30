import { describe, expect, it } from 'vitest';

import {
  collectFamilyConsultationKeyErrors,
  collectLandingPageHeroChipErrors,
  collectLocaleKeyErrors,
} from '../../scripts/validate-content.mjs';

describe('locale content key contract', () => {
  it('accepts lowerCamelCase, meta keys, and kebab slugs', () => {
    const errors: string[] = [];
    collectLocaleKeyErrors(
      {
        contactUs: { form: { submitLabel: 'Send' } },
        resources: { sectionConfig: { _comment: 'meta' } },
        bookingModal: { serviceLabels: { 'training-course': 'Course' } },
      },
      'en',
      errors,
    );
    expect(errors).toEqual([]);
  });

  it('rejects legacy contact keys and snake_case segments', () => {
    const errors: string[] = [];
    collectLocaleKeyErrors(
      { contactUs: { contactUsForm: { title: 'Old' }, phone_number: '1' } },
      'en',
      errors,
    );
    expect(errors.some((error) => error.includes('contactUsForm'))).toBe(true);
    expect(errors.some((error) => error.includes('phone_number'))).toBe(true);
  });
});

describe('landing page hero chips', () => {
  it('accepts a static chip and a calendar slot the hero can fill', () => {
    const errors: string[] = [];
    collectLandingPageHeroChipErrors(
      {
        en: {
          hero: {
            quickFactChips: [
              { type: 'date', from: 'event' },
              { type: 'visits', label: '8 families' },
            ],
          },
        },
      },
      'nov-2026-mealtimes-workshop.json',
      errors,
    );
    expect(errors).toEqual([]);
  });

  it('rejects a missing static label, a bad from value, and an event type the calendar never emits', () => {
    const errors: string[] = [];
    collectLandingPageHeroChipErrors(
      {
        en: {
          hero: {
            quickFactChips: [
              { type: 'date' },
              { type: 'date', from: 'Event' },
              { type: 'visits', from: 'event' },
            ],
          },
        },
      },
      'nov-2026-mealtimes-workshop.json',
      errors,
    );
    expect(errors).toEqual([
      'nov-2026-mealtimes-workshop.json.en.hero.quickFactChips[0].label is required for a static hero chip',
      'nov-2026-mealtimes-workshop.json.en.hero.quickFactChips[1].from must be "event"',
      'nov-2026-mealtimes-workshop.json.en.hero.quickFactChips[2].type must be category, date, location, or time when from is "event"',
    ]);
  });
});

describe('family consultations key contract', () => {
  it('accepts snake_case location fields', () => {
    const errors: string[] = [];
    collectFamilyConsultationKeyErrors(
      { data: [{ location_name: 'Room', location_address: '1 Example Street' }] },
      errors,
    );
    expect(errors).toEqual([]);
  });

  it('rejects camelCase and legacy location keys', () => {
    const errors: string[] = [];
    collectFamilyConsultationKeyErrors(
      { data: [{ locationName: 'Room', address_url: 'https://example.com' }] },
      errors,
    );
    expect(errors.some((error) => error.includes('locationName'))).toBe(true);
    expect(errors.some((error) => error.includes('address_url'))).toBe(true);
  });
});
