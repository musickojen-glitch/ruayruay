import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

// SQLite adapter exercises the actual SQL used against D1, including transaction rollback.
class DB {
 constructor(){this.sql=new DatabaseSync(':memory:');this.sql.exec(readFileSync(new URL('../migrations/0001_commerce.sql',import.meta.url),'utf8'));this.sql.exec(readFileSync(new URL('../migrations/0003_manual_delivery.sql',import.meta.url),'utf8'));}
 prepare(sql){const db=this;return {values:[],bind(...values){this.values=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this},async first(){return db.sql.prepare(sql).get(...this.values)||null},async all(){return {results:db.sql.prepare(sql).all(...this.values)}},async run(){const r=db.sql.prepare(sql).run(...this.values);return {meta:{changes:Number(r.changes)}}}}}
 async batch(statements){this.sql.exec('BEGIN');try{const result=[];for(const st of statements)result.push(await st.run());this.sql.exec('COMMIT');return result}catch(e){this.sql.exec('ROLLBACK');throw e}}
}
class Bucket {
 constructor(){this.objects=new Map()}
 async put(key,body,meta={}){this.objects.set(key,{body:new Uint8Array(body),httpMetadata:meta.httpMetadata||{},size:body.byteLength})}
 async get(key){const obj=this.objects.get(key);return obj?{...obj,body:obj.body.slice()}:null}
 async head(key){return this.objects.get(key)||null}
 async delete(key){this.objects.delete(key)}
}
function image(extra=0){return new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,11,8,15,0,8,112,1,1,17,0,extra,255,217])}
async function setup(enabled=true){
 const env={DELIVERY_MODE:'automatic',DB:new DB(),FILES:new Bucket(),SESSION_SECRET:'session-secret-for-tests-only-000000000000',ADMIN_SECRET:'admin-secret-for-tests-only-00000000000000',LIVE_CHECKOUT_ENABLED:enabled?'true':'false'};
 await env.FILES.put('original-a',image(),{httpMetadata:{contentType:'image/jpeg'}});await env.FILES.put('original-b',image(1));await env.FILES.put('qr',image());
 await env.DB.prepare('INSERT INTO rr_products(id,title,price_satang,original_key,ready) VALUES (?,?,?,?,?)').bind('RR-001','ภาพหนึ่ง',900,'original-a',1).run();
 await env.DB.prepare('INSERT INTO rr_products(id,title,price_satang,original_key,ready) VALUES (?,?,?,?,?)').bind('RR-002','ภาพสอง',900,'original-b',1).run();
 await env.DB.prepare('INSERT INTO rr_settings(key,value) VALUES (?,?)').bind('payment_qr_key','qr').run();await env.DB.prepare('UPDATE rr_settings SET value=? WHERE key=?').bind('true','checkout_enabled').run();
 function client(ip='192.0.2.1'){
  let cookies='';return { async call(path,{method='GET',body,json,origin='https://ruayruay.example',cookieOverride}={}){
   const headers=new Headers({'Origin':origin,'CF-Connecting-IP':ip});if(cookies)headers.set('Cookie',cookies);if(cookieOverride!==undefined)headers.set('Cookie',cookieOverride);
   if(json!==undefined){headers.set('Content-Type','application/json');body=JSON.stringify(json)}
   const response=await onRequest({env,request:new Request('https://ruayruay.example/api/'+path,{method,body,headers})});
   for(const c of response.headers.getSetCookie()){const value=c.split(';')[0],name=value.split('=')[0];cookies=cookies.split('; ').filter(x=>x&&!x.startsWith(name+'=')).concat(value).join('; ')}
   let data;if(response.headers.get('Content-Type')?.includes('application/json'))data=await response.json();else data=new Uint8Array(await response.arrayBuffer());return {status:response.status,data,headers:response.headers};
  },get cookie(){return cookies}};
 }
 const owner=client(),staff=client('192.0.2.2');await staff.call('admin/login',{method:'POST',json:{password:env.ADMIN_SECRET}});
 async function order(ids=['RR-001'],requestId=crypto.randomUUID(),customer=owner){const r=await customer.call('orders',{method:'POST',json:{productIds:ids,requestId,totalSatang:1}});assert.equal(r.status,201);return r.data}
 async function receipt(order,bytes=image(3),customer=owner){return customer.call('orders/'+order.id+'/receipt',{method:'POST',body:bytes})}
 async function approve(order,ref='BANK-REF-001',extra={}){const detail=await staff.call('admin/orders/'+order.id);return staff.call('admin/orders/'+order.id+'/approve',{method:'POST',json:{receiptId:detail.data.receiptId,transactionRef:ref,amountSatang:order.totalSatang,transferredAt:Date.now(),bankConfirmed:true,recipientConfirmed:true,...extra}})}
 return {env,client,owner,staff,order,receipt,approve};
}
test('fails closed without bindings, and never exposes QR while checkout is closed',async()=>{
 const r=await onRequest({env:{},request:new Request('https://ruayruay.example/api/config')});assert.equal((await r.json()).enabled,false);
 const s=await setup(false);const result=await s.owner.call('orders',{method:'POST',json:{productIds:['RR-001'],requestId:crypto.randomUUID()}});assert.equal(result.status,503);
 assert.equal((await s.client().call('admin/payment-qr')).status,401);
});
test('server calculates price, removes duplicate items, and persists idempotent order',async()=>{
 const s=await setup();const requestId=crypto.randomUUID();const o=await s.order(['RR-001','RR-002','RR-001'],requestId);assert.equal(o.totalSatang,1800);assert.equal(o.items.length,2);
 const retry=await s.owner.call('orders',{method:'POST',json:{productIds:['RR-002','RR-001'],requestId}});assert.equal(retry.status,200);assert.equal(retry.data.id,o.id);
 assert.equal((await s.owner.call('orders',{method:'POST',json:{productIds:['RR-001'],requestId}})).status,409);
});
test('CSRF, unknown products, unready assets, forged guest cookie and unauthorised orders fail',async()=>{
 const s=await setup();assert.equal((await s.owner.call('orders',{method:'POST',origin:'https://evil.example',json:{}})).status,403);
 assert.equal((await s.owner.call('orders',{method:'POST',json:{productIds:['RR-999'],requestId:crypto.randomUUID()}})).status,409);
 const o=await s.order();assert.equal((await s.client('192.0.2.3').call('orders/'+o.id)).status,401);
 assert.equal((await s.owner.call('orders/'+o.id,{cookieOverride:s.owner.cookie+'x'})).status,401);
 s.env.FILES.objects.delete('original-b');assert.equal((await s.owner.call('orders',{method:'POST',json:{productIds:['RR-002'],requestId:crypto.randomUUID()}})).status,503);
});
test('receipt is private and cannot mark an order paid; duplicate evidence is rejected',async()=>{
 const s=await setup();const o=await s.order();assert.equal((await s.receipt(o)).status,200);
 const state=await s.owner.call('orders/'+o.id);assert.equal(state.data.status,'review');assert.equal(JSON.stringify(state.data).includes('receipts/'),false);
 assert.equal((await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}})).status,403);
 const other=await s.order();assert.equal((await s.receipt(other)).status,409);assert.equal((await s.receipt(o)).status,200);
 assert.equal((await s.client().call('admin/orders/'+o.id+'/receipt')).status,401);
 assert.equal((await s.staff.call('admin/orders/'+o.id+'/receipt')).status,200);
});
test('manual approval requires correct amount, real-bank confirmation, recipient and current receipt',async()=>{
 const s=await setup();const o=await s.order();assert.equal((await s.approve(o)).status,409);await s.receipt(o);
 assert.equal((await s.approve(o,'REF-0001',{amountSatang:1})).status,400);
 assert.equal((await s.approve(o,'REF-0001',{bankConfirmed:false})).status,400);
 assert.equal((await s.approve(o,'REF-0001',{recipientConfirmed:false})).status,400);
 assert.equal((await s.approve(o,'REF-0001',{receiptId:'old-receipt'})).status,409);
 assert.equal((await s.approve(o,'REF-0001',{transferredAt:0})).status,400);
 assert.equal((await s.approve(o,'REF-0001')).status,200);assert.equal((await s.approve(o,'REF-0001')).status,200);
});
test('a bank transaction reference cannot pay two orders, including concurrent submissions',async()=>{
 const s=await setup();const a=await s.order(),b=await s.order();await s.receipt(a,image(5));await s.receipt(b,image(6));
 const results=await Promise.all([s.approve(a,'REF-DUPLICATE'),s.approve(b,'REF-DUPLICATE')]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 assert.equal(s.env.DB.sql.prepare('SELECT COUNT(*) AS n FROM rr_payments').get().n,1);
 assert.equal(s.env.DB.sql.prepare("SELECT COUNT(*) AS n FROM rr_orders WHERE status='paid'").get().n,1);
});
test('download requires paid order, ownership and unused unexpired token; refunds revoke outstanding links',async()=>{
 const s=await setup();const o=await s.order();await s.receipt(o);await s.approve(o);
 const link=await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}});assert.equal(link.status,200);
 assert.equal((await s.client().call(link.data.url.slice(5))).status,401);
 assert.equal((await s.owner.call(link.data.url.slice(5))).status,200);assert.equal((await s.owner.call(link.data.url.slice(5))).status,403);
 assert.equal((await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-002'}})).status,404);
 const expired=await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}});s.env.DB.sql.prepare('UPDATE rr_download_tokens SET expires_at=0').run();assert.equal((await s.owner.call(expired.data.url.slice(5))).status,403);
 const revoke=await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}});assert.equal((await s.staff.call('admin/orders/'+o.id+'/refund',{method:'POST',json:{refundCompleted:true}})).status,200);
 assert.equal((await s.owner.call(revoke.data.url.slice(5))).status,403);assert.equal((await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}})).status,403);
});
test('reject, upload corrected evidence, stale approval, file validation and missing download object',async()=>{
 const s=await setup();const o=await s.order();assert.equal((await s.receipt(o,new TextEncoder().encode('<svg>bad</svg>'))).status,415);await s.receipt(o);
 const before=(await s.staff.call('admin/orders/'+o.id)).data;
 assert.equal((await s.staff.call('admin/orders/'+o.id+'/reject',{method:'POST',json:{receiptId:before.receiptId,reason:'ยอดไม่ตรง'}})).status,200);
 assert.equal((await s.receipt(o,image(4))).status,200);assert.equal((await s.approve(o,'REF-STALE',{receiptId:before.receiptId})).status,409);await s.approve(o,'REF-CORRECT');
 s.env.FILES.objects.delete('original-a');assert.equal((await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}})).status,503);
});
test('login throttles, secrets are never returned, logout revokes client session',async()=>{
 const s=await setup();const client=s.client('192.0.2.9');for(let i=0;i<5;i++)assert.equal((await client.call('admin/login',{method:'POST',json:{password:'wrong'}})).status,401);
 assert.equal((await client.call('admin/login',{method:'POST',json:{password:s.env.ADMIN_SECRET}})).status,429);
 const status=await s.staff.call('admin/status');assert.equal(JSON.stringify(status.data).includes(s.env.ADMIN_SECRET),false);
 assert.equal((await s.staff.call('admin/logout',{method:'POST',json:{}})).status,200);assert.equal((await s.staff.call('admin/status')).status,401);
});
test('admin setup cannot enable checkout without explicit deployment gate and verified setup',async()=>{
 const s=await setup(false);assert.equal((await s.staff.call('admin/settings',{method:'POST',json:{enabled:true,qrRecipientVerified:true,fulfillmentTested:true}})).status,409);
 s.env.LIVE_CHECKOUT_ENABLED='true';assert.equal((await s.staff.call('admin/settings',{method:'POST',json:{enabled:true}})).status,409);
 assert.equal((await s.staff.call('admin/settings',{method:'POST',json:{enabled:true,qrRecipientVerified:true,fulfillmentTested:true}})).status,200);
 assert.equal((await s.staff.call('admin/settings',{method:'POST',json:{enabled:false}})).status,200);assert.equal((await s.owner.call('config')).data.enabled,false);
});
test('admin original upload validates dimensions and preserves private delivery snapshots',async()=>{
 const s=await setup();const o=await s.order();const r=await s.staff.call('admin/products/RR-001/original',{method:'PUT',body:image(9)});assert.equal(r.status,200);
 const item=s.env.DB.sql.prepare('SELECT original_key FROM rr_order_items WHERE order_id=?').get(o.id);assert.equal(item.original_key,'original-a');
 const bad=image(9);bad[15]=0;assert.equal((await s.staff.call('admin/products/RR-001/original',{method:'PUT',body:bad})).status,400);
});
test('owner can test end to end while checkout remains closed for public customers',async()=>{
 const s=await setup(false);assert.equal((await s.owner.call('config')).data.enabled,false);
 assert.equal((await s.owner.call('admin/test-checkout',{method:'POST',json:{enabled:true}})).status,401);
 assert.equal((await s.staff.call('admin/test-checkout',{method:'POST',json:{enabled:true}})).status,200);
 const cfg=await s.staff.call('config');assert.equal(cfg.data.enabled,true);assert.equal(cfg.data.mode,'owner-test');
 const o=await s.order(['RR-001'],crypto.randomUUID(),s.staff);assert.equal(o.isTest,true);assert.equal((await s.staff.call('orders/'+o.id+'/qr')).status,200);
 await s.receipt(o,image(22),s.staff);await s.approve(o,'REF-OWNER-TEST');assert.equal((await s.staff.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}})).status,200);
 assert.equal((await s.owner.call('config')).data.enabled,false);assert.equal((await s.owner.call('orders',{method:'POST',json:{productIds:['RR-001'],requestId:crypto.randomUUID()}})).status,503);
});
test('oversized receipts, invalid JSON shape and premature approval do not alter state',async()=>{
 const s=await setup();const o=await s.order();const large=new Uint8Array(5*1024*1024+1);assert.equal((await s.receipt(o,large)).status,413);
 assert.equal((await s.owner.call('orders',{method:'POST',json:null})).status,400);assert.equal((await s.owner.call('orders/'+o.id)).data.status,'pending');
});
test('manual delivery works without R2, saves private contact, and requires paid status before recording delivery',async()=>{
 const s=await setup();delete s.env.FILES;delete s.env.DELIVERY_MODE;
 assert.equal((await s.staff.call('admin/payment-qr',{method:'PUT',body:image(30)})).status,200);
 const requestId=crypto.randomUUID();const body={productIds:['RR-001'],requestId,contact:{method:'email',value:'buyer@example.com'}};
 const created=await s.owner.call('orders',{method:'POST',json:body});assert.equal(created.status,201);const o=created.data;
 assert.equal(o.deliveryMode,'manual');assert.equal(o.contact.value,'buyer@example.com');
 assert.equal((await s.owner.call('orders/'+o.id+'/qr')).status,200);
 assert.equal((await s.staff.call('admin/orders/'+o.id+'/fulfill',{method:'POST',json:{sentConfirmed:true,note:'sent via email'}})).status,409);
 const receipt=await s.receipt(o,image(31));assert.equal(receipt.status,200);assert.equal((await s.staff.call('admin/orders/'+o.id+'/receipt')).status,200);
 assert.equal((await s.approve(o,'BANK-MANUAL-001')).status,200);
 assert.equal((await s.owner.call('orders/'+o.id+'/downloads',{method:'POST',json:{productId:'RR-001'}})).status,409);
 assert.equal((await s.owner.call('admin/orders/'+o.id+'/fulfill',{method:'POST',json:{sentConfirmed:true,note:'sent via email'}})).status,401);
 assert.equal((await s.staff.call('admin/orders/'+o.id+'/fulfill',{method:'POST',json:{sentConfirmed:false,note:'sent via email'}})).status,400);
 assert.equal((await s.staff.call('admin/orders/'+o.id+'/fulfill',{method:'POST',json:{sentConfirmed:true,note:'sent via email'}})).status,200);
 const view=(await s.owner.call('orders/'+o.id)).data;assert.equal(view.status,'paid');assert.equal(view.fulfillment.note,'sent via email');assert.ok(view.fulfillment.sentAt);
 assert.equal((await s.client('192.0.2.99').call('orders/'+o.id)).status,401);
 assert.equal((await s.owner.call('orders',{method:'POST',json:body})).data.id,o.id);
 assert.equal((await s.owner.call('orders',{method:'POST',json:{...body,contact:{method:'email',value:'different@example.com'}}})).status,409);
 assert.equal(s.env.DB.sql.prepare('SELECT COUNT(*) AS n FROM rr_small_files').get().n,2);
});
test('manual delivery rejects missing or invalid contact and large receipts; accepts LINE ID and catalog without originals',async()=>{
 const s=await setup();delete s.env.FILES;s.env.DELIVERY_MODE='manual';s.env.DB.sql.prepare('UPDATE rr_products SET original_key=NULL,ready=0').run();
 await s.staff.call('admin/payment-qr',{method:'PUT',body:image(40)});
 const requestId=crypto.randomUUID(),base={productIds:['RR-002'],requestId};
 assert.equal((await s.owner.call('orders',{method:'POST',json:base})).status,400);
 assert.equal((await s.owner.call('orders',{method:'POST',json:{...base,contact:{method:'email',value:'not-an-email'}}})).status,400);
 const order=await s.order(['RR-002'],requestId,{call:(path,options)=>s.owner.call(path,{...options,json:{...options.json,contact:{method:'line',value:'buyer.id'}}})});assert.equal(order.contact.method,'line');
 assert.equal((await s.receipt(order,new Uint8Array(900*1024+1))).status,413);
 assert.equal((await s.staff.call('admin/products/RR-001/original',{method:'PUT',body:image()})).status,409);
 assert.equal((await s.staff.call('admin/settings',{method:'POST',json:{enabled:true,qrRecipientVerified:true,fulfillmentTested:true}})).status,200);
});
