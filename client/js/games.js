(function(){
'use strict';
const $=id=>document.getElementById(id);
let canvas,ctx,running=false,sessionId=null,score=0,best=Number(localStorage.getItem('wc-flappy-best')||0),raf=0,last=0,elapsed=0;
let bird={x:150,y:210,vy:0,size:24,rot:0,wing:0};
let pipes=[],particles=[],stars=[],nebulae=[];
const W=760,H=430,GRAVITY=1250,FLAP=-420,SPEED=210,GAP=150;

// --- roundRect com fallback (navegadores mais antigos do webview não
// implementam CanvasRenderingContext2D.roundRect nativamente). ---
function roundRect(c,x,y,w,h,r){
  if(typeof c.roundRect==='function'){c.beginPath();c.roundRect(x,y,w,h,r);return;}
  const rr=Math.min(r,Math.abs(w)/2,Math.abs(h)/2);
  c.beginPath();
  c.moveTo(x+rr,y);
  c.arcTo(x+w,y,x+w,y+h,rr);
  c.arcTo(x+w,y+h,x,y+h,rr);
  c.arcTo(x,y+h,x,y,rr);
  c.arcTo(x,y,x+w,y,rr);
  c.closePath();
}

// --- Paleta de "cenário" que muda aos poucos com o tempo de jogo, em vez
// de um fundo estático — o jogo vai deslizando de um entardecer violeta
// pra uma noite mais funda, depois um tom ciano frio, e volta, num ciclo
// lento (~45s por volta completa). ---
const PALETTE=[
  {sky1:'#241a45',sky2:'#0b0913',glow:'#7c5cff'},
  {sky1:'#160f30',sky2:'#050308',glow:'#22d3ee'},
  {sky1:'#2a1030',sky2:'#0c0511',glow:'#ff6bd6'},
  {sky1:'#0f1f3a',sky2:'#04070f',glow:'#22d3ee'},
];
function paletteAt(t){
  const cycle=45; // segundos por volta completa
  const pos=((t%cycle)/cycle)*PALETTE.length;
  const i=Math.floor(pos)%PALETTE.length;
  const j=(i+1)%PALETTE.length;
  const f=pos-Math.floor(pos);
  function mix(a,b){
    const pa=hexToRgb(a),pb=hexToRgb(b);
    return `rgb(${Math.round(pa[0]+(pb[0]-pa[0])*f)},${Math.round(pa[1]+(pb[1]-pa[1])*f)},${Math.round(pa[2]+(pb[2]-pa[2])*f)})`;
  }
  return { sky1:mix(PALETTE[i].sky1,PALETTE[j].sky1), sky2:mix(PALETTE[i].sky2,PALETTE[j].sky2), glow:mix(PALETTE[i].glow,PALETTE[j].glow) };
}
function hexToRgb(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}

function open(){document.getElementById('modal-overlay')?.classList.remove('hidden');document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));$('modal-games')?.classList.remove('hidden');refreshStatus();}
async function api(url,opt={}){opt=Object.assign({},opt,{credentials:'same-origin'});opt.headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Erro no minigame.');return d;}
async function refreshStatus(){try{const d=await api('/api/games/status');updateHud();const c=$('game-cooldown');if(!c)return;if(d.available){c.textContent='Disponível';c.classList.remove('locked');$('flappy-start').disabled=false;}else{c.textContent='Indisponível';c.classList.add('locked');$('flappy-start').disabled=true;}}catch(e){$('game-cooldown').textContent='Indisponível';}}
function updateHud(){$('game-score').textContent=score;$('game-best').textContent=best;}

function initScenery(){
  stars=[];nebulae=[];
  for(let i=0;i<46;i++) stars.push({x:Math.random()*W,y:Math.random()*H*0.85,r:Math.random()*1.6+.4,layer:Math.random()<.5?1:2,tw:Math.random()*Math.PI*2});
  for(let i=0;i<4;i++) nebulae.push({x:Math.random()*W,y:Math.random()*H*.6+20,r:90+Math.random()*70,drift:Math.random()*8-4});
}

function reset(){score=0;elapsed=0;bird={x:150,y:H/2,vy:0,size:24,rot:0,wing:0};pipes=[];particles=[];for(let i=0;i<4;i++)addPipe(W+260*i);initScenery();updateHud();}
function addPipe(x){const top=70+Math.random()*(H-GAP-150);pipes.push({x,top,passed:false});}

function spawnTrail(){
  particles.push({x:bird.x+2,y:bird.y+bird.size/2,vx:-40-Math.random()*40,vy:(Math.random()-.5)*30,life:0.5,age:0,size:3+Math.random()*2});
}
function spawnBurst(x,y,color,n){
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2,sp=60+Math.random()*90;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.6,age:0,size:2+Math.random()*2,color});
  }
}

