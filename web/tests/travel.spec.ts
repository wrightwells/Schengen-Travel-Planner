import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, screen: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: screen, exact: true }).click();
}
async function planner(page: Page, view = 'Trips') {
  await navigate(page, 'Planner');
  await page.getByRole('group', { name: 'Planner view', exact: true }).getByRole('button', { name: view, exact: true }).click();
}
async function auth(page: Page) {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  return { 'X-Requested-With': 'SchengenPlanner', 'X-CSRF-Token': session.csrf_token };
}
async function people(page: Page) { return (await page.request.get('/api/v1/travellers')).json(); }
async function review(page: Page) {
  const headers = await auth(page);
  for (const p of await people(page)) expect((await page.request.patch(`/api/v1/travellers/${p.id}`, { headers, data: {
    display_name: p.display_name, notes: p.notes, version: p.version, rule_applicable: true, history_complete: true,
  } })).ok()).toBeTruthy();
}
async function seed(page: Page, title: string, start: string, end: string, status = 'PLANNED', shared = true, code = 'FR') {
  const profiles = await people(page);
  const result = await page.request.post('/api/v1/trips', { headers: await auth(page), data: { title, status,
    participants: (shared ? profiles : profiles.slice(0,1)).map((p: {id:string}) => ({ traveller_id: p.id, entry_date: start, exit_date: end,
      segments: [{ country_code: code, start_date: start, end_date: end }] })),
  } });
  expect(result.ok()).toBeTruthy(); return result.json();
}
async function include(page: Page, title: string, checked = true) {
  const options = page.locator('.scenario-options');
  await options.evaluate(el => (el as HTMLDetailsElement).open = true);
  await options.getByRole('checkbox', { name: title, exact: true }).setChecked(checked);
}
async function fillParticipant(group: Locator, start: string, end: string, country: string) {
  await group.getByLabel('Entry date', { exact: true }).fill(start);
  await group.getByLabel('Exit date', { exact: true }).fill(end);
  await group.getByLabel('Country', { exact: true }).first().fill(country);
}
async function row(page: Page, title: string) { return page.locator('.trip-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) }); }

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Username').fill('test-household');
  await page.getByLabel('Password', { exact: true }).fill('test-only-household-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next chapter, in reach.' })).toBeVisible();
  for (const trip of await (await page.request.get('/api/v1/trips')).json()) {
    expect((await page.request.delete(`/api/v1/trips/${trip.id}?version=${trip.version}`, { headers: await auth(page) })).ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('group', { name: 'Selected traveller', exact: true }).getByRole('button', { name: 'Both', exact: true }).click();
});

