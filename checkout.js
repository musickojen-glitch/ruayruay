'use strict';
const $=id=>document.getElementById(id);
const money=n=>(n/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})+' บาท';
const labels={pending:'รอชำระเงิน',review:'ส่งหลักฐานแล้ว รอร้านตรวจเงินเข้า',paid:'ร้านยืนยันเงินเข้าแล้ว',rejected:'กรุณาตรวจสอบหลักฐานและส่งใหม่',refunded:'ร้านบันทึกการคืนเงินแล้ว'};
let config={enabled:false},activeOrder=null,selection=[],requestId=null,busy=false;
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
function message(text,error=false){$('globalMessage').textContent=text;$('globalMessage').className='status'+(error?' error':'')}
async function api(path,options={}){const r=await fetch('/api/'+path,{credentials:'same-origin',...options});let data;try{data=await r.json()}catch{throw Error('ระบบยังไม่พร้อม กรุณาลองใหม่ภายหลัง')}if(!r.ok)throw Error(data.error||'ทำรายการไม่สำเร็จ');return data}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function row(title,value){const el=document.createElement('div');el.className='row';const name=document.createElement('span'),amount=document.createElement('strong');name.textContent=title;amount.textContent=value;el.append(name,amount);return el}
function updateHistory(){const history=read('rr_order_history',[]);$('orderHistory').replaceChildren(new Option('เลือกรายการ',''));if(Array.isArray(history))for(const id of history.slice(0,50))if(typeof id==='string')$('orderHistory').append(new Option(id,id));if(activeOrder)$('orderHistory').value=activeOrder.id}
function remember(id){const old=read('rr_order_history',[]);save('rr_order_history',[id,...(Array.isArray(old)?old:[]).filter(x=>x!==id)].slice(0,50));save('rr_last_order',id);updateHistory()}
function showCart(){activeOrder=null;$('orderSection').hidden=true;$('cartSection').hidden=false;$('createOrder').disabled=!config.enabled||!selection.length;requestId=crypto.randomUUID();updateHistory();message(config.mode==='owner-test'?'ทดสอบส่วนตัวเจ้าของร้าน · QR เป็นบัญชีจริง โอนเฉพาะเมื่อคุณตั้งใจทดสอบรับเงินจริง':config.enabled?'เลือกยืนยันรายการเพื่อรับเลขคำสั่งซื้อและ QR':'ร้านยังไม่เปิดรับชำระเงินจริง กรุณาอย่าโอนเงิน')}
async function refresh(){if(!activeOrder)return;const order=await api('orders/'+activeOrder.id);showOrder(order)}
function showOrder(order){
 activeOrder=order;$('cartSection').hidden=true;$('orderSection').hidden=false;$('orderId').textContent='เลขคำสั่งซื้อ '+order.id;$('orderItems').replaceChildren(...order.items.map(x=>row(x.title,money(x.priceSatang))));$('orderTotal').textContent='รวม '+money(order.totalSatang);$('orderStatus').textContent=labels[order.status]||order.status;
 if(order.rejectionReason)$('orderStatus').textContent+=' · '+order.rejectionReason;
 const expired=order.expiresAt<=Date.now()&&order.status!=='review';
 const canPay=config.enabled&&!expired&&['pending','review','rejected'].includes(order.status);
 $('paymentPanel').hidden=!canPay;$('downloadPanel').hidden=order.status!=='paid';
 if(canPay){$('paymentQr').src='/api/orders/'+order.id+'/qr';$('payAmount').textContent=money(order.totalSatang);$('recipient').textContent='ชื่อผู้รับ '+config.recipient;$('receiptForm').hidden=order.status==='review'}else $('paymentQr').removeAttribute('src');
 if(expired&&['pending','rejected'].includes(order.status))$('orderStatus').textContent+=' · รายการหมดอายุ หากโอนแล้วให้ติดต่อร้าน ห้ามโอนซ้ำ';
 $('downloadItems').replaceChildren();if(order.status==='paid')for(const item of order.items){const el=row(item.title,'');const b=document.createElement('button');b.textContent='ดาวน์โหลด JPG';b.onclick=async()=>{b.disabled=true;try{const link=await post('orders/'+order.id+'/downloads',{productId:item.id});const a=document.createElement('a');a.href=link.url;a.download=item.id+'.jpg';document.body.append(a);a.click();a.remove();message('เริ่มดาวน์โหลดแล้ว หากดาวน์โหลดไม่สำเร็จ กดขอลิงก์ใหม่ได้')}catch(e){message(e.message,true)}finally{b.disabled=false}};el.append(b);$('downloadItems').append(el)}
 remember(order.id);message((order.isTest?'ทดสอบส่วนตัวเจ้าของร้าน · ':'')+(order.status==='paid'?'ขอบคุณครับ ภาพที่เลือกพร้อมให้ดาวน์โหลดแล้ว':order.status==='review'?'ร้านได้รับหลักฐานแล้ว ไม่ต้องโอนซ้ำ':'ติดตามสถานะได้จากหน้านี้'));
}
$('createOrder').onclick=async()=>{if(busy)return;busy=true;$('createOrder').disabled=true;try{const order=await post('orders',{productIds:selection.map(x=>x.id),requestId});showOrder(order)}catch(e){message(e.message,true)}finally{busy=false;$('createOrder').disabled=!config.enabled||!selection.length}};
$('receiptForm').onsubmit=async e=>{e.preventDefault();if(busy||!activeOrder)return;const file=$('receiptFile').files[0];if(!file||!['image/jpeg','image/png'].includes(file.type)||file.size>5*1024*1024){message('กรุณาเลือก JPG / PNG ไม่เกิน 5 MB',true);return}busy=true;$('sendReceipt').disabled=true;try{await api('orders/'+activeOrder.id+'/receipt',{method:'POST',headers:{'Content-Type':file.type},body:file});$('receiptFile').value='';await refresh()}catch(err){message(err.message,true)}finally{busy=false;$('sendReceipt').disabled=false}};
$('refreshOrder').onclick=()=>refresh().catch(e=>message(e.message,true));$('newOrder').onclick=showCart;$('orderHistory').onchange=async e=>{if(!e.target.value)return;try{showOrder(await api('orders/'+e.target.value))}catch(err){message(err.message,true)}};
async function init(){
 try{const [cfg,catalog]=await Promise.all([api('config'),fetch('/catalog-real.json').then(r=>{if(!r.ok)throw Error('อ่านรายการสินค้าไม่ได้');return r.json()})]);config=cfg;const ids=read('rr_cart',[]);selection=catalog.products.filter(x=>Array.isArray(ids)&&ids.includes(x.id));$('cartSummary').replaceChildren(...selection.map(x=>row(x.name,money(x.priceTHB*100))));$('cartTotal').textContent='รวม '+selection.length+' ภาพ · '+money(selection.reduce((n,x)=>n+x.priceTHB*100,0));showCart();const last=read('rr_last_order',null);if(last&&!new URLSearchParams(location.search).has('new')){try{showOrder(await api('orders/'+last))}catch(e){message(e.message,true)}}}catch(e){message(e.message,true)}
}
setInterval(()=>{if(!document.hidden&&!busy&&activeOrder?.status==='review')refresh().catch(()=>{})},15000);init();
