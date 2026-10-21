(() => {
  'use strict';
  const $=id=>document.getElementById(id), form=$('profile-form');if(!form)return;
  const applicationId=new URLSearchParams(window.location.search).get('application'),applicationMode=!!applicationId,applicationQuery=applicationId&&applicationId!=='1'?'?id='+encodeURIComponent(applicationId):'';
  const profileEndpoint=applicationMode?'/api/application/profile'+applicationQuery:'/api/profile';
  const fileEndpoint=slot=>applicationMode?'/api/application/files/'+slot+applicationQuery:'/api/uploads/'+slot;
  const previewKey='oneulmaju-profile-preview-draft',previewRequested=/(?:^|[?&])preview=1(?:&|$)/.test(window.location.search||'');
  let key=previewRequested?previewKey:'oneulmaju-profile-screen-draft';
  const fields=['name','phone','gender','birth','height','weight','region','district','mbti','job'];
  const slots=['face','fullbody','employment'], titles={face:'얼굴 사진',fullbody:'전신 사진',employment:'직업 확인 자료'};
  const steps=[...document.querySelectorAll('[data-step]')],labels=[...document.querySelectorAll('[data-step-label]')],files={},previews={},paths={};
  let draft={},user=null,ready={},current=0,hasSaved=false,busy=false;
  try{draft=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
  if(!draft||typeof draft!=='object'||Array.isArray(draft))draft={};
  const domestic=value=>String(value||'').replace(/^\+?82/,'0');
  const remember=()=>{draft=Object.fromEntries([...fields,'ownerId','mode'].filter(name=>draft[name]!==undefined).map(name=>[name,draft[name]]));try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{$('draft-note').textContent='이 환경에서는 임시 초안을 유지할 수 없어요. 저장 전에는 화면을 닫지 말아주세요.';}};
  const district=()=>{const seoul=$('region').value==='서울';$('district-field').hidden=!seoul;$('district').disabled=!seoul;$('district').required=seoul;if(!seoul){$('district').value='';draft.district='';}};
  const collect=()=>{const data=new FormData(form);for(const name of fields)draft[name]=String(data.get(name)||'').trim();if(user){draft.ownerId=user.id;draft.mode=user.mode;if(applicationMode)draft.gender=user.gender;if(user.phoneVerified)draft.phone=domestic(user.phone);}remember();};
  const populate=()=>{for(const name of fields){const value=typeof draft[name]==='string'||typeof draft[name]==='number'?String(draft[name]):'';if(name==='gender'){for(const input of form.querySelectorAll('[name="gender"]'))input.checked=input.value===value;}else{const input=form.elements.namedItem(name);if(input)input.value=value;}}if(user){if(user.phoneVerified)$('phone').value=domestic(user.phone);$('phone').readOnly=!!user.phoneVerified;$('phone-note').textContent=user.phoneVerified?'문자 인증한 번호예요. 번호 변경은 MY에서 진행해주세요.':'테스트 중에는 연락처만 입력해요. 문자 인증은 아직 완료되지 않았어요.';}district();};
  const render=()=>{
    $('card-name').textContent=draft.name||'내 이름';$('card-subtitle').textContent=[draft.birth?`${draft.birth.slice(0,4)}년생`:'',draft.job].filter(Boolean).join(' · ');$('card-tags').replaceChildren();
    for(const value of [draft.gender,draft.height?`${draft.height}cm`:'',[draft.region,draft.district].filter(Boolean).join(' '),draft.mbti]){if(!value)continue;const tag=document.createElement('span');tag.textContent=value;$('card-tags').append(tag);}
    $('card-files').replaceChildren();for(const slot of slots){const row=document.createElement('p');row.textContent=titles[slot]+': '+(files[slot]?'선택됨 · 저장 전':paths[slot]?'첨부됨 · 검증 전':'첨부 전');$('card-files').append(row);}
  };
  const show=index=>{current=index;steps.forEach((step,i)=>step.hidden=i!==index);labels.forEach((label,i)=>{label.classList.toggle('active',i===index);label.classList.toggle('done',i<index);if(i===index)label.setAttribute('aria-current','step');else label.removeAttribute('aria-current');});$('profile-error').textContent='';if(index===steps.length-1)render();const h=steps[index].querySelector('h2');h.tabIndex=-1;h.focus({preventScroll:true});steps[index].scrollIntoView({block:'start'});};
  const validate=index=>{for(const control of steps[index].querySelectorAll('input,select,textarea'))if(!control.checkValidity()){control.reportValidity();return false;}if(index===0&&!$('name').value.trim()){$('profile-error').textContent='이름을 입력해주세요.';return false;}if(index===0&&!$('job').value.trim()){$('profile-error').textContent='직업을 입력해주세요.';return false;}return true;};
  const lock=value=>{busy=value;for(const input of form.querySelectorAll('button,input[type="file"]'))input.disabled=value;$('save-profile').disabled=value||!user||!ready.profilesReady||!ready.uploadsReady;$('delete-profile').disabled=value||!hasSaved;};
  for(const button of form.querySelectorAll('[data-next]'))button.addEventListener('click',()=>{if(validate(current)){collect();show(Number(button.dataset.next));}});
  for(const button of form.querySelectorAll('[data-back]'))button.addEventListener('click',()=>{collect();show(Number(button.dataset.back));});
  form.addEventListener('submit',event=>{event.preventDefault();if(current<steps.length-1&&validate(current)){collect();show(current+1);}});
  form.addEventListener('input',event=>{if(event.target.type==='file')return;collect();$('save-status').textContent='';});$('region').addEventListener('change',()=>{district();collect();});
  const reset=slot=>{if(previews[slot])URL.revokeObjectURL(previews[slot]);delete previews[slot];delete files[slot];$(slot+'-file').value='';$(slot+'-preview').hidden=true;$(slot+'-preview').removeAttribute('src');};
  for(const slot of slots){
    $(slot+'-file').addEventListener('change',()=>{const file=$(slot+'-file').files[0];if(!file)return;const allowed=slot==='employment'?['image/jpeg','image/png','image/webp','application/pdf']:['image/jpeg','image/png','image/webp'];if(!allowed.includes(file.type)||file.size>8*1024*1024){reset(slot);$(slot+'-status').textContent='8MB 이하의 JPG·PNG·WEBP'+(slot==='employment'?' 또는 PDF':'')+' 파일을 선택해주세요.';return;}if(previews[slot])URL.revokeObjectURL(previews[slot]);files[slot]=file;$(slot+'-status').textContent=file.name+' · 선택됨, 마지막 저장 시 업로드돼요.';$(slot+'-remove').hidden=false;if(file.type.startsWith('image/')){previews[slot]=URL.createObjectURL(file);$(slot+'-preview').src=previews[slot];$(slot+'-preview').hidden=false;}else $(slot+'-preview').hidden=true;$('save-status').textContent='';});
    $(slot+'-remove').addEventListener('click',()=>{reset(slot);delete paths[slot];$(slot+'-status').textContent='첨부 전';$(slot+'-remove').hidden=true;$(slot+'-view').hidden=true;$('save-status').textContent='변경한 내용은 마지막에 저장해주세요.';});
  }
  const upload=async(slot,file)=>{const response=await fetch(fileEndpoint(slot),{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'X-Oneul-File-Consent':'true'},body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'첨부 파일을 저장하지 못했어요.');return data.path;};
  $('save-profile').addEventListener('click',async()=>{
    if(busy||!user||previewRequested||!ready.profilesReady||!ready.uploadsReady)return;for(let i=0;i<steps.length-1;i++){show(i);if(!validate(i))return;}show(steps.length-1);collect();
    if(!$('privacy-consent').checked){$('profile-error').textContent='프로필 저장을 위한 개인정보 수집·이용 안내에 동의해주세요.';return;}
    if((files.face||files.fullbody||paths.face||paths.fullbody)&&!$('photo-consent').checked){show(0);$('profile-error').textContent='사진 확인·저장을 위한 안내에 동의해주세요.';return;}
    if((files.employment||paths.employment)&&!$('employment-consent').checked){show(0);$('profile-error').textContent='직업 자료 확인·저장을 위한 안내에 동의해주세요.';return;}
    lock(true);$('save-status').textContent='프로필과 첨부 파일을 저장하고 있어요.';
    try{if(applicationMode&&slots.some(slot=>!files[slot]&&!paths[slot]))throw new Error('이번 신청에는 얼굴·전신 사진과 직업 확인 자료를 모두 첨부해주세요.');for(const slot of slots)if(files[slot]){paths[slot]=await upload(slot,files[slot]);reset(slot);$(slot+'-status').textContent='첨부 파일 업로드됨 · 프로필 저장 중';}const data=await window.OneulAPI(profileEndpoint,{...draft,keepProfile:applicationMode&&$('application-keep-profile').checked,attachments:paths,privacyConsent:true,photoConsent:$('photo-consent').checked,employmentConsent:$('employment-consent').checked},'PUT');if(data.saved!==true)throw new Error('저장 결과를 확인하지 못했어요.');hasSaved=true;if(applicationMode){for(const slot of slots)paths[slot]=data.profile?.[slot+'_path']||paths[slot];}render();$('save-status').textContent=applicationMode?(data.cardSaved?'프로필 제출과 회원 카드 저장을 완료했어요. 운영자 확인 후 참가가 확정돼요.':user.mode==='member'&&$('application-keep-profile').checked?'프로필은 제출됐지만 회원 카드 저장은 완료하지 못했어요. MY에서 다시 저장해주세요.':'프로필을 제출했어요. 운영자 확인 후 참가가 확정돼요.'):data.cleanupPending?'프로필이 저장됐어요. 이전 첨부 파일 정리를 다시 진행할 예정이에요.':'프로필이 저장됐어요. 사진·직업 자료는 아직 검증 전이에요.';for(const slot of slots)if(paths[slot]){$(slot+'-status').textContent='저장됨 · 검증 전';$(slot+'-view').href=applicationMode?fileEndpoint(slot):'/api/uploads/'+slot+'?path='+encodeURIComponent(paths[slot]);$(slot+'-view').hidden=false;}$('draft-note').textContent=applicationMode?'이번 신청의 프로필을 제출했어요. 신청 화면에서 확인 상태를 볼 수 있어요.':'저장된 카드는 다시 로그인해도 불러올 수 있어요.';if(applicationMode)$('application-back').hidden=false;}catch(error){$('save-status').textContent='';$('profile-error').textContent=error.message;}finally{lock(false);}
  });
  $('delete-profile').addEventListener('click',async()=>{if(!hasSaved||busy||!window.confirm('저장된 프로필과 첨부 파일을 삭제할까요?'))return;lock(true);try{const data=await window.OneulAPI('/api/profile',{},'DELETE');if(!data.deleted)throw new Error('삭제 결과를 확인하지 못했어요.');hasSaved=false;for(const slot of slots){reset(slot);delete paths[slot];$(slot+'-status').textContent='첨부 전';$(slot+'-remove').hidden=true;$(slot+'-view').hidden=true;}draft={ownerId:user.id,mode:user.mode,name:user.name,phone:user.phoneVerified?domestic(user.phone):(draft.phone||'')};remember();populate();show(0);$('draft-note').textContent='저장된 프로필과 첨부 파일을 삭제했어요. 계정은 유지돼요.';}catch(error){$('profile-error').textContent=error.message;}finally{lock(false);}});
  $('birth').max=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());$('save-profile').disabled=true;$('delete-profile').disabled=true;
  const preview=()=>{
    key=previewKey;try{draft=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{draft={};}
    if(!draft||typeof draft!=='object'||Array.isArray(draft))draft={};
    const clean={};for(const name of fields)if(typeof draft[name]==='string')clean[name]=draft[name];draft=clean;
    populate();$('profile-mode').textContent='프로필 미리보기';
    $('service-status').textContent='가입 없이 프로필 작성 화면을 확인하고 있어요. 실제 계정 생성·로그인·프로필 저장은 진행되지 않아요.';
    $('save-profile').textContent='실제 저장 준비 중';$('save-status').textContent='미리보기예요. 선택한 파일은 아직 전송되지 않고, 실제 저장은 서비스 연결 후 가능해요.';
    $('draft-note').textContent='입력 내용은 이 탭에서만 임시로 유지돼요. 사진·서류는 전송되지 않으며, 화면을 닫으면 다시 선택해야 해요.';
    $('delete-profile').hidden=true;$('logout').hidden=true;
  };
  (async()=>{ready=await window.OneulReady;if(previewRequested||!ready.accountsReady){preview();return;}
    if(applicationMode){
      try{
        const result=await window.OneulAPI('/api/application'+applicationQuery),item=result.application;
        user={id:item.id,mode:item.member?'member':'guest',name:item.name,phone:item.phone,phoneVerified:false,gender:item.gender};
        if(!['draft','submitted','changes_requested'].includes(item.status)||item.payment_status!=='paid')throw new Error('확정되거나 취소된 신청은 수정할 수 없어요. 신청 화면에서 확인해주세요.');
        key='oneulmaju-application-draft-'+item.id;try{draft=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{draft={};}if(draft.ownerId!==item.id)draft={};
        let saved=item.profile,cardSource=false;if(!saved&&item.member){try{const card=await window.OneulAPI('/api/profile');saved=card.profile;cardSource=true;}catch(error){if(error.status!==404)throw error;}}
        if(saved){hasSaved=!cardSource;draft={...saved,...draft};for(const slot of slots)if(saved[slot+'_path']){paths[slot]=saved[slot+'_path'];$(slot+'-status').textContent=cardSource?'회원 카드에서 불러옴':'이번 신청에 제출됨';$(slot+'-remove').hidden=false;$(slot+'-view').href=cardSource?'/api/uploads/'+slot+'?path='+encodeURIComponent(paths[slot]):fileEndpoint(slot);$(slot+'-view').hidden=false;}$('privacy-consent').checked=false;$('photo-consent').checked=false;$('employment-consent').checked=false;}
        draft={...draft,ownerId:item.id,mode:user.mode,name:draft.name||item.name,phone:domestic(item.phone||draft.phone),gender:item.gender};
        $('profile-mode').textContent=item.member?'회원 참가 프로필':'비회원 참가 프로필';$('service-status').textContent=item.event_date+' '+item.start_time+' · '+(item.review_note||'자료를 제출하면 운영자가 확인 후 참가 확정을 안내해요.');$('application-keep-wrap').hidden=!item.member;$('application-keep-profile').checked=item.member;
        $('save-profile').textContent='이번 신청에 프로필 제출';$('delete-profile').hidden=true;$('logout').hidden=true;$('application-back').hidden=false;$('application-back').href='/application/'+applicationQuery;
        $('draft-note').textContent='이번 신청의 프로필·자료는 모임 후 30일까지 보관해요. 회원 카드 저장을 선택하면 카드와 첨부는 최종 저장 후 1년간 재사용할 수 있어요.';
        populate();if(item.phone)$('phone').readOnly=true;$('phone-note').textContent='플랫폼 신청 연락처예요. 변경이 필요하면 운영자에게 알려주세요.';for(const input of form.querySelectorAll('[name="gender"]'))input.disabled=true;
        ready={...ready,profilesReady:true,uploadsReady:true};remember();lock(false);
      }catch(error){$('profile-error').textContent=error.message;$('save-profile').disabled=true;}
      return;
    }
    try{({user}=await window.OneulAPI('/api/auth/me'));if(!user.phoneVerified&&(ready.phoneRequired!==false||!user.emailVerified)){window.location.replace('/verify-phone/');return;}if(draft.ownerId!==user.id)draft={};let saved=null;if(ready.profilesReady)({profile:saved}=await window.OneulAPI('/api/profile'));if(saved){hasSaved=true;draft={...saved,...draft};for(const slot of slots)if(saved[slot+'_path']){paths[slot]=saved[slot+'_path'];$(slot+'-status').textContent='저장된 자료 · 검증 전';$(slot+'-remove').hidden=false;$(slot+'-view').href='/api/uploads/'+slot+'?path='+encodeURIComponent(paths[slot]);$(slot+'-view').hidden=false;}$('privacy-consent').checked=!!saved.privacy_consent_at;$('photo-consent').checked=!!saved.photo_consent_at;$('employment-consent').checked=!!saved.employment_consent_at;}draft={...draft,ownerId:user.id,mode:user.mode,name:draft.name||user.name,phone:user.phoneVerified?domestic(user.phone):(draft.phone||'')};$('profile-mode').textContent=user.mode==='guest'?'비회원 프로필':'회원 프로필';$('profile-mode').classList.toggle('guest-mode',user.mode==='guest');populate();remember();lock(false);if(!ready.profilesReady||!ready.uploadsReady)$('save-status').textContent='프로필·첨부 파일 저장 연결을 준비 중이에요.';}catch(error){if(error.status===401)window.location.replace('/login/');else $('profile-error').textContent=error.message;}
  })();
})();
