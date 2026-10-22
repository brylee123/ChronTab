import { launchExtension, futureCalendarFixture } from './helpers/browser.js';
const fixture = futureCalendarFixture();
const { context, dispose } = await launchExtension({ viewport: { width: 1440, height: 1100 } });
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host,
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('chrome-extension://' + id + '/dashboard.html');
  await page.locator('[data-view="lists"]').click();
  await page.getByRole('button', { name: 'New date list', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New date list', exact: true });
  await dialog.getByLabel('List name', { exact: true }).fill('Office hours');
  await dialog.getByLabel('List type', { exact: true }).selectOption('workday');
  await dialog.getByLabel('Country', { exact: true }).selectOption('US');
  await dialog.getByLabel('State / province', { exact: true }).selectOption('NY');
  // Match the seven-day schedule input: drag a Sunday 07:00–11:00 block.
  const column = dialog.locator('.hours-column[data-day="0"]'),
    box = await column.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 7 * 32 + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 11 * 32 - 2, { steps: 12 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Sunday 07:00 to 11:00', exact: true }).waitFor();
  await page.screenshot({
    path: 'artifacts/work-hours-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Save date list', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  console.log('Weekly work-hours grid, pointer selection, and regional save passed');
  await page.getByRole('button', { name: 'New date list', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New date list', exact: true });
  await dialog.getByLabel('List name', { exact: true }).fill('New York holidays');
  await dialog.getByLabel('Country', { exact: true }).selectOption('US');
  await dialog.getByLabel('State / province', { exact: true }).selectOption('NY');
  await dialog.getByRole('button', { name: 'Save date list', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'New date list', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New date list', exact: true });
  await dialog.getByLabel('List name', { exact: true }).fill('Time off');
  await dialog.getByLabel('List type', { exact: true }).selectOption('custom');
  await dialog.getByRole('button', { name: 'Add date', exact: true }).click();
  await dialog.getByLabel('From', { exact: true }).fill(fixture.timeOff);
  await dialog.getByLabel('Through', { exact: true }).fill(fixture.timeOff);
  await dialog.getByLabel('Label', { exact: true }).fill('Personal day');
  await dialog.getByRole('button', { name: 'Save date list', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  console.log('Regional holidays and custom-date list creation passed');
  await page.getByRole('button', { name: 'Schedule a tab', exact: true }).click();
  const editor = page.locator('#edit-dialog');
  await editor.getByLabel('Tab title', { exact: true }).fill('Office reading');
  await editor.getByLabel('Website URL', { exact: true }).fill('https://example.com/office');
  await editor.locator('#wake-at').fill(fixture.holiday + 'T09:00');
  await editor.locator('.date-rule-details summary').click();
  await editor.getByLabel('Use date rules', { exact: true }).check();
  const builder = editor.locator('#date-rule-builder');
  let include = builder.locator(':scope > .rule-group').first();
  await include
    .locator(':scope > .rule-actions')
    .getByRole('button', { name: 'Condition', exact: true })
    .click();
  await editor
    .getByRole('alert')
    .filter({ hasText: 'Date-list rules conflict with Does not repeat' })
    .waitFor();
  if (!(await editor.locator('#save-schedule').isDisabled())) {
    throw new Error('Non-repeating conflict did not block saving');
  }
  await page.screenshot({
    path: 'artifacts/date-rule-conflict.png',
    fullPage: true,
    animations: 'disabled',
  });
  await editor.locator('#repeat').click();
  await page.getByLabel('Repeat unit', { exact: true }).selectOption('day');
  await page.locator('#end-after').check();
  await page.getByLabel('Number of occurrences', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  include = builder.locator(':scope > .rule-group').first();
  await include
    .locator(':scope > .rule-actions')
    .getByRole('button', { name: 'Group', exact: true })
    .click();
  const nested = include.locator(':scope > .rule-group');
  await nested
    .locator(':scope > .rule-actions')
    .getByRole('button', { name: 'Condition', exact: true })
    .click();
  await nested
    .getByLabel('Date condition', { exact: true })
    .nth(1)
    .selectOption({ label: 'New York holidays' });
  await builder.getByRole('button', { name: 'Add exclusions', exact: true }).click();
  const excluded = builder.locator(':scope > .rule-group').nth(1);
  await excluded.getByLabel('Date condition', { exact: true }).selectOption({ label: 'Time off' });
  await page.screenshot({
    path: 'artifacts/date-rules-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await editor.getByRole('button', { name: 'Schedule tab', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const state = await page.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: 'state' })).data,
  );
  if (state.dateLists.length !== 3 || state.tabs.length !== 1) {
    throw new Error('Stored list or schedule count mismatch');
  }
  const tab = state.tabs[0],
    work = state.dateLists.find((l) => l.name === 'Office hours');
  if (!tab.conditions.include.children.some((n) => n.op === 'any')) {
    throw new Error('Nested group was not persisted');
  }
  if (new Date(tab.nextWake).getDate() !== fixture.holidayDay + 1) {
    throw new Error('Holiday was not skipped');
  }
  if (work.hours[0][0].start !== '07:00' || work.hours[0][0].end !== '11:00') {
    throw new Error('Dragged work block was not persisted');
  }
  await page.locator('[data-view="calendar"]').click();
  while ((await page.locator('#calendar-month').textContent()) !== fixture.monthLabel) {
    await page.locator('#calendar-next').click();
  }
  if ((await page.locator('.calendar-event').count()) !== 3) {
    throw new Error('Calendar did not project exactly 3 wakeups');
  }
  await page.getByRole('button', { name: 'View ' + fixture.timeOff, exact: true }).click();
  await page.getByText('Time off: Personal day', { exact: true }).waitFor();
  await page.screenshot({
    path: 'artifacts/calendar-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === 'dark' &&
      getComputedStyle(document.querySelector('.brand')).color === 'rgb(230, 225, 229)',
  );
  await page.screenshot({
    path: 'artifacts/calendar-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  console.log('Nested rules, conflict blocking, exclusions, and month calendar projection passed');
  await page.locator('[data-view="lists"]').click();
  const card = page.locator('.date-list-card').filter({ hasText: 'Office hours' });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.screenshot({
    path: 'artifacts/work-hours-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'artifacts/date-lists-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  // A v2 JSON backup must restore list references, hours, and nested groups into an empty store.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await (await downloadPromise).saveAs('artifacts/calendar-backup.json');
  await page.evaluate(() => chrome.storage.local.set({ tabs: [], dateLists: [] }));
  await page.locator('#import-file').setInputFiles('artifacts/calendar-backup.json');
  await page.getByRole('status').filter({ hasText: 'Imported 1 schedules' }).waitFor();
  const restored = await page.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: 'state' })).data,
  );
  if (
    restored.dateLists.length !== 3 ||
    restored.tabs[0].conditions.exclude.children[0].listId !==
      state.tabs[0].conditions.exclude.children[0].listId
  ) {
    throw new Error('Backup round trip changed references');
  }
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  console.log('Version 2 JSON backup restored lists, weekly hours, and nested rule references');
} catch (error) {
  await context.pages().at(-1)?.screenshot({
    path: 'artifacts/calendar-failure.png',
    fullPage: true,
    animations: 'disabled',
  });
  throw error;
} finally {
  await dispose();
}
