import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add history', exact: true })).toBeEnabled();
  // Each test starts with clean travel data in the disposable test database.
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const trips = await (await page.request.get('/api/v1/trips')).json();
  for (const trip of trips) {
    const response = await page.request.delete(`/api/v1/trips/${trip.id}?version=${trip.version}`, {
      headers: { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add history', exact: true })).toBeEnabled();
});

async function fillParticipant(group: Locator, start: string, end: string, country: string) {
  await group.getByLabel('Entry date', { exact: true }).fill(start);
  await group.getByLabel('Exit date', { exact: true }).fill(end);
  await group.getByLabel('Country', { exact: true }).fill(country);
}

async function deleteTrip(page: Page, title: string) {
  await page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Delete ${title}`, exact: true })).toHaveCount(0);
}

test('Gantt calendar scrolls the year with months, weeks, trips and daily inspection', async ({ page }) => {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const profiles = await (await page.request.get('/api/v1/travellers')).json();
  const saved = await page.request.post('/api/v1/trips', {
    headers: { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token },
    data: { title: 'Gantt leap trip', status: 'PLANNED', participants: [{ traveller_id: profiles[0].id,
      entry_date: '2028-02-28', exit_date: '2028-03-02',
      segments: [{ country_code: 'FR', start_date: '2028-02-28', end_date: '2028-03-02' }] }] },
  });
  expect(saved.ok()).toBeTruthy();
  await page.reload();
  await page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: 'Gantt leap trip', exact: true }) })
    .getByRole('checkbox', { name: 'Include in scenario', exact: true }).check();
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await calendar.getByRole('button', { name: 'Gantt view', exact: true }).click();
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2028');
  const timeline = calendar.getByRole('region', { name: 'Year travel timeline', exact: true });
  await expect(timeline.locator('.gantt-months > strong')).toHaveCount(13);
  await expect(timeline.locator('.gantt-weeks')).toContainText('03 01');
  await expect(timeline.locator('.gantt-person')).toHaveCount(2);
  await expect(timeline.locator('.gantt-bar')).toHaveCount(1);
  await expect(timeline.locator('.gantt-bar')).toContainText('Gantt leap trip · 28 02 → 02 03');
  const leap = timeline.getByRole('button', { name: `${profiles[0].display_name}: Inspect 29 02 2028;`, exact: false });
  await leap.click();
  await expect(calendar.getByRole('complementary')).toContainText('2/90 used');
  await timeline.getByRole('button', { name: `${profiles[0].display_name}: Inspect 02 03 2028;`, exact: false }).click();
  await expect(calendar.getByRole('status')).toContainText('29 02 2028 → 02 03 2028');
  await expect(calendar.getByRole('button', { name: 'Plan selected dates', exact: true })).toBeEnabled();
  await timeline.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await timeline.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await expect(timeline.locator('.gantt-months').getByText('December', { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await timeline.evaluate(el => { el.scrollLeft = 1400; });
  await calendar.getByLabel('Calendar traveller').selectOption(profiles[0].id);
  await expect(timeline.locator('.gantt-person')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('gantt-calendar.png'), fullPage: true });
  await page.reload();
  await expect(calendar.getByRole('button', { name: 'Gantt view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(calendar.getByRole('combobox', { name: 'Calendar year', exact: true })).toHaveValue('2028');
  await expect(timeline.locator('.gantt-bar')).toHaveCount(1);
  await page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: 'Gantt leap trip', exact: true }) })
    .getByRole('checkbox', { name: 'Include in scenario', exact: true }).uncheck();
  await expect(timeline.locator('.gantt-bar')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Month view', exact: true }).click();
  await expect(calendar.getByLabel('Calendar month', { exact: true })).toBeVisible();
});

test('shared history uses one itinerary, preserves entered dates and applies traveller choices', async ({ page }) => {
  const title = `Shared history ${test.info().project.name}`;
  await page.getByRole('button', { name: 'Add history', exact: true }).click();
  const editor = page.locator('.trip-editor');
  const itinerary = editor.getByRole('group', { name: 'Trip dates and destinations', exact: true });
  await editor.getByLabel('Trip name').fill(title);
  await fillParticipant(itinerary, '2026-06-01', '2026-06-10', 'France');
  await editor.locator('.traveller-selection input').nth(1).check();
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveCount(1);
  await expect(editor.getByLabel('Exit date', { exact: true })).toHaveCount(1);
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveValue('2026-06-01');
  for (let i = 0; i < 2; i++) await editor.locator('.traveller-selection input').nth(i).uncheck();
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveValue('2026-06-01');
  await editor.getByRole('button', { name: 'Save history', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Select at least one traveller');
  for (let i = 0; i < 2; i++) await editor.locator('.traveller-selection input').nth(i).check();
  await editor.getByRole('button', { name: 'Save history', exact: true }).click();
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row.getByText('10 Schengen days', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(row.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add history', exact: true }).click();
  await editor.getByLabel('Trip name').fill('Duplicate record');
  await fillParticipant(itinerary, '2026-06-01', '2026-06-10', 'France');
  await editor.getByRole('button', { name: 'Save history', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Dates conflict with recorded trip');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await itinerary.getByRole('button', { name: 'Add country', exact: true }).click();
  await itinerary.getByLabel('Country departure', { exact: true }).first().fill('2026-06-05');
  await itinerary.getByLabel('Country arrival', { exact: true }).nth(1).fill('2026-06-05');
  await itinerary.getByLabel('Country', { exact: true }).nth(1).fill('Spain');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(row.getByText('10 Schengen days', { exact: true })).toHaveCount(2);
  await page.getByLabel('Filter by country').selectOption('ES');
  await expect(row.locator('.trip-person')).toHaveCount(2);
  await page.getByLabel('Filter by country').selectOption('');
  await row.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await editor.locator('.traveller-selection input').nth(1).uncheck();
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(row.locator('.trip-person')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('travel-history.png'), fullPage: true });
  await deleteTrip(page, title);
});

test('planner evaluates both travellers, saves, duplicates and confirms reviewed actual travel', async ({ page }) => {
  const title = `Future journey ${test.info().project.name}`;
  const profiles = page.locator('.profiles');
  await expect(profiles.locator('.profile')).toHaveCount(2);
  await expect(page.getByText('Loading your household…', { exact: true })).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    const button = profiles.locator('.profile').nth(i).getByRole('button', { name: 'Confirm history complete', exact: true });
    if (await button.count()) {
      await button.click();
      await expect(profiles.locator('.profile').nth(i).getByRole('button', { name: 'Mark history incomplete' })).toBeEnabled();
      await expect(page.getByText('Loading your household…', { exact: true })).toHaveCount(0);
    }
  }
  await page.getByRole('button', { name: 'Plan a trip', exact: true }).click();
  const editor = page.locator('.trip-editor');
  await editor.getByLabel('Trip name').fill(title);
  await fillParticipant(editor.locator('.participant-editor').first(), '2027-04-01', '2027-04-10', 'France');
  await editor.locator('.traveller-selection input').nth(1).check();
  await expect(editor.locator('.participant-editor')).toHaveCount(1);
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveValue('2027-04-01');
  await expect(editor.getByText('Permitted in selected scenario', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('future-planner.png'), fullPage: true });
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row.getByText('Provisional plan', { exact: true })).toBeVisible();
  await expect(row.getByRole('checkbox', { name: 'Include in scenario', exact: true })).not.toBeChecked();

  await row.getByRole('button', { name: `Duplicate ${title}`, exact: true }).click();
  await expect(editor.getByLabel('Trip name')).toHaveValue(`${title} (copy)`);
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${title} (copy)`, exact: true })).toBeVisible();
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: `Edit ${title} (copy)`, exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Itinerary conflicts with baseline trip');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await deleteTrip(page, `${title} (copy)`);

  await row.getByRole('button', { name: `Confirm ${title} as history`, exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Review actual travel dates' })).toBeVisible();
  await expect(editor.locator('.participant-editor')).toHaveCount(1);
  await fillParticipant(editor.locator('.participant-editor'), '2026-02-01', '2026-02-05', 'France');
  await editor.getByRole('button', { name: 'Confirm actual travel', exact: true }).click();
  await expect(row.getByText('Confirmed history', { exact: true })).toBeVisible();
  await expect(profiles.getByRole('button', { name: 'Confirm history complete', exact: true })).toHaveCount(2);
  await page.reload();
  await expect(row.getByText('Confirmed history', { exact: true })).toBeVisible();
  await deleteTrip(page, title);
});

