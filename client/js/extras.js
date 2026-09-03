(function(){
'use strict';
const emojis=['😀','😂','🥹','😍','😎','😭','🔥','❤️','👍','👎','🎉','✨','💀','🤝','👀','🚀','🫡','😈','🤡','🥶','💜','⚡','🌈','🪩','🧊','🦄','🍕','🐱','🐶','🥳'];
const supers=[['🌈','Arco-íris'],['⚡','Raios'],['🚀','Foguete'],['💥','Explosão'],['🔥','Fogo'],['❄️','Nevasca'],['🎉','Confetes'],['💜','Corações'],['🌀','Vórtice'],['🎆','Fogos'],['🪩','Festa'],['💀','Skull'],['😎','Modo cool']];
const stickers=[['✨','Brilho'],['🔥','Fogo'],['💜','Coração'],['⚡','Raio'],['🎉','Festa'],['😈','Diabinho'],['🚀','Foguete'],['🌈','Arco-íris'],['🐱','Gatinho'],['🐶','Cachorro'],['🍕','Pizza'],['🦄','Unicórnio']];
function stickerData(emoji,name){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><filter id="s"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-opacity=".35"/></filter></defs><g filter="url(#s)"><text x="256" y="330" text-anchor="middle" font-size="260" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text></g><text x="256" y="465" text-anchor="middle" fill="white" stroke="#111" stroke-width="6" paint-order="stroke" font-size="28" font-family="Arial,sans-serif" font-weight="800">${name}</text></svg>`;return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}
const input=document.getElementById('message-input');
function pop(id,items,handler){const p=document.getElementById(id);if(!p)return;p.innerHTML='';items.forEach(x=>{const b=document.createElement('button');b.type='button';b.className='emoji-item';b.innerHTML=x.label||x;b.title=x.title||'';b.onclick=()=>handler(x.value||x);p.appendChild(b)})}
pop('emoji-popover',emojis.concat(supers.map(([x,n])=>({value:'__SUPER__:'+x,label:x,title:'Super emoji: '+n}))),v=>{input.setRangeText(v,input.selectionStart,input.selectionEnd,'end');input.focus();document.getElementById('emoji-popover')?.classList.add('hidden')});
pop('sticker-popover',stickers.map(([v,n])=>({value:'__STICKER__:'+stickerData(v,n),label:v,title:n})),v=>{input.value=v;document.getElementById('sticker-popover')?.classList.add('hidden');input.form?.requestSubmit()});
document.getElementById('emoji-btn')?.addEventListener('click',()=>document.getElementById('emoji-popover')?.classList.toggle('hidden'));
document.getElementById('sticker-btn')?.addEventListener('click',()=>document.getElementById('sticker-popover')?.classList.toggle('hidden'));
let avatar=null,banner=null;const read=f=>new Promise((ok,no)=>{if(!f)return ok(null);const r=new FileReader;r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(f)});
document.getElementById('settings-avatar-input')?.addEventListener('change',async e=>{avatar=await read(e.target.files[0]);const im=document.getElementById('settings-avatar-preview');if(im&&avatar)im.src=avatar});
document.getElementById('settings-banner-input')?.addEventListener('change',async e=>{banner=await read(e.target.files[0]);const b=document.getElementById('settings-profile-banner');if(b&&banner)b.style.backgroundImage=`url("${banner}")`});
document.getElementById('settings-avatar-edit-btn')?.addEventListener('click',()=>document.getElementById('settings-avatar-input')?.click());
document.getElementById('settings-banner-edit-btn')?.addEventListener('click',()=>document.getElementById('settings-banner-input')?.click());
document.getElementById('settings-avatar-preview')?.addEventListener('click',()=>document.getElementById('settings-avatar-input')?.click());
async function saveSettings(patch,msg='Configurações salvas.') {try{const r=await fetch('/api/auth/settings',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}),d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível salvar.');window.App?.handleProfileUpdate({user:d.user});window.App?.toast(msg,'success')}catch(e){window.App?.toast(e.message,'error')}}
document.getElementById('settings-save-profile')?.addEventListener('click',async()=>{try{const res=await fetch('/api/auth/profile',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:document.getElementById('settings-display-name').value,bio:document.getElementById('settings-bio').value,avatarUrl:avatar===null?undefined:avatar,bannerUrl:banner===null?undefined:banner})});const d=await res.json();if(!res.ok)throw Error(d.error);window.App?.handleProfileUpdate({user:d.user});avatar=null;banner=null;await saveSettings({profileColor:document.getElementById('settings-profile-color')?.value||'#7c5cff',profileLayout:document.getElementById('settings-profile-layout')?.value||'classic',profileGlow:document.getElementById('settings-profile-glow')?.value||'none',profileBadge:document.getElementById('settings-profile-badge')?.value||'none',animatedProfile:document.getElementById('settings-animated-profile')?.checked!==false},'Perfil salvo e sincronizado.');}catch(e){window.App?.toast(e.message,'error')}});
document.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-status]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}));
document.getElementById('settings-save-status')?.addEventListener('click',()=>{const status=document.querySelector('[data-status].selected')?.dataset.status||'online';saveSettings({});fetch('/api/auth/status',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,text:document.getElementById('settings-status-text').value,emoji:document.getElementById('settings-status-emoji').value})}).then(r=>r.json()).then(d=>{if(d.user)window.App?.handleProfileUpdate({user:d.user});window.App?.toast('Status atualizado.','success')})});
document.getElementById('settings-accent')?.addEventListener('input',e=>document.documentElement.style.setProperty('--accent',e.target.value));
document.getElementById('settings-compact')?.addEventListener('change',e=>document.body.classList.toggle('compact',e.target.checked));
document.getElementById('settings-reduce-motion')?.addEventListener('change',e=>document.body.classList.toggle('reduce-motion',e.target.checked));
document.getElementById('settings-save-appearance')?.addEventListener('click',()=>saveSettings({accent:document.getElementById('settings-accent').value,compact:document.getElementById('settings-compact').checked,reduceMotion:document.getElementById('settings-reduce-motion').checked}));
document.getElementById('settings-save-advanced')?.addEventListener('click',()=>saveSettings({chatDensity:document.getElementById('settings-chat-density').value,fontSize:document.getElementById('settings-font-size').value,showTimestamps:document.getElementById('settings-show-timestamps').checked,showMemberList:document.getElementById('settings-show-member-list').checked,showEmbeds:document.getElementById('settings-show-embeds').checked,stickerAnimations:document.getElementById('settings-sticker-animations').checked,autoplayMedia:document.getElementById('settings-autoplay-media').checked,overlayEffects:document.getElementById('settings-overlay-effects').checked,superEmojiEffects:document.getElementById('settings-super-effects').checked,localNicknames:document.getElementById('settings-local-nicknames').checked,language:document.getElementById('settings-language').value,mediaQuality:document.getElementById('settings-media-quality')?.value||'auto',animatedProfile:document.getElementById('settings-animated-profile')?.checked!==false,inlineMedia:document.getElementById('settings-inline-media')?.checked!==false,autoDownload:document.getElementById('settings-auto-download')?.checked===true}));
document.getElementById('settings-save-accessibility')?.addEventListener('click',()=>saveSettings({reduceMotion:document.getElementById('settings-reduce-motion-2').checked,outputVolume:Number(document.getElementById('settings-output-volume').value),inputVolume:Number(document.getElementById('settings-input-volume').value),voiceInputSensitivity:Number(document.getElementById('settings-voice-sensitivity').value)}));
document.getElementById('settings-test-sound')?.addEventListener('click',()=>window.Sounds?.play('message'));

document.getElementById('settings-save-profile-effects')?.addEventListener('click',()=>{const me=window.App?.getState?.()?.currentUser;if(!me?.wfna)return window.App?.toast('Os efeitos animados do perfil são exclusivos do WFNA.','error');saveSettings({profileEffect:document.getElementById('settings-profile-effect')?.value||'none',profileEffectSpeed:document.getElementById('settings-profile-effect-speed')?.value||'normal',profileEffectEnabled:document.getElementById('settings-profile-effect-enabled')?.checked===true},'Efeitos do perfil salvos.');});

// ---------------------------------------------------------------------
// Autocomplete de @menção no composer
// ---------------------------------------------------------------------
(function(){
  if(!input) return;
  const escM=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let box=null, active=false, tokenStart=-1, tokenEnd=-1, items=[], index=0;

  function ensureBox(){
    if(box) return box;
    box=document.createElement('div');
    box.id='mention-autocomplete';
    box.className='mention-autocomplete hidden';
    (input.closest('form')||input.parentElement)?.appendChild(box);
    return box;
  }

  function candidates(){
    const st=window.App?.getState?.(); if(!st) return [];
    return st.activeDMUserId ? (st.friends||[]) : (st.serverMembers||[]);
  }

  function findToken(value,cursor){
    const upto=value.slice(0,cursor);
    const m=upto.match(/(^|[\s])@([a-zA-Z0-9_]{0,32})$/);
    if(!m) return null;
    return { start: cursor-m[2].length-1, query: m[2] };
  }

  function filterCandidates(query){
    const q=query.toLowerCase(), seen=new Set();
    return candidates().filter(u=>{
      if(!u||!u.username) return false;
      const key=String(u.id);
      if(seen.has(key)) return false;
      seen.add(key);
      if(!q) return true;
      return u.username.toLowerCase().includes(q) || String(u.displayName||'').toLowerCase().includes(q);
    }).slice(0,8);
  }

  function close(){
    active=false; tokenStart=-1; tokenEnd=-1; items=[];
    box?.classList.add('hidden');
  }

  function highlight(){
    if(!box) return;
    Array.from(box.children).forEach((el,i)=>el.classList.toggle('active',i===index));
    box.children[index]?.scrollIntoView({block:'nearest'});
  }

  function render(list){
    const b=ensureBox();
    if(!list.length){ close(); return; }
    items=list; index=0;
    b.innerHTML=list.map((u,i)=>{
      const label=u.displayName||u.username;
      const av=u.avatarUrl?`<img src="${escM(u.avatarUrl)}" alt="">`:`<div class="avatar-fallback">${escM(label.trim().charAt(0).toUpperCase())}</div>`;
      return `<div class="mention-autocomplete-item${i===0?' active':''}" data-index="${i}">${av}<span class="mention-name">${escM(label)}</span><span class="mention-username">@${escM(u.username)}</span></div>`;
    }).join('');
    Array.from(b.querySelectorAll('.mention-autocomplete-item')).forEach(el=>{
      el.addEventListener('mousedown',ev=>{ ev.preventDefault(); select(Number(el.dataset.index)); });
    });
    b.classList.remove('hidden');
    active=true;
  }

  function select(i){
    const u=items[i]; if(!u) return;
    const before=input.value.slice(0,tokenStart);
    const after=input.value.slice(tokenEnd);
    const insertion='@'+u.username+' ';
    input.value=before+insertion+after;
    const pos=(before+insertion).length;
    input.setSelectionRange(pos,pos);
    input.focus();
    close();
    input.dispatchEvent(new Event('input'));
  }

  function onInput(){
    const cursor=input.selectionStart;
    const token=findToken(input.value,cursor);
    if(!token){ close(); return; }
    tokenStart=token.start; tokenEnd=cursor;
    const list=filterCandidates(token.query);
    if(!list.length){ close(); return; }
    render(list);
  }

  input.addEventListener('input',onInput);
  input.addEventListener('keydown',function(e){
    if(!active) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); e.stopImmediatePropagation(); index=(index+1)%items.length; highlight(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); e.stopImmediatePropagation(); index=(index-1+items.length)%items.length; highlight(); }
    else if(e.key==='Enter'){ e.preventDefault(); e.stopImmediatePropagation(); select(index); }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); }
  });
  input.addEventListener('blur',()=>setTimeout(close,120));
})();
})();

