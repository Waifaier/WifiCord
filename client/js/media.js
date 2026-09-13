(function(){
'use strict';
const $=id=>document.getElementById(id);
let media=[];
let filter='all';
function toast(m,t){window.App?.toast?.(m,t);}
function formatSize(n){const u=['B','KB','MB','GB'];let i=0,v=Number(n||0);while(v>=1024&&i<u.length-1){v/=1024;i++;}return `${v.toFixed(v>=100||i===0?0:1)} ${u[i]}`;}
function typeOf(mime){if(/^image\//.test(mime))return'image';if(/^video\//.test(mime))return'video';if(/^audio\//.test(mime))return'audio';return'other';}
// Antes: `loading="lazy"` nas fotos. Em WebViews mais antigas/do app Android,
// quando as imagens são inseridas DENTRO de um modal que acabou de ficar
// visível (é exatamente o caso aqui — abre o modal e só depois busca/renderiza
// a lista), o navegador às vezes nunca recalcula que elas já estão visíveis e
// elas ficam pra sempre "esperando rolagem" — resultado: card com o fundo
// escuro do preview e nada dentro, mesmo o arquivo estando ok. Como aqui é
// uma lista pequena (no máx. 200 itens, aberta sob demanda), carregar tudo
// direto (sem "lazy") não pesa e resolve isso de vez.
// Vídeo: só com preload="metadata" o navegador nunca desenha nenhum quadro
// (fica preto até a pessoa dar play, e ainda por cima sem ícone de play
// nenhum — parecia arquivo quebrado). Agora usa preload="auto" e, assim que
// os primeiros dados chegam, força a exibição de um quadro (ver
// forceVideoFrame) — e sempre desenha um ícone de play por cima, pra deixar
// claro que é um vídeo mesmo quando o navegador não conseguir gerar o quadro
// (ex.: modo de economia de dados do celular bloqueando o preload).
function preview(m){
  const t=typeOf(m.mime);
  if(t==='image')return `<div class="media-preview"><img src="${m.url}" alt="" loading="eager" decoding="async" onload="window.WCMedia.onPreviewLoaded(this)" onerror="window.WCMedia.onPreviewError(this)"></div>`;
  if(t==='video')return `<div class="media-preview"><video src="${m.url}" muted playsinline preload="auto" onloadeddata="window.WCMedia.onVideoFrame(this)" onerror="window.WCMedia.onPreviewError(this)"></video><div class="media-preview-play" aria-hidden="true"></div></div>`;
  if(t==='audio')return `<div class="media-preview"><div class="file-icon">🎵</div></div>`;
  return `<div class="media-preview"><div class="file-icon">📎</div></div>`;
}
// Se o arquivo realmente sumiu/corrompeu no servidor, troca o preview quebrado
// por um aviso claro em vez de deixar o quadro escuro vazio (mesma ideia do
// window.__mediaLoadError do chat, ver client/js/app.js).
function onPreviewError(el){
  try{
    const box=el.closest('.media-preview');
    if(!box||box.dataset.errorHandled)return;
    box.dataset.errorHandled='1';
    box.innerHTML='<div class="file-icon">⚠️</div><small class="media-preview-error-label">Prévia indisponível</small>';
  }catch(_){}
}
function onPreviewLoaded(el){ el.closest('.media-preview')?.classList.add('loaded'); }
// Trava de segurança: alguns Android WebView ignoram preload="auto" (modo
// economia de dados) e o vídeo nunca chega a decodificar um quadro sozinho.
// Ao chegar o primeiro dado de vídeo, pedimos um avanço mínimo de tempo —
// isso força o navegador a desenhar aquele quadro na tela sem precisar dar
// play. Só faz isso uma vez por vídeo.
function onVideoFrame(video){
  try{
    if(video.dataset.framed)return;
    video.dataset.framed='1';
    video.closest('.media-preview')?.classList.add('loaded');
    if(video.readyState>=2&&video.currentTime===0){
      const t=Math.min(0.2,(video.duration||1)/4||0.1);
      video.currentTime=t||0.1;
    }
  }catch(_){}
}
function render(){const grid=$('media-library-grid');if(!grid)return;const list=media.filter(m=>filter==='all'||typeOf(m.mime)===filter);if(!list.length){grid.innerHTML='<div class="empty-state">Nenhuma mídia encontrada.</div>';return;}grid.innerHTML=list.map(m=>`<article class="media-card">${preview(m)}<div class="media-info"><strong title="${m.name}">${m.name}</strong><small>${formatSize(m.size)} · ${m.mime}</small></div><div class="media-actions"><button class="btn btn-small" data-use="${m.id}">Enviar</button><a class="btn btn-small" href="${m.url}" target="_blank" rel="noopener">Abrir</a></div></article>`).join('');grid.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>{const m=media.find(x=>String(x.id)===String(b.dataset.use));if(m)sendMedia(m);});}
async function load(){try{const r=await fetch('/api/media/library',{credentials:'same-origin'}),d=await r.json();if(!r.ok)throw Error(d.error||'Falha ao carregar mídia.');media=d.media||[];render();}catch(e){toast(e.message,'error');}}
// Trava de segurança: nunca manda uma mensagem __MEDIA__ sem link. Sem isso,
// se por qualquer motivo "m" chegasse aqui com url vazia, a mensagem ia pro
// chat mesmo assim e todo mundo via um player quebrado sem nenhuma pista do
// que aconteceu (pior ainda no app desktop — ver comentário grande em
// client/js/app.js/formatMessageContent).
function sendMedia(m){if(!m?.url)return toast('Esse arquivo não tem um link válido — tente enviar de novo.','error');const st=window.App?.getState?.();if(!st?.activeDMUserId&&!st?.activeChannelId)return toast('Abra uma conversa ou canal primeiro.','error');const content='__MEDIA__:'+JSON.stringify({id:m.id,url:m.url,name:m.name,mime:m.mime,size:m.size});const cb=r=>{if(r?.error)toast(r.error,'error');else{window.App?.handleIncomingMessage?.(r.message,st.activeChannelId?'channel':'dm');toast('Mídia enviada.','success');}};if(st.activeChannelId)window.ChatSocket.sendChannelMessage(st.activeChannelId,content,cb);else window.ChatSocket.sendDMMessage(st.activeDMUserId,content,cb);}
function guessMimeFromName(name){const ext=String(name||'').toLowerCase().split('.').pop();const map={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',pdf:'application/pdf',zip:'application/zip',json:'application/json',txt:'text/plain'};return map[ext]||'';}
// Antes: só usava a extensão quando file.type vinha vazio. Só que no Android
// (WebView do app, imagens vindas da galeria/WhatsApp) o navegador às vezes
// manda file.type = "application/octet-stream" — isso TEM barra, então
// passava no teste antigo e a extensão nunca era consultada, mandando a
// imagem como tipo genérico e quebrando a prévia no chat. Agora a extensão
// manda sempre que reconhecida (é mais confiável pra tipos comuns); só cai
// pro file.type do navegador quando a extensão é desconhecida.
function detectMime(file){const guessed=guessMimeFromName(file.name);if(guessed)return guessed;if(file.type&&file.type.indexOf('/')>-1&&file.type!=='application/octet-stream')return file.type;return file.type||'application/octet-stream';}
function upload(file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/media/upload');xhr.withCredentials=true;const mime=detectMime(file);xhr.setRequestHeader('Content-Type',mime);xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));const bar=$('media-upload-progress'),span=bar?.querySelector('span');bar?.classList.remove('hidden');xhr.upload.onprogress=e=>{if(e.lengthComputable&&span)span.style.width=(e.loaded/e.total*100)+'%';};xhr.onload=()=>{bar?.classList.add('hidden');try{const d=JSON.parse(xhr.responseText||'{}');if(xhr.status>=200&&xhr.status<300)resolve(d.media);else reject(Error(d.error||'Upload falhou.'));}catch(e){reject(Error('Resposta inválida do servidor.'));}};xhr.onerror=()=>{bar?.classList.add('hidden');reject(Error('Falha de conexão durante o upload.'));};xhr.send(file);});}
async function uploadFiles(files){for(const file of files){if(file.size>50*1024*1024){toast(`${file.name} excede 50 MB.`,'error');continue;}try{const m=await upload(file);media.unshift(m);render();sendMedia(m);}catch(e){toast(`${file.name}: ${e.message}`,'error');}}}
function open(){document.getElementById('modal-overlay')?.classList.remove('hidden');$('modal-media')?.classList.remove('hidden');document.querySelectorAll('.modal').forEach(m=>{if(m.id!=='modal-media')m.classList.add('hidden');});load();}
function bind(){ $('media-btn')?.addEventListener('click',open);$('media-upload-btn')?.addEventListener('click',()=>$('media-file-input')?.click());$('media-file-input')?.addEventListener('change',e=>{uploadFiles(e.target.files);e.target.value='';});document.querySelectorAll('[data-media-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.mediaFilter;document.querySelectorAll('[data-media-filter]').forEach(x=>x.classList.toggle('active',x===b));render();}));}
document.addEventListener('DOMContentLoaded',bind);window.WCMedia={open,load,uploadFiles,uploadForWallpaper:upload,onPreviewError,onPreviewLoaded,onVideoFrame};
})();
