(() => {
  'use strict';
  const openingBanner=document.getElementById('opening-coupon');if(openingBanner)openingBanner.hidden=Date.now()>=Date.parse('2026-11-25T00:00:00+09:00');
  const $=id=>document.getElementById(id),api=window.OneulAPI;
  const won=value=>new Intl.NumberFormat('ko-KR').format(value)+'원';
  const dateLabel=value=>new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(new Date(value+'T12:00:00+09:00'));
  const timeLabel=value=>{const match=/^(\d{2}):(\d{2})$/.exec(value||'');if(!match)return value||'시간 확정 후 안내';const hour=Number(match[1]);return (hour<12?'오전 ':'오후 ')+(hour%12||12)+'시'+(match[2]==='00'?'':' '+Number(match[2])+'분');};
  let catalog={events:[],bookingReady:false,reviewsReady:false,pricesProvisional:true},gender='',selected=null,selectedDate='',month='2026-10',order=null,widgets=null,paymentSetup=null,attemptId=null,busy=false;
  let benefits={ready:false,coupons:[],points:null,clockOffset:0},benefitsMessage='로그인 후 보유 쿠폰·포인트를 확인할 수 있어요.';
  let calendarLoading=false;
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  const readyAmount=()=>selected&&gender?Number(selected[gender==='남성'?'male_price':'female_price']):null;
  const couponPeriod=coupon=>{const format=value=>new Intl.DateTimeFormat('en-US',{month:'numeric',day:'numeric',timeZone:'Asia/Seoul'}).format(new Date(value));return format(coupon.starts_at)+'~'+format(new Date(new Date(coupon.expires_at).getTime()-1));};
  const couponAvailable=coupon=>{const now=Date.now()+benefits.clockOffset;return new Date(coupon.starts_at).getTime()<=now&&now<new Date(coupon.expires_at).getTime();};
  const couponEligible=(coupon,gross)=>couponAvailable(coupon)&&Number.isInteger(gross)&&gross>=coupon.min_amount;
  const price=()=>{
    const gross=readyAmount(),coupon=benefits.ready?benefits.coupons.find(c=>c.id===$('coupon-selection').value&&couponEligible(c,gross)):null;
    const couponDiscount=coupon?Math.min(gross,coupon.discount_type==='percent'?Math.floor(gross*coupon.discount_percent/100):coupon.discount_amount):0;
    const input=Number($('points-input').value),maximum=benefits.ready&&gross?Math.min(benefits.points,gross-couponDiscount):0;
    const pointsUsed=Number.isFinite(input)?Math.min(Math.max(0,Math.floor(input)),maximum):0;
    return {gross,couponId:coupon?.id||null,couponDiscount,pointsUsed,maximum,amount:gross===null?null:gross-couponDiscount-pointsUsed};
  };
  function renderBenefits(){
    const previous=$('coupon-selection').value,gross=readyAmount();$('coupon-selection').replaceChildren();
    const empty=node('option','쿠폰 사용 안 함');empty.value='';$('coupon-selection').append(empty);
    for(const coupon of benefits.coupons){const discount=coupon.discount_type==='percent'?coupon.discount_percent+'%':won(coupon.discount_amount);const option=node('option',discount+' 할인 · '+couponPeriod(coupon)+' 사용'+(coupon.min_amount?' · '+won(coupon.min_amount)+' 이상':''));option.value=coupon.id;option.disabled=!couponEligible(coupon,gross);$('coupon-selection').append(option);}
    $('coupon-selection').value=benefits.coupons.some(c=>c.id===previous&&couponEligible(c,gross))?previous:'';
    const quote=price();$('points-input').value=String(quote.pointsUsed);$('points-input').max=String(quote.maximum);
    const disabled=busy||!!order||!benefits.ready||!gross;
    $('coupon-selection').disabled=disabled||!benefits.coupons.length;$('points-input').disabled=disabled||!quote.maximum;$('use-all-points').disabled=disabled||!quote.maximum;
    $('points-balance').textContent=benefits.ready?'사용 가능 '+benefits.points.toLocaleString('ko-KR')+' P':'보유 — P';
    const future=benefits.coupons.find(c=>new Date(c.starts_at).getTime()>Date.now()+benefits.clockOffset);
    $('benefits-note').textContent=order?'결제 대기 중인 쿠폰·포인트는 보관돼요. 선택 변경 시 해제돼요.':future?future.title+'이 지급됐어요. '+couponPeriod(future)+' 가능해요.':benefitsMessage;
    $('discount-total').textContent=benefits.ready&&benefits.coupons.length?'보유 '+benefits.coupons.length+'장':'선택';
  }
  async function loadBenefits(){
    if(!catalog.discountsReady)return;
    try{const data=await api('/api/benefits');if(data.ready!==true||!Number.isInteger(data.points)||data.points<0||!Array.isArray(data.coupons))throw new Error('보유 혜택을 확인하지 못했어요.');
      benefits={ready:true,points:data.points,clockOffset:Number.isFinite(Date.parse(data.serverTime))?Date.parse(data.serverTime)-Date.now():0,coupons:data.coupons.filter(c=>typeof c.id==='string'&&typeof c.title==='string'&&Number.isFinite(Date.parse(c.starts_at))&&Number.isFinite(Date.parse(c.expires_at))&&Date.parse(c.starts_at)<Date.parse(c.expires_at)&&Number.isInteger(c.min_amount)&&c.min_amount>=0&&(c.discount_type==='percent'?Number.isInteger(c.discount_percent)&&c.discount_percent>0&&c.discount_percent<=100:c.discount_type==='fixed'&&Number.isInteger(c.discount_amount)&&c.discount_amount>0))};
      benefitsMessage=benefits.coupons.length?'1P = 1원 · 쿠폰과 함께 사용할 수 있어요.':'보유 쿠폰이 없어요. 1P = 1원으로 사용할 수 있어요.';
    }catch(error){benefits={ready:false,coupons:[],points:null,clockOffset:0};benefitsMessage=error.status===401?'로그인 후 보유 쿠폰·포인트를 확인할 수 있어요.':error.status===403?'이메일 인증 후 보유 쿠폰·포인트를 확인할 수 있어요.':error.message;}
    renderSelection();
  }
  const renderDateBar=()=>{
    $('date-selection-value').textContent=selectedDate?dateLabel(selectedDate):catalog.events.length?'일자를 선택해주세요':'선택 가능한 일정이 아직 없어요';
    $('date-selection-toggle').setAttribute('data-selected',String(!!selectedDate));
    $('date-selection-action').textContent=!$('booking-calendar').hidden?'닫기':selectedDate?'변경':'선택';
  };
  function setCalendarOpen(open,returnFocus=false){
    if(open&&$('date-selection-toggle').disabled)return;
    if(open){if(selectedDate)month=selectedDate.slice(0,7);renderCalendar();}
    $('booking-calendar').hidden=!open;$('date-selection-toggle').setAttribute('aria-expanded',String(open));renderDateBar();
    if(returnFocus)$('date-selection-toggle').focus();
  }
  $('date-selection-toggle').addEventListener('click',()=>setCalendarOpen($('booking-calendar').hidden));
  $('booking-calendar').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();setCalendarOpen(false,true);}});
  const renderSelection=()=>{
    renderBenefits();const {gross,amount,couponDiscount,pointsUsed}=price();$('payment-amount').textContent=Number.isInteger(amount)?won(amount):'— 원';
    $('amount-label').textContent='정가';
    $('payment-total-label').textContent='결제 금액';
    const selectionNote=!gender?'성별을 선택해주세요.':!selectedDate?'일자를 선택해주세요.':!selected?'시간을 선택해주세요.':'';
    $('amount-note').textContent=gross?couponDiscount||pointsUsed?'쿠폰·포인트 적용 후 금액이에요.':'쿠폰·포인트 적용 전 금액이에요.':selectionNote;$('amount-note').hidden=!$('amount-note').textContent;
    $('gross-amount').textContent=gross?won(gross):'— 원';$('coupon-discount').textContent='−'+won(couponDiscount);$('points-discount').textContent='−'+pointsUsed.toLocaleString('ko-KR')+'P';
    $('price-breakdown').hidden=!gross;$('coupon-discount-row').hidden=!couponDiscount;$('points-discount-row').hidden=!pointsUsed;
    if(couponDiscount||pointsUsed)$('discount-total').textContent='−'+won(couponDiscount+pointsUsed);
    renderDateBar();$('selected-event').hidden=!selectedDate;
    $('selected-event').textContent=selected?[timeLabel(selected.start_time),selected.age_label||'회차별 조건 확정 후 안내'].join(' · '):'참가할 시간을 선택해주세요.';
    $('refund-policy').textContent=selected?.refund_policy||'회차별 취소·환불 조건은 모집 오픈 시 안내해요. 지금은 실제 결제를 받지 않아요.';
    $('pay-button').disabled=busy||order?.status==='paid'||!gross||!catalog.bookingReady||selected?.status!=='open';
    $('pay-button').textContent=order?.status==='paid'?'신청 완료':!gross?selectionNote.replace('.',''):!catalog.bookingReady||selected.status!=='open'?'결제 오픈 준비 중':amount===0?'혜택 사용하고 신청하기':won(amount)+' 결제하기';
  };
  const invalidatePayment=()=>{order=null;widgets=null;paymentSetup=null;attemptId=null;$('change-booking').hidden=true;$('payment-methods').hidden=true;$('payment-agreement').hidden=true;$('payment-methods').replaceChildren();$('payment-agreement').replaceChildren();$('booking-error').textContent='';};
  const lockBooking=locked=>{for(const input of document.querySelectorAll('[name="booking-gender"]'))input.disabled=locked;$('date-selection-toggle').disabled=locked||!catalog.events.length;if(locked)setCalendarOpen(false);$('calendar-days').querySelectorAll('button').forEach(input=>input.disabled=locked);$('time-options').querySelectorAll('button').forEach(input=>input.disabled=locked);if(locked){$('previous-month').disabled=true;$('next-month').disabled=true;}else renderCalendar();renderBenefits();};
  function chooseDate(date){
    if(busy||order||calendarLoading)return;
    selectedDate=date;const candidates=catalog.events.filter(e=>e.event_date===date);selected=candidates.length===1?candidates[0]:null;
    $('time-options').replaceChildren();$('time-options').hidden=candidates.length<2;$('booking-time-selection').hidden=candidates.length<2;
    for(const event of candidates){const button=node('button',timeLabel(event.start_time));button.type='button';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{if(busy||order||calendarLoading)return;selected=event;for(const sibling of $('time-options').children)sibling.setAttribute('aria-pressed',String(sibling===button));invalidatePayment();renderSelection();});$('time-options').append(button);}
    invalidatePayment();renderCalendar();renderSelection();setCalendarOpen(false,true);
  }
  function renderCalendar(){
    const [year,index]=month.split('-').map(Number),offset=new Date(Date.UTC(year,index-1,1)).getUTCDay(),days=new Date(Date.UTC(year,index,0)).getUTCDate();
    $('calendar-month').textContent=year+'년 '+index+'월';$('calendar-days').replaceChildren();
    const months=[...new Set(catalog.events.map(e=>e.event_date.slice(0,7)))].sort(),locked=busy||!!order||calendarLoading;
    $('previous-month').disabled=locked||(catalog.calendar?.weekly?month<=catalog.calendar.minMonth:!months.some(m=>m<month));$('next-month').disabled=locked||(catalog.calendar?.weekly?month==='9999-12':!months.some(m=>m>month));
    let row;for(let cell=0;cell<Math.ceil((offset+days)/7)*7;cell++){
      if(cell%7===0){row=node('tr');$('calendar-days').append(row);}const td=node('td');row.append(td);const day=cell-offset+1;if(day<1||day>days)continue;
      const date=month+'-'+String(day).padStart(2,'0');if(catalog.events.some(e=>e.event_date===date)){
        const button=node('button',String(day));button.type='button';button.disabled=locked;button.setAttribute('aria-label',dateLabel(date)+' 소개팅 일정');button.setAttribute('aria-pressed',String(date===selectedDate));button.addEventListener('click',()=>chooseDate(date));td.append(button);
      }else td.append(node('span',String(day)));
    }
  }
  async function moveMonth(direction){
    if(busy||order||calendarLoading)return;
    if(!catalog.calendar?.weekly){const months=[...new Set(catalog.events.map(e=>e.event_date.slice(0,7)))].sort();const choices=months.filter(m=>direction<0?m<month:m>month);if(!choices.length)return;month=direction<0?choices.at(-1):choices[0];renderCalendar();return;}
    const [year,index]=month.split('-').map(Number),next=new Date(Date.UTC(year,index-1+direction,1)).toISOString().slice(0,7);if(next<catalog.calendar.minMonth||!/^\d{4}-\d{2}$/.test(next))return;
    calendarLoading=true;$('booking-error').textContent='';renderCalendar();
    try{const data=await api('/api/catalog?month='+next);if(data.calendar?.weekly!==true||data.calendar.month!==next||!Array.isArray(data.events))throw new Error('일정을 확인하지 못했어요. 다시 시도해주세요.');catalog.events=[...catalog.events.filter(event=>event.event_date.slice(0,7)!==next),...data.events];catalog.calendar=data.calendar;month=next;}
    catch(error){$('booking-error').textContent=error.message;}
    finally{calendarLoading=false;renderCalendar();}
  }
  $('previous-month').addEventListener('click',()=>moveMonth(-1));$('next-month').addEventListener('click',()=>moveMonth(1));
  for(const input of document.querySelectorAll('[name="booking-gender"]'))input.addEventListener('change',()=>{gender=input.value;invalidatePayment();renderSelection();});
  $('coupon-selection').addEventListener('change',()=>{invalidatePayment();renderSelection();});
  $('points-input').addEventListener('input',()=>{invalidatePayment();renderSelection();});
  $('use-all-points').addEventListener('click',()=>{if($('use-all-points').disabled)return;$('points-input').value=String(price().maximum);invalidatePayment();renderSelection();});
  $('change-booking').addEventListener('click',async()=>{
    if(!order||busy)return;busy=true;const button=$('change-booking');button.disabled=true;$('booking-error').textContent='';renderSelection();
    try{const data=await api('/api/checkout/cancel',{orderId:order.id});if(data.canceled!==true)throw new Error('신청 변경 결과를 확인하지 못했어요. MY에서 내역을 확인해주세요.');invalidatePayment();busy=false;lockBooking(false);await loadBenefits();renderSelection();}
    catch(error){$('booking-error').textContent=error.message;}
    finally{busy=false;button.disabled=false;renderSelection();}
  });
  async function loadSDK(){if(window.TossPayments)return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://js.tosspayments.com/v2/standard';script.onload=resolve;script.onerror=()=>reject(new Error('결제 화면을 불러오지 못했어요. 다시 시도해주세요.'));document.head.append(script);});}
  $('pay-button').addEventListener('click',async()=>{
    if(!catalog.bookingReady||!selected||!gender||busy)return;const button=$('pay-button');busy=true;button.disabled=true;lockBooking(true);$('booking-error').textContent='';
    try{
      if(!order){
        const quote=price();attemptId=attemptId||crypto.randomUUID();
        const data=await api('/api/checkout/order',{eventId:selected.id,gender,requestId:attemptId,couponId:quote.couponId,pointsUsed:quote.pointsUsed});
        order=data.order;paymentSetup=data;$('change-booking').hidden=order?.status==='paid'||!catalog.discountsReady;
        if(order?.amount!==quote.amount||order?.eventId!==selected.id||order?.gender!==gender)throw new Error('신청 일정 또는 참가비가 변경됐어요. 선택 변경 후 다시 확인해주세요.');
        if(order.status==='paid'){window.location.assign('/checkout/success/?orderId='+encodeURIComponent(order.id));return;}
      }
      if(!widgets){
        await loadSDK();const nextWidgets=window.TossPayments(paymentSetup.clientKey).widgets({customerKey:paymentSetup.customerKey});await nextWidgets.setAmount({currency:'KRW',value:order.amount});
        $('payment-methods').hidden=false;$('payment-agreement').hidden=false;
        await Promise.all([nextWidgets.renderPaymentMethods({selector:'#payment-methods'}),nextWidgets.renderAgreement({selector:'#payment-agreement'})]);widgets=nextWidgets;
        button.textContent=won(order.amount)+' 결제하기';$('payment-methods').scrollIntoView({block:'center'});
      }else await widgets.requestPayment({orderId:order.id,orderName:order.orderName,successUrl:window.location.origin+'/checkout/success/',failUrl:window.location.origin+'/checkout/fail/'});
    }catch(error){$('booking-error').textContent=error.status===401?'로그인 또는 비회원 휴대폰 인증 후 결제할 수 있어요. MY에서 시작해주세요.':error.message;}
    finally{busy=false;if(!order)lockBooking(false);renderSelection();}
  });
  async function loadReviews(){
    const data=await api('/api/reviews');$('review-list').replaceChildren();
    if(!data.ready){$('review-summary').textContent='오픈 준비 중';$('review-list').append(node('p','후기 게시판을 준비 중이에요. 아래에서 작성 화면을 미리 확인할 수 있어요.','empty-state'));return;}
    const reviews=data.reviews||[],average=reviews.length?(reviews.reduce((sum,r)=>sum+r.rating,0)/reviews.length).toFixed(1):'—';$('review-summary').textContent=average+' · 후기 '+reviews.length+'개';
    if(!reviews.length)$('review-list').append(node('p','아직 등록된 후기가 없어요. 첫 번째 후기를 남겨주세요.','empty-state'));
    for(const review of reviews){const article=node('article',undefined,'review-card'),header=node('header');header.append(node('span',review.author_label),node('span',review.created_at.slice(0,10)));article.append(header,node('div','★'.repeat(review.rating)+'☆'.repeat(5-review.rating),'review-stars'),node('p',review.content),node('small',dateLabel(review.event_date)+' 참가 후기'));$('review-list').append(article);}
  }
  let eligible=[];
  $('write-review').addEventListener('click',async()=>{
    $('review-editor').hidden=false;$('review-status').textContent='';$('review-error').textContent='';$('review-preview').hidden=true;$('submit-review').disabled=false;eligible=[];
    if(catalog.reviewsReady){try{const mine=await api('/api/my');eligible=(mine.orders||[]).filter(o=>o.status==='paid'&&o.attended_at&&!o.review_written);}catch{}}
    $('review-order').replaceChildren();for(const item of eligible){const option=node('option',dateLabel(item.event_date)+' · '+item.gender);option.value=item.id;$('review-order').append(option);}
    const requested=new URLSearchParams(window.location.search).get('reviewOrder');if(eligible.some(o=>o.id===requested))$('review-order').value=requested;
    $('review-order-field').hidden=!eligible.length;$('submit-review').textContent=eligible.length?'후기 등록 · 1,000P 적립':'작성 내용 미리보기';
    $('review-write-note').textContent=eligible.length?'등록하면 후기가 공개되고 1,000P가 적립돼요. 같은 참가 건은 한 번만 지급돼요.':'현재는 작성 화면을 미리 볼 수 있어요. 실제 등록·포인트 적립은 로그인하고 참가를 완료한 뒤 가능해요.';
    $('review-editor').scrollIntoView({block:'start'});$('review-content').focus();
  });
  $('close-review').addEventListener('click',()=>{$('review-editor').hidden=true;$('write-review').focus();});
  $('review-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!$('review-form').reportValidity())return;
    const data=new FormData($('review-form')),content=String(data.get('content')||'').trim();if(content.length<10){$('review-error').textContent='후기를 10자 이상 작성해주세요.';return;}
    if(!eligible.length){$('review-preview-content').textContent=content;$('review-preview').hidden=false;$('review-status').textContent='작성한 내용의 미리보기예요. 후기는 게시되지 않았고 포인트도 지급되지 않았어요.';return;}
    $('submit-review').disabled=true;$('review-error').textContent='';
    try{const result=await api('/api/reviews',{orderId:data.get('orderId'),rating:Number(data.get('rating')),content,publicConsent:$('review-consent').checked});if(!result.posted)throw new Error('후기 등록 결과를 확인하지 못했어요.');eligible=[];$('submit-review').disabled=true;$('review-status').textContent='후기가 등록됐고 '+result.pointsAwarded.toLocaleString('ko-KR')+'P가 적립됐어요. MY에서 확인할 수 있어요.';await loadReviews();}
    catch(error){$('review-error').textContent=error.message;$('submit-review').disabled=false;}
  });
  (async()=>{try{catalog=await api('/api/catalog');if(catalog.calendar?.month)month=catalog.calendar.month;else if(catalog.events.length)month=catalog.events[0].event_date.slice(0,7);$('date-selection-toggle').disabled=!catalog.events.length;renderCalendar();renderSelection();await Promise.all([loadBenefits(),loadReviews()]);if(new URLSearchParams(window.location.search).has('reviewOrder'))$('write-review').click();}catch(error){$('booking-error').textContent=error.message;renderCalendar();}})();
})();