test('calendar navigates leap year, separates travellers and creates a plan from tapped dates', async ({ page }) => {
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2028-02');
  await expect(calendar.getByRole('button', { name: 'Inspect 2028-02-29', exact: true })).toBeVisible();
  await expect(calendar.locator('.calendar-empty').first()).toHaveCSS('border-top-width', '0px');
  await calendar.getByRole('button', { name: 'Inspect 2028-02-28', exact: true }).click();
  await calendar.getByRole('button', { name: 'Inspect 2028-02-29', exact: true }).click();
  await expect(calendar.getByRole('status')).toContainText('2028-02-28 → 2028-02-29');
  await expect(calendar.getByRole('complementary', { name: 'Selected calendar day' })).toContainText('0/90 used');
  await calendar.getByRole('button', { name: 'Plan selected dates', exact: true }).click();
  const editor = page.locator('.trip-editor');
  await expect(editor.locator('.participant-editor')).toHaveCount(1);
  await expect(editor.getByLabel('Entry date', { exact: true }).first()).toHaveValue('2028-02-28');
  await expect(editor.getByLabel('Exit date', { exact: true }).first()).toHaveValue('2028-02-29');
  await editor.getByLabel('Trip name').fill('Calendar leap visit');
  await editor.getByLabel('Country', { exact: true }).first().fill('France');
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: 'Calendar leap visit', exact: true }) });
  await row.getByRole('checkbox').check();
  const day = calendar.getByRole('button', { name: 'Inspect 2028-02-29', exact: true });
  await expect(day.locator('.calendar-marker.plan')).toHaveCount(2);
  await expect(day.locator('.calendar-marker.plan')).toHaveText(['2', '2']);
  await expect(day).toHaveCSS('border-top-color', 'rgb(119, 141, 130)');
  await expect(day.locator('.calendar-marker.neutral')).toHaveCount(0);
  await day.click();
  await expect(calendar.getByRole('complementary')).toContainText('Calendar leap visit');
  await expect(calendar.getByRole('complementary')).toContainText('2/90 used');
  await row.getByRole('checkbox').uncheck();
  await expect(day.locator('.calendar-marker.plan')).toHaveCount(0);
  await expect(day).toHaveCSS('border-top-color', 'rgb(216, 221, 211)');
  await expect(day.locator('.calendar-marker.neutral')).toHaveCount(0);
  await day.click();
  await expect(calendar.getByRole('complementary')).not.toContainText('Calendar leap visit');
  await calendar.getByRole('button', { name: 'Year view', exact: true }).click();
  await expect(calendar.getByRole('heading', { name: 'December 2028', exact: true })).toBeVisible();
  await expect(calendar.getByRole('button', { name: 'Inspect 2028-12-31', exact: true })).toHaveCount(1);
  await expect(calendar.locator('.calendar-month')).toHaveCount(12);
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2024');
  await expect(calendar.getByRole('button', { name: 'Inspect 2024-02-29', exact: true })).toBeVisible();
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2028');
  const personId = await calendar.getByLabel('Calendar traveller').locator('option').nth(1).getAttribute('value');
  await calendar.getByLabel('Calendar traveller').selectOption(personId!);
  await expect(calendar.getByRole('button', { name: 'Inspect 2028-02-29', exact: true }).locator('.calendar-marker')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('calendar-year.png'), fullPage: true });
});

