import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('history proofs upload, persist, download privately and can be removed', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next chapter, in reach.' })).toBeVisible();
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  for (const trip of await (await page.request.get('/api/v1/trips')).json()) {
    expect((await page.request.delete(`/api/v1/trips/${trip.id}?version=${trip.version}`, { headers })).ok()).toBeTruthy();
  }
  const profiles = await (await page.request.get('/api/v1/travellers')).json();
  const saved = await page.request.post('/api/v1/trips', { headers, data: {
    title: 'Journey with travel evidence', status: 'HISTORY', participants: [{
      traveller_id: profiles[0].id, entry_date: '2026-01-01', exit_date: '2026-01-02',
      segments: [{ country_code: 'FR', start_date: '2026-01-01', end_date: '2026-01-02' }],
    }],
  } });
  expect(saved.ok()).toBeTruthy();
  const trip = await saved.json();
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'History', exact: true }).click();
  const proofButton = page.getByRole('button', { name: 'Proof documents for Journey with travel evidence' });
  await expect(proofButton.getByRole('img', { name: 'Proof uploaded' })).toHaveCount(0);
  await proofButton.click();
  const proofs = page.getByRole('region', { name: 'Proof of travel' });
  await expect(proofs).toContainText('No proof documents attached.');
  const pdf = Buffer.from('%PDF-1.7\ntravel evidence\n%%EOF\n');
  await proofs.getByLabel('Travel proof document').setInputFiles({ name: 'boarding.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid document') });
  await proofs.getByRole('button', { name: 'Upload proof', exact: true }).click();
  await expect(proofs.getByRole('alert')).toContainText('Only PDF, JPEG and PNG');
  await proofs.getByLabel('Travel proof document').setInputFiles({ name: 'boarding.pdf', mimeType: 'application/pdf', buffer: pdf });
  await proofs.getByRole('button', { name: 'Upload proof', exact: true }).click();
  await expect(proofs.getByRole('status')).toContainText('Proof uploaded.');
  await expect(proofs.getByRole('button', { name: 'Download boarding.pdf' })).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(proofButton.getByRole('img', { name: 'Proof uploaded' })).toBeVisible();
  const records = await (await page.request.get(`/api/v1/trips/${trip.id}/proofs`)).json();
  const proofPath = `/api/v1/trips/${trip.id}/proofs/${records[0].id}`;
  await page.reload();
  await expect(proofButton).toBeVisible({ timeout: 60_000 });
  await expect(proofButton.getByRole('img', { name: 'Proof uploaded' })).toBeVisible();
  await proofButton.click();
  const downloadEvent = page.waitForEvent('download');
  await proofs.getByRole('button', { name: 'Download boarding.pdf' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('boarding.pdf');
  expect(await readFile((await download.path())!)).toEqual(pdf);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('history-proofs.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get(proofPath)).status()).toBe(401);
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Proof documents for Journey with travel evidence' }).click();
  await proofs.getByRole('button', { name: 'Remove boarding.pdf' }).click();
  await expect(proofs.getByRole('status')).toContainText('Proof removed.');
  await expect(proofs).toContainText('No proof documents attached.');
  expect((await page.request.get(proofPath)).status()).toBe(404);
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(proofButton.getByRole('img', { name: 'Proof uploaded' })).toHaveCount(0);
  await page.reload();
  await expect(proofButton).toBeVisible({ timeout: 60_000 });
  await expect(proofButton.getByRole('img', { name: 'Proof uploaded' })).toHaveCount(0);
});
