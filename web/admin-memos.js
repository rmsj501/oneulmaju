(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=window.OneulAPI;
  let selected=null,info=null,busy=false,sequence=0,readerBusy=false,readSequence=0;
  function clearQR(){$('admin-memo-result').hidden=true;$('admin-memo-image').removeAttribute('src');$('admin-memo-link').removeAttribute('href');$('admin-memo-download').removeAttribute('href');$('admin-memo-copy').textContent='접속 링크 복사';}
  function showQR(data){
    if(data.issued!==true||!/^[a-f0-9]{64}$/.test(data.qrToken||'')||!Number.isInteger(data.participantNumber)||data.participantNumber<1||data.participantNumber>13||!Number.isInteger(data.opponentCount)||data.opponentCount<1||data.opponentCount>13||!['남성','여성'].includes(data.gender)||typeof data.eventDate!=='string'||typeof data.startTime!=='string')throw new Error('QR 정보를 확인하지 못했어요.');
    const link=window.location.origin+'/memo/#key='+data.qrToken,qr=window.qrcode(0,'M');qr.addData(link);qr.make();const image=qr.createDataURL(5,20);
    $('admin-memo-image').src=image;$('admin-memo-link').href=link;$('admin-memo-download').href=image;$('admin-memo-download').download='oneulmaju-'+data.eventDate+'-'+data.gender+'-'+data.participantNumber+'-memo-qr.gif';
    $('admin-memo-caption').textContent=data.eventDate+' '+data.startTime+' · '+data.gender+' '+data.participantNumber+'호';$('admin-memo-result').hidden=false;$('admin-memo-replace-confirm').hidden=true;info=data;$('admin-memo-issue').textContent='개인 QR 다시 발급';
  }
  $('admin-memo-existing').addEventListener('click',async()=>{
    if(!selected||busy||selected.status!=='confirmed'||selected.payment_status!=='paid')return;
    const id=selected.id,attempt=sequence;busy=true;clearQR();$('admin-memo-existing').disabled=true;$('admin-memo-status').textContent='발급된 QR을 불러오고 있어요.';
    try{
      const data=await api('/api/admin/memo/'+id+'/qr',{});if(attempt!==sequence||selected?.id!==id)return;
      if(data.retrieved!==true||data.applicationId!==id)throw new Error('선택한 참가자의 QR을 확인하지 못했어요.');
      showQR(data);$('admin-memo-status').textContent='같은 메모장으로 연결되는 QR을 불러왔어요. 기존에 전달한 QR도 계속 사용할 수 있어요.';
    }catch(error){if(attempt===sequence){clearQR();$('admin-memo-status').textContent=error.message;}}
    finally{if(attempt===sequence){busy=false;$('admin-memo-existing').disabled=false;}}
  });
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  function clearReader(){readSequence++;readerBusy=false;$('admin-memo-reader').hidden=true;$('admin-memo-view').disabled=false;$('admin-memo-summary').textContent='';$('admin-memo-match-summary').textContent='';$('admin-memo-read-status').textContent='';$('admin-memo-entries').replaceChildren();}
  function interest(count){
    const group=node('span',undefined,'admin-memo-hearts');group.setAttribute('role','img');group.setAttribute('aria-label','관심도 '+count+'/3');
    for(let index=0;index<3;index++){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('data-filled',String(index<count));
      path.setAttribute('d','M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z');svg.append(path);group.append(svg);
    }
    return group;
  }
  async function readMemos(){
    if(!selected||readerBusy||selected.status!=='confirmed'||selected.payment_status!=='paid')return;
    const id=selected.id,attempt=sequence,readAttempt=++readSequence;readerBusy=true;$('admin-memo-view').disabled=true;$('admin-memo-reader').hidden=false;$('admin-memo-entries').replaceChildren();$('admin-memo-summary').textContent='';$('admin-memo-match-summary').textContent='';$('admin-memo-read-status').textContent='저장된 메모를 불러오고 있어요.';$('admin-memo-read-title').focus();
    try{
      const data=await api('/api/admin/memo/'+id+'/entries');if(attempt!==sequence||readAttempt!==readSequence||selected?.id!==id)return;
      if(data.applicationId!==id||typeof data.issued!=='boolean')throw new Error('선택한 참가자의 메모를 확인하지 못했어요.');
      if(!data.issued){$('admin-memo-read-status').textContent='아직 개인 메모 QR을 발급하지 않았어요.';return;}
      const page=data.page;
      if(!page||!['남성','여성'].includes(page.gender)||!Number.isInteger(page.participantNumber)||page.participantNumber<1||page.participantNumber>13||!Number.isInteger(page.opponentCount)||page.opponentCount<1||page.opponentCount>13||typeof page.eventDate!=='string'||typeof page.startTime!=='string'||!Array.isArray(data.entries))throw new Error('메모 정보를 확인하지 못했어요. 다시 불러와주세요.');
      if(data.entries.some(entry=>!Number.isInteger(entry.opponentNumber)||entry.opponentNumber<1||entry.opponentNumber>page.opponentCount||typeof entry.text!=='string'||[...entry.text].length>500||!Number.isInteger(entry.hearts)||entry.hearts<0||entry.hearts>3))throw new Error('저장된 메모를 확인하지 못했어요. 다시 불러와주세요.');
      const entries=data.entries.filter(entry=>entry.text||entry.hearts).sort((a,b)=>a.opponentNumber-b.opponentNumber);
      $('admin-memo-summary').textContent=page.eventDate+' '+page.startTime+' · '+page.gender+' '+page.participantNumber+'호';
      const matching=data.matching;
      if(matching&&Number.isInteger(matching.version)&&matching.version>0){
        if(!Array.isArray(matching.numbers)||matching.numbers.some(n=>!Number.isInteger(n)||n<1||n>page.opponentCount))throw new Error('매칭 선택을 확인하지 못했어요.');
        $('admin-memo-match-summary').textContent='제출한 매칭 선택 · '+(matching.numbers.length?matching.numbers.map(n=>(page.gender==='여성'?'남성 ':'여성 ')+n+'호').join(' · '):'선택한 상대 없음');
      }else $('admin-memo-match-summary').textContent='매칭 선택을 아직 제출하지 않았어요.';
      for(const entry of entries){
        const card=node('article',undefined,'admin-memo-card'),heading=node('div',undefined,'admin-memo-card-heading');heading.append(node('strong',(page.gender==='여성'?'남성 ':'여성 ')+entry.opponentNumber+'호'),interest(entry.hearts));card.append(heading);
        card.append(node('p',entry.text||'작성한 메모 없이 관심도만 남겼어요.'));
        if(typeof entry.updatedAt==='string'&&Number.isFinite(Date.parse(entry.updatedAt))){const time=node('time',new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Seoul'}).format(new Date(entry.updatedAt))+' 저장');time.dateTime=entry.updatedAt;card.append(time);}
        $('admin-memo-entries').append(card);
      }
      $('admin-memo-read-status').textContent=entries.length?'작성한 메모 '+entries.length+'개를 확인했어요.':'아직 작성한 메모와 하트가 없어요.';
    }catch(error){if(attempt===sequence&&readAttempt===readSequence){$('admin-memo-entries').replaceChildren();$('admin-memo-summary').textContent='';$('admin-memo-match-summary').textContent='';$('admin-memo-read-status').textContent=error.message;}}
    finally{if(attempt===sequence&&readAttempt===readSequence){readerBusy=false;$('admin-memo-view').disabled=false;}}
  }
  $('admin-memo-view').addEventListener('click',readMemos);$('admin-memo-read-refresh').addEventListener('click',readMemos);
  $('admin-memo-read-close').addEventListener('click',()=>{clearReader();$('admin-memo-view').focus();});
  function reset(){sequence++;selected=null;info=null;busy=false;clearQR();clearReader();$('admin-memo-existing').disabled=false;$('admin-memo-issue').disabled=false;$('admin-memo-replace-yes').disabled=false;$('admin-memo-section').hidden=true;$('admin-memo-fields').hidden=true;$('admin-memo-replace-confirm').hidden=true;$('admin-memo-status').textContent='';}
  function open(item){reset();selected=item;$('admin-memo-section').hidden=item.status!=='confirmed'||item.payment_status!=='paid';$('admin-memo-expand').disabled=false;$('admin-memo-expand').hidden=false;$('admin-memo-number').value='';$('admin-memo-count').value='13';$('admin-memo-limit').value='3';$('admin-memo-limit-save').disabled=false;$('admin-memo-limit-status').textContent='';}
  $('admin-memo-expand').addEventListener('click',async()=>{
    if(!selected||busy)return;const id=selected.id,attempt=sequence;busy=true;$('admin-memo-expand').disabled=true;$('admin-memo-status').textContent='QR 발급 상태를 확인하고 있어요.';
    try{const result=await api('/api/admin/memo/'+id);if(attempt!==sequence||selected?.id!==id)return;if(typeof result.issued!=='boolean')throw new Error('발급 상태를 확인하지 못했어요.');info=result;$('admin-memo-limit').value=String(result.matchLimit||3);$('admin-memo-fields').hidden=false;$('admin-memo-expand').hidden=true;
      if(result.issued){$('admin-memo-number').value=String(result.participantNumber);$('admin-memo-count').value=String(result.opponentCount);$('admin-memo-issue').textContent='개인 QR 다시 발급';$('admin-memo-status').textContent='이미 발급된 QR은 ‘발급된 QR 보기’에서 확인할 수 있어요. 재발급하면 이전 QR의 접속은 종료돼요.';}
      else{$('admin-memo-issue').textContent='개인 QR 발급';$('admin-memo-status').textContent='번호를 비워두면 이 회차의 빈 번호를 배정해요. 상대 번호 수는 현장 인원에 맞춰주세요.';}
    }catch(error){if(attempt===sequence)$('admin-memo-status').textContent=error.message;}finally{if(attempt===sequence){busy=false;$('admin-memo-expand').disabled=false;}}
  });
  async function issue(){
    if(!selected||busy)return;const id=selected.id,attempt=sequence,count=Number($('admin-memo-count').value),number=$('admin-memo-number').value.trim()?Number($('admin-memo-number').value):null;
    if(!Number.isInteger(count)||count<1||count>13||(number!==null&&(!Number.isInteger(number)||number<1||number>13))){$('admin-memo-status').textContent='참가 번호와 상대 번호 수를 1~13 사이로 입력해주세요.';return;}
    clearReader();busy=true;$('admin-memo-existing').disabled=true;$('admin-memo-issue').disabled=true;$('admin-memo-replace-yes').disabled=true;$('admin-memo-status').textContent='개인 QR을 발급하고 있어요.';
    try{const data=await api('/api/admin/memo/'+id,{participantNumber:number,opponentCount:count,expectedUpdatedAt:info?.applicationUpdatedAt||selected.updated_at,replace:info?.issued===true});if(attempt!==sequence||selected?.id!==id)return;
      if(data.issued!==true||!/^[a-f0-9]{64}$/.test(data.qrToken||'')||!Number.isInteger(data.participantNumber)||data.opponentCount!==count)throw new Error('발급 결과를 확인하지 못했어요.');
      showQR(data);$('admin-memo-number').value=String(data.participantNumber);$('admin-memo-status').textContent='발급했어요. QR 이미지를 저장해 참가자 본인에게 전달해주세요. 작성된 내용은 ‘작성된 메모 보기’에서 확인할 수 있어요.';
    }catch(error){if(attempt===sequence){$('admin-memo-status').textContent=error.message;info=null;$('admin-memo-expand').hidden=false;$('admin-memo-fields').hidden=true;clearQR();}}finally{if(attempt===sequence){busy=false;$('admin-memo-existing').disabled=false;$('admin-memo-issue').disabled=false;$('admin-memo-replace-yes').disabled=false;}}
  }
  $('admin-memo-limit-save').addEventListener('click',async()=>{
    if(!selected||busy)return;const id=selected.id,attempt=sequence,limit=Number($('admin-memo-limit').value);if(![2,3].includes(limit))return;
    busy=true;$('admin-memo-limit-save').disabled=true;$('admin-memo-limit-status').textContent='회차의 선택 인원을 저장하고 있어요.';
    try{const data=await api('/api/admin/memo/'+id+'/matching-limit',{limit});if(attempt!==sequence||selected?.id!==id)return;if(data.updated!==true||data.applicationId!==id||data.limit!==limit)throw new Error('설정 결과를 확인하지 못했어요.');if(info)info.matchLimit=limit;clearReader();$('admin-memo-limit-status').textContent=data.eventDate+' '+data.startTime+' 회차는 최대 '+limit+'명까지 선택할 수 있어요.';}
    catch(error){if(attempt===sequence)$('admin-memo-limit-status').textContent=error.message;}
    finally{if(attempt===sequence){busy=false;$('admin-memo-limit-save').disabled=false;}}
  });
  $('admin-memo-issue').addEventListener('click',()=>{if(busy)return;if(info?.issued){$('admin-memo-replace-confirm').hidden=false;return;}issue();});
  $('admin-memo-replace-yes').addEventListener('click',issue);$('admin-memo-replace-no').addEventListener('click',()=>{$('admin-memo-replace-confirm').hidden=true;});
  $('admin-memo-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('admin-memo-link').href);$('admin-memo-copy').textContent='복사했어요';}catch{$('admin-memo-status').textContent='아래 메모장 열기 링크를 길게 눌러 복사해주세요.';}});
  window.OneulAdminMemo={open,reset};
})();
