import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextOccurrence,
  validateRule,
  normalizeRecord,
  parseBackup,
  safeUrl,
} from '../schedule.js';
const rule = (unit, extra = {}) => ({ unit, interval: 1, end: 'never', ...extra });
const local = (year, month, day, hour = 9) => new Date(year, month - 1, day, hour).toISOString();
test('one-time scheduling returns only a future occurrence', () => {
  const date = local(2027, 1, 19);
  assert.equal(nextOccurrence(date, null, Date.parse(date) - 1), date);
  assert.equal(nextOccurrence(date, null, date), null);
});
test('daily recurrence keeps local time over DST transitions', () => {
  for (const [month, day] of [
    [3, 13],
    [11, 6],
  ]) {
    const anchor = local(2027, month, day);
    const next = nextOccurrence(anchor, rule('day'), anchor);
    assert.equal(next, local(2027, month, day + 1));
    assert.equal(new Date(next).getHours(), 9);
    assert.equal(Date.parse(next) - Date.parse(anchor), (month === 3 ? 23 : 25) * 60 * 60 * 1000);
  }
});
test('weekly recurrence supports multiple weekdays and interval weeks', () => {
  const anchor = local(2027, 1, 18); // Monday
  const r = rule('week', { interval: 2, days: [1, 3, 5] });
  assert.equal(nextOccurrence(anchor, r, anchor), local(2027, 1, 20));
  assert.equal(nextOccurrence(anchor, r, local(2027, 1, 22)), local(2027, 2, 1));
  assert.equal(
    nextOccurrence(anchor, rule('week', { days: [2] }), Date.parse(anchor) - 1),
    local(2027, 1, 19),
  );
});
test('month-end dates and fifth weekdays skip missing months', () => {
  const anchor = local(2027, 1, 31);
  assert.equal(
    nextOccurrence(anchor, rule('month', { monthly: 'date' }), anchor),
    local(2027, 3, 31),
  );
  const monday = local(2027, 3, 29);
  assert.equal(
    nextOccurrence(monday, rule('month', { monthly: 'weekday' }), monday),
    local(2027, 5, 31),
  );
});
test('yearly leap day and interval months stay calendar aligned', () => {
  const anchor = local(2028, 2, 29);
  assert.equal(nextOccurrence(anchor, rule('year'), anchor), local(2032, 2, 29));
  const monthly = local(2027, 1, 31);
  assert.equal(
    nextOccurrence(monthly, rule('month', { interval: 3, monthly: 'date' }), monthly),
    local(2027, 7, 31),
  );
});
test('ending dates are inclusive and occurrence counts count actual wakeups', () => {
  const anchor = local(2027, 1, 19);
  const r = rule('day', { end: 'on', until: '2027-01-20' });
  assert.equal(nextOccurrence(anchor, r, anchor), local(2027, 1, 20));
  assert.equal(nextOccurrence(anchor, r, local(2027, 1, 20)), null);
  assert.equal(nextOccurrence(anchor, rule('day', { end: 'after', count: 1 }), anchor, 1), null);
  assert.equal(
    nextOccurrence(anchor, rule('day', { end: 'after', count: 2 }), local(2030, 1, 1), 1),
    local(2030, 1, 2),
  );
});
test('long overdue recurrences find the next future calendar occurrence', () => {
  assert.equal(
    nextOccurrence(local(2000, 1, 1), rule('day', { interval: 3 }), local(2099, 12, 31)),
    local(2100, 1, 1),
  );
});
const record = () => ({
  id: 'test-1',
  title: 'Example',
  url: 'https://example.com',
  anchor: local(2027, 1, 19),
  nextWake: local(2027, 1, 19),
  rule: null,
  completed: 0,
});
test('backups validate every item atomically and reject duplicate IDs', () => {
  const good = record();
  assert.equal(
    parseBackup({ format: 'chrontab', version: 1, tabs: [good] })[0].url,
    'https://example.com/',
  );
  assert.throws(() => parseBackup({ format: 'other', version: 1, tabs: [] }));
  assert.throws(() => parseBackup({ format: 'chrontab', version: 1, tabs: [good, good] }));
  assert.throws(() =>
    parseBackup({
      format: 'chrontab',
      version: 1,
      tabs: [good, { ...good, id: 'other', url: 'javascript:alert(1)' }],
    }),
  );
  assert.throws(() => normalizeRecord({ ...good, nextWake: 'not a date' }));
  assert.throws(() =>
    normalizeRecord({ ...good, rule: rule('day', { end: 'after', count: 1 }), completed: 1 }),
  );
});
test('unsafe URLs and malformed recurrence rules are rejected', () => {
  for (const url of [
    'javascript:alert(1)',
    'chrome://settings',
    'file:///secret',
    'data:text/html,hello',
  ]) {
    assert.throws(() => safeUrl(url));
  }
  assert.throws(() => validateRule(rule('week', { days: [] })));
  assert.throws(() => validateRule(rule('day', { interval: 0 })));
  assert.throws(() => validateRule(rule('day', { interval: 1.5 })));
  assert.throws(() => validateRule(rule('day', { end: 'on', until: '2027-02-30' })));
  assert.throws(() => validateRule(rule('month', { monthly: 'unknown' })));
});
