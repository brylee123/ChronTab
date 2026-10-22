import { MAX_DATE_LISTS, MAX_DATE_ENTRIES, MIN_LIST_YEAR, MAX_LIST_YEAR } from './limits.js';
import { normalizeHours, insideHours } from './work-hours.js';
import Holidays from 'date-holidays';

const catalog = new Holidays();
export const countries = () => catalog.getCountries('en');
export const states = (country) => (country ? catalog.getStates(country, 'en') || {} : {});
export const regions = (country, state) =>
  country && state ? catalog.getRegions(country, state, 'en') || {} : {};
export function dateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(value + 'T12:00:00');
  return (
    Number.isFinite(d.getTime()) &&
    d.getFullYear() >= MIN_LIST_YEAR &&
    d.getFullYear() <= MAX_LIST_YEAR &&
    dateKey(d) === value
  );
}
export const validId = (value) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
export function normalizeDateList(raw) {
  if (!raw || !validId(raw.id) || !['holiday', 'workday', 'custom'].includes(raw.type)) {
    throw new Error('Invalid date list.');
  }
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
  if (!name) {
    throw new Error('Give the date list a name.');
  }
  const list = { id: raw.id, name, type: raw.type };
  if (raw.type !== 'custom') {
    const country = raw.country || '',
      state = raw.state || '',
      region = raw.region || '';
    if ((raw.type === 'holiday' && !country) || (country && !Object.hasOwn(countries(), country))) {
      throw new Error('Select a supported country.');
    }
    if (state && !Object.hasOwn(states(country), state)) {
      throw new Error('Select a supported state or province.');
    }
    if (region && !Object.hasOwn(regions(country, state), region)) {
      throw new Error('Select a supported subdivision.');
    }
    const categories = raw.categories || ['public'];
    if (
      !Array.isArray(categories) ||
      !categories.length ||
      categories.length > 5 ||
      categories.some((c) => !['public', 'bank', 'school', 'optional', 'observance'].includes(c))
    ) {
      throw new Error('Select at least one holiday category.');
    }
    Object.assign(list, {
      country,
      state,
      region,
      categories: [...new Set(categories)],
      observed: raw.observed !== false,
    });
  }
  if (raw.type === 'workday') {
    list.hours = normalizeHours(
      raw.hours ||
        Object.fromEntries(
          Array.from({ length: 7 }, (_, day) => [
            day,
            (raw.weekdays || []).includes(day) ? [{ start: '00:00', end: '24:00' }] : [],
          ]),
        ),
    );
    list.weekdays = Object.keys(list.hours)
      .map(Number)
      .filter((day) => list.hours[day].length);
  }
  const dates = raw.dates || [];
  if (!Array.isArray(dates) || dates.length > MAX_DATE_ENTRIES) {
    throw new Error('Use up to 2,000 date entries per list.');
  }
  list.dates = dates.map((entry) => {
    if (
      !entry ||
      !validDate(entry.start) ||
      !validDate(entry.end || entry.start) ||
      (entry.end || entry.start) < entry.start
    ) {
      throw new Error('Enter valid dates or ranges from 2000 through 2199.');
    }
    if (entry.annual && entry.start.slice(5) > (entry.end || entry.start).slice(5)) {
      throw new Error('Split a year-crossing annual range into two entries.');
    }
    if (!['include', 'exclude'].includes(entry.action || 'include')) {
      throw new Error('Invalid date override.');
    }
    return {
      start: entry.start,
      end: entry.end || entry.start,
      label: String(entry.label || '').slice(0, 150),
      annual: entry.annual === true,
      action: entry.action || 'include',
    };
  });
  if (raw.type === 'custom' && !list.dates.some((d) => d.action === 'include')) {
    throw new Error('Add at least one included date to the custom list.');
  }
  return list;
}
export function normalizeDateLists(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_DATE_LISTS) {
    throw new Error('Use up to 100 date lists.');
  }
  const lists = raw.map(normalizeDateList);
  if (new Set(lists.map((l) => l.id)).size !== lists.length) {
    throw new Error('Duplicate date-list IDs.');
  }
  return lists;
}
function inEntry(entry, key) {
  const value = entry.annual ? key.slice(5) : key;
  return (
    value >= (entry.annual ? entry.start.slice(5) : entry.start) &&
    value <= (entry.annual ? entry.end.slice(5) : entry.end)
  );
}
const engines = new Map(),
  years = new Map();
function holidayRows(list, year) {
  if (!list.country) {
    return [];
  }
  const key = JSON.stringify([
    list.country,
    list.state,
    list.region,
    list.categories,
    list.observed,
  ]);
  if (!engines.has(key)) {
    if (engines.size > 100) {
      engines.clear();
    }
    engines.set(
      key,
      new Holidays(list.country, list.state || undefined, list.region || undefined, {
        types: list.categories,
        languages: ['en'],
      }),
    );
  }
  const yearKey = key + year;
  if (!years.has(yearKey)) {
    if (years.size > 500) {
      years.clear();
    }
    // Include adjacent years because observed holidays can cross the year boundary.
    const rows = [year - 1, year, year + 1]
      .flatMap((y) => engines.get(key).getHolidays(y, 'en'))
      .filter((h) => list.observed || !h.substitute)
      .map((h) => ({
        date: h.date.slice(0, 10),
        name: h.name,
        type: h.type,
        observed: !!h.substitute,
      }))
      .filter((h) => Number(h.date.slice(0, 4)) === year);
    years.set(yearKey, [...new Map(rows.map((h) => [h.date + h.name, h])).values()]);
  }
  return years.get(yearKey);
}
export function listDetails(list, key, time) {
  if (
    list.type === 'workday' &&
    !insideHours(list.hours, new Date(key + 'T12:00').getDay(), time)
  ) {
    return { matches: false, names: [] };
  }
  const matching = list.dates.filter((entry) => inEntry(entry, key));
  if (matching.some((e) => e.action === 'exclude')) {
    return { matches: false, names: [] };
  }
  if (matching.some((e) => e.action === 'include')) {
    return {
      matches: true,
      names: matching.filter((e) => e.action === 'include').map((e) => e.label || list.name),
    };
  }
  if (list.type === 'custom') {
    return { matches: false, names: [] };
  }
  const holidays = holidayRows(list, Number(key.slice(0, 4))).filter((h) => h.date === key);
  if (list.type === 'holiday') {
    return { matches: holidays.length > 0, names: holidays.map((h) => h.name) };
  }
  const matches =
    list.weekdays.includes(new Date(key + 'T12:00').getDay()) && holidays.length === 0;
  return { matches, names: matches ? [list.name] : [] };
}
export function listMatches(list, key, time) {
  return listDetails(list, key, time).matches;
}
export function listDescription(list) {
  if (list.type === 'custom') {
    return list.dates.length + ' date entries';
  }
  const area = [
    countries()[list.country],
    states(list.country)[list.state],
    regions(list.country, list.state)[list.region],
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    (list.type === 'workday'
      ? list.weekdays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') +
        ' · '
      : '') +
    (area || 'No regional holidays') +
    (list.observed ? ' · observed included' : '')
  );
}
