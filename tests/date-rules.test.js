import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDateList, listMatches, listDetails } from '../date-lists.js';
import { normalizeHours, insideHours, defaultHours } from '../work-hours.js';
import { nextWake, previewOccurrences, dateAllowed } from '../date-engine.js';
import { normalizeRecord } from '../schedule.js';
import { normalizeBackup } from '../backup.js';
import { normalizeConditions } from '../rule-schema.js';
const local = (day, h = 9) =>
  new Date(day + 'T' + String(h).padStart(2, '0') + ':00:00').toISOString();
const work = () =>
  normalizeDateList({
    id: 'work',
    name: 'Office hours',
    type: 'workday',
    country: 'US',
    state: 'NY',
    hours: defaultHours(),
    dates: [],
  });
const holidays = () =>
  normalizeDateList({
    id: 'holiday',
    name: 'NY holidays',
    type: 'holiday',
    country: 'US',
    state: 'NY',
    dates: [],
  });
const custom = () =>
  normalizeDateList({
    id: 'vacation',
    name: 'Vacation',
    type: 'custom',
    dates: [{ start: '2027-01-21', end: '2027-01-21', label: 'Time off' }],
  });
const record = (extra = {}) => ({
  id: 'reading',
  url: 'https://example.com/',
  title: 'Reading',
  anchor: local('2027-01-18'),
  nextWake: local('2027-01-18'),
  rule: { unit: 'day', interval: 1, end: 'after', count: 3 },
  completed: 0,
  ...extra,
});
const schedule = { source: 'schedule' },
  ref = (id) => ({ listId: id }),
  all = (...children) => ({ op: 'all', children }),
  any = (...children) => ({ op: 'any', children });
