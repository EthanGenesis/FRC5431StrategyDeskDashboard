import { expect, test } from '@playwright/test';

test('major scope tabs and preserved troubleshooting UI are reachable', async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });

  await page.goto('/');

  await expect(page.locator('.dashboard-layout')).toBeVisible();
  await expect(page.locator('.dashboard-productbar')).toBeVisible();
  await expect(page.locator('.dashboard-topbar')).toBeVisible();
  await expect(
    page.locator('.page-header-title').filter({ hasText: 'Live Match Queue' }),
  ).toBeVisible();

  const productBarHeight = await page
    .locator('.dashboard-productbar')
    .evaluate((element) => element.getBoundingClientRect().height);
  const topBarHeight = await page
    .locator('.dashboard-topbar')
    .evaluate((element) => element.getBoundingClientRect().height);

  expect(productBarHeight).toBeLessThan(56);
  expect(topBarHeight).toBeLessThan(56);
  expect(productBarHeight + topBarHeight).toBeLessThan(108);

  await expect(page.getByRole('button', { name: 'CURRENT' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'HISTORICAL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PREDICT' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SETTINGS' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'NOW' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'GAME MANUAL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DISTRICT', exact: true })).toBeVisible();

  const subnavHeight = await page
    .locator('.dashboard-subnav')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(subnavHeight).toBeLessThan(48);

  await page.getByRole('button', { name: 'HISTORICAL' }).click();
  await expect(page.getByRole('button', { name: 'PRE_EVENT' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DISTRICT', exact: true })).toBeVisible();
  await expect(
    page.locator('.page-header-title').filter({ hasText: 'Season Scouting' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'PREDICT' }).click();
  await expect(page.getByRole('button', { name: 'PREDICT' }).nth(1)).toBeVisible();
  await expect(page.getByRole('button', { name: 'ALLIANCE', exact: true })).toBeVisible();
  await expect(
    page.locator('.page-header-title').filter({ hasText: 'Qualification Forecast' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'SETTINGS' }).click();
  await expect(
    page.locator('.page-header-title').filter({ hasText: 'Product Controls' }),
  ).toBeVisible();
  await expect(page.getByText('Poll Speed (milliseconds)')).toBeVisible();

  const themeSelect = page.locator('select').nth(0);
  const languageSelect = page.locator('select').nth(1);
  await themeSelect.selectOption('light-slate');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light-slate');
  await languageSelect.selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByText('Tema')).toBeVisible();

  await page.getByRole('button', { name: /Diagnostics Coverage/i }).click();
  await page.getByRole('button', { name: /Raw Payload Explorer/i }).click();
  await expect(page.getByText(/payload/i).first()).toBeVisible();

  expect(
    consoleMessages
      .filter((message) => !message.includes('Download the React DevTools'))
      .join('\n'),
  ).not.toContain('The width(0) and height(0) of chart should be greater than 0');
});
