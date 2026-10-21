(() => {
  'use strict';const $=id=>document.getElementById(id),query=new URLSearchParams(window.location.search),orderId=query.get('orderId'),paymentKey=query.get('paymentKey'),amount=query.get('amount');
  history.replaceState(null,'',window.location.pathname+(orderId?'?orderId='+encodeURIComponent(orderId):''));
  if($('payment-failure')){$('payment-failure').textContent=query.get('code')==='PAY_PROCESS_CANCELED'?'결제를 중단했어요. 원할 때 다시 진행할 수 있어요.':'결제가 완료되지 않았어요. MY에서 신청 내역을 확인한 뒤 다시 진행해주세요.';return;}
  let running=false;
  async function confirm(){if(running)return;if(!orderId){$('payment-result-title').textContent='결제 정보를 확인할 수 없어요.';$('payment-result-status').textContent='MY에서 신청 내역을 확인해주세요.';return;}running=true;$('retry-payment').hidden=true;
    try{const data=await window.OneulAPI('/api/checkout/confirm',{orderId,paymentKey:paymentKey||undefined,amount:amount===null?undefined:Number(amount)});if(data.paid!==true)throw new Error('결제 완료 여부를 확인하지 못했어요.');const fullyCovered=data.paymentKind==='benefits'&&data.order.amount===0;$('payment-result-title').textContent=fullyCovered?'혜택으로 신청을 완료했어요.':'결제가 완료됐어요.';$('payment-result-status').textContent=(fullyCovered?'쿠폰·포인트를 사용해 추가 결제 금액은 0원이에요.':new Intl.NumberFormat('ko-KR').format(data.order.amount)+'원 결제를 확인했어요.')+' 프로필과 사진·직업 자료를 제출하면 참가 확인 절차가 진행돼요.';}
    catch(error){$('payment-result-title').textContent='결제 확인이 필요해요.';$('payment-result-status').textContent=error.message+' 다시 확인해도 같은 주문이 중복 승인되지 않아요.';$('retry-payment').hidden=false;}
    finally{running=false;}
  }
  $('retry-payment').addEventListener('click',confirm);confirm();
})();
