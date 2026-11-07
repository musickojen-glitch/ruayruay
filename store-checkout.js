'use strict';
// Keep the established catalog, preview dialog and cart; only replace the checkout entry point.
window.startCheckout=function(){if(!cart.length)return;save();location.assign('/checkout.html?new=1')};
const checkoutButton=document.getElementById('checkout');if(checkoutButton)checkoutButton.textContent='ดำเนินการสั่งซื้อ';
fetch('/api/config',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(config=>{if(config.enabled){const notice=document.querySelector('.test-notice');if(notice)notice.textContent=config.mode==='owner-test'?'ทดสอบส่วนตัวเจ้าของร้าน · ยังไม่เปิดขายต่อสาธารณะ · QR เป็นบัญชีรับเงินจริง':'ภาพละ 9 บาท · ส่งหลักฐานการโอน แล้วรอร้านตรวจเงินเข้า · รับไฟล์จากหน้าคำสั่งซื้อเดิม';}}).catch(()=>{});
