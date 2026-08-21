/* WifiPaint PRO — complete editor layer
 * Preserves the current WifiCord DOM/API:
 * #wipaint-canvas, #wipaint-layers, #wipaint-send,
 * /api/media/upload, window.ChatSocket and window.App.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const S = {
    canvas: null, ctx: null,
    tool: 'brush', brush: 'classic',
    color: '#7c5cff', size: 12, opacity: 1,
    grid: false, snap: false, zoom: 1,
    drawing: false, pointerId: null, last: null, start: null,
    marquee: null, selection: null, transform: null,
    clipboard: null, history: [], future: [],
    layers: [], activeLayer: 0,
    frames: [], activeFrame: 0,
    autosaveKey: 'wipaint-pro-project-v2',
    bound: false, uiBound: false, playing: false, autosaveTimer: null,
    symmetry: { mode: 'none', count: 2 },
    effectPreview: null, guides: [],
    beforeImage: null, polygon: [],
    projectBg: '#ffffff', onion: false
  };

  const BRUSHES = {
    classic: ['Clássico', 1], pencil: ['Lápis', .72], ink: ['Tinta', 1],
    watercolor: ['Aquarela', .18], marker: ['Marcador', .55],
    chalk: ['Giz', .35], charcoal: ['Carvão', .45], airbrush: ['Aerógrafo', .12],
    spray: ['Spray', .3], neon: ['Neon', .95], glow: ['Glow', .8],
    pixel: ['Pixel', 1], pixelperfect: ['Pixel Perfect', 1],
    rainbow: ['Rainbow', 1], particle: ['Partículas', .8],
    fire: ['Fogo', .8], ice: ['Gelo', .8], smoke: ['Fumaça', .25],
    glitch: ['Glitch', .9]
  };

  const TOOLS = [
    ['select','Seleção'],['move','Mover'],['brush','Pincel'],['eraser','Borracha'],
    ['pixel','Pixel'],['fill','Balde'],['eyedropper','Conta-gotas'],['text','Texto'],
    ['line','Linha'],['rect','Retângulo'],['circle','Elipse'],['polygon','Polígono'],
    ['gradient','Gradiente'],['crop','Cortar'],['blur','Desfoque'],['clone','Clonar']
  ];

  const EVENTS = new Map();

  function toast(message, type = 'info') {
    try { if (window.App && typeof window.App.toast === 'function') return window.App.toast(message, type); } catch (_) {}
    console.log(`[WifiPaint ${type}] ${message}`);
  }

  function textInputFocused() {
    const e = document.activeElement;
    return e && (['INPUT','TEXTAREA','SELECT'].includes(e.tagName) || e.isContentEditable);
  }

  function canvasPoint(e) {
    const r = S.canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) * S.canvas.width / r.width, 0, S.canvas.width),
      y: clamp((e.clientY - r.top) * S.canvas.height / r.height, 0, S.canvas.height)
    };
  }

  function norm(a,b) {
    return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};
  }
  function inside(p,r) { return !!r && p.x>=r.x && p.y>=r.y && p.x<=r.x+r.width && p.y<=r.y+r.height; }
  function union(a,b) {
    const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y);
    const x2=Math.max(a.x+a.width,b.x+b.width), y2=Math.max(a.y+a.height,b.y+b.height);
    return {x,y,width:x2-x,height:y2-y};
  }
  function hex(h) {
    h=(h||'#000').replace('#','');
    if(h.length===3) h=h.split('').map(x=>x+x).join('');
    return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];
  }
  function rgba(c,a){return `rgba(${c[0]},${c[1]},${c[2]},${a})`;}

  function makeCanvas(w=S.canvas.width,h=S.canvas.height){
    const c=document.createElement('canvas'); c.width=w;c.height=h;return c;
  }

  function makeLayer(name) {
    return {
      id: 'layer_'+Date.now()+'_'+Math.random().toString(36).slice(2),
      name: name || `Camada ${S.layers.length+1}`,
      c: makeCanvas(), visible:true, locked:false, opacity:1,
      blend:'source-over', x:0,y:0,width:S.canvas.width,height:S.canvas.height,
      rotation:0, scaleX:1, scaleY:1, filters:[], mask:null, group:null
    };
  }

  function makeFrame(name) {
    const l=makeLayer('Camada 1');
    return {id:'frame_'+Date.now()+'_'+Math.random().toString(36).slice(2),
      name:name||`Frame ${S.frames.length+1}`, duration:83, layers:[l]};
  }

  function activeLayer(){ return S.layers[S.activeLayer] || null; }
  function activeFrame(){ return S.frames[S.activeFrame] || null; }

  function syncFrameLayers(){
    const f=activeFrame(); if(!f)return;
    S.layers=f.layers;
    if(!S.layers.length) S.layers.push(makeLayer('Camada 1'));
    S.activeLayer=clamp(S.activeLayer,0,S.layers.length-1);
  }

  function initDocument(){
    S.frames=[makeFrame('Frame 1')]; S.activeFrame=0; syncFrameLayers();
  }

  function local(l,p){
    return {x:(p.x-l.x)*l.c.width/Math.max(1,l.width),
            y:(p.y-l.y)*l.c.height/Math.max(1,l.height)};
  }

  function layerBounds(l){
    const ctx=l.c.getContext('2d',{willReadFrequently:true});
    const d=ctx.getImageData(0,0,l.c.width,l.c.height).data;
    let minX=l.c.width,minY=l.c.height,maxX=-1,maxY=-1;
    for(let y=0;y<l.c.height;y++) for(let x=0;x<l.c.width;x++){
      if(d[(y*l.c.width+x)*4+3]>8){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    }
    if(maxX<0)return null;
    return {x:l.x+minX*l.width/l.c.width,y:l.y+minY*l.height/l.c.height,
      width:(maxX-minX+1)*l.width/l.c.width,height:(maxY-minY+1)*l.height/l.c.height};
  }

  function contentBounds(){
    let r=null;
    for(const l of S.layers){ if(!l.visible)continue; const b=layerBounds(l); if(b)r=r?union(r,b):b; }
    return r;
  }

  function handles(r){
    return {nw:{x:r.x,y:r.y},n:{x:r.x+r.width/2,y:r.y},ne:{x:r.x+r.width,y:r.y},
      e:{x:r.x+r.width,y:r.y+r.height/2},se:{x:r.x+r.width,y:r.y+r.height},
      s:{x:r.x+r.width/2,y:r.y+r.height},sw:{x:r.x,y:r.y+r.height},w:{x:r.x,y:r.y+r.height/2}};
  }

  function handleAt(p){
    if(!S.selection)return null;
    for(const [k,h] of Object.entries(handles(S.selection))) if(Math.hypot(p.x-h.x,p.y-h.y)<14)return k;
    return null;
  }

  function render() {
    const {ctx,canvas}=S; if(!ctx)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle=S.projectBg;ctx.fillRect(0,0,canvas.width,canvas.height);
    if(S.onion && S.frames.length>1) renderOnion();
    for(const l of S.layers){
      if(!l.visible)continue;
      ctx.save();ctx.globalAlpha=l.opacity;ctx.globalCompositeOperation=l.blend||'source-over';
      ctx.translate(l.x+l.width/2,l.y+l.height/2);
      ctx.rotate((l.rotation||0)*Math.PI/180);
      ctx.scale(l.scaleX||1,l.scaleY||1);
      ctx.drawImage(l.c,-l.width/2,-l.height/2,l.width,l.height);ctx.restore();
    }
    if(S.grid)drawGrid();
    if(S.effectPreview?.filter)drawEffectPreview();
    if(S.effectPreview?.shape)drawShapePreview();
    if(S.marquee)drawMarquee();
    if(S.selection)drawSelection(S.selection);
    if(S.transform)drawTransform(S.transform.preview);
  }

  function renderOnion(){
    const prev=S.frames[S.activeFrame-1], next=S.frames[S.activeFrame+1];
    for(const f of [prev,next]){
      if(!f)continue;
      const ctx=S.ctx;ctx.save();ctx.globalAlpha=.13;
      for(const l of f.layers)if(l.visible)ctx.drawImage(l.c,l.x,l.y,l.width,l.height);
      ctx.restore();
    }
  }

  function drawGrid(){
    const c=S.ctx;c.save();c.globalAlpha=.2;c.strokeStyle='#64748b';c.lineWidth=1;
    const step=S.brush.startsWith('pixel')?Math.max(2,Math.floor(S.size)):16;
    for(let x=0;x<=S.canvas.width;x+=step){c.beginPath();c.moveTo(x,0);c.lineTo(x,S.canvas.height);c.stroke();}
    for(let y=0;y<=S.canvas.height;y+=step){c.beginPath();c.moveTo(0,y);c.lineTo(S.canvas.width,y);c.stroke();}
    c.restore();
  }
  function drawMarquee(){
    const r=norm(S.marquee.start,S.marquee.end),c=S.ctx;c.save();
    c.fillStyle='#7c5cff16';c.fillRect(r.x,r.y,r.width,r.height);
    c.strokeStyle='#7c5cff';c.lineWidth=2;c.setLineDash([7,5]);c.strokeRect(r.x,r.y,r.width,r.height);c.restore();
  }
  function drawSelection(r){
    const c=S.ctx;c.save();c.strokeStyle='#7c5cff';c.lineWidth=2;c.setLineDash([7,5]);c.strokeRect(r.x,r.y,r.width,r.height);
    c.setLineDash([]);for(const h of Object.values(handles(r))){c.fillStyle='#fff';c.beginPath();c.rect(h.x-5,h.y-5,10,10);c.fill();c.stroke();}
    c.restore();
  }
  function drawTransform(r){if(!S.transform?.image)return;S.ctx.save();S.ctx.globalAlpha=.75;S.ctx.drawImage(S.transform.image,r.x,r.y,r.width,r.height);S.ctx.restore();}
  function drawEffectPreview(){
    if(!S.effectPreview?.filter)return;
    S.ctx.save();
    S.ctx.globalAlpha=.35;
    S.ctx.filter=S.effectPreview.filter;
    S.ctx.drawImage(composite(),0,0);
    S.ctx.restore();
  }
  function drawShapePreview(){
    const p=S.effectPreview;
    if(!p?.shape||!p.start||!p.end)return;
    const c=S.ctx,a=p.start,b=p.end,r=norm(a,b);
    c.save(); c.globalAlpha=.8; c.strokeStyle=S.color; c.lineWidth=Math.max(1,S.size);
    c.setLineDash([6,4]); c.beginPath();
    if(p.shape==='line'){c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}
    else if(p.shape==='rect'){c.rect(r.x,r.y,r.width,r.height);}
    else if(p.shape==='circle'){c.ellipse(r.x+r.width/2,r.y+r.height/2,Math.max(1,r.width/2),Math.max(1,r.height/2),0,0,Math.PI*2);}
    else if(p.shape==='polygon'){
      const cx=r.x+r.width/2,cy=r.y+r.height/2,rad=Math.min(r.width,r.height)/2;
      c.moveTo(cx+rad,cy);
      for(let i=1;i<6;i++){const an=i*Math.PI*2/5;c.lineTo(cx+Math.cos(an)*rad,cy+Math.sin(an)*rad);}
      c.closePath();
    }
    c.stroke();c.restore();
  }

  function configure(ctx, erase=false){
    const alpha={watercolor:.2,chalk:.35,airbrush:.12,marker:.55,pencil:.72,smoke:.25}[S.brush] ?? 1;
    ctx.globalAlpha=S.opacity*alpha;ctx.strokeStyle=S.color;ctx.fillStyle=S.color;ctx.lineWidth=S.size;
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.shadowBlur=['neon','glow'].includes(S.brush)?Math.max(8,S.size):0;ctx.shadowColor=S.color;
    ctx.globalCompositeOperation=erase?'destination-out':'source-over';
    ctx.imageSmoothingEnabled=!S.brush.startsWith('pixel');
  }

  function stamp(l,p){
    if(l.locked)return;const c=l.c.getContext('2d'),q=local(l,p);
    if(S.brush==='pixel'||S.brush==='pixelperfect'){
      const s=Math.max(1,Math.floor(S.size)),x=Math.floor(q.x/s)*s,y=Math.floor(q.y/s)*s;
      c.globalAlpha=S.opacity;c.fillStyle=S.color;c.fillRect(x,y,s,s);return;
    }
    if(S.brush==='particle'||S.brush==='spray'||S.brush==='fire'||S.brush==='ice'||S.brush==='smoke'||S.brush==='watercolor'||S.brush==='airbrush'){
      const n=S.brush==='particle'?18:S.brush==='spray'?14:9;
      const base=S.brush==='fire'?'#ff7a18':S.brush==='ice'?'#78e7ff':S.color;
      for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,r=Math.random()*S.size*1.7;
        c.save();configure(c);c.fillStyle=base;c.globalAlpha*=.55;c.beginPath();c.arc(q.x+Math.cos(a)*r,q.y+Math.sin(a)*r,Math.max(.5,S.size*(.06+Math.random()*.25)),0,Math.PI*2);c.fill();c.restore();}
    }else{
      configure(c,S.tool==='eraser');c.beginPath();c.arc(q.x,q.y,Math.max(.5,c.lineWidth/2),0,Math.PI*2);c.fill();
    }
    c.globalCompositeOperation='source-over';c.shadowBlur=0;
  }

  function stroke(a,b){
    const l=activeLayer();if(!l||l.locked)return;
    if(S.brush==='pixel'||S.brush==='pixelperfect'){stamp(l,a);stamp(l,b);return;}
    const c=l.c.getContext('2d');
    if(S.brush==='rainbow'){c.strokeStyle=`hsl(${(Date.now()/4)%360} 100% 60%)`;}
    configure(c,S.tool==='eraser');const p1=local(l,a),p2=local(l,b);
    c.beginPath();c.moveTo(p1.x,p1.y);c.lineTo(p2.x,p2.y);c.stroke();
    c.globalCompositeOperation='source-over';c.shadowBlur=0;
    if(S.symmetry.mode!=='none')symmetryStroke(a,b);
  }

  function symmetryStroke(a,b){
    const l=activeLayer();if(!l)return;const c=l.c.getContext('2d'),cx=S.canvas.width/2,cy=S.canvas.height/2,n=S.symmetry.count||2;
    for(let i=1;i<n;i++){const ang=2*Math.PI*i/n,rot=p=>({x:cx+(p.x-cx)*Math.cos(ang)-(p.y-cy)*Math.sin(ang),y:cy+(p.x-cx)*Math.sin(ang)+(p.y-cy)*Math.cos(ang)});
      const p1=local(l,rot(a)),p2=local(l,rot(b));configure(c);c.beginPath();c.moveTo(p1.x,p1.y);c.lineTo(p2.x,p2.y);c.stroke();}
    c.globalCompositeOperation='source-over';
  }

  function flood(p){
    const l=activeLayer();if(!l||l.locked)return;
    const c=l.c.getContext('2d',{willReadFrequently:true}),q=local(l,p),x=Math.floor(q.x),y=Math.floor(q.y);
    if(x<0||y<0||x>=l.c.width||y>=l.c.height)return;
    const img=c.getImageData(0,0,l.c.width,l.c.height),d=img.data,w=l.c.width,h=l.c.height,i0=(y*w+x)*4;
    const target=[d[i0],d[i0+1],d[i0+2],d[i0+3]],fill=hex(S.color);
    const same=i=>Math.abs(d[i]-target[0])<12&&Math.abs(d[i+1]-target[1])<12&&Math.abs(d[i+2]-target[2])<12&&Math.abs(d[i+3]-target[3])<12;
    if(same(i0))return;const stack=[[x,y]],seen=new Uint8Array(w*h);
    while(stack.length){const [px,py]=stack.pop();if(px<0||py<0||px>=w||py>=h)continue;const idx=py*w+px;if(seen[idx])continue;seen[idx]=1;const i=idx*4;if(!same(i))continue;
      d[i]=fill[0];d[i+1]=fill[1];d[i+2]=fill[2];d[i+3]=Math.round(S.opacity*255);stack.push([px+1,py],[px-1,py],[px,py+1],[px,py-1]);}
    c.putImageData(img,0,0);commit();render();
  }

  function selectionImage(r){
    const l=activeLayer();if(!l||!r)return null;const out=makeCanvas(Math.max(1,Math.round(r.width*l.c.width/l.width)),Math.max(1,Math.round(r.height*l.c.height/l.height)));
    out.getContext('2d').drawImage(l.c,(r.x-l.x)*l.c.width/l.width,(r.y-l.y)*l.c.height/l.height,r.width*l.c.width/l.width,r.height*l.c.height/l.height,0,0,out.width,out.height);return out;
  }

  function selectAll(){S.selection=contentBounds();S.marquee=null;render();toast(S.selection?'Conteúdo selecionado.':'Não há conteúdo para selecionar.',S.selection?'success':'error');}
  function clearSelection(){S.selection=null;S.marquee=null;S.transform=null;render();}
  function applyCrop(r){
    const x=clamp(Math.floor(r.x),0,S.canvas.width-1), y=clamp(Math.floor(r.y),0,S.canvas.height-1);
    const w=clamp(Math.floor(r.width),1,S.canvas.width-x), h=clamp(Math.floor(r.height),1,S.canvas.height-y);
    const old=composite(), out=makeCanvas(w,h), oc=out.getContext('2d');
    oc.drawImage(old,x,y,w,h,0,0,w,h);
    S.canvas.width=w; S.canvas.height=h;
    for(const l of S.layers){
      const n=makeCanvas(w,h), nc=n.getContext('2d');
      nc.drawImage(l.c,x-l.x,y-l.y,w,h,0,0,w,h);
      l.c=n;l.x=0;l.y=0;l.width=w;l.height=h;
    }
    S.selection={x:0,y:0,width:w,height:h};
    commit(); renderLayers(); render();
  }
  function invertSelection(){
    if(!S.selection){selectAll();return;}const r=S.selection;S.selection={x:0,y:0,width:S.canvas.width,height:S.canvas.height};
    S.selection._hole=r;render();
  }

  function beginTransform(p,mode){
    const l=activeLayer();if(!l||l.locked||!S.selection)return;
    const image=selectionImage(S.selection);if(!image)return;
    S.transform={mode,start:{...p},original:{...S.selection},preview:{...S.selection},image,base:serializeLayers()};
  }

  function updateTransform(p,e){
    const t=S.transform,o=t.original,dx=p.x-t.start.x,dy=p.y-t.start.y;let{x,y,width,height}=o;
    if(t.mode==='move'){x+=dx;y+=dy;}
    else{
      if(t.mode.includes('e'))width=Math.max(2,o.width+dx);
      if(t.mode.includes('s'))height=Math.max(2,o.height+dy);
      if(t.mode.includes('w')){width=Math.max(2,o.width-dx);x=o.x+o.width-width;}
      if(t.mode.includes('n')){height=Math.max(2,o.height-dy);y=o.y+o.height-height;}
      if(e.shiftKey){const ratio=o.width/Math.max(1,o.height);if(Math.abs(dx)>Math.abs(dy))height=width/ratio;else width=height*ratio;}
    }
    t.preview={x,y,width,height};render();
  }

  async function finishTransform(){
    const t=S.transform;if(!t)return;S.transform=null;await restoreLayers(t.base);
    const l=activeLayer();if(!l||l.locked)return;const c=l.c.getContext('2d'),o=t.original,n=t.preview;
    const sx=(o.x-l.x)*l.c.width/l.width,sy=(o.y-l.y)*l.c.height/l.height,sw=o.width*l.c.width/l.width,sh=o.height*l.c.height/l.height;
    c.clearRect(sx,sy,sw,sh);
    c.drawImage(t.image,0,0,t.image.width,t.image.height,(n.x-l.x)*l.c.width/l.width,(n.y-l.y)*l.c.height/l.height,n.width*l.c.width/l.width,n.height*l.c.height/l.height);
    S.selection={...n};commit();render();
  }

  function serializeLayer(l){
    return {id:l.id,name:l.name,visible:l.visible,locked:l.locked,opacity:l.opacity,x:l.x,y:l.y,width:l.width,height:l.height,blend:l.blend,rotation:l.rotation,scaleX:l.scaleX,scaleY:l.scaleY,filters:l.filters,data:l.c.toDataURL('image/png')};
  }
  function serializeLayers(){return S.layers.map(serializeLayer);}
  async function restoreLayers(data){
    S.layers=await Promise.all((data||[]).map(x=>new Promise(resolve=>{
      const l=makeLayer(x.name);Object.assign(l,x);l.c=makeCanvas(S.canvas.width,S.canvas.height);
      const im=new Image();im.onload=()=>{l.c.getContext('2d').drawImage(im,0,0);resolve(l)};im.onerror=()=>resolve(l);im.src=x.data;
    })));
    if(!S.layers.length)S.layers=[makeLayer('Camada 1')]; S.activeLayer=clamp(S.activeLayer,0,S.layers.length-1);renderLayers();render();
  }

  function commit(){
    S.history.push(serializeLayers());if(S.history.length>80)S.history.shift();S.future=[];autosave();renderLayers();
  }
  async function undo(){if(S.history.length<=1)return;S.future.push(S.history.pop());await restoreLayers(S.history.at(-1));}
  async function redo(){if(!S.future.length)return;const s=S.future.pop();S.history.push(s);await restoreLayers(s);}

  function addLayer(name){
    S.layers.splice(S.activeLayer+1,0,makeLayer(name||`Camada ${S.layers.length+1}`));S.activeLayer++;commit();renderLayers();render();
  }
  function duplicateLayer(){
    const s=activeLayer();if(!s)return;const l=makeLayer(s.name+' cópia');Object.assign(l,{visible:s.visible,locked:false,opacity:s.opacity,x:s.x,y:s.y,width:s.width,height:s.height,blend:s.blend,rotation:s.rotation,scaleX:s.scaleX,scaleY:s.scaleY,filters:[...s.filters]});
    l.c.getContext('2d').drawImage(s.c,0,0);S.layers.splice(S.activeLayer+1,0,l);S.activeLayer++;commit();renderLayers();render();
  }
  function deleteLayer(){if(S.layers.length<=1)return toast('Mantenha pelo menos uma camada.','error');S.layers.splice(S.activeLayer,1);S.activeLayer=clamp(S.activeLayer,0,S.layers.length-1);commit();renderLayers();render();}
  function moveLayer(dir){const n=S.activeLayer+dir;if(n<0||n>=S.layers.length)return;[S.layers[S.activeLayer],S.layers[n]]=[S.layers[n],S.layers[S.activeLayer]];S.activeLayer=n;commit();renderLayers();render();}
  function toggleLock(){const l=activeLayer();if(!l)return;l.locked=!l.locked;commit();renderLayers();}
  function toggleVisible(i){const l=S.layers[i];if(!l)return;l.visible=!l.visible;commit();renderLayers();render();}
  function renameLayer(){const l=activeLayer();if(!l)return;const n=prompt('Nome da camada:',l.name);if(n?.trim()){l.name=n.trim();commit();renderLayers();}}

  function applyFilter(type,intensity=1){
    const l=activeLayer();if(!l||l.locked)return;
    const r=S.selection||{x:l.x,y:l.y,width:l.width,height:l.height};
    const sx=Math.max(0,Math.floor((r.x-l.x)*l.c.width/l.width)),sy=Math.max(0,Math.floor((r.y-l.y)*l.c.height/l.height));
    const sw=Math.min(l.c.width-sx,Math.max(1,Math.ceil(r.width*l.c.width/l.width))),sh=Math.min(l.c.height-sy,Math.max(1,Math.ceil(r.height*l.c.height/l.height)));
    const c=l.c.getContext('2d',{willReadFrequently:true}),img=c.getImageData(sx,sy,sw,sh),d=img.data,a=Number(intensity);
    for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2];
      if(type==='grayscale'){const v=.299*r+.587*g+.114*b;r+=((v-r)*a);g+=((v-g)*a);b+=((v-b)*a);}
      else if(type==='invert'){r+=(255-r)*a;g+=(255-g)*a;b+=(255-b)*a;}
      else if(type==='sepia'){const nr=.393*r+.769*g+.189*b,ng=.349*r+.686*g+.168*b,nb=.272*r+.534*g+.131*b;r+=(nr-r)*a;g+=(ng-g)*a;b+=(nb-b)*a;}
      else if(type==='warm'){r=clamp(r+45*a,0,255);g=clamp(g+15*a,0,255);b=clamp(b-25*a,0,255);}
      else if(type==='cool'){r=clamp(r-25*a,0,255);g=clamp(g+15*a,0,255);b=clamp(b+45*a,0,255);}
      else if(type==='contrast'){const f=1+a;r=clamp((r-128)*f+128,0,255);g=clamp((g-128)*f+128,0,255);b=clamp((b-128)*f+128,0,255);}
      else if(type==='saturation'){const avg=(r+g+b)/3;r=clamp(avg+(r-avg)*(1+2*a),0,255);g=clamp(avg+(g-avg)*(1+2*a),0,255);b=clamp(avg+(b-avg)*(1+2*a),0,255);}
      else if(type==='posterize'){r=Math.round(r/32)*32;g=Math.round(g/32)*32;b=Math.round(b/32)*32;}
      else if(type==='threshold'){const v=(.299*r+.587*g+.114*b)>128?255:0;r=g=b=v;}
      d[i]=r;d[i+1]=g;d[i+2]=b;
    }
    c.putImageData(img,sx,sy);commit();render();
  }

  function blurSelection(radius=6){
    const l=activeLayer();if(!l||l.locked)return;const r=S.selection||{x:l.x,y:l.y,width:l.width,height:l.height},img=selectionImage(r);if(!img)return;
    const copy=makeCanvas(img.width,img.height),cc=copy.getContext('2d');cc.filter=`blur(${radius}px)`;cc.drawImage(img,0,0);
    const lc=l.c.getContext('2d');const x=(r.x-l.x)*l.c.width/l.width,y=(r.y-l.y)*l.c.height/l.height,w=r.width*l.c.width/l.width,h=r.height*l.c.height/l.height;
    lc.clearRect(x,y,w,h);lc.drawImage(copy,0,0,copy.width,copy.height,x,y,w,h);commit();render();
  }

  function effectPreview(filter){S.effectPreview={filter};render();}
  function cancelEffect(){S.effectPreview=null;render();}
  function applyEffectPreview(){if(!S.effectPreview)return;const f=S.effectPreview.filter;S.effectPreview=null;const l=activeLayer();if(!l)return;const r=S.selection||{x:0,y:0,width:S.canvas.width,height:S.canvas.height};
    const x=Math.max(0,r.x),y=Math.max(0,r.y),w=Math.min(S.canvas.width-x,r.width),h=Math.min(S.canvas.height-y,r.height);
    const temp=composite();const c=l.c.getContext('2d');c.save();c.filter=f;c.globalAlpha=1;c.drawImage(temp,x,y,w,h,x-l.x,y-l.y,w,h);c.restore();commit();render();
  }

  function composite(){
    const o=makeCanvas(S.canvas.width,S.canvas.height),c=o.getContext('2d');c.fillStyle=S.projectBg;c.fillRect(0,0,o.width,o.height);
    for(const l of S.layers){if(!l.visible)continue;c.save();c.globalAlpha=l.opacity;c.globalCompositeOperation=l.blend||'source-over';c.translate(l.x+l.width/2,l.y+l.height/2);c.rotate((l.rotation||0)*Math.PI/180);c.scale(l.scaleX||1,l.scaleY||1);c.drawImage(l.c,-l.width/2,-l.height/2,l.width,l.height);c.restore();}return o;
  }

  async function copy(){
    const r=S.selection||contentBounds();if(!r)return toast('Não há conteúdo para copiar.','error');const c=selectionImage(r);S.clipboard={c,x:r.x+20,y:r.y+20};
    try{const b=await new Promise(res=>c.toBlob(res,'image/png'));if(navigator.clipboard&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);}catch(_){}
    toast('Copiado.','success');
  }
  async function cut(){await copy();const r=S.selection;if(!r)return;const l=activeLayer();if(!l||l.locked)return;const x=(r.x-l.x)*l.c.width/l.width,y=(r.y-l.y)*l.c.height/l.height,w=r.width*l.c.width/l.width,h=r.height*l.c.height/l.height;l.c.getContext('2d').clearRect(x,y,w,h);S.selection=null;commit();render();}
  async function paste(){
    if(!S.clipboard)return toast('Nada para colar.','error');const l=activeLayer();if(!l||l.locked)return;
    const x=S.selection?.x??S.clipboard.x,y=S.selection?.y??S.clipboard.y;l.c.getContext('2d').drawImage(S.clipboard.c,x-l.x,y-l.y);
    S.selection={x,y,width:S.clipboard.c.width*l.width/l.c.width,height:S.clipboard.c.height*l.height/l.c.height};commit();render();
  }

  function addFrame(){
    const f={id:'frame_'+Date.now(),name:`Frame ${S.frames.length+1}`,duration:83,layers:S.layers.map(x=>{const l=makeLayer(x.name);Object.assign(l,{visible:x.visible,locked:x.locked,opacity:x.opacity,x:x.x,y:x.y,width:x.width,height:x.height,blend:x.blend});l.c.getContext('2d').drawImage(x.c,0,0);return l;})};
    S.frames.splice(S.activeFrame+1,0,f);S.activeFrame++;syncFrameLayers();renderLayers();render();toast('Novo frame criado.','success');
  }
  async function frameStep(dir){
    if(!S.frames.length)return;S.frames[S.activeFrame].layers=S.layers;S.activeFrame=clamp(S.activeFrame+dir,0,S.frames.length-1);syncFrameLayers();renderLayers();render();
  }
  async function playFrames(){
    if(S.playing||S.frames.length<2)return;S.playing=true;
    for(let i=0;i<S.frames.length&&S.playing;i++){S.frames[S.activeFrame].layers=S.layers;S.activeFrame=i;syncFrameLayers();renderLayers();render();await new Promise(r=>setTimeout(r,activeFrame()?.duration||83));}
    S.playing=false;
  }
  function stopFrames(){S.playing=false;}
  function deleteFrame(){if(S.frames.length<=1)return;S.frames.splice(S.activeFrame,1);S.activeFrame=clamp(S.activeFrame,0,S.frames.length-1);syncFrameLayers();renderLayers();render();}
  function toggleOnion(){S.onion=!S.onion;render();}

  function exportImage(type='image/png'){
    const out=composite(),ext=type==='image/jpeg'?'jpg':type.split('/')[1];const a=document.createElement('a');a.download=`wipaint-${Date.now()}.${ext}`;a.href=out.toDataURL(type,.92);a.click();
  }

  function autosave(){
    try{localStorage.setItem(S.autosaveKey,JSON.stringify({w:S.canvas.width,h:S.canvas.height,bg:S.projectBg,frames:S.frames.map(f=>({name:f.name,duration:f.duration,layers:f.layers.map(serializeLayer)})),activeFrame:S.activeFrame}));}catch(_){}
  }

  async function loadAutosave(){
    try{
      const data=JSON.parse(localStorage.getItem(S.autosaveKey)||'null');if(!data?.frames?.length)return;
      S.canvas.width=clamp(data.w||S.canvas.width,16,4096);S.canvas.height=clamp(data.h||S.canvas.height,16,4096);S.projectBg=data.bg||'#fff';
      S.frames=await Promise.all(data.frames.map(async f=>({name:f.name,duration:f.duration,layers:await restoreArray(f.layers)})));
      S.activeFrame=clamp(data.activeFrame||0,0,S.frames.length-1);syncFrameLayers();renderLayers();render();toast('Projeto recuperado do autosave.','success');
    }catch(_){}
  }

  async function restoreArray(arr){
    return Promise.all(arr.map(x=>new Promise(resolve=>{
      const l=makeLayer(x.name);Object.assign(l,{visible:x.visible,locked:x.locked,opacity:x.opacity,x:x.x,y:x.y,width:x.width,height:x.height,blend:x.blend,rotation:x.rotation||0,scaleX:x.scaleX||1,scaleY:x.scaleY||1});
      const im=new Image();im.onload=()=>{l.c.getContext('2d').drawImage(im,0,0);resolve(l)};im.onerror=()=>resolve(l);im.src=x.data;
    })));
  }

  function newProject(){
    const w=Number(prompt('Largura do canvas:','1024')),h=Number(prompt('Altura do canvas:','768'));if(!w||!h)return;
    S.canvas.width=clamp(w,16,4096);S.canvas.height=clamp(h,16,4096);initDocument();S.selection=null;S.history=[];S.future=[];commit();renderLayers();render();
  }

  function addText(){
    const l=activeLayer();if(!l||l.locked)return;const text=prompt('Digite o texto:');if(!text)return;const p=S.selection?{x:S.selection.x,y:S.selection.y+S.selection.height}:{x:40,y:80};
    const c=l.c.getContext('2d');c.fillStyle=S.color;c.globalAlpha=S.opacity;c.font=`600 ${Math.max(14,S.size*2)}px Arial`;const tp=local(l,p); c.fillText(text,tp.x,tp.y);c.globalAlpha=1;commit();render();
  }

  function drawShape(type,a,b){
    const l=activeLayer();if(!l||l.locked)return;const c=l.c.getContext('2d'),p1=local(l,a),p2=local(l,b),r={x:Math.min(p1.x,p2.x),y:Math.min(p1.y,p2.y),width:Math.abs(p2.x-p1.x),height:Math.abs(p2.y-p1.y)};
    configure(c);c.beginPath();
    if(type==='line'){c.moveTo(p1.x,p1.y);c.lineTo(p2.x,p2.y);}
    else if(type==='rect'){c.rect(r.x,r.y,r.width,r.height);}
    else if(type==='circle'){c.ellipse(r.x+r.width/2,r.y+r.height/2,Math.max(1,r.width/2),Math.max(1,r.height/2),0,0,Math.PI*2);}
    else {const cx=r.x+r.width/2,cy=r.y+r.height/2,rad=Math.min(r.width,r.height)/2;c.moveTo(cx+rad,cy);for(let i=1;i<6;i++){const an=i*Math.PI*2/5;c.lineTo(cx+Math.cos(an)*rad,cy+Math.sin(an)*rad);}}
    c.stroke();c.globalAlpha=1;c.globalCompositeOperation='source-over';commit();render();
  }

  function startGradient(a,b){
    const l=activeLayer();if(!l||l.locked)return;const c=l.c.getContext('2d'),p1=local(l,a),p2=local(l,b),g=c.createLinearGradient(p1.x,p1.y,p2.x,p2.y);g.addColorStop(0,S.color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,l.c.width,l.c.height);commit();render();
  }

  function eyeDrop(p){
    const px=S.ctx.getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data;S.color='#'+[px[0],px[1],px[2]].map(n=>n.toString(16).padStart(2,'0')).join('');syncUI();
  }

  function pointerDown(e){
    if(e.button!==0)return;const p=canvasPoint(e);S.pointerId=e.pointerId;S.canvas.setPointerCapture?.(e.pointerId);
    if(S.tool==='crop'){
      S.marquee={start:p,end:p}; S.selection=null; S.drawing=true; render(); return;
    }
    if(S.tool==='select'){
      if(e.ctrlKey||e.metaKey){
        const b=objectBoundsAt(p);
        if(S.selection&&b){ S.selection=selectionSubtract(S.selection,b); render(); }
        else if(b){ S.selection=b; render(); }
        return;
      }
      const h=handleAt(p);if(h){beginTransform(p,h);return;}
      if(S.selection&&inside(p,S.selection)){beginTransform(p,'move');return;}
      S.marquee={start:p,end:p};S.selection=null;render();return;
    }
    if(S.tool==='eyedropper'){eyeDrop(p);return;}
    if(S.tool==='fill'){flood(p);return;}
    if(S.tool==='text'){addText();return;}
    if(S.tool==='line'||S.tool==='rect'||S.tool==='circle'||S.tool==='polygon'||S.tool==='gradient'){S.start=p;S.drawing=true;return;}
    if(S.tool==='move'){S.start=p;S.drawing=true;return;}
    const l=activeLayer();if(!l||l.locked){toast('A camada está bloqueada.','error');return;}
    S.drawing=true;S.start=p;S.last=p;
    if(['brush','eraser','pixel'].includes(S.tool)){stamp(l,p);render();}
  }

  function pointerMove(e){
    const p=canvasPoint(e);
    if(S.tool==='crop'&&S.marquee){S.marquee.end=p;render();return;}
    if(S.tool==='select'&&S.marquee){S.marquee.end=p;render();return;}
    if(S.tool==='select'&&S.transform){updateTransform(p,e);return;}
    if(!S.drawing)return;e.preventDefault();
    if(['brush','eraser','pixel'].includes(S.tool)){stroke(S.last,p);S.last=p;render();return;}
    if(['line','rect','circle','polygon','gradient','move'].includes(S.tool)){render();S.effectPreview={shape:S.tool,start:S.start,end:p};}
  }

  function pointerUp(e){
    const p=canvasPoint(e);
    if(S.tool==='crop'&&S.marquee){
      const r=norm(S.marquee.start,p); S.marquee=null; S.drawing=false;
      if(r.width>2&&r.height>2) applyCrop(r); else render();
      return;
    }
    if(S.tool==='select'&&S.marquee){const r=norm(S.marquee.start,p);S.marquee=null;S.selection=r.width>2&&r.height>2?r:null;render();return;}
    if(S.tool==='select'&&S.transform){finishTransform();return;}
    if(!S.drawing)return;S.drawing=false;
    if(['line','rect','circle','polygon'].includes(S.tool))drawShape(S.tool,S.start,p);
    else if(S.tool==='gradient')startGradient(S.start,p);
    else if(S.tool==='move'){
      const l=activeLayer();
      if(l&&!l.locked){
        let nx=l.x+p.x-S.start.x, ny=l.y+p.y-S.start.y;
        if(S.snap){const step=8;nx=Math.round(nx/step)*step;ny=Math.round(ny/step)*step;}
        l.x=nx;l.y=ny;commit();renderLayers();
      }
    }
    S.effectPreview=null;S.last=null;S.start=null;S.canvas.releasePointerCapture?.(e.pointerId);render();
  }

  function objectBoundsAt(p){
    for(let i=S.layers.length-1;i>=0;i--){
      const l=S.layers[i]; if(!l.visible)continue; const b=layerBounds(l);
      if(b&&inside(p,b)) return b;
    }
    return null;
  }
  function selectionSubtract(a,b){
    if(!a||!b)return a;
    // Keep the largest remaining rectangle around the removed rectangle.
    const pieces=[
      {x:a.x,y:a.y,width:a.width,height:Math.max(0,b.y-a.y)},
      {x:a.x,y:Math.max(a.y,b.y+b.height),width:a.width,height:Math.max(0,a.y+a.height-(b.y+b.height))},
      {x:a.x,y:Math.max(a.y,b.y),width:Math.max(0,b.x-a.x),height:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)},
      {x:Math.max(a.x,b.x+b.width),y:Math.max(a.y,b.y),width:Math.max(0,a.x+a.width-(b.x+b.width)),height:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)}
    ].filter(x=>x.width>2&&x.height>2);
    return pieces.sort((p,q)=>q.width*q.height-p.width*p.height)[0]||null;
  }

  function removeObjectAt(p){
    const l=activeLayer();if(!l)return;const r=layerBounds(l);if(!r||!inside(p,r))return;
    const img=selectionImage(r);if(!img)return;const q=img.getContext('2d'),x=Math.floor((p.x-r.x)*img.width/r.width),y=Math.floor((p.y-r.y)*img.height/r.height);
    const data=q.getImageData(0,0,img.width,img.height),d=data.data,w=img.width,h=img.height,stack=[[x,y]],seen=new Uint8Array(w*h);
    while(stack.length){const [px,py]=stack.pop();if(px<0||py<0||px>=w||py>=h)continue;const i=py*w+px;if(seen[i])continue;seen[i]=1;if(d[i*4+3]<8)continue;d[i*4+3]=0;stack.push([px+1,py],[px-1,py],[px,py+1],[px,py-1]);}
    q.putImageData(data,0,0);const lc=l.c.getContext('2d'),lx=(r.x-l.x)*l.c.width/l.width,ly=(r.y-l.y)*l.c.height/l.height,lw=r.width*l.c.width/l.width,lh=r.height*l.c.height/l.height;lc.clearRect(lx,ly,lw,lh);lc.drawImage(img,0,0,img.width,img.height,lx,ly,lw,lh);commit();render();
  }

  function bindCanvas(){
    if(S.bound)return;S.bound=true;
    S.canvas.onpointerdown=pointerDown;S.canvas.onpointermove=pointerMove;S.canvas.onpointerup=pointerUp;S.canvas.onpointercancel=pointerUp; S.canvas.onlostpointercapture=pointerUp;
    S.canvas.onwheel=e=>{if(e.ctrlKey){e.preventDefault();S.zoom=clamp(S.zoom+(e.deltaY<0?.1:-.1),.1,8);S.canvas.style.transform=`scale(${S.zoom})`;}}
  }

  function setTool(t){S.tool=t;syncUI();}
  function setBrush(b){S.brush=b;syncUI();}

  function injectUI(){
    const bar=document.querySelector('.wipaint-toolbar');if(!bar)return;
    if(!$('wipaint-pro-panel')){
      const panel=document.createElement('div');panel.id='wipaint-pro-panel';panel.className='wipaint-pro-panel';
      panel.innerHTML=`<div class="wp-row"><label>Ferramenta <select id="wp-tool">${TOOLS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></label>
      <label>Pincel <select id="wp-brush">${Object.entries(BRUSHES).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join('')}</select></label>
      <label>Tamanho <input id="wp-size" type="range" min="1" max="300" value="12"></label>
      <label>Opacidade <input id="wp-opacity" type="range" min="1" max="100" value="100"></label>
      <input id="wp-color" type="color" value="#7c5cff"><label>Mesclagem <select id="wp-blend"><option value="source-over">Normal</option><option value="multiply">Multiplicar</option><option value="screen">Tela</option><option value="overlay">Sobreposição</option><option value="darken">Escurecer</option><option value="lighten">Clarear</option><option value="difference">Diferença</option><option value="color-dodge">Color Dodge</option></select></label></div>
      <div class="wp-row wp-actions">
      <button id="wp-new">🆕 Novo</button><button id="wp-undo">↶</button><button id="wp-redo">↷</button><button id="wp-selectall">🎯 Conteúdo</button><button id="wp-copy">📋</button><button id="wp-cut">✂️</button><button id="wp-paste">📥</button>
      <button id="wp-frame">🎞️ Frame</button><button id="wp-prev">◀</button><button id="wp-next">▶</button><button id="wp-play">▶ Play</button><button id="wp-stop">■</button><button id="wp-onion">Onion</button><button id="wp-grid">Grid</button><button id="wp-export">Exportar</button><button id="wp-send">📤 Enviar</button></div>
      <div class="wp-row wp-effects"><span>Efeitos:</span>${['grayscale','invert','sepia','warm','cool','contrast','saturation','posterize','threshold'].map(x=>`<button data-effect="${x}">${x}</button>`).join('')}<button id="wp-blur">blur</button></div>
      <div class="wp-row wp-layers"><button id="wp-add-layer">＋ Camada</button><button id="wp-dup-layer">Duplicar</button><button id="wp-del-layer">Excluir</button><button id="wp-up-layer">↑</button><button id="wp-down-layer">↓</button><button id="wp-lock">🔒</button><button id="wp-rename">Renomear</button><button id="wp-group">Agrupar</button></div>
      <div class="wp-row wp-modes"><button id="wp-mirror">🪞 Espelho</button><button id="wp-sym">✣ Simetria</button><button id="wp-snap">Snap</button><button id="wp-neon">Neon</button><button id="wp-glitch">Glitch</button></div>`;
      bar.appendChild(panel);
    }
  }

  function bindUI(){
    if(S.uiBound)return;S.uiBound=true;
    const on=(id,fn)=>$(id)?.addEventListener('click',fn);
    $('wp-tool')?.addEventListener('change',e=>setTool(e.target.value));
    $('wp-brush')?.addEventListener('change',e=>setBrush(e.target.value));
    $('wp-size')?.addEventListener('input',e=>S.size=Number(e.target.value));
    $('wp-opacity')?.addEventListener('input',e=>S.opacity=Number(e.target.value)/100);
    $('wp-color')?.addEventListener('input',e=>S.color=e.target.value);
    $('wp-blend')?.addEventListener('change',e=>{const l=activeLayer();if(l&&!l.locked){l.blend=e.target.value;commit();render();}});
    on('wp-new',newProject);on('wp-undo',undo);on('wp-redo',redo);on('wp-selectall',selectAll);on('wp-copy',copy);on('wp-cut',cut);on('wp-paste',paste);
    on('wp-frame',addFrame);on('wp-prev',()=>frameStep(-1));on('wp-next',()=>frameStep(1));on('wp-play',playFrames);on('wp-stop',stopFrames);on('wp-onion',toggleOnion);
    on('wp-grid',()=>{S.grid=!S.grid;render();});on('wp-export',()=>exportImage());on('wp-send',openRecipientPicker);
    on('wp-add-layer',()=>addLayer());on('wp-dup-layer',duplicateLayer);on('wp-del-layer',deleteLayer);on('wp-up-layer',()=>moveLayer(1));on('wp-down-layer',()=>moveLayer(-1));on('wp-lock',toggleLock);on('wp-rename',renameLayer);
    on('wp-group',()=>{
      const l=activeLayer(); if(!l)return;
      const group=l.group ? null : 'group_'+Date.now();
      for(const x of S.layers) if(x===l || (x.group&&x.group===l.group)) x.group=group;
      commit();renderLayers();
    });
    on('wp-mirror',()=>{S.symmetry={mode:S.symmetry.mode==='none'?'radial':'none',count:2};render();});
    on('wp-sym',()=>{S.symmetry={mode:S.symmetry.mode==='none'?'radial':'none',count:4};render();});
    on('wp-snap',()=>{S.snap=!S.snap;toast(S.snap?'Snap ativado.':'Snap desativado.');});
    on('wp-neon',()=>setBrush(S.brush==='neon'?'classic':'neon'));
    on('wp-glitch',()=>applyGlitch());
    on('wp-blur',()=>blurSelection(6));
    qsa('[data-effect]').forEach(b=>b.addEventListener('click',()=>applyFilter(b.dataset.effect,b.dataset.effect==='contrast'?.35:1)));
    bindOriginalControls();
    window.addEventListener('keydown',keyboard,true);
    window.addEventListener('paste',handlePasteEvent,true);
  }

  function bindOriginalControls(){
    const map={'wipaint-add-layer':()=>addLayer(),'wipaint-delete-layer':deleteLayer,'wipaint-duplicate-layer':duplicateLayer,'wipaint-layer-up':()=>moveLayer(1),'wipaint-layer-down':()=>moveLayer(-1),'wipaint-undo':undo,'wipaint-redo':redo,'wipaint-grid':()=>{S.grid=!S.grid;render();},'wipaint-save':()=>exportImage(),'wipaint-send':openRecipientPicker,'wipaint-select-all':selectAll,'wipaint-copy':copy,'wipaint-cut':cut,'wipaint-paste':paste};
    for(const [id,fn] of Object.entries(map))$(id)?.addEventListener('click',fn);
    $('wipaint-color')?.addEventListener('input',e=>S.color=e.target.value);
    $('wipaint-size')?.addEventListener('input',e=>S.size=Number(e.target.value));
    $('wipaint-opacity')?.addEventListener('input',e=>S.opacity=Number(e.target.value)/100);
  }

  function renderLayers(){
    const box=$('wipaint-layers');if(!box)return;
    box.innerHTML=S.layers.map((l,i)=>`<div class="wipaint-layer ${i===S.activeLayer?'active':''}" data-layer="${i}">
      <button type="button" data-vis="${i}">${l.visible?'👁️':'🚫'}</button>
      <span class="wipaint-layer-name">${l.locked?'🔒 ':''}${escapeHtml(l.name)}</span>
      <span class="wipaint-layer-meta">${Math.round(l.opacity*100)}% · ${escapeHtml(l.blend||"Normal")}${l.group?" · grupo":""}</span>
      <button type="button" data-lock="${i}">${l.locked?'🔒':'🔓'}</button></div>`).join('');
    box.querySelectorAll('[data-layer]').forEach(e=>e.onclick=()=>{S.activeLayer=Number(e.dataset.layer);S.selection=null;renderLayers();render();});
    box.querySelectorAll('[data-vis]').forEach(e=>e.onclick=x=>{x.stopPropagation();toggleVisible(Number(e.dataset.vis));});
    box.querySelectorAll('[data-lock]').forEach(e=>e.onclick=x=>{x.stopPropagation();S.activeLayer=Number(e.dataset.lock);toggleLock();});
  }
  function renderFrames(){
    let box=$('wipaint-frames');if(!box)return;
    box.innerHTML=S.frames.map((f,i)=>`<button class="wipaint-frame ${i===S.activeFrame?'active':''}" data-frame="${i}">${i+1}<small>${escapeHtml(f.name||'Frame')}</small></button>`).join('');
    box.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{S.frames[S.activeFrame].layers=S.layers;S.activeFrame=Number(b.dataset.frame);syncFrameLayers();renderLayers();renderFrames();render();});
  }
  function syncUI(){
    if($('wp-tool'))$('wp-tool').value=S.tool;if($('wp-brush'))$('wp-brush').value=S.brush;if($('wp-color'))$('wp-color').value=S.color;
    if($('wp-size'))$('wp-size').value=S.size;if($('wp-opacity'))$('wp-opacity').value=Math.round(S.opacity*100);
  }
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function applyGlitch(){
    const l=activeLayer();if(!l||l.locked)return;const r=S.selection||{x:0,y:0,width:l.width,height:l.height},img=selectionImage(r);if(!img)return;
    const out=makeCanvas(img.width,img.height),c=out.getContext('2d');c.globalAlpha=.9;c.drawImage(img,0,0);
    c.globalCompositeOperation='screen';c.globalAlpha=.65;c.drawImage(img,6,0);c.globalAlpha=.45;c.drawImage(img,-6,0);
    const lc=l.c.getContext('2d'),x=(r.x-l.x)*l.c.width/l.width,y=(r.y-l.y)*l.c.height/l.height,w=r.width*l.c.width/l.width,h=r.height*l.c.height/l.height;lc.clearRect(x,y,w,h);lc.drawImage(out,0,0,out.width,out.height,x,y,w,h);commit();render();
  }

  async function openRecipientPicker(){
    const st=window.App?.getState?.()||{},friends=Array.isArray(st.friends)?st.friends:[];$('wipaint-pro-picker')?.remove();
    const o=document.createElement('div');o.id='wipaint-pro-picker';o.className='wipaint-send-picker';
    const d=document.createElement('div');d.className='wipaint-send-dialog';d.innerHTML='<h3>📤 Enviar WifiPaint</h3><p>Escolha uma conversa.</p><div class="wipaint-recipient-list"></div><button class="btn btn-ghost">Cancelar</button>';
    const list=d.querySelector('.wipaint-recipient-list');
    const add=(kind,id,name)=>{const b=document.createElement('button');b.className='wipaint-recipient';b.textContent=(kind==='channel'?'📢 ':'💬 ')+name;b.onclick=()=>sendTo(kind,id,name,o);list.appendChild(b);};
    if(st.activeChannelId)add('channel',st.activeChannelId,'Canal atual');
    if(st.activeDMUserId){const f=friends.find(x=>String(x.id)===String(st.activeDMUserId));if(f)add('dm',f.id,f.displayName||f.username||'Conversa atual');}
    friends.forEach(f=>add('dm',f.id,f.displayName||f.username||'Usuário'));
    if(!list.children.length){const p=document.createElement('p');p.textContent='Nenhuma conversa disponível.';list.appendChild(p);}
    d.querySelector('.btn').onclick=()=>o.remove();o.appendChild(d);document.body.appendChild(o);
  }

  async function sendTo(kind,id,name,overlay){
    try{
      const blob=await new Promise(r=>composite().toBlob(r,'image/png'));
      const media=await new Promise((resolve,reject)=>{
        const x=new XMLHttpRequest();x.open('POST','/api/media/upload');x.withCredentials=true;x.setRequestHeader('Content-Type','image/png');x.setRequestHeader('X-File-Name',encodeURIComponent(`wipaint-${Date.now()}.png`));
        x.onload=()=>{try{const d=JSON.parse(x.responseText||'{}');if(x.status>=200&&x.status<300&&d.media)resolve(d.media);else reject(new Error(d.error||'Falha no upload'));}catch(e){reject(e)}};x.onerror=()=>reject(new Error('Falha de conexão'));x.send(blob);
      });
      const content='__MEDIA__:'+JSON.stringify(media),ack=r=>r?.error?toast(r.error,'error'):toast(`Desenho enviado para ${name}.`,'success');
      if(kind==='channel'){
        if(typeof window.ChatSocket?.sendChannelMessage==='function') window.ChatSocket.sendChannelMessage(id,content,ack);
        else if(typeof window.ChatSocket?.sendMessage==='function') window.ChatSocket.sendMessage({channelId:id,content},ack);
        else throw new Error('A API de mensagens do WifiCord não está disponível.');
      }else{
        if(typeof window.ChatSocket?.sendDMMessage==='function') window.ChatSocket.sendDMMessage(id,content,ack);
        else if(typeof window.ChatSocket?.sendMessage==='function') window.ChatSocket.sendMessage({recipientId:id,content},ack);
        else throw new Error('A API de mensagens do WifiCord não está disponível.');
      }
      overlay.remove();
    }catch(e){toast(e.message||'Não foi possível enviar.','error');}
  }

  
  async function handlePasteEvent(e){
    if(textInputFocused())return;
    const items=Array.from(e.clipboardData?.items||[]);
    const item=items.find(x=>x.type.startsWith('image/'));
    if(!item)return;
    e.preventDefault();
    const file=item.getAsFile(); if(!file)return;
    const im=new Image();
    im.onload=()=>{
      const l=activeLayer();if(!l||l.locked)return;
      const c=makeCanvas(im.width,im.height);c.getContext('2d').drawImage(im,0,0);
      S.clipboard={c,x:Math.max(0,(S.canvas.width-im.width)/2),y:Math.max(0,(S.canvas.height-im.height)/2)};
      paste();
    };
    im.src=URL.createObjectURL(file);
  }

  function keyboard(e){
    if(textInputFocused())return;
    const m=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
    if(m&&k==='a'){e.preventDefault();selectAll();return;}
    if(m&&k==='c'){e.preventDefault();copy();return;}
    if(m&&k==='x'){e.preventDefault();cut();return;}
    if(m&&k==='v'){e.preventDefault();paste();return;}
    if(m&&k==='z'&&!e.shiftKey){e.preventDefault();undo();return;}
    if(m&&(k==='y'||(k==='z'&&e.shiftKey))){e.preventDefault();redo();return;}
    if(m&&k==='s'){e.preventDefault();exportImage();return;}
    if(m&&k==='n'){e.preventDefault();newProject();return;}
    if(e.key==='Delete'&&S.selection){e.preventDefault();const l=activeLayer();if(l&&!l.locked){const r=S.selection,x=(r.x-l.x)*l.c.width/l.width,y=(r.y-l.y)*l.c.height/l.height,w=r.width*l.c.width/l.width,h=r.height*l.c.height/l.height;l.c.getContext('2d').clearRect(x,y,w,h);S.selection=null;commit();render();}return;}
    if(e.key==='Escape'){S.selection=null;S.marquee=null;S.transform=null;S.effectPreview=null;render();return;}
    if(e.code==='Space'){S.canvas.style.cursor='grab';return;}
    const map={b:'brush',e:'eraser',v:'select',m:'move',p:'pixel',i:'eyedropper',t:'text',l:'line',r:'rect',o:'circle',g:'gradient',f:'fill'};
    if(map[k])setTool(map[k]);
  }

  function init(){
    S.canvas=$('wipaint-canvas');if(!S.canvas)return;
    S.ctx=S.canvas.getContext('2d',{willReadFrequently:true});S.canvas.style.touchAction='none';
    initDocument();injectUI();bindCanvas();bindUI();loadAutosave();
    if(!S.history.length)commit();render();renderLayers();renderFrames();syncUI();
    if (!S.autosaveTimer) S.autosaveTimer = setInterval(autosave,15000);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const open=$('wipaint-open-btn');
    if(open)open.addEventListener('click',()=>setTimeout(()=>{if(!S.canvas)init();else{injectUI();renderLayers();renderFrames();render();}},0));
    else init();
  });

  window.WiPaintPro={
    open:()=>{if($('wipaint-open-btn'))$('wipaint-open-btn').click();else init();},
    state:S,
    setTool,setBrush,selectAll,clearSelection,addLayer,duplicateLayer,deleteLayer,
    undo,redo,exportImage,addFrame,frameStep,playFrames,stopFrames,openRecipientPicker
  };
})();
