import { expect, test, type Page } from '@playwright/test';

const englishHero = /The person who spends the most time with your child was never trained/;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

test('english home shows the hero and stays free of page errors', async ({ page }) => {
  const errors = collectPageErrors(page);
  const response = await page.goto('/en/');

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Evolve Sprouts/);
  await expect(page.getByRole('heading', { level: 1, name: englishHero })).toBeVisible();
  expect(errors).toEqual([]);
});

test('hero call to action opens the training course', async ({ page }) => {
  await page.goto('/en/');
  await page
    .locator('#hero-banner')
    .getByRole('link', { name: 'See how the programme works' })
    .click();

  await expect(page).toHaveURL(/\/en\/services\/my-best-auntie-training-course\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: /My Best Auntie/ })).toBeVisible();
});

test('about us opens from the navigation', async ({ page }) => {
  await page.goto('/en/');
  await page.getByRole('banner').getByRole('link', { name: 'About Us', exact: true }).click();

  await expect(page).toHaveURL(/\/en\/about-us\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, fellow parents!' })).toBeVisible();
});

test('traditional chinese home uses chinese copy', async ({ page }) => {
  await page.goto('/zh-HK/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[\u4e00-\u9fff]/);
});

test('privacy and terms pages render', async ({ page }) => {
  const pages = [
    { path: '/en/privacy/', heading: 'Privacy Policy' },
    { path: '/en/terms/', heading: 'Terms and Conditions' },
  ];

  for (const entry of pages) {
    const response = await page.goto(entry.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 2, name: entry.heading })).toBeVisible();
  }
});

test('phone home does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/');

  await expect(page.getByRole('heading', { level: 1, name: englishHero })).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
});