test('dark Home uses live independent allowance rings and persists traveller selection across screens', async ({ page }) => {
  await seed(page, 'Confirmed France', '2026-10-01', '2026-10-10', 'HISTORY', false);
  await seed(page, 'Next adventure', '2027-02-26', '2027-04-11');
  await review(page); await page.reload();
  const profiles = await people(page);
  const cards = page.locator('.allowance-card:visible');
  await expect(cards).toHaveCount(2);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const summary = await (await page.request.get(`/api/v1/eligibility/summary?reference_date=${today}`)).json();
  for (let i = 0; i < 2; i++) {
    await expect(cards.nth(i).getByRole('img')).toHaveAccessibleName(new RegExp(`${summary.travellers[i].used_days} Schengen days used out of 90`));
    await expect(cards.nth(i)).toContainText('Confirmed history only');
  }
  const selector = page.getByRole('group', { name: 'Selected traveller', exact: true });
  await selector.getByRole('button', { name: profiles[1].display_name, exact: true }).click();
  await expect(cards).toHaveCount(test.info().project.name === 'desktop' ? 2 : 1);
  await expect(page.locator('.allowance-group.is-selected')).toContainText(profiles[1].display_name);
  await navigate(page, 'History');
  await expect(page.getByLabel('Filter by traveller')).toHaveValue(profiles[1].id);
  await navigate(page, 'Home');
  await page.reload();
  await expect(selector.getByRole('button', { name: profiles[1].display_name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(16, 17, 22)');
  await page.screenshot({ path: test.info().outputPath('dark-home.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next adventure', exact: false }).click();
  await expect(page.getByRole('dialog')).toContainText('45 Schengen days');
  await page.getByRole('button', { name: 'Close details' }).click();
});

test('shared history is compact, previews authoritative counts and keeps date edits and filters', async ({ page }) => {
  await navigate(page, 'History');
  await page.getByRole('button', { name: 'Add history', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Trip editor' });
  await editor.getByLabel('Trip name').fill('Shared history');
  await fillParticipant(editor, '2026-06-01', '2026-06-10', 'France');
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveCount(1);
  await expect(editor.getByLabel('History day count')).toContainText('10 Schengen days');
  for (const box of await editor.locator('.traveller-selection input').all()) await box.uncheck();
  await editor.getByRole('button', { name: 'Save history', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Select at least one traveller');
  for (const box of await editor.locator('.traveller-selection input').all()) await box.check();
  await editor.getByRole('button', { name: 'Save history', exact: true }).click();
  const trip = await row(page, 'Shared history');
  await expect(trip.getByText('10 Schengen days', { exact: true })).toHaveCount(1);
  await expect(trip.locator('.avatar-chips>span')).toHaveCount(2);
  await trip.getByRole('button', { name: 'Shared history', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Confirmed history');
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await editor.getByRole('button', { name: 'Add country', exact: true }).click();
  await editor.getByLabel('Country departure', { exact: true }).first().fill('2026-06-05');
  await editor.getByLabel('Country arrival', { exact: true }).nth(1).fill('2026-06-05');
  await editor.getByLabel('Country', { exact: true }).nth(1).fill('Spain');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(trip.getByText('10 Schengen days', { exact: true })).toHaveCount(1);
  await page.getByLabel('Filter by country').selectOption('ES'); await expect(trip).toBeVisible();
  await page.getByLabel('Filter by country').selectOption('GB'); await expect(trip).toHaveCount(0);
  await page.getByLabel('Filter by country').selectOption('');
  let confirmed = false;
  page.removeAllListeners('dialog'); page.once('dialog', async d => { confirmed = true; await d.dismiss(); });
  await trip.getByRole('button', { name: 'Delete Shared history', exact: true }).click();
  expect(confirmed).toBe(true); await expect(trip).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dark-history.png'), fullPage: true });
});

test('planner evaluates both travellers, saves excluded plans, duplicates and explicitly confirms history', async ({ page }) => {
  await review(page); await page.reload(); await planner(page);
  await page.getByRole('button', { name: test.info().project.name === 'mobile-320' ? 'Plan trip' : 'Plan a trip', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Trip editor' });
  await editor.getByLabel('Trip name').fill('Future journey');
  await fillParticipant(editor, '2027-04-01', '2027-04-10', 'France');
  await expect(editor.getByText('Permitted in selected scenario', { exact: true })).toHaveCount(2);
  await expect(editor.getByText('10 calendar days · Entry and exit included')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('dark-editor.png'), fullPage: true });
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  const trip = await row(page, 'Future journey');
  await expect(trip.getByRole('checkbox')).not.toBeChecked();
  await trip.getByRole('button', { name: 'Duplicate Future journey', exact: true }).click();
  await expect(editor.getByLabel('Trip name')).toHaveValue('Future journey (copy)');
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await trip.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Edit Future journey (copy)', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Itinerary conflicts with baseline trip');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Future journey (copy)', exact: true }).click();
  await trip.getByRole('button', { name: 'Confirm Future journey as history', exact: true }).click();
  await fillParticipant(editor, '2026-02-01', '2026-02-05', 'France');
  await editor.getByRole('button', { name: 'Confirm actual travel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await navigate(page, 'History');
  await expect((await row(page, 'Future journey')).getByText('Confirmed history', { exact: true })).toBeVisible();
  await navigate(page, 'More');
  await expect(page.getByRole('button', { name: 'Confirm history complete', exact: true })).toHaveCount(2);
});

test('calendar day sheets support leap-day range selection, year views and scenario persistence', async ({ page }) => {
  await review(page); await page.reload(); await planner(page, 'Calendar');
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2028-02');
  await calendar.getByRole('button', { name: 'Inspect 2028-02-28', exact: true }).click();
  await page.getByRole('button', { name: 'Choose end date', exact: true }).click();
  await calendar.getByRole('button', { name: 'Inspect 2028-02-29', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('2028-02-28 → 2028-02-29');
  await page.getByRole('button', { name: 'Plan selected dates', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Trip editor' });
  await expect(editor.getByLabel('Entry date', { exact: true })).toHaveValue('2028-02-28');
  await expect(editor.getByLabel('Exit date', { exact: true })).toHaveValue('2028-02-29');
  await editor.getByLabel('Trip name').fill('Leap visit'); await editor.getByLabel('Country', { exact: true }).fill('France');
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await include(page, 'Leap visit');
  const day = calendar.getByRole('button', { name: 'Inspect 2028-02-29', exact: true });
  await expect(day.locator('.calendar-marker.plan')).toHaveText(['2','2']);
  await day.click(); await expect(page.getByRole('dialog')).toContainText('Leap visit');
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await calendar.getByRole('button', { name: 'Year view', exact: true }).click();
  await expect(calendar.locator('.calendar-month')).toHaveCount(12);
  await navigate(page, 'Home'); await planner(page, 'Calendar');
  await expect(calendar.getByRole('combobox', { name: 'Calendar year', exact: true })).toHaveValue('2028');
  await calendar.getByRole('button', { name: 'Month view', exact: true }).click();
  await expect(calendar.getByLabel('Calendar month', { exact: true })).toHaveValue('2028-02');
  await expect(day.locator('.calendar-marker.plan')).toHaveCount(2);
  await page.reload(); await expect(day.locator('.calendar-marker.plan')).toHaveCount(2);
  await include(page, 'Leap visit', false); await expect(day.locator('.calendar-marker.plan')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dark-calendar.png'), fullPage: true });
});

test('calendar separates unused rolling allowance from capacity protected for later plans', async ({ page }) => {
  await seed(page, 'Spring capacity', '2027-02-26', '2027-04-11');
  await seed(page, 'Summer capacity', '2027-06-11', '2027-07-25');
  await review(page); await page.reload(); await planner(page, 'Calendar');
  await include(page, 'Spring capacity'); await include(page, 'Summer capacity');
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await calendar.getByLabel('Calendar month', { exact: true }).fill('2027-05');
  await calendar.getByRole('button', { name: 'Inspect 2027-05-15', exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details.getByText(/45 days unused in this 180-day window/)).toHaveCount(2);
  await expect(details.getByText('Extra consecutive Schengen days you can add from this date: 0.', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('dark-day-details.png'), fullPage: true });
});

test('timeline previews shared date changes for review, supports keyboard editing and rejects stale saves', async ({ page }) => {
  const original = await seed(page, 'Shared timeline', '2028-03-10', '2028-03-20');
  await review(page); await page.reload(); await planner(page, 'Timeline'); await include(page, 'Shared timeline');
  const calendar = page.getByRole('region', { name: 'Travel calendar', exact: true });
  await calendar.getByRole('combobox', { name: 'Calendar year', exact: true }).selectOption('2028');
  const timeline = calendar.getByRole('region', { name: 'Year travel timeline' });
  await expect(timeline.locator('.gantt-trip')).toHaveCount(2);
  const profile = (await people(page))[0];
  const handle = timeline.getByRole('button', { name: `${profile.display_name}: Change end of Shared timeline`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  await handle.evaluate(el => { const scroller = el.closest('.gantt-scroll')!; const b = scroller.getBoundingClientRect(); scroller.scrollLeft += el.getBoundingClientRect().x - (b.left + 112 + (b.width - 112)/2); });
  const box = (await handle.boundingBox())!;
  if (test.info().project.name === 'mobile-320') {
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + 12, y = box.y + 24;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x:x+24,y}] });
    await expect(timeline.locator('.gantt-preview')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await cdp.detach();
  } else {
    await page.mouse.move(box.x+12,box.y+24); await page.mouse.down(); await page.mouse.move(box.x+36,box.y+24);
    await expect(timeline.locator('.gantt-preview')).toBeVisible(); await page.keyboard.press('Escape'); await page.mouse.up();
  }
  expect((await (await page.request.get(`/api/v1/trips/${original.id}`)).json()).version).toBe(original.version);
  await handle.focus(); await handle.press('ArrowRight');
  const editor = page.getByRole('dialog', { name: 'Trip editor' });
  await expect(editor).toContainText('Timeline change affects');
  await expect(editor.getByLabel('Exit date', { exact: true })).toHaveValue('2028-03-21');
  expect((await (await page.request.get(`/api/v1/trips/${original.id}`)).json()).version).toBe(original.version);
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(editor).toHaveCount(0);
  let saved = await (await page.request.get(`/api/v1/trips/${original.id}`)).json();
  expect(saved.participants.every((p: {exit_date:string}) => p.exit_date === '2028-03-21')).toBe(true);
  await handle.focus(); await handle.press('ArrowRight'); await expect(editor).toBeVisible();
  const concurrent = await page.request.patch(`/api/v1/trips/${saved.id}`, { headers: await auth(page), data: {
    title: saved.title, status: saved.status, version: saved.version,
    participants: saved.participants.map((p: { traveller_id:string; entry_date:string; exit_date:string; segments:{country_code:string;start_date:string;end_date:string}[] }) => ({
      traveller_id: p.traveller_id, entry_date:p.entry_date, exit_date:p.exit_date,
      segments:p.segments.map(segment => ({ country_code:segment.country_code,start_date:segment.start_date,end_date:segment.end_date })),
    })),
  } });
  expect(concurrent.ok()).toBeTruthy();
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('changed');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  saved = await (await page.request.get(`/api/v1/trips/${original.id}`)).json();
  expect(saved.participants[0].exit_date).toBe('2028-03-21');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dark-timeline.png'), fullPage: true });
});

test('history with different itineraries requires an explicit shared-date review', async ({ page }) => {
  const profiles = await people(page);
  const response = await page.request.post('/api/v1/trips', { headers: await auth(page), data: { title: 'Different dates', status: 'HISTORY', participants: profiles.map((p: {id:string},i:number) => ({ traveller_id:p.id, entry_date:`2026-05-0${i+1}`, exit_date:'2026-05-10', segments:[{country_code:i ? 'ES':'FR',start_date:`2026-05-0${i+1}`,end_date:'2026-05-10'}] })) } });
  expect(response.ok()).toBeTruthy(); await page.reload(); await navigate(page, 'History');
  const trip = await row(page, 'Different dates'); await expect(trip.locator('.trip-person')).toHaveCount(2);
  await trip.getByRole('button', { name:'Edit Different dates',exact:true }).click();
  const editor = page.getByRole('dialog', { name:'Trip editor' });
  await expect(editor.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await editor.getByLabel('Copy existing itinerary from').selectOption(profiles[1].id);
  await editor.getByLabel('Apply the shared dates and destinations to every selected traveller').check();
  await editor.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(trip.locator('.trip-person')).toHaveCount(1);
  await expect(trip).toContainText('Spain');
});

test('failed calculations remain unavailable and keyboard users can open and dismiss sheets', async ({ page }) => {
  await page.route('**/api/v1/eligibility/summary?*', route => route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({detail:'Calculation offline'}) }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Calculation unavailable');
  await expect(page.locator('.allowance-card')).toHaveCount(0);
  await page.unroute('**/api/v1/eligibility/summary?*');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.allowance-card')).toHaveCount(2);
  await planner(page,'Calendar');
  const calendar = page.getByRole('region',{name:'Travel calendar',exact:true});
  await calendar.getByLabel('Calendar month',{exact:true}).fill('2027-03');
  const day = calendar.getByRole('button',{name:'Inspect 2027-03-28',exact:true});
  await day.focus(); await day.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(day).toBeFocused();
});
test('exports preview and download separate CSV/history/plans snapshots for each traveller', async ({ page }) => {
  await navigate(page, 'More');
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
  await navigate(page, 'More');
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
  expect((await (await page.request.get('/api/v1/trips?status=HISTORY')).json()).some((t: {title:string}) => t.title === title)).toBe(true);
  const exported = await (await page.request.get('/api/v1/exports/history.csv')).text();
  await panel.getByLabel('History CSV file').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(exported) });
  await panel.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(panel.getByText('Identical history already exists; skip it.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Commit 0 selected trips', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/import-preview-${test.info().project.name}.png`, fullPage: true });
});
