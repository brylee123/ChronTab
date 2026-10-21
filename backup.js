import {parseBackup} from './schedule.js';
import {normalizeDateLists} from './date-lists.js';
import {checkReferences,expressionListIds} from './rule-schema.js';
export function normalizeBackup(data,existingLists=[]) {
  const tabs=parseBackup(data);
  const lists=data.version===2 ? normalizeDateLists(data.dateLists || []) : [];
  const ids=new Set(existingLists.map(l=>l.id));
  // Existing IDs are kept; imported tabs use the existing definition for any matching ID.
  const available=[...existingLists,...lists.filter(l=>!ids.has(l.id))];
  tabs.forEach(t=>checkReferences(t.conditions,available));
  return {tabs,lists};
}
export function listsInUse(id,tabs) {
  return tabs.filter(tab=>[...expressionListIds(tab.conditions?.include),...expressionListIds(tab.conditions?.exclude)].includes(id));
}
