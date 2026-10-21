(() => {
  'use strict';const $=id=>document.getElementById(id),dialog=$('admin-file-viewer');
  const image=$('admin-file-image'),pdf=$('admin-file-pdf'),download=$('admin-file-download'),status=$('admin-file-status');
  let serial=0,controller=null,objectUrl=null;
  function clear(){
    serial++;controller?.abort();controller=null;
    image.hidden=true;image.removeAttribute('src');pdf.hidden=true;pdf.removeAttribute('src');
    download.hidden=true;download.removeAttribute('href');status.textContent='';
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  }
  function close(){if(dialog.open)dialog.close();else clear();}
  async function open(path,label){
    clear();const request=serial;controller=new AbortController();
    $('admin-file-title').textContent=label;image.alt=label;status.textContent='자료를 불러오고 있어요.';
    if(!dialog.open)dialog.showModal();
    try{
      if(!/^\/api\/admin\/applications\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/file\/(face|fullbody|employment)$/.test(path))throw new Error('첨부 자료 경로를 확인하지 못했어요.');
      // Fetch within the logged-in frame. Opening an API URL in a new tab
      // changes the cookie partition and can lose the operator's session.
      const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      if(!response.ok){
        const data=await response.json().catch(()=>null);
        throw new Error(response.status===401?'운영자 로그인이 만료됐어요. 다시 로그인한 뒤 자료를 열어주세요.':data?.error||'첨부 자료를 불러오지 못했어요. 잠시 후 다시 열어주세요.');
      }
      const blob=await response.blob(),type=blob.type.split(';')[0],extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
      if(!extensions[type]||!blob.size||blob.size>8*1024*1024||(type==='application/pdf'&&!path.endsWith('/employment')))throw new Error('지원하는 사진 또는 직업 확인용 PDF 파일이 아니에요.');
      if(request!==serial)return;
      objectUrl=URL.createObjectURL(blob);download.href=objectUrl;download.download=label+'.'+extensions[type];download.hidden=false;
      if(type==='application/pdf'){pdf.src=objectUrl;pdf.hidden=false;status.textContent='PDF가 표시되지 않으면 파일 저장을 눌러 확인해주세요.';}
      else{image.src=objectUrl;image.hidden=false;status.textContent='';}
    }catch(error){if(request!==serial)return;status.textContent=error.name==='AbortError'?'불러오기가 중단됐어요. 다시 열어주세요.':error.message||'첨부 자료에 연결하지 못했어요. 다시 열어주세요.';}
  }
  image.addEventListener('error',()=>{if(!image.hidden)status.textContent='사진을 표시하지 못했어요. 파일을 저장해 확인해주세요.';});
  $('admin-file-close').addEventListener('click',close);dialog.addEventListener('close',clear);window.addEventListener('pagehide',clear);
  window.OneulAdminFile={open,close};
})();
