import { describe, expect, it } from 'vitest';

import enContent from '@/content/en.json';
import zhCNContent from '@/content/zh-CN.json';
import zhHKContent from '@/content/zh-HK.json';

const CANONICAL_STORY_KEYS = new Set([
  'quote',
  'author',
  'service',
  'mainImageSrc',
]);

describe('testimonials locale content', () => {
  it('keeps featured quote keys aligned across locales', () => {
    const featuredKeys = Object.keys(enContent.testimonials.featured).sort();
    expect(featuredKeys).toEqual(['author', 'quote', 'sectionLabel', 'service']);
    expect(Object.keys(zhCNContent.testimonials.featured).sort()).toEqual(featuredKeys);
    expect(Object.keys(zhHKContent.testimonials.featured).sort()).toEqual(featuredKeys);
    expect(enContent.testimonials.featured.author).toBe('Sarah');
    expect(zhCNContent.testimonials.featured.author).toBe('Sarah');
    expect(zhHKContent.testimonials.featured.author).toBe('Sarah');
  });

  it('uses only canonical keys on testimonial items in en.json', () => {
    const items = enContent.testimonials.items;
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      if (typeof item !== 'object' || item === null) {
        throw new Error('Expected testimonial item to be an object.');
      }
      const keys = Object.keys(item);
      for (const key of keys) {
        expect(
          CANONICAL_STORY_KEYS.has(key),
          `Unexpected key "${key}" on testimonial item; use canonical keys only.`,
        ).toBe(true);
      }
    }
  });
});
