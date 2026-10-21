(() => {
  'use strict';const $=id=>document.getElementById(id),api=window.OneulAPI;
  const fragment=new URLSearchParams(window.location.hash.slice(1));let invite=fragment.get('invite');
  if(invite)window.history.replaceState({},'',window.location.pathname+window.location.search);
  const params=new URLSearchParams(window.location.search),id=invite?null:params.get('id'),query=id?'?id='+encodeURIComponent(id):'';
  const statuses={draft:'프로필 작성 전',submitted:'프로필 확인 중',changes_requested:'프로필 수정 요청',confirmed:'참가 확정',canceled:'신청 취소'};
  let item,account,busy=false;
  const returnTo='/application/'+query,controls=['application-member-login','application-signup','application-guest'];
  function saveReturn(){try{sessionStorage.setItem('oneul-application-return',returnTo);}catch{}}
  function showError(error){
    $('application-login').hidden=error.code!=='application_member_login';
    $('application-error').textContent=error.code==='application_member_login'?'이 신청에 연결한 회원 계정으로 로그인하면 계속할 수 있어요.':error.message;
    if(!invite&&!item)$('application-message').textContent='문자로 받은 전체 작성 링크를 다시 열어주세요. 만료되거나 새로 발급된 링크로 바뀐 경우에는 운영자에게 요청해주세요.';
  }
  async function exchange(){
    if(!invite)return;
    const result=await api('/api/application/exchange',{inviteToken:invite});
    if(!result.exchanged)throw new Error('작성 링크 연결을 확인하지 못했어요. 다시 시도해주세요.');
    invite=null;
  }
  async function render(){
    const result=await api('/api/application'+query);item=result.application;account=result.account;
    $('application-content').hidden=false;$('application-message').textContent='결제한 신청의 프로필을 제출하고 참가 확정 상태를 확인해요.';
    $('application-status').textContent=statuses[item.status]||'확인 중';$('application-date').textContent=item.event_date+' · '+item.start_time;
    $('application-summary').textContent=item.name+'님 · '+(item.source==='frip'?'프립':item.source==='munto'?'문토':'오늘마주')+' 결제 · '+Number(item.amount).toLocaleString('ko-KR')+'원';
    $('application-note').textContent=item.review_note||'';
    const editable=['draft','submitted','changes_requested'].includes(item.status)&&item.payment_status==='paid';
    $('application-choose').hidden=!editable||item.member||!!account;$('application-member').hidden=!editable||item.member||!account;
    $('application-account').textContent=account?'로그인한 계정: '+account.email:'';
    $('application-profile').hidden=!editable||!item.member;$('application-profile').href='/profile/?application='+encodeURIComponent(id||'1');
    $('application-profile').textContent=item.status==='draft'?'프로필 작성하기':'제출한 프로필 수정하기';
    if(!item.member&&item.status!=='draft'){$('application-profile').hidden=!editable;$('application-profile').textContent='제출한 프로필 수정하기';}
    $('application-confirmed').hidden=item.status!=='confirmed';$('application-venue').textContent=item.venue;$('application-venue').hidden=!item.venue;$('application-instructions').textContent=item.instructions;
    if(item.status==='submitted')$('application-message').textContent='프로필 제출이 완료됐어요. 운영자가 확인한 후 참가 확정을 안내해요.';
    if(item.status==='confirmed')$('application-message').textContent='참가가 확정됐어요. 아래 장소와 준비물을 확인해주세요.';
    if(item.status==='canceled')$('application-message').textContent='취소된 신청이에요. 결제 취소·환불은 결제한 플랫폼에서 확인해주세요.';
  }
  async function choose(event,route){
    event.preventDefault();if(busy)return;busy=true;$('application-error').textContent='';
    for(const name of controls){$(name).setAttribute('aria-disabled','true');if($(name).tagName==='BUTTON')$(name).disabled=true;}
    try{
      await window.OneulReady;await exchange();await render();
      if(!route){
        if(item.member){$('application-message').textContent='이미 회원 계정에 연결된 신청이에요. 위의 프로필 작성 버튼으로 이어서 작성해주세요.';return;}
        if(item.payment_status==='paid'&&['draft','submitted','changes_requested'].includes(item.status))window.location.assign('/profile/?application=1');
      }else if(!account){saveReturn();window.location.assign(route);}
      else if(!item.member){$('application-message').textContent='로그인한 계정으로 신청을 연결하면 저장한 프로필을 사용할 수 있어요.';}
    }catch(error){showError(error);}finally{busy=false;for(const name of controls){$(name).removeAttribute('aria-disabled');if($(name).tagName==='BUTTON')$(name).disabled=false;}}
  }
  $('application-login').addEventListener('click',saveReturn);
  $('application-member-login').addEventListener('click',event=>choose(event,'/login/'));
  $('application-signup').addEventListener('click',event=>choose(event,'/join/'));
  $('application-guest').addEventListener('click',event=>choose(event,null));
  $('application-claim').addEventListener('click',async()=>{if(!account||!window.confirm(account.email+' 계정으로 이번 신청을 연결할까요?'))return;$('application-claim').disabled=true;try{const result=await api('/api/application/claim'+query,{claimConsent:true});if(!result.claimed)throw new Error('신청 연결을 확인하지 못했어요.');window.location.assign('/profile/?application='+encodeURIComponent(id||'1'));}catch(error){$('application-error').textContent=error.message;$('application-claim').disabled=false;}});
  $('application-exit').addEventListener('click',async()=>{try{await api('/api/application/logout',{});window.location.assign('/');}catch(error){$('application-error').textContent=error.message;}});
  if(invite){$('application-message').textContent='회원 또는 비회원으로 프로필을 작성할 수 있어요. 작성 방법을 선택해주세요.';$('application-choose').hidden=false;}
  else (async()=>{await window.OneulReady;try{await render();}catch(error){showError(error);}})();
})();
