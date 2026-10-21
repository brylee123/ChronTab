import {safeUrl,normalizeRecord} from './schedule.js';
import {nextWake,dateAllowed} from './date-engine.js';
import {normalizeDateList,dateKey} from './date-lists.js';
import {checkReferences} from './rule-schema.js';
import {normalizeBackup,listsInUse} from './backup.js';
const ALARM='chrontab-wake';
let queue=Promise.resolve();
function exclusive(task) {const result=queue.then(task);queue=result.catch(console.error);return result;}
async function state() {return chrome.storage.local.get({tabs:[],dateLists:[]});}
async function write(tabs) {await chrome.storage.local.set({tabs});}
async function arm(tabs) {
  const active=tabs.filter(t=>!t.paused);
  if(active.length)await chrome.alarms.create(ALARM,{when:Math.max(Date.now()+1000,Math.min(...active.map(t=>Date.parse(t.nextWake))))});
  else await chrome.alarms.clear(ALARM);
  await chrome.action.setBadgeText({text:tabs.length ? String(tabs.length):''});
  await chrome.action.setBadgeBackgroundColor({color:'#c4b5fd'});
}
async function wake(record,lists,now,manual=false) {
  const completed=record.completed+1;
  const next=nextWake(record,lists,Math.max(now,Date.parse(record.nextWake)),completed);
  const opened=await chrome.tabs.create({url:safeUrl(record.url),active:manual,pinned:record.pinned});
  return {opened,next:next ? {...record,completed,nextWake:next}:null};
}
function reschedule(tab,lists,after) {
  try {
    const next=nextWake(tab,lists,after);
    if(next)return {...tab,nextWake:next,error:undefined};
    return {...tab,paused:true,error:'No remaining dates match this rule. Edit the schedule or its date lists.'};
  } catch(error) {return {...tab,paused:true,error:error.message};}
}
async function tick() {
  const {tabs,dateLists}=await state(),now=Date.now(),result=[];
  for(let index=0;index<tabs.length;index++) {
    const tab=tabs[index];
    if(tab.paused || Date.parse(tab.nextWake)>now){result.push(tab);continue;}
    try {
      // Never open an overdue conditional tab on a day its rule/exclusions disallow.
      if(tab.conditions && !dateAllowed(tab,dateKey(new Date(now)),dateLists,new Date(now).getHours()*60+new Date(now).getMinutes()))result.push(reschedule(tab,dateLists,now));
      else {const w=await wake(tab,dateLists,now);if(w.next)result.push(w.next);}
    } catch(error) {result.push({...tab,paused:true,error:'Could not open this tab: '+error.message+'. Resume or edit to retry.'});console.error(error);}
    await write([...result,...tabs.slice(index+1)]);
  }
  await write(result);await arm(result);
}
async function handle(message) {
  let {tabs,dateLists}=await state();
  if(message.type==='list')return tabs;
  if(message.type==='state')return {tabs,dateLists};
  if(message.type==='save-list') {
    const list=normalizeDateList(message.list);
    if(dateLists.length>=100 && !dateLists.some(l=>l.id===list.id))throw new Error('The 100-list limit has been reached.');
    dateLists=[...dateLists.filter(l=>l.id!==list.id),list];
    const now=Date.now();
    tabs=tabs.map(tab=>listsInUse(list.id,[tab]).length ? reschedule(tab,dateLists,now):tab);
    await chrome.storage.local.set({tabs,dateLists});await arm(tabs);return {};
  }
  if(message.type==='delete-list') {
    const used=listsInUse(message.id,tabs);
    if(used.length)throw new Error('This list is used by '+used.length+' schedule(s). Remove it from those rules before deleting it.');
    dateLists=dateLists.filter(l=>l.id!==message.id);
    await chrome.storage.local.set({dateLists});return {};
  }
  if(message.type==='save') {
    const record=normalizeRecord(message.record);
    checkReferences(record.conditions,dateLists);
    if(record.conditions) {
      const next=nextWake(record,dateLists,Date.parse(record.anchor)-1,0);
      if(!next)throw new Error('No dates match this rule. Adjust the start date, recurrence, or date lists.');
      record.nextWake=next;
    }
    if(Date.parse(record.anchor)<=Date.now() || Date.parse(record.nextWake)<=Date.now())throw new Error('Choose a future date and time.');
    if(tabs.length>=5000 && !tabs.some(t=>t.id===record.id))throw new Error('The 5,000-tab limit has been reached.');
    let source;
    if(Number.isInteger(message.tabId)) {
      source=await chrome.tabs.get(message.tabId);
      if(source.incognito)throw new Error('Private tabs cannot be snoozed.');
      if(safeUrl(source.url)!==record.url)throw new Error('The tab changed. Reopen the snooze popup and try again.');
      record.title=source.title || record.url;record.pinned=source.pinned;
    }
    tabs=[...tabs.filter(t=>t.id!==record.id),record];
    await write(tabs);await arm(tabs);
    if(source){try{await chrome.tabs.remove(source.id);}catch{return {warning:'Schedule saved, but the original tab could not be closed.'};}}
    return {};
  }
  if(message.type==='delete')tabs=tabs.filter(t=>t.id!==message.id);
  else if(message.type==='toggle')tabs=tabs.map(t=>t.id===message.id ? {...t,paused:!t.paused,error:undefined}:t);
  else if(message.type==='wake') {
    const tab=tabs.find(t=>t.id===message.id);if(!tab)throw new Error('This schedule no longer exists.');
    const result=await wake(tab,dateLists,Date.now(),true);
    tabs=tabs.filter(t=>t.id!==tab.id);if(result.next)tabs.push(result.next);
  } else if(message.type==='import') {
    const incoming=normalizeBackup(message.backup,dateLists);
    const ids=new Set(tabs.map(t=>t.id)),listIds=new Set(dateLists.map(l=>l.id));
    const added=incoming.tabs.filter(t=>!ids.has(t.id)),newLists=incoming.lists.filter(l=>!listIds.has(l.id));
    if(tabs.length+added.length>5000 || dateLists.length+newLists.length>100)throw new Error('Import exceeds the schedule or date-list limit.');
    dateLists.push(...newLists);tabs.push(...added);
    await chrome.storage.local.set({tabs,dateLists});await arm(tabs);
    const result={added:added.length,skipped:incoming.tabs.length-added.length};
    if(message.backup.version===2)Object.assign(result,{listsAdded:newLists.length,listsSkipped:incoming.lists.length-newLists.length});
    return result;
  } else throw new Error('Unknown action.');
  await write(tabs);await arm(tabs);return {};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  exclusive(()=>handle(message)).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)exclusive(tick);});
chrome.runtime.onStartup.addListener(()=>exclusive(tick));
chrome.runtime.onInstalled.addListener(()=>exclusive(tick));
exclusive(tick);
