import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,mkdtemp} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/bryle/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve('dist');
await mkdir('artifacts',{recursive:true});
const context=await chromium.launchPersistentContext(await mkdtemp(resolve('artifacts/browser-profile-')),{
  executablePath:process.env.CHRONTAB_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:true,args:['--disable-extensions-except='+root,'--load-extension='+root,'--no-first-run'],viewport:{width:1440,height:1040}
});
try {
  let worker=context.serviceWorkers()[0];
  if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
  const extensionId=new URL(worker.url()).host;
  console.log('Loaded extension',extensionId);
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('chrome-extension://'+extensionId+'/dashboard.html');
  await page.getByRole('heading',{name:'A little breathing room.'}).waitFor();
  await page.getByRole('button',{name:'Light theme',exact:true}).click();
  await page.screenshot({path:'artifacts/dashboard-empty.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Schedule a tab',exact:true}).click();
  await page.getByLabel('Tab title').fill('Weekly reading');
  await page.getByLabel('Website URL').fill('https://example.com/');
  await page.locator('#wake-at').fill('2027-01-19T09:00');
  await page.locator('#repeat').click();
  await page.getByLabel('Repeat interval').fill('2');
  await page.getByRole('button',{name:'Thursday',exact:true}).click();
  await page.locator('#end-after').check();
  await page.getByLabel('Number of occurrences').fill('5');
  await page.screenshot({path:'artifacts/recurrence.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Schedule tab',exact:true}).click();
  await page.getByRole('link',{name:'Weekly reading',exact:true}).waitFor();
  console.log('Created recurring schedule');
  await page.getByRole('button',{name:'Pause schedule — Weekly reading',exact:true}).click();
  await page.getByRole('button',{name:'Resume schedule — Weekly reading',exact:true}).waitFor();
  await page.getByRole('button',{name:'Resume schedule — Weekly reading',exact:true}).click();
  await page.getByRole('button',{name:'Pause schedule — Weekly reading',exact:true}).waitFor();
  // A one-time tab alongside the recurring schedule.
  await page.getByRole('button',{name:'Schedule a tab',exact:true}).click();
  await page.getByLabel('Tab title').fill('Read it later');
  await page.getByLabel('Website URL').fill('https://developer.chrome.com/docs/extensions');
  await page.locator('#wake-at').fill('2027-02-15T14:30');
  await page.getByRole('button',{name:'Schedule tab',exact:true}).click();
  await page.getByRole('link',{name:'Read it later',exact:true}).waitFor();
  await page.screenshot({path:'artifacts/dashboard.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Dark theme',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Dark theme"]').getAttribute('aria-pressed')==='true' && getComputedStyle(document.querySelector('.brand')).color==='rgb(230, 225, 229)');
  await page.screenshot({path:'artifacts/dashboard-dark.png',fullPage:true,animations:'disabled'});
  await page.reload();
  await page.getByRole('link',{name:'Read it later',exact:true}).waitFor();
  if(await page.getAttribute('html','data-theme')!=='dark')throw new Error('Dark theme did not persist');
  await page.getByRole('button',{name:'System theme',exact:true}).click();
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.getByRole('button',{name:'Light theme',exact:true}).click();
  console.log('Light, dark, system preference, and theme persistence passed');
  await page.getByRole('button',{name:'Recurring',exact:true}).click();
  if(await page.locator('.tab-row').count()!==1) throw new Error('Recurring filter failed');
  await page.getByRole('button',{name:'All tabs',exact:true}).click();
  await page.getByRole('searchbox').fill('read it');
  if(await page.locator('.tab-row').count()!==1) throw new Error('Search failed');
  await page.getByRole('searchbox').fill('');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export JSON',exact:true}).click();
  const download=await downloadPromise;
  await download.saveAs('artifacts/backup.json');
  await page.locator('#import-file').setInputFiles('artifacts/backup.json');
  await page.getByRole('status').filter({hasText:'Skipped 2 existing IDs'}).waitFor();
  console.log('JSON export/import deduplication passed');
  // Use a local HTTP server to verify actual automatic reopening without external network requests.
  const {createServer}=await import('node:http');
  const server=createServer((req,res)=>{res.end('<title>Wake test</title>Chrontab test');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/wake';
    const result=await page.evaluate(async url=>{
      const when=new Date(Date.now()+2000).toISOString();
      return chrome.runtime.sendMessage({type:'save',record:{id:'real-wake-test',url,title:'Wake test',anchor:when,nextWake:when,completed:0,rule:null,paused:false,pinned:false}});
    },url);
    if(!result.ok)throw new Error(result.error);
    const opened=await context.waitForEvent('page',{timeout:45000});
    await opened.waitForLoadState();
    if(opened.url()!==url)throw new Error('Wrong URL reopened');
    await page.waitForFunction(()=>!document.body.textContent.includes('Wake test'));
    console.log('Real browser alarm reopened the one-time tab');
  } finally {await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
  // Popup rendering on an unsupported page still needs a clear state.
  const popup=await context.newPage();
  popup.on('pageerror',e=>errors.push(e.message));
  await popup.setViewportSize({width:404,height:790});
  await popup.addInitScript(()=>{
    chrome.tabs.query=async()=>[{id:999,url:'https://example.com/',title:'An interesting page for later',pinned:false}];
  });
  await popup.goto('chrome-extension://'+extensionId+'/popup.html');
  await popup.getByRole('button',{name:'Snooze this tab',exact:true}).waitFor();
  await popup.getByRole('button',{name:'Dark theme',exact:true}).click();
  await popup.waitForFunction(()=>document.querySelector('[aria-label="Dark theme"]').getAttribute('aria-pressed')==='true' && getComputedStyle(document.querySelector('.brand')).color==='rgb(230, 225, 229)');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await popup.screenshot({path:'artifacts/popup.png',fullPage:true,animations:'disabled'});
  await popup.locator('#repeat').click();
  await popup.getByRole('heading',{name:'Custom recurrence',exact:true}).waitFor();
  await popup.screenshot({path:'artifacts/recurrence-dark.png',fullPage:true,animations:'disabled'});
  await popup.getByRole('button',{name:'Cancel',exact:true}).click();
  await popup.getByRole('button',{name:'Light theme',exact:true}).click();
  await popup.screenshot({path:'artifacts/popup-light.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/dashboard-mobile.png',fullPage:true,animations:'disabled'});
  if(errors.length)throw new Error('Browser page errors: '+errors.join('; '));
  console.log('Browser integration checks passed; screenshots saved in artifacts/.');
} finally {await context.close();}
