(function(){
'use strict';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opt={}){opt=Object.assign({},opt,{credentials:'same-origin'});opt.headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});let r;for(let i=0;i<2;i++){try{r=await fetch(url,opt);break}catch(e){if(i)throw Error('Não foi possível conectar ao servidor.');await new Promise(x=>setTimeout(x,250));}}const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('Erro na requisição ('+r.status+')'));return d;}
function open(id){const o=$('modal-overlay');if(!o)return;o.classList.remove('hidden');document.querySelectorAll('.modal').forEach(x=>x.classList.add('hidden'));$(id)?.classList.remove('hidden');}
function close(){document.getElementById('modal-overlay')?.classList.add('hidden');document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));stopAvatarPet();}
function avatar(u){
  const ps=u?.settings?.profileCustomization||u?.profileSettings?.profileCustomization||u?.settings||{};
  const frameName=ps.frame&&ps.frame!=='none'?ps.frame:(u?.frame||'');
  const decorName=ps.decoration&&ps.decoration!=='none'?ps.decoration:(u?.decoration||'');
  const effect=u?.wfna&&u?.settings?.profileEffectEnabled&&u?.settings?.profileEffect&&u.settings.profileEffect!=='none'?u.settings.profileEffect:'';
  const fxName=ps.avatarFx&&ps.avatarFx!=='none'?ps.avatarFx:'';
  const inner=u?.avatarUrl?`<img class="avatar-img" src="${esc(u.avatarUrl)}" alt="">`:`<span>${esc((u?.displayName||u?.username||'?')[0].toUpperCase())}</span>`;
  const frame=frameName?' frame-'+esc(String(frameName).replace(/^frame-/,'')):'';
  const decor=decorName?' decoration-'+esc(String(decorName).replace(/^decor-/,'')):'';
  const effectClass=effect?' profile-mini-effect-'+esc(effect):'';
  const fxClass=fxName?' avatar-fx-'+esc(fxName):'';
  const rocket=u?.wfna?'<span class="wfna-profile-rocket" aria-label="WFNA">🚀</span>':'';
  return `<span class="profile-avatar-decorated${frame}${decor}${effectClass}${fxClass}" style="--profile-color:${esc(ps.primary||ps.profileColor||'#5865F2')}">${inner}<i class="avatar-frame-overlay"></i><b class="avatar-decoration-overlay"></b><em class="avatar-effect-overlay"></em>${rocket}</span>`;
}

