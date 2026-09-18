// ---------------------------------------------------------------------
// Renderizador ÚNICO da identidade visual (avatar + moldura + decoração
// + efeito + aura) — usado por app.js (mensagens/listas), features.js
// (perfil, popovers) e call.js (chamadas). Antes deste arquivo, cada um
// desses três tinha sua PRÓPRIA função de avatar, com uma prioridade
// (profileCustomization vs. campos antigos de loja) sutilmente diferente
// entre si — e call.js não desenhava cosmético nenhum. Resultado: a
// mesma pessoa podia aparecer com moldura/efeito num lugar e sem em
// outro. Esse arquivo resolve isso existindo como a única fonte da
// verdade — adicionar um cosmético novo (ver cosmetics-data.js) não
// exige tocar em nenhuma tela que usa avatares, só nas duas listas de
// dados (aqui embaixo tem zero nomes de efeito "hardcoded").
(function () {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Precedência única: profileCustomization (o editor gratuito em
  // Configurações) manda quando tem um valor setado e diferente de
  // 'none'; senão cai pros campos legados de cima do usuário (frame/
  // decoration, que são o que a loja de pontos grava ao equipar um
  // item). Antes, app.js só olhava os campos legados (nunca aplicava o
  // que a pessoa configurou de graça) e features.js já fazia essa
  // prioridade certa — este é o comportamento que vira padrão em todo
  // lugar agora.
  function mergeCosmetics(entity) {
    if (!entity) return null;
    // 'flat' é onde moram os campos soltos (profileEffect/Enabled, e o
    // frame/decoration legados de antes do profileCustomization existir)
    // — pode vir de 'settings' (perfil próprio, amigos, /profile/:id) OU
    // de 'profileSettings' (é assim que a lista de membros de servidor
    // manda, ver server/models/Server.js listMembers). Sem checar as
    // duas, um usuário com efeito de atmosfera ativo aparecia sem ele
    // especificamente na lista de membros — bug real, pego testando.
    const flat = entity.settings || entity.profileSettings || {};
    const ps = flat.profileCustomization || {};
    const frame = ps.frame && ps.frame !== 'none' ? ps.frame : (entity.frame || '');
    const decoration = ps.decoration && ps.decoration !== 'none' ? ps.decoration : (entity.decoration || '');
    const avatarFx = ps.avatarFx && ps.avatarFx !== 'none' ? ps.avatarFx : '';
    const avatarAura = ps.avatarAura && ps.avatarAura !== 'none' ? ps.avatarAura : '';
    const wfna = !!entity.wfna;
    // Efeito de atmosfera (mini-versão no avatar) e a aura nova são as
    // duas coisas WFNA-exclusivas, igual já era antes pro efeito.
    const atmosphereEffect = wfna && flat.profileEffectEnabled && flat.profileEffect && flat.profileEffect !== 'none' ? flat.profileEffect : '';
    const aura = wfna && avatarAura ? avatarAura : '';
    const color = ps.primary || flat.profileColor || '#5865F2';
    return { frame, decoration, avatarFx, aura, atmosphereEffect, color, wfna };
  }

  function stripPrefix(v, prefix) { return String(v || '').replace(new RegExp('^' + prefix), ''); }

  function readCosmeticsQuality() {
    const st = window.App?.getState?.();
    return st?.currentUser?.settings?.cosmeticsQuality || 'auto';
  }

  // Espelha a preferência de performance no <html data-cq> pra o CSS
  // (style.css: [data-cq="low"]/[data-cq="off"]) e pro particle-engine
  // (que lê o mesmo atributo pra decidir quantas partículas usar) — sem
  // precisar assinar um evento à parte, é barato o bastante pra chamar
  // toda vez que um avatar é desenhado.
  function syncPerfTier() {
    document.documentElement.dataset.cq = readCosmeticsQuality();
  }

  // opts: { size: 'xs'|'sm'|'md'|'lg'|'xl' (default 'md'), context: 'chat'|'list'|'call'|'popover'|'profile'|'preview' (default 'list'), label?: string override }
  function avatarHTML(entity, opts = {}) {
    if (!entity) return '';
    syncPerfTier();
    const size = opts.size || 'md';
    const context = opts.context || 'list';
    const label = opts.label || entity.displayName || entity.username || entity.name || '?';
    const c = mergeCosmetics(entity) || {};
    const inner = entity.avatarUrl
      ? `<img class="avatar-img" src="${esc(entity.avatarUrl)}" alt="${esc(label)}" loading="lazy" decoding="async">`
      : `<span class="avatar-fallback">${esc((label.trim().charAt(0) || '?').toUpperCase())}</span>`;
    const frameClass = c.frame ? ' frame-' + esc(stripPrefix(c.frame, 'frame-')) : '';
    const decorClass = c.decoration ? ' decoration-' + esc(stripPrefix(c.decoration, 'decor-')) : '';
    const effectClass = c.atmosphereEffect ? ' profile-mini-effect-' + esc(c.atmosphereEffect) : '';
    const auraClass = c.aura ? ' avatar-aura-' + esc(c.aura) : '';
    const fxClass = c.avatarFx ? ' avatar-fx-' + esc(c.avatarFx) : '';
    const rocket = c.wfna && context !== 'list' && context !== 'chat' ? '<span class="wfna-profile-rocket" aria-label="WFNA">🚀</span>' : '';
    // A tela de perfil cheia (e o preview ao vivo do editor, que precisa
    // parecer EXATAMENTE com o perfil real) usam a classe wrapper
    // ".profile-avatar-decorated": é nela que os ajustes de tamanho/
    // z-index só-do-perfil em style.css (#modal-profile ...) se prendem.
    // Em qualquer outro contexto (chat, listas, chamada, popover) o
    // wrapper é ".avatar-decorated", pensado pra avatar pequeno.
    const wrapper = (context === 'profile' || context === 'preview') ? 'profile-avatar-decorated' : 'avatar-decorated';
    return `<span class="${wrapper}${frameClass}${decorClass}${effectClass}${auraClass}${fxClass}" data-context="${context}" data-size="${size}" style="--profile-color:${esc(c.color)}">${inner}<i class="avatar-frame-overlay" aria-hidden="true"></i><b class="avatar-decoration-overlay" aria-hidden="true"></b><em class="avatar-effect-overlay" aria-hidden="true"></em><u class="avatar-aura-overlay" aria-hidden="true"></u>${rocket}</span>`;
  }

  // A camada grande de atmosfera (#profile-effect-layer, só existe na
  // tela de perfil cheia — não faz sentido em avatar pequeno). Mantém o
  // motor de partículas de verdade DESLIGADO por padrão (CSS já cobre
  // isso bem) e só liga quando o nível de performance permite ('auto'
  // ou 'high') e o navegador tem canvas — se qualquer coisa falhar, o
  // ::before/CSS que já existia continua a cobrir o visual sozinho.
  function applyAtmosphere(layerEl, effectId, opts = {}) {
    if (!layerEl) return;
    syncPerfTier();
    const active = effectId && effectId !== 'none';
    layerEl.className = 'profile-effect-layer' + (active ? ' profile-effect-' + effectId + ' is-active' : '');
    layerEl.dataset.speed = opts.speed || 'normal';
    layerEl.innerHTML = active ? '<span></span><span></span><span></span>' : '';
    const tier = document.documentElement.dataset.cq;
    const canUseParticles = active && (tier === 'auto' || tier === 'high') && window.WCParticles?.recipes?.includes(effectId);
    if (canUseParticles) {
      const canvas = document.createElement('canvas');
      canvas.className = 'profile-effect-canvas';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      layerEl.appendChild(canvas);
      const handle = window.WCParticles.attach(canvas, effectId, 26);
      if (handle) {
        layerEl.dataset.particleAttached = '1';
        if (!layerEl._wcParticleHandle) layerEl._wcParticleHandle = handle;
        else { layerEl._wcParticleHandle.detach?.(); layerEl._wcParticleHandle = handle; }
      }
    } else if (layerEl._wcParticleHandle) {
      layerEl._wcParticleHandle.detach();
      layerEl._wcParticleHandle = null;
    }
  }

  window.WCIdentity = { avatarHTML, mergeCosmetics, applyAtmosphere, syncPerfTier };
})();
