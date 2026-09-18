(function(){
'use strict';
const emojis=['😀','😂','🥹','😍','😎','😭','🔥','❤️','👍','👎','🎉','✨','💀','🤝','👀','🚀','🫡','😈','🤡','🥶','💜','⚡','🌈','🪩','🧊','🦄','🍕','🐱','🐶','🥳'];
const supers=[['🌈','Arco-íris'],['⚡','Raios'],['🚀','Foguete'],['💥','Explosão'],['🔥','Fogo'],['❄️','Nevasca'],['🎉','Confetes'],['💜','Corações'],['🌀','Vórtice'],['🎆','Fogos'],['🪩','Festa'],['💀','Skull'],['😎','Modo cool']];
const stickers=[['✨','Brilho'],['🔥','Fogo'],['💜','Coração'],['⚡','Raio'],['🎉','Festa'],['😈','Diabinho'],['🚀','Foguete'],['🌈','Arco-íris'],['🐱','Gatinho'],['🐶','Cachorro'],['🍕','Pizza'],['🦄','Unicórnio']];
function stickerData(emoji,name){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><text x="256" y="330" text-anchor="middle" font-size="260" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text><text x="256" y="465" text-anchor="middle" fill="white" stroke="#111" stroke-width="6" paint-order="stroke" font-size="28" font-family="Arial,sans-serif" font-weight="800">${name}</text></svg>`;return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}
const input=document.getElementById('message-input');
function pop(id,items,handler){const p=document.getElementById(id);if(!p)return;p.innerHTML='';items.forEach(x=>{const b=document.createElement('button');b.type='button';b.className='emoji-item';b.innerHTML=x.label||x;b.title=x.title||'';b.onclick=()=>handler(x.value||x);p.appendChild(b)})}
pop('emoji-popover',emojis.concat(supers.map(([x,n])=>({value:'__SUPER__:'+x,label:x,title:'Super emoji: '+n}))),v=>{input.setRangeText(v,input.selectionStart,input.selectionEnd,'end');input.focus();document.getElementById('emoji-popover')?.classList.add('hidden')});
pop('sticker-popover',stickers.map(([v,n])=>({value:'__STICKER__:'+stickerData(v,n),label:v,title:n})),v=>{input.value=v;document.getElementById('sticker-popover')?.classList.add('hidden');input.form?.requestSubmit()});

// As "abinhas" do composer (emoji/figurinha/câmera) ficavam abertas pra
// sempre — não fechavam sozinhas ao abrir outra, nem ao clicar em
// qualquer outro lugar da tela. Agora só uma fica aberta por vez, e
// clicar fora de qualquer uma delas fecha todas.
const POPOVER_IDS=['emoji-popover','sticker-popover','camera-popover'];
function closeOtherPopovers(exceptId){POPOVER_IDS.forEach(id=>{if(id!==exceptId)document.getElementById(id)?.classList.add('hidden')})}
function togglePopover(id){const p=document.getElementById(id);if(!p)return;const willOpen=p.classList.contains('hidden');closeOtherPopovers(id);p.classList.toggle('hidden',!willOpen)}
document.addEventListener('click',e=>{
  const insideAny=POPOVER_IDS.some(id=>e.target.closest('#'+id));
  const isTrigger=e.target.closest('#emoji-btn,#sticker-btn,#camera-btn');
  if(!insideAny&&!isTrigger) closeOtherPopovers(null);
});
document.getElementById('emoji-btn')?.addEventListener('click',e=>{e.stopPropagation();togglePopover('emoji-popover')});
document.getElementById('sticker-btn')?.addEventListener('click',e=>{e.stopPropagation();togglePopover('sticker-popover')});

// Câmera nativa — só existe dentro do composer de mensagens, ou seja, só
// funciona dentro de uma conversa ou canal já aberto (o mesmo input fica
// desabilitado quando nada está selecionado). O atributo capture="environment"
// é o que faz o navegador/WebView abrir o app de câmera de verdade em vez do
// seletor de arquivos comum.
document.getElementById('camera-btn')?.addEventListener('click',e=>{e.stopPropagation();togglePopover('camera-popover')});
document.getElementById('camera-take-photo')?.addEventListener('click',()=>{document.getElementById('camera-popover')?.classList.add('hidden');document.getElementById('camera-photo-input')?.click();});
document.getElementById('camera-record-video')?.addEventListener('click',()=>{document.getElementById('camera-popover')?.classList.add('hidden');document.getElementById('camera-video-input')?.click();});
function handleCameraCapture(e){
  const file=e.target.files&&e.target.files[0];
  e.target.value='';
  if(!file)return;
  const st=window.App?.getState?.();
  if(!st?.activeDMUserId&&!st?.activeChannelId){window.App?.toast?.('Abra uma conversa ou canal primeiro.','error');return;}
  window.WCMedia?.uploadFiles?.([file]);
}
document.getElementById('camera-photo-input')?.addEventListener('change',handleCameraCapture);
document.getElementById('camera-video-input')?.addEventListener('change',handleCameraCapture);

let avatarData, bannerData;
const readImage=f=>new Promise((resolve,reject)=>{
  if(!f)return resolve(null);
  if(f.type==='image/gif') {
    const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(f); return;
  }
  const r=new FileReader();
  r.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const max=1600, scale=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
      const x=c.getContext('2d'); x.drawImage(img,0,0,c.width,c.height);
      resolve(c.toDataURL('image/jpeg',.82));
    };
    img.onerror=()=>resolve(r.result);
    img.src=r.result;
  };
  r.onerror=reject; r.readAsDataURL(f);
});
document.getElementById('settings-avatar-edit-btn')?.addEventListener('click',()=>document.getElementById('settings-avatar-input')?.click());
document.getElementById('settings-banner-edit-btn')?.addEventListener('click',()=>document.getElementById('settings-banner-input')?.click());
document.getElementById('settings-avatar-input')?.addEventListener('change',async e=>{try{avatarData=await readImage(e.target.files[0]);window.ProfileDesigner?.render?.()}catch(_){window.App?.toast('Não foi possível carregar o avatar.','error')}});
document.getElementById('settings-banner-input')?.addEventListener('change',async e=>{try{bannerData=await readImage(e.target.files[0]);window.ProfileDesigner?.render?.()}catch(_){window.App?.toast('Não foi possível carregar o banner.','error')}});

async function saveSettings(patch,msg='Configurações salvas.') {
  const r=await fetch('/api/auth/settings',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw Error(d.error||'Não foi possível salvar.');
  window.App?.handleProfileUpdate?.({user:d.user});
  if(msg) window.App?.toast?.(msg,'success');
  return d.user;
}

const THEMES={
  galactic:{primary:'#5865F2',secondary:'#24104d',accent:'#c59cff',text:'#f6f1ff',gradient:'radial',angle:'135deg',glow:'soft'},
  aurora:{primary:'#5865F2',secondary:'#0b4960',accent:'#7cf7dc',text:'#f3ffff',gradient:'linear',angle:'135deg',glow:'soft'},
  cyber:{primary:'#5865F2',secondary:'#160c2d',accent:'#00e5ff',text:'#f6f8ff',gradient:'linear',angle:'90deg',glow:'strong'},
  void:{primary:'#4a3b68',secondary:'#08080d',accent:'#9d8abf',text:'#eee9f8',gradient:'radial',angle:'135deg',glow:'none'},
  frost:{primary:'#647cff',secondary:'#173d68',accent:'#a9e8ff',text:'#f2fbff',gradient:'linear',angle:'135deg',glow:'soft'},
  minimal:{primary:'#786b96',secondary:'#17151e',accent:'#ffffff',text:'#f5f2f8',gradient:'linear',angle:'90deg',glow:'none'}
};
const DEFAULT_PROFILE={primary:'#5865F2',secondary:'#24104d',accent:'#c59cff',text:'#f6f1ff',gradient:'radial',angle:'135deg',glow:'soft',layout:'classic',nameFont:'modern',nameColorMode:'solid',nameColor:'#ffffff',nameColor2:'#a970ff',nameEffect:'none',nameAnimation:'none',nameSize:30,nameWeight:700,frame:'none',decoration:'none',badge:'none',nameplate:'none',pronouns:'',avatarFx:'none',avatarAura:'none',activity:{type:'',title:'',description:''},connections:[]};

// ---------------------------------------------------------------------
// Favoritos (★) são uma conveniência de navegação do seletor — guardados
// no localStorage do navegador (não precisam ir pro servidor: são "o que
// EU marquei" pra achar mais rápido, não algo que outras pessoas vejam).
const FAV_KEY='wc_cosmetic_favorites';
function loadFavorites(){try{return new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]'))}catch(_){return new Set()}}
function saveFavorites(set){try{localStorage.setItem(FAV_KEY,JSON.stringify([...set]))}catch(_){/* localStorage indisponível: favoritos só não persistem entre sessões */}}
let favorites=loadFavorites();
function favId(kind,id){return kind+':'+id}

function getProfile(){return window.App?.getState?.()?.currentUser?.settings?.profileCustomization||{}}
function value(id, fallback=''){return document.getElementById(id)?.value ?? fallback}
function checked(id){return !!document.getElementById(id)?.checked}
function setVal(id,v){const e=document.getElementById(id);if(e&&v!=null)e.value=v}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function mergeProfile(){const p={...DEFAULT_PROFILE,...getProfile()};p.activity={...DEFAULT_PROFILE.activity,...(getProfile().activity||{})};return p}
function collectProfile(){
  const p=mergeProfile();
  p.primary=value('settings-profile-primary',p.primary);p.secondary=value('settings-profile-secondary',p.secondary);p.accent=value('settings-profile-accent',p.accent);p.text=value('settings-profile-text',p.text);
  p.gradient=value('settings-profile-gradient',p.gradient);p.angle=value('settings-profile-angle',p.angle);p.glow=value('settings-profile-glow',p.glow);p.layout=value('settings-profile-layout',p.layout);
  p.nameFont=value('settings-name-font',p.nameFont);p.nameColorMode=value('settings-name-color-mode',p.nameColorMode);p.nameColor=value('settings-name-color',p.nameColor);p.nameColor2=value('settings-name-color2',p.nameColor2);p.nameEffect=value('settings-name-effect',p.nameEffect);p.nameAnimation=value('settings-name-animation',p.nameAnimation);p.nameSize=Number(value('settings-name-size',p.nameSize));p.nameWeight=Number(value('settings-name-weight',p.nameWeight));
  p.frame=String(window.__wcTempFrame!==undefined?window.__wcTempFrame:(p.frame||'none'));p.serverTag=value('settings-profile-tag',p.serverTag||'');p.decoration=value('settings-profile-decoration',p.decoration);p.badge=value('settings-profile-badge',p.badge);p.nameplate=value('settings-nameplate',p.nameplate);p.pronouns=value('settings-profile-pronouns',p.pronouns);
  p.avatarFx=String(window.__wcTempAvatarFx!==undefined?window.__wcTempAvatarFx:(p.avatarFx||'none'));
  p.avatarAura=String(window.__wcTempAura!==undefined?window.__wcTempAura:(p.avatarAura||'none'));
  p.activity={type:value('settings-activity-type',p.activity.type),title:value('settings-activity-title',p.activity.title),description:value('settings-activity-description',p.activity.description)};
  p.connections=[];for(let i=1;i<=3;i++){const name=value(`settings-connection-${i}-name`),url=value(`settings-connection-${i}-url`);if(name&&url)p.connections.push({name,url})}
  return p;
}
function applyTheme(name){const t=THEMES[name];if(!t)return;Object.entries(t).forEach(([k,v])=>{const id={primary:'settings-profile-primary',secondary:'settings-profile-secondary',accent:'settings-profile-accent',text:'settings-profile-text',gradient:'settings-profile-gradient',angle:'settings-profile-angle',glow:'settings-profile-glow'}[k];if(id)setVal(id,v)});render()}

// ---------------------------------------------------------------------
// Seletor de cosméticos em cards — um renderizador genérico pros três
// grids (atmosfera/aura/moldura): recebe a lista de itens (de
// cosmetics-data.js) e desenha cards com ícone, nome, raridade e ★. Novo
// efeito = nova linha na lista de dados, nunca precisa mexer aqui.
function iconFor(kind,id){return{atmosphere:'✦',aura:'✦',frame:'◆'}[kind]||'•'}
// Nota: o card é um <div role="button"> em vez de <button> de verdade
// porque ele PRECISA conter o ★ de favorito como um segundo alvo
// clicável (data-fav) dentro dele — <button> dentro de <button> é HTML
// inválido (o navegador fecha o botão de fora cedo e quebra o layout e
// os cliques). O clique continua funcionando igual porque é tudo
// delegado (ver o listener em #modal-settings mais abaixo).
function cardHTML(kind,item,activeId,locked){
  const RC=window.WCCosmeticsData?.RARITY_COLOR||{};
  const isFav=favorites.has(favId(kind,item.id));
  const active=item.id===(activeId||'none');
  return `<div role="button" tabindex="0" class="wc-cosmetic-card${active?' active':''}${locked?' is-locked':''}" data-cosmetic-id="${esc(item.id)}" data-kind="${kind}" style="--wc-rarity:${RC[item.rarity]||'#8d6dff'}" title="${esc(item.name)} · ${window.WCCosmeticsData?.RARITY_LABEL?.[item.rarity]||''}">
    <span class="wc-cc-rarity" aria-hidden="true"></span>
    <span role="button" tabindex="-1" class="wc-cc-fav${isFav?' is-fav':''}" data-fav="${esc(favId(kind,item.id))}" aria-label="Favoritar" title="Favoritar">★</span>
    <span class="wc-cc-icon" aria-hidden="true">${esc(item.icon||iconFor(kind))}</span>
    <span class="wc-cc-name">${esc(item.name)}</span>
  </div>`;
}
function noneCard(kind,activeId){
  const active=(activeId||'none')==='none';
  return `<div role="button" tabindex="0" class="wc-cosmetic-card${active?' active':''}" data-cosmetic-id="none" data-kind="${kind}" style="--wc-rarity:#5b5670" title="Nenhum">
    <span class="wc-cc-icon" aria-hidden="true">∅</span><span class="wc-cc-name">Nenhum</span>
  </div>`;
}
let cosmeticFilter={query:'',chip:'all'};
function itemMatchesFilter(item){
  const f=cosmeticFilter;
  if(f.chip==='favorites'&&!favorites.has(favId(item.__kind,item.id)))return false;
  if(f.chip==='equipped'&&item.id!==item.__activeId)return false;
  if(f.chip!=='all'&&f.chip!=='favorites'&&f.chip!=='equipped'&&item.category!==f.chip)return false;
  if(f.query){
    const q=f.query.toLowerCase();
    const hay=[item.name,item.category,...(item.vibe||[])].join(' ').toLowerCase();
    if(!hay.includes(q))return false;
  }
  return true;
}
function renderCosmeticGrid(containerId,kind,items,activeId,wfnaLocked){
  const el=document.getElementById(containerId);if(!el)return;
  const filtered=items.filter(it=>itemMatchesFilter({...it,__kind:kind,__activeId:activeId}));
  el.innerHTML=noneCard(kind,activeId)+filtered.map(it=>cardHTML(kind,it,activeId,wfnaLocked&&it.id!==activeId)).join('');
}
function renderCosmeticChips(){
  const box=document.getElementById('wc-cosmetic-chips');if(!box)return;
  const cats=new Set();
  (window.WCCosmeticsData?.ATMOSPHERE_EFFECTS||[]).forEach(x=>cats.add(x.category));
  (window.WCCosmeticsData?.AVATAR_AURAS||[]).forEach(x=>cats.add(x.category));
  const chips=[['all','Todos'],['favorites','★ Favoritos'],['equipped','Equipados'],...[...cats].sort().map(c=>[c,c])];
  box.innerHTML=chips.map(([id,label])=>`<button type="button" class="wc-cosmetic-chip${cosmeticFilter.chip===id?' active':''}" data-chip="${esc(id)}">${esc(label)}</button>`).join('');
}
function renderCosmeticPickers(){
  const D=window.WCCosmeticsData;if(!D)return;
  const effectId=value('settings-profile-effect','none');
  const auraId=window.__wcTempAura!==undefined?window.__wcTempAura:(mergeProfile().avatarAura||'none');
  const frameId=window.__wcTempFrame!==undefined?window.__wcTempFrame:(mergeProfile().frame||'none');
  const me=window.App?.getState?.()?.currentUser;const locked=!me?.wfna;
  renderCosmeticGrid('wc-atmosphere-grid','atmosphere',D.ATMOSPHERE_EFFECTS,effectId,locked);
  renderCosmeticGrid('wc-aura-grid','aura',D.AVATAR_AURAS,auraId,locked);
  renderCosmeticGrid('wc-frame-presets','frame',D.FRAMES,frameId,false);
}
function renderPresetButtons(){
  const box=document.getElementById('wc-cosmetic-presets');if(!box||!window.WCCosmeticsData)return;
  box.innerHTML=window.WCCosmeticsData.PRESETS.map(p=>`<button type="button" data-preset="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}</button>`).join('');
}
function applyPreset(presetId){
  const preset=window.WCCosmeticsData?.PRESETS.find(p=>p.id===presetId);if(!preset)return;
  applyTheme(preset.theme);
  setVal('settings-profile-effect',preset.atmosphere);
  const enabledBox=document.getElementById('settings-profile-effect-enabled');if(enabledBox)enabledBox.checked=true;
  window.__wcTempFrame=preset.frame;
  window.__wcTempAura=preset.aura;
  renderCosmeticPickers();
  render();
}
document.getElementById('wc-cosmetic-surprise')?.addEventListener('click',()=>{
  const list=window.WCCosmeticsData?.PRESETS||[];if(!list.length)return;
  applyPreset(list[Math.floor(Math.random()*list.length)].id);
});
document.getElementById('wc-cosmetic-search')?.addEventListener('input',e=>{cosmeticFilter.query=e.target.value;renderCosmeticPickers()});
document.getElementById('wc-cosmetic-chips')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-chip]');if(!b)return;
  cosmeticFilter.chip=b.dataset.chip;renderCosmeticChips();renderCosmeticPickers();
});
document.getElementById('wc-cosmetic-presets')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-preset]');if(!b)return;applyPreset(b.dataset.preset);
});
// Clique nos três grids (atmosfera/aura/moldura): um handler delegado só,
// porque os grids são recriados a cada renderCosmeticPickers() — presos
// no elemento pai (#modal-settings), que nunca é substituído.
document.getElementById('modal-settings')?.addEventListener('click',e=>{
  const fav=e.target.closest('[data-fav]');
  if(fav){
    e.stopPropagation();
    const key=fav.dataset.fav;
    favorites.has(key)?favorites.delete(key):favorites.add(key);
    saveFavorites(favorites);
    renderCosmeticPickers();
    return;
  }
  const card=e.target.closest('.wc-cosmetic-card');if(!card)return;
  const kind=card.dataset.kind,id=card.dataset.cosmeticId;
  if(kind==='atmosphere')setVal('settings-profile-effect',id);
  else if(kind==='aura')window.__wcTempAura=id;
  else if(kind==='frame')window.__wcTempFrame=id;
  else return;
  renderCosmeticPickers();
  render();
});
// Teclado (os cards são <div role="button">, não <button>, por causa do
// ★ aninhado — ver o comentário em cardHTML): Enter/Espaço ativa o card
// focado do mesmo jeito que um clique.
document.getElementById('modal-settings')?.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const card=e.target.closest?.('.wc-cosmetic-card, .wc-cc-fav');if(!card)return;
  e.preventDefault();
  card.dispatchEvent(new MouseEvent('click',{bubbles:true}));
});

