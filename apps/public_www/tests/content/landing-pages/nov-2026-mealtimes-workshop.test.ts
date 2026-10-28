import { describe, expect, it } from 'vitest';

import mealtimes from '@/content/landing-pages/nov-2026-mealtimes-workshop.json';

const locales = ['en', 'zh-CN', 'zh-HK'] as const;

describe('nov-2026-mealtimes-workshop landing page', () => {
  it('keeps the parents call and family count as the only static hero chips', () => {
    for (const locale of locales) {
      const chips = mealtimes[locale].hero.quickFactChips ?? [];
      expect(chips.map((chip) => chip.type)).toEqual(['date', 'visits']);
      expect(chips[0]?.label).toContain('Tue 1 Dec');
      expect(chips[1]?.label).toBe('8 families');
    }
  });

  it('overrides the trainer bio with the mealtimes credentials in every locale', () => {
    for (const locale of locales) {
      const coach = mealtimes[locale].coach;
      expect(coach.eyebrow).toBe('Your trainer');
      expect(coach.title).toBe('Ida De Gregorio');
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
