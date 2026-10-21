export function previewSchedule(requestedMonth,now=new Date()){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(now),firstDate=[today,'2026-10-24'].sort().at(-1);
  const nextSaturday=new Date(firstDate+'T00:00:00Z');nextSaturday.setUTCDate(nextSaturday.getUTCDate()+(6-nextSaturday.getUTCDay()+7)%7);
  const minMonth=nextSaturday.toISOString().slice(0,7),month=requestedMonth??minMonth;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<minMonth)return null;
  const [year,index]=month.split('-').map(Number),days=new Date(Date.UTC(year,index,0)).getUTCDate(),events=[];
  for(let day=1;day<=days;day++){
    const date=new Date(Date.UTC(year,index-1,day)),eventDate=date.toISOString().slice(0,10);
    if(date.getUTCDay()!==6||eventDate<firstDate)continue;
    for(const time of ['13:00','16:00'])events.push({id:'preview-'+eventDate.replaceAll('-','')+'-'+time.replace(':',''),event_date:eventDate,start_time:time,age_label:time==='13:00'?'1988~1996년생':'1994~2001년생',male_price:45000,female_price:35000,status:'preparing',refund_policy:null});
  }
  return {events,calendar:{weekly:true,minMonth,month}};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storageReady=env=>env.COMMERCE_STORAGE_ENABLED==='true'&&!!env.SUPABASE_URL&&!!env.SUPABASE_PUBLISHABLE_KEY;
