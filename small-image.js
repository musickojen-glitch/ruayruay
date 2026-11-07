'use strict';
window.prepareSmallImage=async function(file){
 if(!file||!['image/jpeg','image/png'].includes(file.type))throw Error('กรุณาเลือกภาพ JPG หรือ PNG');
 if(file.size>10*1024*1024)throw Error('ภาพต้นทางต้องไม่เกิน 10 MB');
 if(file.size<=900*1024)return file;
 const objectUrl=URL.createObjectURL(file);const image=new Image();
 try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('เปิดภาพไม่ได้ กรุณาเลือกไฟล์ใหม่'));image.src=objectUrl});
  const canvas=document.createElement('canvas');const scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.85,.7,.55,.4]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=900*1024)return blob}throw Error('รูปยังใหญ่เกินไป กรุณาตัดเฉพาะส่วนหลักฐานหรือ QR');
 }finally{URL.revokeObjectURL(objectUrl)}
};
