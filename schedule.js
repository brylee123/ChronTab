import {normalizeConditions,expressionListIds} from './rule-schema.js';
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 16000) throw new Error('Invalid tab URL.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS tabs can be snoozed.');
  return url.href;
}
export function localInput(value) {
  const d = new Date(value);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') +
    'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function integer(v, min, max) { return Number.isInteger(v) && v >= min && v <= max; }
export function validateRule(rule) {
  if (rule === null) return null;
  if (!rule || !['day','week','month','year'].includes(rule.unit) || !integer(rule.interval,1,999)) throw new Error('Choose a repeat interval between 1 and 999.');
  if (!['never','on','after'].includes(rule.end)) throw new Error('Invalid recurrence ending.');
  const result = {unit:rule.unit, interval:rule.interval, end:rule.end};
  if (rule.unit === 'week') {
    if (!Array.isArray(rule.days) || !rule.days.length || rule.days.length > 7 || rule.days.some(d => !integer(d,0,6))) throw new Error('Select at least one weekday.');
    result.days = [...new Set(rule.days)].sort();
  }
  if (rule.unit === 'month') {
    if (!['date','weekday'].includes(rule.monthly)) throw new Error('Choose a monthly repeat pattern.');
    result.monthly = rule.monthly;
  }
  if (rule.end === 'after') {
    if (!integer(rule.count,1,100000)) throw new Error('Choose 1 to 100,000 occurrences.');
    result.count = rule.count;
  }
  if (rule.end === 'on') {
    if (typeof rule.until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rule.until) || !Number.isFinite(new Date(rule.until+'T23:59:59').getTime()) || localInput(new Date(rule.until+'T12:00')).slice(0,10) !== rule.until) throw new Error('Choose a valid end date.');
    result.until = rule.until;
  }
  return result;
}
function dayNumber(d) { return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()) / 86400000; }
// Calendar arithmetic preserves local wall time across DST. Invalid month dates are skipped.
export function nextOccurrence(anchorValue, rule, afterValue, completed = 0) {
  const anchor = new Date(anchorValue), after = new Date(afterValue);
  if (!rule) return anchor > after ? anchor.toISOString() : null;
  if (rule.end === 'after' && completed >= rule.count) return null;
  const limit = rule.end === 'on' ? new Date(rule.until+'T23:59:59.999') : new Date('9999-12-31T23:59:59');
  const make = (y,m,d) => new Date(y,m,d,anchor.getHours(),anchor.getMinutes(),anchor.getSeconds(),anchor.getMilliseconds());
  let candidate;
  if (rule.unit === 'day' || rule.unit === 'week') {
    let offset = Math.max(0, dayNumber(after)-dayNumber(anchor));
    if (rule.unit === 'day') offset = Math.floor(offset/rule.interval)*rule.interval;
    for (let i=0; i < rule.interval*7+8; i++) {
      const d = make(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()+offset);
      const week = Math.floor((dayNumber(d)-dayNumber(anchor)+anchor.getDay())/7);
      if ((rule.unit === 'day' || (week % rule.interval === 0 && rule.days.includes(d.getDay()))) && d >= anchor && d > after) { candidate=d; break; }
      offset += rule.unit === 'day' ? rule.interval : 1;
    }
  } else if (rule.unit === 'month') {
    const difference = (after.getFullYear()-anchor.getFullYear())*12+after.getMonth()-anchor.getMonth();
    let step = Math.max(0,Math.floor(difference/rule.interval));
    for (let i=0; i<4801; i++,step++) {
      const month = make(anchor.getFullYear(),anchor.getMonth()+step*rule.interval,1);
      if (month > limit) break;
      let day = anchor.getDate();
      if (rule.monthly === 'weekday') {
        const ordinal = Math.floor((anchor.getDate()-1)/7);
        day = 1 + (anchor.getDay()-month.getDay()+7)%7 + ordinal*7;
      }
      const d = make(month.getFullYear(),month.getMonth(),day);
      if (d.getMonth() === month.getMonth() && d >= anchor && d > after) { candidate=d; break; }
    }
  } else {
    let step = Math.max(0,Math.floor((after.getFullYear()-anchor.getFullYear())/rule.interval));
    for (let i=0; i<401; i++,step++) {
      const year = anchor.getFullYear()+step*rule.interval;
      if (year > 9999) break;
      const d=make(year,anchor.getMonth(),anchor.getDate());
      if (d.getMonth()===anchor.getMonth() && d>=anchor && d>after) { candidate=d; break; }
    }
  }
  return candidate && candidate <= limit ? candidate.toISOString() : null;
}
export function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid saved tab.');
  if (typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id)) throw new Error('Invalid tab ID.');
  const anchor = new Date(raw.anchor), next = new Date(raw.nextWake);
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(next.getTime()) || anchor.getFullYear()<2000 || anchor.getFullYear()>9999 || next.getFullYear()>9999 || next<anchor) throw new Error('Invalid schedule dates.');
  const rule = validateRule(raw.rule);
  const conditions=normalizeConditions(raw.conditions);
  if(!rule && [...expressionListIds(conditions?.include),...expressionListIds(conditions?.exclude)].length)throw new Error('Date-list rules conflict with Does not repeat. Choose a recurrence or remove all date-list conditions.');
  if (!integer(raw.completed,0,100000) || (rule?.end === 'after' && raw.completed >= rule.count)) throw new Error('Invalid occurrence count.');
  if (rule?.end === 'on' && next > new Date(rule.until+'T23:59:59.999')) throw new Error('Wake time is after the end date.');
  return {id:raw.id,url:safeUrl(raw.url),title:String(raw.title || raw.url).slice(0,500),anchor:anchor.toISOString(),nextWake:next.toISOString(),rule,completed:raw.completed,paused:raw.paused===true,pinned:raw.pinned===true,...(raw.conditions ? {conditions:normalizeConditions(raw.conditions)}:{})};
}
export function parseBackup(data) {
  if (!data || data.format !== 'chrontab' || ![1,2].includes(data.version) || !Array.isArray(data.tabs) || data.tabs.length > 5000) throw new Error('Choose a Chrontab version 1 or 2 backup (up to 5,000 tabs).');
  const tabs=data.tabs.map(normalizeRecord);
  if (new Set(tabs.map(t=>t.id)).size !== tabs.length) throw new Error('Backup contains duplicate IDs.');
  return tabs;
}
export function describeRule(rule, anchor) {
  if (!rule) return 'One time';
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let text = rule.interval === 1 ? 'Every '+rule.unit : 'Every '+rule.interval+' '+rule.unit+'s';
  if (rule.unit==='week') text += ' · '+rule.days.map(d=>days[d]).join(', ');
  if (rule.unit==='month') {
    const d=new Date(anchor);
    text += rule.monthly==='weekday' ? ' · '+['1st','2nd','3rd','4th','5th'][Math.floor((d.getDate()-1)/7)]+' '+days[d.getDay()] : ' · day '+d.getDate();
  }
  if (rule.end==='on') text += ' · until '+rule.until;
  if (rule.end==='after') text += ' · '+rule.count+' wakeups';
  return text;
}