function render(){
  const p=collectProfile(),u=window.App?.getState?.()?.currentUser||{};
  const avatar=avatarData||u.avatarUrl;
  const banner=bannerData||u.bannerUrl;
  const root=document.getElementById('wc-profile-preview');if(!root)return;
  root.style.setProperty('--p1',p.primary);root.style.setProperty('--p2',p.secondary);root.style.setProperty('--pa',p.accent);root.style.setProperty('--pt',p.text);root.style.setProperty('--name-color',p.nameColor);root.style.setProperty('--name-color2',p.nameColor2);root.style.setProperty('--name-size',p.nameSize+'px');root.style.setProperty('--name-weight',p.nameWeight);
  root.dataset.glow=p.glow;root.dataset.font=p.nameFont;root.dataset.effect=p.nameEffect;root.dataset.animation=p.nameAnimation;root.dataset.colorMode=p.nameColorMode;root.dataset.frame=p.frame;root.dataset.decoration=p.decoration;
  const b=document.getElementById('wc-preview-banner');if(b)b.style.background=banner?`url("${String(banner).replace(/"/g,'')}") center/cover`:`${p.gradient==='radial'?'radial-gradient':'linear-gradient'}(${p.angle},${p.primary},${p.secondary})`;
  // O preview do avatar passa pelo MESMO identity.js que desenha em
  // qualquer outro lugar do app — moldura/decoração/mini-efeito/aura
  // ficam garantidos idênticos ao que vai aparecer de verdade em vez de
  // reimplementar a lógica de novo só pra essa prévia (era exatamente
  // isso que fazia o preview antigo nunca mostrar a aura/mini-efeito).
  const wrap=document.getElementById('wc-preview-avatar-wrap');
  if(wrap&&window.WCIdentity){
    const previewEntity={
      displayName:value('settings-display-name',u.displayName||u.username||'Usuário'),
      username:u.username, avatarUrl:avatar||null, wfna:u.wfna, frame:u.frame, decoration:u.decoration,
      settings:{
        profileEffect:value('settings-profile-effect','none'),
        profileEffectEnabled:checked('settings-profile-effect-enabled'),
        profileCustomization:p
      }
    };
    wrap.innerHTML=window.WCIdentity.avatarHTML(previewEntity,{context:'preview',size:'xl',label:previewEntity.displayName});
  } else {
    const av=document.getElementById('wc-preview-avatar');if(av)av.innerHTML=avatar?`<img src="${esc(avatar)}" alt="">`:`<span>${esc((u.displayName||u.username||'?')[0].toUpperCase())}</span>`;
  }
  const thumb=document.getElementById('settings-avatar-preview');if(thumb&&avatar)thumb.src=avatar;const bt=document.getElementById('settings-profile-banner');if(bt&&banner)bt.style.backgroundImage=`url("${String(banner).replace(/"/g,'')}")`;
  const name=document.getElementById('wc-preview-name');if(name){name.textContent=value('settings-display-name',u.displayName||u.username||'Usuário');name.dataset.effect=p.nameEffect;name.dataset.animation=p.nameAnimation}
  const np=document.getElementById('wc-preview-nameplate');if(np)np.textContent=p.nameplate==='none'?'':p.nameplate.toUpperCase();
    const ub=document.getElementById('wc-preview-username');if(ub)ub.textContent='@'+(u.username||'usuario');
  const pb=document.getElementById('wc-preview-bio');if(pb)pb.textContent=value('settings-bio',u.bio)||'Sem descrição.';
  const pron=p.pronouns?` · ${p.pronouns}`:'';
  const st=document.getElementById('wc-preview-status');if(st)st.textContent=(u.customStatusEmoji||'')+' '+(u.customStatusText||u.status||'online')+pron;
  const act=document.getElementById('wc-preview-activity'),a=p.activity;if(act){if(a.type&&a.title){const labels={game:'🎮 Jogando',music:'🎵 Ouvindo',watching:'📺 Assistindo',coding:'💻 Programando',creating:'🎨 Criando',studying:'📚 Estudando',working:'⚙️ Trabalhando'};act.classList.remove('hidden');act.innerHTML=`<b>${labels[a.type]||'Atividade'}</b><strong>${esc(a.title)}</strong>${a.description?`<small>${esc(a.description)}</small>`:''}`}else{act.classList.add('hidden');act.innerHTML=''}}
  const bd=document.getElementById('wc-preview-badges');if(bd)bd.innerHTML=(p.badge&&p.badge!=='none'?`<span>${({star:'⭐',fire:'🔥',rocket:'🚀',crown:'👑'})[p.badge]||''}</span>`:'')+(p.pronouns?`<span>${esc(p.pronouns)}</span>`:'')+(p.serverTag?`<span class="wc-tag">${esc(p.serverTag)}</span>`:'');
  const cn=document.getElementById('wc-preview-connections');if(cn)cn.innerHTML=p.connections.map(x=>`<span>↗ ${esc(x.name)}</span>`).join('');
}
const ProfileDesigner={
  refresh(){
    avatarData=undefined;bannerData=undefined;
    const p=mergeProfile(),u=window.App?.getState?.()?.currentUser||{};
    setVal('settings-profile-primary',p.primary);setVal('settings-profile-secondary',p.secondary);setVal('settings-profile-accent',p.accent);setVal('settings-profile-text',p.text);
    setVal('settings-profile-gradient',p.gradient);setVal('settings-profile-angle',p.angle);setVal('settings-profile-glow',p.glow);setVal('settings-profile-layout',p.layout);
    setVal('settings-name-font',p.nameFont);setVal('settings-name-color-mode',p.nameColorMode);setVal('settings-name-color',p.nameColor);setVal('settings-name-color2',p.nameColor2);setVal('settings-name-effect',p.nameEffect);setVal('settings-name-animation',p.nameAnimation);setVal('settings-name-size',p.nameSize);setVal('settings-name-weight',p.nameWeight);
    setVal('settings-profile-decoration',p.decoration);setVal('settings-profile-badge',p.badge);setVal('settings-nameplate',p.nameplate);setVal('settings-profile-pronouns',p.pronouns);setVal('settings-profile-tag',p.serverTag||'');
    window.__wcTempFrame=p.frame;
    document.querySelectorAll('#wc-avatarfx-presets [data-avatarfx]').forEach(b=>b.classList.toggle('active',b.dataset.avatarfx===(p.avatarFx||'none')));window.__wcTempAvatarFx=p.avatarFx||'none';
    window.__wcTempAura=p.avatarAura||'none';
    setVal('settings-activity-type',p.activity.type);setVal('settings-activity-title',p.activity.title);setVal('settings-activity-description',p.activity.description);
    (p.connections||[]).slice(0,3).forEach((x,i)=>{setVal(`settings-connection-${i+1}-name`,x.name);setVal(`settings-connection-${i+1}-url`,x.url)});
    const thumb=document.getElementById('settings-avatar-preview');if(thumb)thumb.src=u.avatarUrl||'';const b=document.getElementById('settings-profile-banner');if(b)b.style.backgroundImage=u.bannerUrl?`url("${u.bannerUrl}")`:'';
    renderPresetButtons();renderCosmeticChips();renderCosmeticPickers();
    render();
  },
  render
};
window.ProfileDesigner=ProfileDesigner;

