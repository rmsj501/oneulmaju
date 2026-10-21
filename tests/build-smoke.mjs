import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
assert.equal(typeof worker.fetch,'function');
const routes=['/admin/sessions/','/admin-sessions.js','/','/join/','/guest/','/login/','/verify-phone/','/profile/','/auth/confirm/','/auth/resend/','/forgot-password/','/privacy/','/dating/','/my/','/my/account/','/checkout/success/','/checkout/fail/','/auth-flow.js','/profile-flow.js','/commerce-flow.js','/my-flow.js','/payment-result.js','/application/','/admin/','/application-flow.js','/admin-flow.js','/admin-files.js','/my-applications.js','/style.css','/brand.png','/oneulmaju-cover.jpg','/oneulmaju-dating-cover.png'];
routes.push(...['02-main-faq-bg','03-benefit-faq-bg','04-schedule-faq-bg','05-participants-faq-bg','06-difference-faq-bg','07-criteria-faq-bg','08-process-faq-bg','09-faq'].map(name=>'/product-details/'+name+'.webp'));
for(const path of routes){
  const response=await worker.fetch(new Request('https://example.test'+path),{});
  assert.equal(response.status,200,path);
  if(path.endsWith('.webp')){
    assert.equal(response.headers.get('Content-Type'),'image/webp',path);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('ascii',0,4),'RIFF',path);
    assert.equal(bytes.toString('ascii',8,12),'WEBP',path);
  }
  if(path.endsWith('/')){
    assert.match(response.headers.get('Content-Type'),/text\/html/);const html=await response.text();
    assert.equal((html.match(/class="bottom-nav"/g)||[]).length,1,path);assert.match(html,/href="\/"[^>]*>.*?<span>홈<\/span>/);assert.match(html,/href="\/dating\/"[^>]*>.*?<span>소개팅<\/span>/);assert.match(html,/href="\/my\/"[^>]*>.*?<span>MY<\/span>/);
    const active=path==='/'?'/':path.startsWith('/dating/')||path.startsWith('/checkout/')?'/dating/':'/my/';assert.ok(html.includes('href="'+active+'" aria-current="page"'),path);
    for(const [,asset]of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css)(?:\?[^"]+)?)"/g))assert.equal((await worker.fetch(new Request('https://example.test'+asset),{})).status,200,asset);
  }
}
const status=await worker.fetch(new Request('https://example.test/api/status'),{});
assert.deepEqual(await status.json(),{accountsReady:false,phoneRequired:true,phoneReady:false,profilesReady:false,uploadsReady:false});
assert.equal((await worker.fetch(new Request('https://example.test/missing/'),{})).status,404);
const memo=await worker.fetch(new Request('https://example.test/memo/'),{});assert.equal(memo.status,200);const memoHTML=await memo.text();assert.ok(!memoHTML.includes('class="bottom-nav"'));assert.match(memo.headers.get('X-Robots-Tag'),/noindex/);assert.equal(memo.headers.get('Referrer-Policy'),'no-referrer');
for(const path of ['/memo-flow.js','/memo.css','/admin-memos.js','/vendor/qrcode-generator-2.0.4.js'])assert.equal((await worker.fetch(new Request('https://example.test'+path),{})).status,200,path);
console.log('Worker entrypoint, '+routes.length+' asset routes, bottom navigation and fail-closed readiness verified');
