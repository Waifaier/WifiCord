(function(){
'use strict';

const $=id=>document.getElementById(id);

let canvas=null;
let ctx=null;
let tool='brush';
let brush='classic';
let drawing=false;
let lastPoint=null;
let startPoint=null;
let history=[];
let future=[];
let layers=[];
let active=0;
let grid=false;
let zoom=1;
let selectionItems=[];
let selectionBounds=null;
let transform=null;
let clipboard=null;
let bound=false;

const brushes={
  classic:{label:'Clássico',opacity:1,spacing:1,texture:false},
  pencil:{label:'Lápis',opacity:.72,spacing:.65,texture:true},
  ink:{label:'Tinta',opacity:1,spacing:.9,texture:false},
  watercolor:{label:'Aquarela',opacity:.20,spacing:.28,texture:true},
  marker:{label:'Marcador',opacity:.58,spacing:1.1,texture:false},
  chalk:{label:'Giz',opacity:.38,spacing:.45,texture:true},
  airbrush:{label:'Aerógrafo',opacity:.16,spacing:.20,texture:true},
  neon:{label:'Neon',opacity:.92,spacing:1,texture:false},
  pixel:{label:'Pixel',opacity:1,spacing:1,texture:false}
};

function toast(m,t){
  window.App?.toast?.(m,t);
}

function current(){
  return layers[active];
}

function clamp(v,a,b){
  return Math.max(a,Math.min(b,v));
}

function color(){
  return $('wipaint-color')?.value||'#7c5cff';
}

function size(){
  return Number($('wipaint-size')?.value||12);
}

function opacity(){
  return Number($('wipaint-opacity')?.value||100)/100;
}

function makeLayer(name){
  const c=document.createElement('canvas');

  c.width=canvas.width;
  c.height=canvas.height;

  return {
    name,
    c,
    visible:true,
    opacity:1,
    locked:false,
    x:0,
    y:0,
    width:canvas.width,
    height:canvas.height
  };
}

function initCanvas(){
  canvas=$('wipaint-canvas');

  if(!canvas){
    console.error('WifiPaint: canvas não encontrado.');
    return;
  }

  ctx=canvas.getContext('2d',{
    willReadFrequently:true
  });

  canvas.style.touchAction='none';

  layers=[
    makeLayer('Camada 1')
  ];

  active=0;
  selectionItems=[];
  selectionBounds=null;
  history=[];
  future=[];

  renderLayers();
  injectControls();
  attachCanvasEvents();
  render();
  saveHistory();
}

function attachCanvasEvents(){
  if(bound)return;

  bound=true;

  canvas.addEventListener(
    'pointerdown',
    pointerDown
  );

  canvas.addEventListener(
    'pointermove',
    pointerMove
  );

  canvas.addEventListener(
    'pointerup',
    pointerUp
  );

  canvas.addEventListener(
    'pointercancel',
    pointerUp
  );
}

function position(e){
  const r=canvas.getBoundingClientRect();

  const sx=canvas.width/r.width;
  const sy=canvas.height/r.height;

  return {
    x:clamp(
      (e.clientX-r.left)*sx,
      0,
      canvas.width
    ),

    y:clamp(
      (e.clientY-r.top)*sy,
      0,
      canvas.height
    )
  };
}

function render(){
  if(!canvas||!ctx)return;

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.fillStyle='#fff';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  for(const l of layers){

    if(!l.visible)continue;

    ctx.save();

    ctx.globalAlpha=l.opacity;

    ctx.drawImage(
      l.c,
      l.x,
      l.y,
      l.width,
      l.height
    );

    ctx.restore();
  }

  if(grid)
    drawGrid();

  drawSelection();
}

function drawGrid(){
  ctx.save();

  ctx.globalAlpha=.14;
  ctx.strokeStyle='#64748b';
  ctx.lineWidth=1;

  for(
    let x=0;
    x<canvas.width;
    x+=16
  ){
    ctx.beginPath();

    ctx.moveTo(x,0);
    ctx.lineTo(x,canvas.height);

    ctx.stroke();
  }

  for(
    let y=0;
    y<canvas.height;
    y+=16
  ){
    ctx.beginPath();

    ctx.moveTo(0,y);
    ctx.lineTo(canvas.width,y);

    ctx.stroke();
  }

  ctx.restore();
}

function drawSelection(){
  if(!selectionBounds)return;

  const s=selectionBounds;

  ctx.save();

  ctx.strokeStyle='#7c5cff';
  ctx.lineWidth=2;

  ctx.setLineDash([
    7,
    5
  ]);

  ctx.strokeRect(
    s.x,
    s.y,
    s.width,
    s.height
  );

  ctx.setLineDash([]);

  const hs=handles(s);

  ctx.fillStyle='#fff';
  ctx.strokeStyle='#7c5cff';

  for(const h of Object.values(hs)){

    ctx.beginPath();

    ctx.rect(
      h.x-5,
      h.y-5,
      10,
      10
    );

    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function handles(s){
  return {
    nw:{
      x:s.x,
      y:s.y
    },

    n:{
      x:s.x+s.width/2,
      y:s.y
    },

    ne:{
      x:s.x+s.width,
      y:s.y
    },

    e:{
      x:s.x+s.width,
      y:s.y+s.height/2
    },

    se:{
      x:s.x+s.width,
      y:s.y+s.height
    },

    s:{
      x:s.x+s.width/2,
      y:s.y+s.height
    },

    sw:{
      x:s.x,
      y:s.y+s.height
    },

    w:{
      x:s.x,
      y:s.y+s.height/2
    }
  };
}

function hitHandle(p){
  if(!selectionBounds)
    return null;

  for(
    const [k,h]
    of Object.entries(
      handles(selectionBounds)
    )
  ){

    if(
      Math.hypot(
        p.x-h.x,
        p.y-h.y
      )<=12
    ){
      return k;
    }
  }

  return null;
}

function inside(p,s){
  return s &&
    p.x>=s.x &&
    p.x<=s.x+s.width &&
    p.y>=s.y &&
    p.y<=s.y+s.height;
}

function unionBounds(items){
  if(!items.length)
    return null;

  let x1=Infinity;
  let y1=Infinity;
  let x2=-Infinity;
  let y2=-Infinity;

  for(const r of items){

    x1=Math.min(
      x1,
      r.x
    );

    y1=Math.min(
      y1,
      r.y
    );

    x2=Math.max(
      x2,
      r.x+r.width
    );

    y2=Math.max(
      y2,
      r.y+r.height
    );
  }

  return {
    x:x1,
    y:y1,
    width:x2-x1,
    height:y2-y1
  };
}

function pixelBounds(layer){
  const c=layer.c;

  const data=
    c.getContext('2d')
     .getImageData(
       0,
       0,
       c.width,
       c.height
     ).data;

  let x1=c.width;
  let y1=c.height;
  let x2=-1;
  let y2=-1;

  for(
    let y=0;
    y<c.height;
    y++
  ){

    for(
      let x=0;
      x<c.width;
      x++
    ){

      if(
        data[
          (y*c.width+x)*4+3
        ]>8
      ){

        x1=Math.min(
          x1,
          x
        );

        y1=Math.min(
          y1,
          y
        );

        x2=Math.max(
          x2,
          x
        );

        y2=Math.max(
          y2,
          y
        );
      }
    }
  }

  if(x2<0)
    return null;

  return {
    x:x1,
    y:y1,
    width:x2-x1+1,
    height:y2-y1+1
  };
}

function componentAt(layer,p){

  const w=layer.c.width;
  const h=layer.c.height;

  const data=
    layer.c
      .getContext('2d')
      .getImageData(
        0,
        0,
        w,
        h
      ).data;

  const px=Math.floor(
    (p.x-layer.x)*
    w/
    layer.width
  );

  const py=Math.floor(
    (p.y-layer.y)*
    h/
    layer.height
  );

  if(
    px<0||
    py<0||
    px>=w||
    py>=h
  ){
    return null;
  }

  const start=
    (py*w+px)*4;

  if(
    data[start+3]<=8
  ){
    return null;
  }

  const seen=
    new Uint8Array(
      w*h
    );

  const qx=
    new Int32Array(
      w*h
    );

  const qy=
    new Int32Array(
      w*h
    );

  let head=0;
  let tail=0;

  qx[tail]=px;
  qy[tail]=py;

  tail++;

  seen[
    py*w+px
  ]=1;

  let minX=px;
  let maxX=px;
  let minY=py;
  let maxY=py;
  let count=0;

  while(
    head<tail
  ){

    const x=qx[head];
    const y=qy[head];

    head++;

    count++;

    minX=Math.min(
      minX,
      x
    );

    maxX=Math.max(
      maxX,
      x
    );

    minY=Math.min(
      minY,
      y
    );

    maxY=Math.max(
      maxY,
      y
    );

    const neighbors=[
      [x+1,y],
      [x-1,y],
      [x,y+1],
      [x,y-1]
    ];

    for(
      const [nx,ny]
      of neighbors
    ){

      if(
        nx<0||
        ny<0||
        nx>=w||
        ny>=h
      ){
        continue;
      }

      const index=
        ny*w+nx;

      if(seen[index])
        continue;

      if(
        data[
          index*4+3
        ]<=8
      ){
        continue;
      }

      seen[index]=1;

      qx[tail]=nx;
      qy[tail]=ny;

      tail++;
    }

    if(
      count>300000
    ){
      break;
    }
  }

  return {
    x:
      layer.x+
      minX*layer.width/w,

    y:
      layer.y+
      minY*layer.height/h,

    width:
      (maxX-minX+1)*
      layer.width/w,

    height:
      (maxY-minY+1)*
      layer.height/h
  };
}

function selectAll(){
  const layer=current();

  if(!layer)
    return;

  const bounds=
    pixelBounds(layer);

  selectionItems=
    bounds
      ? [bounds]
      : [];

  selectionBounds=
    unionBounds(
      selectionItems
    );

  render();

  toast(
    selectionBounds
      ? 'Conteúdo selecionado.'
      : 'Não há desenho para selecionar.',
    'success'
  );
}

function selectAt(p,remove){

  const layer=current();

  if(
    !layer||
    layer.locked
  ){
    return;
  }

  const item=
    componentAt(
      layer,
      p
    );

  if(!item)
    return;

  const same=r=>
    Math.abs(
      r.x-item.x
    )<1&&
    Math.abs(
      r.y-item.y
    )<1&&
    Math.abs(
      r.width-item.width
    )<1&&
    Math.abs(
      r.height-item.height
    )<1;

  if(remove){

    selectionItems=
      selectionItems.filter(
        r=>!same(r)
      );

  }else if(
    !selectionItems.some(same)
  ){

    selectionItems.push(
      item
    );
  }

  selectionBounds=
    unionBounds(
      selectionItems
    );

  render();
}

function beginTransform(p,mode){

  const layer=current();

  if(
    !layer||
    layer.locked
  ){
    toast(
      'A camada está bloqueada.',
      'error'
    );

    return false;
  }

  if(!selectionBounds)
    return false;

  const s=
    selectionBounds;

  const temp=
    document.createElement(
      'canvas'
    );

  temp.width=
    Math.max(
      1,
      Math.round(
        s.width
      )
    );

  temp.height=
    Math.max(
      1,
      Math.round(
        s.height
      )
    );

  temp
    .getContext('2d')
    .drawImage(
      layer.c,

      (s.x-layer.x)*
        layer.c.width/
        layer.width,

      (s.y-layer.y)*
        layer.c.height/
        layer.height,

      s.width*
        layer.c.width/
        layer.width,

      s.height*
        layer.c.height/
        layer.height,

      0,
      0,
      temp.width,
      temp.height
    );

  layer.c
    .getContext('2d')
    .clearRect(
      (s.x-layer.x)*
        layer.c.width/
        layer.width,

      (s.y-layer.y)*
        layer.c.height/
        layer.height,

      s.width*
        layer.c.width/
        layer.width,

      s.height*
        layer.c.height/
        layer.height
    );

  transform={
    mode,

    start:{
      ...p
    },

    original:{
      ...s
    },

    image:temp,

    layerX:layer.x,
    layerY:layer.y
  };

  return true;
}

function applyTransform(p,e){

  const layer=current();

  if(
    !transform||
    !layer
  ){
    return;
  }

  const o=
    transform.original;

  const dx=
    p.x-
    transform.start.x;

  const dy=
    p.y-
    transform.start.y;

  let x=o.x;
  let y=o.y;
  let w=o.width;
  let h=o.height;

  const m=
    transform.mode;

  if(m==='move'){

    x=o.x+dx;
    y=o.y+dy;

  }else{

    if(
      m.includes('e')
    ){
      w=Math.max(
        4,
        o.width+dx
      );
    }

    if(
      m.includes('s')
    ){
      h=Math.max(
        4,
        o.height+dy
      );
    }

    if(
      m.includes('w')
    ){

      w=Math.max(
        4,
        o.width-dx
      );

      x=
        o.x+
        o.width-
        w;
    }

    if(
      m.includes('n')
    ){

      h=Math.max(
        4,
        o.height-dy
      );

      y=
        o.y+
        o.height-
        h;
    }

    if(
      e.shiftKey
    ){

      const ratio=
        o.width/
        o.height;

      if(
        Math.abs(dx)>
        Math.abs(dy)
      ){

        h=
          Math.max(
            4,
            w/ratio
          );

      }else{

        w=
          Math.max(
            4,
            h*ratio
          );
      }
    }
  }

  const c=
    layer.c.getContext(
      '2d'
    );

  const old={
    x:o.x,
    y:o.y,
    width:o.width,
    height:o.height
  };

  c.clearRect(
    (old.x-layer.x)*
      layer.c.width/
      layer.width,

    (old.y-layer.y)*
      layer.c.height/
      layer.height,

    old.width*
      layer.c.width/
      layer.width,

    old.height*
      layer.c.height/
      layer.height
  );

  c.drawImage(
    transform.image,
    0,
    0,
    transform.image.width,
    transform.image.height,

    (x-layer.x)*
      layer.c.width/
      layer.width,

    (y-layer.y)*
      layer.c.height/
      layer.height,

    w*
      layer.c.width/
      layer.width,

    h*
      layer.c.height/
      layer.height
  );

  selectionBounds={
    x,
    y,
    width:w,
    height:h
  };

  selectionItems=[
    selectionBounds
  ];

  render();
}

function clearSelection(){

  selectionItems=[];
  selectionBounds=null;
  transform=null;

  render();
}

function cropSelectedCanvas(){

  if(!selectionBounds)
    return null;

  const l=current();
  const s=
    selectionBounds;

  const out=
    document.createElement(
      'canvas'
    );

  out.width=
    Math.max(
      1,
      Math.round(
        s.width
      )
    );

  out.height=
    Math.max(
      1,
      Math.round(
        s.height
      )
    );

  out
    .getContext('2d')
    .drawImage(
      l.c,

      (s.x-l.x)*
        l.c.width/
        l.width,

      (s.y-l.y)*
        l.c.height/
        l.height,

      s.width*
        l.c.width/
        l.width,

      s.height*
        l.c.height/
        l.height,

      0,
      0,
      out.width,
      out.height
    );

  return out;
}

async function copySelection(){

  if(!selectionBounds)
    selectAll();

  const out=
    cropSelectedCanvas();

  if(!out)
    return;

  clipboard={
    canvas:out,
    x:selectionBounds.x+20,
    y:selectionBounds.y+20
  };

  try{

    const blob=
      await new Promise(
        r=>out.toBlob(
          r,
          'image/png'
        )
      );

    if(
      navigator.clipboard&&
      window.ClipboardItem
    ){

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png':blob
        })
      ]);
    }

  }catch(_){}

  toast(
    'Copiado.',
    'success'
  );
}