document.querySelectorAll('#wc-theme-presets [data-theme-preset]').forEach(b=>b.addEventListener('click',()=>applyTheme(b.dataset.themePreset)));
// Presets de "Avatar interativo" (pirueta / brilho ao passar o mouse / pets
// companheiros) — guarda a escolha em window.__wcTempAvatarFx, só
// realmente gravada quando "Salvar perfil" é clicado (ver handler de
// #settings-save-profile logo abaixo).
document.querySelectorAll('#wc-avatarfx-presets [data-avatarfx]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('#wc-avatarfx-presets [data-avatarfx]').forEach(x=>x.classList.toggle('active',x===b));
  window.__wcTempAvatarFx=b.dataset.avatarfx;
  render();
}));
document.querySelectorAll('.wc-profile-controls input,.wc-profile-controls select,.wc-profile-controls textarea').forEach(e=>e.addEventListener('input',render));
document.querySelectorAll('.wc-profile-controls select').forEach(e=>e.addEventListener('change',render));

document.getElementById('wc-profile-reset')?.addEventListener('click',()=>{
  if(!confirm('Restaurar a personalização padrão?'))return;
  const p={...DEFAULT_PROFILE,activity:{...DEFAULT_PROFILE.activity},connections:[]};
  Object.entries({primary:'settings-profile-primary',secondary:'settings-profile-secondary',accent:'settings-profile-accent',text:'settings-profile-text',gradient:'settings-profile-gradient',angle:'settings-profile-angle',glow:'settings-profile-glow',layout:'settings-profile-layout',nameFont:'settings-name-font',nameColorMode:'settings-name-color-mode',nameColor:'settings-name-color',nameColor2:'settings-name-color2',nameEffect:'settings-name-effect',nameAnimation:'settings-name-animation',nameSize:'settings-name-size',nameWeight:'settings-name-weight',decoration:'settings-profile-decoration',badge:'settings-profile-badge',nameplate:'settings-nameplate',serverTag:'settings-profile-tag',pronouns:'settings-profile-pronouns','activity.type':'settings-activity-type','activity.title':'settings-activity-title','activity.description':'settings-activity-description'}).forEach(([k,id])=>{let v=k.includes('.')?p.activity[k.split('.')[1]]:p[k];setVal(id,v)});
  for(let i=1;i<=3;i++){setVal(`settings-connection-${i}-name`,'');setVal(`settings-connection-${i}-url`,'')}
  window.__wcTempFrame='none';window.__wcTempAvatarFx='none';window.__wcTempAura='none';setVal('settings-profile-effect','none');
  document.querySelectorAll('#wc-avatarfx-presets [data-avatarfx]').forEach(x=>x.classList.toggle('active',x.dataset.avatarfx==='none'));
  renderCosmeticPickers();render();
});

