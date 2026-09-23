import { describe, expect, it } from 'vitest';

import {
  formatInstagramHandleDisplay,
  instagramHandleForStorage,
} from '@/lib/contacts/contacts-panel-helpers';

describe('instagram handle display', () => {
  it('stores handles without a leading @', () => {
    expect(instagramHandleForStorage(' @Mei.C ')).toBe('mei.c');
    expect(instagramHandleForStorage('mei.c')).toBe('mei.c');
    expect(instagramHandleForStorage('@')).toBeNull();
    expect(instagramHandleForStorage('')).toBeNull();
  });

  it('prefixes @ for display only', () => {
    expect(formatInstagramHandleDisplay('mei.c')).toBe('@mei.c');
    expect(formatInstagramHandleDisplay('@Mei.C')).toBe('@mei.c');
    expect(formatInstagramHandleDisplay(null)).toBe('');
  });
});
