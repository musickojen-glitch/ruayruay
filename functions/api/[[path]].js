const MAX_RECEIPT = 5 * 1024 * 1024;
const MAX_ORIGINAL = 20 * 1024 * 1024;
const SMALL_FILE_LIMIT = 900 * 1024;
const manualDelivery = env => env.DELIVERY_MODE !== 'automatic';
function files(env) {
 if(!manualDelivery(env))return env.FILES;
 return {
  async put(key,bytes,options={}) {if(bytes.byteLength>SMALL_FILE_LIMIT)fail(413,'รูปหลักฐานหรือ QR ต้องไม่เกิน 900 KB');await env.DB.prepare('INSERT INTO rr_small_files(key,mime,size_bytes,data) VALUES (?,?,?,?)').bind(key,options.httpMetadata?.contentType||'image/jpeg',bytes.byteLength,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).run()},
  async get(key) {const row=await env.DB.prepare('SELECT mime,size_bytes,data FROM rr_small_files WHERE key=?').bind(key).first();return row?{body:new Uint8Array(row.data),size:row.size_bytes,httpMetadata:{contentType:row.mime}}:null},
  async head(key) {return env.DB.prepare('SELECT size_bytes AS size FROM rr_small_files WHERE key=?').bind(key).first()},
  async delete(key) {await env.DB.prepare('DELETE FROM rr_small_files WHERE key=?').bind(key).run()}
 };
}
const encoder = new TextEncoder();
const now = () => Date.now();
const uid = () => crypto.randomUUID();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
async function hash(value) {
 const bytes = typeof value === 'string' ? encoder.encode(value) : value;
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
}
function randomToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2,'0')).join(''); }
async function mac(secret, text) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))].map(x => x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b) { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
function cookie(request, name) { return request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1); }
async function signedCookie(env, role, subject, age) { const payload = role+'.'+subject+'.'+(now()+age*1000);return payload+'.'+await mac(env.SESSION_SECRET,payload); }
async function readSession(request,env,role) {
 const raw=cookie(request,role==='admin'?'__Host-rr_admin':role==='test'?'__Host-rr_test':'__Host-rr_guest');if(!raw)return null;
 const parts=raw.split('.');if(parts.length!==4||parts[0]!==role||!/^\d+$/.test(parts[2])||Number(parts[2])<=now())return null;
 if(!equal(parts[3],await mac(env.SESSION_SECRET,parts.slice(0,3).join('.'))))return null;
 return parts[1];
}
function sessionHeader(role,value,age) { return (role==='admin'?'__Host-rr_admin':role==='test'?'__Host-rr_test':'__Host-rr_guest')+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age; }
function credentialsReady(env) { return typeof env.SESSION_SECRET==='string'&&env.SESSION_SECRET.length>=32&&typeof env.ADMIN_SECRET==='string'&&env.ADMIN_SECRET.length>=32; }
function requireSetup(env) { if(!env.DB||(!manualDelivery(env)&&!env.FILES)||!credentialsReady(env))fail(503,'ร้านกำลังตั้งค่าระบบรับเงิน กรุณาลองใหม่ภายหลัง'); }
async function settings(env) { const rows=await env.DB.prepare('SELECT key,value FROM rr_settings').all();return Object.fromEntries(rows.results.map(x=>[x.key,x.value])); }
async function live(env) { const s=await settings(env);return { enabled:env.LIVE_CHECKOUT_ENABLED==='true'&&s.checkout_enabled==='true'&&!!s.payment_qr_key, settings:s }; }
async function checkoutAvailability(env,request) { const l=await live(env);const isTest=!!(request&&await readSession(request,env,'admin')&&await readSession(request,env,'test'));return {...l,isTest,enabled:l.enabled||isTest&&!!l.settings.payment_qr_key}; }
async function requireLive(env,request) { const l=await checkoutAvailability(env,request);if(!l.enabled)fail(503,'ร้านยังไม่เปิดรับชำระเงินจริง');return l; }
async function limit(request,env,scope,max=30) {
 const ip=request.headers.get('CF-Connecting-IP')||'local';const bucket=Math.floor(now()/60000);
 const key=scope+':'+await hash(env.SESSION_SECRET+ip)+':'+bucket;
 const row=await env.DB.prepare('INSERT INTO rr_rate_limits(key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits').bind(key,(bucket+2)*60000).first();
 if(row.hits>max)fail(429,'ทำรายการถี่เกินไป กรุณารอสักครู่');
 // Keep the rate-limit table bounded without deleting active windows.
 await env.DB.prepare('DELETE FROM rr_rate_limits WHERE expires_at < ?').bind(now()).run();
}
async function boundedBody(request,max) {
 const length=Number(request.headers.get('Content-Length'));if(Number.isFinite(length)&&length>max)fail(413,'ไฟล์หรือข้อมูลมีขนาดใหญ่เกินกำหนด');
 if(!request.body)fail(400,'ไม่พบข้อมูล');const reader=request.body.getReader();const chunks=[];let total=0;
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();fail(413,'ไฟล์หรือข้อมูลมีขนาดใหญ่เกินกำหนด')}chunks.push(value)}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
}
async function bodyJson(request) { if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'กรุณาส่งข้อมูล JSON');try{const value=JSON.parse(new TextDecoder().decode(await boundedBody(request,16384)));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'ข้อมูลไม่ถูกต้อง');return value}catch(e){if(e instanceof HttpError)throw e;fail(400,'ข้อมูลไม่ถูกต้อง')} }
function imageType(bytes) {
 if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
 if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x))return 'image/png';
 fail(415,'รองรับรูป JPG หรือ PNG เท่านั้น');
}
function jpegSize(bytes) {
 let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)continue;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===217||marker===218)break;if(marker===216||marker===1||(marker>=208&&marker<=215))continue;
 const len=(bytes[i]<<8)+bytes[i+1];if(len<2||i+len>bytes.length)break;
 if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:(bytes[i+5]<<8)+bytes[i+6],height:(bytes[i+3]<<8)+bytes[i+4]};i+=len;}return null;
}
function validId(id) { return /^RR-(?:\d{3}|D[1-8]-\d{2})$/.test(id); }
async function audit(env,action,orderId,detail='') { return env.DB.prepare('INSERT INTO rr_audit(id,action,order_id,detail,created_at) VALUES (?,?,?,?,?)').bind(uid(),action,orderId,detail,now()).run(); }
async function guest(request,env,responseHeaders,create=false) {
 let subject=await readSession(request,env,'guest');if(!subject&&create){subject=randomToken();responseHeaders.push(sessionHeader('guest',await signedCookie(env,'guest',subject,30*86400),30*86400))}
 if(!subject)fail(401,'กรุณาใช้เบราว์เซอร์เดียวกับที่สั่งซื้อ');return hash(subject);
}
async function admin(request,env) { if(!await readSession(request,env,'admin'))fail(401,'กรุณาเข้าสู่ระบบผู้ดูแล'); }
async function ownedOrder(request,env,id,headers) { const owner=await guest(request,env,headers);const order=await env.DB.prepare('SELECT * FROM rr_orders WHERE id=? AND owner_hash=?').bind(id,owner).first();if(!order)fail(404,'ไม่พบคำสั่งซื้อ');return order; }
function safeOrder(order,items) { return {id:order.id,isTest:!!order.is_test,totalSatang:order.total_satang,status:order.status,createdAt:order.created_at,expiresAt:order.expires_at,hasReceipt:!!order.receipt_id,rejectionReason:order.rejection_reason||'',items:items.map(x=>({id:x.product_id,title:x.title,priceSatang:x.unit_price_satang}))}; }
async function orderView(env,order,items) {
 const result=safeOrder(order,items);result.deliveryMode=items.every(x=>x.original_key==='manual')?'manual':'automatic';
 if(result.deliveryMode==='manual'){result.contact=await env.DB.prepare('SELECT method,value FROM rr_contacts WHERE order_id=?').bind(order.id).first();result.fulfillment=await env.DB.prepare('SELECT sent_at AS sentAt,note FROM rr_fulfillments WHERE order_id=?').bind(order.id).first()}
 return result;
}
function contactDetails(b) {
 const c=b.contact;if(!c||!['email','line'].includes(c.method)||typeof c.value!=='string')fail(400,'กรุณาระบุอีเมลหรือ LINE ID สำหรับรับไฟล์');
 const value=c.value.trim();if(value.length>254||/[\r\n\x00-\x1f]/.test(value)||(c.method==='email'?!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value):!/^@?[A-Za-z0-9._-]{3,100}$/.test(value)))fail(400,'กรุณาตรวจอีเมลหรือ LINE ID ให้ถูกต้อง');return {method:c.method,value};
}
async function orderItems(env,id) { return (await env.DB.prepare('SELECT * FROM rr_order_items WHERE order_id=? ORDER BY product_id').bind(id).all()).results; }
async function fileResponse(env,key,downloadName) {
 const object=await files(env).get(key);if(!object)fail(404,'ไม่พบไฟล์ กรุณาติดต่อร้าน');
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Content-Disposition':(downloadName?'attachment; filename="'+downloadName+'"':'inline'),'Content-Length':String(object.size)}});
}
async function dispatch(request,env,headers) {
 const url=new URL(request.url);const path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');const method=request.method;
 if(!['GET','POST','PUT'].includes(method))fail(405,'ไม่รองรับวิธีเรียกนี้');
 if(method!=='GET'&&request.headers.get('Origin')!==url.origin)fail(403,'กรุณาทำรายการจากเว็บไซต์ร้านเท่านั้น');
 if(path==='config'&&method==='GET') {
  if(!env.DB||(!manualDelivery(env)&&!env.FILES)||!credentialsReady(env))return json({enabled:false,mode:'setup',deliveryMode:manualDelivery(env)?'manual':'automatic',message:'ร้านยังไม่เปิดรับชำระเงินจริง'});
  try{const l=await checkoutAvailability(env,request);return json({enabled:l.enabled,deliveryMode:manualDelivery(env)?'manual':'automatic',mode:l.isTest?'owner-test':l.enabled?'manual':'closed',recipient:l.enabled?l.settings.payment_recipient:undefined,message:l.isTest?'ทดสอบส่วนตัวของเจ้าของร้าน ยังไม่เปิดขายต่อสาธารณะ':l.enabled?'ร้านตรวจเงินเข้าด้วยตนเองก่อนส่งไฟล์':'ร้านยังไม่เปิดรับชำระเงินจริง'})}catch{return json({enabled:false,mode:'setup',deliveryMode:manualDelivery(env)?'manual':'automatic',message:'ร้านกำลังเตรียมระบบรับเงิน'})}
 }
 requireSetup(env);
 if(path==='admin/login'&&method==='POST') {
  await limit(request,env,'login',5);const b=await bodyJson(request);
  if(typeof b.password!=='string'||!equal(await hash(b.password),await hash(env.ADMIN_SECRET)))fail(401,'รหัสผ่านไม่ถูกต้อง');
  headers.push(sessionHeader('admin',await signedCookie(env,'admin','owner',8*3600),8*3600));await audit(env,'login',null);return json({ok:true});
 }
 if(path.startsWith('admin/')) {
  await admin(request,env);await limit(request,env,'admin',120);
  if(path==='admin/logout'&&method==='POST'){headers.push(sessionHeader('admin','',0),sessionHeader('test','',0));return json({ok:true})}
  if(path==='admin/test-checkout'&&method==='POST'){const b=await bodyJson(request);headers.push(sessionHeader('test',b.enabled?await signedCookie(env,'test','owner',1800):'',b.enabled?1800:0));return json({ok:true})}
  if(path==='admin/status'&&method==='GET') {const l=await live(env);const rows=await env.DB.prepare('SELECT id,title,price_satang,ready FROM rr_products ORDER BY id').all();return json({enabled:l.enabled,deliveryMode:manualDelivery(env)?'manual':'automatic',environmentAllowsLive:env.LIVE_CHECKOUT_ENABLED==='true',hasQr:!!l.settings.payment_qr_key,recipient:l.settings.payment_recipient,products:rows.results})}
  if(path==='admin/orders'&&method==='GET') {
   const status=url.searchParams.get('status')||'review';if(!['review','pending','paid','rejected','refunded'].includes(status))fail(400,'สถานะไม่ถูกต้อง');
   const rows=await env.DB.prepare('SELECT o.id,o.total_satang,o.status,o.created_at,o.receipt_id,o.is_test,f.sent_at FROM rr_orders o LEFT JOIN rr_fulfillments f ON f.order_id=o.id WHERE o.status=? ORDER BY o.created_at DESC LIMIT 100').bind(status).all();return json({orders:rows.results});
  }
  if(path==='admin/payment-qr'&&method==='PUT') {
   const bytes=await boundedBody(request,manualDelivery(env)?SMALL_FILE_LIMIT:3*1024*1024);const mime=imageType(bytes);const key='payment-qr/'+uid();
   const old=await settings(env);await files(env).put(key,bytes,{httpMetadata:{contentType:mime}});await env.DB.prepare('INSERT INTO rr_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('payment_qr_key',key).run();if(old.payment_qr_key&&manualDelivery(env))await files(env).delete(old.payment_qr_key);await audit(env,'qr_uploaded',null);return json({ok:true});
  }
  if(path==='admin/payment-qr'&&method==='GET'){const s=await settings(env);if(!s.payment_qr_key)fail(404,'ยังไม่มี QR');return fileResponse(env,s.payment_qr_key)}
  const original=path.match(/^admin\/products\/([^/]+)\/original$/);
  if(original&&method==='PUT') {
   if(manualDelivery(env))fail(409,'โหมดส่งเอง เก็บต้นฉบับใน Drive เดิม ไม่ต้องอัปโหลดที่นี่');
   const id=original[1];if(!validId(id))fail(400,'รหัสสินค้าไม่ถูกต้อง');const p=await env.DB.prepare('SELECT id FROM rr_products WHERE id=?').bind(id).first();if(!p)fail(404,'ไม่พบสินค้า');
   const bytes=await boundedBody(request,MAX_ORIGINAL);if(imageType(bytes)!=='image/jpeg')fail(415,'ต้นฉบับชุดนี้ต้องเป็น JPG');const size=jpegSize(bytes);if(size?.width!==2160||size?.height!==3840)fail(400,'ต้นฉบับต้องมีขนาด 2160×3840 พิกเซล');
   const key='originals/'+id+'/'+uid()+'.jpg';await env.FILES.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
   await env.DB.prepare('UPDATE rr_products SET original_key=?,original_sha256=?,ready=1 WHERE id=?').bind(key,await hash(bytes),id).run();await audit(env,'original_uploaded',null,id);return json({ok:true,id});
  }
  if(path==='admin/settings'&&method==='POST') {
   const b=await bodyJson(request);if(typeof b.enabled!=='boolean')fail(400,'สถานะไม่ถูกต้อง');const s=await settings(env);
   if(b.enabled){if(env.LIVE_CHECKOUT_ENABLED!=='true')fail(409,'ต้องผ่านการทดสอบและเปิด LIVE_CHECKOUT_ENABLED ในการตั้งค่าก่อน');if(!s.payment_qr_key||b.qrRecipientVerified!==true||b.fulfillmentTested!==true)fail(409,'ต้องตรวจชื่อผู้รับ QR และทดสอบส่งไฟล์ก่อน');const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM rr_products'+(manualDelivery(env)?'':' WHERE ready=1')).first();if(!count.n)fail(409,'ยังไม่มีสินค้าพร้อมส่ง');}
   await env.DB.prepare('UPDATE rr_settings SET value=? WHERE key=?').bind(String(b.enabled),'checkout_enabled').run();await audit(env,'checkout_'+(b.enabled?'enabled':'disabled'),null);return json({ok:true,enabled:b.enabled});
  }
  const match=path.match(/^admin\/orders\/([a-f0-9-]+)(?:\/(receipt|approve|reject|refund|fulfill))?$/);
  if(match) {
   const [,id,action]=match;const order=await env.DB.prepare('SELECT * FROM rr_orders WHERE id=?').bind(id).first();if(!order)fail(404,'ไม่พบคำสั่งซื้อ');
   if(!action&&method==='GET'){const payment=await env.DB.prepare('SELECT transaction_ref,amount_satang,transferred_at,approved_at FROM rr_payments WHERE order_id=?').bind(id).first();return json({...await orderView(env,order,await orderItems(env,id)),receiptId:order.receipt_id,payment})}
   if(action==='fulfill'&&method==='POST') {
    const b=await bodyJson(request);if(order.status!=='paid')fail(409,'ต้องตรวจเงินเข้าก่อนบันทึกส่งไฟล์');if(b.sentConfirmed!==true||typeof b.note!=='string'||b.note.trim().length<3||b.note.length>300)fail(400,'ระบุช่องทางส่งและยืนยันว่าได้ส่งไฟล์แล้ว');
    const contact=await env.DB.prepare('SELECT method,value FROM rr_contacts WHERE order_id=?').bind(id).first();if(!contact)fail(409,'รายการนี้ไม่ใช่การส่งเอง');
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO rr_fulfillments(order_id,sent_at,note) SELECT id,?,? FROM rr_orders WHERE id=? AND status=?').bind(now(),b.note.trim(),id,'paid'),env.DB.prepare('INSERT INTO rr_audit(id,action,order_id,detail,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rr_fulfillments WHERE order_id=?)').bind(uid(),'manual_delivery_recorded',id,'owner confirms file sent',now(),id)]);
    const sent=await env.DB.prepare('SELECT sent_at AS sentAt,note FROM rr_fulfillments WHERE order_id=?').bind(id).first();if(!sent)fail(409,'สถานะรายการเปลี่ยนแล้ว');return json({ok:true,fulfillment:sent});
   }
   if(action==='receipt'&&method==='GET'){const receipt=await env.DB.prepare('SELECT object_key FROM rr_receipts WHERE id=? AND order_id=?').bind(order.receipt_id,id).first();if(!receipt)fail(404,'ยังไม่มีหลักฐาน');return fileResponse(env,receipt.object_key)}
   if(action==='approve'&&method==='POST') {
    const b=await bodyJson(request);const ref=typeof b.transactionRef==='string'?b.transactionRef.trim().replace(/\s/g,'').toUpperCase():'';
    if(!/^[A-Z0-9._-]{4,120}$/.test(ref)||b.bankConfirmed!==true||b.recipientConfirmed!==true||b.amountSatang!==order.total_satang)fail(400,'ต้องยืนยันยอด ผู้รับ และเงินเข้าจริง พร้อมเลขอ้างอิงธุรกรรม');
    if(!Number.isSafeInteger(b.transferredAt)||b.transferredAt<order.created_at-300000||b.transferredAt>now()+300000)fail(400,'เวลารับเงินไม่ถูกต้อง');
    if(order.status==='paid'){const p=await env.DB.prepare('SELECT transaction_ref FROM rr_payments WHERE order_id=?').bind(id).first();if(p?.transaction_ref===ref)return json({ok:true,status:'paid'});fail(409,'รายการนี้ยืนยันแล้ว')}
    if(order.status!=='review'||b.receiptId!==order.receipt_id)fail(409,'หลักฐานหรือสถานะเปลี่ยนแล้ว กรุณาเปิดรายการใหม่');
    try{const results=await env.DB.batch([
     env.DB.prepare('INSERT INTO rr_payments(order_id,receipt_id,transaction_ref,amount_satang,transferred_at,approved_at) SELECT id,receipt_id,?,?,?,? FROM rr_orders WHERE id=? AND status=? AND receipt_id=?').bind(ref,b.amountSatang,b.transferredAt,now(),id,'review',b.receiptId),
     env.DB.prepare('UPDATE rr_orders SET status=? WHERE id=? AND status=? AND receipt_id=? AND EXISTS (SELECT 1 FROM rr_payments WHERE order_id=? AND transaction_ref=?)').bind('paid',id,'review',b.receiptId,id,ref),
     env.DB.prepare('INSERT INTO rr_audit(id,action,order_id,detail,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rr_payments WHERE order_id=? AND transaction_ref=?)').bind(uid(),'payment_approved',id,'bank balance checked by owner',now(),id,ref)
    ]);if(results[0].meta.changes!==1||results[1].meta.changes!==1)fail(409,'รายการเปลี่ยนแล้ว กรุณาตรวจสอบใหม่')}catch(e){if(e instanceof HttpError)throw e;fail(409,'เลขอ้างอิงถูกใช้แล้ว หรือรายการถูกยืนยันพร้อมกัน')}
    return json({ok:true,status:'paid'});
   }
   if(action==='reject'&&method==='POST') {
    const b=await bodyJson(request);if(typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>300)fail(400,'กรุณาระบุเหตุผล');
    const r=await env.DB.prepare('UPDATE rr_orders SET status=?,rejection_reason=? WHERE id=? AND status=? AND receipt_id=?').bind('rejected',b.reason.trim(),id,'review',b.receiptId).run();if(!r.meta.changes)fail(409,'รายการเปลี่ยนแล้ว');await audit(env,'payment_rejected',id);return json({ok:true});
   }
   if(action==='refund'&&method==='POST') {
    const b=await bodyJson(request);if(b.refundCompleted!==true)fail(400,'ยืนยันหลังคืนเงินผ่านธนาคารแล้วเท่านั้น');const r=await env.DB.prepare('UPDATE rr_orders SET status=? WHERE id=? AND status=?').bind('refunded',id,'paid').run();if(!r.meta.changes)fail(409,'สถานะไม่รองรับ');await audit(env,'refund_recorded',id);return json({ok:true});
   }
  }
  fail(404,'ไม่พบรายการ');
 }
 if(path==='orders'&&method==='POST') {
  const availability=await requireLive(env,request);await limit(request,env,'new-order',12);const owner=await guest(request,env,headers,true);const b=await bodyJson(request);
  if(!Array.isArray(b.productIds)||b.productIds.length<1||b.productIds.length>50||b.productIds.some(id=>typeof id!=='string'||!validId(id)))fail(400,'รายการสินค้าไม่ถูกต้อง');
  if(typeof b.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(b.requestId))fail(400,'รหัสคำขอไม่ถูกต้อง');
  const contact=manualDelivery(env)?contactDetails(b):null;
  const ids=[...new Set(b.productIds)].sort();const previous=await env.DB.prepare('SELECT * FROM rr_orders WHERE owner_hash=? AND request_id=?').bind(owner,b.requestId).first();
  if(previous){const its=await orderItems(env,previous.id);if(JSON.stringify(its.map(x=>x.product_id))!==JSON.stringify(ids))fail(409,'คำขอเดิมมีสินค้าไม่ตรงกัน');const view=await orderView(env,previous,its);if(contact&&JSON.stringify(contact)!==JSON.stringify(view.contact))fail(409,'ช่องทางรับไฟล์ต่างจากรายการเดิม กรุณาสร้างรายการใหม่');return json(view)}
  const products=(await env.DB.prepare('SELECT * FROM rr_products WHERE '+(manualDelivery(env)?'':'ready=1 AND original_key IS NOT NULL AND ')+'id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id').bind(...ids).all()).results;
  if(products.length!==ids.length)fail(409,'บางภาพยังไม่พร้อมส่ง กรุณาเลือกภาพอื่น');
  if(!manualDelivery(env))for(const p of products)if(!await env.FILES.head(p.original_key))fail(503,'ไฟล์สินค้าบางภาพยังไม่พร้อม กรุณาลองใหม่ภายหลัง');
  const id=uid(),time=now(),total=products.reduce((sum,p)=>sum+p.price_satang,0);const order={id,owner_hash:owner,total_satang:total,status:'pending',created_at:time,expires_at:time+86400000,is_test:availability.isTest?1:0};
  try{await env.DB.batch([env.DB.prepare('INSERT INTO rr_orders(id,owner_hash,request_id,total_satang,status,created_at,expires_at,is_test) VALUES (?,?,?,?,?,?,?,?)').bind(id,owner,b.requestId,total,'pending',time,order.expires_at,order.is_test),...products.map(p=>env.DB.prepare('INSERT INTO rr_order_items(order_id,product_id,title,unit_price_satang,original_key) VALUES (?,?,?,?,?)').bind(id,p.id,p.title,p.price_satang,manualDelivery(env)?'manual':p.original_key)),...(contact?[env.DB.prepare('INSERT INTO rr_contacts(order_id,method,value) VALUES (?,?,?)').bind(id,contact.method,contact.value)]:[])])}catch{const previous=await env.DB.prepare('SELECT * FROM rr_orders WHERE owner_hash=? AND request_id=?').bind(owner,b.requestId).first();if(previous){const its=await orderItems(env,previous.id);if(JSON.stringify(its.map(x=>x.product_id))===JSON.stringify(ids)){const view=await orderView(env,previous,its);if(!contact||JSON.stringify(contact)===JSON.stringify(view.contact))return json(view)}}fail(409,'กรุณาลองสร้างคำสั่งซื้อใหม่')}
  return json(await orderView(env,order,await orderItems(env,id)),201);
 }
 const match=path.match(/^orders\/([a-f0-9-]+)(?:\/(receipt|qr|downloads))?$/);
 if(match) {
  const [,id,action]=match;const order=await ownedOrder(request,env,id,headers);
  if(!action&&method==='GET')return json(await orderView(env,order,await orderItems(env,id)));
  if(action==='qr'&&method==='GET'){const l=await requireLive(env,request);if(!['pending','review','rejected'].includes(order.status)||order.expires_at<=now())fail(409,'คำสั่งซื้อนี้ไม่รับชำระเพิ่ม');return fileResponse(env,l.settings.payment_qr_key)}
  if(action==='receipt'&&method==='POST') {
   await limit(request,env,'receipt',10);if(!['pending','rejected','review'].includes(order.status))fail(409,'รายการนี้ไม่รับหลักฐานเพิ่ม');
   if(order.expires_at<=now()&&order.status!=='review')fail(409,'คำสั่งซื้อหมดอายุ กรุณาติดต่อร้านหากโอนแล้ว');
   const bytes=await boundedBody(request,manualDelivery(env)?SMALL_FILE_LIMIT:MAX_RECEIPT),mime=imageType(bytes),digest=await hash(bytes);
   const previous=await env.DB.prepare('SELECT id,order_id FROM rr_receipts WHERE sha256=?').bind(digest).first();if(previous){if(previous.order_id===id&&previous.id===order.receipt_id)return json({ok:true,status:order.status});fail(409,'หลักฐานนี้ถูกส่งแล้ว กรุณาตรวจสอบรายการเดิม')}
   const receiptId=uid(),key='receipts/'+id+'/'+receiptId;await files(env).put(key,bytes,{httpMetadata:{contentType:mime}});
   try {const r=await env.DB.batch([
    env.DB.prepare('INSERT INTO rr_receipts(id,order_id,object_key,sha256,mime,size_bytes,created_at) SELECT ?,id,?,?,?,?,? FROM rr_orders WHERE id=? AND status IN (?,?,?) AND COALESCE(receipt_id,?)=?').bind(receiptId,key,digest,mime,bytes.length,now(),id,'pending','review','rejected','',order.receipt_id||''),
    env.DB.prepare('UPDATE rr_orders SET receipt_id=?,status=?,rejection_reason=NULL WHERE id=? AND status IN (?,?,?) AND COALESCE(receipt_id,?)=? AND EXISTS(SELECT 1 FROM rr_receipts WHERE id=?)').bind(receiptId,'review',id,'pending','review','rejected','',order.receipt_id||'',receiptId)
   ]);if(r[0].meta.changes!==1||r[1].meta.changes!==1)fail(409,'รายการเปลี่ยนแล้ว กรุณาโหลดใหม่')}catch(e){await files(env).delete(key);if(e instanceof HttpError)throw e;fail(409,'หลักฐานซ้ำหรือรายการเปลี่ยนแล้ว')}
   return json({ok:true,status:'review'});
  }
  if(action==='downloads'&&method==='POST') {
   const delivery=await orderView(env,order,await orderItems(env,id));if(delivery.deliveryMode==='manual')fail(409,'ร้านจะส่งไฟล์ให้ตามช่องทางที่ระบุในคำสั่งซื้อ');
   await limit(request,env,'download',30);if(order.status!=='paid')fail(403,'ดาวน์โหลดได้หลังร้านยืนยันเงินเข้าเท่านั้น');const b=await bodyJson(request);
   if(typeof b.productId!=='string'||!validId(b.productId))fail(400,'รหัสสินค้าไม่ถูกต้อง');const item=await env.DB.prepare('SELECT * FROM rr_order_items WHERE order_id=? AND product_id=?').bind(id,b.productId).first();if(!item)fail(404,'ไม่พบสินค้าในคำสั่งซื้อ');if(!await env.FILES.head(item.original_key))fail(503,'ไฟล์ยังไม่พร้อม กรุณาติดต่อร้าน');
   const token=randomToken(),expiresAt=now()+5*60000;await env.DB.prepare('INSERT INTO rr_download_tokens(token_hash,order_id,product_id,owner_hash,expires_at) VALUES (?,?,?,?,?)').bind(await hash(token),id,item.product_id,order.owner_hash,expiresAt).run();
   await env.DB.prepare('DELETE FROM rr_download_tokens WHERE expires_at < ?').bind(now()-86400000).run();return json({url:'/api/downloads/'+token,expiresAt});
  }
 }
 const download=path.match(/^downloads\/([a-f0-9]{64})$/);
 if(download&&method==='GET') {
  const owner=await guest(request,env,headers),digest=await hash(download[1]);
  const row=await env.DB.prepare('SELECT t.*,i.original_key FROM rr_download_tokens t JOIN rr_order_items i ON i.order_id=t.order_id AND i.product_id=t.product_id JOIN rr_orders o ON o.id=t.order_id WHERE t.token_hash=? AND t.owner_hash=? AND t.used_at IS NULL AND t.expires_at>? AND o.status=?').bind(digest,owner,now(),'paid').first();if(!row)fail(403,'ลิงก์หมดอายุ ใช้ไปแล้ว หรือไม่มีสิทธิ์ กรุณาขอลิงก์ใหม่');
  const file=await env.FILES.get(row.original_key);if(!file)fail(503,'ไฟล์ยังไม่พร้อม กรุณาติดต่อร้าน');
  const used=await env.DB.prepare('UPDATE rr_download_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM rr_orders WHERE id=? AND status=?) RETURNING token_hash').bind(now(),digest,now(),row.order_id,'paid').first();if(!used)fail(403,'ลิงก์หมดอายุหรือใช้ไปแล้ว');
  return new Response(file.body,{headers:{'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="'+row.product_id+'.jpg"','Content-Length':String(file.size)}});
 }
 fail(404,'ไม่พบรายการ');
}
export async function onRequest(context) {
 const cookies=[];let response;
 try{response=await dispatch(context.request,context.env,cookies)}catch(e){response=json({error:e instanceof HttpError?e.message:'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ภายหลัง'},e instanceof HttpError?e.status:503)}
 const h=new Headers(response.headers);h.set('Cache-Control','no-store, private');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('Cross-Origin-Resource-Policy','same-origin');h.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'; sandbox");for(const value of cookies)h.append('Set-Cookie',value);
 return new Response(response.body,{status:response.status,headers:h});
}
