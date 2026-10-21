import {iconMarkup,hydrateIcons} from './icons.js';
import {countries,states,regions,normalizeDateList,listDescription,listDetails,dateKey} from './date-lists.js';
import {createWeeklyHours} from './weekly-hours.js';
const el=(tag,className='',value='')=>{const e=document.createElement(tag);e.className=className;e.textContent=value;return e;};
function action(label,icon,handler,cls='button subtle') {
  const b=el('button',cls);b.type='button';b.innerHTML=iconMarkup(icon);b.append(document.createTextNode(label));b.addEventListener('click',handler);return b;
}
export function createListManager(host,{getLists,onSave,onDelete,onError}) {
  function render() {
    host.innerHTML='<div class="section-heading"><div><div class="eyebrow">REUSABLE CALENDARS</div><h2>Date lists</h2><p class="muted">Regional holidays, your working hours, and dates that matter to you.</p></div></div><div class="date-list-cards"></div>';
    host.querySelector('.section-heading').append(action('New date list','plus',()=>edit(), 'button primary'));
    const cards=host.querySelector('.date-list-cards'),lists=getLists();
    if(!lists.length)cards.append(el('p','helper-text','Create a holiday, workday, or custom-date list, then use it in a tab’s date rules.'));
    for(const list of lists) {
      const card=el('article','date-list-card');
      const mark=el('div','list-card-icon');mark.innerHTML=iconMarkup(list.type);
      const body=el('div','list-card-body');body.append(el('span','list-type',list.type==='workday'?'Weekly work schedule':list.type==='holiday'?'Regional holidays':'Custom dates'),el('h3','',list.name),el('p','helper-text',listDescription(list)));
      const buttons=el('div','list-card-actions');
      buttons.append(action('View dates','calendar',()=>preview(list)),action('Edit','edit',()=>edit(list)),action('Delete','delete',async()=>{
        if(!confirm('Delete date list “'+list.name+'”? Lists assigned to tabs cannot be deleted.'))return;
        try{await onDelete(list.id);render();}catch(error){onError(error.message);}
      }));
      card.append(mark,body,buttons);cards.append(card);
    }
    const attribution=el('p','helper-text');attribution.append('Regional holiday data is bundled offline from ');
    const link=el('a','text-link','date-holidays');link.href='https://github.com/commenthol/date-holidays';link.target='_blank';link.rel='noopener noreferrer';attribution.append(link,'. Holiday rules reflect the installed database version. Work schedules use your device’s local time zone.');host.append(attribution);
  }
  function edit(existing=null) {
    const dialog=el('dialog','date-list-dialog');
    dialog.setAttribute('aria-label',existing?'Edit date list':'New date list');
    dialog.innerHTML='<div class="dialog-heading"><h2>'+(existing?'Edit date list':'New date list')+'</h2><button type="button" class="icon-button" aria-label="Close date list editor"><span data-icon="close"></span></button></div><form><div class="form-grid"><label class="field">List name<input id="list-name" required maxlength="100" placeholder="e.g. My working hours"></label><label class="field">List type<select id="list-type" aria-label="List type"><option value="holiday">Regional holidays</option><option value="workday">Workdays & hours</option><option value="custom">Custom dates</option></select></label></div><div id="regional-fields"><div class="form-grid"><label class="field">Country<select id="list-country" aria-label="Country"></select></label><label class="field">State / province<select id="list-state" aria-label="State / province"></select></label><label class="field">Subdivision<select id="list-region" aria-label="Subdivision"></select></label></div><fieldset class="category-fields"><legend>Holiday categories</legend></fieldset><label class="checkbox-line"><input type="checkbox" id="list-observed" checked> Include observed / substitute holidays</label><p class="helper-text" id="region-help"></p></div><div id="work-hours-fields"><h3 class="rule-title">Weekly work hours</h3><div id="weekly-hours"></div></div><div class="section-heading compact"><div><h3 class="rule-title" id="date-entry-heading">Date overrides</h3><p class="helper-text">Exclusions win over included dates. Annual ranges repeat by month and day.</p></div><button type="button" id="add-date-entry" class="button secondary"><span data-icon="plus"></span> Add date</button></div><div id="date-entries"></div><p class="error form-error" role="alert"></p><div class="dialog-actions"><button type="button" id="cancel-date-list" class="button subtle">Cancel</button><button type="submit" class="button primary">Save date list</button></div></form>';
    document.body.append(dialog);hydrateIcons(dialog);
    const $=selector=>dialog.querySelector(selector);
    $('#list-name').value=existing?.name || '';
    $('#list-type').value=existing?.type || 'holiday';
    $('#list-observed').checked=existing?.observed!==false;
    const selectedCategories=existing?.categories || ['public'];
    for(const name of ['public','bank','school','optional','observance']) {
      const label=el('label','checkbox-line');const input=document.createElement('input');input.type='checkbox';input.value=name;input.checked=selectedCategories.includes(name);label.append(input,document.createTextNode(name[0].toUpperCase()+name.slice(1)));$('.category-fields').append(label);
    }
    function options(select,values,placeholder,value='') {
      select.replaceChildren(new Option(placeholder,''));
      Object.entries(values).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([key,name])=>select.add(new Option(name,key)));
      select.value=value;
    }
    options($('#list-country'),countries(),'No regional holidays',existing?.country);
    function updateStates(value='',regionValue='') {options($('#list-state'),states($('#list-country').value),'Country-wide',value);updateRegions(regionValue);}
    function updateRegions(value='') {options($('#list-region'),regions($('#list-country').value,$('#list-state').value),'Whole state / province',value);}
    updateStates(existing?.state,existing?.region);
    $('#list-country').addEventListener('change',()=>updateStates());
    $('#list-state').addEventListener('change',()=>updateRegions());
    const hours=createWeeklyHours($('#weekly-hours'),existing?.hours);
    function refresh() {
      const type=$('#list-type').value;
      $('#regional-fields').hidden=type==='custom';
      $('#work-hours-fields').hidden=type!=='workday';
      $('#date-entry-heading').textContent=type==='custom'?'Custom dates':'Date overrides';
      $('#region-help').textContent=type==='workday'?'Selected regional holidays are excluded from working hours. Included date overrides can re-enable a holiday, while still respecting that weekday’s hours.':'Choose a country and optional subdivisions. Dates include the selected holiday categories.';
      $('#list-country').required=type==='holiday';
    }
    $('#list-type').addEventListener('change',refresh);refresh();
    function dateRow(entry={start:dateKey(new Date()),end:dateKey(new Date()),label:'',action:'include',annual:false}) {
      const row=el('div','date-entry-row');
      row.innerHTML='<label class="field">From<input type="date" data-field="start" min="2000-01-01" max="2199-12-31" required></label><label class="field">Through<input type="date" data-field="end" min="2000-01-01" max="2199-12-31" required></label><label class="field entry-label">Label<input data-field="label" maxlength="150" placeholder="Optional"></label><label class="field">Action<select data-field="action"><option value="include">Include</option><option value="exclude">Exclude</option></select></label><label class="checkbox-line"><input type="checkbox" data-field="annual"> Every year</label><button type="button" class="icon-button" aria-label="Remove date entry">'+iconMarkup('delete')+'</button>';
      for(const key of ['start','end','label','action'])row.querySelector('[data-field="'+key+'"]').value=entry[key] || '';
      row.querySelector('[data-field="annual"]').checked=entry.annual;
      row.querySelector('button').addEventListener('click',()=>row.remove());$('#date-entries').append(row);
    }
    (existing?.dates || []).forEach(dateRow);
    $('#add-date-entry').addEventListener('click',()=>dateRow());
    $('.dialog-heading button').addEventListener('click',()=>dialog.close());$('#cancel-date-list').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>dialog.remove());
    $('form').addEventListener('submit',async event=>{
      event.preventDefault();const submit=dialog.querySelector('[type="submit"]');submit.disabled=true;
      try {
        const type=$('#list-type').value;
        const dates=[...dialog.querySelectorAll('.date-entry-row')].map(row=>Object.fromEntries(['start','end','label','action','annual'].map(key=>{const field=row.querySelector('[data-field="'+key+'"]');return [key,key==='annual'?field.checked:field.value];})));
        const list=normalizeDateList({id:existing?.id || crypto.randomUUID(),name:$('#list-name').value,type,country:$('#list-country').value,state:$('#list-state').value,region:$('#list-region').value,categories:[...dialog.querySelectorAll('.category-fields input:checked')].map(i=>i.value),observed:$('#list-observed').checked,hours:type==='workday'?hours.value():undefined,dates});
        await onSave(list);dialog.close();render();
      }catch(error){$('.form-error').textContent=error.message;}finally{submit.disabled=false;}
    });
    dialog.showModal();$('#weekly-hours .hours-scroll').scrollTop=6*32;
  }
  function preview(list) {
    const dialog=el('dialog','date-list-dialog');
    dialog.setAttribute('aria-label','Dates in '+list.name);
    const heading=el('div','dialog-heading');heading.append(el('h2','',list.name),action('','close',()=>dialog.close(),'icon-button'));
    heading.querySelector('button').setAttribute('aria-label','Close list dates');
    const label=el('label','field','Year');const year=document.createElement('input');year.type='number';year.min=2000;year.max=2199;year.value=new Date().getFullYear();label.append(year);
    const body=el('div','list-date-preview');dialog.append(heading,label,body);document.body.append(dialog);
    function draw() {
      body.replaceChildren();const y=Number(year.value);if(!Number.isInteger(y)||y<2000||y>2199)return;
      for(let d=new Date(y,0,1,12);d.getFullYear()===y;d.setDate(d.getDate()+1)) {
        const key=dateKey(d),details=listDetails(list,key);if(!details.matches)continue;
        const row=el('div','list-date-preview-row');row.append(el('time','',new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',weekday:'short'}).format(d)),el('span','',details.names.join(', ')));
        if(list.type==='workday')row.append(el('small','',(list.hours[d.getDay()] || []).map(b=>b.start+'–'+b.end).join(', ')));
        body.append(row);
      }
      if(!body.children.length)body.append(el('p','helper-text','No matching dates in this year.'));
    }
    year.addEventListener('input',draw);dialog.addEventListener('close',()=>dialog.remove());draw();dialog.showModal();
  }
  render();return {render,edit};
}
