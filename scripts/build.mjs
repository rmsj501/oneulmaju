import {readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();const assets={};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const icons={home:'<path d="m3 10 9-7 9 7v10H5V10"/><path d="M9 20v-7h6v7"/>',dating:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8Z"/>',my:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'};
function navigation(file){const active=file==='/index.html'?'home':file.startsWith('/dating/')||file.startsWith('/checkout/')?'dating':'my';return '<nav class="bottom-nav" aria-label="하단 메뉴">'+[['home','/','홈'],['dating','/dating/','소개팅'],['my','/my/','MY']].map(([id,href,label])=>'<a href="'+href+'"'+(id===active?' aria-current="page"':'')+'><svg viewBox="0 0 24 24" aria-hidden="true">'+icons[id]+'</svg><span>'+label+'</span></a>').join('')+'</nav>';}
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else{const ext=path.extname(file);if(!types[ext])continue;const assetPath='/'+path.relative(path.join(root,'web'),file).split(path.sep).join('/');let content=await readFile(file);if(ext==='.html'&&!assetPath.startsWith('/memo/'))content=Buffer.from(content.toString().replace('</body>',navigation(assetPath)+'</body>'));assets[assetPath]={type:types[ext],data:content.toString('base64')};}}}
await walk(path.join(root,'web'));assets['/']=assets['/index.html'];
const versions=Object.fromEntries(Object.entries(assets).filter(([name])=>/\.(js|css)$/.test(name)).map(([name,asset])=>[name,createHash('sha256').update(asset.data).digest('hex').slice(0,10)]));
for(const [name,asset]of Object.entries(assets)){if(name==='/'||!name.endsWith('.html'))continue;asset.data=Buffer.from(Buffer.from(asset.data,'base64').toString().replace(/((?:src|href)=")([^"?]+\.(?:js|css))"/g,(match,prefix,file)=>versions[file]?prefix+file+'?v='+versions[file]+'"':match)).toString('base64');}
const worker=await readFile(path.join(root,'worker/index.mjs'),'utf8');
const commerce=await readFile(path.join(root,'worker/commerce.mjs'),'utf8');
const profile=await readFile(path.join(root,'shared/profile.mjs'),'utf8');
const applications=await readFile(path.join(root,'worker/applications.mjs'),'utf8');
const memoWorker=await readFile(path.join(root,'worker/memos.mjs'),'utf8');
await rm(path.join(root,'dist'),{recursive:true,force:true});await mkdir(path.join(root,'dist/server'),{recursive:true});
await writeFile(path.join(root,'dist/server/index.js'),'const ASSET_TABLE='+JSON.stringify(assets)+';\n'+profile.replace(/export /g,'').replace('const fail = (status,message,code) => { throw new AppError(status,message,code); };\n','')+'\n'+commerce.replace(/export /g,'')+'\n'+memoWorker.replace(/export /g,'')+'\n'+applications.replace(/export /g,'')+'\n'+worker.replace(/^import .*;\n/gm,''));
console.log('Built Worker with '+Object.keys(assets).length+' website assets');