// Pet que segue o mouse dentro do cartão de perfil (presets pet-cat/pet-bird).
// Só existe enquanto o modal de perfil está aberto e só reage a movimentos
// dentro do próprio cartão, pra não pesar o resto da interface.
let petState=null;
function stopAvatarPet(){
  if(!petState)return;
  petState.card?.removeEventListener('mousemove',petState.onMove);
  petState.raf&&cancelAnimationFrame(petState.raf);
  petState.el?.remove();
  petState=null;
}
function startAvatarPet(kind){
  stopAvatarPet();
  const card=$('profile-card');if(!card)return;
  const el=document.createElement('div');
  el.className='wc-avatar-pet';
  el.textContent=kind==='pet-bird'?'🐦':'🐱';
  card.appendChild(el);
  const st={card,el,x:60,y:60,tx:60,ty:60,onMove:null,raf:null};
  st.onMove=ev=>{const r=card.getBoundingClientRect();st.tx=ev.clientX-r.left;st.ty=ev.clientY-r.top;};
  card.addEventListener('mousemove',st.onMove);
  const tick=()=>{
    st.x+=(st.tx-st.x)*0.12;st.y+=(st.ty-st.y)*0.12;
    el.style.transform=`translate(${st.x-16}px,${st.y-16}px)`;
    st.raf=requestAnimationFrame(tick);
  };
  st.raf=requestAnimationFrame(tick);
  petState=st;
}
function rocket(){const o=document.createElement('div');o.className='rocket-overlay show';o.innerHTML='<div class="rocket-trail"></div><div class="rocket">🚀</div>';document.body.appendChild(o);setTimeout(()=>o.remove(),2200);}
let lastProfileId=null;
async function profile(id){
  try{
    const d=await api('/api/auth/profile/'+id),u=d.user,me=String(u.id)===String(window.App?.getState?.()?.currentUser?.id);
    lastProfileId=u.id;
    const c=$('profile-card');if(!c)throw Error('Perfil indisponível.');
    const ps={...(u.settings?.profileCustomization||{})};
    const color=ps.primary||ps.profileColor||'#5865F2',secondary=ps.secondary||'#24104d',accent=ps.accent||'#c59cff',text=ps.text||'#f6f1ff';
    c.className='profile-card';c.dataset.glow=ps.glow||'none';c.dataset.font=ps.nameFont||'modern';c.dataset.nameEffect=ps.nameEffect||'none';c.dataset.nameAnimation=ps.nameAnimation||'none';c.style.setProperty('--profile-color',color);c.style.setProperty('--profile-secondary',secondary);c.style.setProperty('--profile-accent',accent);c.style.setProperty('--profile-text',text);c.style.setProperty('--name-color',ps.nameColor||'#ffffff');c.style.setProperty('--name-color2',ps.nameColor2||accent);c.style.setProperty('--name-size',(Number(ps.nameSize)||30)+'px');c.style.setProperty('--name-weight',String(ps.nameWeight||700));c.dataset.colorMode=ps.nameColorMode||'solid';
    const banner=c.querySelector('.profile-card-banner');
    if(banner){
      const grad=(ps.gradient||'radial')==='radial'?`radial-gradient(circle at 70% 30%,${color},${secondary} 60%,#08080e)`:`linear-gradient(${ps.angle||'135deg'},${color},${secondary})`;
      banner.style.backgroundImage=u.bannerUrl?`url("${String(u.bannerUrl).replace(/"/g,'')}")`:grad;
    }
    const av=$('profile-avatar-view');if(av){av.innerHTML=avatar(u);av.dataset.frame=ps.frame||'none';}
    if(ps.avatarFx==='pet-cat'||ps.avatarFx==='pet-bird')startAvatarPet(ps.avatarFx);else stopAvatarPet();
    const effectLayer=$('profile-effect-layer');if(effectLayer){
      const effect=u.wfna&&u.settings?.profileEffectEnabled?u.settings.profileEffect||'none':'none';
      effectLayer.className='profile-effect-layer profile-effect-'+effect+(effect!=='none'?' is-active':'');effectLayer.dataset.speed=u.settings?.profileEffectSpeed||'normal';effectLayer.innerHTML=effect!=='none'?'<span></span><span></span><span></span>':'';
    }
    const name=$('profile-name');if(name){name.textContent=u.displayName||u.username||'Usuário';name.dataset.effect=ps.nameEffect||'none';name.dataset.animation=ps.nameAnimation||'none';}
    $('profile-username').textContent='@'+(u.username||'');
    $('profile-pronouns').textContent=ps.pronouns||'';
    $('profile-bio').textContent=u.bio||'Sem descrição.';
    $('profile-status').textContent=((u.customStatusEmoji||'')+' '+(u.customStatusText||u.status||'offline')).trim();
    const badgeMap={star:'⭐',fire:'🔥',rocket:'🚀',crown:'👑'};
    $('profile-badges').innerHTML=(ps.badge&&ps.badge!=='none'?`<span>${badgeMap[ps.badge]||''}</span>`:'')+(ps.serverTag?`<span class="profile-tag">${esc(ps.serverTag)}</span>`:'')+(u.wfna?'<span class="profile-wfna-mini">🚀 WFNA</span>':'');
    const act=$('profile-activity'),a=ps.activity||{};const labels={game:'🎮 Jogando',music:'🎵 Ouvindo',watching:'📺 Assistindo',coding:'💻 Programando',creating:'🎨 Criando',studying:'📚 Estudando',working:'⚙️ Trabalhando'};
    if(act){if(a.type&&a.title){act.classList.remove('hidden');act.innerHTML=`<span>${labels[a.type]||'Atividade'}</span><strong>${esc(a.title)}</strong>${a.description?`<small>${esc(a.description)}</small>`:''}`}else{act.classList.add('hidden');act.innerHTML=''}}
    const roles=$('profile-roles');const rs=d.profileContext?.roles||[];roles.innerHTML=rs.length?rs.map(r=>`<span class="profile-role" style="--role-color:${esc(r.color||'#8b78ff')}">${esc(r.name)}</span>`).join(''):'<span class="profile-empty">Nenhum cargo visível</span>';
    const con=$('profile-connections'),connections=Array.isArray(ps.connections)?ps.connections:[];con.innerHTML=connections.length?connections.map(x=>`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)} ↗</a>`).join(''):'<span class="profile-empty">Nenhuma conexão</span>';
    const common=$('profile-common-servers'),servers=d.profileContext?.commonServers||[];common.innerHTML=servers.length?servers.map(s=>`<span class="profile-server-chip">${s.iconUrl?`<img src="${esc(s.iconUrl)}" alt="" loading="lazy" decoding="async">`:'◉'}<b>${esc(s.name)}</b></span>`).join(''):'<span class="profile-empty">Nenhum servidor em comum</span>';
    const meta=$('profile-meta');const parseDate=window.App?.parseServerDate||(v=>v?new Date(v):null);const created=u.createdAt?parseDate(u.createdAt):null;meta.textContent=created&&!Number.isNaN(created.getTime())?'Membro desde '+created.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}):'';
    $('profile-points').textContent=(u.points||0)+' pontos';$('profile-wfna').innerHTML=u.wfna?'<span class="wfna-profile-badge active">🚀 WFNA</span>':'';
    renderProfileActions(u,me,d.profileContext?.relationship||{status:me?'self':'none',isBlockedByMe:false,hasBlockedMe:false});
    open('modal-profile');
  }catch(e){window.App?.toast(e.message,'error')}
}

