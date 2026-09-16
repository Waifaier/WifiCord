// Aplicação: login, menus, lobby, perfil, inventário/loja, configurações e resultados.
import { api, setToken, token } from './api.js';
import { $, $$, el, showScreen, previousScreen, currentScreen, toast, modal, setupTabs, fmtTime, PLAYER_COLORS } from './ui.js';
import { settings, isTouchDevice } from './settings.js';
import { audio } from './audio.js';
import { Input } from './input.js';
import { VoiceChat } from './voice.js';
import { Game } from './game.js';
import { Minigame, SCENES, hasSeenMinigame } from './minigame.js';
// Caminhos absolutos porque o jogo é servido a partir de /jogos/meia-lua/
// dentro do WifiCord (ver server/integration.js no WifiCord).
import { ITEMS, EQUIP_SLOTS, SLOT_NAMES, SHOP_ITEMS } from '/jogos/meia-lua/shared/items.js';
import { ATTRIBUTES, ATTR_NAMES, ATTR_DESC, ATTR_MAX } from '/jogos/meia-lua/shared/rpg.js';
import { NIGHTS, FINAL_NIGHT, DIFFICULTIES, DEFAULT_DIFFICULTY } from '/jogos/meia-lua/shared/nights.js';
import { loadAssets } from './assets.js';

class App {
  constructor() {
    this.profile = null;
    this.room = null;
    this.socket = null;
    this.config = { maxPlayersPerRoom: 4, iceServers: [] };
    this.input = new Input();
    this.input.setupTouch($('#touch'));
    setupTabs();
    this.bindMenus();
    this.renderSettings();
    document.body.classList.toggle('no-crt', !settings.crt);
    document.addEventListener('pointerdown', () => audio.unlock(), { once: false });
    this.boot();
  }

  async boot() {
    try { this.config = await api('/config'); } catch { /* offline? */ }
    await loadAssets();
    showScreen('auth', { push: false });
    // Login único: quem já está logado no WifiCord entra aqui sem tela de
    // convidado/senha nenhuma. O fetch pra /api/meia-lua/session (ver
    // client/js/api.js) já manda o cookie de sessão do WifiCord sozinho
    // (mesma origem) — o servidor confere lá se a conta existe, não está
    // banida, e devolve (ou cria na hora) um token do Meia-Lua vinculado
    // a ela. Sem sessão válida do WifiCord, não tem como entrar: mostramos
    // o erro aqui mesmo, nunca caímos pra alguma tela de login do jogo
    // (ela nem existe mais — ver index.html).
    try {
      const { token: t } = await api('/session');
      setToken(t);
    } catch (err) {
      this.showEmbedError(err?.status === 401
        ? 'Sua sessão do WifiCord expirou. Feche e abra a aba Jogos de novo.'
        : (err?.message || 'Não foi possível entrar no jogo.'));
      return;
    }
    try {
      await this.loadProfile();
      this.connect();
      showScreen('menu', { push: false });
    } catch (err) {
      setToken(null);
      this.showEmbedError(err?.message || 'Não foi possível carregar seu perfil.');
    }
  }

  showEmbedError(message) {
    $('#embed-status').textContent = 'Não foi possível conectar.';
    $('#auth-error').textContent = message;
    const retry = $('#btn-embed-retry');
    retry.hidden = false;
    retry.onclick = () => {
      retry.hidden = true;
      $('#embed-status').textContent = 'Conectando com a sua conta do WifiCord…';
      $('#auth-error').textContent = '';
      this.boot();
    };
  }

  async loadProfile() {
    const r = await api('/profile');
    this.profile = r.profile;
    this.renderMenuPlayer();
    return r;
  }

