(() => {
  'use strict';const $=id=>document.getElementById(id),api=window.OneulAPI;
  if(!$('my-applications'))return;
  const statuses={draft:'프로필 작성 전',submitted:'프로필 확인 중',changes_requested:'수정 요청',confirmed:'참가 확정',canceled:'취소됨'};
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  (async()=>{await window.OneulReady;
    try{const result=await api('/api/applications');$('my-application-section').hidden=false;$('my-applications').replaceChildren();if(!result.applications?.length){const p=node('p','연결된 참가 신청이 없어요. 플랫폼에서 결제했다면 문자로 받은 작성 링크에서 회원 계정에 연결해주세요.');p.className='empty-state';$('my-applications').append(p);}for(const item of result.applications||[]){const card=node('article','');card.className='my-order-card';card.append(node('strong',item.event_date+' '+item.start_time),node('p',(item.source==='frip'?'프립':item.source==='munto'?'문토':'오늘마주')+' · '+statuses[item.status]));const a=node('a','신청 상태·프로필 확인');a.href='/application/?id='+encodeURIComponent(item.id);card.append(a);$('my-applications').append(card);}}catch(error){if(error.status!==401&&error.status!==503){$('my-application-section').hidden=false;$('my-applications').textContent='참가 신청을 불러오지 못했어요. 다시 확인해주세요.';}}
    try{const result=await api('/api/admin/status');$('my-admin-link').hidden=result.admin!==true;}catch{/* Ordinary accounts have no operator menu. */}
  })();
})();