document.getElementById('settings-save-profile')?.addEventListener('click',async()=>{
  const btn=document.getElementById('settings-save-profile');if(btn.dataset.busy)return;
  const me=window.App?.getState?.()?.currentUser;
  const stagedAura=window.__wcTempAura&&window.__wcTempAura!=='none'?window.__wcTempAura:'none';
  // Mesma trava que já existia pro efeito de atmosfera (WFNA) — a aura é
  // mais uma camada premium, não um jeito novo de contornar a mesma
  // regra.
  if(stagedAura!=='none'&&!me?.wfna)return window.App?.toast('A aura do avatar é exclusiva do WFNA.','error');
  btn.dataset.busy='1';const old=btn.textContent;btn.textContent='Salvando...';btn.disabled=true;
  try{
    const body={displayName:value('settings-display-name'),bio:value('settings-bio')};
    if(avatarData!==undefined)body.avatarUrl=avatarData;
    if(bannerData!==undefined)body.bannerUrl=bannerData;
    const r=await fetch('/api/auth/profile',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Não foi possível salvar o perfil.');
    const p=collectProfile();p.frame=window.__wcTempFrame||p.frame;p.avatarFx=window.__wcTempAvatarFx||p.avatarFx;p.avatarAura=stagedAura;
    await saveSettings({profileCustomization:p},'Perfil salvo com sucesso.');
    avatarData=undefined;bannerData=undefined;window.__wcTempFrame=undefined;window.__wcTempAvatarFx=undefined;window.__wcTempAura=undefined;
    ProfileDesigner.refresh();
  }catch(e){window.App?.toast?.(e.message,'error')}
  finally{btn.dataset.busy='';btn.disabled=false;btn.textContent=old}
});

document.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-status]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}));
document.getElementById('settings-save-status')?.addEventListener('click',async()=>{
  const status=document.querySelector('[data-status].selected')?.dataset.status||'online';
  try{const r=await fetch('/api/auth/status',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,text:value('settings-status-text'),emoji:value('settings-status-emoji')})});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível atualizar o status.');window.App?.handleProfileUpdate?.({user:d.user});window.App?.toast?.('Status atualizado.','success');ProfileDesigner.refresh()}catch(e){window.App?.toast?.(e.message,'error')}
});
document.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>ProfileDesigner.render()));

