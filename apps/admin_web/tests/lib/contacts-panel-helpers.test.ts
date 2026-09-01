import { describe, expect, it } from 'vitest';

import {
  formatInstagramHandleDisplay,
  instagramHandleForStorage,
} from '@/lib/contacts/contacts-panel-helpers';

describe('instagram handle display', () => {
  it('stores handles without a leading @', () => {
    expect(instagramHandleForStorage(' @Kitie.W ')).toBe('kitie.w');
    expect(instagramHandleForStorage('kitie.w')).toBe('kitie.w');
    expect(instagramHandleForStorage('@')).toBeNull();
    expect(instagramHandleForStorage('')).toBeNull();
  });

  it('prefixes @ for display only', () => {
    expect(formatInstagramHandleDisplay('kitie.w')).toBe('@kitie.w');
    expect(formatInstagramHandleDisplay('@Kitie.W')).toBe('@kitie.w');
    expect(formatInstagramHandleDisplay(null)).toBe('');
  });
});
