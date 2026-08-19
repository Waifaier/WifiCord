(function(){
'use strict';
const $=id=>document.getElementById(id);
let canvas,ctx,running=false,sessionId=null,score=0,best=Number(localStorage.getItem('wc-flappy-best')||0),raf=0,last=0,bird={x:150,y:210,vy:0,size:22},pipes=[];
const W=760,H=430,GRAVITY=1250,FLAP=-420,SPEED=210,GAP=145;
function open(){document.getElementById('modal-overlay')?.classList.remove('hidden');document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));$('modal-games')?.classList.remove('hidden');refreshStatus();}
async function api(url,opt={}){opt=Object.assign({},opt,{credentials:'same-origin'});opt.headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Erro no minigame.');return d;}
async function refreshStatus(){try{const d=await api('/api/games/status');updateHud();const c=$('game-cooldown');if(!c)return;if(d.available){c.textContent='Disponível';c.classList.remove('locked');$('flappy-start').disabled=false;}else{c.textContent='Indisponível';c.classList.add('locked');$('flappy-start').disabled=true;}}catch(e){$('game-cooldown').textContent='Indisponível';}}
function updateHud(){$('game-score').textContent=score;$('game-best').textContent=best;}
function reset(){score=0;bird={x:150,y:H/2,vy:0,size:22};pipes=[];for(let i=0;i<4;i++)addPipe(W+260*i);updateHud();}
function addPipe(x){const top=70+Math.random()*(H-GAP-150);pipes.push({x,top,passed:false});}
function draw(){ctx.clearRect(0,0,W,H);const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#191535');g.addColorStop(1,'#0b0913');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#262047';for(let i=0;i<20;i++){ctx.fillRect((i*83-(score*3)%83),40+(i%5)*60,3,3);}
  pipes.forEach(p=>{ctx.fillStyle='#7c5cff';ctx.fillRect(p.x,0,58,p.top);ctx.fillRect(p.x,p.top+GAP,58,H-(p.top+GAP));ctx.fillStyle='#a48cff';ctx.fillRect(p.x-5,p.top-10,68,10);ctx.fillRect(p.x-5,p.top+GAP,68,10);});
  ctx.fillStyle='#ffcf33';ctx.fillRect(bird.x,bird.y,bird.size,bird.size);ctx.fillStyle='#fff';ctx.fillRect(bird.x+14,bird.y+5,5,5);ctx.fillStyle='#15121e';ctx.fillRect(bird.x+16,bird.y+6,2,2);ctx.fillStyle='#ff7b32';ctx.fillRect(bird.x+bird.size,bird.y+8,9,7);
}
function flap(){if(!running)return;bird.vy=FLAP;}
function collision(){if(bird.y<0||bird.y+bird.size>H)return true;return pipes.some(p=>bird.x+bird.size>p.x&&bird.x<p.x+58&&(bird.y<p.top||bird.y+bird.size>p.top+GAP));}
function loop(t){if(!running)return;const dt=Math.min(.032,(t-last)/1000||.016);last=t;bird.vy+=GRAVITY*dt;bird.y+=bird.vy*dt;pipes.forEach(p=>p.x-=SPEED*dt);if(pipes.length&&pipes[0].x+58<0){pipes.shift();addPipe(pipes[pipes.length-1].x+260);}
pipes.forEach(p=>{if(!p.passed&&p.x+58<bird.x){p.passed=true;score++;best=Math.max(best,score);localStorage.setItem('wc-flappy-best',best);updateHud();}});draw();if(collision())return gameOver();raf=requestAnimationFrame(loop);}
async function start(){if(running)return;try{const d=await api('/api/games/flappy-cubes/start',{method:'POST'});sessionId=d.sessionId;reset();running=true;$('flappy-overlay').classList.add('hidden');last=performance.now();raf=requestAnimationFrame(loop);}catch(e){window.App?.toast(e.message,'error');refreshStatus();}}
async function gameOver(){running=false;cancelAnimationFrame(raf);draw();$('flappy-overlay').classList.remove('hidden');$('flappy-overlay').querySelector('strong').textContent='Game Over';$('flappy-overlay').querySelector('span').textContent='Pontuação: '+score+' · Você pode jogar novamente agora.';$('flappy-start').disabled=false;try{const d=await api('/api/games/flappy-cubes/finish',{method:'POST',body:JSON.stringify({sessionId,score})});window.App?.handleProfileUpdate?.({user:d.user});window.App?.toast(`+${d.reward} pontos!`,'success');}catch(e){window.App?.toast(e.message,'error');}finally{sessionId=null;refreshStatus();}}
function bind(){canvas=$('flappy-canvas');if(!canvas)return;ctx=canvas.getContext('2d');canvas.addEventListener('pointerdown',flap);window.addEventListener('keydown',e=>{if(e.code==='Space'&&$('modal-games')&&!$('modal-games').classList.contains('hidden')){e.preventDefault();if(!running)start();else flap();}});$('flappy-start')?.addEventListener('click',start);$('games-btn')?.addEventListener('click',open);$('modal-games')?.addEventListener('click',e=>{if(e.target.matches('[data-close-modal]')){document.getElementById('modal-overlay')?.classList.add('hidden');$('modal-games')?.classList.add('hidden');}});updateHud();draw();}
document.addEventListener('DOMContentLoaded',bind);window.WCGames={open,refreshStatus};
})();