document.getElementById('settings-accent')?.addEventListener('input',e=>document.documentElement.style.setProperty('--accent',e.target.value));
document.getElementById('settings-compact')?.addEventListener('change',e=>document.body.classList.toggle('compact',e.target.checked));
document.getElementById('settings-reduce-motion')?.addEventListener('change',e=>document.body.classList.toggle('reduce-motion',e.target.checked));
document.getElementById('settings-save-appearance')?.addEventListener('click',()=>saveSettings({accent:value('settings-accent'),compact:checked('settings-compact'),reduceMotion:checked('settings-reduce-motion'),cosmeticsQuality:value('settings-cosmetics-quality','auto')}).then(()=>window.WCIdentity?.syncPerfTier?.()));
document.getElementById('settings-save-advanced')?.addEventListener('click',()=>saveSettings({chatDensity:value('settings-chat-density'),fontSize:value('settings-font-size'),showTimestamps:checked('settings-show-timestamps'),showMemberList:checked('settings-show-member-list'),showEmbeds:checked('settings-show-embeds'),stickerAnimations:checked('settings-sticker-animations'),autoplayMedia:checked('settings-autoplay-media'),overlayEffects:checked('settings-overlay-effects'),superEmojiEffects:checked('settings-super-effects'),localNicknames:checked('settings-local-nicknames'),language:value('settings-language'),mediaQuality:value('settings-media-quality','auto'),animatedProfile:document.getElementById('settings-animated-profile')?.checked!==false,inlineMedia:document.getElementById('settings-inline-media')?.checked!==false,autoDownload:checked('settings-auto-download')}));
document.getElementById('settings-save-accessibility')?.addEventListener('click',()=>saveSettings({reduceMotion:checked('settings-reduce-motion-2'),outputVolume:Number(value('settings-output-volume',100)),inputVolume:Number(value('settings-input-volume',100)),voiceInputSensitivity:Number(value('settings-voice-sensitivity',50))}));
document.getElementById('settings-test-sound')?.addEventListener('click',()=>window.Sounds?.play('message'));
document.getElementById('settings-save-profile-effects')?.addEventListener('click',()=>{const me=window.App?.getState?.()?.currentUser;if(!me?.wfna)return window.App?.toast('Os efeitos animados do perfil são exclusivos do WFNA.','error');saveSettings({profileEffect:value('settings-profile-effect','none'),profileEffectSpeed:value('settings-profile-effect-speed','normal'),profileEffectEnabled:checked('settings-profile-effect-enabled')},'Efeitos do perfil salvos.').catch(e=>window.App?.toast(e.message,'error'));});
})();
// ---------------------------------------------------------------------
// Autocomplete de @menção no composer
// ---------------------------------------------------------------------
(function(){
  const input=document.getElementById('message-input');
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
      const av=u.avatarUrl?`<img src="${escM(u.avatarUrl)}" alt="" loading="lazy" decoding="async">`:`<div class="avatar-fallback">${escM(label.trim().charAt(0).toUpperCase())}</div>`;
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