// Botões do cartão de perfil (Adicionar/Remover amigo, Bloquear/Desbloquear,
// Denunciar) mudam de acordo com o relacionamento entre quem visita e quem é
// visto — esse relacionamento vem pronto do servidor (GET /api/auth/profile/:id,
// campo profileContext.relationship) pra não precisar de uma segunda chamada.
function renderProfileActions(u,me,rel){
  const box=$('profile-actions');if(!box)return;
  let html='';
  if(me){
    html='<button class="btn btn-primary" id="profile-open-settings">Editar perfil</button>';
  }else if(rel.hasBlockedMe){
    html='<span class="profile-blocked-note">Este usuário bloqueou você.</span>'+
      '<button class="btn btn-small btn-danger" id="profile-report-btn">🚩 Denunciar</button>';
  }else{
    if(rel.status==='friends'){
      html+='<button class="btn btn-primary" id="profile-send-message">Enviar mensagem</button>';
      html+='<button class="btn btn-small" id="profile-remove-friend">💔 Remover amigo</button>';
    }else if(rel.status==='pending_sent'){
      html+='<button class="btn btn-small" disabled>Solicitação enviada</button>';
    }else if(rel.status==='pending_received'){
      html+='<button class="btn btn-small" disabled title="Aceite na lista de solicitações de amizade">Solicitação recebida</button>';
    }else if(!rel.isBlockedByMe){
      html+='<button class="btn btn-primary" id="profile-add-friend">➕ Adicionar amigo</button>';
    }
    html+=rel.isBlockedByMe
      ?'<button class="btn btn-small" id="profile-unblock">Desbloquear</button>'
      :'<button class="btn btn-small btn-danger" id="profile-block">🚫 Bloquear</button>';
    html+='<button class="btn btn-small btn-danger" id="profile-report-btn">🚩 Denunciar</button>';
  }
  box.innerHTML=html;
  $('profile-open-settings')?.addEventListener('click',()=>{close();$('settings-btn')?.click()});
  $('profile-send-message')?.addEventListener('click',()=>{close();window.App?.openDM?.(u.id)});
  $('profile-add-friend')?.addEventListener('click',async()=>{
    try{await api('/api/friends/request',{method:'POST',body:JSON.stringify({username:u.username})});window.App?.toast('Solicitação enviada.','success');profile(u.id);}
    catch(e){window.App?.toast(e.message,'error')}
  });
  $('profile-remove-friend')?.addEventListener('click',async()=>{
    if(!confirm('Remover '+(u.displayName||u.username)+' da lista de amigos?'))return;
    try{
      await api('/api/friends/'+u.id,{method:'DELETE'});
      const st=window.App.getState();st.friends=(st.friends||[]).filter(f=>String(f.id)!==String(u.id));
      window.App.renderFriends();window.App?.toast('Amigo removido.','success');profile(u.id);
    }catch(e){window.App?.toast(e.message,'error')}
  });
  $('profile-block')?.addEventListener('click',async()=>{
    if(!confirm('Bloquear '+(u.displayName||u.username)+'? Isso remove a amizade e impede DMs/chamadas com essa pessoa.'))return;
    try{
      await api('/api/moderation/block/'+u.id,{method:'POST'});
      const st=window.App.getState();st.friends=(st.friends||[]).filter(f=>String(f.id)!==String(u.id));
      window.App.renderFriends();window.App?.toast('Usuário bloqueado.','success');profile(u.id);
    }catch(e){window.App?.toast(e.message,'error')}
  });
  $('profile-unblock')?.addEventListener('click',async()=>{
    try{await api('/api/moderation/block/'+u.id,{method:'DELETE'});window.App?.toast('Usuário desbloqueado.','success');profile(u.id);}
    catch(e){window.App?.toast(e.message,'error')}
  });
  $('profile-report-btn')?.addEventListener('click',()=>openReportModal(u.id,u.displayName||u.username));
}

// ---------------------------------------------------------------------
// Denúncias: modal com motivo + prints (reaproveita o upload de mídia já
// existente — window.WCMedia.uploadForWallpaper — pra guardar as evidências
// em /uploads, do mesmo jeito que qualquer outro arquivo enviado no app).
// ---------------------------------------------------------------------
let reportTarget=null,reportEvidenceMedia=[];
function renderReportEvidencePreview(){
  const box=$('report-evidence-preview');if(!box)return;
  box.innerHTML=reportEvidenceMedia.map((m,i)=>`<div class="report-evidence-thumb"><img src="${esc(m.url)}" alt="print ${i+1}"><button type="button" data-remove-evidence="${i}" aria-label="Remover print">✕</button></div>`).join('');
}
async function handleReportEvidenceInput(e){
  const remaining=3-reportEvidenceMedia.length;
  const files=Array.from(e.target.files||[]).slice(0,Math.max(0,remaining));
  e.target.value='';
  for(const file of files){
    try{
      const media=await window.WCMedia?.uploadForWallpaper?.(file);
      if(media)reportEvidenceMedia.push(media);
      renderReportEvidencePreview();
    }catch(err){window.App?.toast(err.message||'Falha ao enviar print.','error')}
  }
}
function openReportModal(userId,displayName,context){
  reportTarget={userId,context:context||{}};
  reportEvidenceMedia=[];
  const label=$('report-target-label');if(label)label.textContent='Denunciando: '+(displayName||('usuário #'+userId));
  const form=$('report-form');if(form)form.reset();
  renderReportEvidencePreview();
  open('modal-report');
}
async function submitReport(reason){
  if(!reportTarget)return;
  try{
    await api('/api/moderation/report',{method:'POST',body:JSON.stringify({
      userId:reportTarget.userId,reason,evidence:reportEvidenceMedia.map(m=>m.url),context:reportTarget.context
    })});
    window.App?.toast('Denúncia enviada. A equipe vai analisar.','success');
    close();
  }catch(e){window.App?.toast(e.message,'error')}
}