function cutSelection(){

  if(!selectionBounds)
    selectAll();

  if(!selectionBounds)
    return;

  copySelection();

  eraseSelection();

  toast(
    'Recortado.',
    'success'
  );
}

function eraseSelection(){

  if(!selectionBounds)
    return;

  const l=current();

  if(
    !l||
    l.locked
  ){
    toast(
      'A camada está bloqueada.',
      'error'
    );

    return;
  }

  const s=
    selectionBounds;

  const c=
    l.c.getContext(
      '2d'
    );

  c.clearRect(
    (s.x-l.x)*
      l.c.width/
      l.width,

    (s.y-l.y)*
      l.c.height/
      l.height,

    s.width*
      l.c.width/
      l.width,

    s.height*
      l.c.height/
      l.height
  );

  clearSelection();

  commit();
}

function pasteSelection(){

  if(!clipboard){

    toast(
      'Nada copiado.',
      'error'
    );

    return;
  }

  const l=current();

  if(
    !l||
    l.locked
  ){
    toast(
      'A camada está bloqueada.',
      'error'
    );

    return;
  }

  const x=
    selectionBounds
      ? selectionBounds.x
      : clipboard.x;

  const y=
    selectionBounds
      ? selectionBounds.y
      : clipboard.y;

  const c=
    l.c.getContext(
      '2d'
    );

  c.drawImage(
    clipboard.canvas,
    x-l.x,
    y-l.y
  );

  selectionBounds={
    x,
    y,
    width:clipboard.canvas.width,
    height:clipboard.canvas.height
  };

  selectionItems=[
    selectionBounds
  ];

  render();

  commit();

  toast(
    'Colado.',
    'success'
  );
}

