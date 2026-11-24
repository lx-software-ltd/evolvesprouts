import { expect, test, type Page } from '@playwright/test';

import enContent from '../src/content/en.json';
import zhHkContent from '../src/content/zh-HK.json';

function navbarLabel(href: string): string {
  const item = enContent.navbar.menuItems.find((entry) => entry.href === href);
  if (!item) {
    throw new Error(`Navbar item missing for ${href}`);
  }
  return item.label;
}

function localizedPath(path: string): RegExp {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/en${escapedPath}/?$`);
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

test('english home shows the hero and stays free of page errors', async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto('/en/');

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(enContent.seo.home.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(enContent.hero.title);
  expect(errors).toEqual([]);
});

test('hero call to action opens the training course', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/en/');
  await page
    .locator('#hero-banner')
    .getByRole('link', { name: enContent.hero.cta })
    .click();

  await expect(page).toHaveURL(localizedPath(enContent.hero.ctaHref));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(enContent.myBestAuntie.hero.title);
  expect(errors).toEqual([]);
});

test('about us opens from the navigation', async ({ page }) => {
  const errors = watchPageErrors(page);
  const aboutHref = '/about-us';
  await page.goto('/en/');
  await page.getByRole('banner').getByRole('link', { name: navbarLabel(aboutHref), exact: true }).click();

  await expect(page).toHaveURL(localizedPath(aboutHref));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(enContent.aboutUs.hero.title);
  expect(errors).toEqual([]);
});

test('traditional chinese home uses the locale hero', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/zh-HK/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(zhHkContent.hero.title);
  expect(errors).toEqual([]);
});

test('privacy and terms pages render', async ({ page }) => {
  const errors = watchPageErrors(page);
  const pages = [
    { path: '/en/privacy/', heading: enContent.privacyPolicy.title },
    { path: '/en/terms/', heading: enContent.termsAndConditions.title },
  ];

  for (const entry of pages) {
    const response = await page.goto(entry.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 2, name: entry.heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('phone home does not scroll sideways', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(enContent.hero.title);
  await expect(page.locator('footer')).toBeVisible();

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(errors).toEqual([]);
});