async function store(){open('modal-store');$('store-points').textContent='Carregando...';$('store-items').innerHTML='<div class="loading-state">Carregando loja...</div>';try{const d=await api('/api/economy/store');$('store-points').textContent=(d.user.points||0)+' pontos';$('store-wfna').textContent=d.user.wfna?'✓ WFNA adquirido':`WFNA — ${d.wfnaCost} pontos`; const quota=$('store-super-quota'); if(quota) quota.textContent=d.user.wfna?'♾️ Super emojis ilimitados':`${d.user.superEmojiRemaining??10} super emojis gratuitos restantes`;const list=$('store-items');list.innerHTML=d.items.map(i=>{const own=d.inventory.some(x=>x.id===i.id),eq=d.inventory.some(x=>x.id===i.id&&x.equipped);return `<article class="store-item"><div class="store-art ${esc(i.type)}">${esc(i.icon||'✧')}</div><div class="store-item-info"><strong>${esc(i.name)}</strong><small>${i.price.toLocaleString('pt-BR')} pontos</small></div><button class="btn btn-small" data-buy="${esc(i.id)}">${eq?'Equipado':own?'Equipar':'Comprar'}</button></article>`}).join('');list.querySelectorAll('[data-buy]').forEach(b=>b.onclick=async()=>{const id=b.dataset.buy,own=d.inventory.some(x=>x.id===id);try{const r=await api(own?'/api/economy/equip/'+id:'/api/economy/buy/'+id,{method:'POST'});window.App?.handleProfileUpdate?.({user:r.user});if(!own)window.App?.toast('Item comprado!','success');store()}catch(e){window.App?.toast(e.message,'error')}});$('store-wfna-buy').onclick=async()=>{try{const r=await api('/api/economy/wfna/buy',{method:'POST'});window.App?.handleProfileUpdate?.({user:r.user});rocket();window.App?.toast('WFNA ativado! 🚀','success');store()}catch(e){window.App?.toast(e.message,'error')}};$('store-wfna-paid').onclick=async()=>{try{const r=await api('/api/economy/wfna/payment-intent',{method:'POST'});if(r.url)window.open(r.url,'_blank','noopener');else window.App?.toast('Checkout não configurado.','error')}catch(e){window.App?.toast(e.message,'error')}}}catch(e){window.App?.toast(e.message,'error');$('store-items').innerHTML='<div class="error-state">Não foi possível carregar a loja.</div>'}}
function localNickname(serverId,targetId){const current=window.App?.getState?.()?.serverMembers?.find?.(m=>String(m.id)===String(targetId));const old=window.App?.getState?.()?.localNicknames?.[targetId]||'';const n=prompt('Apelido que só você verá (deixe vazio para remover):',old);if(n===null)return;api(`/api/servers/${serverId}/members/${targetId}/local-nickname`,{method:'PUT',body:JSON.stringify({nickname:n})}).then(()=>{const st=window.App.getState();st.localNicknames[targetId]=n.trim()||null;window.App.renderServerMembers();window.App.toast('Apelido local atualizado.','success')}).catch(e=>window.App.toast(e.message,'error'));}
function serverNickname(serverId,targetId){const n=prompt('Apelido do servidor (visível para todos):');if(n===null)return;api(`/api/servers/${serverId}/members/${targetId}/nickname`,{method:'PUT',body:JSON.stringify({nickname:n})}).then(()=>window.App.toast('Apelido do servidor atualizado.','success')).catch(e=>window.App.toast(e.message,'error'));}
function editMemberRoles(e,serverId,targetId){const st=window.App?.getState?.(),m=st?.serverMembers?.find(x=>String(x.id)===String(targetId));if(!m)return;const allRoles=(st.serverRoles||[]).slice().sort((a,b)=>(b.position||0)-(a.position||0));const memberRoleIds=new Set((m.roles||[]).map(r=>String(r.id)));const box=document.createElement('div');box.className='wc-context wc-role-editor';box.innerHTML=`<div class="wc-role-editor-title">Cargos de ${esc(m.serverNickname||m.displayName||m.username)}</div>`+(allRoles.length?allRoles.map(r=>`<label class="wc-role-editor-row"><input type="checkbox" data-role-id="${r.id}" ${memberRoleIds.has(String(r.id))?'checked':''}><span class="role-color" style="background:${esc(r.color||'#99aab5')}"></span>${esc(r.name)}</label>`).join(''):'<div class="wc-role-editor-empty">Nenhum cargo criado neste servidor ainda.</div>');document.body.appendChild(box);box.style.left=Math.min(e.clientX,innerWidth-240)+'px';box.style.top=Math.min(e.clientY,innerHeight-Math.min(320,80+allRoles.length*36))+'px';box.querySelectorAll('[data-role-id]').forEach(input=>{input.addEventListener('change',async()=>{const roleId=input.dataset.roleId,enabled=input.checked;input.disabled=true;try{await api(`/api/servers/${serverId}/roles/${roleId}/members/${targetId}`,{method:'PUT',body:JSON.stringify({enabled})});const role=allRoles.find(r=>String(r.id)===String(roleId));if(role){if(enabled)m.roles=[...(m.roles||[]).filter(r=>String(r.id)!==String(roleId)),role];else m.roles=(m.roles||[]).filter(r=>String(r.id)!==String(roleId));}window.App?.renderServerMembers?.();window.App?.toast(enabled?'Cargo adicionado.':'Cargo removido.','success')}catch(err){input.checked=!enabled;window.App?.toast(err.message,'error')}finally{input.disabled=false}})});setTimeout(()=>{document.addEventListener('click',function onDocClick(ev){if(box.contains(ev.target))return;box.remove();document.removeEventListener('click',onDocClick)})},0)}
function memberContext(e,id){e.preventDefault();document.querySelector('.wc-context')?.remove();const st=window.App?.getState?.(),m=st?.serverMembers?.find(x=>String(x.id)===String(id));if(!m)return;const box=document.createElement('div');box.className='wc-context';const isMe=String(id)===String(st.currentUser?.id),canManage=String(st.serverOwnerId)===String(st.currentUser?.id)||st.currentUser?.role==='admin';const isFriend=(st.friends||[]).some(f=>String(f.id)===String(id));box.innerHTML=`<button data-c="profile">👤 Ver perfil</button>${!isMe?'<button data-c="message">💬 Mensagem</button>':''}<button data-c="local">🏷️ Apelido só meu</button>${isMe||canManage?'<button data-c="servernick">🏷️ Apelido do servidor</button>':''}${canManage?'<button data-c="roles">🎭 Editar cargos</button>':''}${!isMe?(isFriend?'<button data-c="unfriend">💔 Remover amigo</button>':'<button data-c="addfriend">➕ Adicionar amigo</button>'):''}${!isMe?'<button data-c="report">🚩 Denunciar</button>':''}`;document.body.appendChild(box);box.style.left=Math.min(e.clientX,innerWidth-230)+'px';box.style.top=Math.min(e.clientY,innerHeight-170)+'px';box.onclick=ev=>{const c=ev.target.closest('[data-c]')?.dataset.c;if(c==='profile')profile(id);if(c==='message')window.App.openDM(id);if(c==='local')localNickname(st.activeServerId,id);if(c==='servernick')serverNickname(st.activeServerId,id);if(c==='roles'){box.remove();return editMemberRoles(ev,st.activeServerId,id)}if(c==='addfriend'){api('/api/friends/request',{method:'POST',body:JSON.stringify({username:m.username})}).then(()=>window.App?.toast('Solicitação enviada.','success')).catch(err=>window.App?.toast(err.message,'error'));}if(c==='unfriend'){if(confirm('Remover '+(m.serverNickname||m.displayName||m.username)+' da lista de amigos?'))api('/api/friends/'+id,{method:'DELETE'}).then(()=>{st.friends=(st.friends||[]).filter(f=>String(f.id)!==String(id));window.App.renderFriends();window.App?.toast('Amigo removido.','success')}).catch(err=>window.App?.toast(err.message,'error'));}if(c==='report'){openReportModal(id,m.serverNickname||m.displayName||m.username,{serverId:st.activeServerId});}box.remove()};setTimeout(()=>document.addEventListener('click',()=>box.remove(),{once:true}),0)}
function messageContext(e,id){e.preventDefault();document.querySelector('.wc-context')?.remove();const box=document.createElement('div');box.className='wc-context';const item=e.target.closest('[data-message-id]'),author=item?.dataset.messageAuthorId;const st=window.App?.getState?.();const isOwn=String(author)===String(st?.currentUser?.id);box.innerHTML=`<button data-c="react">😊 Reagir</button><button data-c="copy">📋 Copiar</button>${isOwn?'<button data-c="delete">🗑 Excluir</button>':'<button data-c="report">🚩 Denunciar mensagem</button>'}`;document.body.appendChild(box);box.style.left=Math.min(e.clientX,innerWidth-220)+'px';box.style.top=Math.min(e.clientY,innerHeight-150)+'px';box.onclick=ev=>{const c=ev.target.closest('[data-c]')?.dataset.c;if(c==='react'){const p=document.createElement('div');p.className='wc-reaction-picker';p.innerHTML=['❤️','😂','👍','👎','😮','😢','🔥','🎉','👏','💜','🤔','🚀','🥰','😎','💯','⚡','🌈'].map(x=>`<button data-emoji="${x}">${x}</button>`).join('');document.body.appendChild(p);p.style.left=Math.min(e.clientX,innerWidth-250)+'px';p.style.top=Math.min(e.clientY,innerHeight-90)+'px';p.onclick=x=>{const b=x.target.closest('[data-emoji]');if(b){window.ChatSocket.toggleReaction(id,b.dataset.emoji,r=>{if(r?.error)window.App.toast(r.error,'error')});p.remove();}}}if(c==='copy'){navigator.clipboard?.writeText(item?.querySelector('.message-content')?.innerText||'');box.remove()}if(c==='delete'){item?.querySelector('[data-delete-message]')?.click();box.remove()}if(c==='report'){box.remove();const preview=(item?.querySelector('.message-content')?.innerText||'').slice(0,200);const member=st?.serverMembers?.find(x=>String(x.id)===String(author));const friend=st?.friends?.find(f=>String(f.id)===String(author));const label=member?(member.serverNickname||member.displayName||member.username):(friend?(friend.displayName||friend.username):('usuário #'+author));openReportModal(Number(author),label,{channelId:st?.activeChannelId||null,messageId:Number(id),preview});}};setTimeout(()=>document.addEventListener('click',()=>box.remove(),{once:true}),0)}

