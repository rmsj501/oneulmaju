(() => {
  'use strict';
  const $=id=>document.getElementById(id),hearts=[...document.querySelectorAll('[data-rating]')];
  const tokenPattern=/^[a-f0-9]{64}$/,idPattern=/^[a-f0-9-]{36}$/i;
  // In-app link openers can append ?utm_* after the fragment. Ignore those URL
  // parameters (also when percent-encoded), then enforce the full 64-hex key.
  let qrToken=(new URLSearchParams(window.location.hash.slice(1)).get('key')||'').split(/[?&]/,1)[0].trim();
  let requestedPageId=new URLSearchParams(window.location.search||'').get('page')||'';
  if(window.location.hash)history.replaceState(null,'',window.location.pathname+(idPattern.test(requestedPageId)?'?page='+encodeURIComponent(requestedPageId):''));
  let page=null,entries=[],current=1,overview=false,timer=null,saving=false,pending=null,halted=false,hasSaved=false;
  let matching=false,matchState=null,matchDraft=[],matchNone=false,matchEditing=true,matchBusy=false,matchPending=null,matchLocked=false,matchTouched=false;
  const node=(tag,text,className)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;};
  async function api(path,body,method=body===undefined?'GET':'POST'){
    let response;try{response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',keepalive:method==='PUT'});}catch{throw new Error('연결이 끊겼어요. 입력 내용은 이 화면에 남아 있으니 다시 저장해주세요.');}
    const data=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error(data?.error||'메모를 확인하지 못했어요. 다시 시도해주세요.'),{status:response.status,code:data?.code});return data;
  }
  const dirty=item=>item.text!==item.savedText||item.hearts!==item.savedHearts;
  const unsaved=()=>!!pending||entries.some(dirty);
  function renderStatus(){
    $('memo-save-status').textContent=saving?'저장 중…':halted?'저장 확인 필요':unsaved()?'저장 대기':hasSaved?'저장 완료':'자동 저장';
    $('memo-save-status').setAttribute('data-state',halted?'error':'normal');$('memo-save-now').disabled=saving||halted||!unsaved();
  }
  function renderNumbers(){
    $('memo-numbers').replaceChildren();
    for(const item of entries){const button=node('button',item.number+'호');button.type='button';button.id='memo-number-'+item.number;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(item.number===current));button.setAttribute('aria-controls','memo-panel');button.setAttribute('tabindex',item.number===current?'0':'-1');button.setAttribute('data-written',String(!!item.text||item.hearts>0));button.addEventListener('click',()=>select(item.number));
      button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=current%entries.length+1;if(event.key==='ArrowLeft')next=(current+entries.length-2)%entries.length+1;if(event.key==='Home')next=1;if(event.key==='End')next=entries.length;if(next){event.preventDefault();select(next);$('memo-numbers').children[next-1].focus();}});$('memo-numbers').append(button);}
  }
  function renderHearts(){const item=entries[current-1];hearts.forEach((button,index)=>{button.setAttribute('data-filled',String(index<item.hearts));button.setAttribute('aria-checked',String(item.hearts===index+1));button.setAttribute('tabindex',String(item.hearts===index+1||(!item.hearts&&index===0)?0:-1));});$('memo-heart-status').textContent='관심도 '+item.hearts+'개';}
  function overviewHearts(count){
    const group=node('span',undefined,'memo-mini-hearts');group.setAttribute('role','img');group.setAttribute('aria-label','관심도 '+count+'/3');
    for(let index=0;index<3;index++){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('data-filled',String(index<count));
      path.setAttribute('d','M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z');svg.append(path);group.append(svg);
    }
    return group;
  }
  function renderOverview(){
    $('memo-overview-list').replaceChildren();const written=entries.filter(item=>item.text||item.hearts);
    if(!written.length)$('memo-overview-list').append(node('p','아직 작성한 메모가 없어요.','empty-state'));
    for(const item of written){const card=node('article',undefined,'memo-overview-card'),heading=node('div');heading.append(node('strong',(page.gender==='여성'?'남성 ':'여성 ')+item.number+'호'),overviewHearts(item.hearts));card.append(heading);if(item.text)card.append(node('p',item.text));const button=node('button','메모 열기','text-button');button.type='button';button.addEventListener('click',()=>{overview=false;select(item.number);$('memo-text').focus();});card.append(button);$('memo-overview-list').append(card);}
  }
  function render(){if(!page)return;$('memo-title').textContent=(page.gender==='여성'?'남성 ':'여성 ')+current+'호 메모';$('memo-text').value=entries[current-1].text;$('memo-editor').hidden=overview||matching;$('memo-overview').hidden=!overview||matching;$('memo-matching').hidden=!matching;$('memo-overview-toggle').hidden=matching;$('memo-match-back').hidden=!matching;$('memo-save-controls').hidden=matching;$('memo-match-entry').hidden=matching;$('memo-match-go').textContent=matchState?.version?'매칭 선택 확인하기':'매칭 상대 선택하기';$('memo-overview-toggle').textContent=overview?'작성하기':'모아보기';$('memo-overview-toggle').setAttribute('aria-expanded',String(overview));renderNumbers();renderHearts();if(overview)renderOverview();if(matching)renderMatching();renderStatus();}
  function select(number){if(!page)return;current=number;render();}
  function edited(){if(halted)return;hasSaved=false;$('memo-save-error').textContent='';clearTimeout(timer);timer=setTimeout(flush,700);renderNumbers();renderStatus();}
  $('memo-text').addEventListener('input',()=>{if(!page)return;entries[current-1].text=$('memo-text').value;edited();});
  const chooseHeart=value=>{if(!page)return;entries[current-1].hearts=value;renderHearts();edited();};
  hearts.forEach((button,index)=>{button.addEventListener('click',()=>chooseHeart(entries[current-1].hearts===index+1?0:index+1));button.addEventListener('keydown',event=>{const value=entries[current-1]?.hearts||0;let next;if(event.key==='ArrowRight'||event.key==='ArrowUp')next=Math.min(3,value+1);if(event.key==='ArrowLeft'||event.key==='ArrowDown')next=Math.max(0,value-1);if(event.key==='Home'||event.key==='Delete'||event.key==='Backspace')next=0;if(event.key==='End')next=3;if(next!==undefined){event.preventDefault();chooseHeart(next);hearts[Math.max(0,next-1)].focus();}});});
  async function flush(){
    clearTimeout(timer);if(!page||saving||halted)return;
    const changed=entries.find(dirty);if(!pending&&!changed){renderStatus();return;}
    if(!pending)pending={pageId:page.id,opponentNumber:changed.number,text:changed.text,hearts:changed.hearts,expectedVersion:changed.version,mutationId:crypto.randomUUID()};
    const sent=pending;saving=true;renderStatus();
    let success=false;
    try{const data=await api('/api/memo',sent,'PUT'),saved=data.entry;
      if(data.saved!==true||data.pageId!==page.id||saved?.opponentNumber!==sent.opponentNumber||saved.text!==sent.text||saved.hearts!==sent.hearts||!Number.isInteger(saved.version)||saved.version!==sent.expectedVersion+1)throw new Error('저장 결과를 확인하지 못했어요. 같은 내용으로 다시 저장해주세요.');
      const item=entries[sent.opponentNumber-1];item.savedText=sent.text;item.savedHearts=sent.hearts;item.version=saved.version;pending=null;hasSaved=true;success=true;$('memo-save-now').textContent='지금 저장';$('memo-save-error').textContent='';
    }catch(error){$('memo-save-error').textContent=error.message;hasSaved=false;if([401,403,409].includes(error.status)){halted=true;$('memo-reload').hidden=error.status!==409;}$('memo-save-now').textContent='다시 저장';}
    finally{saving=false;renderStatus();if(success&&unsaved())timer=setTimeout(flush,0);}
  }
  $('memo-save-now').addEventListener('click',flush);
  $('memo-overview-toggle').addEventListener('click',()=>{overview=!overview;render();});
  $('memo-reload').addEventListener('click',()=>{$('memo-reload-confirm').hidden=false;});
  $('memo-reload-no').addEventListener('click',()=>{$('memo-reload-confirm').hidden=true;});
  $('memo-reload-yes').addEventListener('click',async()=>{if(saving)return;try{const data=await api('/api/memo?pageId='+encodeURIComponent(page.id));loadData(data);$('memo-reload-confirm').hidden=true;$('memo-reload').hidden=true;$('memo-save-error').textContent='';}catch(error){$('memo-save-error').textContent=error.message;}});
  function loadData(data){
    const p=data?.page;if(!p||!idPattern.test(p.id||'')||!['남성','여성'].includes(p.gender)||!Number.isInteger(p.participantNumber)||p.participantNumber<1||p.participantNumber>13||!Number.isInteger(p.opponentCount)||p.opponentCount<1||p.opponentCount>13||!Number.isFinite(Date.parse(p.eventDate+'T00:00:00+09:00'))||!Number.isFinite(Date.parse(p.expiresAt))||!Array.isArray(data.entries))throw new Error('메모장 정보를 확인하지 못했어요. 내 QR로 다시 접속해주세요.');
    setMatching(data.matching||{limit:Math.min(3,p.opponentCount),numbers:[],version:0,submittedAt:null},p);
    page=p;pending=null;halted=false;entries=Array.from({length:p.opponentCount},(_,i)=>({number:i+1,text:'',hearts:0,savedText:'',savedHearts:0,version:0}));
    for(const item of data.entries){if(!Number.isInteger(item.opponentNumber)||item.opponentNumber<1||typeof item.text!=='string'||!Number.isInteger(item.hearts)||item.hearts<0||item.hearts>3||!Number.isInteger(item.version)||item.version<1)throw new Error('저장된 메모를 확인하지 못했어요.');if(item.opponentNumber>p.opponentCount){if(!item.text&&!item.hearts)continue;throw new Error('저장된 상대 번호를 확인하지 못했어요.');}Object.assign(entries[item.opponentNumber-1],{text:item.text,hearts:item.hearts,savedText:item.text,savedHearts:item.hearts,version:item.version});}
    const date=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(new Date(p.eventDate+'T12:00:00+09:00'));
    const hour=Number(p.startTime.slice(0,2));$('memo-event').textContent=date+' · '+(hour<12?'오전 ':'오후 ')+(hour%12||12)+'시'+(p.startTime.slice(3,5)==='00'?'':' '+Number(p.startTime.slice(3,5))+'분');$('memo-owner').textContent='나의 번호 · '+p.gender+' '+p.participantNumber+'호';
    $('memo-expiry').textContent=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',timeZone:'Asia/Seoul'}).format(new Date(Date.parse(p.expiresAt)-1))+'까지 다시 확인할 수 있어요.';current=Math.min(current,p.opponentCount);$('memo-workspace').hidden=false;$('memo-loading').hidden=true;$('memo-entry-error').hidden=true;render();
  }
  function setMatching(value,p=page){
    if(!value||!Number.isInteger(value.limit)||value.limit<1||value.limit>Math.min(3,p.opponentCount)||!Array.isArray(value.numbers)||value.numbers.length>value.limit||new Set(value.numbers).size!==value.numbers.length||value.numbers.some(n=>!Number.isInteger(n)||n<1||n>p.opponentCount)||!Number.isInteger(value.version)||value.version<0||(value.version>0&&!Number.isFinite(Date.parse(value.submittedAt))))throw new Error('매칭 선택 정보를 확인하지 못했어요. 다시 연결해주세요.');
    matchState=value;matchDraft=[...value.numbers].sort((a,b)=>a-b);matchNone=value.version>0&&!matchDraft.length;matchEditing=value.version===0;matchPending=null;matchLocked=false;matchTouched=false;
    $('memo-match-confirm').hidden=true;$('memo-match-reload-panel').hidden=true;$('memo-match-error').textContent='';
  }
  const matchingUnsaved=()=>!!matchPending||!!(matchTouched&&(JSON.stringify(matchDraft)!==JSON.stringify(matchState?.numbers)||(!matchState?.version&&matchNone)));
  const choiceSummary=values=>values.length?values.map(n=>(page.gender==='여성'?'남성 ':'여성 ')+n+'호').join(' · '):'선택한 상대 없음';
  function renderMatching(){
    const locked=matchBusy||!!matchPending||matchLocked;
    $('memo-match-guide').textContent='최대 '+matchState.limit+'명까지 선택할 수 있어요. 꼭 모두 고르지 않아도 괜찮아요.';
    $('memo-match-form').hidden=!matchEditing;$('memo-match-receipt').hidden=matchEditing;
    $('memo-match-saved-summary').textContent=choiceSummary(matchState.numbers);
    $('memo-match-options').replaceChildren();
    for(const entry of entries){
      const chosen=matchDraft.includes(entry.number),button=node('button',undefined,'memo-match-choice'),heading=node('span',undefined,'memo-match-choice-heading');button.type='button';button.setAttribute('aria-pressed',String(chosen));button.disabled=locked||(!chosen&&matchDraft.length>=matchState.limit);button.setAttribute('aria-label',(page.gender==='여성'?'남성 ':'여성 ')+entry.number+'호'+(chosen?' 선택됨':''));
      heading.append(node('strong',(page.gender==='여성'?'남성 ':'여성 ')+entry.number+'호'),overviewHearts(entry.hearts),node('span',chosen?'✓':'+','memo-match-check'));button.append(heading,node('span',entry.text||'남겨둔 메모가 없어요.','memo-match-preview'));
      button.addEventListener('click',()=>{if(locked)return;if(chosen)matchDraft=matchDraft.filter(n=>n!==entry.number);else if(matchDraft.length<matchState.limit)matchDraft.push(entry.number);matchDraft.sort((a,b)=>a-b);matchNone=false;matchTouched=true;$('memo-match-confirm').hidden=true;renderMatching();$('memo-match-options').children[entry.number-1].focus();});$('memo-match-options').append(button);
    }
    $('memo-match-none').checked=matchNone;$('memo-match-none').disabled=locked;
    $('memo-match-count').textContent=matchDraft.length+' / '+matchState.limit+'명 선택';
    $('memo-match-review').disabled=locked||(!matchDraft.length&&!matchNone);
    $('memo-match-submit').disabled=matchBusy||matchLocked;$('memo-match-cancel').disabled=locked;$('memo-match-edit').disabled=locked;
  }
  $('memo-match-go').addEventListener('click',async()=>{
    if(!page||saving||matchBusy){$('memo-match-entry-status').textContent='저장을 마친 뒤 다시 눌러주세요.';return;}
    $('memo-match-go').disabled=true;$('memo-match-entry-status').textContent='';
    try{while(unsaved()&&!halted){await flush();if($('memo-save-error').textContent)break;}if(unsaved()||halted){$('memo-match-entry-status').textContent='메모 저장 상태를 먼저 확인해주세요.';return;}matching=true;render();$('memo-match-title').focus();}
    finally{$('memo-match-go').disabled=false;}
  });
  $('memo-match-back').addEventListener('click',()=>{if(matchBusy)return;matching=false;render();$('memo-match-go').focus();});
  $('memo-match-none').addEventListener('change',()=>{if(matchBusy||matchPending||matchLocked)return;matchNone=$('memo-match-none').checked;if(matchNone)matchDraft=[];matchTouched=true;$('memo-match-confirm').hidden=true;renderMatching();});
  $('memo-match-review').addEventListener('click',()=>{if(matchBusy||matchPending||matchLocked||(!matchDraft.length&&!matchNone))return;$('memo-match-review-summary').textContent=choiceSummary(matchDraft);$('memo-match-confirm').hidden=false;$('memo-match-submit').focus();});
  $('memo-match-cancel').addEventListener('click',()=>{if(matchBusy||matchPending)return;$('memo-match-confirm').hidden=true;$('memo-match-review').focus();});
  $('memo-match-edit').addEventListener('click',()=>{matchEditing=true;renderMatching();$('memo-match-title').focus();});
  $('memo-match-submit').addEventListener('click',async()=>{
    if(matchBusy||matchLocked||!page||(!matchDraft.length&&!matchNone))return;
    if(!matchPending)matchPending={pageId:page.id,numbers:[...matchDraft],expectedVersion:matchState.version,expectedLimit:matchState.limit,mutationId:crypto.randomUUID()};
    const sent=matchPending;matchBusy=true;$('memo-match-error').textContent='';$('memo-match-status').textContent='선택을 제출하고 있어요.';renderMatching();
    try{const data=await api('/api/memo/matching',sent,'PUT');
      if(data.submitted!==true||data.pageId!==page.id||data.matching?.version!==sent.expectedVersion+1||JSON.stringify(data.matching?.numbers)!==JSON.stringify(sent.numbers))throw new Error('제출 결과를 확인하지 못했어요. 같은 선택으로 다시 제출해주세요.');
      setMatching(data.matching);$('memo-match-status').textContent='선택 제출 완료';$('memo-match-submit').textContent='선택 제출하기';
    }catch(error){$('memo-match-error').textContent=error.message;$('memo-match-status').textContent='제출을 확인하지 못했어요.';$('memo-match-submit').textContent='같은 선택으로 다시 제출';if([401,403,409].includes(error.status)){matchLocked=true;$('memo-match-reload-panel').hidden=false;}}
    finally{matchBusy=false;renderMatching();}
  });
  $('memo-match-reload').addEventListener('click',async()=>{
    if(matchBusy)return;matchBusy=true;renderMatching();
    try{const data=await api('/api/memo?pageId='+encodeURIComponent(page.id));if(data.page?.id!==page.id)throw new Error('내 매칭 선택을 확인하지 못했어요. 내 QR로 다시 접속해주세요.');setMatching(data.matching);$('memo-match-status').textContent='저장된 선택을 불러왔어요.';}
    catch(error){$('memo-match-error').textContent=error.message;}finally{matchBusy=false;renderMatching();}
  });
  async function start(){
    $('memo-loading').hidden=false;$('memo-entry-error').hidden=true;
    try{let expected=requestedPageId||null;if(!qrToken&&expected&&!idPattern.test(expected))throw new Error('메모장 주소를 확인하지 못했어요. 내 개인 QR을 다시 열어주세요.');if(qrToken){if(!tokenPattern.test(qrToken))throw new Error('QR 주소가 올바르지 않아요. 현장에서 받은 QR을 다시 스캔해주세요.');const result=await api('/api/memo/exchange',{qrToken});if(result.exchanged!==true||!idPattern.test(result.pageId||''))throw new Error('메모장 연결을 확인하지 못했어요.');expected=result.pageId;}
      const data=await api('/api/memo'+(expected?'?pageId='+encodeURIComponent(expected):''));if(expected&&data?.page?.id!==expected)throw new Error('브라우저가 메모장 접속을 유지하지 못했어요. 새 창에서 QR을 다시 열어주세요.');loadData(data);
      requestedPageId=page.id;history.replaceState(null,'',window.location.pathname+'?page='+encodeURIComponent(page.id));
    }catch(error){$('memo-loading').hidden=true;$('memo-workspace').hidden=true;$('memo-entry-error').hidden=false;$('memo-entry-message').textContent=error.message;
      if(tokenPattern.test(qrToken)){$('memo-new-window').href=window.location.origin+'/memo/#key='+qrToken;$('memo-new-window').hidden=false;}
    }
  }
  $('memo-reconnect').addEventListener('click',start);
  window.addEventListener('online',()=>{if(unsaved()&&!halted)flush();});
  window.addEventListener('beforeunload',event=>{if(unsaved()||matchingUnsaved()){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&unsaved())flush();});
  start();
})();
