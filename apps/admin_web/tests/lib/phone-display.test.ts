import { describe, expect, it } from 'vitest';

import { formatPhoneInternationalDisplay } from '@/lib/phone-display';

describe('formatPhoneInternationalDisplay', () => {
  it('formats Hong Kong 8-digit numbers as +852 1234 5678', () => {
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: 'HK',
        phoneNationalNumber: '12345678',
        phoneE164: '+85212345678',
      })
    ).toBe('+852 1234 5678');
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: 'HK',
        phoneNationalNumber: '91234567',
        phoneE164: '+85291234567',
      })
    ).toBe('+852 9123 4567');
  });

  it('formats Hong Kong from e164 or national digits alone', () => {
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: null,
        phoneNationalNumber: null,
        phoneE164: '+85212345678',
      })
    ).toBe('+852 1234 5678');
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: 'hk',
        phoneNationalNumber: '1234 5678',
        phoneE164: null,
      })
    ).toBe('+852 1234 5678');
  });

  it('formats other countries with international grouping', () => {
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: 'US',
        phoneNationalNumber: '2133734253',
        phoneE164: '+12133734253',
      })
    ).toBe('+1 213 373 4253');
  });

  it('returns null when no phone is present', () => {
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: null,
        phoneNationalNumber: null,
        phoneE164: null,
      })
    ).toBeNull();
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: 'HK',
        phoneNationalNumber: '   ',
        phoneE164: '',
      })
    ).toBeNull();
  });

  it('falls back to stored e164 when the number cannot be parsed', () => {
    expect(
      formatPhoneInternationalDisplay({
        phoneRegion: null,
        phoneNationalNumber: null,
        phoneE164: '+999',
      })
    ).toBe('+999');
  });
});
