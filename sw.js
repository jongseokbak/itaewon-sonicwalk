/* 이태원 소닉워크 — offline service worker */
const SHELL="sonicwalk-shell-v3", AUDIO="sonicwalk-audio-v1", TILES="sonicwalk-tiles-v1", FONTS="sonicwalk-fonts-v1";
const SHELL_FILES=["./","index.html","guide.html","vendor/leaflet.min.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];
const TILE_MAX=400;

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(SHELL).then(c=>c.addAll(SHELL_FILES.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  const keep=[SHELL,AUDIO,TILES,FONTS];
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("sonicwalk-")&&!keep.includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const u=new URL(req.url);
  if(u.origin===location.origin&&/\/audio\/[^/]+\.m4a$/.test(u.pathname)){e.respondWith(audio(req));return;}
  if(u.origin===location.origin&&/\/audio\//.test(u.pathname))return;   /* locked files and lock.json: straight to network, never kept twice */
  if(/(^|\.)tile\.openstreetmap\.org$/.test(u.hostname)){e.respondWith(tile(req));return;}
  if(u.hostname==="fonts.googleapis.com"||u.hostname==="fonts.gstatic.com"){e.respondWith(swr(req,FONTS));return;}
  if(u.origin===location.origin){e.respondWith(shell(req));return;}
});

/* saved recordings: answer byte-range requests from the stored file (needed for <audio> seeking, esp. Safari) */
async function audio(req){
  const c=await caches.open(AUDIO);
  const hit=await c.match(req.url.split("#")[0],{ignoreSearch:true});
  if(!hit)return fetch(req);
  const range=req.headers.get("range");
  const blob=await hit.blob(),size=blob.size;
  if(!range)return new Response(blob,{status:200,headers:{"Content-Type":"audio/mp4","Content-Length":String(size),"Accept-Ranges":"bytes"}});
  const m=/bytes=(\d*)-(\d*)/.exec(range);
  let start,end;
  if(!m||(m[1]===""&&m[2]===""))return new Response(blob,{status:200,headers:{"Content-Type":"audio/mp4","Content-Length":String(size),"Accept-Ranges":"bytes"}});
  if(m[1]===""){start=Math.max(0,size-(+m[2]));end=size-1;}
  else{start=+m[1];end=m[2]===""?size-1:Math.min(+m[2],size-1);}
  if(start>=size||start>end)return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+size}});
  return new Response(blob.slice(start,end+1),{status:206,headers:{
    "Content-Type":"audio/mp4","Content-Range":"bytes "+start+"-"+end+"/"+size,
    "Content-Length":String(end-start+1),"Accept-Ranges":"bytes"}});
}

/* app files: network first (so updates arrive), saved copy when offline */
async function shell(req){
  const c=await caches.open(SHELL);
  try{
    const res=await timeout(fetch(req),5000);
    if(res&&res.ok&&res.type==="basic")c.put(req,res.clone());
    return res;
  }catch(err){
    const hit=await c.match(req,{ignoreSearch:true})||(req.mode==="navigate"?await c.match("index.html"):null);
    if(hit)return hit;
    throw err;
  }
}
/* map tiles you have already looked at: network first, kept copy offline (small, capped) */
async function tile(req){
  const c=await caches.open(TILES);
  try{
    const res=await timeout(fetch(req),6000);
    if(res&&res.ok){await c.put(req,res.clone());trim(c);}
    return res;
  }catch(err){
    const hit=await c.match(req);if(hit)return hit;
    return new Response("",{status:504});
  }
}
async function trim(c){const ks=await c.keys();if(ks.length>TILE_MAX)for(const k of ks.slice(0,ks.length-TILE_MAX))await c.delete(k);}
async function swr(req,name){
  const c=await caches.open(name);const hit=await c.match(req);
  const net=fetch(req).then(r=>{if(r&&(r.ok||r.type==="opaque"))c.put(req,r.clone());return r;}).catch(()=>null);
  return hit||(await net)||new Response("",{status:504});
}
function timeout(p,ms){return new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error("timeout")),ms);p.then(r=>{clearTimeout(t);ok(r);},e=>{clearTimeout(t);no(e);});});}