  // ================================================================ socket
  connect() {
    if (this.socket) this.socket.disconnect();
    // Namespace próprio '/meia-lua' no mesmo servidor Socket.IO do WifiCord
    // (o chat/chamadas usam o namespace padrão '/') — path do transporte
    // continua o padrão (/socket.io), só muda o namespace.
    const s = this.socket = window.io('/meia-lua', { auth: { token: token() }, transports: ['websocket', 'polling'] });
    s.on('connect', () => { $('#conn-banner').hidden = true; });
    s.on('disconnect', () => { $('#conn-banner').hidden = false; });
    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') { setToken(null); showScreen('auth', { push: false }); s.disconnect(); }
      else $('#conn-banner').hidden = false;
    });
    s.on('session:replaced', () => { modal('Sua conta foi aberta em outra aba/dispositivo.'); s.disconnect(); });
    s.on('room:update', (r) => this.onRoomUpdate(r));
    s.on('room:rejoined', (r) => { this.onRoomUpdate(r); if (r.state === 'lobby' && !['game', 'results'].includes(currentScreen())) showScreen('lobby'); });
    s.on('room:kicked', () => { this.room = null; this.voice?.leave(); showScreen('menu', { push: false }); modal('Você foi removido da sala.'); });
    s.on('chat', (m) => this.addChat(m));
    s.on('chat:history', (list) => { $('#lobby-chat').replaceChildren(); $('#game-chat').replaceChildren(); list.forEach((m) => this.addChat(m)); });
    s.on('match:start', (data) => { this.game.start(data); });
    s.on('match:end', (res) => this.onMatchEnd(res));

    this.voice = new VoiceChat(s, this.config.iceServers);
    this.voice.myId = this.profile?.id;
    this.voice.onChange = () => this.renderVoiceButtons();
    if (!this.game) this.game = new Game(this);
    else { this.game.socket = s; this.game.bindSocket(); }
  }

  emit(ev, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) return reject(new Error('Sem conexão com o servidor.'));
      const t = setTimeout(() => reject(new Error('Tempo esgotado.')), 8000);
      this.socket.emit(ev, data, (res) => { clearTimeout(t); res?.ok ? resolve(res) : reject(new Error(res?.error || 'Erro')); });
    });
  }

  // ================================================================ menus
  bindMenus() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      audio.unlock();
      audio.play('click', { vol: 0.5 });
      const go = b.dataset.go;
      if (go === 'back') {
        const prev = previousScreen();
        if (prev === 'game' && this.game?.running) showScreen('game', { push: false });
        else showScreen(prev, { push: false });
        return;
      }
      this.navigate(go);
    });

    // Não existe mais tela de convidado/login/registro nem botão de "sair
    // da conta" aqui dentro — quem loga é o WifiCord (ver boot() acima).

    // minigame (lembrança em flashback — ver minigame.js)
    $('#mg-skip').addEventListener('click', () => this.mg?.skip());
    $('#mg-dialogue').addEventListener('click', () => this.mg?.advanceDialogue());
    $('#btn-replay-lucas').addEventListener('click', () => this.playMinigame('lucas', () => showScreen('credits', { push: false })));

    // criar sala
    $('#form-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await this.emit('room:create', { night: Number($('#create-night').value), maxPlayers: Number($('#create-max').value), difficulty: $('#create-diff').value, isPublic: e.target.isPublic.checked });
        this.onRoomUpdate(r.room);
        showScreen('lobby');
      } catch (err) { $('#create-error').textContent = err.message; }
    });
    $('#btn-solo').addEventListener('click', async () => {
      try {
        const r = await this.emit('room:create', { night: this.profile.maxNight, maxPlayers: 1, isPublic: false, difficulty: settings.lastDifficulty || DEFAULT_DIFFICULTY });
        this.onRoomUpdate(r.room);
        await this.emit('room:start');
      } catch (err) { modal(err.message); }
    });
    // entrar
    $('#form-join').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.joinRoom($('#join-code').value);
    });
    $('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
    $('#btn-refresh-rooms').addEventListener('click', () => this.loadPublicRooms());

    // lobby
    $('#btn-copy-code').addEventListener('click', () => {
      navigator.clipboard?.writeText(this.room?.code || '').then(() => toast('Código copiado!', 'good')).catch(() => {});
    });
    $('#btn-ready').addEventListener('click', async () => {
      const me = this.room?.members.find((m) => m.id === this.profile.id);
      try { await this.emit('room:ready', { ready: !me?.ready }); } catch (err) { $('#lobby-error').textContent = err.message; }
    });
    $('#btn-start').addEventListener('click', async () => {
      $('#lobby-error').textContent = '';
      try { await this.emit('room:start'); } catch (err) { $('#lobby-error').textContent = err.message; }
    });
    $('#btn-leave-room').addEventListener('click', async () => {
      try { await this.emit('room:leave'); } catch { /* ignora */ }
      this.voice?.leave();
      this.room = null;
      showScreen('menu', { push: false });
    });
    for (const [id, key] of [['#lobby-night', 'night'], ['#lobby-max', 'maxPlayers']]) {
      $(id).addEventListener('change', async (e) => {
        try { await this.emit('room:config', { [key]: Number(e.target.value) }); } catch (err) { $('#lobby-error').textContent = err.message; this.onRoomUpdate(this.room); }
      });
    }
    $('#lobby-diff').addEventListener('change', async (e) => {
      settings.lastDifficulty = e.target.value;
      try { await this.emit('room:config', { difficulty: e.target.value }); } catch (err) { $('#lobby-error').textContent = err.message; this.onRoomUpdate(this.room); }
    });
    $('#create-diff').addEventListener('change', (e) => { settings.lastDifficulty = e.target.value; $('#create-diff-desc').textContent = DIFFICULTIES[e.target.value].desc; });
    $('#lobby-public').addEventListener('change', async (e) => { try { await this.emit('room:config', { isPublic: e.target.checked }); } catch (err) { $('#lobby-error').textContent = err.message; } });
    $('#lobby-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = e.target.querySelector('input');
      if (inp.value.trim()) this.socket.emit('chat:send', { text: inp.value });
      inp.value = '';
    });
    const toggleVoice = async () => {
      try {
        if (this.voice.active) this.voice.leave();
        else { await this.voice.join(); toast(settings.ptt ? 'Voz ligada. Segure V para falar.' : 'Voz ligada.', 'good'); }
      } catch (err) { toast(err.message, 'warn'); }
    };
    $('#btn-voice-lobby').addEventListener('click', toggleVoice);
    $('#hb-voice').addEventListener('click', toggleVoice);

    // perfil
    $('#form-rename').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/profile/name', { name: e.target.name.value }); this.profile = r.profile; e.target.reset(); this.renderProfile(); } catch (err) { $('#profile-error').textContent = err.message; }
    });
    $('#form-claim').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/auth/claim', { username: e.target.username.value, password: e.target.password.value }); this.profile = r.profile; toast('Conta protegida com senha!', 'good'); this.renderProfile(); } catch (err) { $('#profile-error').textContent = err.message; }
    });

    // resultados
    $('#btn-res-lobby').addEventListener('click', () => this.backToLobby());

    document.addEventListener('screen', (e) => this.onScreen(e.detail));
  }

  navigate(go) {
    if (go === 'create') {
      const max = this.profile?.maxNight || 1;
      $('#create-night').replaceChildren(...Array.from({ length: FINAL_NIGHT }, (_, i) => i + 1).map((n) => el('option', { value: n, disabled: n > max, selected: n === max, text: `${NIGHTS[n].title}${n > max ? ' 🔒' : ''}` })));
      $('#create-max').replaceChildren(...Array.from({ length: this.config.maxPlayersPerRoom }, (_, i) => i + 1).map((n) => el('option', { value: n, selected: n === this.config.maxPlayersPerRoom, text: `${n} jogador${n > 1 ? 'es' : ''}` })));
      const cur = settings.lastDifficulty || DEFAULT_DIFFICULTY;
      $('#create-diff').replaceChildren(...Object.entries(DIFFICULTIES).map(([k, d]) => el('option', { value: k, selected: k === cur, text: d.name })));
      $('#create-diff-desc').textContent = DIFFICULTIES[cur].desc;
      $('#create-error').textContent = '';
    }
    showScreen(go);
  }

  onScreen(id) {
    if (id === 'join') this.loadPublicRooms();
    if (id === 'profile') this.loadProfile().then(() => this.renderProfile()).catch((e) => toast(e.message, 'warn'));
    if (id === 'inventory') this.loadProfile().then(() => this.renderInventory()).catch((e) => toast(e.message, 'warn'));
    if (id === 'menu') this.loadProfile().catch(() => {});
    if (id === 'credits') $('#credits-memories').hidden = !hasSeenMinigame('lucas');
    if (id !== 'game') audio.stopAll();
  }

  async joinRoom(code) {
    $('#join-error').textContent = '';
    try {
      const r = await this.emit('room:join', { code });
      this.onRoomUpdate(r.room);
      if (r.room.state === 'lobby') showScreen('lobby');
    } catch (err) { $('#join-error').textContent = err.message; }
  }

  async loadPublicRooms() {
    const ul = $('#public-rooms');
    try {
      const r = await this.emit('room:list');
      ul.replaceChildren(...(r.rooms.length ? r.rooms.map((room) => el('li', { onclick: () => this.joinRoom(room.code) },
        el('b', { text: room.code }), el('span', { class: 'muted', text: `Noite ${room.night} · ${DIFFICULTIES[room.difficulty]?.name || ''} · ${room.host}` }), el('span', { text: `${room.players}/${room.maxPlayers}` })))
        : [el('li', { class: 'muted', text: 'Nenhuma sala pública aberta. Crie uma!' })]));
    } catch (err) { ul.replaceChildren(el('li', { class: 'muted', text: err.message })); }
  }

  // ================================================================ lobby
  onRoomUpdate(r) {
    if (!r) return;
    this.room = r;
    const isHost = r.hostId === this.profile?.id;
    $('#lobby-code').textContent = r.code;
    const nightSel = $('#lobby-night');
    nightSel.replaceChildren(...Array.from({ length: FINAL_NIGHT }, (_, i) => i + 1).map((n) => el('option', { value: n, disabled: n > r.hostMaxNight, selected: n === r.night, text: `Noite ${n}${n > r.hostMaxNight ? ' 🔒' : ''}` })));
    nightSel.disabled = !isHost;
    const maxSel = $('#lobby-max');
    maxSel.replaceChildren(...Array.from({ length: this.config.maxPlayersPerRoom }, (_, i) => i + 1).map((n) => el('option', { value: n, selected: n === r.maxPlayers, disabled: n < r.members.length, text: `${n}` })));
    maxSel.disabled = !isHost;
    const ds = $('#lobby-diff');
    ds.replaceChildren(...Object.entries(DIFFICULTIES).map(([k, d]) => el('option', { value: k, selected: k === r.difficulty, text: d.name })));
    ds.disabled = !isHost;
    $('#lobby-public').checked = r.isPublic;
    $('#lobby-public').disabled = !isHost;
    $('#lobby-night-intro').textContent = `${NIGHTS[r.night].title} — ${NIGHTS[r.night].intro} [${DIFFICULTIES[r.difficulty]?.name}: ${DIFFICULTIES[r.difficulty]?.desc}]`;
    $('#lobby-members').replaceChildren(...r.members.map((m, i) => el('li', { class: m.online ? '' : 'off' },
      el('span', {}, el('b', { style: `color:${PLAYER_COLORS[i % PLAYER_COLORS.length]}`, text: m.name }), m.id === r.hostId ? ' 👑' : '', ` · Nv ${m.level}`, m.inMatch ? ' · em partida' : ''),
      el('span', { class: m.ready ? 'ready' : 'notready', text: m.id === r.hostId ? 'ANFITRIÃO' : m.ready ? 'PRONTO' : 'aguardando' }),
      isHost && m.id !== this.profile.id ? el('button', { class: 'btn tiny', text: 'Remover', onclick: () => this.emit('room:kick', { id: m.id }).catch((e) => toast(e.message)) }) : null)));
    const me = r.members.find((m) => m.id === this.profile?.id);
    $('#btn-ready').hidden = isHost;
    $('#btn-ready').textContent = me?.ready ? 'Cancelar pronto' : 'Estou pronto';
    $('#btn-start').hidden = !isHost;
    $('#btn-start').disabled = r.state !== 'lobby';
  }

  addChat(m) {
    const line = () => {
      if (m.system) return el('div', { class: m.glitch ? 'glitch-msg' : 'sys', text: m.text });
      return el('div', {}, el('b', { text: `${m.name}: ` }), m.text);
    };
    for (const id of ['#lobby-chat', '#game-chat']) {
      const box = $(id);
      box.append(line());
      while (box.children.length > 60) box.firstChild.remove();
      box.scrollTop = box.scrollHeight;
    }
    if (!m.system && currentScreen() === 'game') audio.play('click', { vol: 0.3 });
  }

  renderVoiceButtons() {
    $('#voice-lobby-label').textContent = `Voz: ${this.voice?.active ? 'on' : 'off'}`;
  }

  backToLobby() {
    this.game?.stop();
    if (this.room) showScreen('lobby', { push: false });
    else showScreen('menu', { push: false });
    this.loadProfile().catch(() => {});
  }

  onMatchEnd(res) {
    this.game.stop();
    const win = res.result === 'victory';
    const title = $('#res-title');
    title.className = win ? 'win' : 'lose';
    title.textContent = res.result === 'aborted' ? 'PARTIDA ENCERRADA' : win ? (res.trueEnding ? 'FINAL VERDADEIRO' : '06:00 AM') : 'FIM DE TURNO';
    $('#res-sub').textContent = [
      `${res.title} (${res.difficulty || ''})`,
      win ? (res.reason === 'escape' ? 'Atravessei o portão e não olhei pra trás.' : 'O sol nasceu. Sobrevivi a mais uma noite.') : res.result === 'defeat' ? 'Pegaram todos nós. O rádio só chia.' : 'O turno acabou antes da hora.',
      res.badEnding ? 'Mas o Maestro continua ligado lá dentro... (final ruim)' : '',
      res.nextNight ? `Amanhã volto para a Noite ${res.nextNight}.` : '',
      `Fiquei ${fmtTime(res.seconds)} lá dentro.`,
    ].filter(Boolean).join(' ');
    $('#res-quests').replaceChildren(...res.quests.map((q) => el('li', { class: q.done ? 'done' : 'fail', text: `${q.done ? '✔' : '✘'} ${q.title}` })));
    $('#res-players').replaceChildren(...res.players.map((p) => el('tr', {},
      el('td', { text: p.name }), el('td', { text: `+${p.xpGained}` }), el('td', { text: `+${p.moneyGained}` }),
      el('td', { text: `${p.level}${p.levelsGained ? ` (+${p.levelsGained}⭐)` : ''}` }), el('td', { text: p.deaths }))));
    // Minigame de lembrança (Fase 1: "Feliz Aniversário, Lucas") — dispara
    // uma vez, só na transição pra Noite 3, antes da tela de resultados.
    const showResultsNow = () => showScreen('results', { push: false });
    const triggerMinigame = win && res.nextNight === 3 && !hasSeenMinigame('lucas') ? 'lucas' : null;
    setTimeout(() => {
      if (triggerMinigame) this.playMinigame(triggerMinigame, showResultsNow);
      else showResultsNow();
    }, res.result === 'defeat' ? 1200 : 300);
    audio.unlock();
    audio.play(win ? 'levelup' : 'blackout', { vol: 0.8 });
    this.loadProfile().catch(() => {});
  }

  // ============================================================ minigame
  playMinigame(sceneId, onDone) {
    const scene = SCENES[sceneId];
    if (!scene) { onDone?.(); return; }
    showScreen('minigame', { push: false });
    const canvas = $('#mg-canvas');
    this.mg = new Minigame(canvas);
    const capEl = $('#mg-caption');
    const dlgEl = $('#mg-dialogue');
    this.mg.start(scene, {
      onCaption: (text) => { capEl.hidden = !text; capEl.textContent = text || ''; },
      onDialogue: (d) => {
        dlgEl.hidden = !d;
        if (d) { $('#mg-speaker').textContent = d.speaker || ''; $('#mg-speaker').hidden = !d.speaker; $('#mg-text').textContent = d.text; }
      },
      onDone: () => { this.mg = null; onDone?.(); },
    });
  }

  // ================================================================ perfil
  renderMenuPlayer() {
    const p = this.profile;
    if (!p) return;
    $('#menu-player').replaceChildren(el('span', {}, el('b', { text: p.displayName }), ` · Nv ${p.level}`), el('span', { class: 'muted', text: `$${p.money} · Noite ${p.maxNight}` }));
  }

  renderProfile() {
    const p = this.profile;
    this.renderMenuPlayer();
    $('#profile-error').textContent = '';
    $('#profile-card').replaceChildren(
      el('div', { class: 'name', text: p.displayName }),
      el('div', { class: 'muted small', text: p.isGuest ? 'Conta de convidado' : `@${p.username}` }),
      el('div', {}, `Nível ${p.level} · $${p.money}`),
      el('div', { class: 'xpbar' }, el('i', { style: `width:${(p.xp / p.xpToNext) * 100}%` })),
      el('div', { class: 'small muted', text: `${p.xp} / ${p.xpToNext} XP` }),
      el('div', { class: 'small', text: `HP máx ${p.derived.maxHp} · Velocidade ${p.derived.speed.toFixed(2)} · Revistar ${p.derived.searchTime.toFixed(1)}s` }),
    );
    $('#form-claim').hidden = !p.isGuest;
    $('#attr-points').textContent = `${p.attrPoints} ponto(s)`;
    $('#attr-list').replaceChildren(...ATTRIBUTES.map((a) => {
      const bonus = p.effectiveAttrs[a] - p.attrs[a];
      return el('li', {},
        el('span', {}, ATTR_NAMES[a], bonus ? el('span', { class: 'bonus', text: ` +${bonus}` }) : null),
        el('span', { class: 'val', text: p.attrs[a] }),
        el('button', { class: 'btn tiny', disabled: p.attrPoints <= 0 || p.attrs[a] >= ATTR_MAX, text: '+', onclick: async () => {
          try { const r = await api('/profile/attribute', { attr: a }); this.profile = r.profile; audio.play('pickup', { vol: 0.5 }); this.renderProfile(); } catch (err) { $('#profile-error').textContent = err.message; }
        } }),
        el('small', { text: ATTR_DESC[a] }));
    }));
    const s = p.stats;
    $('#stat-list').replaceChildren(...[
      ['Noites jogadas', s.nightsPlayed], ['Noites vencidas', s.nightsWon], ['Missões concluídas', s.missionsCompleted],
      ['Itens encontrados', s.itemsFound], ['Sustos (jumpscares)', s.jumpscares], ['Mortes', s.deaths],
      ['Tempo de turno', fmtTime(s.playSeconds)], ['Final verdadeiro', s.trueEnding ? 'Sim' : '—'],
    ].map(([k, v]) => el('li', {}, el('span', { text: k }), el('b', { text: v }))));
    $('#night-list').replaceChildren(...Array.from({ length: FINAL_NIGHT }, (_, i) => i + 1).map((n) => {
      const pr = p.nights.find((x) => x.night === n);
      const locked = n > p.maxNight;
      return el('li', { class: locked ? 'locked' : '' }, el('span', { text: `${locked ? '🔒 ' : ''}${NIGHTS[n].title}` }), el('span', { text: pr ? `${pr.wins}/${pr.attempts} vitórias` : locked ? 'bloqueada' : 'nova' }));
    }));
    api('/leaderboard').then((r) => {
      $('#leaderboard').replaceChildren(...r.top.map((x, i) => el('li', {}, el('span', { text: `${i + 1}. ${x.name}` }), el('span', { text: `Nv ${x.level} · N${x.maxNight}` }))));
    }).catch(() => {});
  }

  renderInventory() {
    const p = this.profile;
    this.renderMenuPlayer();
    $('#inv-error').textContent = '';
    $('#inv-money').textContent = `$${p.money}`;
    const act = async (path, body) => {
      try { const r = await api(path, body); this.profile = r.profile; audio.play('pickup', { vol: 0.4 }); this.renderInventory(); } catch (err) { $('#inv-error').textContent = err.message; }
    };
    $('#equip-slots').replaceChildren(...EQUIP_SLOTS.map((slot) => {
      const id = p.equipment[slot];
      return el('div', { class: 'slot' }, el('span', { text: SLOT_NAMES[slot] }), id ? `${ITEMS[id].icon} ${ITEMS[id].name}` : '— vazio —',
        id ? el('button', { class: 'btn tiny', text: 'Remover', onclick: () => act('/inventory/unequip', { slot }) }) : null);
    }));
    const bag = Object.entries(p.inventory);
    $('#bag-items').replaceChildren(...(bag.length ? bag.map(([id, q]) => {
      const it = ITEMS[id];
      const equipped = p.equipment[it.slot] === id;
      return el('div', { class: `item ${equipped ? 'equipped' : ''}` },
        el('div', { class: 'top' }, el('span', { class: 'ico', text: it.icon }), el('span', { class: 'nm', text: it.name }), el('span', { class: 'qty', text: `x${q}` })),
        el('div', { class: 'ds', text: it.desc }),
        it.type === 'equip' ? el('button', { class: 'btn tiny', disabled: equipped, text: equipped ? 'Equipado' : 'Equipar', onclick: () => act('/inventory/equip', { item: id }) })
          : el('span', { class: 'small muted', text: 'Use durante a partida (teclas 1-5)' }));
    }) : [el('p', { class: 'muted', text: 'Mochila vazia.' })]));
    $('#shop-items').replaceChildren(...SHOP_ITEMS.map((id) => {
      const it = ITEMS[id];
      const owned = p.inventory[id] || 0;
      const blocked = it.type === 'equip' && owned > 0;
      return el('div', { class: 'item' },
        el('div', { class: 'top' }, el('span', { class: 'ico', text: it.icon }), el('span', { class: 'nm', text: it.name }), el('span', { class: 'qty', text: `$${it.price}` })),
        el('div', { class: 'ds', text: `${it.desc}${owned ? ` (tem ${owned})` : ''}` }),
        el('button', { class: 'btn tiny primary', disabled: blocked || p.money < it.price, text: blocked ? 'Comprado' : 'Comprar', onclick: () => act('/shop/buy', { item: id, qty: 1 }) }));
    }));
  }

  // ================================================================ configurações
  renderSettings() {
    const box = $('#settings-form');
    const range = (key, label) => el('label', {}, label, el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: settings[key], oninput: (e) => { settings[key] = Number(e.target.value); } }));
    const check = (key, label, fn) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: settings[key], onchange: (e) => { settings[key] = e.target.checked; fn?.(e.target.checked); } }), ' ', label);
    const select = (key, label, opts, fn) => el('label', {}, label, el('select', { onchange: (e) => { settings[key] = e.target.value; fn?.(); } },
      ...opts.map(([v, t]) => el('option', { value: v, selected: settings[key] === v, text: t }))));
    box.replaceChildren(
      range('master', 'Volume geral'), range('music', 'Música/ambiente'), range('sfx', 'Efeitos'), range('voice', 'Voz dos jogadores'),
      check('crt', 'Efeito CRT/VHS', (v) => document.body.classList.toggle('no-crt', !v)),
      check('shake', 'Tremer a tela'),
      check('showFps', 'Mostrar FPS'),
      check('ptt', 'Voz: apertar V para falar', () => this.voice?.applyPtt()),
      select('touch', 'Controles touch', [['auto', 'Automático'], ['on', 'Sempre'], ['off', 'Nunca']], () => {
        document.body.classList.toggle('touch', isTouchDevice());
        if (this.game?.running) $('#touch').hidden = !isTouchDevice();
      }),
      // Em celular os shaders ficam sempre desligados no código (ver
      // construtor de Game em game.js — nem o contexto WebGL é criado),
      // por causa de um bug real de tela preta num aparelho específico.
      // Por isso a opção nem aparece aqui: mostrar um seletor que não
      // faz nada só confundiria.
      isTouchDevice()
        ? el('p', { class: 'hint' }, 'Efeitos de tela (shader): desligados no celular (correção de tela preta).')
        : select('fx', 'Efeitos de tela (shader)', [['high', 'Alto'], ['low', 'Leve'], ['off', 'Desligado']], () => this.game?.resize()),
      select('quality', 'Qualidade gráfica', [['auto', 'Automática'], ['low', 'Baixa (PCs modestos)']], () => { if (this.game?.S) { this.game.S.lowQuality = settings.quality === 'low'; this.game.resize(); } }),
      el('button', { class: 'btn tiny', type: 'button', text: 'Testar som', onclick: () => { audio.unlock(); audio.play('musicbox', { vol: 0.8 }); } }),
    );
  }
}

window.app = new App();