function setupBrush(c){

  const b=
    brushes[brush]||
    brushes.classic;

  c.globalAlpha=
    opacity()*
    b.opacity;

  c.strokeStyle=
    color();

  c.fillStyle=
    color();

  c.lineWidth=
    brush==='pixel'
      ?Math.max(
        4,
        Math.round(
          size()/4
        )*4
      )
      :size();

  c.lineCap=
    brush==='pixel'
      ?'butt'
      :'round';

  c.lineJoin='round';

  c.shadowBlur=0;

  if(
    brush==='neon'
  ){

    c.shadowColor=
      color();

    c.shadowBlur=
      Math.max(
        8,
        size()
      );
  }
}

function drawPoint(p){

  const l=current();

  if(
    !l||
    l.locked
  ){
    return;
  }

  const c=
    l.c.getContext(
      '2d'
    );

  setupBrush(c);

  const sx=
    l.c.width/
    l.width;

  const sy=
    l.c.height/
    l.height;

  const x=
    (p.x-l.x)*
    sx;

  const y=
    (p.y-l.y)*
    sy;

  if(
    brush==='watercolor'||
    brush==='airbrush'||
    brush==='chalk'
  ){

    const amount=
      brush==='airbrush'
        ?18
        :brush==='watercolor'
          ?8
          :5;

    for(
      let i=0;
      i<amount;
      i++
    ){

      const spread=
        size()*
        (Math.random()-.5);

      c.globalAlpha=
        opacity()*
        brushes[brush].opacity;

      c.beginPath();

      c.arc(
        x+spread,
        y+spread,
        Math.max(
          1,
          size()*
          (
            .25+
            Math.random()*.75
          )
        ),
        0,
        Math.PI*2
      );

      c.fill();
    }

  }else{

    c.beginPath();

    c.arc(
      x,
      y,
      Math.max(
        .5,
        size()/2
      ),
      0,
      Math.PI*2
    );

    c.fill();
  }

  c.globalCompositeOperation=
    'source-over';

  c.shadowBlur=0;
}

function drawLine(a,b){

  const l=current();

  if(
    !l||
    l.locked
  ){
    return;
  }

  const c=
    l.c.getContext(
      '2d'
    );

  setupBrush(c);

  const sx=
    l.c.width/
    l.width;

  const sy=
    l.c.height/
    l.height;

  c.beginPath();

  c.moveTo(
    (a.x-l.x)*sx,
    (a.y-l.y)*sy
  );

  c.lineTo(
    (b.x-l.x)*sx,
    (b.y-l.y)*sy
  );

  c.stroke();

  c.globalCompositeOperation=
    'source-over';

  c.shadowBlur=0;
}

