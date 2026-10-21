import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../worker/index.mjs';
import {previewSchedule} from '../worker/commerce.mjs';
const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;});
const env={SITE_ORIGIN:'https://oneulmaju.rmsj501.chatgpt.site',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',COMMERCE_STORAGE_ENABLED:'true',PAYMENTS_ENABLED:'true',TOSS_CLIENT_KEY:'test-client',TOSS_SECRET_KEY:'test-secret',SUPABASE_SERVICE_ROLE_KEY:'test-service-role'};
const user={id:'11111111-1111-4111-8111-111111111111',phone:'821012345678',phone_confirmed_at:'2026-10-06',email:'test@example.test',user_metadata:{name:'마주'}};
const order={id:'22222222-2222-4222-8222-222222222222',user_id:user.id,event_id:'33333333-3333-4333-8333-333333333333',gender:'여성',amount:24500,status:'pending'};
const receipt={orderId:order.id,paymentKey:'payment-test',totalAmount:order.amount,currency:'KRW',status:'DONE'};
const callback={orderId:order.id,paymentKey:receipt.paymentKey,amount:order.amount};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function request(path,method='GET',body,headers={}){return new Request(env.SITE_ORIGIN+path,{method,headers:{Origin:env.SITE_ORIGIN,Cookie:'__Host-oneul_access=test-access','Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
function mock(handler){const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return handler(url,options);};return calls;}
function payments({actualOrder=order,actualReceipt=receipt,recovery=false,finalStatus='paid'}={}){
  return mock((url,options)=>{
    if(url.endsWith('/auth/v1/user'))return reply(user);
    if(url.includes('/rest/v1/oneul_orders?'))return reply(actualOrder?[actualOrder]:[]);
    if(url.endsWith('/rpc/oneul_begin_payment_confirm'))return reply({id:order.id,status:'confirming'});
    if(url.includes('/v1/payments/orders/'))return reply(recovery?actualReceipt:{code:'NOT_FOUND'},recovery?200:404);
    if(url.endsWith('/v1/payments/confirm'))return reply(actualReceipt);
    if(url.endsWith('/rpc/oneul_finalize_payment'))return reply({id:order.id,status:finalStatus});
    throw new Error('Unexpected URL '+url);
  });
}
test('unconfigured catalog remains selectable preview without remote calls or charging',async()=>{
  const calls=mock(()=>{throw new Error('Unexpected remote call');});
  const data=await (await api(request('/api/catalog'),{})).json();
  assert.equal(data.events[0].event_date,'2026-10-24');assert.equal(data.events[0].male_price,45000);assert.equal(data.events[0].female_price,35000);assert.equal(data.bookingReady,false);assert.equal(data.pricesProvisional,false);
  assert.deepEqual(await (await api(request('/api/reviews'),{})).json(),{reviews:[],ready:false});assert.equal(calls.length,0);
  assert.equal((await api(request('/api/checkout/order','POST',{}),{...env,PAYMENTS_ENABLED:'false'})).status,503);assert.equal(calls.length,0);
});
test('recurring schedules contain two distinct sessions on every Saturday from launch and across year boundaries',()=>{
  const now=new Date('2026-10-08T05:12:00Z'),october=previewSchedule('2026-10',now);
  assert.deepEqual(october.events.map(e=>[e.event_date,e.start_time]),[['2026-10-24','13:00'],['2026-10-24','16:00'],['2026-10-31','13:00'],['2026-10-31','16:00']]);
  assert.deepEqual(october.events.map(e=>e.age_label),['1988~1996년생','1994~2001년생','1988~1996년생','1994~2001년생']);
  for(const month of ['2026-11','2026-12','2027-01','2028-02']){
    const {events}=previewSchedule(month,now),[year,index]=month.split('-').map(Number),days=new Date(Date.UTC(year,index,0)).getUTCDate();const expected=[];
    for(let day=1;day<=days;day++){const date=new Date(Date.UTC(year,index-1,day));if(date.getUTCDay()===6)expected.push(date.toISOString().slice(0,10));}
    assert.deepEqual([...new Set(events.map(e=>e.event_date))],expected);assert.equal(new Set(events.map(e=>e.id)).size,events.length);assert.ok(events.every(e=>e.status==='preparing'));for(const date of expected)assert.deepEqual(events.filter(e=>e.event_date===date).map(e=>e.start_time),['13:00','16:00']);
  }
});
test('preview month requests reject invalid or past ranges, roll forward in Seoul time and never enable payment',async()=>{
  const later=previewSchedule(null,new Date('2026-11-28T15:30:00Z'));assert.equal(later.calendar.month,'2026-12');assert.equal(later.events[0].event_date,'2026-12-05');assert.equal(previewSchedule('2026-11',new Date('2026-11-28T15:30:00Z')),null);
  const calls=mock(()=>{throw new Error('Unexpected provider call');});for(const month of ['2026-09','2026-00','2026-13','invalid'])assert.equal((await api(request('/api/catalog?month='+month),{})).status,400);
  const data=await (await api(request('/api/catalog?month=2027-01'),{})).json();assert.equal(data.calendar.month,'2027-01');assert.equal(data.events.length,10);assert.equal(data.bookingReady,false);assert.equal(data.discountsReady,false);assert.equal(calls.length,0);
});
test('all new writes reject foreign origins before upstream requests',async()=>{
  const calls=mock(()=>{throw new Error('Unexpected remote call');});
  for(const [path,method]of [['/api/account','PUT'],['/api/reviews','POST'],['/api/checkout/order','POST'],['/api/checkout/confirm','POST'],['/api/checkout/cancel','POST']])assert.equal((await api(request(path,method,{}, {Origin:'https://evil.test'}),env)).status,403);
  assert.equal(calls.length,0);
});
const discountEnv={...env,DISCOUNTS_ENABLED:'true'},couponId='55555555-5555-4555-8555-555555555555';
const discounted={...order,event_date:'2026-10-24',customer_key:'44444444-4444-4444-8444-444444444444',gross_amount:24500,coupon_id:couponId,coupon_discount:3000,points_used:1000,amount:20500,payment_kind:'toss'};
const selection={eventId:order.event_id,gender:order.gender,requestId:order.id,couponId,pointsUsed:1000};
test('benefits are disabled before setup and fetched through the own session without a phone gate',async()=>{
  let calls=mock(()=>{throw new Error('must not fetch');});assert.deepEqual(await (await api(request('/api/benefits'),env)).json(),{ready:false,coupons:[],points:null});assert.equal(calls.length,0);
  calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{points:5000,coupons:[{id:couponId}]}));const result=await api(request('/api/benefits?user_id=attacker'),discountEnv);assert.equal(result.status,200);assert.equal((await result.json()).points,5000);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{});assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-access');
  mock(url=>reply(url.endsWith('/auth/v1/user')?{...user,phone_confirmed_at:null,email_confirmed_at:'2026-10-08'}:{points:0,coupons:[]}));assert.equal((await api(request('/api/benefits'),discountEnv)).status,200);
});
test('discounted checkout accepts only selections, derives the net total in DB, and preserves request identity',async()=>{
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:discounted));const result=await api(request('/api/checkout/order','POST',{...selection,amount:1,couponDiscount:999999,balance:999999,user_id:'attacker'}),discountEnv);assert.equal(result.status,200);const data=await result.json();assert.equal(data.order.amount,20500);assert.equal(data.order.pointsUsed,1000);assert.equal(data.order.grossAmount,24500);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{p_event_id:order.event_id,p_gender:order.gender,p_request_id:order.id,p_coupon_id:couponId,p_points_used:1000});
});
test('invalid benefit selections and failed DB ownership or balance checks cannot create successful orders',async()=>{
  for(const change of [{pointsUsed:-1},{pointsUsed:0.5},{pointsUsed:'1000'},{pointsUsed:2147483648},{couponId:'foreign'},{requestId:undefined}]){const calls=mock(url=>reply(user));assert.equal((await api(request('/api/checkout/order','POST',{...selection,...change}),discountEnv)).status,400);assert.ok(!calls.some(c=>c.url.includes('oneul_create_order')));}
  let calls=mock(url=>reply(user));assert.equal((await api(request('/api/checkout/order','POST',selection),env)).status,503);assert.ok(!calls.some(c=>c.url.includes('oneul_create_order')));
  calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{code:'P0001'},url.endsWith('/auth/v1/user')?200:400));const result=await api(request('/api/checkout/order','POST',selection),discountEnv);assert.equal(result.status,400);assert.equal((await result.json()).order,undefined);assert.ok(!calls.some(c=>c.url.includes('tosspayments')));
});
test('inconsistent discount results do not claim a usable order',async()=>{
  for(const change of [{amount:1},{points_used:0},{coupon_id:null},{gross_amount:1},{id:couponId},{status:'canceled'},{coupon_discount:-1}]){mock(url=>reply(url.endsWith('/auth/v1/user')?user:{...discounted,...change}));assert.equal((await api(request('/api/checkout/order','POST',selection),discountEnv)).status,502);}
});
test('zero amount requires a settled benefits order and never calls the payment provider',async()=>{
  const zero={...discounted,points_used:21500,amount:0,status:'paid',payment_kind:'benefits'};const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:zero));const data=await (await api(request('/api/checkout/order','POST',{...selection,pointsUsed:21500}),discountEnv)).json();assert.equal(data.order.amount,0);assert.equal(data.order.status,'paid');assert.equal(data.clientKey,undefined);assert.ok(!calls.some(c=>c.url.includes('tosspayments')));
  for(const change of [{status:'pending'},{payment_kind:'toss'}]){mock(url=>reply(url.endsWith('/auth/v1/user')?user:{...zero,...change}));assert.equal((await api(request('/api/checkout/order','POST',{...selection,pointsUsed:21500}),discountEnv)).status,502);}
  payments({actualOrder:{...order,amount:0,status:'paid'}});const confirmed=await (await api(request('/api/checkout/confirm','POST',{orderId:order.id}),discountEnv)).json();assert.equal(confirmed.paymentKind,'benefits');assert.equal(confirmed.paid,true);
});
test('coupon and point reservations are locked before any gateway approval',async()=>{
  let calls=payments();const result=await api(request('/api/checkout/confirm','POST',callback),discountEnv);assert.equal(result.status,200);const begin=calls.findIndex(c=>c.url.includes('oneul_begin_payment_confirm')),gateway=calls.findIndex(c=>c.url.includes('tosspayments'));assert.ok(begin>0&&begin<gateway);assert.deepEqual(JSON.parse(calls[begin].options.body),{p_order_id:order.id,p_user_id:user.id,p_amount:order.amount});assert.equal(calls[begin].options.headers.Authorization,'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY);
  calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:url.includes('oneul_orders?')?[order]:{code:'P0001'},url.includes('oneul_begin_payment_confirm')?400:200));assert.equal((await api(request('/api/checkout/confirm','POST',callback),discountEnv)).status,400);assert.ok(!calls.some(c=>c.url.includes('tosspayments')));
});
test('canceling a pending application uses own RPC; rejected or incomplete cancellation never claims release',async()=>{
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{id:order.id,status:'canceled'}));const data=await (await api(request('/api/checkout/cancel','POST',{orderId:order.id,user_id:'attacker'}),discountEnv)).json();assert.equal(data.canceled,true);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{p_order_id:order.id});assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-access');
  for(const status of [400,200]){mock(url=>reply(url.endsWith('/auth/v1/user')?user:{id:order.id,status:'paid'},url.endsWith('/auth/v1/user')?200:status));const result=await api(request('/api/checkout/cancel','POST',{orderId:order.id}),discountEnv);assert.equal(result.status,status===400?400:502);assert.equal((await result.json()).canceled,undefined);}
});
test('review and checkout require authenticated verified phone; MY requires authentication',async()=>{
  mock(()=>reply(user));assert.equal((await api(request('/api/my','GET',undefined,{Cookie:''}),env)).status,401);
  mock(()=>reply({...user,phone_confirmed_at:null}));
  for(const path of ['/api/reviews','/api/checkout/order','/api/checkout/confirm'])assert.equal((await api(request(path,'POST',{}),env)).status,403);
});
test('member edits use authenticated identity and do not claim pending email is confirmed',async()=>{
  const calls=mock((url,options)=>reply(options.method==='PUT'?{}:{...user,user_metadata:{name:'수정 이름'}}));
  const result=await api(request('/api/account','PUT',{name:' 수정 이름 ',email:'new@example.test',user_id:'attacker',phone:'01099999999'}),env);
  const data=await result.json();assert.equal(data.updated,true);assert.equal(data.user.id,user.id);assert.equal(data.user.email,user.email);assert.equal(data.emailConfirmationRequired,true);
  const update=calls.find(c=>c.options.method==='PUT');assert.deepEqual(JSON.parse(update.options.body),{data:{name:'수정 이름'},email:'new@example.test'});assert.equal(update.options.headers.Authorization,'Bearer test-access');
});
test('failed or unconfirmed member edits do not report updated',async()=>{
  mock(()=>reply(user));assert.equal((await api(request('/api/account','PUT',{name:'different'}),env)).status,502);
  mock((url,options)=>reply(user,options.method==='PUT'?500:200));assert.equal((await api(request('/api/account','PUT',{name:'different'}),env)).status,503);
});
test('MY balance and orders come from own session RPC, with null balance before setup',async()=>{
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{points:1000,orders:[order],ledger:[]}));
  const data=await (await api(request('/api/my?user_id=attacker'),env)).json();assert.equal(data.points,1000);assert.equal(data.user.id,user.id);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-access');assert.deepEqual(JSON.parse(calls.at(-1).options.body),{});
  const unavailable=await (await api(request('/api/my'),{...env,COMMERCE_STORAGE_ENABLED:'false'})).json();assert.equal(unavailable.points,null);assert.equal(unavailable.commerceReady,false);
});
test('MY history can be connected independently while event preview and real payment remain disabled',async()=>{
  const setting={...env,MY_HISTORY_ENABLED:'true',COMMERCE_STORAGE_ENABLED:'false',PAYMENTS_ENABLED:'false'};
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{points:0,orders:[],ledger:[]}));
  const result=await api(request('/api/my?user_id=attacker'),setting);
  assert.equal(result.status,200);const mine=await result.json();assert.equal(mine.commerceReady,true);assert.equal(mine.points,0);assert.deepEqual(mine.orders,[]);assert.deepEqual(mine.ledger,[]);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{});assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-access');
  const catalog=await (await api(request('/api/catalog'),setting)).json();assert.equal(catalog.bookingReady,false);assert.equal(catalog.events[0].event_date,'2026-10-24');
  const before=calls.length;assert.equal((await api(request('/api/checkout/order','POST',{eventId:order.event_id,gender:'여성'}),setting)).status,503);assert.equal(calls.length,before);
});
test('MY rejects invalid dashboard responses rather than reporting an empty payment or zero points',async()=>{
  for(const broken of [null,{}, {points:null,orders:[],ledger:[]},{points:0,orders:null,ledger:[]},{points:0,orders:[],ledger:null}]){
    mock(url=>reply(url.endsWith('/auth/v1/user')?user:broken));
    const result=await api(request('/api/my'),env);assert.equal(result.status,502);assert.equal((await result.json()).commerceReady,undefined);
  }
});
test('order creation derives amount and customer identity from DB, never client values',async()=>{
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{...order,event_date:'2026-10-24',customer_key:'44444444-4444-4444-8444-444444444444'}));
  const result=await api(request('/api/checkout/order','POST',{eventId:order.event_id,gender:'여성',amount:1,user_id:'attacker',points:999999}),env);assert.equal(result.status,200);
  const data=await result.json();assert.equal(data.order.amount,24500);assert.equal(data.clientKey,env.TOSS_CLIENT_KEY);assert.notEqual(data.customerKey,user.id);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{p_event_id:order.event_id,p_gender:'여성'});assert.ok(!JSON.stringify(data).includes(env.TOSS_SECRET_KEY));assert.ok(!JSON.stringify(data).includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test('foreign orders and wrong callback amounts never reach payment provider',async()=>{
  for(const actualOrder of [null,{...order,user_id:'attacker'}]){const calls=payments({actualOrder});assert.equal((await api(request('/api/checkout/confirm','POST',callback),env)).status,404);assert.ok(!calls.some(c=>c.url.includes('tosspayments')));}
  const calls=payments();assert.equal((await api(request('/api/checkout/confirm','POST',{...callback,amount:1}),env)).status,400);assert.ok(!calls.some(c=>c.url.includes('tosspayments')));
});
test('payment receipt must match amount, order, currency, key and completed state',async()=>{
  for(const change of [{totalAmount:1},{orderId:'foreign'},{currency:'USD'},{paymentKey:'foreign'},{status:'WAITING_FOR_DEPOSIT'}]){
    const calls=payments({actualReceipt:{...receipt,...change}});const result=await api(request('/api/checkout/confirm','POST',callback),env);assert.equal(result.status,400);assert.equal((await result.json()).paid,undefined);assert.ok(!calls.some(c=>c.url.includes('finalize_payment')));
  }
});
test('only a matched completed receipt invokes privileged finalization',async()=>{
  const calls=payments();const result=await api(request('/api/checkout/confirm','POST',callback),env);const data=await result.json();assert.equal(data.paid,true);
  const confirm=calls.find(c=>c.url.endsWith('/v1/payments/confirm'));assert.deepEqual(JSON.parse(confirm.options.body),callback);assert.equal(confirm.options.headers['Idempotency-Key'],order.id);
  const finalize=calls.find(c=>c.url.includes('finalize_payment'));assert.equal(finalize.options.headers.Authorization,'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY);assert.deepEqual(JSON.parse(finalize.options.body),{p_order_id:order.id,p_payment_key:receipt.paymentKey,p_amount:order.amount});
  assert.deepEqual(data,{paid:true,order:{id:order.id,amount:order.amount}});
});
test('payment retries recover a previous provider receipt or paid row without charging again',async()=>{
  for(const body of [callback,{orderId:order.id}]){const calls=payments({recovery:true});assert.equal((await (await api(request('/api/checkout/confirm','POST',body),env)).json()).paid,true);assert.ok(!calls.some(c=>c.url.endsWith('/v1/payments/confirm')));}
  const calls=payments({actualOrder:{...order,status:'paid'}});assert.equal((await (await api(request('/api/checkout/confirm','POST',callback),env)).json()).paid,true);assert.ok(!calls.some(c=>c.url.includes('tosspayments')||c.url.includes('finalize_payment')));
});
test('gateway failures and unfinished DB finalization never claim completed payment',async()=>{
  mock(url=>{if(url.endsWith('/auth/v1/user'))return reply(user);if(url.includes('oneul_orders?'))return reply([order]);throw new Error('offline');});
  let result=await api(request('/api/checkout/confirm','POST',callback),env);assert.equal(result.status,503);assert.equal((await result.json()).paid,undefined);
  payments({finalStatus:'pending'});result=await api(request('/api/checkout/confirm','POST',callback),env);assert.equal(result.status,502);assert.equal((await result.json()).paid,undefined);
});
test('review award comes only from transactional RPC; browser cannot set attendance or points',async()=>{
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?user:{review_id:'review-uuid',points_awarded:1000}));
  const body={orderId:order.id,rating:5,content:'편하게 대화할 수 있어서 좋았어요.',publicConsent:true,points:999999,attended_at:'2026-10-01',user_id:'attacker'};
  const data=await (await api(request('/api/reviews','POST',body),env)).json();assert.equal(data.pointsAwarded,1000);assert.equal(data.posted,true);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{p_order_id:order.id,p_rating:5,p_content:body.content});assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-access');
});
test('duplicate or invalid reviews and incorrect award responses never claim points',async()=>{
  const body={orderId:order.id,rating:5,content:'편하게 대화할 수 있어서 좋았어요.',publicConsent:true};
  mock(url=>reply(url.endsWith('/auth/v1/user')?user:{},url.endsWith('/auth/v1/user')?200:400));assert.equal((await api(request('/api/reviews','POST',body),env)).status,400);
  mock(url=>reply(url.endsWith('/auth/v1/user')?user:{review_id:'review',points_awarded:2000}));const result=await api(request('/api/reviews','POST',body),env);assert.equal(result.status,502);assert.equal((await result.json()).pointsAwarded,undefined);
  for(const change of [{publicConsent:false},{rating:6},{content:'짧음'}])assert.equal((await api(request('/api/reviews','POST',{...body,...change}),env)).status,400);
});
test('member coupons connect during preview while regular prices and all payment guards remain intact',async()=>{
  const setup={...env,MY_HISTORY_ENABLED:'true',COMMERCE_STORAGE_ENABLED:'false',DISCOUNTS_ENABLED:'true',PAYMENTS_ENABLED:'false'};
  const wallet={points:0,server_time:'2026-10-08T12:00:00+09:00',coupons:[{id:couponId,discount_type:'percent',discount_percent:30,starts_at:'2026-10-24T00:00:00+09:00',expires_at:'2026-11-25T00:00:00+09:00'}]};
  const calls=mock(url=>reply(url.endsWith('/auth/v1/user')?{...user,phone:null,phone_confirmed_at:null,email_confirmed_at:'2026-10-08'}:wallet));
  const catalog=await (await api(request('/api/catalog'),setup)).json();assert.equal(catalog.discountsReady,true);assert.equal(catalog.bookingReady,false);assert.equal(catalog.events[0].male_price,45000);assert.equal(catalog.events[0].female_price,35000);assert.equal(calls.length,0);
  const benefits=await (await api(request('/api/benefits'),setup)).json();assert.equal(benefits.ready,true);assert.equal(benefits.coupons[0].discount_percent,30);assert.equal(benefits.serverTime,wallet.server_time);assert.ok(calls.at(-1).url.endsWith('/rpc/oneul_my_benefits'));
  const count=calls.length;assert.equal((await api(request('/api/checkout/order','POST',selection),setup)).status,503);assert.equal(calls.length,count);
});
