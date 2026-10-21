import {createRuleBuilder} from './rule-builder.js';
import {nextWake} from './date-engine.js';
import {hydrateIcons,iconMarkup} from './icons.js';
import './theme.js';
hydrateIcons();
import {localInput, nextOccurrence, validateRule, describeRule, safeUrl} from './schedule.js';
export async function api(type, payload={}) {
  const response=await chrome.runtime.sendMessage({type,...payload});
  if (!response?.ok) throw new Error(response?.error || 'The extension did not respond. Try reloading it.');
  return response.data;
}
export function showMessage(message, error=false, id='message') {
  const el=document.getElementById(id);
  el.textContent=message;
  el.classList.toggle('error',error);
}
const dateFormat=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export function formatDate(value) { return dateFormat.format(new Date(value)); }
export function createEditor(container,{record=null,tab=null,initialDate=null,onSave,onError}) {
  let rule=record?.rule ? structuredClone(record.rule) : null;
  let dateLists=[],builder=null,loadingLists=true;
  const initial=new Date(record?.anchor || (initialDate ? initialDate+'T09:00':Date.now()+3600000));
  initial.setSeconds(0,0);
  container.innerHTML=`
  <form id="snooze-form">
    <div id="url-fields" ${tab ? 'hidden' : ''}><label class="field">Tab title<input id="schedule-title" maxlength="500" placeholder="A name to remember it by"></label><label class="field">Website URL<input id="schedule-url" type="url" placeholder="https://example.com" required></label></div>
    <div class="quick-times"><button type="button" data-quick="hour">In an hour</button><button type="button" data-quick="tomorrow">Tomorrow, 9 AM</button><button type="button" data-quick="week">In a week</button></div>
    <label class="field"><span id="date-label">Wake this tab at</span><input type="datetime-local" id="wake-at" required></label>
    <label class="field"><span>Repeat</span><button type="button" id="repeat" class="recurrence-button">${iconMarkup('repeat')}<span id="repeat-text">Does not repeat</span><span class="arrow">${iconMarkup('chevron-down')}</span></button></label>
    <details class="date-rule-details" ${record?.conditions ? 'open' : ''}><summary>${iconMarkup('filter')}<span>Calendar lists &amp; date rules</span>${iconMarkup('chevron-down')}</summary><div id="date-rule-builder"></div></details><p id="date-rule-warning" class="rule-warning" role="alert"></p><p id="form-summary" class="form-summary" aria-live="polite"></p>
    <button class="button primary full" id="save-schedule" type="submit">${iconMarkup(tab ? 'sleep' : record ? 'edit' : 'plus')}${tab ? 'Snooze this tab' : record ? 'Save changes' : 'Schedule tab'}</button>
    <p class="form-note">${tab ? 'Saves the URL and closes this tab. Unsaved page work is not saved.' : record ? 'Saving resets the start date and completed occurrence count.' : 'The URL will open in a new tab when it’s time.'}</p>
  </form>`;
  const $=selector=>container.querySelector(selector);
  const listsReady=api('state').then(data=>{dateLists=data.dateLists;loadingLists=false;builder=createRuleBuilder($('#date-rule-builder'),record?.conditions,dateLists,refresh);refresh();}).catch(error=>{loadingLists=false;onError(error.message);});
  $('#save-schedule').disabled=true;
  $('#wake-at').value=localInput(initial);
  $('#wake-at').min=localInput(Date.now()+60000);
  $('#schedule-url').value=record?.url || tab?.url || '';
  $('#schedule-title').value=record?.title || tab?.title || '';
  $('#repeat').addEventListener('click',()=>openRecurrence(rule,$('#wake-at').value,newRule=>{rule=newRule;refresh();}));
  $('#wake-at').addEventListener('change',refresh);
  container.querySelectorAll('[data-quick]').forEach(button=>button.addEventListener('click',()=>{
    const date=new Date();
    if(button.dataset.quick==='hour') date.setHours(date.getHours()+1);
    if(button.dataset.quick==='tomorrow') { date.setDate(date.getDate()+1); date.setHours(9,0,0,0); }
    if(button.dataset.quick==='week') date.setDate(date.getDate()+7);
    $('#wake-at').value=localInput(date); refresh();
  }));
  function refresh() {
    $('#repeat-text').textContent=rule ? 'Custom recurrence…' : 'Does not repeat';
    $('#date-label').textContent=rule ? 'Start date and time' : 'Wake this tab at';
    const anchor=new Date($('#wake-at').value);
    if(!Number.isFinite(anchor.getTime())) { $('#form-summary').textContent=''; return; }
    const conflict=!rule && builder?.hasLists();
    $('#date-rule-warning').textContent=conflict ? 'Date-list rules conflict with Does not repeat. Select a recurrence or remove the date-list conditions before saving.':'';
    $('#save-schedule').disabled=loadingLists || conflict;
    if(conflict){$('#form-summary').textContent='';return;}
    try {
      const conditions=builder?.value() || null;
      const candidate={anchor:anchor.toISOString(),rule,completed:0,conditions};
      const next=nextWake(candidate,dateLists,anchor.getTime()-1,0);
      let summary=(rule ? describeRule(rule,anchor)+' · ':'')+(next ? 'Next wake: '+formatDate(next):'No dates match this rule.');
      if(next && rule && conditions) {
        let after=Date.parse(next),completed=1;
        for(let i=0;i<2;i++){const extra=nextWake(candidate,dateLists,after,completed);if(!extra)break;summary+=' → '+formatDate(extra);after=Date.parse(extra);completed++;}
      }
      $('#form-summary').textContent=summary;
    }catch(error){$('#form-summary').textContent=error.message;}
  }
  refresh();
  $('#snooze-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=$('#save-schedule');
    button.disabled=true;
    try {
      await listsReady;
      if(!builder)throw new Error('Date lists could not be loaded. Reopen this editor.');
      if(!rule && builder.hasLists())throw new Error('Date-list rules conflict with Does not repeat. Select a recurrence or remove the date lists.');
      const anchor=new Date($('#wake-at').value);
      if(!Number.isFinite(anchor.getTime()) || anchor<=new Date()) throw new Error('Choose a future start date and time.');
      const checkedRule=validateRule(rule);
      const conditions=builder.value();
      const next=nextWake({anchor:anchor.toISOString(),rule:checkedRule,completed:0,conditions},dateLists,anchor.getTime()-1,0);
      if(!next) throw new Error('No dates match this recurrence. Adjust the start date or end date.');
      const saved={id:record?.id || crypto.randomUUID(),url:safeUrl($('#schedule-url').value),title:$('#schedule-title').value || $('#schedule-url').value,anchor:anchor.toISOString(),nextWake:next,rule:checkedRule,completed:0,paused:record?.paused || false,pinned:record?.pinned || tab?.pinned || false,...(conditions ? {conditions}:{})};
      await onSave(saved);
    } catch(error) { onError(error.message); }
    finally { button.disabled=false; refresh(); }
  });
}
function openRecurrence(existing,startValue,onDone) {
  const anchor=new Date(startValue);
  if(!Number.isFinite(anchor.getTime())) return;
  const rule=existing ? structuredClone(existing) : {unit:'week',interval:1,days:[anchor.getDay()],monthly:'date',end:'never',count:10,until:localInput(anchor).slice(0,10)};
  const dialog=document.createElement('dialog');
  dialog.className='recurrence-dialog';
  dialog.setAttribute('aria-labelledby','recurrence-title');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="recurrence-title">Custom recurrence</h2></div>
  <form><div class="repeat-every"><label for="interval">Repeat every</label><input id="interval" type="number" min="1" max="999" required aria-label="Repeat interval"><select id="unit" aria-label="Repeat unit"><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option></select></div>
  <fieldset id="weekly"><legend>Repeat on</legend><div class="weekday-row">${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,i)=>'<button type="button" class="day-button" aria-label="'+day+'" aria-pressed="false" data-day="'+i+'">'+day[0]+'</button>').join('')}</div></fieldset>
  <label class="field" id="monthly">Repeat on<select id="month-pattern"><option value="date">Same day of the month</option><option value="weekday">Same weekday and week of the month</option></select></label>
  <fieldset><legend>Ends</legend><div class="end-row"><input id="end-never" name="ending" type="radio" value="never"><label for="end-never">Never</label></div><div class="end-row"><input id="end-on" name="ending" type="radio" value="on"><label for="end-on">On</label><input id="until" type="date" aria-label="Recurrence end date"></div><div class="end-row"><input id="end-after" name="ending" type="radio" value="after"><label for="end-after">After</label><input id="count" type="number" min="1" max="100000" aria-label="Number of occurrences"><span>occurrences</span></div></fieldset>
  <p class="timezone-note">Repeats at the start time in your device’s local time zone. Months without the selected date are skipped.</p><p class="recurrence-error" role="alert"></p><div class="dialog-actions"><button id="no-repeat" type="button" class="button subtle">No repeat</button><button id="cancel-repeat" type="button" class="button subtle">Cancel</button><button type="submit" class="button secondary">Done</button></div></form>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  $('#interval').value=rule.interval;
  $('#unit').value=rule.unit;
  $('#until').value=rule.until || localInput(anchor).slice(0,10);
  $('#until').min=localInput(anchor).slice(0,10);
  $('#count').value=rule.count || 10;
  $('#month-pattern').value=rule.monthly || 'date';
  $('#end-'+rule.end).checked=true;
  dialog.querySelectorAll('[data-day]').forEach(button=>{
    button.setAttribute('aria-pressed',String((rule.days || [anchor.getDay()]).includes(Number(button.dataset.day))));
    button.addEventListener('click',()=>button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true')));
  });
  function refresh() {
    $('#weekly').hidden=$('#unit').value!=='week';
    $('#monthly').hidden=$('#unit').value!=='month';
    $('#until').disabled=!$('#end-on').checked;
    $('#count').disabled=!$('#end-after').checked;
    $('#until').required=$('#end-on').checked;
    $('#count').required=$('#end-after').checked;
  }
  $('#unit').addEventListener('change',refresh);
  dialog.querySelectorAll('[name="ending"]').forEach(input=>input.addEventListener('change',refresh));
  $('#cancel-repeat').addEventListener('click',()=>dialog.close());
  $('#no-repeat').addEventListener('click',()=>{onDone(null);dialog.close();});
  dialog.addEventListener('close',()=>dialog.remove());
  $('form').addEventListener('submit',event=>{
    event.preventDefault();
    try {
      const result=validateRule({unit:$('#unit').value,interval:Number($('#interval').value),days:[...dialog.querySelectorAll('[data-day][aria-pressed="true"]')].map(b=>Number(b.dataset.day)),monthly:$('#month-pattern').value,end:$('[name="ending"]:checked').value,until:$('#until').value,count:Number($('#count').value)});
      if(!nextOccurrence(anchor,result,anchor.getTime()-1)) throw new Error('The end date must include at least one wakeup.');
      onDone(result);dialog.close();
    } catch(error) { $('.recurrence-error').textContent=error.message; }
  });
  refresh(); dialog.showModal();
}
