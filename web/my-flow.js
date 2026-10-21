(() => {
  'use strict';const $=id=>document.getElementById(id),api=window.OneulAPI;
  const previewKey='oneulmaju-account-preview-draft';let user=null;
  const domestic=value=>String(value||'').replace(/^\+?82/,'0');
  const node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text||'';if(className)el.className=className;return el;};
  const money=value=>new Intl.NumberFormat('ko-KR').format(value)+'원';
  const statuses={pending:'결제 대기',confirming:'결제 확인 중',paid:'결제 완료',canceled:'취소됨'};
  async function myPage(){
    const ready=await window.OneulReady;if(!ready.accountsReady){$('my-notice').textContent='현재는 화면 미리보기 단계예요. 회원정보와 프로필 수정 화면을 확인해볼 수 있어요.';return;}
    try{
      const mine=await api('/api/my');user=mine.user;$('my-name').textContent=user.name?user.name+'님, 반가워요.':'나의 오늘마주';$('my-account-summary').textContent=user.mode==='guest'?'휴대폰 인증으로 이용 중이에요.':user.email;$('my-access').hidden=true;$('logout').hidden=false;$('my-profile-link').href='/profile/';
      $('my-notice').textContent=mine.commerceReady?'나의 신청·포인트 내역을 확인하고 회원정보를 수정할 수 있어요.':'회원정보·프로필 수정은 이용할 수 있어요. 신청·포인트 서비스를 준비 중이에요.';
      $('my-points').textContent=mine.points===null?'— P':mine.points.toLocaleString('ko-KR')+' P';$('my-orders').replaceChildren();$('my-ledger').replaceChildren();$('my-pending-orders').replaceChildren();
      $('my-points-note').textContent=mine.reservedPoints?'대기 신청에 보관 중인 '+mine.reservedPoints.toLocaleString('ko-KR')+'P를 제외한 사용 가능 포인트예요.':'참가 후기 작성하면 1,000P 적립';
      $('my-coupon-section').hidden=!mine.discountsReady;$('my-coupons').replaceChildren();
      const coupons=mine.coupons||[];
      if(!coupons.length)$('my-coupons').append(node('p','보유 쿠폰이 없어요.','empty-state'));
      for(const coupon of coupons){
        const format=value=>new Intl.DateTimeFormat('en-US',{month:'numeric',day:'numeric',timeZone:'Asia/Seoul'}).format(new Date(value));
        const card=node('article',undefined,'coupon-card'),detail=node('div');
        card.append(node('strong',coupon.discount_type==='percent'?coupon.discount_percent+'%':money(coupon.discount_amount)));
        detail.append(node('p',coupon.title),node('small',format(coupon.starts_at)+'~'+format(new Date(Date.parse(coupon.expires_at)-1))+' 사용 · 1회'));
        detail.append(node('span',coupon.valid_now?'사용 가능':'사용 기간 전','coupon-state'));card.append(detail);$('my-coupons').append(card);
      }
      const completed=(mine.orders||[]).filter(item=>item.status==='paid'||(item.status==='canceled'&&item.paid_at));
      const pending=(mine.orders||[]).filter(item=>['pending','confirming'].includes(item.status));
      $('my-pending-section').hidden=!pending.length;
      if(!completed.length)$('my-orders').append(node('p',mine.commerceReady?'결제 내역이 없어요.':'신청 내역 연결을 준비 중이에요.','empty-state'));
      for(const item of [...completed,...pending]){const article=node('article',undefined,'my-order-card');article.append(node('strong',item.event_date+' · '+item.gender),node('p',(item.payment_kind==='benefits'&&item.status==='paid'?'혜택 사용 완료':statuses[item.status]||'확인 중')+' · '+money(item.amount)));if(item.status==='paid'&&item.attended_at&&!item.review_written){const link=node('a','후기 작성 · 1,000P');link.href='/dating/?reviewOrder='+encodeURIComponent(item.id)+'#reviews';article.append(link);}else if(['pending','confirming'].includes(item.status)){const link=node('a','결제 상태 확인');link.href='/checkout/success/?orderId='+encodeURIComponent(item.id);article.append(link);if(item.status==='pending'&&mine.discountsReady){const cancel=node('button','대기 신청 취소');cancel.type='button';cancel.addEventListener('click',async()=>{cancel.disabled=true;try{const result=await api('/api/checkout/cancel',{orderId:item.id});if(!result.canceled)throw new Error('취소 결과를 확인하지 못했어요.');await myPage();}catch(error){$('my-notice').textContent=error.message;cancel.disabled=false;}});article.append(cancel);}}$(item.status==='pending'||item.status==='confirming'?'my-pending-orders':'my-orders').append(article);}
      if(!mine.ledger?.length)$('my-ledger').append(node('p',mine.commerceReady?'포인트 내역이 없어요.':'포인트 서비스 연결을 준비 중이에요.','empty-state'));
      for(const item of mine.ledger||[]){const row=node('div',undefined,'ledger-row'),label=node('div',item.reason==='spend'?'소개팅 신청에 사용':'참가 후기 적립');label.append(node('span',' · '+item.created_at.slice(0,10)));row.append(label,node('strong',(item.amount>0?'+':'')+item.amount.toLocaleString('ko-KR')+' P'));$('my-ledger').append(row);}
    }catch(error){$('my-notice').textContent=error.status===401?'로그인 또는 비회원 휴대폰 인증으로 나의 정보를 확인해주세요.':error.message;$('my-points').textContent='— P';$('my-pending-section').hidden=true;$('my-coupon-section').hidden=true;$('my-coupons').replaceChildren();$('my-orders').replaceChildren(node('p',error.status===401?'로그인하면 나의 신청 내역을 확인할 수 있어요.':'결제 내역을 불러오지 못했어요. 잠시 후 다시 확인해주세요.','empty-state'));$('my-ledger').replaceChildren(node('p',error.status===401?'로그인하면 포인트 내역을 확인할 수 있어요.':'포인트 내역을 불러오지 못했어요. 잠시 후 다시 확인해주세요.','empty-state'));}
  }
  async function accountPage(){
    const ready=await window.OneulReady;
    if(!ready.accountsReady){let draft={};try{draft=JSON.parse(sessionStorage.getItem(previewKey)||'{}');}catch{}for(const name of ['name','email'])if(typeof draft[name]==='string')$('account-'+name).value=draft[name];$('account-notice').textContent='회원정보 수정 화면 미리보기예요. 실제 계정 정보는 변경되지 않아요.';$('save-account').textContent='수정 내용 미리보기';$('save-account').disabled=false;return;}
    try{({user}=await api('/api/auth/me'));$('account-name').value=user.name;$('account-email').value=user.email;$('account-phone').value=domestic(user.phone);$('change-phone').hidden=!ready.phoneReady;$('account-phone').placeholder=user.phoneVerified?'인증한 번호':'문자 인증 전';$('account-email').disabled=user.mode==='guest';$('account-notice').textContent=user.mode==='guest'?'비회원은 이름과 인증한 휴대폰 정보를 수정할 수 있어요.':'이메일을 변경하면 확인 메일의 링크를 눌러 변경을 완료해주세요.';$('save-account').disabled=false;}
    catch(error){$('account-notice').textContent=error.status===401?'로그인 후 회원정보를 수정할 수 있어요. MY에서 로그인해주세요.':error.message;}
  }
  if($('my-name'))myPage();
  if($('account-form')){
    accountPage();$('account-form').addEventListener('submit',async event=>{event.preventDefault();if(!$('account-form').reportValidity())return;const name=$('account-name').value.trim(),email=$('account-email').value.trim();if(!name){$('access-error').textContent='이름을 입력해주세요.';return;}if(!user){try{sessionStorage.setItem(previewKey,JSON.stringify({name,email}));}catch{}$('account-status').textContent='수정 내용은 이 탭의 미리보기 초안이에요. 실제 회원정보가 변경된 건 아니에요.';return;}$('save-account').disabled=true;$('access-error').textContent='';try{const result=await api('/api/account',{name,email:user.mode==='guest'?undefined:email},'PUT');if(!result.updated)throw new Error('회원정보 수정 결과를 확인하지 못했어요.');user=result.user;$('account-status').textContent=result.emailConfirmationRequired?'이름을 수정했어요. 이메일 변경은 확인 메일의 링크를 누른 후 완료돼요.':'회원정보를 수정했어요.';}catch(error){$('access-error').textContent=error.message;}finally{$('save-account').disabled=false;}});
  }
})();