async function channelContext(e,id){e.preventDefault();document.querySelector('.wc-context')?.remove();const st=window.App?.getState?.();const c=st?.channels?.find(x=>String(x.id)===String(id));if(!c||!st?.activeServerId)return;const can=String(st.serverOwnerId)===String(st.currentUser?.id)||st.currentUser?.role==='admin';const box=document.createElement('div');box.className='wc-context';box.innerHTML=`<button data-c="read">✅ Marcar como lido</button>${can?'<button data-c="privacy">🔒 Privacidade do canal</button>':''}`;document.body.appendChild(box);box.style.left=Math.min(e.clientX,innerWidth-230)+'px';box.style.top=Math.min(e.clientY,innerHeight-140)+'px';box.onclick=async ev=>{const act=ev.target.closest('[data-c]')?.dataset.c;box.remove();if(act==='read'){window.App?.markChannelRead?.(id);}if(act==='privacy'){const privateNow=confirm(`Canal #${c.name}\n\nOK = privado\nCancelar = público`);const users=privateNow?prompt('IDs de usuários autorizados, separados por vírgula:',(c.permissionOverwrites?.allowedUserIds||[]).join(',')):'';const roles=privateNow?prompt('IDs de cargos autorizados, separados por vírgula:',(c.permissionOverwrites?.allowedRoleIds||[]).join(',')):'';try{await api(`/api/servers/${st.activeServerId}/channels/${id}`,{method:'PUT',body:JSON.stringify({isPrivate:privateNow,permissionOverwrites:{everyone:!privateNow,allowedUserIds:String(users||'').split(',').map(Number).filter(Number.isInteger),allowedRoleIds:String(roles||'').split(',').map(Number).filter(Number.isInteger)}})});window.App?.toast(privateNow?'Canal tornado privado.':'Canal tornado público.','success');await window.App?.openServer?.(st.activeServerId);}catch(err){window.App?.toast(err.message,'error')}}};setTimeout(()=>document.addEventListener('click',()=>box.remove(),{once:true}),0)}
async function serverContext(e,serverId,openServerFn){e.preventDefault();document.querySelector('.wc-context')?.remove();const box=document.createElement('div');box.className='wc-context';box.innerHTML=`<button data-c="settings">⚙️ Configurações do servidor</button><button data-c="read">✅ Marcar como lido</button>`;document.body.appendChild(box);box.style.left=Math.min(e.clientX,innerWidth-230)+'px';box.style.top=Math.min(e.clientY,innerHeight-120)+'px';box.onclick=async ev=>{const act=ev.target.closest('[data-c]')?.dataset.c;box.remove();if(act==='settings'){const st=window.App?.getState?.();if(String(st?.activeServerId)!==String(serverId)){await (openServerFn?openServerFn(serverId):window.App?.openServer?.(serverId));}window.WCServerSettings?.open?.();}if(act==='read'){window.App?.markServerRead?.(serverId);}};setTimeout(()=>document.addEventListener('click',()=>box.remove(),{once:true}),0)}
function bind(){ $('store-btn')?.addEventListener('click',store);$('profile-self-btn')?.addEventListener('click',()=>{const u=window.App?.getState?.()?.currentUser;if(u)profile(u.id)});$('user-bar')?.addEventListener('click',e=>{if(!e.target.closest('button')){const u=window.App?.getState?.()?.currentUser;if(u)profile(u.id)}});$('friend-list')?.addEventListener('contextmenu',e=>{const x=e.target.closest('[data-user-id]');if(x){e.preventDefault();profile(x.dataset.userId)}});$('server-members-list')?.addEventListener('contextmenu',e=>{const x=e.target.closest('[data-member-id]');if(x)memberContext(e,x.dataset.memberId)});$('messages-list')?.addEventListener('contextmenu',e=>{const x=e.target.closest('[data-message-id]');if(x)messageContext(e,x.dataset.messageId)});$('channel-list')?.addEventListener('contextmenu',e=>{const x=e.target.closest('[data-channel-id]');if(x)channelContext(e,x.dataset.channelId)});$('server-list')?.addEventListener('contextmenu',e=>{const x=e.target.closest('[data-server-id]');if(x)serverContext(e,x.dataset.serverId,window.App?.openServer)});
  $('report-evidence-input')?.addEventListener('change',handleReportEvidenceInput);
  $('report-evidence-preview')?.addEventListener('click',e=>{const b=e.target.closest('[data-remove-evidence]');if(!b)return;reportEvidenceMedia.splice(Number(b.dataset.removeEvidence),1);renderReportEvidencePreview();});
  $('report-form')?.addEventListener('submit',e=>{e.preventDefault();const reason=e.target.reason.value.trim();if(!reason)return;submitReport(reason);});
}
document.addEventListener('DOMContentLoaded',bind);

