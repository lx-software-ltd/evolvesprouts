import { describe, expect, it } from 'vitest';

import mealtimes from '@/content/landing-pages/nov-2026-mealtimes-workshop.json';

const locales = ['en', 'zh-CN', 'zh-HK'] as const;

describe('nov-2026-mealtimes-workshop landing page', () => {
  it('omits the hero eyebrow in every locale', () => {
    for (const locale of locales) {
      expect(mealtimes[locale].hero).not.toHaveProperty('eyebrow');
    }
  });

  it('uses the high-chair mealtime photo in every locale', () => {
    for (const locale of locales) {
      expect(mealtimes[locale].hero.imageSrc).toBe(
        '/images/hero/mealtimes-workshop-hero.webp',
      );
      expect(mealtimes[locale].hero.imageAlt).toBe(
        'Smiling toddler in a high chair holding broccoli',
      );
    }
  });

  it('keeps the parents call and family count as the only static hero chips', () => {
    for (const locale of locales) {
      const chips = mealtimes[locale].hero.quickFactChips ?? [];
      expect(chips.map((chip) => chip.type)).toEqual(['date', 'visits']);
      expect(chips[0]?.label).toContain('Tue 1 Dec');
      expect(chips[1]?.label).toBe('8 families');
    }
  });

  it('uses the five Saturday run-of-show slots in every locale', () => {
    const expectedTitles = [
      '9:00 — Why she isn\'t hungry at dinner',
      '9:20 — Building the plate',
      '9:45 — Hands on: pouring, serving herself, clearing her own place',
      '10:30 — What to say instead',
      '10:50 — One thing this week',
    ];
    for (const locale of locales) {
      expect(mealtimes[locale].description.items.map((item) => item.title)).toEqual(
        expectedTitles,
      );
    }
  });

  it('overrides the trainer bio with the mealtimes credentials in every locale', () => {
    for (const locale of locales) {
      const coach = mealtimes[locale].coach;
      expect(coach.eyebrow).toBe('Your trainer');
      expect(coach.title).toBe(mealtimes.en.coach.title);
      expect(coach.title.trim().length).toBeGreaterThan(0);
      expect(coach.description).toContain(coach.highlightedPhrase);
      expect(coach.highlightedPhrase).toBe('Child Nutrition certification from Stanford');
      expect(coach.tags).toEqual([
        'AMI Montessori (0–3 and 3–6)',
        'MEd, HKU',
        'Child Nutrition, Stanford',
      ]);
      expect(coach.description).not.toMatch(/@/);
    }
  });
});
