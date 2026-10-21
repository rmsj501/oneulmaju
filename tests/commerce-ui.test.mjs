import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {previewSchedule} from '../worker/commerce.mjs';
const shopHTML=await readFile(new URL('../web/dating/index.html',import.meta.url),'utf8');
const shopScript=await readFile(new URL('../web/commerce-flow.js',import.meta.url),'utf8');
class Element{
  constructor(tag='div'){this.tag=tag;this.value='';this.textContent='';this.children=[];this.events={};this.attributes={};this.hidden=false;this.disabled=false;this.checked=true;}
  addEventListener(name,handler){this.events[name]=handler;}setAttribute(name,value){this.attributes[name]=value;}focus(){this.focused=true;}scrollIntoView(){}replaceChildren(...items){this.children=[...items];}append(...items){this.children.push(...items);}reportValidity(){return true;}click(){return this.events.click?.();}
  querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
}
function screen(html){const nodes={};for(const [tag,id]of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element();node.hidden=/\shidden(?:\s|>)/.test(tag);node.disabled=/\sdisabled(?:\s|>)/.test(tag);for(const [,name,value]of tag.matchAll(/\b(aria-[a-z-]+)="([^"]*)"/g))node.setAttribute(name,value);nodes[id]=node;}return nodes;}
const preview={events:[{id:'preview-20261024',event_date:'2026-10-24',start_time:null,male_price:45000,female_price:35000,status:'preparing'}],bookingReady:false,reviewsReady:false,pricesProvisional:true};
function shop(catalog=preview,handler){
  const nodes=screen(shopHTML),genders=['남성','여성'].map(value=>Object.assign(new Element('input'),{value})),calls=[];
  const api=async(path,body)=>{calls.push({path,body});if(path==='/api/catalog')return catalog;if(path==='/api/reviews'&&!body)return {reviews:[],ready:catalog.reviewsReady};if(handler)return handler(path,body);throw new Error('Unexpected API call');};
  const document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag),querySelectorAll:()=>genders,head:new Element()};
  const context={document,crypto:webcrypto,window:{OneulAPI:api,location:{search:'',origin:'https://example.test',assign:url=>{context.destination=url;}}},Intl,Date,URLSearchParams,FormData:class{get(name){return name==='content'?nodes['review-content'].value:name==='rating'?'5':nodes['review-order'].value;}}};
  vm.runInNewContext(shopScript,context);return {nodes,genders,calls,context,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('gender and available calendar date update amount; preview cannot create payment',async()=>{
  const ui=shop();await ui.flush();const n=ui.nodes;
  assert.equal(n['booking-calendar'].hidden,true);assert.equal(n['selected-event'].hidden,true);n['date-selection-toggle'].click();assert.equal(n['booking-calendar'].hidden,false);assert.equal(n['date-selection-toggle'].attributes['aria-expanded'],'true');
  assert.equal(n['calendar-month'].textContent,'2026년 10월');const dates=n['calendar-days'].querySelectorAll('button');assert.equal(dates.length,1);assert.equal(dates[0].textContent,'24');
  ui.genders[0].events.change();dates[0].click();assert.equal(n['payment-amount'].textContent,'45,000원');assert.equal(n['pay-button'].disabled,true);
  assert.equal(n['booking-calendar'].hidden,true);assert.equal(n['date-selection-toggle'].attributes['aria-expanded'],'false');assert.equal(n['date-selection-toggle'].focused,true);assert.match(n['date-selection-value'].textContent,/10월 24일/);
  ui.genders[1].events.change();assert.equal(n['payment-amount'].textContent,'35,000원');assert.match(n['amount-label'].textContent,/정가/);await n['pay-button'].click();assert.ok(!ui.calls.some(c=>c.path.includes('checkout')));
  n['date-selection-toggle'].click();assert.equal(n['calendar-days'].querySelectorAll('button')[0].attributes['aria-pressed'],'true');let prevented=false;n['booking-calendar'].events.keydown({key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(n['booking-calendar'].hidden,true);assert.equal(n['payment-amount'].textContent,'35,000원');
});
test('date selection stays closed while multiple same-day sessions remain selectable',async()=>{
  const ui=shop({...preview,events:[{...preview.events[0],id:'first',start_time:'13:00'},{...preview.events[0],id:'second',start_time:'16:00',female_price:26000}]});await ui.flush();ui.genders[1].events.change();ui.nodes['date-selection-toggle'].click();ui.nodes['calendar-days'].querySelectorAll('button')[0].click();
  assert.equal(ui.nodes['booking-calendar'].hidden,true);assert.equal(ui.nodes['time-options'].hidden,false);assert.equal(ui.nodes['booking-time-selection'].hidden,false);assert.deepEqual(ui.nodes['time-options'].children.map(b=>b.textContent),['오후 1시','오후 4시']);assert.equal(ui.nodes['payment-amount'].textContent,'— 원');assert.equal(ui.nodes['amount-note'].textContent,'시간을 선택해주세요.');ui.nodes['time-options'].children[1].click();assert.equal(ui.nodes['payment-amount'].textContent,'26,000원');assert.match(ui.nodes['selected-event'].textContent,/오후 4시/);
});
test('weekly calendar loads all Saturdays in later months and resets the selected time when changing dates',async()=>{
  const now=new Date('2026-10-08T05:12:00Z'),schedule=month=>({...preview,...previewSchedule(month,now)}),ui=shop(schedule('2026-10'),path=>path.startsWith('/api/catalog?month=')?schedule(path.split('=')[1]):undefined);await ui.flush();const n=ui.nodes;
  n['date-selection-toggle'].click();assert.deepEqual(n['calendar-days'].querySelectorAll('button').map(b=>b.textContent),['24','31']);assert.equal(n['previous-month'].disabled,true);assert.equal(n['next-month'].disabled,false);
  ui.genders[1].events.change();n['calendar-days'].querySelectorAll('button')[0].click();n['time-options'].children[0].click();assert.equal(n['payment-amount'].textContent,'35,000원');assert.equal(n['time-options'].children[0].attributes['aria-pressed'],'true');assert.equal(n['selected-event'].textContent,'오후 1시 · 1988~1996년생');
  n['date-selection-toggle'].click();await n['next-month'].click();assert.equal(n['calendar-month'].textContent,'2026년 11월');assert.deepEqual(n['calendar-days'].querySelectorAll('button').map(b=>b.textContent),['7','14','21','28']);n['calendar-days'].querySelectorAll('button')[1].click();assert.match(n['date-selection-value'].textContent,/11월 14일/);assert.equal(n['payment-amount'].textContent,'— 원');assert.ok(n['time-options'].children.every(b=>b.attributes['aria-pressed']==='false'));assert.equal(n['pay-button'].textContent,'시간을 선택해주세요');n['time-options'].children[1].click();assert.equal(n['selected-event'].textContent,'오후 4시 · 1994~2001년생');assert.equal(n['payment-amount'].textContent,'35,000원');assert.equal(n['pay-button'].disabled,true);
  n['date-selection-toggle'].click();await n['previous-month'].click();assert.deepEqual(n['calendar-days'].querySelectorAll('button').map(b=>b.textContent),['24','31']);await n['next-month'].click();await n['next-month'].click();assert.equal(n['calendar-month'].textContent,'2026년 12월');await n['next-month'].click();assert.equal(n['calendar-month'].textContent,'2027년 1월');assert.deepEqual(n['calendar-days'].querySelectorAll('button').map(b=>b.textContent),['2','9','16','23','30']);assert.ok(!ui.calls.some(c=>c.path.includes('checkout')));
});
test('failed month loads preserve the current dates and amount and allow retry without duplicate pending requests',async()=>{
  const now=new Date('2026-10-08T05:12:00Z'),catalog={...preview,...previewSchedule('2026-10',now)};let reject,attempts=0;
  const ui=shop(catalog,path=>{if(path.startsWith('/api/catalog?month=')){attempts++;return new Promise((resolve,rejectPromise)=>reject=rejectPromise);}});await ui.flush();ui.genders[0].events.change();const n=ui.nodes;n['date-selection-toggle'].click();n['calendar-days'].querySelectorAll('button')[0].click();n['time-options'].children[1].click();n['date-selection-toggle'].click();const loading=n['next-month'].click();assert.equal(n['next-month'].disabled,true);assert.ok(n['calendar-days'].querySelectorAll('button').every(b=>b.disabled));await n['next-month'].click();assert.equal(attempts,1);reject(new Error('일정 연결 오류'));await loading;
  assert.equal(n['calendar-month'].textContent,'2026년 10월');assert.equal(n['payment-amount'].textContent,'45,000원');assert.equal(n['next-month'].disabled,false);assert.ok(n['calendar-days'].querySelectorAll('button').every(b=>!b.disabled));assert.equal(n['booking-error'].textContent,'일정 연결 오류');
});
test('two available time options send the exact selected session ID when creating an order',async()=>{
  const first='33333333-3333-4333-8333-333333333333',second='44444444-4444-4444-8444-444444444444',requests=[];
  const catalog={...preview,bookingReady:true,pricesProvisional:false,events:[{...preview.events[0],id:first,start_time:'13:00',status:'open'},{...preview.events[0],id:second,start_time:'16:00',status:'open'}]};
  const ui=shop(catalog,(path,body)=>{if(path==='/api/checkout/order'){requests.push(body);throw new Error('test order interrupted');}});await ui.flush();const n=ui.nodes;ui.genders[0].events.change();n['date-selection-toggle'].click();n['calendar-days'].querySelectorAll('button')[0].click();assert.equal(n['pay-button'].disabled,true);await n['pay-button'].click();assert.equal(requests.length,0);
  n['time-options'].children[0].click();await n['pay-button'].click();assert.equal(requests[0].eventId,first);assert.equal(requests[0].gender,'남성');n['time-options'].children[1].click();await n['pay-button'].click();assert.equal(requests[1].eventId,second);assert.notEqual(requests[0].requestId,requests[1].requestId);
});
test('an empty event catalog keeps the date bar disabled and cannot open a calendar',async()=>{
  const ui=shop({...preview,events:[]});await ui.flush();assert.equal(ui.nodes['date-selection-toggle'].disabled,true);ui.nodes['date-selection-toggle'].click();assert.equal(ui.nodes['booking-calendar'].hidden,true);assert.match(ui.nodes['date-selection-value'].textContent,/일정이 아직 없어요/);
});
test('unconfigured reviews show local text preview without POST or point success',async()=>{
  const ui=shop();await ui.flush();await ui.nodes['write-review'].click();ui.nodes['review-content'].value='<img src=x onerror=alert(1)> 편하게 만났어요.';
  await ui.nodes['review-form'].events.submit({preventDefault(){}});assert.equal(ui.nodes['review-preview-content'].textContent,ui.nodes['review-content'].value);assert.match(ui.nodes['review-status'].textContent,/지급되지/);assert.ok(!ui.calls.some(c=>c.body));
  ui.nodes['submit-review'].disabled=true;await ui.nodes['write-review'].click();assert.equal(ui.nodes['submit-review'].disabled,false);
});
test('booking selection locks during order creation and unlocks after a failed response',async()=>{
  let reject;const ready={...preview,bookingReady:true,pricesProvisional:false,events:[{...preview.events[0],id:'33333333-3333-4333-8333-333333333333',status:'open'}]};
  const ui=shop(ready,path=>path==='/api/checkout/order'?new Promise((resolve,rejectPromise)=>{reject=rejectPromise;}):undefined);await ui.flush();ui.genders[0].events.change();ui.nodes['date-selection-toggle'].click();ui.nodes['calendar-days'].querySelectorAll('button')[0].click();
  const paying=ui.nodes['pay-button'].click();assert.equal(ui.genders[0].disabled,true);assert.equal(ui.nodes['calendar-days'].querySelectorAll('button')[0].disabled,true);reject(new Error('offline'));await paying;
  assert.equal(ui.nodes['date-selection-toggle'].disabled,false);
  assert.equal(ui.genders[0].disabled,false);assert.equal(ui.nodes['calendar-days'].querySelectorAll('button')[0].disabled,false);assert.equal(ui.nodes['booking-error'].textContent,'offline');
});
test('MY previews link to profile editor and account preview never sends edits',async()=>{
  const script=await readFile(new URL('../web/my-flow.js',import.meta.url),'utf8'),html=await readFile(new URL('../web/my/account/index.html',import.meta.url),'utf8'),nodes=screen(html),stored=new Map();let calls=0;
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},window:{OneulReady:Promise.resolve({accountsReady:false}),OneulAPI:()=>{calls++;throw new Error('must not send');}},sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)}});
  await new Promise(resolve=>setImmediate(resolve));nodes['account-name'].value='그너';nodes['account-email'].value='preview@example.test';await nodes['account-form'].events.submit({preventDefault(){}});
  assert.equal(calls,0);assert.match(nodes['account-status'].textContent,/실제 회원정보가 변경된 건 아니/);assert.equal(JSON.parse(stored.get('oneulmaju-account-preview-draft')).name,'그너');
  const my=await readFile(new URL('../web/my/index.html',import.meta.url),'utf8');assert.match(my,/href="\/profile\/\?preview=1"/);assert.match(my,/href="\/my\/account\/"/);
});
const couponId='55555555-5555-4555-8555-555555555555';
const readyShop={...preview,bookingReady:true,discountsReady:true,pricesProvisional:false,events:[{...preview.events[0],id:'33333333-3333-4333-8333-333333333333',status:'open'}]};
const wallet={ready:true,points:5000,coupons:[{id:couponId,title:'첫 만남 쿠폰',discount_type:'fixed',discount_amount:3000,min_amount:20000,starts_at:'2026-01-01T00:00:00+09:00',expires_at:'2030-01-01T00:00:00+09:00'}]};
function chooseFemale(ui){ui.genders[1].events.change();ui.nodes['date-selection-toggle'].click();ui.nodes['calendar-days'].querySelectorAll('button')[0].click();}
test('unconfigured benefits stay disabled and do not invent a coupon or point balance',async()=>{
  const ui=shop();await ui.flush();chooseFemale(ui);assert.equal(ui.nodes['coupon-selection'].disabled,true);assert.equal(ui.nodes['points-input'].disabled,true);assert.equal(ui.nodes['use-all-points'].disabled,true);assert.equal(ui.nodes['coupon-selection'].children.length,1);assert.equal(ui.nodes['points-balance'].textContent,'보유 — P');assert.equal(ui.nodes['price-breakdown'].hidden,false);assert.ok(!ui.calls.some(c=>c.path==='/api/benefits'));
});
test('owned coupon and points update net price, clamp excessive or decimal inputs, and reset an ineligible coupon',async()=>{
  const ui=shop({...readyShop,events:[readyShop.events[0],{...readyShop.events[0],id:'lower-price',event_date:'2026-10-31',female_price:1500}]},path=>path==='/api/benefits'?wallet:undefined);await ui.flush();chooseFemale(ui);
  const n=ui.nodes;n['coupon-selection'].value=couponId;n['coupon-selection'].events.change();assert.equal(n['payment-amount'].textContent,'32,000원');assert.equal(n['price-breakdown'].hidden,false);assert.equal(n['coupon-discount-row'].hidden,false);
  n['points-input'].value='1000.9';n['points-input'].events.input();assert.equal(n['payment-amount'].textContent,'31,000원');assert.equal(n['points-input'].value,'1000');
  n['points-input'].value='999999';n['points-input'].events.input();assert.equal(n['points-input'].value,'5000');assert.equal(n['payment-amount'].textContent,'27,000원');
  n['points-input'].value='-20';n['points-input'].events.input();assert.equal(n['points-input'].value,'0');n['use-all-points'].click();assert.equal(n['points-input'].value,'5000');
  n['date-selection-toggle'].click();n['calendar-days'].querySelectorAll('button').find(b=>b.textContent==='31').click();assert.equal(n['coupon-selection'].value,'');assert.equal(n['points-input'].value,'1500');assert.equal(n['payment-amount'].textContent,'0원');assert.equal(n['pay-button'].textContent,'혜택 사용하고 신청하기');assert.equal(n['pay-button'].disabled,false);
});
test('failed own-benefit lookup leaves the undiscounted price and prompts login',async()=>{
  const ui=shop(readyShop,path=>{if(path==='/api/benefits')throw Object.assign(new Error('login'),{status:401});});await ui.flush();chooseFemale(ui);assert.equal(ui.nodes['payment-amount'].textContent,'35,000원');assert.equal(ui.nodes['points-input'].disabled,true);assert.match(ui.nodes['benefits-note'].textContent,/로그인/);
});
test('checkout sends coupon ID and point use, retries the same request after a lost response, and locks benefits',async()=>{
  let submitted,tries=0;const ui=shop(readyShop,(path,body)=>{if(path==='/api/benefits')return wallet;if(path==='/api/checkout/order'){submitted=body;tries++;throw new Error('offline');}});await ui.flush();chooseFemale(ui);
  ui.nodes['coupon-selection'].value=couponId;ui.nodes['coupon-selection'].events.change();ui.nodes['points-input'].value='1000';ui.nodes['points-input'].events.input();
  const paying=ui.nodes['pay-button'].click();assert.equal(ui.nodes['points-input'].disabled,true);assert.equal(ui.nodes['coupon-selection'].disabled,true);await paying;const requestId=submitted.requestId;assert.equal(submitted.couponId,couponId);assert.equal(submitted.pointsUsed,1000);assert.equal(submitted.amount,undefined);
  await ui.nodes['pay-button'].click();assert.equal(submitted.requestId,requestId);assert.equal(tries,2);assert.equal(ui.nodes['points-input'].disabled,false);
});
test('fully covered confirmed application redirects without loading or requesting a payment widget',async()=>{
  const freeWallet={ready:true,points:35000,coupons:[]};const ui=shop(readyShop,(path,body)=>path==='/api/benefits'?freeWallet:path==='/api/checkout/order'?{order:{id:body.requestId,eventId:body.eventId,gender:body.gender,amount:0,status:'paid'}}:undefined);
  await ui.flush();chooseFemale(ui);ui.nodes['use-all-points'].click();await ui.nodes['pay-button'].click();assert.match(ui.context.destination,/^\/checkout\/success\/\?orderId=/);assert.equal(ui.context.document.head.children.length,0);assert.equal(ui.nodes['change-booking'].hidden,true);
});
test('failed widget setup retains its reserved order; verified cancellation releases selection',async()=>{
  let creates=0,canceled=false;const ui=shop(readyShop,(path,body)=>{if(path==='/api/benefits')return wallet;if(path==='/api/checkout/order'){creates++;return {order:{id:body.requestId,eventId:body.eventId,gender:body.gender,amount:35000,status:'pending'},clientKey:'test',customerKey:'test'};}if(path==='/api/checkout/cancel'){canceled=true;return {canceled:true};}});
  ui.context.window.TossPayments=()=>({widgets:()=>({setAmount:async()=>{throw new Error('widget failed');}})});
  await ui.flush();chooseFemale(ui);await ui.nodes['pay-button'].click();assert.equal(ui.genders[1].disabled,true);assert.equal(ui.nodes['change-booking'].hidden,false);await ui.nodes['pay-button'].click();assert.equal(creates,1);
  await ui.nodes['change-booking'].click();assert.equal(canceled,true);assert.equal(ui.genders[1].disabled,false);assert.equal(ui.nodes['change-booking'].hidden,true);assert.equal(ui.nodes['points-input'].disabled,false);
});
test('the widget and payment request use the confirmed discounted order, and a rejected change retains the lock',async()=>{
  let amount,requested;const ui=shop(readyShop,(path,body)=>{if(path==='/api/benefits')return wallet;if(path==='/api/checkout/order')return {order:{id:body.requestId,eventId:body.eventId,gender:body.gender,amount:31000,status:'pending'},clientKey:'test',customerKey:'test'};if(path==='/api/checkout/cancel')throw new Error('approval in progress');});
  ui.context.window.TossPayments=()=>({widgets:()=>({setAmount:async value=>{amount=value;},renderPaymentMethods:async()=>{},renderAgreement:async()=>{},requestPayment:async value=>{requested=value;}})});
  await ui.flush();chooseFemale(ui);ui.nodes['coupon-selection'].value=couponId;ui.nodes['coupon-selection'].events.change();ui.nodes['points-input'].value='1000';ui.nodes['points-input'].events.input();
  await ui.nodes['pay-button'].click();assert.equal(amount.value,31000);assert.equal(amount.currency,'KRW');await ui.nodes['pay-button'].click();assert.equal(requested.orderId,ui.calls.find(c=>c.path==='/api/checkout/order').body.requestId);
  await ui.nodes['change-booking'].click();assert.equal(ui.genders[1].disabled,true);assert.equal(ui.nodes['points-input'].disabled,true);assert.equal(ui.nodes['change-booking'].hidden,false);assert.equal(ui.nodes['booking-error'].textContent,'approval in progress');
});
test('MY displays available balance, held points and spending without presenting an award',async()=>{
  const script=await readFile(new URL('../web/my-flow.js',import.meta.url),'utf8'),html=await readFile(new URL('../web/my/index.html',import.meta.url),'utf8'),nodes=screen(html);
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},window:{OneulReady:Promise.resolve({accountsReady:true}),OneulAPI:async()=>({user:{name:'마주',email:'test@example.test'},commerceReady:true,discountsReady:true,points:3000,reservedPoints:1000,orders:[],ledger:[{amount:-1000,reason:'spend',created_at:'2026-10-06'}]})}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes['my-points'].textContent,'3,000 P');assert.match(nodes['my-points-note'].textContent,/보관 중인 1,000P/);assert.equal(nodes['my-ledger'].children[0].children[0].textContent,'소개팅 신청에 사용');assert.equal(nodes['my-ledger'].children[0].children[1].textContent,'-1,000 P');
});
async function myHistoryScreen(result,error){
  const script=await readFile(new URL('../web/my-flow.js',import.meta.url),'utf8'),html=await readFile(new URL('../web/my/index.html',import.meta.url),'utf8'),nodes=screen(html);
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},window:{OneulReady:Promise.resolve({accountsReady:true}),OneulAPI:async()=>{if(error)throw error;return {user:{name:'마주',email:'test@example.test'},commerceReady:true,points:0,orders:[],ledger:[],...result};}}});
  await new Promise(resolve=>setImmediate(resolve));return nodes;
}
test('connected MY displays real empty histories and zero points, without setup notices',async()=>{
  const nodes=await myHistoryScreen({});assert.equal(nodes['my-points'].textContent,'0 P');assert.equal(nodes['my-orders'].children[0].textContent,'결제 내역이 없어요.');assert.equal(nodes['my-ledger'].children[0].textContent,'포인트 내역이 없어요.');assert.equal(nodes['my-pending-section'].hidden,true);
});
test('MY separates unfinished payment from confirmed bookings and preserves review-awarded points',async()=>{
  const item={id:'paid',event_date:'2026-10-24',gender:'여성',amount:35000,status:'paid',paid_at:'2026-10-07',attended_at:'2026-10-07',review_written:true};
  const nodes=await myHistoryScreen({points:1000,orders:[item,{...item,id:'pending',status:'pending',paid_at:null,attended_at:null}],ledger:[{amount:1000,reason:'review',created_at:'2026-10-07'}]});
  assert.equal(nodes['my-orders'].children.length,1);assert.equal(nodes['my-orders'].children[0].children[1].textContent,'결제 완료 · 35,000원');assert.equal(nodes['my-pending-section'].hidden,false);assert.equal(nodes['my-pending-orders'].children.length,1);assert.equal(nodes['my-points'].textContent,'1,000 P');assert.equal(nodes['my-ledger'].children[0].children[1].textContent,'+1,000 P');
  const pendingOnly=await myHistoryScreen({orders:[{...item,status:'pending',paid_at:null}]});assert.equal(pendingOnly['my-orders'].children[0].textContent,'결제 내역이 없어요.');assert.equal(pendingOnly['my-pending-section'].hidden,false);
});
test('MY lookup errors stay distinct from an actual empty history',async()=>{
  const nodes=await myHistoryScreen({},new Error('temporary lookup failure'));assert.equal(nodes['my-points'].textContent,'— P');assert.match(nodes['my-orders'].children[0].textContent,/불러오지 못했어요/);assert.match(nodes['my-ledger'].children[0].textContent,/불러오지 못했어요/);
});
const openingCoupon={id:couponId,title:'오픈 이벤트 30% 쿠폰',discount_type:'percent',discount_percent:30,discount_amount:null,min_amount:0,starts_at:'2026-10-24T00:00:00+09:00',expires_at:'2026-11-25T00:00:00+09:00',valid_now:false};
test('future opening coupon stays visible but cannot reduce the regular price even if selected programmatically',async()=>{
  const ui=shop({...readyShop,bookingReady:false},path=>path==='/api/benefits'?{ready:true,points:0,coupons:[openingCoupon],serverTime:'2026-10-08T12:00:00+09:00'}:undefined);await ui.flush();chooseFemale(ui);const n=ui.nodes;
  assert.equal(n['payment-amount'].textContent,'35,000원');assert.equal(n['gross-amount'].textContent,'35,000원');assert.equal(n['amount-label'].textContent,'정가');assert.match(n['amount-note'].textContent,/적용 전/);
  assert.equal(n['coupon-selection'].disabled,false);assert.equal(n['coupon-selection'].children[1].disabled,true);assert.match(n['coupon-selection'].children[1].textContent,/30% 할인 · 10\/24~11\/24/);assert.match(n['benefits-note'].textContent,/지급됐어요/);assert.equal(n['discount-total'].textContent,'보유 1장');
  n['coupon-selection'].value=couponId;n['coupon-selection'].events.change();assert.equal(n['coupon-selection'].value,'');assert.equal(n['payment-amount'].textContent,'35,000원');assert.equal(n['coupon-discount-row'].hidden,true);assert.equal(n['pay-button'].disabled,true);
});
test('30 percent coupon subtracts from regular male and female prices during its window without enabling payment',async()=>{
  const ui=shop({...readyShop,bookingReady:false},path=>path==='/api/benefits'?{ready:true,points:0,coupons:[{...openingCoupon,valid_now:true}],serverTime:'2026-10-24T00:00:00+09:00'}:undefined);await ui.flush();chooseFemale(ui);const n=ui.nodes;
  assert.equal(n['payment-amount'].textContent,'35,000원');n['coupon-selection'].value=couponId;n['coupon-selection'].events.change();assert.equal(n['payment-amount'].textContent,'24,500원');assert.equal(n['gross-amount'].textContent,'35,000원');assert.equal(n['coupon-discount'].textContent,'−10,500원');assert.equal(n['coupon-discount-row'].hidden,false);
  ui.genders[0].events.change();assert.equal(n['payment-amount'].textContent,'31,500원');assert.equal(n['gross-amount'].textContent,'45,000원');assert.equal(n['coupon-discount'].textContent,'−13,500원');assert.equal(n['pay-button'].disabled,true);assert.match(n['amount-note'].textContent,/적용 후/);
  n['coupon-selection'].value='';n['coupon-selection'].events.change();assert.equal(n['payment-amount'].textContent,'45,000원');assert.equal(n['coupon-discount-row'].hidden,true);assert.ok(!ui.calls.some(c=>c.path.includes('checkout')));
});
test('opening coupon becomes ineligible at midnight after November 24 in Korea',async()=>{
  const ui=shop(readyShop,path=>path==='/api/benefits'?{ready:true,points:0,coupons:[openingCoupon],serverTime:'2026-11-25T00:00:00+09:00'}:undefined);await ui.flush();chooseFemale(ui);const n=ui.nodes;
  assert.equal(n['coupon-selection'].children[1].disabled,true);n['coupon-selection'].value=couponId;n['coupon-selection'].events.change();assert.equal(n['payment-amount'].textContent,'35,000원');assert.equal(n['coupon-selection'].value,'');
});
test('MY shows its real opening coupon and complete inclusive use period',async()=>{
  const nodes=await myHistoryScreen({discountsReady:true,coupons:[openingCoupon]});assert.equal(nodes['my-coupon-section'].hidden,false);const card=nodes['my-coupons'].children[0];assert.equal(card.children[0].textContent,'30%');assert.equal(card.children[1].children[0].textContent,'오픈 이벤트 30% 쿠폰');assert.equal(card.children[1].children[1].textContent,'10/24~11/24 사용 · 1회');assert.equal(card.children[1].children[2].textContent,'사용 기간 전');
});
