import { test, expect } from '@playwright/test';

test('household signs in to Home, manages profiles in More, reloads and signs out', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next chapter, in reach.' })).toBeVisible();
  await expect(page.getByLabel('Allowance reference date', { exact: true })).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name:'Main navigation' });
  await navigation.getByRole('button', { name:'More',exact:true }).click();
  const profiles = page.locator('.profiles').getByRole('article');
  await expect(profiles).toHaveCount(2);
  await expect(profiles.getByText('Standard 90/180 rule')).toHaveCount(2);
  await profiles.first().getByLabel('Display name').fill(`Saved ${test.info().project.name}`);
  await profiles.first().getByRole('button', { name: 'Save name' }).click();
  await expect(profiles.first().getByRole('status')).toHaveText('Name saved.');
  await page.reload();
  await expect(profiles.first().getByLabel('Display name')).toHaveValue(`Saved ${test.info().project.name}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dark-more.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
