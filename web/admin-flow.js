(() => {
  'use strict';const $=id=>document.getElementById(id),api=window.OneulAPI;
  const statuses={draft:'작성 전',submitted:'확인 중',changes_requested:'수정 요청',confirmed:'참가 확정',canceled:'취소됨'},sources={frip:'프립',munto:'문토',website:'오늘마주'};
  const create=(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text||'';if(className)n.className=className;return n;};
  let items=[],selected=null,busy=false,pendingNoticeId=null,requestedId=String(window.location.search||'').match(/[?&]application=([a-f0-9-]{36})(?:&|$)/)?.[1]||null;
  const copy=async(id,button)=>{try{await navigator.clipboard.writeText($(id).value);button.textContent='복사했어요';}catch{$(id).focus();$(id).select();button.textContent='문구를 선택했어요. 직접 복사해주세요.';}};
  function invitation(token,item){$('admin-invite').hidden=false;$('admin-invite-text').value='[오늘마주]\n'+item.name+'님, '+item.event_date+' '+item.start_time+' 신청을 확인했어요.\n아래 링크에서 프로필·얼굴/전신 사진·직업 확인 자료를 제출해주세요.\n'+window.location.origin+'/application/#invite='+token+'\n회원 또는 비회원으로 작성할 수 있어요. 자료 확인 후 참가 확정을 안내해드릴게요.';$('admin-copy-invite').textContent='문자 문구 복사';$('admin-invite').scrollIntoView({block:'start'});}
  const notice=item=>'[오늘마주 참가 확정]\n'+item.name+'님, 참가가 확정됐어요!\n\n일시: '+item.event_date+' '+item.start_time+'\n'+(item.venue?'장소: '+item.venue+'\n':'')+'\n'+(item.instructions||'신분증과 충전된 휴대폰을 준비해주세요. 시작 10분 전 도착 부탁드려요. 지각하면 대화 시간이 줄어들 수 있어요.')+'\n\n신청 상태는 오늘마주에서 확인할 수 있어요.';
  function render(){
    const filtered=items.filter(item=>$('admin-filter').value==='all'||item.status===$('admin-filter').value);$('admin-applications').replaceChildren();
    if(!filtered.length)$('admin-applications').append(create('p','해당하는 참가 신청이 없어요.','empty-state'));
    let previousSession='';
    for(const item of filtered){
      const card=create('article',undefined,'admin-participant-row'),session=item.event_date+' '+item.start_time;
      if(session!==previousSession){card.append(create('p',session,'admin-participant-session'));previousSession=session;}
      const button=create('button',undefined,'session-roster-row admin-participant-open');button.type='button';button.addEventListener('click',()=>detail(item));
      const number=item.memo?.participantNumber,identity=create('span',undefined,'session-roster-identity');identity.append(create('span',item.gender+(Number.isInteger(number)&&number>=1&&number<=13?' '+number+'호':''),'session-roster-number'),create('strong',item.name));
      const profile=item.profile||{},height=Number(profile.height),heightLabel=Number.isFinite(height)&&height>=120&&height<=230?height+'cm':'키 미입력';
      const summary=create('span',[heightLabel,typeof profile.job==='string'&&profile.job.trim()?profile.job:'직업 미입력',typeof profile.mbti==='string'&&profile.mbti.trim()?profile.mbti:'MBTI 미입력'].join(' · '),'session-roster-profile');
      const states=create('span',undefined,'session-roster-states');states.append(create('span',statuses[item.status]||item.status,'session-status '+(item.status==='confirmed'?'is-confirmed':'is-pending')),create('span',item.memo?(item.memo.submittedAt?'매칭 제출':'매칭 미제출'):'매칭 정보 없음','session-status '+(item.memo?.submittedAt?'is-submitted':'is-pending')));
      button.append(identity,summary,states);const actions=create('div',undefined,'admin-order-actions');actions.append(button);
      if(item.deletable){const remove=create('button','삭제','text-button admin-delete-button');remove.type='button';remove.addEventListener('click',()=>removeApplication(item));actions.append(remove);}
      card.append(actions);$('admin-applications').append(card);
    }
  }
  function closeDetail(){window.OneulAdminFile.close();window.OneulAdminMemo?.reset();selected=null;$('admin-detail').hidden=true;$('admin-detail-title').textContent='';$('admin-detail-profile').replaceChildren();$('admin-detail-files').replaceChildren();$('admin-instructions').value='';$('admin-note').value='';$('admin-detail-status').textContent='';$('admin-notice-text').value='';$('admin-notice-status').textContent='';$('admin-notice-confirm').hidden=true;$('admin-list-title').focus({preventScroll:true});$('admin-list-title').scrollIntoView({block:'start'});}
  function renderNotice(item){
    const pending=pendingNoticeId===item.id,recorded=!!item.notice_sent_at;
    $('admin-notice').hidden=item.status!=='confirmed';$('admin-notice-text').value=item.status==='confirmed'?(recorded?item.notice_text:notice(item)):'';
    $('admin-notice-confirm').hidden=true;$('admin-notice-sent').hidden=false;$('admin-notice-sent').disabled=pending||recorded;
    $('admin-notice-sent').textContent=pending?'발송 기록 저장 중…':recorded?'발송 완료 기록됨':'실제 발송 완료로 기록';$('admin-notice-save').disabled=pending;
    $('admin-notice-status').textContent=pending?'발송 완료 기록을 저장하고 있어요.':recorded?'발송 완료로 기록했어요 · '+new Date(item.notice_sent_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 발송 완료로 기록하지 않았어요.';
    $('admin-copy-notice').textContent='안내 문자 복사';
  }
  function detail(item,{scroll=true}={}){window.OneulAdminFile.close();window.OneulAdminMemo?.open(item);selected=item;$('admin-detail').hidden=false;$('admin-detail-title').textContent=item.name+'님 · '+statuses[item.status];$('admin-detail-profile').replaceChildren();$('admin-detail-files').replaceChildren();
    $('admin-detail-profile').append(create('p',sources[item.source]+' · 주문 '+item.external_order_no+' · '+Number(item.amount).toLocaleString('ko-KR')+'원'),create('p','연락처 '+item.phone.replace(/^\+82/,'0')));
    if(item.profile){for(const [name,label]of [['name','이름'],['birth','생년월일'],['height','키'],['weight','몸무게'],['region','지역'],['district','서울 구'],['mbti','MBTI'],['job','직업']])if(item.profile[name])$('admin-detail-profile').append(create('p',label+': '+item.profile[name]));for(const [slot,label]of [['face','얼굴 사진'],['fullbody','전신 사진'],['employment','직업 확인 자료']])if(item.profile[slot+'_path']){const button=create('button',label);button.type='button';button.addEventListener('click',()=>window.OneulAdminFile.open('/api/admin/applications/'+item.id+'/file/'+slot,label));$('admin-detail-files').append(button);}}
    else $('admin-detail-profile').append(create('p','아직 프로필을 제출하지 않았어요.','empty-state'));
    $('admin-instructions').value=item.instructions||'신분증과 충전된 휴대폰을 준비해주세요. 시작 10분 전 도착 부탁드려요. 지각하면 대화 시간이 줄어들 수 있어요.';$('admin-note').value=item.review_note||'';
    $('admin-confirm').disabled=!['submitted','confirmed'].includes(item.status)||!item.profile;$('admin-request-changes').disabled=!['submitted','confirmed','changes_requested'].includes(item.status);$('admin-cancel').disabled=item.status==='canceled';$('admin-reissue').disabled=item.status==='canceled';$('admin-delete').hidden=!item.deletable;$('admin-detail-status').textContent='';
    renderNotice(item);if(scroll)$('admin-detail').scrollIntoView({block:'start'});
  }
  async function load(){const result=await api('/api/admin/applications');if(!Array.isArray(result.applications))throw new Error('신청 내역을 확인하지 못했어요.');items=result.applications;render();if(requestedId){const requested=items.find(item=>item.id===requestedId);requestedId=null;if(requested)detail(requested);}if(selected){const fresh=items.find(item=>item.id===selected.id);if(fresh)detail(fresh,{scroll:false});else closeDetail();}}
  $('admin-register').addEventListener('submit',async event=>{event.preventDefault();if(busy||!$('admin-register').reportValidity())return;busy=true;$('admin-register-button').disabled=true;$('admin-register-error').textContent='';try{const data=Object.fromEntries(new FormData($('admin-register')));data.amount=Number(data.amount);data.paymentConfirmed=$('platform-paid').checked;const result=await api('/api/admin/applications',data);if(!result.created)throw new Error('등록 결과를 확인하지 못했어요.');$('admin-register').reset();await load();invitation(result.inviteToken,result.application);}catch(error){$('admin-register-error').textContent=error.message;}finally{busy=false;$('admin-register-button').disabled=false;}});
  async function review(decision){if(!selected||busy)return;if(decision==='changes_requested'&&!$('admin-note').value.trim()){$('admin-detail-status').textContent='수정이 필요한 내용을 적어주세요.';return;}if(decision==='canceled'&&!window.confirm('결제 플랫폼에서 실제 취소를 확인했나요? 이 버튼은 플랫폼 결제를 환불하지 않고 신청 상태만 취소해요.'))return;busy=true;try{const result=await api('/api/admin/applications/'+selected.id+'/review',{decision,expectedSubmittedAt:selected.submitted_at,note:$('admin-note').value,instructions:$('admin-instructions').value});if(!result.updated)throw new Error('변경 결과를 확인하지 못했어요.');await load();$('admin-detail-status').textContent='신청 상태를 변경했어요.';}catch(error){$('admin-detail-status').textContent=error.message;}finally{busy=false;}}
  async function removeApplication(item){
    if(busy||!item.deletable)return;
    const summary=sources[item.source]+' · 주문 '+item.external_order_no+'\n'+item.event_date+' '+item.start_time+' · '+item.name+'님';
    if(!window.confirm(summary+'\n\n이 신청을 완전히 삭제할까요? 작성 링크와 제출 자료도 함께 삭제돼요. 복구할 수 없으며 플랫폼 결제를 환불하는 기능은 아니에요.'))return;
    busy=true;
    try{
      const result=await api('/api/admin/applications/'+item.id,{confirmOrderNo:item.external_order_no,expectedUpdatedAt:item.updated_at},'DELETE');
      if(result.deleted!==true||result.applicationId!==item.id)throw new Error('삭제 결과를 확인하지 못했어요.');
      if(selected?.id===item.id)closeDetail();
      $('admin-invite').hidden=true;$('admin-invite-text').value='';
      await load();$('admin-message').textContent='신청을 삭제했어요. 작성 링크는 종료됐어요.'+(result.cleanupQueued?' 첨부 파일은 자동 정리돼요.':'');
    }catch(error){$('admin-message').textContent=error.message;if(selected?.id===item.id)$('admin-detail-status').textContent=error.message;}
    finally{busy=false;}
  }
  $('admin-delete').addEventListener('click',()=>{if(selected)removeApplication(selected);});
  $('admin-confirm').addEventListener('click',()=>review('confirmed'));$('admin-request-changes').addEventListener('click',()=>review('changes_requested'));$('admin-cancel').addEventListener('click',()=>review('canceled'));
  $('admin-reissue').addEventListener('click',async()=>{if(!selected||busy||!window.confirm('이전 작성 링크와 비회원 접근을 종료하고 새 링크를 발급할까요?'))return;busy=true;try{const result=await api('/api/admin/applications/'+selected.id+'/invite',{});if(!result.created)throw new Error('링크를 발급하지 못했어요.');invitation(result.inviteToken,selected);}catch(error){$('admin-detail-status').textContent=error.message;}finally{busy=false;}});
  $('admin-detail-close').addEventListener('click',closeDetail);$('admin-back-list').addEventListener('click',closeDetail);
  $('admin-notice-sent').addEventListener('click',()=>{if(!selected||busy||selected.status!=='confirmed'||selected.notice_sent_at)return;$('admin-notice-sent').hidden=true;$('admin-notice-confirm').hidden=false;$('admin-notice-status').textContent='문자를 실제로 발송했다면 아래에서 기록을 완료해주세요.';$('admin-notice-save').focus({preventScroll:true});});
  $('admin-notice-cancel').addEventListener('click',()=>{if(selected&&!busy){renderNotice(selected);$('admin-notice-sent').focus({preventScroll:true});}});
  $('admin-notice-save').addEventListener('click',async()=>{
    if(!selected||busy||selected.status!=='confirmed'||selected.notice_sent_at||$('admin-notice-confirm').hidden)return;
    const target=selected,message=$('admin-notice-text').value;busy=true;pendingNoticeId=target.id;renderNotice(target);
    try{
      const result=await api('/api/admin/applications/'+target.id+'/notice',{sent:true,message,expectedUpdatedAt:target.updated_at});
      if(result.recorded!==true||result.applicationId!==target.id||!result.noticeSentAt||!Number.isFinite(Date.parse(result.noticeSentAt))||typeof result.noticeText!=='string'||!Number.isFinite(Date.parse(result.updatedAt)))throw new Error('발송 기록을 확인하지 못했어요. 새로고침해서 저장 여부를 확인해주세요.');
      const record={notice_sent_at:result.noticeSentAt,notice_text:result.noticeText,updated_at:result.updatedAt};items=items.map(item=>item.id===target.id?{...item,...record}:item);pendingNoticeId=null;
      if(selected?.id===target.id){selected={...selected,...record};renderNotice(selected);}else $('admin-message').textContent='발송 완료 기록을 저장했어요.';
    }catch(error){pendingNoticeId=null;if(selected?.id===target.id){renderNotice(selected);$('admin-notice-status').textContent=error.message;}else $('admin-message').textContent='발송 기록 확인: '+error.message;}
    finally{busy=false;pendingNoticeId=null;}
  });
  $('admin-copy-invite').addEventListener('click',event=>copy('admin-invite-text',event.currentTarget));$('admin-copy-notice').addEventListener('click',event=>copy('admin-notice-text',event.currentTarget));$('admin-filter').addEventListener('change',render);$('admin-refresh').addEventListener('click',()=>load().catch(error=>$('admin-message').textContent=error.message));
  $('platform-date').min=[new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),'2026-10-24'].sort().pop();
  (async()=>{await window.OneulReady;try{const result=await api('/api/admin/status');if(result.admin!==true)throw new Error('운영자 권한을 확인하지 못했어요.');$('admin-message').textContent=result.email+' · 운영자';$('admin-content').hidden=false;await load();}catch(error){$('admin-message').textContent=error.message;$('admin-login').hidden=error.status!==401;}})();
})();