// Botão "mortal" no composer: só existe pra um punhado de usuários (lista
// espelha a checagem feita de verdade no servidor, isso aqui é só pra
// escondê-lo dos outros — não é a segurança real do recurso).
const BACKFLIP_ALLOWLIST=['nanowano','waifaier','desh','neutron'];
function refreshBackflipButton(){
  const btn=$('backflip-btn');if(!btn)return;
  const username=window.App?.getState?.()?.currentUser?.username;
  btn.classList.toggle('hidden',!username||!BACKFLIP_ALLOWLIST.includes(String(username).toLowerCase()));
}
function avatarBackflipTargets(userId){
  const sid=String(userId);
  const nodes=Array.from(document.querySelectorAll(
    '[data-message-author-id="'+sid+'"] .message-avatar, [data-member-id="'+sid+'"] .server-member-avatar, [data-user-id="'+sid+'"] .avatar-decorated, [data-user-id="'+sid+'"] .profile-avatar-decorated'
  ));
  const me=window.App?.getState?.()?.currentUser;
  if(me&&String(me.id)===sid){const own=$('current-user-avatar');if(own)nodes.push(own);}
  if(String(lastProfileId)===sid){const av=$('profile-avatar-view');if(av)nodes.push(av);}
  return nodes;
}
function applyAvatarBackflip(data){
  const userId=data&&data.userId;if(!userId)return;
  avatarBackflipTargets(userId).forEach(node=>{
    if(!node)return;
    node.classList.remove('avatar-backflip');
    void node.offsetWidth;
    node.classList.add('avatar-backflip');
    setTimeout(()=>node.classList.remove('avatar-backflip'),900);
  });
}
document.addEventListener('DOMContentLoaded',()=>{
  refreshBackflipButton();
  setInterval(refreshBackflipButton,1500);
  $('backflip-btn')?.addEventListener('click',()=>{window.ChatSocket?.triggerBackflip?.();});
});
async function adminPanel(){const me=window.App?.getState?.()?.currentUser;if(me?.role!=='admin')return window.App.toast('Acesso administrativo negado.','error');open('modal-admin');const action=async(url,body)=>{try{await api(url,{method:'POST',body:JSON.stringify(body||{})});window.App.toast('Ação aplicada.','success');load()}catch(e){window.App.toast(e.message,'error')}};const effects=[['rainbow','🌈 Rainbow'],['lightning','⚡ Raios'],['rocket','🚀 Foguete'],['confetti','🎊 Confetes'],['shake','📳 Tremor'],['invert','🌓 Inverter'],['matrix','🟩 Matrix'],['fireworks','🎆 Fogos'],['snow','❄️ Neve'],['party','🪩 Festa'],['glitch','👾 Glitch'],['flash','💥 Flash'],['freeze','🧊 Congelar'],['sparkles','✨ Faíscas'],['hearts','💜 Chuva de corações'],['disco','🪩 Disco'],['meteor','☄️ Meteoros'],['pixel','👾 Pixel'],['siren','🚨 Sirene'],['boom','💣 Explosão'],['bubbles','🫧 Bolhas'],['tornado','🌪️ Tornado'],['blackout','🌑 Apagão'],['portal','🌀 Portal'],['stars','🌟 Estrelas'],['wave','🌊 Onda'],['fire','🔥 Inferno'],['ice','🧊 Congelamento'],['vortex','🌀 Vórtice'],['emoji-rain','😎 Chuva de emojis']];async function load(){try{const q=encodeURIComponent($('admin-search').value.trim()),d=await api('/api/admin/users?q='+q);$('admin-users').innerHTML=d.users.map(u=>`<div class="admin-user"><span>${avatar(u)}</span><div><b>${esc(u.displayName||u.username)}</b><small>@${esc(u.username)} · ${(u.points||0).toLocaleString('pt-BR')} pts · ${u.role}${u.wfna?' · WFNA':''}</small></div><div class="admin-actions"><button class="btn btn-small" data-act="p100" data-id="${u.id}">+100</button><button class="btn btn-small" data-act="p1k" data-id="${u.id}">+1K</button><button class="btn btn-small" data-act="p10k" data-id="${u.id}">+10K</button><button class="btn btn-small" data-act="minus" data-id="${u.id}">-500</button><button class="btn btn-small" data-act="setp" data-id="${u.id}">🎯 Pontos</button><button class="btn btn-small" data-act="wfna" data-id="${u.id}">${u.wfna?'🛑 Remover WFNA':'🚀 Dar WFNA'}</button><button class="btn btn-small" data-act="rainbow" data-id="${u.id}">🌈 Modo arco-íris</button><button class="btn btn-small" data-act="scare" data-id="${u.id}">👻 Susto</button>${effects.map(([k,t])=>`<button class="btn btn-small" data-act="fx" data-fx="${k}" data-id="${u.id}">${t}</button>`).join('')}<button class="btn btn-small" data-act="vm5" data-id="${u.id}">🎤 Mute 5m</button><button class="btn btn-small" data-act="vm60" data-id="${u.id}">🎤 Mute 1h</button><button class="btn btn-small" data-act="vmp" data-id="${u.id}">🎤 Mute ∞</button><button class="btn btn-small" data-act="cm5" data-id="${u.id}">💬 Chat 5m</button><button class="btn btn-small" data-act="cm60" data-id="${u.id}">💬 Chat 1h</button><button class="btn btn-small" data-act="cmp" data-id="${u.id}">💬 Chat ∞</button><button class="btn btn-small" data-act="punish" data-id="${u.id}">⚠️ Castigo</button><button class="btn btn-small" data-act="ban10" data-id="${u.id}">🚫 Ban 10m</button><button class="btn btn-small" data-act="ban1d" data-id="${u.id}">🚫 Ban 1d</button><button class="btn btn-small" data-act="banp" data-id="${u.id}">🚫 Ban ∞</button><button class="btn btn-small" data-act="unban" data-id="${u.id}">🔓 Desbanir</button><button class="btn btn-small" data-act="status" data-v="online" data-id="${u.id}">🟢 Online</button><button class="btn btn-small" data-act="status" data-v="away" data-id="${u.id}">🌙 Ausente</button><button class="btn btn-small" data-act="status" data-v="offline" data-id="${u.id}">⚫ Offline</button><button class="btn btn-small" data-act="call" data-id="${u.id}">📵 Derrubar call</button><button class="btn btn-small" data-act="clear" data-id="${u.id}">🧹 Limpar punições</button><button class="btn btn-small" data-act="msgs" data-id="${u.id}">🗑 Limpar mensagens</button><button class="btn btn-small" data-act="shrink" data-id="${u.id}">🐢 Tela encolhendo</button><button class="btn btn-small" data-act="vanish" data-id="${u.id}">🫥 Botões somem</button><button class="btn btn-small" data-act="role" data-id="${u.id}">${u.role==='admin'?'Remover admin':'Promover admin'}</button></div></div>`).join('')||'<div class="empty-state">Nenhum usuário encontrado.</div>';const l=await api('/api/admin/logs');$('admin-logs').innerHTML=l.logs.map(x=>`<div class="admin-log"><b>${esc(x.admin_username||'admin')}</b> → ${esc(x.target_username||'usuário')} · ${esc(x.action)} · ${esc(x.created_at)}</div>`).join('')||'<div class="admin-log">Sem ações.</div>'}catch(e){window.App.toast(e.message,'error')}}$('admin-search-btn').onclick=load;$('admin-search').onkeydown=e=>{if(e.key==='Enter')load()};$('admin-users').onclick=async e=>{const b=e.target.closest('button[data-act]');if(!b)return;const id=b.dataset.id,s='/api/admin/users/'+id;switch(b.dataset.act){case'p100':return action(s+'/points',{delta:100});case'p1k':return action(s+'/points',{delta:1000});case'p10k':return action(s+'/points',{delta:10000});case'minus':return action(s+'/points',{delta:-500});case'setp':{const n=prompt('Quantidade de pontos:','0');if(n!==null)return action(s+'/set-points',{points:Number(n)});break}case'wfna':return action(s+'/wfna',{enabled:!String(b.textContent).includes('Remover')});case'rainbow':return action(s+'/rainbow',{enabled:true,seconds:30});case'scare':return action(s+'/scare');case'fx':return action(s+'/effect',{effect:b.dataset.fx,duration:4});case'vm5':return action(s+'/voice-mute',{minutes:5});case'vm60':return action(s+'/voice-mute',{minutes:60});case'vmp':return action(s+'/voice-mute',{permanent:true});case'cm5':return action(s+'/chat-mute',{minutes:5});case'cm60':return action(s+'/chat-mute',{minutes:60});case'cmp':return action(s+'/chat-mute',{permanent:true});case'punish':return action(s+'/punish',{minutes:30,reason:'Castigo administrativo'});case'ban10':return action(s+'/ban',{minutes:10});case'ban1d':return action(s+'/ban',{minutes:1440});case'banp':return action(s+'/ban',{permanent:true});case'unban':return action(s+'/unban');case'status':return action(s+'/status',{status:b.dataset.v});case'call':return action(s+'/disconnect-call');case'clear':return action(s+'/clear');case'msgs':return action(s+'/clear-messages');case'shrink':return action(s+'/prank',{type:'shrink',duration:60000});case'vanish':return action(s+'/prank',{type:'vanish',duration:45000});case'role':return action(s+'/role',{role:b.textContent.includes('Promover')?'admin':'user'})}};
  async function loadReports(){
    try{
      const status=$('admin-reports-status')?.value||'pending';
      const d=await api('/api/admin/reports?status='+encodeURIComponent(status));
      $('admin-reports').innerHTML=d.reports.map(r=>{
        const resolved=r.status==='resolved';
        const ctx=r.context||{};
        const ctxLine=ctx.preview?`<div class="report-context">Mensagem denunciada: "${esc(ctx.preview)}"</div>`:'';
        const evidence=(r.evidence||[]).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="print" loading="lazy"></a>`).join('');
        const actions=resolved
          ?`<span class="report-resolution">${r.resolution==='ban'?'🚫 Banido':'✅ Ignorada'} por admin</span>`
          :`<button class="btn btn-small btn-danger" data-report-act="ban10" data-id="${r.id}">🚫 Banir 10min</button>`+
           `<button class="btn btn-small btn-danger" data-report-act="ban1d" data-id="${r.id}">🚫 Banir 1 dia</button>`+
           `<button class="btn btn-small btn-danger" data-report-act="banp" data-id="${r.id}">🚫 Banir permanente</button>`+
           `<button class="btn btn-small" data-report-act="dismiss" data-id="${r.id}">✅ Ignorar</button>`;
        return `<div class="report-card">`+
          `<div class="report-card-header"><span class="report-reported">🚩 <b>${esc(r.reportedUser.displayName||r.reportedUser.username)}</b> <small>@${esc(r.reportedUser.username)}</small></span>`+
          `<span class="report-meta">denunciado por @${esc(r.reporter.username)} · ${esc(r.createdAt)}</span></div>`+
          `<div class="report-reason">${esc(r.reason)}</div>`+
          ctxLine+
          (evidence?`<div class="report-evidence">${evidence}</div>`:'')+
          `<div class="report-actions">${actions}</div>`+
        `</div>`;
      }).join('')||'<div class="empty-state">Nenhuma denúncia encontrada.</div>';
    }catch(e){window.App.toast(e.message,'error')}
  }
  $('admin-reports')?.addEventListener('click',async e=>{
    const b=e.target.closest('button[data-report-act]');if(!b)return;
    const id=b.dataset.id,act=b.dataset.reportAct;
    const body=act==='ban10'?{action:'ban',minutes:10}:act==='ban1d'?{action:'ban',minutes:1440}:act==='banp'?{action:'ban',permanent:true}:{action:'dismiss'};
    try{await api('/api/admin/reports/'+id+'/resolve',{method:'POST',body:JSON.stringify(body)});window.App.toast('Denúncia resolvida.','success');loadReports();}
    catch(err){window.App.toast(err.message,'error')}
  });
  $('admin-reports-refresh')?.addEventListener('click',loadReports);
  $('admin-reports-status')?.addEventListener('change',loadReports);

  // ------------------------------------------------------------------
  // Aba "Avisos": manda uma mensagem que aparece pra TODO MUNDO na hora
  // (ver client/js/announcements.js — é ele quem realmente desenha o
  // pop-up; aqui só existe o formulário de envio e a pré-visualização).
  // ------------------------------------------------------------------
  async function loadCurrentAnnouncement(){
    const box=$('admin-announcement-current');if(!box)return;
    try{
      const d=await api('/api/announcements/current');
      const a=d.announcement;
      box.innerHTML=a
        ?`<p class="admin-announcement-current-label">Último aviso enviado</p><div class="admin-announcement-current-card"><b>${esc(a.title)}</b><span>${esc(a.message)}</span><small>${esc(a.createdAt)}</small></div>`
        :'<p class="admin-announcement-current-label">Nenhum aviso foi enviado ainda.</p>';
    }catch(e){box.innerHTML='';}
  }
  $('admin-announcement-form')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const title=$('admin-announcement-title').value.trim(),message=$('admin-announcement-message').value.trim();
    if(!title||!message)return;
    try{
      await api('/api/announcements',{method:'POST',body:JSON.stringify({title,message})});
      window.App.toast('Aviso enviado pra todo mundo.','success');
      $('admin-announcement-form').reset();
      loadCurrentAnnouncement();
    }catch(err){window.App.toast(err.message,'error')}
  });
  $('admin-announcement-preview-btn')?.addEventListener('click',()=>{
    const title=$('admin-announcement-title').value.trim()||'Título do aviso',message=$('admin-announcement-message').value.trim()||'Mensagem do aviso.';
    window.WCAnnouncements?.preview?.({id:'preview',title,message});
  });

  const tabUsers=$('admin-tab-users'),tabReports=$('admin-tab-reports'),tabAnnouncements=$('admin-tab-announcements'),panelUsers=$('admin-panel-users'),panelReports=$('admin-panel-reports'),panelAnnouncements=$('admin-panel-announcements');
  function showTab(tab){
    tabUsers?.classList.toggle('active',tab==='users');
    tabReports?.classList.toggle('active',tab==='reports');
    tabAnnouncements?.classList.toggle('active',tab==='announcements');
    panelUsers?.classList.toggle('hidden',tab!=='users');
    panelReports?.classList.toggle('hidden',tab!=='reports');
    panelAnnouncements?.classList.toggle('hidden',tab!=='announcements');
    if(tab==='reports')loadReports();
    if(tab==='announcements')loadCurrentAnnouncement();
  }
  if(tabUsers&&!tabUsers.dataset.bound){tabUsers.dataset.bound='1';tabUsers.addEventListener('click',()=>showTab('users'));}
  if(tabReports&&!tabReports.dataset.bound){tabReports.dataset.bound='1';tabReports.addEventListener('click',()=>showTab('reports'));}
  if(tabAnnouncements&&!tabAnnouncements.dataset.bound){tabAnnouncements.dataset.bound='1';tabAnnouncements.addEventListener('click',()=>showTab('announcements'));}
  showTab('users');
  load();
}
window.WCFeatures={profile,store,adminPanel,serverContext,openReportModal,applyAvatarBackflip};
})();
