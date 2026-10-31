import { test, expect } from '@playwright/test';

test('household signs in, saves a name, reloads and signs out', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Two travellers. Individual allowances.' })).toBeVisible();
  await expect(page.getByLabel('Allowance reference date', { exact: true })).toHaveCount(0);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await expect(page.getByText(`As of ${today} · confirmed history only`, { exact: true })).toHaveCount(2);
  const profiles = page.locator('.profiles').getByRole('article');
  await expect(profiles).toHaveCount(2);
  await expect(page.getByText('Standard 90/180 rule')).toHaveCount(2);
  await profiles.first().getByLabel('Display name').fill(`Saved ${test.info().project.name}`);
  await profiles.first().getByRole('button', { name: 'Save name' }).click();
  await expect(profiles.first().getByRole('status')).toHaveText('Name saved.');
  await page.reload();
  await expect(profiles.first().getByLabel('Display name')).toHaveValue(`Saved ${test.info().project.name}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('household.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