const historyReady=env=>(env.MY_HISTORY_ENABLED==='true'||storageReady(env))&&!!env.SUPABASE_URL&&!!env.SUPABASE_PUBLISHABLE_KEY;
const discountsReady=env=>historyReady(env)&&env.DISCOUNTS_ENABLED==='true';
const paymentsReady=env=>storageReady(env)&&env.PAYMENTS_ENABLED==='true'&&!!env.TOSS_CLIENT_KEY&&!!env.TOSS_SECRET_KEY&&!!env.SUPABASE_SERVICE_ROLE_KEY;
export async function commercePublic(request,env,{json,provider}){
  const path=new URL(request.url).pathname;if(request.method!=='GET')return null;
  if(path==='/api/catalog'){
    if(!storageReady(env)){
      const schedule=previewSchedule(new URL(request.url).searchParams.get('month'));
      if(!schedule)return json({error:'선택할 수 있는 달을 확인해주세요.'},400);
      return json({...schedule,bookingReady:false,reviewsReady:false,discountsReady:discountsReady(env),pricesProvisional:false});
    }
    const events=await provider(env,'/rest/v1/oneul_events?select=id,event_date,start_time,age_label,male_price,female_price,status,refund_policy&visible=eq.true&order=event_date.asc,start_time.asc');
    return json({events,bookingReady:paymentsReady(env),reviewsReady:true,discountsReady:discountsReady(env),pricesProvisional:false});
  }
  if(path==='/api/reviews'){
    if(!storageReady(env))return json({reviews:[],ready:false});
    const reviews=await provider(env,'/rest/v1/rpc/oneul_public_reviews',{method:'POST',body:{}});return json({reviews,ready:true});
  }
  return null;
}
async function toss(env,path,{method='GET',body,idempotencyKey}={},fail){
  let response;
  try{response=await fetch('https://api.tosspayments.com'+path,{method,headers:{Authorization:'Basic '+btoa(env.TOSS_SECRET_KEY+':'),'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
  catch{fail(503,'결제 서비스의 응답을 확인하지 못했어요. 같은 주문으로 다시 확인해주세요.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok)fail(response.status>=500?503:400,'결제 상태를 확인하지 못했어요. 결제 내역을 확인하고 같은 주문으로 다시 시도해주세요.');
  return data;
}
export async function commerce(request,env,c){
  const {json,provider,identity,verifiedIdentity,bodyOf,fail,summary,headers}=c,path=new URL(request.url).pathname;
  if(path==='/api/account'&&request.method==='PUT'){
    const {user,token}=await identity(request,env,headers),b=await bodyOf(request),name=String(b.name||'').trim();
    if(!name||name.length>30)fail(400,'이름을 30자 이내로 입력해주세요.');
    const change={data:{name}};let emailChanged=false;
    if(b.email!==undefined){const email=String(b.email).trim().toLowerCase();if(!user.email)fail(400,'이메일 회원 정보는 회원가입 후 변경할 수 있어요.');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail(400,'이메일을 확인해주세요.');if(email!==user.email.toLowerCase()){change.email=email;emailChanged=true;}}
    await provider(env,'/auth/v1/user?redirect_to='+encodeURIComponent(env.SITE_ORIGIN+'/my/account/'),{method:'PUT',token,body:change});
    const fresh=await provider(env,'/auth/v1/user',{token});if(String(fresh.user_metadata?.name||'')!==name)fail(502,'회원정보 수정 결과를 확인하지 못했어요.');
    return json({updated:true,user:summary(fresh),emailConfirmationRequired:emailChanged&&fresh.email?.toLowerCase()!==change.email});
  }
  if(path==='/api/my'&&request.method==='GET'){
    const {user,token}=await identity(request,env,headers);
    if(!historyReady(env))return json({user:summary(user),commerceReady:false,points:null,orders:[],ledger:[]});
    const result=await provider(env,'/rest/v1/rpc/oneul_my_dashboard',{method:'POST',token,body:{}});
    if(!Number.isSafeInteger(result?.points)||result.points<0||!Array.isArray(result?.orders)||!Array.isArray(result?.ledger))fail(502,'신청·포인트 내역을 확인하지 못했어요. 잠시 후 다시 확인해주세요.');
    return json({user:summary(user),commerceReady:true,discountsReady:discountsReady(env),...result});
  }
  if(path==='/api/benefits'&&request.method==='GET'){
    if(!discountsReady(env))return json({ready:false,coupons:[],points:null});
    const {token}=await identity(request,env,headers);
    const result=await provider(env,'/rest/v1/rpc/oneul_my_benefits',{method:'POST',token,body:{}});
    if(!Number.isInteger(result?.points)||result.points<0||!Array.isArray(result?.coupons))fail(502,'보유 쿠폰·포인트를 확인하지 못했어요.');
    return json({ready:true,points:result.points,coupons:result.coupons,serverTime:result.server_time});
  }
  if(path==='/api/reviews'&&request.method==='POST'){
    if(!storageReady(env))fail(503,'후기·포인트 서비스를 준비 중이에요. 아직 후기가 게시되거나 포인트가 지급되지 않아요.','reviews_setup_required');
    const {token}=await verifiedIdentity(request,env,headers),b=await bodyOf(request),content=String(b.content||'').trim();
    if(!UUID.test(b.orderId||'')||!Number.isInteger(b.rating)||b.rating<1||b.rating>5||content.length<10||content.length>1000||b.publicConsent!==true)fail(400,'참가 일정, 별점, 후기와 공개 동의를 확인해주세요.');
    const result=await provider(env,'/rest/v1/rpc/oneul_submit_review',{method:'POST',token,body:{p_order_id:b.orderId,p_rating:b.rating,p_content:content}});
    if(result?.points_awarded!==1000||!result?.review_id)fail(502,'후기 등록·포인트 적립 결과를 확인하지 못했어요. MY에서 내역을 확인해주세요.');
    return json({posted:true,pointsAwarded:1000,reviewId:result.review_id});
  }
  if(path==='/api/checkout/order'&&request.method==='POST'){
    if(!paymentsReady(env))fail(503,'결제 오픈을 준비 중이에요. 아직 결제가 진행되지 않아요.','payment_setup_required');
    const {token}=await verifiedIdentity(request,env,headers),b=await bodyOf(request);
    if(!UUID.test(b.eventId||'')||!['남성','여성'].includes(b.gender))fail(400,'성별과 참가 일정을 확인해주세요.');
    const couponId=b.couponId??null,pointsUsed=b.pointsUsed??0,withDiscounts=discountsReady(env);
    if((couponId!==null&&!UUID.test(couponId))||!Number.isInteger(pointsUsed)||pointsUsed<0||pointsUsed>2147483647)fail(400,'쿠폰과 사용할 포인트를 확인해주세요.');
    if(!withDiscounts&&(couponId||pointsUsed))fail(503,'쿠폰·포인트 사용 연결을 준비 중이에요.','discounts_setup_required');
    if(withDiscounts&&!UUID.test(b.requestId||''))fail(400,'신청 정보를 새로 확인해주세요.');
    let result;
    try{result=await provider(env,'/rest/v1/rpc/oneul_create_order',{method:'POST',token,body:{p_event_id:b.eventId,p_gender:b.gender,...(withDiscounts?{p_request_id:b.requestId,p_coupon_id:couponId,p_points_used:pointsUsed}:{})}});}
    catch(error){if(error.status===400)fail(400,'일정 또는 보유 혜택이 변경됐어요. MY의 결제 대기 신청과 보유 내역을 확인해주세요.');throw error;}
    if(!UUID.test(result?.id||'')||!UUID.test(result?.customer_key||'')||!Number.isInteger(result?.amount)||result.event_id!==b.eventId||result.gender!==b.gender||result.amount<(withDiscounts?0:1))fail(502,'주문 정보를 확인하지 못했어요.');
    if(withDiscounts&&(result.id!==b.requestId||!Number.isInteger(result.gross_amount)||result.gross_amount<=0||!Number.isInteger(result.coupon_discount)||result.coupon_discount<0||result.points_used!==pointsUsed||result.coupon_id!==couponId||result.gross_amount!==result.amount+result.coupon_discount+result.points_used||!['pending','paid'].includes(result.status)||(result.amount===0&&(result.status!=='paid'||result.payment_kind!=='benefits'))))fail(502,'할인 적용 결과를 확인하지 못했어요. MY에서 신청 내역을 확인해주세요.');
    return json({order:{id:result.id,amount:result.amount,eventId:result.event_id,gender:result.gender,status:result.status||'pending',orderName:'오늘마주 '+result.event_date+' 소개팅',...(withDiscounts?{grossAmount:result.gross_amount,couponDiscount:result.coupon_discount,pointsUsed:result.points_used,paymentKind:result.payment_kind}:{})},...(result.amount>0?{clientKey:env.TOSS_CLIENT_KEY,customerKey:result.customer_key}:{})});
  }
  if(path==='/api/checkout/cancel'&&request.method==='POST'){
    if(!discountsReady(env))fail(503,'신청 변경 연결을 준비 중이에요.','discounts_setup_required');
    const {token}=await verifiedIdentity(request,env,headers),b=await bodyOf(request);if(!UUID.test(b.orderId||''))fail(400,'신청 정보를 확인해주세요.');
    let result;try{result=await provider(env,'/rest/v1/rpc/oneul_cancel_pending_order',{method:'POST',token,body:{p_order_id:b.orderId}});}catch(error){if(error.status===400)fail(400,'결제 확인 중이거나 완료된 신청은 여기서 변경할 수 없어요. MY에서 결제 상태를 확인해주세요.');throw error;}
    if(result?.id!==b.orderId||result?.status!=='canceled')fail(502,'신청 변경 결과를 확인하지 못했어요.');
    return json({canceled:true});
  }
  if(path==='/api/checkout/confirm'&&request.method==='POST'){
    if(!paymentsReady(env))fail(503,'결제 확인 연결을 준비 중이에요. MY에서 신청 내역을 확인해주세요.','payment_setup_required');
    const {user,token}=await verifiedIdentity(request,env,headers),b=await bodyOf(request);
    if(!UUID.test(b.orderId||''))fail(400,'주문 정보를 확인해주세요.');
    const rows=await provider(env,'/rest/v1/oneul_orders?id=eq.'+encodeURIComponent(b.orderId)+'&user_id=eq.'+encodeURIComponent(user.id)+'&select=id,user_id,event_id,gender,amount,status',{token});
    const order=rows?.[0];if(!order||order.user_id!==user.id)fail(404,'나의 주문 정보를 찾을 수 없어요.');
    if(order.status==='canceled')fail(400,'취소된 주문이에요. 결제 내역을 확인해주세요.');
    if(order.status==='paid')return json({paid:true,order:{id:order.id,amount:order.amount},...(order.amount===0?{paymentKind:'benefits'}:{})});
    if(b.amount!==undefined&&(!Number.isInteger(b.amount)||b.amount!==order.amount))fail(400,'결제 금액이 주문 금액과 일치하지 않아요.');
    if(b.paymentKey!==undefined&&(typeof b.paymentKey!=='string'||b.paymentKey.length<1||b.paymentKey.length>200||b.amount===undefined))fail(400,'결제 확인 정보를 확인해주세요.');
    if(discountsReady(env)){
      // Reserve the order against cancellation before requesting gateway approval.
      const begun=await provider(env,'/rest/v1/rpc/oneul_begin_payment_confirm',{method:'POST',token:env.SUPABASE_SERVICE_ROLE_KEY,body:{p_order_id:order.id,p_user_id:user.id,p_amount:order.amount}});
      if(begun?.id!==order.id||!['confirming','paid'].includes(begun?.status))fail(502,'신청의 결제 확인 상태를 저장하지 못했어요.');
      if(begun.status==='paid')return json({paid:true,order:{id:order.id,amount:order.amount}});
    }
    let receipt;
    if(b.paymentKey!==undefined){
      // A query first recovers a successful confirm whose response was lost.
      const prior=await toss(env,'/v1/payments/orders/'+encodeURIComponent(order.id),{},fail).catch(()=>null);
      if(prior?.status==='DONE')receipt=prior;
      else receipt=await toss(env,'/v1/payments/confirm',{method:'POST',body:{paymentKey:b.paymentKey,orderId:order.id,amount:order.amount},idempotencyKey:order.id},fail);
    }else receipt=await toss(env,'/v1/payments/orders/'+encodeURIComponent(order.id),{},fail);
    if(receipt?.status!=='DONE'||receipt?.orderId!==order.id||receipt?.totalAmount!==order.amount||receipt?.currency!=='KRW'||typeof receipt?.paymentKey!=='string'||(b.paymentKey&&receipt.paymentKey!==b.paymentKey))fail(400,'결제 완료 정보를 확인하지 못했어요.');
    const paid=await provider(env,'/rest/v1/rpc/oneul_finalize_payment',{method:'POST',token:env.SUPABASE_SERVICE_ROLE_KEY,body:{p_order_id:order.id,p_payment_key:receipt.paymentKey,p_amount:order.amount}});
    if(paid?.status!=='paid'||paid?.id!==order.id)fail(502,'결제 후 신청 내역 저장을 확인 중이에요. 같은 주문으로 다시 확인해주세요.');
    return json({paid:true,order:{id:order.id,amount:order.amount}});
  }
  return null;
}
