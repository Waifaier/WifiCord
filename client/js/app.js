// client/js/app.js
// App completo: servidores, canais, amigos, DMs, chat em tempo real,
// digitando, presença e modais.

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMessageContent(text) {
    const raw=String(text??'');
    if(raw.startsWith('__STICKER__:')){
      const stickerRaw=String(raw.slice(12));
      if(/^data:image\//i.test(stickerRaw)||/^https?:\/\//i.test(stickerRaw)){ return '<div class="sticker-message" aria-label="Figurinha"><img src="'+escapeHtml(stickerRaw)+'" alt="Figurinha" loading="lazy"></div>'; }
      const sticker=escapeHtml(stickerRaw); return '<div class="sticker-message" aria-label="Figurinha"><span>'+sticker+'</span></div>';
    }
    if(raw.startsWith('__SUPER__:')){
      const emoji=escapeHtml(raw.slice(10));
      return '<div class="super-emoji-message" data-super-emoji>'+emoji+'</div>';
    }
    if(raw.startsWith('__MEDIA__:')){
      try{
        const m=JSON.parse(raw.slice(10)); const mime=String(m.mime||'application/octet-stream'); const url=escapeHtml(m.url||''); const name=escapeHtml(m.name||'Arquivo');
        if(mime.startsWith('image/')) return '<div class="chat-media"><img src="'+url+'" alt="'+name+'" loading="lazy"></div><a class="media-file-link" href="'+url+'" target="_blank" rel="noopener">'+name+'</a>';
        if(mime.startsWith('video/')) return '<div class="chat-media"><video src="'+url+'" controls preload="metadata"></video></div><a class="media-file-link" href="'+url+'" target="_blank" rel="noopener">'+name+'</a>';
        if(mime.startsWith('audio/')) return '<div class="chat-audio-player"><div class="chat-audio-icon">🎵</div><div class="chat-audio-main"><strong>'+name+'</strong><audio src="'+url+'" controls preload="metadata"></audio></div></div>';
        return '<a class="media-file-card" href="'+url+'" target="_blank" rel="noopener"><span>📎</span><strong>'+name+'</strong><small>'+Math.round(Number(m.size||0)/1024/1024*10)/10+' MB</small></a>';
      }catch(_){return '<span>Arquivo de mídia inválido.</span>';}
    }
    const safe=escapeHtml(raw).replace(/\n/g,'<br>');
    return safe.replace(/(https?:\/\/[^\s<]+)/g,function(u){ const m=u.match(/\/invite\/([a-zA-Z0-9_-]+)/); if(m) return '<a class="server-invite-card" href="#" data-invite="'+m[1]+'">🔗 Convite de servidor <strong>'+m[1]+'</strong></a>'; return '<a href="'+u+'" target="_blank" rel="noopener">'+u+'</a>'; });
  }

  function formatTime(isoString) {
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function getToastContainer() {
    let container = $('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function ensureAdminOverlay(id, className){
    let el=document.getElementById(id); if(el)return el;
    el=document.createElement('div'); el.id=id; el.className=className; document.body.appendChild(el); return el;
  }
  function applyAdminRainbow(data){
    const on=data?.enabled!==false; document.body.classList.toggle('admin-rainbow',on);
    if(data?.until){ const ms=Math.max(0,Number(data.until)-Date.now()); clearTimeout(window.__wcRainbowTimer); window.__wcRainbowTimer=setTimeout(()=>document.body.classList.remove('admin-rainbow'),ms); }
  }
  function applyAdminEffect(data){
    if(state.currentUser?.settings?.overlayEffects===false) return;
    const o=ensureAdminOverlay('admin-effect-overlay','super-effect-overlay'); const effect=String(data?.effect||'flash');
    const icons={rainbow:'🌈',lightning:'⚡',rocket:'🚀',confetti:'🎊',shake:'📳',invert:'🌓',matrix:'🟩',fireworks:'🎆',snow:'❄️',party:'🪩',glitch:'👾',flash:'💥',freeze:'🧊',sparkles:'✨',hearts:'💜',disco:'🪩',meteor:'☄️',pixel:'👾',siren:'🚨',boom:'💣',bubbles:'🫧',tornado:'🌪️',blackout:'🌑',portal:'🌀',stars:'🌟',wave:'🌊',fire:'🔥',ice:'🧊',vortex:'🌀','emoji-rain':'😎'};
    o.dataset.effect=effect; o.innerHTML=`<div class="super-effect-center">${icons[effect]||'💥'}</div>`; o.classList.remove('show'); void o.offsetWidth; o.classList.add('show');
    if(effect==='shake'){document.body.classList.add('wc-screen-shake');setTimeout(()=>document.body.classList.remove('wc-screen-shake'),900)}
    if(['matrix','snow','confetti','fireworks','sparkles','hearts','disco','meteor','pixel','bubbles','stars','wave','fire','ice','vortex','emoji-rain'].includes(effect)){for(let i=0;i<45;i++){const p=document.createElement('i');p.className='effect-particle';p.style.left=(Math.random()*100)+'%';p.style.animationDelay=(Math.random()*.45)+'s';o.appendChild(p)}}
    if(effect==='lightning'){for(let i=0;i<10;i++){const b=document.createElement('i');b.className='lightning-bolt';b.style.left=(Math.random()*95)+'%';b.style.animationDelay=(Math.random()*.25)+'s';o.appendChild(b)}}
    setTimeout(()=>o.classList.remove('show'),Math.max(900,Math.min(Number(data?.duration||4)*1000,6000)));
  }

  function applyAdminScare(data){
    const o=ensureAdminOverlay('admin-scare-overlay','admin-scare-overlay'); o.innerHTML='<div class="admin-scare-symbol">👻</div><div class="admin-scare-text">BOO!</div>'; o.classList.add('show'); window.Sounds?.play?.('notification'); setTimeout(()=>o.classList.remove('show'),Math.max(800,Math.min(Number(data?.duration||3)*1000,5000))); }
  function applyAdminChatMute(data){
    state.adminChatMutedUntil=Number(data?.until||0); renderComposerModeration(); toast('Você foi impedido de enviar mensagens pelo administrador.','error'); }
  function applyAdminPunish(data){ state.adminPunishedUntil=Number(data?.until||0); renderComposerModeration(); toast('Você recebeu um castigo administrativo.','error'); if(state.adminPunishedUntil>0&&state.adminPunishedUntil!==-1)setTimeout(()=>{if(state.adminPunishedUntil===Number(data.until)){state.adminPunishedUntil=0;renderComposerModeration();toast('Seu castigo terminou.','success')}},Math.max(0,state.adminPunishedUntil-Date.now())); }
  function applyAdminBan(data){ toast(data?.until===-1?'Sua conta foi banida permanentemente.':'Sua conta foi banida temporariamente.','error'); setChatEnabled(false); }
  function applyAdminUnban(){ state.adminChatMutedUntil=0; state.adminPunishedUntil=0; renderComposerModeration(); toast('Sua conta foi liberada.','success'); }
  function applyAdminClear(){ state.adminChatMutedUntil=0; state.adminPunishedUntil=0; document.body.classList.remove('admin-rainbow'); renderComposerModeration(); }
  function renderComposerModeration(){ const blocked=(Number(state.adminChatMutedUntil||0)===-1||Number(state.adminChatMutedUntil||0)>Date.now()||Number(state.adminPunishedUntil||0)===-1||Number(state.adminPunishedUntil||0)>Date.now()); if(el.messageInput)el.messageInput.disabled=blocked||!state.activeDMUserId&&!state.activeChannelId; if(el.messageForm){el.messageForm.classList.toggle('moderation-blocked',blocked); const b=el.messageForm.querySelector('button[type=submit]'); if(b)b.disabled=blocked||(!state.activeDMUserId&&!state.activeChannelId);} }
  function toast(message, type) {
    type = type || 'info';
    const container = getToastContainer();
    const item = document.createElement('div');
    item.className = 'toast toast-' + type;
    item.textContent = message;
    container.appendChild(item);
    setTimeout(function () {
      item.classList.add('toast-hide');
      setTimeout(function () {
        item.remove();
      }, 300);
    }, 3500);
  }

  async function api(url, options) {
    options = options || {};
    const opts = Object.assign(
      { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } },
      options
    );

    let res;
    try {
      res = await fetch(url, opts);
    } catch (networkErr) {
      throw new Error('Falha de conexão. Verifique sua internet.');
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        data = null;
      }
    }

    if (!res.ok) {
      throw new Error((data && data.error) || 'Erro na requisição (' + res.status + ')');
    }
    return data;
  }

  function initialFor(label) {
    if (!label) return '?';
    return label.trim().charAt(0).toUpperCase();
  }

  function avatarHtml(entity) {
    if (!entity) return '';
    const label = entity.displayName || entity.username || entity.name || '?';
    const frame = entity.frame || '';
    const decoration = entity.decoration || '';
    const ps = entity.profileSettings || entity.settings || {};
    const effect = entity.wfna && ps.profileEffectEnabled && ps.profileEffect && ps.profileEffect !== 'none' ? ps.profileEffect : '';
    const color = ps.profileColor || '#7c5cff';
    const inner = entity.avatarUrl
      ? '<img class="avatar-img" src="' + escapeHtml(entity.avatarUrl) + '" alt="' + escapeHtml(label) + '">'
      : '<div class="avatar-fallback">' + escapeHtml(initialFor(label)) + '</div>';
    const frameClass = frame ? ' frame-' + escapeHtml(frame.replace(/^frame-/,'') ) : '';
    const decorClass = decoration ? ' decoration-' + escapeHtml(decoration.replace(/^decor-/,'') ) : '';
    const effectClass = effect ? ' profile-mini-effect-' + escapeHtml(effect) : '';
    return '<span class="avatar-decorated'+frameClass+decorClass+effectClass+'" style="--profile-color:'+escapeHtml(color)+'">'+inner+'<span class="avatar-frame-overlay" aria-hidden="true"></span><span class="avatar-decoration-overlay" aria-hidden="true"></span><span class="avatar-effect-overlay" aria-hidden="true"></span>'+(entity.wfna?'<span class="wfna-profile-rocket" aria-hidden="true">🚀</span>':'')+'</span>';
  }
  function statusDotHtml(status) {
    return '<span class="status-dot status-' + escapeHtml(status || 'offline') + '"></span>';
  }

  function setLoading(container, message) {
    if (container) container.innerHTML = '<li class="loading-state">' + escapeHtml(message || 'Carregando...') + '</li>';
  }
  function setEmpty(container, message) {
    if (container) container.innerHTML = '<li class="empty-state">' + escapeHtml(message) + '</li>';
  }
  function setErrorState(container, message) {
    if (container) container.innerHTML = '<li class="error-state">' + escapeHtml(message) + '</li>';
  }

  // ---------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------

  const state = {
    currentUser: null,
    servers: [],
    channels: [],
    friends: [],
    pendingRequests: [],
    activeServerId: null,
    activeChannelId: null,
    activeDMUserId: null,
    typingUsers: new Map(),
    serverMembers: [],
    unreadDMs: new Map(),
    serverRoles: [],
    serverOwnerId: null,
    localNicknames: {},
    adminChatMutedUntil:0, adminPunishedUntil:0, seenMessageIds:new Set(), // userId -> { name, timer }
    typingLocalActive: false,
    typingLocalTimer: null,
  };

  // ---------------------------------------------------------------------
  // Elementos
  // ---------------------------------------------------------------------

  const el = {};

  function cacheElements() {
    Object.assign(el, {
      appScreen: $('app-screen'),
      dmPanel: $('dm-panel'),
      channelsPanel: $('channels-panel'),
      messagesList: $('messages-list'),
      messageForm: $('message-form'),
      messageInput: $('message-input'),
      chatTitle: $('chat-title'),
      chatPeerAvatar: $('chat-peer-avatar'),
      typingIndicator: $('typing-indicator'),
      friendRequestsList: $('friend-requests-list'),
      friendList: $('friend-list'),
      serverList: $('server-list'),
      dmQuickList: $('dm-quick-list'),
      channelList: $('channel-list'),
      activeServerName: $('active-server-name'),
      activeServerInvite: $('active-server-invite'),
      mobileMenuBtn: $('mobile-menu-btn'),
      homeBtn: $('home-btn'),
      addServerBtn: $('add-server-btn'),
      joinServerBtn: $('join-server-btn'),
      addFriendBtn: $('add-friend-btn'),
      addChannelBtn: $('add-channel-btn'),
      logoutBtn: $('logout-btn'),
      settingsBtn: $('settings-btn'),
      settingsLogoutBtn: $('settings-logout-btn'),
      settingsDisplayName: $('settings-display-name'),
      settingsUsername: $('settings-username'),
      modalOverlay: $('modal-overlay'),
      currentUserAvatar: $('current-user-avatar'),
      currentUserStatusDot: $('current-user-status-dot'),
      currentUserName: $('current-user-name'),
      currentUserUsername: $('current-user-username'),
      addFriendForm: $('add-friend-form'),
      createServerForm: $('create-server-form'),
      joinServerForm: $('join-server-form'),
      createChannelForm: $('create-channel-form'),
      avatarInput: $('settings-avatar-input'),
      avatarPreview: $('settings-avatar-preview'),
      soundToggle: $('settings-sound-toggle'),
      membersPanel: $('members-panel'),
      membersList: $('server-members-list'),
      membersCount: $('members-count'),
    });
  }

  // ---------------------------------------------------------------------
  // Modais
  // ---------------------------------------------------------------------

  function openModal(modalId) {
    if (!el.modalOverlay) return;
    document.querySelectorAll('.modal').forEach(function (m) {
      m.classList.add('hidden');
    });
    el.modalOverlay.classList.remove('hidden');
    const modal = $(modalId);
    if (modal) modal.classList.remove('hidden');
  }

  function closeModals() {
    if (!el.modalOverlay) return;
    el.modalOverlay.classList.add('hidden');
    document.querySelectorAll('.modal').forEach(function (m) {
      m.classList.add('hidden');
    });
  }

  function openSettingsModal() {
    if (state.currentUser) {
      if (el.settingsDisplayName) el.settingsDisplayName.value = state.currentUser.displayName || state.currentUser.username || '';
      if (el.settingsUsername) el.settingsUsername.value = '@' + (state.currentUser.username || '');
      const bio=$('settings-bio'); if(bio) bio.value=state.currentUser.bio||''; const st=state.currentUser.status||'online'; document.querySelectorAll('[data-status]').forEach(b=>b.classList.toggle('selected',b.dataset.status===st)); const ste=$('settings-status-text'); if(ste) ste.value=state.currentUser.customStatusText||''; const see=$('settings-status-emoji'); if(see) see.value=state.currentUser.customStatusEmoji||''; const ps=state.currentUser.settings||{}; const pe=$('settings-profile-effect'); if(pe) pe.value=ps.profileEffect||'none'; const pes=$('settings-profile-effect-speed'); if(pes) pes.value=ps.profileEffectSpeed||'normal'; const pee=$('settings-profile-effect-enabled'); if(pee) pee.checked=!!ps.profileEffectEnabled; const pet=$('settings-wfna-effect-status'); if(pet) pet.textContent=state.currentUser.wfna?'WFNA ativo — todos os efeitos estão liberados.':'Ative o WFNA para equipar efeitos animados.'; document.querySelector('.wfna-only-tab')?.classList.toggle('hidden',!state.currentUser.wfna); const pc=$('settings-profile-color'); if(pc) pc.value=ps.profileColor||'#7c5cff'; const pl=$('settings-profile-layout'); if(pl) pl.value=ps.profileLayout||'classic'; const pg=$('settings-profile-glow'); if(pg) pg.value=ps.profileGlow||'none'; const pb=$('settings-profile-badge'); if(pb) pb.value=ps.profileBadge||'none'; const mq=$('settings-media-quality'); if(mq) mq.value=ps.mediaQuality||'auto'; const ap=$('settings-animated-profile'); if(ap) ap.checked=ps.animatedProfile!==false; const im=$('settings-inline-media'); if(im) im.checked=ps.inlineMedia!==false; const ad=$('settings-auto-download'); if(ad) ad.checked=!!ps.autoDownload; const banner=$('settings-profile-banner'); if(banner) banner.style.backgroundImage=state.currentUser.bannerUrl?'url('+state.currentUser.bannerUrl+')':'';
      if (el.avatarPreview) {
        if (state.currentUser.avatarUrl) {
          el.avatarPreview.src = state.currentUser.avatarUrl;
        } else {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#252140"/><text x="48" y="58" text-anchor="middle" fill="#f1eefb" font-size="36" font-family="sans-serif">' +
            escapeHtml(initialFor(state.currentUser.displayName || state.currentUser.username)) + '</text></svg>';
          el.avatarPreview.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        }
      }
    }
    openModal('modal-settings');
    window.Settings?.refreshDevices?.();
    if (el.soundToggle) el.soundToggle.checked = window.Sounds?.isEnabled?.() !== false;
  }

  function switchSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-settings-tab') === tabName);
    });
    document.querySelectorAll('.settings-pane').forEach(function (pane) {
      pane.classList.toggle('active', pane.getAttribute('data-settings-pane') === tabName);
    });
  }

  // ---------------------------------------------------------------------
  // Render: servidores
  // ---------------------------------------------------------------------

  function renderServers() {
    if (!el.serverList) return;
    if (!state.servers.length) {
      el.serverList.innerHTML = '';
      return;
    }
    el.serverList.innerHTML = state.servers
      .map(function (server) {
        const activeClass = server.id === state.activeServerId ? ' active' : '';
        return (
          '<li class="server-item' + activeClass + '" data-server-id="' + escapeHtml(server.id) +
          '" role="button" tabindex="0" title="' + escapeHtml(server.name) + '">' +
          avatarHtml({ name: server.name, avatarUrl: server.iconUrl }) +
          '</li>'
        );
      })
      .join('');
  }

  function renderDMQuickList() {
    if (!el.dmQuickList) return;
    const unreadIds=[...state.unreadDMs.keys()];
    const list = state.friends.filter(f=>unreadIds.includes(String(f.id))).slice(0,12);
    el.dmQuickList.innerHTML = list.map(function(friend){
      const active = String(friend.id)===String(state.activeDMUserId) ? ' active' : '';
      return '<li class="dm-quick-item'+active+'" data-user-id="'+escapeHtml(friend.id)+'" title="'+escapeHtml(friend.displayName||friend.username)+'">'+avatarHtml({name:friend.displayName,username:friend.username,avatarUrl:friend.avatarUrl,frame:friend.frame,decoration:friend.decoration})+statusDotHtml(friend.status)+'</li>';
    }).join('');
  }

  // ---------------------------------------------------------------------
  // Render: canais
  // ---------------------------------------------------------------------

  function renderChannels() {
    if (!el.channelList) return;
    if (!state.channels.length) {
      setEmpty(el.channelList, 'Nenhum canal neste servidor.');
      return;
    }
    el.channelList.innerHTML = state.channels
      .map(function (channel) {
        const activeClass = channel.id === state.activeChannelId ? ' active' : '';
        return (
          '<li class="channel-item' + activeClass + '" data-channel-id="' + escapeHtml(channel.id) + '" data-channel-type="' + escapeHtml(channel.type || 'text') +
          '" role="button" tabindex="0">' +
          '<span class="channel-hash">' + (channel.type === 'voice' ? '🔊' : channel.type === 'announcement' ? '📢' : channel.type === 'media' ? '🖼️' : '#') + '</span><span class="channel-name">' + escapeHtml(channel.name) + '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  // ---------------------------------------------------------------------
  // Render: membros do servidor
  // ---------------------------------------------------------------------
  function memberDisplayName(member) {
    const local = state.localNicknames?.[member.id];
    if (state.currentUser?.settings?.localNicknames !== false && local) return local;
    return member.serverNickname || member.displayName || member.username;
  }
  function renderServerMembers() {
    if (!el.membersList) return;
    if (!state.activeServerId) { el.membersPanel?.classList.add('hidden'); document.getElementById('app-screen')?.classList.remove('with-members'); return; }
    if (state.currentUser?.settings?.showMemberList === false) { el.membersPanel?.classList.add('hidden'); document.getElementById('app-screen')?.classList.remove('with-members'); return; }
    el.membersPanel?.classList.remove('hidden'); document.getElementById('app-screen')?.classList.add('with-members');
    if (el.membersCount) el.membersCount.textContent = String(state.serverMembers.length);
    const groups = new Map();
    state.serverMembers.forEach(m => {
      const roles = Array.isArray(m.roles) && m.roles.length ? [...m.roles].sort((a,b)=>(b.position||0)-(a.position||0)) : [{name:'Membro',color:'#99aab5',position:0}];
      const key = roles[0].id || roles[0].name;
      if (!groups.has(key)) groups.set(key,{role:roles[0],members:[]});
      groups.get(key).members.push(m);
    });
    const html=[];
    groups.forEach(g=>{
      html.push(`<section class="member-role-group"><h4><span>${escapeHtml(g.role.name||'Membros')}</span><small>${g.members.length}</small></h4>`);
      g.members.sort((a,b)=>{if(a.status==='offline'&&b.status!=='offline')return 1;if(a.status!=='offline'&&b.status==='offline')return -1;return memberDisplayName(a).localeCompare(memberDisplayName(b));});
      html.push(g.members.map(m=>{
        const owner=String(m.id)===String(state.serverOwnerId) || (m.roles||[]).some(r=>r.name==='Admin'); const color=(m.roles?.[0]?.color)||g.role.color||'#99aab5';
        return `<div class="server-member-row" data-member-id="${escapeHtml(m.id)}" style="--role-color:${escapeHtml(color)}" title="@${escapeHtml(m.username)}"><div class="server-member-avatar">${avatarHtml(m)}${statusDotHtml(m.status)}</div><div class="server-member-name"><span>${escapeHtml(memberDisplayName(m))}${owner?' <span class="server-owner-crown" title="Dono do servidor">👑</span>':''}</span><small>${m.serverNickname&&state.localNicknames?.[m.id]&&state.currentUser?.settings?.localNicknames!==false?'Servidor: '+escapeHtml(m.serverNickname):'@'+escapeHtml(m.username)}</small></div></div>`;
      }).join(''));
      html.push('</section>');
    });
    el.membersList.innerHTML=html.join('') || '<div class="empty-state">Nenhum membro.</div>';
  }

  // ---------------------------------------------------------------------
  // Render: amigos
  // ---------------------------------------------------------------------

  function renderFriends() {
    if (!el.friendList) return;
    if (!state.friends.length) {
      setEmpty(el.friendList, 'Você ainda não tem amigos.');
      return;
    }
    el.friendList.innerHTML = state.friends
      .map(function (friend) {
        const activeClass = friend.id === state.activeDMUserId ? ' active' : '';
        return (
          '<li class="friend-item' + activeClass + '" data-user-id="' + escapeHtml(friend.id) +
          '" role="button" tabindex="0">' +
          '<div class="avatar-wrap">' +
          avatarHtml(friend) +
          statusDotHtml(friend.status) +
          '</div>' +
          '<div class="friend-meta">' +
          '<span class="friend-name">' + escapeHtml(friend.displayName || friend.username) + '</span>' +
          '<span class="friend-username">@' + escapeHtml(friend.username) + '</span>' +
          '</div></li>'
        );
      })
      .join('');
    renderDMQuickList();
  }

  // ---------------------------------------------------------------------
  // Render: solicitações de amizade
  // ---------------------------------------------------------------------

  function renderFriendRequests() {
    if (!el.friendRequestsList) return;
    if (!state.pendingRequests.length) {
      setEmpty(el.friendRequestsList, 'Nenhuma solicitação pendente.');
      return;
    }
    el.friendRequestsList.innerHTML = state.pendingRequests
      .map(function (req) {
        const from = req.requester || {};
        return (
          '<li class="friend-request-item" data-friendship-id="' + escapeHtml(req.id) + '">' +
          avatarHtml({ name: from.displayName, username: from.username, avatarUrl: from.avatarUrl }) +
          '<span class="friend-request-name">' + escapeHtml(from.displayName || from.username || 'Usuário') + '</span>' +
          '<div class="friend-request-actions">' +
          '<button type="button" class="btn-accept" data-action="accept" data-friendship-id="' + escapeHtml(req.id) + '">Aceitar</button>' +
          '<button type="button" class="btn-reject" data-action="reject" data-friendship-id="' + escapeHtml(req.id) + '">Recusar</button>' +
          '</div></li>'
        );
      })
      .join('');
  }

  // ---------------------------------------------------------------------
  // Render: mensagens
  // ---------------------------------------------------------------------

  function maybeSuperEffect(content) {
    const raw=String(content||''); if(!raw.startsWith('__SUPER__:')) return;
    if(state.currentUser?.settings?.superEmojiEffects===false) return;
    const emoji=raw.slice(10); const map={'🌈':'rainbow','⚡':'lightning','🚀':'rocket','💥':'flash','🔥':'fire','❄️':'snow','🎉':'confetti','💜':'hearts','🌀':'vortex','💀':'skull','😎':'cool','😭':'rain'};
    const effect=map[emoji]||'flash'; const o=ensureAdminOverlay('super-effect-overlay','super-effect-overlay');
    o.innerHTML=''; o.dataset.effect=effect; const center=document.createElement('div'); center.className='super-effect-center'; center.textContent=emoji; o.appendChild(center); o.classList.remove('show'); void o.offsetWidth; o.classList.add('show');
    if(effect==='lightning'){for(let i=0;i<9;i++){const b=document.createElement('i');b.className='lightning-bolt';b.style.left=(8+Math.random()*84)+'%';b.style.animationDelay=(Math.random()*.3)+'s';o.appendChild(b);}}
    if(effect==='confetti'||effect==='rainbow'){for(let i=0;i<28;i++){const p=document.createElement('i');p.className='effect-particle';p.style.left=(Math.random()*100)+'%';p.style.animationDelay=(Math.random()*.4)+'s';o.appendChild(p);}}
    setTimeout(()=>o.classList.remove('show'),1600);
  }

  function reactionHtml(msg) {
    const reactions=Array.isArray(msg.reactions)?msg.reactions:[];
    return '<div class="message-reactions">'+reactions.map(r=>'<button type="button" class="message-reaction'+(r.reacted?' reacted':'')+'" data-reaction-emoji="'+escapeHtml(r.emoji)+'" data-reaction-message="'+escapeHtml(msg.id)+'" title="Reagir com '+escapeHtml(r.emoji)+'">'+escapeHtml(r.emoji)+' <span>'+Number(r.count||0)+'</span></button>').join('')+'</div>';
  }

  function messageItemHtml(msg) {
    const author = msg.author || {};
    const member = state.serverMembers.find(m=>String(m.id)===String(author.id));
    const profileUser = member || state.friends.find(f=>String(f.id)===String(author.id)) || (state.currentUser && String(state.currentUser.id)===String(author.id)?state.currentUser:null);
    const displayAuthor = member ? memberDisplayName(member) : (author.displayName || author.username || 'Usuário');
    const own = state.currentUser && String(author.id) === String(state.currentUser.id);
    return (
      '<li class="message-item' + (own ? ' own' : '') + '" data-message-id="' + escapeHtml(msg.id) + '" data-message-author-id="' + escapeHtml(author.id) + '">' +
      '<div class="message-avatar">' +
      avatarHtml(profileUser || author) +
      '</div>' +
      '<div class="message-body">' +
      '<div class="message-header">' +
      '<span class="message-author">' + escapeHtml(displayAuthor) + (member && String(member.id)===String(state.serverOwnerId)?' 👑':'') + '</span>' +
      '<span class="message-time">' + escapeHtml(formatTime(msg.createdAt)) + '</span>' +
      (own ? '<button type="button" class="message-delete-btn" data-delete-message="' + escapeHtml(msg.id) + '" title="Apagar mensagem" aria-label="Apagar mensagem">🗑️</button>' : '') +
      '</div>' +
      '<div class="message-content">' + formatMessageContent(msg.content) + '</div>' +
      reactionHtml(msg) +
      '</div></li>'
    );
  }

  function renderMessageReactions(messageId,reactions){
    const item=el.messagesList?.querySelector('[data-message-id="'+CSS.escape(String(messageId))+'"]');
    if(!item)return;
    const body=item.querySelector('.message-body'); if(!body)return;
    const old=body.querySelector('.message-reactions'); old?.remove();
    const holder=document.createElement('div'); holder.innerHTML=reactionHtml({id:messageId,reactions}); body.appendChild(holder.firstElementChild);
  }

  function handleMessageReaction(data){ if(data?.messageId) renderMessageReactions(data.messageId,data.reactions||[]); }

  function renderMessages(messages) {
    if (!el.messagesList) return;
    if (!messages || !messages.length) {
      setEmpty(el.messagesList, 'Nenhuma mensagem ainda. Diga oi!');
      return;
    }
    el.messagesList.innerHTML = messages.map(messageItemHtml).join('');
    // Histórico nunca dispara efeitos novamente ao abrir a conversa.
    scrollMessagesToBottom();
  }

  function scrollMessagesToBottom() {
    if (el.messagesList) el.messagesList.scrollTop = el.messagesList.scrollHeight;
  }

  function messageAlreadyRendered(messageId) {
    return !!el.messagesList.querySelector('[data-message-id="' + CSS.escape(String(messageId)) + '"]');
  }

  function appendMessage(msg) {
    if (!el.messagesList) return;
    if (messageAlreadyRendered(msg.id)) return;

    const emptyState = el.messagesList.querySelector('.empty-state');
    if (emptyState) el.messagesList.innerHTML = '';

    el.messagesList.insertAdjacentHTML('beforeend', messageItemHtml(msg));
    maybeSuperEffect(msg.content);
    scrollMessagesToBottom();
  }

  // ---------------------------------------------------------------------
  // Painéis / navegação
  // ---------------------------------------------------------------------

  function showDMPanel() {
    if (el.dmPanel) el.dmPanel.classList.remove('hidden');
    if (el.channelsPanel) el.channelsPanel.classList.add('hidden');
  }

  function showChannelsPanel() {
    if (el.channelsPanel) el.channelsPanel.classList.remove('hidden');
    if (el.dmPanel) el.dmPanel.classList.add('hidden');
  }

  function closeMobileNav() {
    if (el.appScreen) el.appScreen.classList.remove('nav-open');
  }

  function setChatEnabled(enabled) {
    if (el.messageInput) el.messageInput.disabled = !enabled;
    const sendBtn = el.messageForm ? el.messageForm.querySelector('button[type="submit"]') : null;
    if (sendBtn) sendBtn.disabled = !enabled;
    if (window.Call && window.Call.updateCallButtonsState) window.Call.updateCallButtonsState();
  }

  function setActiveServer(serverId) {
    state.activeServerId = serverId;
    state.activeChannelId = null;
    state.activeDMUserId = null;
    state.channels = [];
    if (el.homeBtn) el.homeBtn.classList.remove('active');
    if (el.chatTitle) el.chatTitle.textContent = 'Servidor'; if(el.chatPeerAvatar){el.chatPeerAvatar.classList.add('hidden');el.chatPeerAvatar.innerHTML='';}
    if (el.messagesList) el.messagesList.innerHTML = '<li class="empty-state">Selecione um canal para começar.</li>';
    if (el.channelList) el.channelList.innerHTML = '<li class="loading-state">Carregando canais…</li>';
    renderServers();
    renderDMQuickList();
    window.Call?.syncContext?.();
  }

  function setActiveChannel(channelId) {
    state.activeChannelId = channelId;
    state.activeDMUserId = null;
    renderChannels();
    window.Call?.syncContext?.();
  }

  function setActiveDM(userId) {
    state.activeDMUserId = userId;
    el.membersPanel?.classList.add('hidden'); document.getElementById('app-screen')?.classList.remove('with-members');
    state.activeChannelId = null;
    state.activeServerId = null;
    if (el.homeBtn) el.homeBtn.classList.add('active');
    window.Call?.syncContext?.();
    renderFriends();
    renderServers();
    renderDMQuickList();
    window.Call?.syncContext?.();
  }

  function friendById(userId) {
    return state.friends.find(function (f) {
      return String(f.id) === String(userId);
    });
  }

  function serverById(serverId) {
    return state.servers.find(function (s) {
      return String(s.id) === String(serverId);
    });
  }

  function channelById(channelId) {
    return state.channels.find(function (c) {
      return String(c.id) === String(channelId);
    });
  }

  // ---------------------------------------------------------------------
  // Ações principais
  // ---------------------------------------------------------------------

  async function loadInitialData() {
    try {
      const [friendsData, pendingData, serversData] = await Promise.all([
        api('/api/friends'),
        api('/api/friends/pending'),
        api('/api/servers'),
      ]);

      state.friends = (friendsData && friendsData.friends) || [];
      state.pendingRequests = (pendingData && pendingData.received) || [];
      state.servers = (serversData && serversData.servers) || [];

      renderFriends();
      renderFriendRequests();
      renderServers();
      showDMPanel();
    } catch (err) {
      toast(err.message || 'Erro ao carregar dados iniciais.', 'error');
    }
  }

  async function openServer(serverId) {
    setActiveServer(serverId);
    showChannelsPanel();
    closeMobileNav();
    state.activeDMUserId = null;
    state.activeChannelId = null;
    if (el.chatTitle) el.chatTitle.textContent = 'Carregando servidor…';
    if (el.messagesList) el.messagesList.innerHTML = '<li class="loading-state">Selecione um canal…</li>';
    setChatEnabled(false);
    setLoading(el.channelList, 'Carregando canais...');

    const server = serverById(serverId);
    if (el.activeServerName) el.activeServerName.textContent = server ? server.name : 'Servidor';
    if (el.activeServerInvite) el.activeServerInvite.textContent = server ? server.inviteCode : '—';

    window.ChatSocket.joinServer(serverId);

    try {
      const [data,membersData] = await Promise.all([
        api('/api/servers/' + encodeURIComponent(serverId) + '/channels'),
        api('/api/servers/' + encodeURIComponent(serverId) + '/members')
      ]);
      state.channels = (data && data.channels) || [];
      state.serverMembers = membersData?.members || [];
      state.serverRoles = membersData?.roles || [];
      state.serverOwnerId = membersData?.ownerId || null;
      state.localNicknames = membersData?.localNicknames || {};
      renderChannels(); renderServerMembers();
      if (String(state.activeServerId) === String(serverId) && state.channels.length) {
        await openChannel(state.channels[0].id);
      } else if (!state.channels.length && el.chatTitle) {
        el.chatTitle.textContent = 'Nenhum canal disponível';
      }
    } catch (err) {
      setErrorState(el.channelList, 'Não foi possível carregar os canais.');
      toast(err.message || 'Erro ao carregar canais.', 'error');
    }
  }

  async function openChannel(channelId, options) {
    options = options || {};
    setActiveChannel(channelId);
    closeMobileNav();
    setLoading(el.messagesList, 'Carregando mensagens...');
    clearTypingIndicator();
    setChatEnabled(true);

    const channel = channelById(channelId);
    if (el.chatTitle) el.chatTitle.textContent = '# ' + (channel ? channel.name : ''); if(el.chatPeerAvatar){el.chatPeerAvatar.classList.add('hidden');el.chatPeerAvatar.innerHTML='';}
    renderChannels();

    window.ChatSocket.joinChannel(channelId);

    // Canais de voz são a única porta de entrada para chamadas de servidor.
    // A seleção automática do primeiro canal não inicia uma chamada; somente
    // um clique explícito em um canal de voz pode fazê-lo.
    if (channel?.type === 'voice') {
      if (el.messagesList) setEmpty(el.messagesList, '🔊 Canal de voz — entre para participar da chamada.');
      setChatEnabled(false);
      if (options.joinVoice && window.Call?.startServerCall && state.activeServerId) {
        await window.Call.startServerCall(state.activeServerId, channelId, 'audio');
      }
      return;
    }

    try {
      const data = await api('/api/messages/channel/' + encodeURIComponent(channelId));
      renderMessages((data && data.messages) || []);
    } catch (err) {
      setErrorState(el.messagesList, 'Não foi possível carregar as mensagens.');
      toast(err.message || 'Erro ao carregar mensagens do canal.', 'error');
    }
  }

  async function openDM(userId) {
    state.unreadDMs.delete(String(userId));
    renderDMQuickList();
    setActiveDM(userId);
    showDMPanel();
    closeMobileNav();
    setLoading(el.messagesList, 'Carregando mensagens...');
    clearTypingIndicator();
    setChatEnabled(true);

    const friend = friendById(userId);
    if (el.chatTitle) el.chatTitle.textContent = friend ? (friend.displayName || friend.username) : 'Conversa'; if(el.chatPeerAvatar){el.chatPeerAvatar.innerHTML=friend?avatarHtml(friend):'';el.chatPeerAvatar.classList.toggle('hidden',!friend);}

    window.ChatSocket.joinDM(userId);

    // A conexão em tempo real não pode impedir o carregamento da conversa.
    // Também protegemos contra uma resposta antiga sobrescrever uma DM nova.
    const requestedUserId = String(userId);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await api('/api/messages/dm/' + encodeURIComponent(userId));
        if (String(state.activeDMUserId) === requestedUserId && !state.activeChannelId) {
          renderMessages((data && data.messages) || []);
        }
        return;
      } catch (err) {
        lastError = err;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
      }
    }

    if (String(state.activeDMUserId) === requestedUserId && !state.activeChannelId) {
      setErrorState(el.messagesList, 'Não foi possível carregar a conversa.');
      toast((lastError && lastError.message) || 'Erro ao carregar DM.', 'error');
    }
  }

  async function respondFriendRequest(friendshipId, accept) {
    try {
      await api('/api/friends/' + encodeURIComponent(friendshipId) + '/respond', {
        method: 'POST',
        body: JSON.stringify({ accept: accept }),
      });

      const [friendsData, pendingData] = await Promise.all([api('/api/friends'), api('/api/friends/pending')]);
      state.friends = (friendsData && friendsData.friends) || [];
      state.pendingRequests = (pendingData && pendingData.received) || [];
      renderFriends();
      renderFriendRequests();

      toast(accept ? 'Solicitação aceita.' : 'Solicitação recusada.', 'success');
    } catch (err) {
      toast(err.message || 'Erro ao responder solicitação.', 'error');
    }
  }

  async function sendFriendRequest(username) {
    try {
      await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username: username }) });
      toast('Solicitação enviada.', 'success');
      closeModals();
    } catch (err) {
      toast(err.message || 'Erro ao enviar solicitação.', 'error');
    }
  }

  async function createServer(name) {
    try {
      const data = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name: name }) });
      state.servers.push(data.server);
      renderServers();
      closeModals();
      toast('Servidor criado.', 'success');
      openServer(data.server.id);
    } catch (err) {
      toast(err.message || 'Erro ao criar servidor.', 'error');
    }
  }

  async function joinServerByCode(inviteCode) {
    try {
      const data = await api('/api/servers/join', { method: 'POST', body: JSON.stringify({ inviteCode: inviteCode }) });
      if (!serverById(data.server.id)) state.servers.push(data.server);
      renderServers();
      closeModals();
      toast('Você entrou no servidor.', 'success');
      openServer(data.server.id);
    } catch (err) {
      toast(err.message || 'Erro ao entrar no servidor.', 'error');
    }
  }

  async function createChannel(name, options={}) {
    if (!state.activeServerId) {
      toast('Selecione um servidor primeiro.', 'error');
      return;
    }
    try {
      const data = await api('/api/servers/' + encodeURIComponent(state.activeServerId) + '/channels', {
        method: 'POST',
        body: JSON.stringify({ name: name, type: options.type, isPrivate: !!options.isPrivate, allowedUserIds: options.allowedUserIds||[], allowedRoleIds: options.allowedRoleIds||[], topic: options.topic||'', slowmodeSeconds: Number(options.slowmodeSeconds)||0 }),
      });
      state.channels.push(data.channel);
      renderChannels();
      closeModals();
      toast('Canal criado.', 'success');
    } catch (err) {
      toast(err.message || 'Erro ao criar canal.', 'error');
    }
  }

  // ---------------------------------------------------------------------
  // Envio de mensagens (Socket.IO)
  // ---------------------------------------------------------------------

  function sendCurrentMessage() {
    const content = el.messageInput ? el.messageInput.value.trim() : '';
    if (!content) return;
    if (content.length > 2000) {
      toast('Mensagem muito longa (máximo 2000 caracteres).', 'error');
      return;
    }
    if (!state.activeChannelId && !state.activeDMUserId) {
      toast('Selecione um canal ou uma conversa primeiro.', 'error');
      return;
    }

    stopTypingLocal();

    function handleAck(result) {
      if (result && result.error) {
        toast(result.error, 'error');
        return;
      }
      if (result && result.message) appendMessage(result.message);
    }

    if (state.activeChannelId) {
      window.ChatSocket.sendChannelMessage(state.activeChannelId, content, handleAck);
    } else if (state.activeDMUserId) {
      window.ChatSocket.sendDMMessage(state.activeDMUserId, content, handleAck);
    }

    el.messageInput.value = '';
    el.messageInput.style.height = 'auto';
  }

  function handleIncomingMessage(msg, kind) {
    const belongsToActiveChannel = kind === 'channel' && String(msg.channelId) === String(state.activeChannelId);
    const belongsToActiveDM =
      kind === 'dm' &&
      state.activeDMUserId &&
      (String(msg.author.id) === String(state.activeDMUserId) || String(msg.toUserId) === String(state.activeDMUserId));

    const isOwn = state.currentUser && String(msg.author?.id) === String(state.currentUser.id);
    const key=String(msg.id);
    const already=state.seenMessageIds.has(key)||messageAlreadyRendered(msg.id);
    state.seenMessageIds.add(key);
    if(state.seenMessageIds.size>2000){const first=state.seenMessageIds.values().next().value;state.seenMessageIds.delete(first);}
    if (belongsToActiveChannel || belongsToActiveDM) {
      appendMessage(msg);
    }
    if (!isOwn && !already) {
      window.Sounds?.play('message');
      if (kind === 'dm' && !belongsToActiveDM) {
        const author = msg.author || {};
        window.App?.showIncomingDMNotice?.(author);
      }
    }
  }

  function showIncomingDMNotice(author){
    if(!author)return;
    const id=String(author.id); state.unreadDMs.set(id,Date.now()); renderDMQuickList();
    let n=document.getElementById('incoming-dm-notice');
    if(!n){n=document.createElement('button');n.id='incoming-dm-notice';n.className='incoming-dm-notice';document.body.appendChild(n);}
    const richer=friendById(author.id)||author; n.innerHTML=avatarHtml(richer)+'<span><b>'+escapeHtml(author.displayName||author.username||'Usuário')+'</b><small>Nova mensagem</small></span>';
    n.onclick=()=>window.App?.openDM?.(author.id); n.classList.remove('show'); void n.offsetWidth; n.classList.add('show');
    clearTimeout(window.__wcIncomingNoticeTimer); window.__wcIncomingNoticeTimer=setTimeout(()=>n.classList.remove('show'),4500);
  }

  function handleMessageDeleted(data) {
    if (!data?.messageId || !el.messagesList) return;
    const item = el.messagesList.querySelector('[data-message-id="' + CSS.escape(String(data.messageId)) + '"]');
    if (item) {
      item.classList.add('message-deleting');
      setTimeout(() => item.remove(), 180);
    }
  }

  function handleProfileUpdate(data) {
    const user = data?.user;
    if (!user) return;
    if (state.currentUser && String(user.id) === String(state.currentUser.id)) {
      state.currentUser = user;
      updateUserBar();
    }
    const friend = friendById(user.id);
    if (friend) Object.assign(friend, user);
    renderFriends();
    renderDMQuickList();

    // Existing messages use the avatar captured at send time; refresh the
    // visible message avatars so profile changes are reflected immediately.
    if (el.messagesList) {
      el.messagesList.querySelectorAll('.message-item').forEach(item => {
        const id = item.getAttribute('data-message-author-id');
        if (String(id) !== String(user.id)) return;
        const avatar = item.querySelector('.message-avatar');
        if (avatar) avatar.innerHTML = avatarHtml(user);
      });
    }
  }

  function toggleReaction(messageId, emoji){
    if(!messageId||!emoji)return;
    window.ChatSocket.toggleReaction(messageId,emoji,result=>{if(result?.error)toast(result.error,'error');});
  }

  function deleteMessage(messageId) {
    if (!messageId) return;
    window.ChatSocket.deleteMessage(messageId, result => {
      if (result?.error) toast(result.error, 'error');
    });
  }

  // ---------------------------------------------------------------------
  // Digitando
  // ---------------------------------------------------------------------

  function typingTargetPayload() {
    if (state.activeChannelId) return { channelId: state.activeChannelId };
    if (state.activeDMUserId) return { toUserId: state.activeDMUserId };
    return null;
  }

  function startTypingLocal() {
    const payload = typingTargetPayload();
    if (!payload) return;

    if (!state.typingLocalActive) {
      state.typingLocalActive = true;
      window.ChatSocket.typingStart(payload);
    }

    clearTimeout(state.typingLocalTimer);
    state.typingLocalTimer = setTimeout(stopTypingLocal, 2500);
  }

  function stopTypingLocal() {
    const payload = typingTargetPayload();
    clearTimeout(state.typingLocalTimer);
    if (state.typingLocalActive && payload) {
      window.ChatSocket.typingStop(payload);
    }
    state.typingLocalActive = false;
  }

  function renderTypingIndicator() {
    if (!el.typingIndicator) return;
    const names = Array.from(state.typingUsers.values()).map(function (v) {
      return v.name;
    });
    if (!names.length) {
      el.typingIndicator.textContent = '';
      return;
    }
    const verb = names.length === 1 ? 'está digitando...' : 'estão digitando...';
    el.typingIndicator.textContent = names.join(', ') + ' ' + verb;
  }

  function clearTypingIndicator() {
    state.typingUsers.forEach(function (v) {
      clearTimeout(v.timer);
    });
    state.typingUsers.clear();
    renderTypingIndicator();
  }

  function handleTyping(data, isTyping) {
    if (!data) return;
    const belongsToChannel = data.channelId && String(data.channelId) === String(state.activeChannelId);
    const belongsToDM = data.fromUserId && String(data.fromUserId) === String(state.activeDMUserId);
    if (!belongsToChannel && !belongsToDM) return;

    const userId = data.userId || data.fromUserId;
    if (state.currentUser && String(userId) === String(state.currentUser.id)) return;

    if (isTyping) {
      const friend = friendById(userId);
      const name = friend ? friend.displayName || friend.username : 'Alguém';
      const existing = state.typingUsers.get(userId);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(function () {
        state.typingUsers.delete(userId);
        renderTypingIndicator();
      }, 4000);
      state.typingUsers.set(userId, { name: name, timer: timer });
    } else {
      const existing = state.typingUsers.get(userId);
      if (existing) clearTimeout(existing.timer);
      state.typingUsers.delete(userId);
    }
    renderTypingIndicator();
  }

  // ---------------------------------------------------------------------
  // Presença
  // ---------------------------------------------------------------------

  function handlePresenceUpdate(data) {
    if (!data) return;
    const friend = friendById(data.userId);
    if (friend) {
      friend.status = data.status;
      renderFriends();
    }
    if (state.currentUser && String(data.userId) === String(state.currentUser.id)) {
      state.currentUser.status = data.status;
      updateUserBar();
    }
  }

  function updateUserBar() {
    if (!state.currentUser) return;
    const u = state.currentUser;
    if (el.currentUserAvatar) {
      el.currentUserAvatar.innerHTML = avatarHtml(u);
    }
    if (el.currentUserStatusDot) {
      el.currentUserStatusDot.className = 'status-dot status-' + (u.status || 'online');
    }
    if (el.currentUserName) el.currentUserName.textContent = u.displayName || u.username;
    if (el.currentUserUsername) el.currentUserUsername.textContent = '@' + u.username;
    const adminBtn=document.getElementById('admin-btn'); if(adminBtn){ adminBtn.classList.toggle('hidden',u.role!=='admin'); if(u.role==='admin'&&!adminBtn.dataset.bound){adminBtn.dataset.bound='1';adminBtn.onclick=()=>window.WCFeatures?.adminPanel?.();} }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.type)) {
      toast('Escolha PNG, JPG, GIF ou WebP.', 'error');
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('A imagem deve ter no máximo 2 MB.', 'error');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        let dataUrl = reader.result;
        // Compress raster images while preserving GIFs.
        if (file.type !== 'image/gif' && file.size > 700 * 1024) {
          dataUrl = await resizeAvatar(dataUrl);
        }
        const result = await api('/api/auth/avatar', {
          method: 'POST',
          body: JSON.stringify({ avatar: dataUrl }),
        });
        if (result?.user) {
          state.currentUser = result.user;
          updateUserBar();
          if (el.avatarPreview) el.avatarPreview.src = result.user.avatarUrl;
          toast('Foto de perfil atualizada.', 'success');
        }
      } catch (err) {
        toast(err.message || 'Não foi possível atualizar a foto.', 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  function resizeAvatar(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const size = Math.min(640, Math.max(img.width, img.height));
        const scale = size / Math.max(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.82));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------

  function bindEvents() {
    if (el.serverList) {
      el.serverList.addEventListener('click', function (e) {
        const item = e.target.closest('[data-server-id]');
        if (item) openServer(item.getAttribute('data-server-id'));
      });
    }

    if (el.channelList) {
      el.channelList.addEventListener('click', function (e) {
        const item = e.target.closest('[data-channel-id]');
        if (item) openChannel(item.getAttribute('data-channel-id'), {joinVoice:true});
      });
    }

    if (el.dmQuickList) {
      el.dmQuickList.addEventListener('click', function (e) {
        const item=e.target.closest('[data-user-id]'); if(item) openDM(item.getAttribute('data-user-id'));
      });
    }

    if (el.friendList) {
      el.friendList.addEventListener('click', function (e) {
        const item = e.target.closest('[data-user-id]');
        if (item) openDM(item.getAttribute('data-user-id'));
      });
    }

    if (el.friendRequestsList) {
      el.friendRequestsList.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const friendshipId = btn.getAttribute('data-friendship-id');
        respondFriendRequest(friendshipId, btn.getAttribute('data-action') === 'accept');
      });
    }

    if (el.homeBtn) {
      el.homeBtn.addEventListener('click', function () {
        state.activeServerId = null;
        state.activeChannelId = null;
        state.activeDMUserId = null;
        el.homeBtn.classList.add('active');
        el.membersPanel?.classList.add('hidden'); document.getElementById('app-screen')?.classList.remove('with-members');
        renderServers();
        renderDMQuickList();
        showDMPanel();
        closeMobileNav();
        if (el.chatTitle) el.chatTitle.textContent = 'Selecione uma conversa';
        setChatEnabled(false);
      });
    }

    if (el.mobileMenuBtn) {
      el.mobileMenuBtn.addEventListener('click', function () {
        if (el.appScreen) el.appScreen.classList.toggle('nav-open');
      });
    }

    if (el.addFriendBtn) el.addFriendBtn.addEventListener('click', function () { openModal('modal-add-friend'); });
    if (el.addServerBtn) el.addServerBtn.addEventListener('click', function () { openModal('modal-create-server'); });
    if (el.joinServerBtn) el.joinServerBtn.addEventListener('click', function () { openModal('modal-join-server'); });
    if (el.addChannelBtn) {
      el.addChannelBtn.addEventListener('click', function () {
        if (!state.activeServerId) {
          toast('Selecione um servidor primeiro.', 'error');
          return;
        }
        openModal('modal-create-channel');
      });
    }

    if (el.modalOverlay) {
      el.modalOverlay.addEventListener('click', function (e) {
        if (e.target === el.modalOverlay) closeModals();
      });
      el.modalOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-close-modal]')) closeModals();
      });
    }

    if (el.addFriendForm) {
      el.addFriendForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const username = e.target.username.value.trim();
        if (!username) return;
        sendFriendRequest(username);
        e.target.reset();
      });
    }

    if (el.createServerForm) {
      el.createServerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return;
        createServer(name);
        e.target.reset();
      });
    }

    if (el.joinServerForm) {
      el.joinServerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const code = e.target.inviteCode.value.trim();
        if (!code) return;
        joinServerByCode(code);
        e.target.reset();
      });
    }

    if (el.createChannelForm) {
      el.createChannelForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return;
        const csv = v => String(v||'').split(',').map(x=>Number(x.trim())).filter(Number.isInteger);
        createChannel(name,{type:e.target.type.value,isPrivate:e.target.isPrivate.checked,allowedUserIds:csv(e.target.allowedUserIds.value),allowedRoleIds:csv(e.target.allowedRoleIds.value),topic:e.target.topic.value,slowmodeSeconds:e.target.slowmodeSeconds.value});
        e.target.reset();
      });
    }

    if (el.logoutBtn) {
      el.logoutBtn.addEventListener('click', function () {
        window.Auth && window.Auth.logout();
      });
    }

    if (el.settingsBtn) el.settingsBtn.addEventListener('click', openSettingsModal);
    if (el.settingsLogoutBtn) {
      el.settingsLogoutBtn.addEventListener('click', function () {
        window.Auth && window.Auth.logout();
      });
    }

    document.querySelectorAll('.settings-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchSettingsTab(btn.getAttribute('data-settings-tab'));
      });
    });

    if (el.messagesList) {
      el.messagesList.addEventListener('click', function (e) {
        const reaction=e.target.closest('[data-reaction-emoji][data-reaction-message]');
        if(reaction){e.preventDefault();e.stopPropagation();toggleReaction(reaction.dataset.reactionMessage,reaction.dataset.reactionEmoji);return;}
        const btn = e.target.closest('[data-delete-message]');
        if (btn) deleteMessage(btn.getAttribute('data-delete-message'));
      });
    }

    if (el.avatarInput) {
      el.avatarInput.addEventListener('change', uploadAvatar);
    }

    if (el.soundToggle) {
      el.soundToggle.checked = window.Sounds?.isEnabled?.() !== false;
      el.soundToggle.addEventListener('change', () => window.Sounds?.setEnabled(el.soundToggle.checked));
    }

    if (el.messageForm) {
      el.messageForm.addEventListener('submit', function (e) {
        e.preventDefault();
        sendCurrentMessage();
      });
    }

    if (el.messageInput) {
      el.messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendCurrentMessage();
        }
      });

      el.messageInput.addEventListener('input', function () {
        el.messageInput.style.height = 'auto';
        el.messageInput.style.height = Math.min(el.messageInput.scrollHeight, 140) + 'px';
        if (el.messageInput.value.trim()) {
          startTypingLocal();
        } else {
          stopTypingLocal();
        }
      });
    }
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  async function init(user) {
    state.currentUser = user;
    if(user?.settings){ if(user.settings.accent){document.documentElement.style.setProperty('--accent',user.settings.accent);localStorage.setItem('wc-accent',user.settings.accent);} document.body.classList.toggle('compact',!!user.settings.compact); document.body.classList.toggle('reduce-motion',!!user.settings.reduceMotion); }
    cacheElements();
    updateUserBar();
    setChatEnabled(false);
    bindEvents();
    if (window.Call && window.Call.init) window.Call.init();
    window.Settings?.init?.();
    window.ChatSocket.connect();
    await loadInitialData();
  }

  async function refreshFriendsRealtime() {
    try {
      const [friendsData, pendingData] = await Promise.all([
        api('/api/friends'),
        api('/api/friends/pending'),
      ]);
      state.friends = (friendsData && friendsData.friends) || [];
      state.pendingRequests = (pendingData && pendingData.received) || [];
      renderFriends();
      renderFriendRequests();
      renderDMQuickList();
    } catch (_) {
      // O próximo evento/reconexão fará uma nova sincronização.
    }
  }

  function handleServerProfileUpdate(server){if(!server)return;const x=state.servers.find(s=>String(s.id)===String(server.id));if(x)Object.assign(x,server);if(String(state.activeServerId)===String(server.id)){if(el.activeServerName)el.activeServerName.textContent=server.name||el.activeServerName.textContent;}renderServers();}

  window.App = {
    init: init,
    toast: toast,
    openChannel: openChannel,
    openDM: openDM,
    renderMessages: renderMessages,
    renderServers: renderServers,
    renderChannels: renderChannels,
    renderFriends: renderFriends,
    renderFriendRequests: renderFriendRequests,
    renderServerMembers: renderServerMembers,
    handleServerProfileUpdate: handleServerProfileUpdate,
    setServerMembers: (data)=>{state.serverMembers=data.members||[];state.serverRoles=data.roles||[];state.serverOwnerId=data.ownerId||null;state.localNicknames=data.localNicknames||state.localNicknames;renderServerMembers();},
    setActiveServer: setActiveServer,
    setActiveChannel: setActiveChannel,
    setActiveDM: setActiveDM,
    handleIncomingMessage: handleIncomingMessage,
    showIncomingDMNotice: showIncomingDMNotice,
    handleMessageDeleted: handleMessageDeleted,
    handleMessageReaction,
    handleProfileUpdate: handleProfileUpdate,
    handleTyping: handleTyping,
    handlePresenceUpdate: handlePresenceUpdate,
    refreshFriendsRealtime: refreshFriendsRealtime,
    applyAdminChatMute: applyAdminChatMute, applyAdminPunish: applyAdminPunish, applyAdminBan: applyAdminBan, applyAdminUnban: applyAdminUnban, applyAdminRainbow: applyAdminRainbow, applyAdminScare: applyAdminScare, applyAdminEffect: applyAdminEffect, applyAdminClear: applyAdminClear,
    getState: function () {
      return state;
    },
  };
})();