function floodFill(p){

  const l=current();

  if(
    !l||
    l.locked
  ){
    return;
  }

  const c=
    l.c.getContext(
      '2d'
    );

  const w=l.c.width;
  const h=l.c.height;

  const sx=
    Math.floor(
      (p.x-l.x)*
      w/
      l.width
    );

  const sy=
    Math.floor(
      (p.y-l.y)*
      h/
      l.height
    );

  if(
    sx<0||
    sy<0||
    sx>=w||
    sy>=h
  ){
    return;
  }

  const image=
    c.getImageData(
      0,
      0,
      w,
      h
    );

  const data=image.data;

  const startIndex=
    (sy*w+sx)*4;

  const target=[
    data[startIndex],
    data[startIndex+1],
    data[startIndex+2],
    data[startIndex+3]
  ];

  const fillColor=
    hexToRgba(
      color(),
      Math.round(
        opacity()*255
      )
    );

  if(
    target[0]===fillColor[0]&&
    target[1]===fillColor[1]&&
    target[2]===fillColor[2]&&
    target[3]===fillColor[3]
  ){
    return;
  }

  const stack=[
    [sx,sy]
  ];

  const visited=
    new Uint8Array(
      w*h
    );

  function matches(x,y){

    if(
      x<0||
      y<0||
      x>=w||
      y>=h
    ){
      return false;
    }

    const i=
      (y*w+x)*4;

    return (
      Math.abs(
        data[i]-
        target[0]
      )<10&&
      Math.abs(
        data[i+1]-
        target[1]
      )<10&&
      Math.abs(
        data[i+2]-
        target[2]
      )<10&&
      Math.abs(
        data[i+3]-
        target[3]
      )<10
    );
  }

  while(stack.length){

    const [
      x,
      y
    ]=stack.pop();

    const index=
      y*w+x;

    if(visited[index])
      continue;

    visited[index]=1;

    if(!matches(x,y))
      continue;

    const i=
      index*4;

    data[i]=fillColor[0];
    data[i+1]=fillColor[1];
    data[i+2]=fillColor[2];
    data[i+3]=fillColor[3];

    stack.push(
      [x+1,y],
      [x-1,y],
      [x,y+1],
      [x,y-1]
    );
  }

  c.putImageData(
    image,
    0,
    0
  );

  render();

  commit();
}

function hexToRgba(hex,a){

  const value=
    hex.replace(
      '#',
      ''
    );

  return [
    parseInt(
      value.substring(0,2),
      16
    ),

    parseInt(
      value.substring(2,4),
      16
    ),

    parseInt(
      value.substring(4,6),
      16
    ),

    a
  ];
}

function drawShape(a,b){

  const l=current();

  if(
    !l||
    l.locked
  ){
    return;
  }

  const c=
    l.c.getContext(
      '2d'
    );

  setupBrush(c);

  const x=
    (a.x-l.x)*
    l.c.width/
    l.width;

  const y=
    (a.y-l.y)*
    l.c.height/
    l.height;

  const ex=
    (b.x-l.x)*
    l.c.width/
    l.width;

  const ey=
    (b.y-l.y)*
    l.c.height/
    l.height;

  const w=ex-x;
  const h=ey-y;

  c.beginPath();

  if(tool==='line'){

    c.moveTo(
      x,
      y
    );

    c.lineTo(
      ex,
      ey
    );

    c.stroke();

  }else if(tool==='rect'){

    c.strokeRect(
      x,
      y,
      w,
      h
    );

  }else if(tool==='circle'){

    c.ellipse(
      x+w/2,
      y+h/2,
      Math.abs(w/2),
      Math.abs(h/2),
      0,
      0,
      Math.PI*2
    );

    c.stroke();
  }

  c.shadowBlur=0;
}

function pointerDown(e){

  if(e.button!==0)
    return;

  if(!canvas)
    return;

  e.preventDefault();

  try{
    canvas.setPointerCapture(
      e.pointerId
    );
  }catch(_){}

  const p=
    position(e);

  if(tool==='select'){

    const handle=
      hitHandle(p);

    if(handle){

      beginTransform(
        p,
        handle
      );

      return;
    }

    if(
      inside(
        p,
        selectionBounds
      )
    ){

      beginTransform(
        p,
        'move'
      );

      return;
    }

    selectAt(
      p,
      e.ctrlKey||e.metaKey
    );

    return;
  }

  const l=current();

  if(
    !l||
    l.locked
  ){

    toast(
      'A camada está bloqueada.',
      'error'
    );

    return;
  }

  drawing=true;

  startPoint=p;
  lastPoint=p;

  if(
    tool==='brush'||
    tool==='eraser'||
    tool==='pixel'
  ){

    if(tool==='eraser')
      brush='classic';

    const c=
      l.c.getContext(
        '2d'
      );

    setupBrush(c);

    if(
      tool==='eraser'
    ){
      c.globalCompositeOperation=
        'destination-out';
    }

    drawPoint(p);

    render();

  }else if(
    tool==='fill'
  ){

    floodFill(p);

    drawing=false;

  }else if(
    tool==='eyedropper'
  ){

    const pixel=
      ctx.getImageData(
        Math.floor(p.x),
        Math.floor(p.y),
        1,
        1
      ).data;

    const value=
      '#'+
      [pixel[0],pixel[1],pixel[2]]
        .map(
          n=>
            n
              .toString(16)
              .padStart(
                2,
                '0'
              )
        )
        .join('');

    if(
      $('wipaint-color')
    ){
      $('wipaint-color').value=
        value;
    }

    drawing=false;

  }else if(
    tool==='text'
  ){

    const text=
      prompt(
        'Digite o texto:'
      );

    if(text){

      const c=
        l.c.getContext(
          '2d'
        );

      c.fillStyle=
        color();

      c.globalAlpha=
        opacity();

      c.font=
        `600 ${Math.max(
          14,
          size()*2
        )}px Arial`;

      c.fillText(
        text,
        p.x-l.x,
        p.y-l.y
      );

      c.globalAlpha=1;

      render();

      commit();
    }

    drawing=false;
  }
}

function pointerMove(e){

  const p=
    position(e);

  if(
    tool==='select'&&
    transform
  ){

    applyTransform(
      p,
      e
    );

    return;
  }

  if(!drawing)
    return;

  e.preventDefault();

  if(
    tool==='brush'||
    tool==='eraser'||
    tool==='pixel'
  ){

    drawLine(
      lastPoint,
      p
    );

    lastPoint=p;

    render();
  }
}

