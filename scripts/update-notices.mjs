import {readdirSync,readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
const seen=new Set(),notices=['Chrontab bundles third-party open-source software. The following notices retain the licenses shipped with the installed dependencies. Some listed build-time packages are not included in the runtime extension.\n'];
for(const entry of readdirSync('node_modules/.pnpm')) {
 const directory=join('node_modules/.pnpm',entry,'node_modules');
 if(!existsSync(directory))continue;
 const candidates=[];
 for(const name of readdirSync(directory)){
  if(name.startsWith('@')){for(const sub of readdirSync(join(directory,name)))candidates.push(join(directory,name,sub));}
  else candidates.push(join(directory,name));
 }
 for(const folder of candidates){
  try{
   const pkg=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
   const key=pkg.name+'@'+pkg.version;
   if(seen.has(key))continue;seen.add(key);
   const licenses=readdirSync(folder).filter(n=>/^(license|licence|copying|notice)(\.|$)/i.test(n) && statSync(join(folder,n)).isFile());
   if(!licenses.length)continue;
   notices.push('\n'+key+'\n'+'='.repeat(key.length)+'\n'+licenses.map(n=>readFileSync(join(folder,n),'utf8')).join('\n'));
  }catch{}
 }
}
writeFileSync('THIRD_PARTY_NOTICES.txt',notices.join('\n'));
