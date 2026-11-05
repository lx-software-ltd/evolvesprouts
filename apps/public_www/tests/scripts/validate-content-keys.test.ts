import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { composeBanner } from '../../scripts/build-eventbrite-banners.mjs';
import {
  collectEventbriteBannerErrors,
  collectFamilyConsultationKeyErrors,
  collectLandingPageHeroChipErrors,
  collectLocaleKeyErrors,
} from '../../scripts/validate-content.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

describe('eventbrite banners', () => {
  let directory = '';

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts a 2:1 png named for the landing page', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'eb-banner-'));
    const pages = path.join(directory, 'pages');
    const banners = path.join(directory, 'banners');
    await mkdir(pages);
    await mkdir(banners);
    await writeFile(path.join(pages, 'sample.json'), '{}');
    const png = await sharp({
      create: { width: 4, height: 2, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(banners, 'sample.png'), png);

    const errors: string[] = [];
    await collectEventbriteBannerErrors(pages, banners, errors);

    expect(errors).toEqual([]);
  });

  it('rejects a missing banner and a banner that is not 2:1', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'eb-banner-'));
    const pages = path.join(directory, 'pages');
    const banners = path.join(directory, 'banners');
    await mkdir(pages);
    await mkdir(banners);
    await writeFile(path.join(pages, 'missing.json'), '{}');
    await writeFile(path.join(pages, 'square.json'), '{}');
    const square = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(banners, 'square.png'), square);

    const errors: string[] = [];
    await collectEventbriteBannerErrors(pages, banners, errors);

    expect(errors).toEqual([
      'missing.json: missing Eventbrite banner missing.png',
      'square.json: Eventbrite banner must be a 2:1 PNG',
    ]);
  });

  it('rejects a banner that does not match the current hero', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'eb-banner-'));
    const pages = path.join(directory, 'pages');
    const banners = path.join(directory, 'banners');
    await mkdir(pages);
    await mkdir(banners);
    const filename = 'nov-2026-mealtimes-workshop.json';
    await copyFile(
      path.join(APP_ROOT, 'src', 'content', 'landing-pages', filename),
      path.join(pages, filename),
    );
    const page = JSON.parse(await readFile(path.join(pages, filename), 'utf8')) as {
      en: { hero: { imageSrc: string } };
    };
    const banner = Buffer.from(await composeBanner(page.en.hero.imageSrc));
    banner[banner.length - 32] ^= 0xff;
    await writeFile(path.join(banners, 'nov-2026-mealtimes-workshop.png'), banner);

    const errors: string[] = [];
    await collectEventbriteBannerErrors(pages, banners, errors);

    expect(errors).toEqual([
      'nov-2026-mealtimes-workshop.json: Eventbrite banner is stale; run npm run images:eventbrite-banners',
    ]);
  });
});
