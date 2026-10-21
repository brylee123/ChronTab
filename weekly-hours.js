import {iconMarkup} from './icons.js';
import {defaultHours,normalizeHours,minutes,timeText} from './work-hours.js';
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function createWeeklyHours(host,initial) {
  let hours=structuredClone(initial || defaultHours()),selected=1,drag=null;
  host.innerHTML='<p class="helper-text">Drag in a day column to create a time block. Select a block to edit exact times. For overnight work, split the block at midnight.</p><div class="hours-scroll"><div class="hours-week"><div class="hours-header"><span></span>'+days.map(day=>'<span>'+day.slice(0,3).toUpperCase()+'</span>').join('')+'</div><div class="hours-body"><div class="hours-ruler">'+Array.from({length:24},(_,h)=>'<span style="top:'+h*32+'px">'+(h%12||12)+(h<12?'a':'p')+'</span>').join('')+'</div>'+days.map((day,i)=>'<div class="hours-column" data-day="'+i+'" role="group" aria-label="'+day+' work hours" tabindex="0"></div>').join('')+'</div></div></div><div class="hours-detail"></div>';
  const detail=host.querySelector('.hours-detail');
  const columns=[...host.querySelectorAll('.hours-column')];
  function render() {
    columns.forEach((column,day)=>{
      column.replaceChildren();
      (hours[day] || []).forEach((block,index)=>{
        const button=document.createElement('button');button.type='button';button.className='hours-block';
        const start=minutes(block.start),end=minutes(block.end,true);
        button.style.top=start/60*32+'px';button.style.height=Math.max(16,(end-start)/60*32)+'px';
        button.setAttribute('aria-label',days[day]+' '+block.start+' to '+block.end);
        const top=document.createElement('span');top.textContent=block.start;
        const bottom=document.createElement('span');bottom.textContent=block.end;
        button.append(top,bottom);button.addEventListener('pointerdown',event=>event.stopPropagation());
        button.addEventListener('click',()=>{selected=day;renderDetail();});
        column.append(button);
      });
    });
    renderDetail();
  }
  function renderDetail() {
    detail.innerHTML='<div class="hours-detail-heading"><label class="field">Edit day<select aria-label="Edit workday"></select></label><button type="button" class="button secondary">'+iconMarkup('plus')+' Add hours</button></div><div class="hours-block-fields"></div>';
    const select=detail.querySelector('select');days.forEach((name,index)=>select.add(new Option(name,index)));select.value=selected;
    select.addEventListener('change',()=>{selected=Number(select.value);renderDetail();});
    detail.querySelector('button').addEventListener('click',()=>{hours[selected] ||= [];hours[selected].push({start:'09:00',end:'17:00'});render();});
    const rows=detail.querySelector('.hours-block-fields');
    if(!hours[selected]?.length){const p=document.createElement('p');p.className='helper-text';p.textContent='No work hours on '+days[selected]+'.';rows.append(p);}
    (hours[selected] || []).forEach((block,index)=>{
      const row=document.createElement('div');row.className='hours-field-row';
      for(const key of ['start','end']) {
        const label=document.createElement('label');label.className='field';label.textContent=key==='start'?'From (HH:MM)':'To (HH:MM)';
        const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.pattern='[0-2][0-9]:[0-5][0-9]';input.required=true;input.value=block[key];input.setAttribute('aria-label',days[selected]+' block '+(index+1)+' '+key);
        input.addEventListener('change',()=>{try{minutes(input.value,key==='end');block[key]=input.value;render();}catch(error){input.setCustomValidity(error.message);input.reportValidity();}});
        input.addEventListener('input',()=>input.setCustomValidity(''));label.append(input);row.append(label);
      }
      const remove=document.createElement('button');remove.type='button';remove.className='icon-button';remove.innerHTML=iconMarkup('delete');remove.setAttribute('aria-label','Remove '+days[selected]+' block '+(index+1));remove.addEventListener('click',()=>{hours[selected].splice(index,1);render();});row.append(remove);rows.append(row);
    });
  }
  function slot(event,column) {return Math.max(0,Math.min(47,Math.floor((event.clientY-column.getBoundingClientRect().top)/16)));}
  columns.forEach((column,day)=>{
    column.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();column.setPointerCapture(event.pointerId);
      drag={day,start:slot(event,column),end:slot(event,column)};paintDrag(column);
    });
    column.addEventListener('pointermove',event=>{if(drag?.day===day){drag.end=slot(event,column);paintDrag(column);}});
    column.addEventListener('pointerup',()=>{
      if(!drag || drag.day!==day)return;
      const start=Math.min(drag.start,drag.end)*30,end=(Math.max(drag.start,drag.end)+1)*30;
      const existing=(hours[day] || []).map(b=>({start:minutes(b.start),end:minutes(b.end,true)}));
      existing.push({start,end});existing.sort((a,b)=>a.start-b.start);
      const merged=[];for(const r of existing){const last=merged.at(-1);if(last && r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
      hours[day]=merged.map(r=>({start:timeText(r.start),end:timeText(r.end)}));selected=day;drag=null;render();
    });
    column.addEventListener('pointercancel',()=>{drag=null;render();});
    column.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();selected=day;renderDetail();detail.querySelector('button').focus();}});
  });
  function paintDrag(column) {
    let block=column.querySelector('.hours-selection');
    if(!block){block=document.createElement('div');block.className='hours-block hours-selection';column.append(block);}
    block.style.top=Math.min(drag.start,drag.end)*16+'px';block.style.height=(Math.abs(drag.start-drag.end)+1)*16+'px';
  }
  render();host.querySelector('.hours-scroll').scrollTop=6*32;
  return {value:()=>normalizeHours(hours)};
}
