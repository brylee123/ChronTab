import { MAX_LIST_YEAR, MAX_RULE_EVALUATIONS, MAX_PREVIEW_OCCURRENCES } from './limits.js';
import { nextOccurrence } from './schedule.js';
import { dateKey, listMatches, validDate } from './date-lists.js';
import { checkReferences } from './rule-schema.js';
function atTime(key, anchor) {
  const d = new Date(key + 'T12:00');
  d.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
  return d;
}
function nextDay(key) {
  const d = new Date(key + 'T12:00');
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}
function matchesSchedule(record, key) {
  const at = atTime(key, new Date(record.anchor));
  return nextOccurrence(record.anchor, record.rule, at.getTime() - 1, 0) === at.toISOString();
}
export function expressionMatches(node, key, record, lists, time) {
  if (node.source === 'schedule') {
    return matchesSchedule(record, key);
  }
  if (node.listId) {
    const list = lists.find((l) => l.id === node.listId);
    if (!list) {
      throw new Error('A date list is missing.');
    }
    const candidate = atTime(key, new Date(record.anchor));
    const minuteOfDay = time ?? candidate.getHours() * 60 + candidate.getMinutes();
    return listMatches(list, key, minuteOfDay);
  }
  return node.op === 'all'
    ? node.children.every((n) => expressionMatches(n, key, record, lists, time))
    : node.children.some((n) => expressionMatches(n, key, record, lists, time));
}
export function dateAllowed(record, key, lists, time) {
  if (!record.conditions) {
    return true;
  }
  return (
    expressionMatches(record.conditions.include, key, record, lists, time) &&
    !(
      record.conditions.exclude &&
      expressionMatches(record.conditions.exclude, key, record, lists, time)
    )
  );
}
function entryNext(entry, key) {
  if (!entry.annual) {
    return key <= entry.end ? (key > entry.start ? key : entry.start) : null;
  }
  const year = Number(key.slice(0, 4)),
    start = year + entry.start.slice(4),
    end = year + entry.end.slice(4);
  if (key <= end && validDate(key > start ? key : start)) {
    return key > start ? key : start;
  }
  for (let next = year + 1; next <= MAX_LIST_YEAR; next++) {
    const candidate = next + entry.start.slice(4);
    if (validDate(candidate)) {
      return candidate;
    }
  }
  return null;
}
function nextListDate(list, key, bound, budget, time) {
  if (list.type === 'custom') {
    let cursor = key;
    while (cursor <= bound) {
      if (--budget.left < 0) {
        throw new Error(
          'This date rule is too broad to evaluate. Simplify its groups or date ranges.',
        );
      }
      const candidates = list.dates
        .filter((e) => e.action === 'include')
        .map((e) => entryNext(e, cursor))
        .filter((k) => k && k <= bound)
        .sort();
      if (!candidates.length) {
        return null;
      }
      const candidate = candidates[0];
      if (listMatches(list, candidate, typeof time === 'function' ? time(candidate) : time)) {
        return candidate;
      }
      cursor = nextDay(candidate);
    }
    return null;
  }
  let cursor = key;
  while (cursor <= bound) {
    if (--budget.left < 0) {
      throw new Error(
        'No match found within the rule evaluation limit. Narrow the dates or simplify the groups.',
      );
    }
    if (listMatches(list, cursor, typeof time === 'function' ? time(cursor) : time)) {
      return cursor;
    }
    cursor = nextDay(cursor);
  }
  return null;
}
function nextExpression(node, key, record, lists, bound, budget) {
  if (--budget.left < 0) {
    throw new Error('This date rule is too complex to evaluate. Simplify its groups.');
  }
  if (node.source === 'schedule') {
    const at = atTime(key, new Date(record.anchor));
    const candidate = nextOccurrence(record.anchor, record.rule, at.getTime() - 1, 0);
    return candidate && dateKey(candidate) <= bound ? dateKey(candidate) : null;
  }
  if (node.listId) {
    return nextListDate(
      lists.find((l) => l.id === node.listId),
      key,
      bound,
      budget,
      (key) => {
        const at = atTime(key, new Date(record.anchor));
        return at.getHours() * 60 + at.getMinutes();
      },
    );
  }
  if (node.op === 'any') {
    let nearest = null;
    // A cheap assigned-schedule candidate bounds the search of potentially broad lists.
    const children = [...node.children].sort(
      (a, b) => Number(b.source === 'schedule') - Number(a.source === 'schedule'),
    );
    for (const child of children) {
      const candidate = nextExpression(child, key, record, lists, nearest || bound, budget);
      if (candidate && (!nearest || candidate < nearest)) {
        nearest = candidate;
      }
      if (nearest === key) {
        break;
      } // No other condition can produce an earlier date.
    }
    return nearest;
  }
  let cursor = key;
  while (cursor <= bound) {
    const candidates = node.children.map((n) =>
      nextExpression(n, cursor, record, lists, bound, budget),
    );
    if (candidates.some((k) => !k)) {
      return null;
    }
    const latest = candidates.slice().sort().at(-1);
    if (candidates.every((k) => k === latest)) {
      return latest;
    }
    cursor = latest;
  }
  return null;
}
// Recurrence controls repetition/count/end; an expression controls which calendar dates qualify.
export function nextWake(record, lists, afterValue, completed = record.completed || 0) {
  if (!record.conditions) {
    return nextOccurrence(record.anchor, record.rule, afterValue, completed);
  }
  checkReferences(record.conditions, lists);
  if (
    (!record.rule && completed >= 1) ||
    (record.rule?.end === 'after' && completed >= record.rule.count)
  ) {
    return null;
  }
  const anchor = new Date(record.anchor),
    after = new Date(afterValue);
  let cursor = dateKey(new Date(Math.max(anchor.getTime(), after.getTime())));
  if (atTime(cursor, anchor) <= after) {
    cursor = nextDay(cursor);
  }
  const bound = record.rule?.end === 'on' ? record.rule.until : MAX_LIST_YEAR + '-12-31';
  const budget = { left: MAX_RULE_EVALUATIONS };
  while (cursor <= bound) {
    const key = nextExpression(record.conditions.include, cursor, record, lists, bound, budget);
    if (!key) {
      return null;
    }
    const candidate = atTime(key, anchor);
    if (
      candidate >= anchor &&
      candidate > after &&
      !(
        record.conditions.exclude &&
        expressionMatches(record.conditions.exclude, key, record, lists)
      )
    ) {
      return candidate.toISOString();
    }
    cursor = nextDay(key);
  }
  return null;
}
export function previewOccurrences(record, lists, start, end, max = 500) {
  const dates = [];
  const bounded = record.rule?.end === 'after';
  let after = bounded
    ? Date.parse(record.nextWake || record.anchor) - 1
    : Math.max(Date.parse(start) - 1, Date.parse(record.nextWake || record.anchor) - 1);
  let completed = record.completed || 0,
    iterations = 0;
  while (dates.length < max) {
    if (++iterations > MAX_PREVIEW_OCCURRENCES) {
      throw new Error('Calendar preview exceeds 10,000 occurrences.');
    }
    const next = nextWake(record, lists, after, completed);
    if (!next || Date.parse(next) > Date.parse(end)) {
      break;
    }
    if (Date.parse(next) >= Date.parse(start)) {
      dates.push(next);
    }
    after = Date.parse(next);
    completed++;
  }
  return dates;
}
