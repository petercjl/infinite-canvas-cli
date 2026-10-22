import {need,hash,canonical} from './core.mjs';

export function mediaUrl(e){return e.customData?.videoUrl||e.customData?.fileUrl||e.src||null;}
export function comparableUrl(s){try{const u=new URL(s);return u.origin+u.pathname;}catch{return s;}}
export function findVideo(elements,url){return elements.filter(e=>!e.isDeleted&&e.customData?.isVideoThumbnail&&comparableUrl(mediaUrl(e))===comparableUrl(url));}
export function sceneSignature(elements=[]){return hash(elements.filter(e=>!e.isDeleted&&!(e.type==='rectangle'&&e.customData?.type==='frame-background'&&e.customData.ownerFrameId===e.frameId&&e.id===e.frameId+'__bg')).map(e=>{const data={...e.customData};if(data.originalUrl===data.fileUrl||data.originalUrl===data.videoUrl)delete data.originalUrl;if(e.type==='frame'&&Array.isArray(data.fills))data.fills=data.fills.map(({id,...fill})=>fill);return Object.fromEntries(['id','type','x','y','width','height','angle','frameId','fileId','text','name','customData'].filter(k=>e[k]!==undefined).map(k=>[k,k==='customData'?data:e[k]]));}));}
export function groupIntoFrame(content,{ids,frameId,name='Video references and result',padding=32,gap=24,width=320,retireIds=[]}){
  need(Array.isArray(ids)&&ids.length>0&&ids.length<=30&&new Set(ids).size===ids.length,'INVALID_INPUT','Provide unique element IDs.');
  need(/^[A-Za-z0-9_-]{1,100}$/.test(frameId)&&typeof name==='string'&&name.trim()&&name.length<=200,'INVALID_INPUT','Invalid Frame ID or name.');
  need([padding,gap,width].every(n=>Number.isFinite(n)&&n>=0)&&width>0&&width<=2000,'INVALID_INPUT','Invalid layout values.');
  const v=JSON.parse(content),before=canonical(v);need(Array.isArray(v.elements),'OUTPUT_CONTRACT_FAILED','Canvas elements are unavailable.');
  const selected=ids.map(id=>need(v.elements.find(e=>e.id===id&&!e.isDeleted),'ELEMENT_NOT_FOUND','Selected element is missing.',{id}));
  for(const id of retireIds){const e=v.elements.find(e=>e.id===id);if(!e)continue;need(!ids.includes(id)&&e.customData?.cliTaskId?.startsWith('ic-video-')&&selected.some(s=>s.customData?.isVideoThumbnail&&comparableUrl(mediaUrl(s))===comparableUrl(mediaUrl(e))),'FEATURE_UNSUPPORTED','Only a CLI-owned duplicate of the selected video can be retired.');if(!e.isDeleted){e.isDeleted=true;e.version=(e.version||1)+1;e.updated=Date.now();}}
  need(selected.every(e=>e.type==='image'&&e.width>0&&e.height>0&&(!e.angle||e.angle===0)),'FEATURE_UNSUPPORTED','Frame grouping supports unrotated image/video nodes.');
  const old=v.elements.find(e=>e.id===frameId);need(!old||(!old.isDeleted&&old.type==='frame'),'IDEMPOTENCY_CONFLICT','Frame ID conflicts with another element.');
  if(old)need(!v.elements.some(e=>!e.isDeleted&&e.frameId===frameId&&!ids.includes(e.id)&&!(e.id===frameId+'__bg'&&e.type==='rectangle'&&e.customData?.type==='frame-background'&&e.customData.ownerFrameId===frameId)),'FRAME_CONFLICT','Frame contains unrelated elements.');
  const others=v.elements.filter(e=>!e.isDeleted&&!ids.includes(e.id)&&e.id!==frameId);
  const x=old?.x??0,y=old?.y??(others.length?Math.max(0,...others.map(e=>e.y+e.height))+80:0);
  let cursor=x+padding,maxHeight=0;
  for(const e of selected){const scale=Math.min(width/e.width,600/e.height),w=e.width*scale,h=e.height*scale;const next={x:cursor,y:y+padding,width:w,height:h,frameId};if(Object.entries(next).some(([k,val])=>e[k]!==val)){Object.assign(e,next);e.version=(e.version||1)+1;e.versionNonce=Number.parseInt(hash({id:e.id,next}).slice(0,7),16);e.updated=Date.now();}cursor+=w+gap;maxHeight=Math.max(maxHeight,h);}
  const bounds={x,y,width:cursor-x-gap+padding,height:maxHeight+2*padding};
  const frame=old||{id:frameId,type:'frame',angle:0,strokeColor:'#bbb',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,link:null,locked:false};
  frame.customData??={fills:[{id:'fill-'+frameId,type:'solid',color:'#FFFFFF',opacity:100,visible:true,blendMode:'normal'}],cornerRadius:8,schemaVersion:1,__sealseekFrameTreeParentId:null};
  if(!old||frame.name!==name||Object.entries(bounds).some(([k,val])=>frame[k]!==val)){Object.assign(frame,bounds,{name,updated:Date.now(),version:(old?.version||0)+1});}
  if(!old)v.elements.push(frame);
  return {content:JSON.stringify(v),changed:canonical(v)!==before,frameId,elementIds:ids,bounds,retiredElementIds:retireIds.filter(id=>v.elements.some(e=>e.id===id))};
}
export function verifyGrouping(before,after,{frameId,elementIds,retiredElementIds=[]}){
  const a=JSON.parse(after),b=JSON.parse(before),frame=a.elements.find(e=>e.id===frameId&&!e.isDeleted);
  need(frame?.type==='frame','CANVAS_SAVE_UNCERTAIN','Frame was not saved.');
  for(const id of elementIds){const e=a.elements.find(e=>e.id===id&&!e.isDeleted),old=b.elements.find(e=>e.id===id);need(e?.frameId===frameId&&e.x>=frame.x&&e.y>=frame.y&&e.x+e.width<=frame.x+frame.width+1e-6&&e.y+e.height<=frame.y+frame.height+1e-6,'CANVAS_SAVE_UNCERTAIN','Frame membership or bounds were not saved.');need(e.fileId===old.fileId&&canonical(e.customData)===canonical(old.customData),'CANVAS_SAVE_UNCERTAIN','Media identity changed during grouping.');}
  for(const id of retiredElementIds){const old=b.elements.find(e=>e.id===id),e=a.elements.find(e=>e.id===id);need(old?.customData?.cliTaskId?.startsWith('ic-video-')&&e?.isDeleted&&e.fileId===old.fileId&&canonical(e.customData)===canonical(old.customData),'CANVAS_SAVE_UNCERTAIN','CLI duplicate retirement was not verified.');}
  for(const e of b.elements.filter(e=>!elementIds.includes(e.id)&&!retiredElementIds.includes(e.id)&&e.id!==frameId))need(canonical(a.elements.find(n=>n.id===e.id))===canonical(e),'CANVAS_SAVE_UNCERTAIN','Unrelated canvas content changed.');
  return true;
}
