import { describe, expect, it } from 'vitest';

import { parseContactSearchQuery } from '@/lib/parse-contact-search-query';

describe('parseContactSearchQuery', () => {
  it('splits a given name and surname', () => {
    expect(parseContactSearchQuery('Ada Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: null,
      phoneRegion: null,
      phoneNational: null,
    });
  });

  it('maps a lone token to first name', () => {
    expect(parseContactSearchQuery('Ada')).toEqual({
      firstName: 'Ada',
      lastName: null,
      email: null,
      phoneRegion: null,
      phoneNational: null,
    });
  });

  it('maps an email to email and local-part first name', () => {
    expect(parseContactSearchQuery('ada@example.com')).toEqual({
      firstName: 'ada',
      lastName: null,
      email: 'ada@example.com',
      phoneRegion: null,
      phoneNational: null,
    });
  });

  it('keeps a name when an email is also present', () => {
    expect(parseContactSearchQuery('Ada Lovelace ada@example.com')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phoneRegion: null,
      phoneNational: null,
    });
  });

  it('maps a Hong Kong national number to phone fields', () => {
    expect(parseContactSearchQuery('91234567')).toEqual({
      firstName: '91234567',
      lastName: null,
      email: null,
      phoneRegion: 'HK',
      phoneNational: '91234567',
    });
  });
});