test('regional holidays include New York dates and observed substitute days', () => {
  const list = holidays();
  assert.equal(listMatches(list, '2027-01-18'), true);
  assert.match(listDetails(list, '2027-01-18').names.join(' '), /Martin Luther King/);
  assert.equal(listMatches(list, '2027-12-24'), true);
  assert.equal(listMatches(normalizeDateList({ ...list, observed: false }), '2027-12-24'), false);
  assert.equal(listMatches(list, '2027-12-31'), true); // observed 2028 New Year crosses the year
  assert.throws(() => normalizeDateList({ ...list, state: 'not-a-state' }));
});
test('workdays respect weekdays, hours, holidays, and end-exclusive boundaries', () => {
  const list = work();
  assert.equal(listMatches(list, '2027-01-19', '09:00'), true);
  assert.equal(listMatches(list, '2027-01-19', '16:59'), true);
  assert.equal(listMatches(list, '2027-01-19', '17:00'), false);
  assert.equal(listMatches(list, '2027-01-19', '08:59'), false);
  assert.equal(listMatches(list, '2027-01-18', '09:00'), false);
  assert.equal(listMatches(list, '2027-01-23', '09:00'), false);
});
test('weekly blocks support split shifts, touching intervals, and overnight boundaries', () => {
  const h = defaultHours();
  h[1] = [
    { start: '09:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
  ];
  h[5] = [{ start: '22:00', end: '24:00' }];
  h[6] = [{ start: '00:00', end: '05:00' }];
  const normalized = normalizeHours(h);
  assert.equal(insideHours(normalized, 1, '12:30'), false);
  assert.equal(insideHours(normalized, 5, '23:59'), true);
  assert.equal(insideHours(normalized, 6, '00:00'), true);
  assert.throws(() => normalizeHours({ ...h, 1: [{ start: '17:00', end: '09:00' }] }));
  assert.throws(() =>
    normalizeHours({
      ...h,
      1: [
        { start: '09:00', end: '13:00' },
        { start: '12:00', end: '17:00' },
      ],
    }),
  );
});
test('date overrides respect exclusions and work-hour boundaries', () => {
  const list = normalizeDateList({
    ...work(),
    dates: [
      { start: '2027-01-18', end: '2027-01-18', action: 'include' },
      { start: '2027-01-19', end: '2027-01-19', action: 'exclude' },
    ],
  });
  assert.equal(listMatches(list, '2027-01-18', '10:00'), true);
  assert.equal(listMatches(list, '2027-01-18', '20:00'), false);
  assert.equal(listMatches(list, '2027-01-19', '10:00'), false);
});
test('custom date ranges, annual dates, and annual leap days are validated', () => {
  const list = normalizeDateList({
    id: 'custom',
    type: 'custom',
    name: 'Dates',
    dates: [
      { start: '2027-02-01', end: '2027-02-03', annual: true },
      { start: '2027-02-02', end: '2027-02-02', annual: true, action: 'exclude' },
    ],
  });
  assert.equal(listMatches(list, '2028-02-01'), true);
  assert.equal(listMatches(list, '2028-02-02'), false);
  assert.throws(() => normalizeDateList({ ...list, dates: [{ start: '2027-02-30' }] }));
  assert.throws(() =>
    normalizeDateList({
      ...list,
      dates: [{ start: '2027-12-30', end: '2028-01-02', annual: true }],
    }),
  );
  const leap = normalizeDateList({
    id: 'leap',
    name: 'Leap',
    type: 'custom',
    dates: [{ start: '2028-02-29', end: '2028-02-29', annual: true }],
  });
  const tab = record({
    anchor: local('2029-01-01'),
    conditions: { include: ref('leap'), exclude: null },
  });
  assert.equal(nextWake(tab, [leap], Date.parse(tab.anchor) - 1), local('2032-02-29'));
});
test('nested All/Any combinations and exclusions skip without consuming count', () => {
  const tab = record({
    conditions: {
      include: all(any(schedule, ref('holiday')), ref('work')),
      exclude: ref('vacation'),
    },
  });
  const lists = [work(), holidays(), custom()];
  const first = nextWake(tab, lists, Date.parse(tab.anchor) - 1);
  assert.equal(first, local('2027-01-19'));
  const second = nextWake(tab, lists, first, 1);
  assert.equal(second, local('2027-01-20'));
  const third = nextWake(tab, lists, second, 2);
  assert.equal(third, local('2027-01-22'));
  assert.equal(nextWake(tab, lists, third, 3), null);
});
test('Any lists add dates beyond the assigned weekly schedule', () => {
  const tab = record({
    anchor: local('2027-01-15'),
    rule: { unit: 'week', interval: 1, days: [5], end: 'never' },
    conditions: { include: any(schedule, ref('holiday')), exclude: null },
  });
  assert.equal(nextWake(tab, [holidays()], tab.anchor), local('2027-01-18'));
});
test('Does not repeat rejects date-list conditions in both records and backups', () => {
  const tab = record({ rule: null, conditions: { include: ref('work'), exclude: null } });
  assert.throws(() => normalizeRecord(tab), /conflict with Does not repeat/);
  assert.throws(
    () => normalizeBackup({ format: 'chrontab', version: 2, tabs: [tab], dateLists: [work()] }),
    /conflict/,
  );
});
test('version 2 round trips lists and conditions; version 1 remains accepted', () => {
  const tab = record({ conditions: { include: all(schedule, ref('work')), exclude: null } });
  const backup = normalizeBackup({
    format: 'chrontab',
    version: 2,
    tabs: [tab],
    dateLists: [work()],
  });
  assert.equal(backup.tabs[0].conditions.include.children[1].listId, 'work');
  assert.deepEqual(backup.lists[0].hours[1], [{ start: '09:00', end: '17:00' }]);
  assert.equal(
    normalizeBackup({ format: 'chrontab', version: 1, tabs: [record()] }).lists.length,
    0,
  );
  assert.throws(
    () => normalizeBackup({ format: 'chrontab', version: 2, tabs: [tab], dateLists: [] }),
    /missing list/,
  );
});
test('calendar preview does not extend counted schedules by skipping earlier dates', () => {
  const tab = record({
    anchor: local('2027-01-30'),
    nextWake: local('2027-01-30'),
    rule: { unit: 'day', interval: 1, end: 'after', count: 3 },
  });
  assert.deepEqual(previewOccurrences(tab, [], local('2027-02-01', 0), local('2027-02-28', 23)), [
    local('2027-02-01'),
  ]);
  const conditional = record({
    conditions: { include: all(schedule, ref('work')), exclude: ref('vacation') },
  });
  assert.deepEqual(
    previewOccurrences(
      conditional,
      [work(), custom()],
      local('2027-01-01', 0),
      local('2027-01-31', 23),
    ),
    [local('2027-01-19'), local('2027-01-20'), local('2027-01-22')],
  );
});
test('late wakeups are disallowed on excluded days or outside work hours', () => {
  const tab = record({
    conditions: { include: all(schedule, ref('work')), exclude: ref('vacation') },
  });
  assert.equal(dateAllowed(tab, '2027-01-19', [work(), custom()], 10 * 60), true);
  assert.equal(dateAllowed(tab, '2027-01-19', [work(), custom()], 18 * 60), false);
  assert.equal(dateAllowed(tab, '2027-01-21', [work(), custom()], 10 * 60), false);
});
test('empty and over-nested groups are rejected', () => {
  assert.throws(() => normalizeConditions({ include: { op: 'all', children: [] } }));
  let node = ref('work');
  for (let i = 0; i < 8; i++) {
    node = all(node);
  }
  assert.throws(() => normalizeConditions({ include: node }), /group levels/);
});

test('Any groups do not exhaust the search budget before checking an assigned date', () => {
  const first = work();
  const second = { ...work(), id: 'other-hours', name: 'Other hours' };
  const anchor = local('2027-01-18', 20);
  const tab = record({
    anchor,
    nextWake: anchor,
    conditions: { include: any(ref(first.id), ref(second.id), schedule), exclude: null },
  });
  assert.equal(nextWake(tab, [first, second], Date.parse(anchor) - 1), anchor);
});
