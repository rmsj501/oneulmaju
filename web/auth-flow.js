(() => {
  'use strict';
  const joinCoupon=document.getElementById('join-coupon');if(joinCoupon)joinCoupon.hidden=Date.now()>=Date.parse('2026-11-25T00:00:00+09:00');
  const $ = id => document.getElementById(id);
  const draftKey = 'oneulmaju-profile-screen-draft';
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    let response;
    try { response = await fetch(path,{method,credentials:'same-origin',headers:body === undefined ? {} : {'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)}); }
    catch { throw new Error('연결하지 못했어요. 입력 내용은 유지되니 잠시 후 다시 시도해주세요.'); }
    const data = await response.json().catch(()=>({error:'응답을 확인하지 못했어요.'}));
    if (!response.ok) { const error=new Error(data.error || '다시 시도해주세요.');error.status=response.status;error.code=data.code;throw error; }
    return data;
  }
  window.OneulAPI = request;
  async function finishLogin(next, replace = false) {
    try { await request('/api/auth/me'); }
    catch(error) {
      if(error.status!==401)throw error;
      const problem=new Error('계정 인증은 완료됐지만 이 화면에서 로그인이 유지되지 않았어요. 새 창에서 로그인해주세요.');
      problem.code='session_not_retained';throw problem;
    }
    try{const back=sessionStorage.getItem('oneul-application-return');if(back&&/^\/application\/(?:\?id=[a-f0-9-]{36})?$/.test(back)){next=back;sessionStorage.removeItem('oneul-application-return');}}catch{}
    if(replace)window.location.replace(next);else window.location.assign(next);
  }
  function showError(target,error) {
    target.textContent=error.message;
    if(error.code==='session_not_retained'){
      const link=document.createElement('a');link.href='/login/';link.target='_blank';link.rel='noopener';link.textContent='새 창에서 로그인';
      target.append(document.createElement('br'),link);
    }
  }
  const setDraft = values => { try { sessionStorage.setItem(draftKey,JSON.stringify(values)); } catch {} };
  const domestic = value => String(value || '').replace(/^\+?82/,'0');
  window.OneulReady = (async () => {
    let status;
    try { status=await request('/api/status'); }
    catch { status={accountsReady:false,phoneReady:false,profilesReady:false}; }
    const label=$('service-status');
    if(label) label.textContent=!status.accountsReady ? '현재는 화면 미리보기 단계예요. 실제 회원가입·로그인은 연결 준비 중이고, 아래 미리보기 버튼으로 프로필을 작성해볼 수 있어요.' : status.phoneRequired === false ? status.profilesReady&&status.uploadsReady?'현재 테스트 중이에요. 이메일 인증으로 가입·로그인하고 프로필·사진을 저장할 수 있어요.':'현재 테스트 중이에요. 이메일 인증만으로 가입·로그인하고 프로필 작성 화면을 확인할 수 있어요.' : !status.phoneReady ? '회원 서비스가 연결됐어요. 참가 전 휴대폰 인증은 연결 준비 중이에요.' : !status.profilesReady || !status.uploadsReady ? '회원·문자 인증이 연결됐어요. 프로필·첨부 파일 저장을 준비 중이에요.' : '회원·휴대폰 인증·프로필 저장을 이용할 수 있어요.';
    return status;
  })();
  const access=$('access-form');
  if(access){
    const mode=access.dataset.mode;
    const button=access.querySelector('button[type="submit"]');
    let cooldown=null;
    let requestedPhone='';
    window.OneulReady.then(status=>{
      button.disabled=!(status.accountsReady && (!['guest','phone'].includes(mode)||status.phoneReady));
      if(!status.accountsReady)button.textContent=mode==='member'?'실제 회원가입 준비 중':mode==='login'?'실제 로그인 준비 중':'문자 인증 준비 중';
      else if(['guest','phone'].includes(mode)&&!status.phoneReady)button.textContent='문자 인증 준비 중';
    });
    access.addEventListener('submit',async event=>{
      event.preventDefault();$('access-error').textContent='';
      const otp=$('otp-code');const wasRequired=otp?.required;if(otp)otp.required=false;
      const valid=access.reportValidity();if(otp)otp.required=wasRequired;if(!valid)return;
      const status=await window.OneulReady;
      if(!status.accountsReady){$('access-error').textContent='회원 서비스 연결을 준비 중이에요.';return;}
      const form=new FormData(access);const body=Object.fromEntries(form);
      if(mode==='member'&&body.password!==body.confirm){$('access-error').textContent='비밀번호가 서로 같지 않아요.';return;}
      button.disabled=true;
      try{
        if(mode==='member'){
          const data=await request('/api/auth/signup',{name:body.name,email:body.email,password:body.password,accountConsent:body.accountConsent==='on'});
          setDraft({name:body.name});
          access.elements.namedItem('password').value='';access.elements.namedItem('confirm').value='';
          if(data.emailConfirmationRequired){access.hidden=true;$('email-pending').hidden=false;}
          else await finishLogin(data.next);
        }else if(mode==='login'){
          const data=await request('/api/auth/login',{email:body.email,password:body.password});
          try{sessionStorage.removeItem(draftKey);}catch{}
          access.elements.namedItem('password').value='';await finishLogin(data.next);
        }else if(mode==='email-resend'||mode==='recovery'){
          await request(mode==='recovery'?'/api/auth/recovery/request':'/api/auth/email/resend',{email:body.email});
          $('email-request-result').textContent=mode==='recovery'?'가입된 이메일이면 비밀번호 재설정 메일을 보내요. 가장 최근 메일의 링크를 열고, 표시된 이메일을 확인한 뒤 새 비밀번호를 설정해주세요. 스팸함도 확인해주세요.':'아직 인증하지 않은 계정이면 새 확인메일을 보내요. 이미 인증했다면 로그인해주세요. 가장 최근 메일만 사용하고 스팸함도 확인해주세요.';
          let seconds=60;button.textContent='다시 요청 · '+seconds+'초';
          cooldown=setInterval(()=>{seconds--;button.textContent=seconds>0?'다시 요청 · '+seconds+'초':'메일 다시 요청';if(seconds<=0){clearInterval(cooldown);cooldown=null;button.disabled=false;}},1000);
        }else{
          if(!status.phoneReady)throw new Error('문자 인증 연결을 준비 중이에요.');
          const base=mode==='guest' ? 'guest' : 'phone';
          const data=await request('/api/auth/'+base+'/request',{phone:body.phone,accountConsent:body.accountConsent==='on'});
          requestedPhone=data.phone;
          $('otp-wrap').hidden=false;$('otp-code').disabled=false;$('otp-code').required=true;$('otp-code').focus();
          let seconds=60;button.textContent='다시 요청 · '+seconds+'초';
          clearInterval(cooldown);cooldown=setInterval(()=>{seconds--;button.textContent=seconds>0 ? '다시 요청 · '+seconds+'초' : '인증번호 다시 받기';if(seconds<=0){clearInterval(cooldown);cooldown=null;button.disabled=false;}},1000);
          return;
        }
      }catch(error){showError($('access-error'),error);}
      finally{if(!cooldown)button.disabled=false;}
    });
    if($('verify-otp'))$('verify-otp').addEventListener('click',async()=>{
      const code=$('otp-code');if(!code.reportValidity())return;
      const current=access.elements.namedItem('phone').value.replace(/[^\d]/g,'');
      if(!requestedPhone||domestic(requestedPhone)!==current){$('access-error').textContent='휴대폰 번호가 바뀌었어요. 이 번호로 인증번호를 다시 요청해주세요.';return;}
      const verify=$('verify-otp');verify.disabled=true;$('access-error').textContent='';
      try{
        const data=await request('/api/auth/'+(mode==='guest'?'guest':'phone')+'/verify',{phone:requestedPhone,code:code.value});
        const {user}=await request('/api/auth/me');
        setDraft({ownerId:user.id,name:access.elements.namedItem('name')?.value||user.name||'',phone:domestic(user.phone),mode:user.mode});
        window.location.assign(data.next);
      }catch(error){$('access-error').textContent=error.message;}
      finally{verify.disabled=false;}
    });
    if(mode==='phone')window.OneulReady.then(async status=>{
      if(!status.accountsReady)return;
      try{const {user}=await request('/api/auth/me');if((user.phoneVerified||(status.phoneRequired===false&&user.emailVerified))&&!new URLSearchParams(window.location.search).has('change')){window.location.replace('/profile/');return;}access.elements.namedItem('phone').value=domestic(user.phone);}
      catch(error){if(error.status===401)window.location.replace('/login/');else $('access-error').textContent=error.message;}
    });
  }
  let recoverySession=null;
  const showPasswordReset=email=>{
    $('confirmation-title').textContent='새 비밀번호를 설정해주세요.';
    $('confirmation-status').textContent='이메일 확인을 마쳤어요. 새 비밀번호를 입력하면 이 계정으로 계속할 수 있어요.';
    $('recovery-email').textContent=email||'인증한 계정';
    $('confirmation-actions').hidden=true;$('password-reset-form').hidden=false;$('save-password').disabled=false;
  };
  const confirmationHelp=(message,title='이메일 확인을 이어가세요.')=>{
    $('confirmation-title').textContent=title;$('confirmation-status').textContent=message;
  };
  if($('confirmation-status'))(async()=>{
    const hash=new URLSearchParams(window.location.hash.slice(1));
    history.replaceState(null,'',window.location.pathname);
    const refresh=hash.get('refresh_token');
    if(hash.get('type')==='recovery'){
      const accessToken=hash.get('access_token');
      if(!accessToken||!refresh){confirmationHelp('비밀번호 재설정 정보를 확인하지 못했어요. 새 재설정 메일을 받아 가장 최근 링크를 열어주세요.','새 재설정 메일이 필요해요.');return;}
      try{
        const data=await request('/api/auth/recovery/inspect',{access_token:accessToken});
        if(!data.passwordResetReady||!data.email)throw new Error('비밀번호 재설정 정보를 확인하지 못했어요. 새 메일을 받아주세요.');
        recoverySession={access_token:accessToken,refresh_token:refresh,email:data.email};
        showPasswordReset(data.email);
      }catch(error){confirmationHelp(error.message,'비밀번호 재설정을 이어가세요.');}
      return;
    }
    if(!refresh){
      if(hash.has('error')){
        confirmationHelp('인증 링크가 만료됐거나 이미 사용됐어요. 이메일 인증을 마쳤다면 회원 로그인으로 계속해주세요. 아직 인증하지 않았다면 새 확인메일을 받아주세요.','인증 링크를 다시 확인해주세요.');
        return;
      }
      try{const data=await request('/api/auth/recovery/status');if(data.passwordResetReady){showPasswordReset();return;}}catch{}
      confirmationHelp('이메일 인증을 마쳤다면 회원 로그인으로 계속해주세요. 아직 인증하지 않았다면 새 확인메일을 받아주세요.');return;
    }
    try{
      const data=await request('/api/auth/import-session',{refresh_token:refresh});
      if(data.passwordResetReady)showPasswordReset();else await finishLogin(data.next,true);
    }
    catch(error){confirmationHelp(error.message,'이메일 확인을 이어가세요.');if(error.code==='session_not_retained')showError($('confirmation-status'),error);}
  })();
  if($('password-reset-form'))$('password-reset-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=$('password-reset-form');if(!form.reportValidity())return;
    const password=form.elements.namedItem('password'),confirm=form.elements.namedItem('confirm');
    $('password-reset-error').textContent='';
    if(password.value!==confirm.value){$('password-reset-error').textContent='비밀번호가 서로 같지 않아요.';return;}
    $('save-password').disabled=true;
    try{const data=await request('/api/auth/password',{password:password.value,...(recoverySession?{...recoverySession,recoveryConsent:form.elements.namedItem('recoveryConsent').checked}:{})});password.value='';confirm.value='';recoverySession=null;await finishLogin(data.next,true);}
    catch(error){showError($('password-reset-error'),error);}
    finally{$('save-password').disabled=false;}
  });
  if($('logout'))$('logout').addEventListener('click',async()=>{
    $('logout').disabled=true;
    try{await request('/api/auth/logout',{});try{sessionStorage.removeItem(draftKey);}catch{}window.location.assign('/login/');}
    catch(error){const target=$('profile-error')||$('access-error');if(target)target.textContent=error.message;$('logout').disabled=false;}
  });
})();