test('calendar scenario checkboxes show independent breaches and remember visibility after reload', async ({ page }) => {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const profiles = await (await page.request.get('/api/v1/travellers')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  function participant(id: string, start: string, end: string) {
    return { traveller_id: id, entry_date: start, exit_date: end,
      segments: [{ country_code: 'FR', start_date: start, end_date: end }] };
  }
  const history = await page.request.post('/api/v1/trips', { headers, data: {
    title: 'Calendar warning history', status: 'HISTORY', participants: [
      participant(profiles[0].id, '2026-07-30', '2026-10-28'),
      participant(profiles[1].id, '2026-09-01', '2026-10-19'),
    ],
  } });
  expect(history.ok()).toBeTruthy();
  const plan = await page.request.post('/api/v1/trips', { headers, data: {
    title: 'Calendar warning trip', status: 'PLANNED', participants: profiles.map((p: { id: string }) =>
      participant(p.id, '2026-11-08', '2027-01-29')),
  } });
  expect(plan.ok()).toBeTruthy();
  const saved = await plan.json();
  for (const p of await (await page.request.get('/api/v1/travellers')).json()) {
    const review = await page.request.patch(`/api/v1/travellers/${p.id}`, { headers, data: {
      display_name: p.display_name, notes: p.notes, version: p.version, rule_applicable: true, history_complete: true,
    } });
    expect(review.ok()).toBeTruthy();
  }
  await page.reload();
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await expect(calendar.getByText('Showing confirmed history only.', { exact: false })).toBeVisible();
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: 'Calendar warning trip', exact: true }) });
  await row.getByRole('checkbox').check();
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2026-11');
  const entry = calendar.getByRole('button', { name: 'Inspect 2026-11-08', exact: true });
  await expect(entry.locator('.calendar-marker.breach')).toHaveCount(1);
  await expect(entry.locator('.calendar-marker.plan')).toHaveCount(1);
  await expect(entry.locator('.calendar-marker.breach')).toHaveText('92');
  await expect(entry.locator('.calendar-marker.plan')).toHaveText('50');
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2026-12');
  await expect(calendar.getByRole('button', { name: 'Inspect 2026-12-18', exact: true }).locator('.calendar-marker.breach')).toHaveCount(1);
  await expect(calendar.getByRole('button', { name: 'Inspect 2026-12-19', exact: true }).locator('.calendar-marker.breach')).toHaveCount(2);
  await page.reload();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(calendar.getByLabel('Calendar month', { exact: true })).toHaveValue('2026-12');
  await expect(calendar.getByLabel('Visible calendar warnings')).toContainText('2026-12-19');
  await expect(calendar.getByRole('button', { name: 'Inspect 2026-12-19', exact: true }).locator('.calendar-marker.breach')).toHaveCount(2);
  await calendar.screenshot({ path: test.info().outputPath('calendar-breaches.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await row.getByRole('checkbox').uncheck();
  await expect(calendar.getByRole('button', { name: 'Inspect 2026-12-19', exact: true }).locator('.calendar-marker.breach')).toHaveCount(0);
  await expect(calendar.getByRole('button', { name: 'Inspect 2026-12-19', exact: true }).locator('.calendar-marker.unavailable')).toHaveCount(1);
  await calendar.getByRole('button', { name: 'Inspect 2026-12-19', exact: true }).click();
  await expect(calendar.getByRole('complementary')).not.toContainText('Calendar warning trip');
});


test('exports preview and download separate CSV/history/plans snapshots for each traveller', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Export travel', exact: true });
  await panel.getByRole('button', { name: 'Preview export', exact: true }).click();
  await expect(panel.getByText('No matching trips to export.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Download CSV', exact: true })).toHaveCount(0);
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const profiles = await (await page.request.get('/api/v1/travellers')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  function participant(id: string, start: string, end: string, code: string) {
    return { traveller_id: id, entry_date: start, exit_date: end,
      segments: [{ country_code: code, start_date: start, end_date: end }] };
  }
  const history = { title: 'Export demo, "France"', status: 'HISTORY', participants: [
    participant(profiles[0].id, '2028-05-01', '2028-05-11', 'FR'),
    participant(profiles[1].id, '2028-05-03', '2028-05-05', 'GB'),
  ] };
  history.participants[0].segments[0].end_date = '2028-05-10';
  history.participants[0].segments.push({ country_code: 'ES', start_date: '2028-05-10', end_date: '2028-05-11' });
  const created = await page.request.post('/api/v1/trips', { headers, data: history });
  expect(created.ok()).toBeTruthy();
  const saved = await created.json();
  const plan = await page.request.post('/api/v1/trips', { headers, data: {
    title: 'Provisional export demo', status: 'PLANNED', participants: [
      participant(profiles[0].id, '2028-06-01', '2028-06-05', 'FR'),
      participant(profiles[1].id, '2028-06-03', '2028-06-06', 'GB'),
    ],
  } });
  expect(plan.ok()).toBeTruthy();
  await page.reload();
  await panel.getByRole('button', { name: 'Preview export', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('3 segment rows across 1 trip.');
  const original = await (await page.request.get('/api/v1/exports/history.csv')).text();
  const renamed = await page.request.patch(`/api/v1/trips/${saved.id}`, { headers, data: {
    ...history, title: 'Renamed after preview', version: saved.version,
  } });
  expect(renamed.ok()).toBeTruthy();
  const csvDownload = page.waitForEvent('download');
  await panel.getByRole('link', { name: 'Download CSV', exact: true }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^schengen-history-both-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(await readFile((await csv.path())!, 'utf8')).toBe(original);
  expect(original).toContain('"Export demo, ""France"""');
  expect(original).not.toContain('Provisional export demo');
  await panel.getByLabel('Export format').selectOption('history.ics');
  await expect(panel.getByRole('link', { name: 'Download calendar (.ics)', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Preview export', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('3 calendar events across 1 trip.');
  await expect(panel.getByRole('heading', { name: 'Renamed after preview', exact: true })).toHaveCount(3);
  const historyDownload = page.waitForEvent('download');
  await panel.getByRole('link', { name: 'Download calendar (.ics)', exact: true }).click();
  const historical = await historyDownload;
  const historicalText = await readFile((await historical.path())!, 'utf8');
  expect(historicalText.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  expect(historicalText).toContain('DTEND;VALUE=DATE:20280512');
  expect(historicalText).toContain('STATUS:CONFIRMED');
  expect(historicalText).not.toContain('STATUS:TENTATIVE');
  await panel.getByLabel('Export format').selectOption('plans.ics');
  await panel.getByRole('button', { name: 'Preview export', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('2 calendar events across 1 trip.');
  await expect(panel.getByText('Provisional plan', { exact: true })).toHaveCount(2);
  await panel.getByLabel('Export traveller').selectOption(profiles[1].id);
  await panel.getByRole('button', { name: 'Preview export', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('1 calendar event across 1 trip.');
  const planDownload = page.waitForEvent('download');
  await panel.getByRole('link', { name: 'Download calendar (.ics)', exact: true }).click();
  const planned = await planDownload;
  expect(planned.suggestedFilename()).toMatch(/^schengen-plans-traveller-2-.*\.ics$/);
  const plannedText = await readFile((await planned.path())!, 'utf8');
  expect(plannedText.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(plannedText).toContain('LOCATION:United Kingdom');
  expect(plannedText).toContain('DTEND;VALUE=DATE:20280607');
  expect(plannedText).toContain('STATUS:TENTATIVE');
  expect(plannedText).not.toContain(profiles[0].display_name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: test.info().outputPath('export-preview.png') });
});

test('CSV import maps names, commits reviewed history and skips exported duplicates', async ({ page }) => {
  const key = '12345678-1234-5678-1234-567812345678';
  const title = `Imported history ${test.info().project.name}`;
  const csv = 'schema_version,trip_external_id,traveller_name,trip_title,country_code,segment_start,segment_end,trip_status\r\n'
    + `1,${key},Previous name,${title},FR,2026-05-01,2026-05-10,HISTORY\r\n`;
  const panel = page.getByRole('region', { name: 'Import travel history', exact: true });
  await panel.getByLabel('History CSV file').setInputFiles({ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await panel.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(panel.getByText('Map traveller: Previous name', { exact: false })).toBeVisible();
  const profiles = await (await page.request.get('/api/v1/travellers')).json();
  await panel.getByLabel('CSV traveller: Previous name').selectOption(profiles[0].id);
  await expect(panel.getByRole('button', { name: 'Commit 1 selected trip', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(panel.getByText('Ready to add as confirmed history.', { exact: false })).toBeVisible();
  expect((await (await page.request.get('/api/v1/trips?status=HISTORY')).json()).length).toBe(0);
  await panel.getByRole('button', { name: 'Commit 1 selected trip', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Imported 1 trip; skipped 0.' })).toBeVisible();
  await expect(page.locator('.trip-row').getByRole('heading', { name: title, exact: true })).toBeVisible();
  const exported = await (await page.request.get('/api/v1/exports/history.csv')).text();
  await panel.getByLabel('History CSV file').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(exported) });
  await panel.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(panel.getByText('Identical history already exists; skip it.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Commit 0 selected trips', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/import-preview-${test.info().project.name}.png`, fullPage: true });
});


test('calendar always shows history and uses scenario inclusion for planned dates', async ({ page }) => {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const profiles = await (await page.request.get('/api/v1/travellers')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  const trips = [];
  for (const [title, status, start, end] of [
    ['Earliest calendar history', 'HISTORY', '2013-04-22', '2013-04-23'],
    ['Future calendar plan', 'PLANNED', '2100-12-30', '2100-12-31'],
  ]) {
    const result = await page.request.post('/api/v1/trips', { headers, data: {
      title, status, participants: [{ traveller_id: profiles[0].id, entry_date: start, exit_date: end,
        segments: [{ country_code: 'FR', start_date: start, end_date: end }] }],
    } });
    expect(result.ok()).toBeTruthy(); trips.push(await result.json());
  }
  await page.reload();
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await expect(calendar.getByRole('combobox')).toHaveCount(1);
  await expect(calendar.getByRole('button', { name: 'Month view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2013-04');
  await expect(calendar.getByLabel('Calendar month', { exact: true })).toHaveValue('2013-04');
  const past = calendar.getByRole('button', { name: 'Inspect 2013-04-22', exact: true });
  await expect(past.locator('.calendar-marker.history')).toHaveCount(1);
  await expect(past).toHaveCSS('border-top-width', '2px');
  await expect(past).toHaveCSS('border-top-color', 'rgb(119, 141, 130)');
  await past.click();
  await expect(calendar.getByRole('complementary')).toContainText('Earliest calendar history');
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2100-12');
  await expect(calendar.getByLabel('Calendar month', { exact: true })).toHaveValue('2100-12');
  const future = calendar.getByRole('button', { name: 'Inspect 2100-12-31', exact: true });
  await expect(future.locator('.calendar-marker.plan')).toHaveCount(0);
  await expect(future).toHaveCSS('border-top-color', 'rgb(216, 221, 211)');
  await future.click();
  await expect(calendar.getByRole('complementary')).not.toContainText('Future calendar plan');
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: 'Future calendar plan', exact: true }) });
  await row.getByRole('checkbox').check();
  await expect(future.locator('.calendar-marker.plan')).toHaveCount(1);
  await expect(future).toHaveCSS('border-top-color', 'rgb(119, 141, 130)');
  await future.click();
  await expect(calendar.getByRole('complementary')).toContainText('Future calendar plan');
  await expect(calendar.getByRole('complementary')).toContainText('Included plan');
  await calendar.getByRole('button', { name: 'Year view', exact: true }).click();
  await expect(future).toHaveCSS('border-top-width', '2px');
  await expect(future).toHaveCSS('border-top-color', 'rgb(119, 141, 130)');
  await row.getByRole('checkbox').uncheck();
  await expect(future.locator('.calendar-marker.plan')).toHaveCount(0);
  await expect(future).toHaveCSS('border-top-color', 'rgb(216, 221, 211)');
  await page.reload();
  await expect(calendar.getByRole('button', { name: 'Year view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(calendar.getByRole('combobox', { name: 'Calendar year', exact: true })).toHaveValue('2100');
  await calendar.getByRole('button', { name: 'Month view', exact: true }).click();
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2013-04');
  await expect(calendar.getByRole('button', { name: 'Inspect 2013-04-21', exact: true })).toBeDisabled();
  await expect(calendar.getByRole('button', { name: 'Inspect 2013-04-21', exact: true })).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await expect(past.locator('.calendar-marker.history')).toHaveCount(1);
  await calendar.getByRole('button', { name: 'Year view', exact: true }).click();
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2014');
  await calendar.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(calendar.getByRole('combobox', { name: 'Calendar year', exact: true })).toHaveValue('2013');
  await expect(calendar.locator('.calendar-month')).toHaveCount(12);
  await expect(past).toHaveCSS('border-top-color', 'rgb(119, 141, 130)');
  await calendar.getByLabel('Calendar traveller').selectOption(profiles[1].id);
  await expect(past).toHaveCSS('border-top-color', 'rgb(216, 221, 211)');
  await calendar.getByLabel('Calendar traveller').selectOption('');
  await expect(past).toHaveCSS('border-top-color', 'rgb(119, 141, 130)');
  await expect(calendar.getByRole('button', { name: 'Inspect 2013-04-21', exact: true })).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await calendar.screenshot({ path: test.info().outputPath('all-travel-calendar.png') });
});


test('calendar keeps the March–April scenario visible when a plan is edited or cancelled', async ({ page }) => {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const [profile] = await (await page.request.get('/api/v1/travellers')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  const saved = await page.request.post('/api/v1/trips', { headers, data: {
    title: 'Spring 27', status: 'PLANNED', participants: [{ traveller_id: profile.id,
      entry_date: '2027-03-14', exit_date: '2027-04-04',
      segments: [{ country_code: 'FR', start_date: '2027-03-14', end_date: '2027-04-04' }] }],
  } });
  expect(saved.ok()).toBeTruthy();
  const review = await page.request.patch(`/api/v1/travellers/${profile.id}`, { headers, data: {
    display_name: profile.display_name, version: profile.version, notes: profile.notes,
    rule_applicable: true, history_complete: true,
  } });
  expect(review.ok()).toBeTruthy();
  await page.reload();
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: 'Spring 27', exact: true }) });
  const checkbox = row.getByRole('checkbox', { name: 'Include in scenario', exact: true });
  await checkbox.check();
  await calendar.getByRole('button', { name: 'Year view', exact: true }).click();
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2027');
  await expect(calendar.locator('.calendar-day.has-travel')).toHaveCount(22);
  await expect(calendar.getByRole('button', { name: 'Inspect 2027-03-14', exact: true })).toHaveClass(/has-travel/);
  await expect(calendar.getByRole('button', { name: 'Inspect 2027-03-14', exact: true }).locator('.calendar-marker.plan')).toHaveText('1');
  await expect(calendar.getByRole('button', { name: 'Inspect 2027-04-04', exact: true })).toHaveClass(/has-travel/);
  await expect(calendar.getByRole('button', { name: 'Inspect 2027-04-04', exact: true }).locator('.calendar-marker.plan')).toHaveText('22');
  const editor = page.locator('.trip-editor');
  await row.getByRole('button', { name: 'Edit Spring 27', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await expect(editor.getByText('22 / 90', { exact: true })).toBeVisible();
  await expect(calendar.locator('.calendar-day.has-travel')).toHaveCount(22);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await row.getByRole('button', { name: 'Edit Spring 27', exact: true }).click();
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await expect(calendar.locator('.calendar-day.has-travel')).toHaveCount(22);
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(calendar.locator('.calendar-day.has-travel')).toHaveCount(22);
  await calendar.getByRole('button', { name: 'Month view', exact: true }).click();
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2027-03');
  await expect(calendar.locator('.calendar-day.has-travel')).toHaveCount(18);
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2027-04');
  await expect(calendar.locator('.calendar-day.has-travel')).toHaveCount(4);
});


test('editing an existing different itinerary requires explicit shared-date review', async ({ page }) => {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const people = await (await page.request.get('/api/v1/travellers')).json();
  const headers = { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
  const original = { title: 'Existing different dates', status: 'HISTORY', participants: [
    { traveller_id: people[0].id, entry_date: '2026-05-01', exit_date: '2026-05-10',
      segments: [{ country_code: 'FR', start_date: '2026-05-01', end_date: '2026-05-10' }] },
    { traveller_id: people[1].id, entry_date: '2026-05-03', exit_date: '2026-05-08',
      segments: [{ country_code: 'ES', start_date: '2026-05-03', end_date: '2026-05-08' }] },
  ] };
  const response = await page.request.post('/api/v1/trips', { headers, data: original });
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  const before = await (await page.request.get(`/api/v1/trips/${saved.id}`)).json();
  await page.reload();
  const row = page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: original.title, exact: true }) });
  const editor = page.locator('.trip-editor');
  await row.getByRole('button', { name: `Edit ${original.title}`, exact: true }).click();
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveCount(1);
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  const unchanged = await (await page.request.get(`/api/v1/trips/${saved.id}`)).json();
  expect(unchanged).toEqual(before);
  await row.getByRole('button', { name: `Edit ${original.title}`, exact: true }).click();
  await editor.getByRole('combobox', { name: 'Copy existing itinerary from', exact: true }).selectOption(people[1].id);
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveValue('2026-05-03');
  await editor.getByLabel('Apply the shared dates and destinations to every selected traveller', { exact: true }).check();
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const updated = await (await page.request.get(`/api/v1/trips/${saved.id}`)).json();
  expect(updated.participants).toHaveLength(2);
  for (const person of updated.participants) {
    expect(person.entry_date).toBe('2026-05-03');
    expect(person.exit_date).toBe('2026-05-08');
    expect(person.segments.map(s => s.country_code)).toEqual(['ES']);
  }
});
