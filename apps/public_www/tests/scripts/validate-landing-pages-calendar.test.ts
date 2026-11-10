import { describe, expect, it } from 'vitest';

import {
  buildCalendarUrl,
  resolveCalendarProbeBaseUrl,
} from '../../scripts/validate-landing-pages-calendar.mjs';

describe('calendar probe base URL', () => {
  it('keeps an absolute API origin and appends the calendar path', () => {
    expect(resolveCalendarProbeBaseUrl('https://api.example.com/prod/')).toBe(
      'https://api.example.com/prod',
    );
    expect(buildCalendarUrl('https://api.example.com/prod', 'book-a-free-call')).toBe(
      'https://api.example.com/prod/v1/calendar/public?slug=book-a-free-call',
    );
  });

  it('rejects the relative /www build path', () => {
    expect(() => resolveCalendarProbeBaseUrl('/www')).toThrow(
      /absolute http\(s\) URL/,
    );
  });
});