function pointerUp(e){

  if(transform){

    transform=null;

    commit();

    return;
  }

  if(!drawing)
    return;

  const p=
    position(e);

  if(
    tool==='line'||
    tool==='rect'||
    tool==='circle'
  ){

    const state=
      history[
        history.length-1
      ];

    restore(state).then(
      ()=>{

        drawShape(
          startPoint,
          p
        );

        render();

        commit();
      }
    );

  }else if(
    tool==='brush'||
    tool==='eraser'||
    tool==='pixel'
  ){

    commit();
  }

  drawing=false;
  lastPoint=null;
  startPoint=null;

  try{
    canvas.releasePointerCapture(
      e.pointerId
    );
  }catch(_){}
}

function snapshot(){

  return layers.map(
    l=>({
      name:l.name,
      visible:l.visible,
      opacity:l.opacity,
      locked:l.locked,
      x:l.x,
      y:l.y,
      width:l.width,
      height:l.height,
      data:l.c.toDataURL(
        'image/png'
      )
    })
  );
}

function restore(snap){

  if(!snap)
    return Promise.resolve();

  return Promise.all(
    snap.map(
      x=>
        new Promise(
          resolve=>{

            const l=
              makeLayer(
                x.name
              );

            l.visible=
              x.visible;

            l.opacity=
              x.opacity;

            l.locked=
              x.locked;

            l.x=
              x.x??0;

            l.y=
              x.y??0;

            l.width=
              x.width??
              canvas.width;

            l.height=
              x.height??
              canvas.height;

            const im=
              new Image();

            im.onload=()=>{

              l.c
                .getContext(
                  '2d'
                )
                .drawImage(
                  im,
                  0,
                  0
                );

              resolve(l);
            };

            im.src=x.data;
          }
        )
    )
  ).then(
    ls=>{

      layers=ls;

      active=
        Math.min(
          active,
          layers.length-1
        );

      renderLayers();
      render();
    }
  );
}

function saveHistory(){

  history.push(
    snapshot()
  );

  if(
    history.length>40
  ){
    history.shift();
  }

  future=[];
}

async function undo(){

  if(
    history.length<=1
  ){
    toast(
      'Nada para desfazer.',
      'error'
    );

    return;
  }

  const state=
    history.pop();

  future.push(
    state
  );

  await restore(
    history[
      history.length-1
    ]
  );
}

async function redo(){

  if(!future.length){

    toast(
      'Nada para refazer.',
      'error'
    );

    return;
  }

  const state=
    future.pop();

  history.push(
    state
  );

  await restore(
    state
  );
}

function commit(){
  saveHistory();
}

function clearLayer(){

  const l=current();

  if(
    !l||
    l.locked
  ){
    toast(
      'A camada está bloqueada.',
      'error'
    );

    return;
  }

  l.c
    .getContext(
      '2d'
    )
    .clearRect(
      0,
      0,
      l.c.width,
      l.c.height
    );

  clearSelection();

  render();

  commit();
}

function addLayer(){

  layers.push(
    makeLayer(
      `Camada ${layers.length+1}`
    )
  );

  active=
    layers.length-1;

  clearSelection();

  renderLayers();
  render();

  commit();
}

function deleteLayer(){

  if(
    layers.length<=1
  ){

    toast(
      'Mantenha pelo menos uma camada.',
      'error'
    );

    return;
  }

  layers.splice(
    active,
    1
  );

  active=
    Math.max(
      0,
      active-1
    );

  clearSelection();

  renderLayers();
  render();

  commit();
}

function duplicateLayer(){

  const source=
    current();

  if(!source)
    return;

  const l=
    makeLayer(
      source.name+
      ' cópia'
    );

  l.opacity=
    source.opacity;

  l.visible=
    source.visible;

  l.locked=false;

  l.x=source.x;
  l.y=source.y;
  l.width=source.width;
  l.height=source.height;

  l.c
    .getContext(
      '2d'
    )
    .drawImage(
      source.c,
      0,
      0
    );

  layers.splice(
    active+1,
    0,
    l
  );

  active++;

  renderLayers();
  render();

  commit();
}

function toggleLock(){

  const l=current();

  if(!l)
    return;

  l.locked=
    !l.locked;

  renderLayers();

  toast(
    l.locked
      ? 'Camada bloqueada.'
      : 'Camada desbloqueada.',
    'success'
  );
}

function toggleVisibleAt(i){

  layers[i].visible=
    !layers[i].visible;

  renderLayers();
  render();

  commit();
}

function moveLayer(direction){

  const target=
    active+direction;

  if(
    target<0||
    target>=layers.length
  ){
    return;
  }

  const temp=
    layers[active];

  layers[active]=
    layers[target];

  layers[target]=
    temp;

  active=target;

  renderLayers();
  render();

  commit();
}

function applyEffect(type,intensity){

  const l=current();

  if(
    !l||
    l.locked
  ){
    toast(
      'A camada está bloqueada.',
      'error'
    );

    return;
  }

  const source=
    selectionBounds
      ?cropSelectedCanvas()
      :l.c;

  if(!source)
    return;

  const c=
    source.getContext(
      '2d'
    );

  const image=
    c.getImageData(
      0,
      0,
      source.width,
      source.height
    );

  const data=image.data;

  const amount=
    Number(intensity)/100;

  for(
    let i=0;
    i<data.length;
    i+=4
  ){

    const r=data[i];
    const g=data[i+1];
    const b=data[i+2];

    let nr=r;
    let ng=g;
    let nb=b;

    if(type==='grayscale'){

      const v=
        .299*r+
        .587*g+
        .114*b;

      nr=
        r+(v-r)*amount;

      ng=
        g+(v-g)*amount;

      nb=
        b+(v-b)*amount;

    }else if(
      type==='sepia'
    ){

      const sr=
        .393*r+
        .769*g+
        .189*b;

      const sg=
        .349*r+
        .686*g+
        .168*b;

      const sb=
        .272*r+
        .534*g+
        .131*b;

      nr=
        r+(sr-r)*amount;

      ng=
        g+(sg-g)*amount;

      nb=
        b+(sb-b)*amount;

    }else if(
      type==='invert'
    ){

      nr=
        r+(255-r)*amount;

      ng=
        g+(255-g)*amount;

      nb=
        b+(255-b)*amount;

    }else if(
      type==='warm'
    ){

      nr=
        clamp(
          r+45*amount,
          0,
          255
        );

      ng=
        clamp(
          g+15*amount,
          0,
          255
        );

      nb=
        clamp(
          b-25*amount,
          0,
          255
        );

    }else if(
      type==='cool'
    ){

      nr=
        clamp(
          r-25*amount,
          0,
          255
        );

      ng=
        clamp(
          g+10*amount,
          0,
          255
        );

      nb=
        clamp(
          b+45*amount,
          0,
          255
        );

    }else if(
      type==='contrast'
    ){

      const factor=
        (259*
          (128+255*amount))/
        (255*
          (259-255*amount));

      nr=
        clamp(
          factor*(r-128)+128,
          0,
          255
        );

      ng=
        clamp(
          factor*(g-128)+128,
          0,
          255
        );

      nb=
        clamp(
          factor*(b-128)+128,
          0,
          255
        );
    }

    data[i]=nr;
    data[i+1]=ng;
    data[i+2]=nb;
  }

  c.putImageData(
    image,
    0,
    0
  );

  render();

  commit();

  toast(
    'Efeito aplicado.',
    'success'
  );
}