function draw(dt){
  const pal=paletteAt(elapsed);
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,pal.sky1);g.addColorStop(1,pal.sky2);
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // Nebulosas suaves ao fundo, deriva lenta e independente do scroll do jogo.
  nebulae.forEach(n=>{
    n.x-=n.drift*(dt||0);
    if(n.x<-n.r)n.x=W+n.r; if(n.x>W+n.r)n.x=-n.r;
    const ng=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r);
    ng.addColorStop(0,pal.glow+'22');ng.addColorStop(1,pal.glow+'00');
    ctx.fillStyle=ng;ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();
  });

  // Duas camadas de estrelas em paralaxe (a mais distante mexe mais devagar).
  stars.forEach(s=>{
    s.x-=(s.layer===1?14:30)*(dt||0);
    if(s.x<-2)s.x=W+2;
    s.tw+=(dt||0)*3;
    const alpha=.35+Math.abs(Math.sin(s.tw))*.5;
    ctx.fillStyle=`rgba(255,255,255,${(s.layer===1?.4:.8)*alpha})`;
    ctx.fillRect(s.x,s.y,s.r,s.r);
  });

  // Canos com gradiente + brilho nas bordas, no lugar dos retângulos lisos.
  pipes.forEach(p=>{
    const pg=ctx.createLinearGradient(p.x,0,p.x+58,0);
    pg.addColorStop(0,'#5a3fd9');pg.addColorStop(.5,'#8f6bff');pg.addColorStop(1,'#5a3fd9');
    ctx.fillStyle=pg;
    roundRect(ctx,p.x,-10,58,p.top+10,10);ctx.fill();
    roundRect(ctx,p.x,p.top+GAP,58,H-(p.top+GAP)+10,10);ctx.fill();
    ctx.save();
    ctx.shadowColor=pal.glow;ctx.shadowBlur=14;
    ctx.fillStyle='#c9b8ff';
    roundRect(ctx,p.x-6,p.top-14,70,16,8);ctx.fill();
    roundRect(ctx,p.x-6,p.top+GAP-2,70,16,8);ctx.fill();
    ctx.restore();
  });

  // Rastro de partículas atrás do pássaro.
  particles.forEach(pt=>{
    const t=pt.age/pt.life;
    ctx.globalAlpha=Math.max(0,1-t);
    ctx.fillStyle=pt.color||'#ffd166';
    ctx.beginPath();ctx.arc(pt.x,pt.y,pt.size*(1-t*.6),0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;

  // Pássaro: corpo com gradiente radial, rotação conforme a velocidade,
  // asa animada, bico e olho — no lugar do quadrado liso de antes.
  ctx.save();
  ctx.translate(bird.x+bird.size/2,bird.y+bird.size/2);
  ctx.rotate(bird.rot);
  ctx.shadowColor='#ffcf33';ctx.shadowBlur=16;
  const bg=ctx.createRadialGradient(-4,-4,2,0,0,bird.size/1.4);
  bg.addColorStop(0,'#fff3b0');bg.addColorStop(.55,'#ffcf33');bg.addColorStop(1,'#ff9d2e');
  ctx.fillStyle=bg;
  ctx.beginPath();ctx.ellipse(0,0,bird.size/1.8,bird.size/2.1,0,0,Math.PI*2);ctx.fill();
  ctx.shadowBlur=0;
  // asa
  ctx.save();
  ctx.rotate(Math.sin(bird.wing)*.6-.2);
  ctx.fillStyle='#ff9d2e';
  ctx.beginPath();ctx.ellipse(-3,3,bird.size/2.6,bird.size/4.2,0,0,Math.PI*2);ctx.fill();
  ctx.restore();
  // bico
  ctx.fillStyle='#ff7b32';
  ctx.beginPath();ctx.moveTo(bird.size/2.2,-2);ctx.lineTo(bird.size/2.2+10,2);ctx.lineTo(bird.size/2.2,7);ctx.closePath();ctx.fill();
  // olho
  ctx.fillStyle='#1a1424';ctx.beginPath();ctx.arc(6,-6,3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(7,-7,1,0,Math.PI*2);ctx.fill();
  ctx.restore();

  // HUD do placar desenhado no canvas, com leve brilho.
  ctx.save();
  ctx.font='700 26px Space Grotesk, Poppins, sans-serif';
  ctx.textAlign='center';
  ctx.shadowColor=pal.glow;ctx.shadowBlur=10;
  ctx.fillStyle='#fff';
  ctx.fillText(String(score),W/2,46);
  ctx.restore();
}

function flap(){if(!running)return;bird.vy=FLAP;window.Sounds?.play?.('game-flap');spawnBurst(bird.x+4,bird.y+bird.size/2,'#fff3b0',5);}
function collision(){if(bird.y<0||bird.y+bird.size>H)return true;return pipes.some(p=>bird.x+bird.size>p.x&&bird.x<p.x+58&&(bird.y<p.top||bird.y+bird.size>p.top+GAP));}

function loop(t){
  if(!running)return;
  const dt=Math.min(.032,(t-last)/1000||.016);last=t;elapsed+=dt;
  bird.vy+=GRAVITY*dt;bird.y+=bird.vy*dt;
  bird.rot=Math.max(-.5,Math.min(1.1,bird.vy/500));
  bird.wing+=dt*18;
  if(Math.random()<.6) spawnTrail();
  pipes.forEach(p=>p.x-=SPEED*dt);
  if(pipes.length&&pipes[0].x+58<0){pipes.shift();addPipe(pipes[pipes.length-1].x+260);}
  pipes.forEach(p=>{if(!p.passed&&p.x+58<bird.x){p.passed=true;score++;best=Math.max(best,score);localStorage.setItem('wc-flappy-best',best);updateHud();window.Sounds?.play?.('game-score');}});
  particles.forEach(pt=>{pt.age+=dt;pt.x+=pt.vx*dt;pt.y+=pt.vy*dt;});
  particles=particles.filter(pt=>pt.age<pt.life);
  draw(dt);
  if(collision())return gameOver();
  raf=requestAnimationFrame(loop);
}

async function start(){
  if(running)return;
  try{
    const d=await api('/api/games/flappy-cubes/start',{method:'POST'});
    sessionId=d.sessionId;reset();running=true;$('flappy-overlay').classList.add('hidden');last=performance.now();
    window.Sounds?.startLoop?.('game-music');
    raf=requestAnimationFrame(loop);
  }catch(e){window.App?.toast(e.message,'error');refreshStatus();}
}
async function gameOver(){
  running=false;cancelAnimationFrame(raf);
  window.Sounds?.stopLoop?.();
  window.Sounds?.play?.('game-over');
  spawnBurst(bird.x+bird.size/2,bird.y+bird.size/2,'#ff6b6b',18);
  draw(0);
  $('flappy-overlay').classList.remove('hidden');
  $('flappy-overlay').querySelector('strong').textContent='Game Over';
  $('flappy-overlay').querySelector('span').textContent='Pontuação: '+score+' · Você pode jogar novamente agora.';
  $('flappy-start').disabled=false;
  try{
    const d=await api('/api/games/flappy-cubes/finish',{method:'POST',body:JSON.stringify({sessionId,score})});
    window.App?.handleProfileUpdate?.({user:d.user});
    window.App?.toast(`+${d.reward} pontos!`,'success');
  }catch(e){window.App?.toast(e.message,'error');}
  finally{sessionId=null;refreshStatus();}
}

function bind(){
  canvas=$('flappy-canvas');if(!canvas)return;ctx=canvas.getContext('2d');
  initScenery();draw(0);
  canvas.addEventListener('pointerdown',flap);
  window.addEventListener('keydown',e=>{if(e.code==='Space'&&$('modal-games')&&!$('modal-games').classList.contains('hidden')){e.preventDefault();if(!running)start();else flap();}});
  $('flappy-start')?.addEventListener('click',start);
  $('games-btn')?.addEventListener('click',open);
  $('modal-games')?.addEventListener('click',e=>{if(e.target.matches('[data-close-modal]')){document.getElementById('modal-overlay')?.classList.add('hidden');$('modal-games')?.classList.add('hidden');running=false;cancelAnimationFrame(raf);window.Sounds?.stopLoop?.();}});
  updateHud();
}
document.addEventListener('DOMContentLoaded',bind);
window.WCGames={open,refreshStatus};
})();
