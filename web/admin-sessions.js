(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=window.OneulAPI,idPattern=/^[a-f0-9-]{36}$/i,tokenPattern=/^[a-f0-9]{64}$/;
  const statuses={draft:'작성 중',submitted:'확인 중',changes_requested:'수정 요청',confirmed:'참가 확정'};
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const key=(date,time)=>date+'/'+time,phone=v=>String(v||'').replace(/^\+82/,'0'),label=(gender,number)=>number?gender+' '+number+'호':gender+' 번호 미배정';
  let selected=null,current=null,sequence=0,busy=false,pending=null;const batches=new Map(),pendingBatches=new Map();
  const sessionLabel=(date,time)=>date+' · '+(Number(time.slice(0,2))<12?'오전 ':'오후 ')+(Number(time.slice(0,2))%12||12)+'시'+(time.slice(3)==='00'?'':' '+Number(time.slice(3))+'분');
  const settingIds=['session-male-opponents','session-female-opponents','session-match-limit'];
  function ranges(){for(const side of ['male','female']){const value=Number($('session-'+side+'-opponents').value);$('session-'+side+'-range').textContent=Number.isInteger(value)&&value>=1&&value<=13?String(value):'—';}}
  for(const id of settingIds)$(id).addEventListener('input',ranges);
  function renderSettings(data){
    const attendees=data.attendees.filter(p=>p.status==='confirmed');
    for(const [side,gender,opposite] of [['male','남성','여성'],['female','여성','남성']]){
      const saved=data[side+'OpponentCount'];
      const inferred=Math.max(1,attendees.filter(p=>p.gender===opposite).length,...attendees.filter(p=>p.gender===opposite).map(p=>p.participantNumber||0),...attendees.filter(p=>p.gender===gender).map(p=>p.opponentCount||0));
      $('session-'+side+'-opponents').value=String(pending?.[side+'OpponentCount']??saved??inferred);
    }
    $('session-match-limit').value=String(pending?.matchLimit??data.matchLimit??3);ranges();lock(busy);
  }
  function tab(name){for(const pane of ['attendees','qr','matches']){$('session-pane-'+pane).hidden=pane!==name;$('session-tab-'+pane).setAttribute('aria-pressed',String(pane===name));}}
  for(const pane of ['attendees','qr','matches'])$('session-tab-'+pane).addEventListener('click',()=>tab(pane));
  function clearDetail(){sequence++;selected=null;current=null;pending=null;busy=false;$('session-detail').hidden=true;$('sessions-list-screen').hidden=false;for(const id of ['session-attendees','session-pairs','session-selections','session-qrs'])$(id).replaceChildren();$('session-issue-status').textContent='';$('session-qr-tools').hidden=true;$('session-replace-confirm').hidden=true;}
  function notice(message=''){$('sessions-message').textContent=message;$('sessions-message').hidden=!message;}
  function failure(error){notice(error.message);if([401,403].includes(error.status)){clearDetail();batches.clear();pendingBatches.clear();$('sessions-content').hidden=true;$('sessions-login').hidden=error.status!==401;}}
  async function loadList(){const data=await api('/api/admin/sessions');if(!Array.isArray(data.sessions))throw new Error('회차 목록을 확인하지 못했어요.');$('sessions-list').replaceChildren();if(!data.sessions.length)$('sessions-list').append(node('p','결제자가 등록된 회차가 아직 없어요.','empty-state'));
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
    const sessions=[...data.sessions].sort((a,b)=>(a.eventDate<today)-(b.eventDate<today)||((a.eventDate<today?b.eventDate.localeCompare(a.eventDate):a.eventDate.localeCompare(b.eventDate)))||a.startTime.localeCompare(b.startTime));
    for(const item of sessions){const card=node('article',undefined,'session-list-card');card.append(node('h3',sessionLabel(item.eventDate,item.startTime)),node('p','남성 '+item.maleCount+'명 · 여성 '+item.femaleCount+'명'),node('small','결제 '+item.paidCount+'명 · 참가 확정 '+item.confirmedCount+'명 · 선택 제출 '+item.submittedCount+'명'));const open=node('button','회차 관리하기','button secondary full');open.type='button';open.addEventListener('click',()=>openSession(item.eventDate,item.startTime));card.append(open);$('sessions-list').append(card);}
    $('sessions-content').hidden=false;$('sessions-login').hidden=true;notice();
  }
  function matchPartners(person){return current.pairs.flatMap(pair=>pair.male.applicationId===person.applicationId?[{...pair.female,gender:'여성'}]:pair.female.applicationId===person.applicationId?[{...pair.male,gender:'남성'}]:[]);}
  function message(person,partners){return '[오늘마주 매칭 결과]\n'+person.name+'님, 오늘마주에 함께해주셔서 감사합니다.\n\n'+(partners.length?'서로 마음이 닿은 분을 안내드려요.\n'+partners.map(p=>label(p.gender,p.number)+' '+p.name+'\n연락처 '+phone(p.phone)).join('\n\n'):'이번 회차에서는 서로 선택이 이어지지 않았어요.\n소중한 시간 함께해주셔서 감사합니다.');}
  async function copy(text,button){try{await navigator.clipboard.writeText(text);button.textContent='복사했어요';return true;}catch{notice('복사하지 못했어요. 화면의 문구를 직접 선택해 복사해주세요.');return false;}}
  function renderDetail(data){
    if(data.eventDate!==selected.date||data.startTime!==selected.time||!Array.isArray(data.attendees)||!Array.isArray(data.pairs)||data.attendees.some(p=>!idPattern.test(p.applicationId||'')))throw new Error('선택한 회차의 명단을 확인하지 못했어요.');
    current=data;$('session-issue').disabled=!data.confirmedCount;$('session-title').textContent=sessionLabel(data.eventDate,data.startTime);$('session-summary').textContent='결제 '+data.paidCount+'명 · 참가 확정 '+data.confirmedCount+'명 · 매칭 선택 '+data.submittedCount+'/'+data.confirmedCount+'명 제출';
    $('session-attendees').replaceChildren();$('session-pairs').replaceChildren();$('session-selections').replaceChildren();
    if(!data.attendees.length)$('session-attendees').append(node('p','이 회차의 결제자가 없어요.','empty-state'));
    const waiting=data.confirmedCount-data.submittedCount;
    for(const person of data.attendees){
      const row=node('a',undefined,'session-roster-row');row.href='/admin/?application='+person.applicationId;
      const identity=node('span',undefined,'session-roster-identity');identity.append(node('span',person.participantNumber?label(person.gender,person.participantNumber):person.gender,'session-roster-number'),node('strong',person.name));
      const height=Number(person.height),heightLabel=person.height!==null&&person.height!==undefined&&Number.isFinite(height)&&height>=120&&height<=230?height+'cm':'키 미입력';
      const summary=node('span',[heightLabel,typeof person.job==='string'&&person.job.trim()?person.job:'직업 미입력',typeof person.mbti==='string'&&person.mbti.trim()?person.mbti:'MBTI 미입력'].join(' · '),'session-roster-profile');
      const states=node('span',undefined,'session-roster-states');states.append(node('span',statuses[person.status]||person.status,'session-status '+(person.status==='confirmed'?'is-confirmed':'is-pending')),node('span',person.submittedAt?'매칭 제출':'매칭 미제출','session-status '+(person.submittedAt?'is-submitted':'is-pending')));
      row.append(identity,summary,states);$('session-attendees').append(row);
      if(person.status!=='confirmed')continue;
      const choice=node('article',undefined,'session-person');choice.append(node('strong',label(person.gender,person.participantNumber)+' · '+person.name));
      if(!person.submittedAt){choice.append(node('p','아직 매칭 선택을 제출하지 않았어요.'));$('session-selections').append(choice);continue;}
      const chosen=Array.isArray(person.selection)?person.selection:[],partners=matchPartners(person),choiceSummary=node('p',undefined,'session-choice-summary');
      choiceSummary.append(node('span','선택: '+(chosen.length?chosen.map(n=>label(person.gender==='남성'?'여성':'남성',n)).join(' · '):'선택한 상대 없음')),node('span',partners.length?'서로 선택: '+partners.map(p=>label(p.gender,p.number)+' '+p.name).join(' · '):'현재 서로 선택한 상대 없음'));choice.append(choiceSummary);
      if(!partners.length&&waiting>0)choice.append(node('small','다른 참가자의 제출을 기다리고 있어요. 미매칭 안내는 제출 현황을 확인한 뒤 준비해주세요.'));
      else{const details=node('details'),summary=node('summary','안내 문자 보기'),text=node('textarea');text.readOnly=true;text.rows=7;text.value=message(person,partners);text.setAttribute('aria-label',person.name+'님 매칭 안내 문자');const button=node('button','안내 문자 복사','button secondary full');button.type='button';button.addEventListener('click',()=>copy(text.value,button));details.append(summary,text,button);choice.append(details);}
      $('session-selections').append(choice);
    }
    $('session-match-status').textContent='서로 선택한 '+data.pairs.length+'쌍 · 선택 미제출 '+waiting+'명';
    if(!data.pairs.length)$('session-pairs').append(node('p',waiting?'제출된 선택을 대조하고 있어요. 아직 서로 선택한 매칭이 없어요.':'현재 서로 선택한 매칭이 없어요.','empty-state'));
    for(const pair of data.pairs){const card=node('article',undefined,'session-pair');card.append(node('strong','남성 '+pair.male.number+'호 ↔ 여성 '+pair.female.number+'호'),node('p','남성 '+phone(pair.male.phone)+' · 여성 '+phone(pair.female.phone)));$('session-pairs').append(card);}
    renderSettings(data);renderBatch();
  }
  async function openSession(date,time,{refresh=false}={}){
    if(busy)return;notice();const attempt=++sequence;selected={date,time};current=null;pending=pendingBatches.get(key(date,time))||null;$('sessions-list-screen').hidden=true;$('session-detail').hidden=false;$('session-title').textContent=sessionLabel(date,time);$('session-summary').textContent='명단과 매칭 선택을 불러오고 있어요.';for(const id of ['session-attendees','session-pairs','session-selections','session-qrs'])$(id).replaceChildren();$('session-qr-tools').hidden=true;$('session-replace-confirm').hidden=true;$('session-replace').checked=!!pending?.replaceExisting;$('session-replace').disabled=!!pending;$('session-issue-status').textContent='';if(!refresh)tab('attendees');
    try{const data=await api('/api/admin/sessions/detail?'+new URLSearchParams({eventDate:date,startTime:time}));if(attempt!==sequence)return;renderDetail(data);if(!refresh)$('session-title').focus();}
    catch(error){if(attempt===sequence){$('session-summary').textContent='명단을 불러오지 못했어요. 새로고침해주세요.';failure(error);}}
  }
  function renderBatch(){
    $('session-qrs').replaceChildren();$('session-qr-tools').hidden=true;if(!selected)return;const batch=batches.get(key(selected.date,selected.time));if(!batch)return;
    const available=batch.items.filter(x=>x.available);$('session-qr-tools').hidden=!available.length;$('session-issue-status').textContent='설정 적용·QR 준비 완료 · 확인 가능한 QR '+available.length+'개. 기존 QR '+batch.skippedCount+'개는 유지했어요.'+(batch.items.length!==available.length?' 새로 발급됐거나 종료된 QR은 제외했어요.':'');
    if(!available.length&&batch.skippedCount)$('session-issue-status').textContent+=' 저장해둔 기존 QR을 사용하거나, 기존 QR도 모두 새로 발급 옵션을 선택해주세요.';
    for(const person of batch.items){const card=node('article',undefined,'session-qr-card');card.append(node('strong',label(person.gender,person.participantNumber)+' · '+person.name));if(person.available){const qr=window.qrcode(0,'M'),link=window.location.origin+'/memo/#key='+person.qrToken;qr.addData(link);qr.make();person.image=qr.createDataURL(5,20);person.link=link;const img=node('img');img.src=person.image;img.alt=person.name+'님 개인 메모 QR';img.width=260;img.height=260;const open=node('a','개인 메모장 열기','inline-link');open.href=link;open.target='_blank';open.rel='noopener noreferrer';card.append(img,open);}else card.append(node('p','이 QR은 종료됐거나 새로 발급됐어요.'));$('session-qrs').append(card);}
  }
  function lock(value){busy=value;for(const id of ['session-issue','session-back','session-refresh','session-replace','session-replace-yes','session-replace-no','session-export','session-copy-links',...settingIds])$(id).disabled=value||id==='session-issue'&&!current?.confirmedCount||(id==='session-replace'||settingIds.includes(id))&&!!pending;}
  async function issue(){
    if(!selected||!current||!current.confirmedCount||busy)return;const scope={...selected},attempt=sequence;
    if(!pending){const maleOpponentCount=Number($('session-male-opponents').value),femaleOpponentCount=Number($('session-female-opponents').value),matchLimit=Number($('session-match-limit').value);
      if(![maleOpponentCount,femaleOpponentCount].every(n=>Number.isInteger(n)&&n>=1&&n<=13)||![2,3].includes(matchLimit)){$('session-issue-status').textContent='상대 번호 수는 1~13개, 최대 매칭 인원은 2명 또는 3명으로 설정해주세요.';return;}
      pending={eventDate:scope.date,startTime:scope.time,maleOpponentCount,femaleOpponentCount,matchLimit,replaceExisting:$('session-replace').checked,requestId:crypto.randomUUID(),seed:Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')};}
    pendingBatches.set(key(scope.date,scope.time),pending);
    lock(true);$('session-qrs').replaceChildren();$('session-qr-tools').hidden=true;$('session-issue-status').textContent='메모·매칭 설정을 적용하고 개인 QR을 준비하고 있어요.';
    try{const data=await api('/api/admin/sessions/issue',pending);if(attempt!==sequence)return;
      if(data.issued!==true||data.batchId!==pending.requestId||data.eventDate!==scope.date||data.startTime!==scope.time||!Array.isArray(data.items)||data.items.some(x=>!idPattern.test(x.applicationId||'')||(x.available&&!tokenPattern.test(x.qrToken||''))))throw new Error('발급 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해주세요.');
      const batchKey=key(scope.date,scope.time),previous=batches.get(batchKey),replace=pending.replaceExisting;const merged=new Map((!replace&&previous?previous.items:[]).map(x=>[x.applicationId,x]));for(const x of data.items)merged.set(x.applicationId,x);batches.set(batchKey,{...data,items:[...merged.values()],saved:false});pendingBatches.delete(batchKey);pending=null;$('session-replace-confirm').hidden=true;renderBatch();
      try{const fresh=await api('/api/admin/sessions/detail?'+new URLSearchParams({eventDate:scope.date,startTime:scope.time}));if(attempt===sequence)renderDetail(fresh);}catch(error){if(attempt===sequence)$('session-issue-status').textContent+=' QR 발급은 완료됐어요. 명단은 새로고침해서 확인해주세요.';}
    }catch(error){if(attempt===sequence){$('session-issue-status').textContent=error.message+([400,409].includes(error.status)?' 설정과 최신 명단을 확인한 뒤 다시 시도해주세요.':' 다시 누르면 같은 설정으로 발급 결과를 확인해요.');if([400,409].includes(error.status)){pendingBatches.delete(key(scope.date,scope.time));pending=null;}if([401,403].includes(error.status))failure(error);}}
    finally{if(attempt===sequence)lock(false);}
  }
  $('session-issue').addEventListener('click',()=>{if(busy)return;if(pending)return issue();if($('session-replace').checked){$('session-replace-confirm').hidden=false;return;}return issue();});
  $('session-replace-yes').addEventListener('click',()=>{if(!busy)$('session-replace').checked=true;return issue();});$('session-replace-no').addEventListener('click',()=>{$('session-replace-confirm').hidden=true;});
  $('session-copy-links').addEventListener('click',async()=>{const b=batches.get(key(selected.date,selected.time));if(b&&await copy(b.items.filter(x=>x.available).map(x=>label(x.gender,x.participantNumber)+' '+x.name+'\n'+x.link).join('\n\n'),$('session-copy-links')))b.saved=true;});
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  $('session-export').addEventListener('click',()=>{
    const b=batches.get(key(selected.date,selected.time));if(!b)return;const cards=b.items.filter(x=>x.available).map(x=>'<article><h2>'+escape(label(x.gender,x.participantNumber))+' · '+escape(x.name)+'</h2><p>'+escape(sessionLabel(b.eventDate,b.startTime))+'</p><img width="260" height="260" src="'+escape(x.image)+'" alt="개인 QR"><p>카메라로 QR을 스캔해주세요.</p></article>').join('');
    const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>오늘마주 개인 QR</title><style>body{font-family:Arial,sans-serif;text-align:center}main{display:grid;grid-template-columns:repeat(2,1fr);gap:15px}article{border:1px solid #d3c0ea;border-radius:15px;padding:20px;break-inside:avoid}h1{color:#70508c}h2{font-size:18px}img{max-width:100%;height:auto}@media print{button{display:none}article{break-inside:avoid}}</style><h1>오늘마주 개인 메모 QR</h1><button onclick="window.print()">인쇄하기</button><main>'+cards+'</main></html>';
    const uri=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),a=node('a');a.href=uri;a.download='oneulmaju-qr-'+b.eventDate+'-'+b.startTime.replace(':','')+'.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(uri),1000);b.saved=true;
  });
  $('session-back').addEventListener('click',()=>{if(busy)return;clearDetail();$('sessions-list-title').focus();});$('session-refresh').addEventListener('click',()=>{if(selected&&!busy)openSession(selected.date,selected.time,{refresh:true});});$('sessions-refresh').addEventListener('click',()=>loadList().catch(failure));
  window.addEventListener('beforeunload',event=>{if(pendingBatches.size||[...batches.values()].some(b=>b.items.some(x=>x.available)&&!b.saved)){event.preventDefault();event.returnValue='';}});
  (async()=>{await window.OneulReady;try{await loadList();}catch(error){failure(error);}})();
})();