function escapeHtml(value){

  return String(value)
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

function getChatState(){

  const st=
    window.App||
    window.WifiCord||
    {};

  return st;
}

function sendToChat(){

  const output=
    document.createElement(
      'canvas'
    );

  output.width=
    canvas.width;

  output.height=
    canvas.height;

  const oc=
    output.getContext(
      '2d'
    );

  oc.fillStyle='#fff';

  oc.fillRect(
    0,
    0,
    output.width,
    output.height
  );

  for(
    const l
    of layers
  ){

    if(!l.visible)
      continue;

    oc.globalAlpha=
      l.opacity;

    oc.drawImage(
      l.c,
      l.x,
      l.y,
      l.width,
      l.height
    );
  }

  oc.globalAlpha=1;

  output.toBlob(
    async blob=>{

      if(!blob){
        toast(
          'Não foi possível criar a imagem.',
          'error'
        );

        return;
      }

      const file=
        new File(
          [
            blob
          ],
          `wipaint-${Date.now()}.png`,
          {
            type:'image/png'
          }
        );

      const target=
        await chooseChatTarget();

      if(!target)
        return;

      try{

        if(
          window.WCMedia&&
          typeof
          window.WCMedia.sendFile==='function'
        ){

          await window.WCMedia.sendFile(
            file,
            target
          );

          toast(
            'Desenho enviado.',
            'success'
          );

          return;
        }

        const form=
          new FormData();

        form.append(
          'file',
          file
        );

        const response=
          await fetch(
            '/api/media/upload',
            {
              method:'POST',
              body:form,
              credentials:'include'
            }
          );

        if(!response.ok)
          throw new Error(
            'Falha no upload.'
          );

        const result=
          await response.json();

        if(
          window.ChatSocket&&
          typeof
          window.ChatSocket.sendMessage==='function'
        ){

          await window.ChatSocket.sendMessage(
            target.type,
            target.id,
            '',
            result
          );

        }else{

          toast(
            'Sistema de envio do chat não encontrado.',
            'error'
          );

          return;
        }

        toast(
          'Desenho enviado.',
          'success'
        );

      }catch(error){

        console.error(
          'WifiPaint send:',
          error
        );

        toast(
          'Não foi possível enviar o desenho.',
          'error'
        );
      }

    },
    'image/png'
  );
}

function chooseChatTarget(){

  return new Promise(
    resolve=>{

      const overlay=
        document.createElement(
          'div'
        );

      overlay.id=
        'wipaint-target-overlay';

      overlay.style.cssText=
        `
        position:fixed;
        inset:0;
        z-index:99999;
        display:flex;
        align-items:center;
        justify-content:center;
        background:rgba(0,0,0,.72);
        backdrop-filter:blur(8px);
        `;

      const box=
        document.createElement(
          'div'
        );

      box.style.cssText=
        `
        width:min(480px,92vw);
        max-height:75vh;
        overflow:auto;
        padding:20px;
        border-radius:18px;
        background:#171421;
        color:#fff;
        border:1px solid #ffffff14;
        box-shadow:0 20px 60px rgba(0,0,0,.5);
        `;

      const title=
        document.createElement(
          'h3'
        );

      title.textContent=
        '📤 Enviar desenho';

      title.style.margin=
        '0 0 6px';

      const subtitle=
        document.createElement(
          'p'
        );

      subtitle.textContent=
        'Escolha para quem deseja enviar.';

      subtitle.style.cssText=
        'margin:0 0 14px;color:#aaa;';

      const list=
        document.createElement(
          'div'
        );

      list.style.cssText=
        `
        display:flex;
        flex-direction:column;
        gap:8px;
        `;

      const close=
        document.createElement(
          'button'
        );

      close.type='button';

      close.textContent=
        'Cancelar';

      close.className=
        'btn btn-ghost';

      close.style.marginTop=
        '14px';

      close.onclick=()=>{
        overlay.remove();
        resolve(null);
      };

      box.appendChild(title);
      box.appendChild(subtitle);
      box.appendChild(list);
      box.appendChild(close);

      overlay.appendChild(box);

      document.body.appendChild(
        overlay
      );

      const state=
        getChatState();

      const friends=
        Array.isArray(
          state.friends
        )
          ?state.friends
          :[];

      const channels=
        Array.isArray(
          state.channels
        )
          ?state.channels
          :[];

      const targets=[];

      for(
        const friend
        of friends
      ){

        targets.push({
          type:'dm',
          id:friend.id,
          name:
            friend.username||
            friend.name||
            'Usuário',
          sub:'Mensagem direta'
        });
      }

      for(
        const channel
        of channels
      ){

        if(
          channel.type==='voice'
        )
          continue;

        targets.push({
          type:'channel',
          id:channel.id,
          name:
            '# '+
            (
              channel.name||
              'canal'
            ),
          sub:'Canal do servidor'
        });
      }

      if(!targets.length){

        const empty=
          document.createElement(
            'div'
          );

        empty.textContent=
          'Nenhuma conversa disponível.';

        empty.style.color=
          '#aaa';

        list.appendChild(
          empty
        );

      }else{

        for(
          const target
          of targets
        ){

          const button=
            document.createElement(
              'button'
            );

          button.type='button';

          button.style.cssText=
            `
            text-align:left;
            padding:12px;
            border:1px solid #ffffff12;
            border-radius:10px;
            background:#211d30;
            color:#fff;
            cursor:pointer;
            `;

          button.innerHTML=
            `
            <strong>
              ${escapeHtml(
                target.name
              )}
            </strong>

            <small
              style="
              display:block;
              color:#aaa;
              margin-top:3px;
              "
            >
              ${escapeHtml(
                target.sub
              )}
            </small>
            `;

          button.onclick=()=>{
            overlay.remove();
            resolve(target);
          };

          list.appendChild(
            button
          );
        }
      }

      overlay.onclick=
        event=>{
          if(
            event.target===
            overlay
          ){

            overlay.remove();

            resolve(null);
          }
        };
    }
  );
}

function injectControls(){

  const bar=
    document.querySelector(
      '.wipaint-toolbar'
    );

  if(!bar)
    return;

  if(!$('wipaint-brush')){

    const select=
      document.createElement(
        'select'
      );

    select.id=
      'wipaint-brush';

    select.title=
      'Pincel';

    select.innerHTML=
      Object.entries(
        brushes
      )
      .map(
        ([key,value])=>
          `
          <option value="${key}">
            ${value.label}
          </option>
          `
      )
      .join('');

    select.onchange=
      e=>{
        brush=
          e.target.value;
      };

    bar.insertBefore(
      select,
      bar.children[1]
    );
  }

  if(!$('wipaint-send')){

    const button=
      document.createElement(
        'button'
      );

    button.id=
      'wipaint-send';

    button.type='button';

    button.className=
      'btn btn-primary';

    button.textContent=
      '📤 Enviar na conversa';

    button.onclick=
      sendToChat;

    bar.appendChild(
      button
    );
  }

  if(!$('wipaint-effects')){

    const wrap=
      document.createElement(
        'div'
      );

    wrap.id=
      'wipaint-effects';

    wrap.style.cssText=
      `
      display:flex;
      gap:6px;
      align-items:center;
      flex-wrap:wrap;
      width:100%;
      padding-top:4px;
      border-top:1px solid #ffffff10;
      `;

    wrap.innerHTML=
      `
      <strong
        style="
        font-size:12px;
        color:#a8a3b7;
        "
      >
        ✨ Efeito
      </strong>

      <select id="wipaint-effect">

        <option value="none">
          Nenhum
        </option>

        <option value="grayscale">
          P&B
        </option>

        <option value="sepia">
          Sépia
        </option>

        <option value="invert">
          Inverter
        </option>

        <option value="warm">
          Quente
        </option>

        <option value="cool">
          Frio
        </option>

        <option value="contrast">
          Contraste
        </option>

      </select>

      <label
        class="wipaint-range"
      >
        Intensidade

        <input
          id="wipaint-effect-intensity"
          type="range"
          min="0"
          max="100"
          value="100"
        >

        <span
          id="wipaint-effect-value"
        >
          100%
        </span>
      </label>

      <button
        id="wipaint-apply-effect"
        class="btn btn-small"
        type="button"
      >
        Aplicar
      </button>
      `;

    bar.appendChild(
      wrap
    );

    $('wipaint-effect-intensity')
      .oninput=
      e=>{
        $('wipaint-effect-value')
          .textContent=
          e.target.value+
          '%';
      };

    $('wipaint-apply-effect')
      .onclick=
      ()=>{
        const name=
          $('wipaint-effect')
            .value;

        if(
          name!=='none'
        ){

          applyEffect(
            name,
            $('wipaint-effect-intensity')
              .value
          );
        }
      };
  }

  if(!$('wipaint-select-all')){

    const controls=
      document.createElement(
        'div'
      );

    controls.style.cssText=
      `
      display:flex;
      gap:6px;
      align-items:center;
      flex-wrap:wrap;
      width:100%;
      padding-top:4px;
      `;

    controls.innerHTML=
      `
      <button
        id="wipaint-select-all"
        class="btn btn-small"
        type="button"
      >
        🎯 Selecionar conteúdo
      </button>

      <button
        id="wipaint-copy"
        class="btn btn-small"
        type="button"
      >
        📋 Copiar
      </button>

      <button
        id="wipaint-cut"
        class="btn btn-small"
        type="button"
      >
        ✂️ Recortar
      </button>

      <button
        id="wipaint-paste"
        class="btn btn-small"
        type="button"
      >
        📥 Colar
      </button>

      <button
        id="wipaint-delete-selection"
        class="btn btn-small"
        type="button"
      >
        🗑️ Apagar seleção
      </button>
      `;

    bar.appendChild(
      controls
    );

    $('wipaint-select-all')
      .onclick=
      selectAll;

    $('wipaint-copy')
      .onclick=
      copySelection;

    $('wipaint-cut')
      .onclick=
      cutSelection;

    $('wipaint-paste')
      .onclick=
      pasteSelection;

    $('wipaint-delete-selection')
      .onclick=
      eraseSelection;
  }

  if(!$('wipaint-layer-lock')){

    const actions=
      $('.wipaint-layer-actions');

    if(actions){

      const lock=
        document.createElement(
          'button'
        );

      lock.id=
        'wipaint-layer-lock';

      lock.className=
        'btn btn-small';

      lock.type='button';

      lock.textContent=
        '🔒 Bloquear';

      lock.onclick=
        toggleLock;

      actions.appendChild(
        lock
      );

      const up=
        document.createElement(
          'button'
        );

      up.id=
        'wipaint-layer-up';

      up.className=
        'btn btn-small';

      up.type='button';

      up.textContent=
        '⬆️';

      up.onclick=
        ()=>{
          moveLayer(1);
        };

      actions.appendChild(
        up
      );

      const down=
        document.createElement(
          'button'
        );

      down.id=
        'wipaint-layer-down';

      down.className=
        'btn btn-small';

      down.type='button';

      down.textContent=
        '⬇️';

      down.onclick=
        ()=>{
          moveLayer(-1);
        };

      actions.appendChild(
        down
      );

      const duplicate=
        document.createElement(
          'button'
        );

      duplicate.id=
        'wipaint-duplicate-layer';

      duplicate.className=
        'btn btn-small';

      duplicate.type='button';

      duplicate.textContent=
        '📑 Duplicar';

      duplicate.onclick=
        duplicateLayer;

      actions.appendChild(
        duplicate
      );
    }
  }
}

function renderLayers(){

  const box=
    $('wipaint-layers');

  if(!box)
    return;

  box.innerHTML=
    layers
      .map(
        (l,i)=>
          `
          <div
            class="
            wipaint-layer
            ${i===active?'active':''}
            "
            data-layer="${i}"
          >

            <button
              type="button"
              data-vis="${i}"
            >
              ${
                l.visible
                  ?'👁️'
                  :'🚫'
              }
            </button>

            <span>
              ${
                l.locked
                  ?'🔒 '
                  :''
              }

              ${escapeHtml(
                l.name
              )}
            </span>

            <button
              type="button"
              data-lock="${i}"
            >
              ${
                l.locked
                  ?'🔒'
                  :'🔓'
              }
            </button>

          </div>
          `
      )
      .join('');

  box
    .querySelectorAll(
      '[data-layer]'
    )
    .forEach(
      el=>{

        el.onclick=
          ()=>{
            active=
              Number(
                el.dataset.layer
              );

            clearSelection();

            renderLayers();
            render();
          };
      }
    );

  box
    .querySelectorAll(
      '[data-vis]'
    )
    .forEach(
      b=>{

        b.onclick=
          e=>{

            e.stopPropagation();

            toggleVisibleAt(
              Number(
                b.dataset.vis
              )
            );
          };
      }
    );

  box
    .querySelectorAll(
      '[data-lock]'
    )
    .forEach(
      b=>{

        b.onclick=
          e=>{

            e.stopPropagation();

            active=
              Number(
                b.dataset.lock
              );

            toggleLock();
          };
      }
    );
}

function loadImage(file){

  if(!file)
    return;

  const im=
    new Image();

  im.onload=
    ()=>{

      const maxW=1400;
      const maxH=1000;

      const scale=
        Math.min(
          1,
          maxW/im.width,
          maxH/im.height
        );

      canvas.width=
        Math.max(
          1,
          Math.round(
            im.width*scale
          )
        );

      canvas.height=
        Math.max(
          1,
          Math.round(
            im.height*scale
          )
        );

      ctx=
        canvas.getContext(
          '2d',
          {
            willReadFrequently:true
          }
        );

      layers=[
        makeLayer(
          'Imagem'
        )
      ];

      layers[0].c
        .getContext(
          '2d'
        )
        .drawImage(
          im,
          0,
          0,
          canvas.width,
          canvas.height
        );

      active=0;

      history=[];
      future=[];

      selectionItems=[];
      selectionBounds=null;

      renderLayers();
      render();

      saveHistory();

      URL.revokeObjectURL(
        im.src
      );
    };

  im.src=
    URL.createObjectURL(
      file
    );
}

function savePNG(){

  const out=
    document.createElement(
      'canvas'
    );

  out.width=
    canvas.width;

  out.height=
    canvas.height;

  const oc=
    out.getContext(
      '2d'
    );

  oc.fillStyle='#fff';

  oc.fillRect(
    0,
    0,
    out.width,
    out.height
  );

  for(
    const l
    of layers
  ){

    if(!l.visible)
      continue;

    oc.globalAlpha=
      l.opacity;

    oc.drawImage(
      l.c,
      l.x,
      l.y,
      l.width,
      l.height
    );
  }

  oc.globalAlpha=1;

  const a=
    document.createElement(
      'a'
    );

  a.download=
    `wipaint-${Date.now()}.png`;

  a.href=
    out.toDataURL(
      'image/png'
    );

  a.click();
}

function keyboard(e){

  const mod=
    e.ctrlKey||
    e.metaKey;

  if(
    mod&&
    e.key.toLowerCase()==='a'
  ){

    e.preventDefault();
    e.stopPropagation();

    selectAll();

    return;
  }

  if(
    mod&&
    e.key.toLowerCase()==='c'
  ){

    e.preventDefault();
    e.stopPropagation();

    copySelection();

    return;
  }

  if(
    mod&&
    e.key.toLowerCase()==='x'
  ){

    e.preventDefault();
    e.stopPropagation();

    cutSelection();

    return;
  }

  if(
    mod&&
    e.key.toLowerCase()==='v'
  ){

    e.preventDefault();
    e.stopPropagation();

    pasteSelection();

    return;
  }

  if(
    mod&&
    e.key.toLowerCase()==='z'&&
    !e.shiftKey
  ){

    e.preventDefault();
    e.stopPropagation();

    undo();

    return;
  }

  if(
    mod&&
    (
      e.key.toLowerCase()==='y'||
      (
        e.key.toLowerCase()==='z'&&
        e.shiftKey
      )
    )
  ){

    e.preventDefault();
    e.stopPropagation();

    redo();

    return;
  }

  if(
    e.key==='Delete'&&
    selectionBounds
  ){

    e.preventDefault();
    e.stopPropagation();

    eraseSelection();

    return;
  }

  if(
    e.key==='Escape'
  ){

    clearSelection();

    return;
  }

  if(
    [
      'INPUT',
      'TEXTAREA',
      'SELECT'
    ].includes(
      document.activeElement?.tagName
    )
  ){
    return;
  }

  const k=
    e.key.toLowerCase();

  if(k==='b')
    tool='brush';

  else if(k==='v')
    tool='select';

  else if(k==='e')
    tool='eraser';

  else if(k==='p')
    tool='pixel';

  else if(k==='i')
    tool='eyedropper';

  else if(k==='t')
    tool='text';

  else if(k==='l')
    tool='line';

  else if(k==='r')
    tool='rect';

  else if(k==='o')
    tool='circle';

  else
    return;

  const s=
    $('wipaint-tool');

  if(s)
    s.value=tool;
}

function bind(){

  const open=
    $('wipaint-open-btn');

  if(!open)
    return;

  open.onclick=
    ()=>{

      const overlay=
        $('modal-overlay');

      overlay
        ?.classList
        .remove(
          'hidden'
        );

      document
        .querySelectorAll(
          '.modal'
        )
        .forEach(
          m=>{
            if(
              m.id!=='modal-wipaint'
            ){
              m.classList.add(
                'hidden'
              );
            }
          }
        );

      $('modal-wipaint')
        ?.classList
        .remove(
          'hidden'
        );

      if(!canvas){

        initCanvas();

      }else{

        injectControls();
        render();
      }
    };

  $('wipaint-tool')
    ?.addEventListener(
      'change',
      e=>{
        tool=
          e.target.value;
      }
    );

  $('wipaint-size')
    ?.addEventListener(
      'input',
      e=>{

        const v=
          $('wipaint-size-value');

        if(v){

          v.textContent=
            e.target.value+
            ' px';
        }
      }
    );

  $('wipaint-zoom')
    ?.addEventListener(
      'input',
      e=>{

        zoom=
          Number(
            e.target.value
          )/100;

        canvas.style.transform=
          `scale(${zoom})`;

        canvas.style.transformOrigin=
          'top left';

        render();
      }
    );

  $('wipaint-undo')
    ?.addEventListener(
      'click',
      undo
    );

  $('wipaint-redo')
    ?.addEventListener(
      'click',
      redo
    );

  $('wipaint-grid')
    ?.addEventListener(
      'click',
      ()=>{
        grid=!grid;
        render();
      }
    );

  $('wipaint-clear')
    ?.addEventListener(
      'click',
      clearLayer
    );

  $('wipaint-add-layer')
    ?.addEventListener(
      'click',
      addLayer
    );

  $('wipaint-delete-layer')
    ?.addEventListener(
      'click',
      deleteLayer
    );

  $('wipaint-save')
    ?.addEventListener(
      'click',
      savePNG
    );

  $('wipaint-open-image')
    ?.addEventListener(
      'click',
      ()=>
        $('wipaint-file-input')
          ?.click()
    );

  $('wipaint-file-input')
    ?.addEventListener(
      'change',
      e=>
        loadImage(
          e.target.files?.[0]
        )
    );

  window.addEventListener(
    'keydown',
    keyboard,
    true
  );
}

document.addEventListener(
  'DOMContentLoaded',
  bind
);

window.WiPaint={
  open:()=>
    $('wipaint-open-btn')
      ?.click()
};

})();
