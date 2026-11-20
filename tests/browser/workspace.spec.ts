import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://rpc-bradbury.genlayer.com/**', route => route.abort());
  // A read-only flow must never consult an injected wallet.
  await page.addInitScript(() => Object.defineProperty(window, 'ethereum', {
    get() { throw new Error('Wallet accessed by a read-only test'); },
  }));
});

test('compares requirements, switches layouts and navigates changes', async ({ page }) => {
  await page.goto('/#compare');
  await page.getByRole('textbox', { name: /Original requirements/ }).fill('Retain audit logs for 90 days.\nBaseline\nKeep a PDF copy.');
  await page.getByRole('textbox', { name: /Revised requirements/ }).fill('Retain audit logs for 30 days.\nBaseline\nKeep a CSV copy.');
  await expect(page.locator('mark').filter({ hasText: '90' })).toBeVisible();
  await expect(page.getByText('Numbers or limits')).toBeVisible();
  await page.getByRole('button', { name: 'Unified' }).click();
  await expect(page.getByRole('button', { name: 'Unified' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next change' }).click();
  await expect(page.getByRole('button', { name: 'Change 1', exact: true })).toHaveAttribute('aria-current', 'location');
  await page.getByRole('button', { name: 'Next change' }).click();
  await expect(page.getByRole('button', { name: 'Change 2', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(page.getByText(/Wallet submissions are paused/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect wallet/ })).toHaveCount(0);
});

test('keeps simulated verdicts separate and jumps to source on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Reviewer demo' }).click();
  await expect(page.getByRole('heading', { name: 'Simulated expected assessment' })).toBeVisible();
  for (const [index, verdict] of ['Compatible', 'Potential conflict', 'Needs review'].entries()) {
    await page.getByRole('combobox', { name: 'Example scenario' }).selectOption(String(index));
    await expect(page.getByText(verdict, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Line 1', exact: true }).first().click();
  await expect(page.locator('.source-hit')).toBeVisible();
  await expect(page.getByText('No finalized assessment is available for this demo yet.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('validates identifiers and opens shareable lookup in a clean browser', async ({ page, browser }) => {
  await page.goto('/#history');
  await page.getByRole('link', { name: 'Recover by transaction ID' }).click();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('64-digit');
  await page.getByLabel('Identifier type').selectOption('wallet');
  const hash = '0x' + 'ab'.repeat(32);
  await page.getByLabel('Transaction identifier').fill(hash);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('#verify/wallet/' + hash + '$'));
  const context = await browser.newContext();
  try {
    const opened = await context.newPage();
    await opened.route('https://rpc-bradbury.genlayer.com/**', route => route.abort());
    await opened.goto(page.url());
    await expect(opened.getByRole('heading', { name: 'Bradbury assessment report' })).toBeVisible();
    await expect(opened.getByRole('status')).toContainText('Bradbury data unavailable');
    await expect(opened.getByRole('button', { name: 'Save to history' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
