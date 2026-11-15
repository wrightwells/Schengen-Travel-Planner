import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// The inherited webServer configuration uses tests/e2e/serve.py: a disposable
// database and proof directory, never the installation at localhost:9067.
test('capture README screens using fictional demo travel', async ({ page }) => {
  const directory = resolve('../docs/screenshots');
  await mkdir(directory, { recursive: true });
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
  await page.goto('/');
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next chapter, in reach.' })).toBeVisible();
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  const profiles = await (await page.request.get('/api/v1/travellers')).json();

  async function seed(title: string, start: string, end: string, country: string, ids: string[], status = 'HISTORY') {
    const response = await page.request.post('/api/v1/trips', { headers, data: {
      title, status, participants: ids.map(id => ({ traveller_id: id, entry_date: start, exit_date: end,
        segments: [{ country_code: country, start_date: start, end_date: end }],
      })),
    } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  await seed('A month on the French coast', '2026-08-16', '2026-09-14', 'FR', [profiles[0].id]);
  const italy = await seed('Autumn in Italy', '2026-10-03', '2026-10-12', 'IT', profiles.map((p: { id: string }) => p.id));
  const winter = await seed('A winter escape in Spain', '2026-12-05', '2026-12-22', 'ES', profiles.map((p: { id: string }) => p.id), 'PLANNED');
  const spring = await seed('Spring in Portugal', '2027-03-08', '2027-03-28', 'PT', profiles.map((p: { id: string }) => p.id), 'PLANNED');
  const currentProfiles = await (await page.request.get('/api/v1/travellers')).json();
  for (const [index, profile] of currentProfiles.entries()) {
    const response = await page.request.patch(`/api/v1/travellers/${profile.id}`, { headers, data: {
      display_name: ['Alex', 'Sam'][index], notes: '', rule_applicable: true,
      history_complete: true, version: profile.version,
    } });
    expect(response.ok()).toBeTruthy();
  }
  expect((await page.request.post(`/api/v1/trips/${italy.id}/proofs?filename=boarding-pass-italy.pdf`, {
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    data: Buffer.from('%PDF-1.4\n% Fictional demonstration document\n%%EOF\n'),
  })).ok()).toBeTruthy();
  await page.evaluate(ids => localStorage.setItem('schengen-included-plans', JSON.stringify(ids)), [winter.id, spring.id]);
  await page.reload();
  await page.getByRole('group', { name: 'Selected traveller', exact: true }).getByRole('button', { name: 'Both', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  async function navigate(name: string) {
    await navigation.getByRole('button', { name, exact: true }).click();
  }
  async function screenshot(name: string, fullPage = false) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: resolve(directory, name), fullPage, animations: 'disabled' });
  }

  await expect(page.locator('.allowance-card').first()).toContainText('40');
  await expect(page.locator('.eligibility-line').first()).toContainText('Eligible');
  await screenshot('home-desktop.png', true);
  await navigate('History');
  await expect(page.getByRole('heading', { name: 'Autumn in Italy', exact: true })).toBeVisible();
  await screenshot('history-desktop.png');
  await navigate('Planner');
  const plannerView = page.getByRole('group', { name: 'Planner view', exact: true });
  await plannerView.getByRole('button', { name: 'Trips', exact: true }).click();
  await expect(page.locator('.plan-assessments')).toHaveCount(2);
  await screenshot('planner-desktop.png');
  await plannerView.getByRole('button', { name: 'Calendar', exact: true }).click();
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2026-12');
  await expect(calendar.getByRole('button', { name: 'Inspect 2026-12-05', exact: true }).locator('.calendar-marker.plan')).toHaveCount(2);
  await screenshot('calendar-desktop.png', true);
  await plannerView.getByRole('button', { name: 'Timeline', exact: true }).click();
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2026');
  const timeline = calendar.getByRole('region', { name: 'Year travel timeline' });
  const handle = timeline.getByRole('button', { name: 'Alex: Change end of A winter escape in Spain', exact: true });
  await handle.scrollIntoViewIfNeeded();
  await handle.evaluate(element => {
    const scroller = element.closest('.gantt-scroll')!;
    scroller.scrollLeft += element.getBoundingClientRect().x - (scroller.getBoundingClientRect().left + 700);
  });
  await screenshot('timeline-desktop.png', true);
  await navigate('More');
  await expect(page.getByRole('button', { name: 'Save name' })).toHaveCount(2);
  await screenshot('more-desktop.png');

  await page.setViewportSize({ width: 390, height: 900 });
  await navigate('Home');
  await page.getByRole('group', { name: 'Selected traveller', exact: true }).getByRole('button', { name: 'Alex', exact: true }).click();
  await expect(page.locator('.eligibility-line').first()).toContainText('Eligible');
  await screenshot('home-mobile.png');
  await navigate('History');
  await page.getByRole('button', { name: 'Proof documents for Autumn in Italy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download boarding-pass-italy.pdf' })).toBeVisible();
  await page.getByRole('dialog').screenshot({ path: resolve(directory, 'proof-mobile.png'), animations: 'disabled' });
});
