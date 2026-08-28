import { describe, expect, it } from 'vitest';

import bookAFreeCall from '@/content/landing-pages/book-a-free-call.json';

describe('book-a-free-call landing page locale JSON', () => {
  it('keeps introCall keys aligned across locales', () => {
    const keysEn = Object.keys(bookAFreeCall.en.introCall).sort();
    expect(Object.keys(bookAFreeCall['zh-CN'].introCall).sort()).toEqual(keysEn);
    expect(Object.keys(bookAFreeCall['zh-HK'].introCall).sort()).toEqual(keysEn);
  });

  it('includes anchor CTA href and label on hero in every locale', () => {
    for (const loc of ['en', 'zh-CN', 'zh-HK'] as const) {
      const block = bookAFreeCall[loc];
      expect(block.hero.ctaAnchorHref).toBe('#intro-call-booking');
      expect(block.hero.ctaAnchorLabel?.trim()).toBeTruthy();
    }
  });

  it('does not define outline or cta blocks (hero anchors only)', () => {
    for (const loc of ['en', 'zh-CN', 'zh-HK'] as const) {
      const block = bookAFreeCall[loc] as Record<string, unknown>;
      expect(block.outline).toBeUndefined();
      expect(block.cta).toBeUndefined();
    }
  });

  it('includes loadErrorMessage for intro-call picker in every locale', () => {
    for (const loc of ['en', 'zh-CN', 'zh-HK'] as const) {
      expect(bookAFreeCall[loc].introCall.loadErrorMessage?.trim()).toBeTruthy();
    }
  });

  it('omits hero eyebrow (chip comes from optional JSON only, like other landings)', () => {
    for (const loc of ['en', 'zh-CN', 'zh-HK'] as const) {
      expect(bookAFreeCall[loc].hero).not.toHaveProperty('eyebrow');
    }
  });

  it('includes two hero quickFactChips in every locale', () => {
    for (const loc of ['en', 'zh-CN', 'zh-HK'] as const) {
      const chips = bookAFreeCall[loc].hero.quickFactChips;
      expect(Array.isArray(chips)).toBe(true);
      expect(chips).toHaveLength(2);
      expect(chips?.[0]?.type).toBe('category');
      expect(chips?.[1]?.type).toBe('category');
      expect(chips?.[0]?.label?.trim()).toBeTruthy();
      expect(chips?.[1]?.label?.trim()).toBeTruthy();
    }
  });

  it('uses specific AMI age bands and a numbered family trust claim', () => {
    expect(bookAFreeCall.en.hero.quickFactChips?.[0]?.label).toBe(
      'AMI Montessori-certified for 0-3 & 3-6',
    );
    expect(bookAFreeCall.en.hero.quickFactChips?.[1]?.label).toBe(
      'Trusted by 40+ Hong Kong families',
    );
    expect(bookAFreeCall.en.details.items[3]?.description).toContain(
      'AMI Montessori certified for 0-3 and 3-6, MEd from the University of Hong Kong, Stanford Child Nutrition',
    );
    expect(bookAFreeCall['zh-CN'].hero.quickFactChips?.[0]?.label).toContain('0-3');
    expect(bookAFreeCall['zh-HK'].hero.quickFactChips?.[0]?.label).toContain('0-3');
  });
});
