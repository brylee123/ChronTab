import test from 'node:test';
import assert from 'node:assert/strict';
let counter=0;
async function setup(initial=[]) {
  let store={tabs:structuredClone(initial)},failOpen=false,failStore=false,failClose=false;
  const opened=[],closed=[],alarms=new Map(),listeners={};
  const event=name=>({addListener:fn=>{listeners[name]=fn;}});
  globalThis.chrome={
    storage:{local:{get:async defaults=>({...defaults,...structuredClone(store)}),set:async value=>{if(failStore)throw new Error('Disk full');store=structuredClone({...store,...value});}}},
    alarms:{create:async(name,info)=>alarms.set(name,info),clear:async name=>alarms.delete(name),onAlarm:event('alarm')},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    tabs:{create:async info=>{if(failOpen)throw new Error('Blocked');opened.push(info);return {id:opened.length};},get:async id=>({id,url:'https://example.com/',title:'Source tab',pinned:true}),remove:async id=>{if(failClose)throw new Error('Cannot close');closed.push(id);}},
    runtime:{id:'chrontab-test',onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed')}
  };
  await import('../background.js?test='+counter++);
  const send=(type,payload={})=>new Promise(resolve=>listeners.message({type,...payload},{id:'chrontab-test'},resolve));
  await send('list'); // queued after startup reconciliation
  return {send,opened,closed,alarms,listeners,get store(){return store;},failOpen:v=>{failOpen=v;},failStore:v=>{failStore=v;},failClose:v=>{failClose=v;}};
}
const future=()=>new Date(Date.now()+86400000).toISOString();
const record=(extras={})=>({id:'test-tab',title:'Example',url:'https://example.com/',anchor:future(),nextWake:future(),rule:null,completed:0,paused:false,pinned:false,...extras});
test('save persists and arms before closing, failed storage never closes',async()=>{
  const app=await setup();
  assert.equal((await app.send('save',{record:record(),tabId:42})).ok,true);
  assert.equal(app.store.tabs[0].title,'Source tab');
  assert.equal(app.store.tabs[0].pinned,true);
  assert.deepEqual(app.closed,[42]);
  assert.equal(app.alarms.size,1);
  app.failStore(true);
  assert.equal((await app.send('save',{record:record({id:'two'}),tabId:43})).ok,false);
  assert.deepEqual(app.closed,[42]);
});
test('save keeps a recoverable schedule if original tab cannot close',async()=>{
  const app=await setup();app.failClose(true);
  const result=await app.send('save',{record:record(),tabId:42});
  assert.equal(result.ok,true);assert.match(result.data.warning,/could not be closed/);
  assert.equal(app.store.tabs.length,1);
});
test('startup coalesces missed recurrences and removes a one-time wakeup',async()=>{
  const past=new Date(Date.now()-86400000*20).toISOString();
  const app=await setup([record({anchor:past,nextWake:past}),record({id:'repeat',anchor:past,nextWake:past,rule:{unit:'day',interval:1,end:'after',count:3}})]);
  assert.equal(app.opened.length,2);
  assert.equal(app.store.tabs.length,1);
  assert.equal(app.store.tabs[0].completed,1);
  assert.ok(Date.parse(app.store.tabs[0].nextWake)>Date.now());
  assert.equal(app.alarms.size,1);
});
test('paused tabs stay asleep and resume, delete cancels the final alarm',async()=>{
  const app=await setup([record({paused:true})]);
  assert.equal(app.alarms.size,0);
  await app.send('toggle',{id:'test-tab'});assert.equal(app.alarms.size,1);
  await app.send('delete',{id:'test-tab'});assert.equal(app.store.tabs.length,0);assert.equal(app.alarms.size,0);
});
test('manual opening consumes an occurrence and stops at the count limit',async()=>{
  const app=await setup([record({rule:{unit:'day',interval:1,end:'after',count:1}})]);
  assert.equal((await app.send('wake',{id:'test-tab'})).ok,true);
  assert.equal(app.opened[0].active,true);
  assert.equal(app.store.tabs.length,0);
});
test('failed automatic opening retains and pauses the schedule for retry',async()=>{
  const app=await setup([record()]);
  app.failOpen(true);
  const past=new Date(Date.now()-10000).toISOString();
  // Import an overdue tab, then simulate its alarm.
  await app.send('import',{backup:{format:'chrontab',version:1,tabs:[record({id:'overdue',anchor:past,nextWake:past})]}});
  app.listeners.alarm({name:'chrontab-wake'});await app.send('list');
  assert.equal(app.store.tabs.find(t=>t.id==='overdue').paused,true);
  assert.match(app.store.tabs.find(t=>t.id==='overdue').error,/Could not open/);
});
test('import merges, deduplicates, and rejects unsafe items without partial writes',async()=>{
  const app=await setup([record()]);
  const result=await app.send('import',{backup:{format:'chrontab',version:1,tabs:[record(),record({id:'second'})]}});
  assert.deepEqual(result.data,{added:1,skipped:1});
  const invalid=await app.send('import',{backup:{format:'chrontab',version:1,tabs:[record({id:'third'}),record({id:'bad',url:'javascript:alert(1)'})]}});
  assert.equal(invalid.ok,false);assert.equal(app.store.tabs.length,2);
});
test('serialized concurrent saves do not overwrite each other',async()=>{
  const app=await setup();
  const results=await Promise.all(Array.from({length:12},(_,i)=>app.send('save',{record:record({id:'tab-'+i})})));
  assert.ok(results.every(r=>r.ok));assert.equal(app.store.tabs.length,12);
});

test('date-list edits recalculate assigned tabs and referenced lists cannot be deleted',async()=>{
  const app=await setup();
  const hours=Object.fromEntries(Array.from({length:7},(_,d)=>[d,d>0&&d<6?[{start:'09:00',end:'17:00'}]:[]]));
  const list={id:'work-hours',name:'Work',type:'workday',country:'US',state:'NY',hours,dates:[]};
  assert.equal((await app.send('save-list',{list})).ok,true);
  const anchor=new Date(2027,0,18,9).toISOString();
  const tab=record({anchor,nextWake:anchor,rule:{unit:'day',interval:1,end:'after',count:3},conditions:{include:{op:'all',children:[{source:'schedule'},{listId:list.id}]},exclude:null}});
  assert.equal((await app.send('save',{record:tab})).ok,true);
  assert.equal(new Date(app.store.tabs[0].nextWake).getDate(),19);
  assert.equal((await app.send('delete-list',{id:list.id})).ok,false);
  assert.equal((await app.send('save-list',{list:{...list,dates:[{start:'2027-01-19',end:'2027-01-19',action:'exclude'}]}})).ok,true);
  assert.equal(new Date(app.store.tabs[0].nextWake).getDate(),20);
  assert.equal(app.store.tabs[0].completed,0);
});
test('worker rejects non-repeating date-list conflicts without saving or closing the source tab',async()=>{
  const app=await setup();
  const list={id:'dates',name:'Dates',type:'custom',dates:[{start:'2027-01-20',end:'2027-01-20'}]};
  await app.send('save-list',{list});
  const result=await app.send('save',{record:record({conditions:{include:{listId:list.id},exclude:null}}),tabId:42});
  assert.equal(result.ok,false);assert.match(result.error,/conflict with Does not repeat/);
  assert.equal(app.store.tabs.length,0);assert.equal(app.closed.length,0);
});
test('an overdue conditional tab skips an excluded current day without consuming an occurrence',async()=>{
  const app=await setup();
  const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
  const list={id:'excluded',name:'Today off',type:'custom',dates:[{start:today,end:today}]};
  const tab=record({anchor:yesterday.toISOString(),nextWake:yesterday.toISOString(),rule:{unit:'day',interval:1,end:'never'},conditions:{include:{source:'schedule'},exclude:{listId:list.id}}});
  assert.equal((await app.send('import',{backup:{format:'chrontab',version:2,tabs:[tab],dateLists:[list]}})).ok,true);
  app.listeners.alarm({name:'chrontab-wake'});await app.send('list');
  assert.equal(app.opened.length,0);assert.equal(app.store.tabs[0].completed,0);
  assert.ok(Date.parse(app.store.tabs[0].nextWake)>Date.now());
});
test('invalid imported date-list references reject the entire backup atomically',async()=>{
  const app=await setup();
  const tab=record({rule:{unit:'day',interval:1,end:'never'},conditions:{include:{listId:'missing'},exclude:null}});
  const result=await app.send('import',{backup:{format:'chrontab',version:2,tabs:[tab],dateLists:[{id:'other',name:'Other',type:'custom',dates:[{start:'2027-01-01'}]}]}});
  assert.equal(result.ok,false);assert.equal(app.store.tabs.length,0);assert.equal(app.store.dateLists,undefined);
});
