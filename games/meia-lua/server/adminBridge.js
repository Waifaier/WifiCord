// Camada administrativa do Meia-Lua — TODA função aqui opera em cima da
// MESMA instância viva de RoomManager/Match que o jogo de verdade usa (ver
// integration.js, que passa `rooms` pra cá) — não existe nenhum estado
// "de mentira" só pro painel. Isto é ESM (o resto do jogo é) e é exposto
// pro WifiCord (CJS) através do retorno de mountMeiaLua, igual accounts/
// apiRouter já eram — ver server/routes/meiaLuaAdmin.js (o router CJS que
// chama essas funções) e o comentário grande no topo de integration.js.
//
// Segurança: quem decide SE um pedido pode chegar até aqui é o router CJS
// (auth + checagem de role==='admin', reaproveitando o padrão que já
// existe em server/routes/admin.js do WifiCord) — este arquivo confia que
// quem chamou já foi autorizado, e só valida a FORMA dos parâmetros
// (sala existe, partida ativa, evento conhecido, etc.) — nunca confiar
// que o cliente mandou os dados certos.
import { areaAt } from '../shared/map.js';

// Eventos "manuais" que o admin pode disparar — cada um chama a MESMA
// função fx* que o sorteio aleatório de eventos e as habilidades do
// jogador-animatrônico já usam (ver Match.js) — nenhuma versão fake.
const TRIGGERABLE = {
  passosAtras: (m, target) => m.fxPassosAtras(target),
  respiracaoDistante: (m, target) => m.fxRespiracaoDistante(target),
  vultoRapido: (m, target) => m.fxVultoRapido(target),
  presenca: (m, target) => m.fxPresenca(target),
  flicker: (m, target) => m.fxFlicker(target ? areaAt(target.x, target.y) : null),
  falsoAlarme: (m) => m.fxFalsoAlarme(),
  observando: (m, target) => m.fxObservando(target),
  silencio: (m) => m.fxSilencio(),
  camFail: (m) => m.fxCamFail(),
};

export function createAdminBridge(rooms) {
  function activeMatches() {
    return [...rooms.rooms.values()].filter((r) => r.match && !r.match.ended);
  }
  function findMatch(code) {
    const room = rooms.rooms.get(String(code || '').toUpperCase());
    if (!room || !room.match || room.match.ended) throw new AdminBridgeError('Partida não encontrada ou já encerrada.', 404);
    return room.match;
  }
  function findPlayer(match, playerId) {
    const p = match.players.get(playerId) ?? match.players.get(Number(playerId)) ?? match.players.get(String(playerId));
    if (!p || p.saved) throw new AdminBridgeError('Jogador não encontrado nessa partida.', 404);
    return p;
  }

  return {
    /** Visão resumida de todas as partidas em andamento — pro painel listar. */
    listMatches() {
      return activeMatches().map((room) => summarizeMatch(room));
    },

    /** Detalhe de UMA partida — jogadores, posições aproximadas, tensão, eventos recentes, missões. */
    getMatchDetail(code) {
      const match = findMatch(code);
      return summarizeMatch({ code: String(code).toUpperCase(), match });
    },

    /**
     * Dispara um evento REAL do jogo (mesmo sistema de sempre) num jogador
     * específico, em todos, ou numa lista de jogadores.
     */
    triggerEvent(code, { type, targetId, targetIds, broadcast } = {}) {
      const match = findMatch(code);
      const fn = TRIGGERABLE[type];
      if (!fn) throw new AdminBridgeError(`Tipo de evento desconhecido: ${type}`, 400);
      const targets = [];
      if (broadcast) targets.push(...match.alivePlayers());
      else if (Array.isArray(targetIds) && targetIds.length) for (const id of targetIds) targets.push(findPlayer(match, id));
      else if (targetId != null) targets.push(findPlayer(match, targetId));
      if (!targets.length) targets.push(null); // eventos sem alvo específico (falsoAlarme, silencio, camFail) passam null
      for (const t of targets) fn(match, t);
      return { ok: true, type, count: targets.filter(Boolean).length || (broadcast ? targets.length : 0) };
    },

    /** +N / reset de tensão — pro TensionDirector, direto (mesmo objeto que o jogo usa pra decidir tudo). */
    setTension(code, { delta, value } = {}) {
      const match = findMatch(code);
      if (value != null) match.director.tension = Math.max(0, Math.min(100, Number(value) || 0));
      else if (delta != null) match.director.tension = Math.max(0, Math.min(100, match.director.tension + (Number(delta) || 0)));
      return { tension: Math.round(match.director.tension), phase: match.director.phase };
    },

    /** Força a sequência REAL do Show (não é "tocar uma música") — mesmo runShowEvent que o jogo usa quando sorteia o evento. */
    forceShow(code) {
      const match = findMatch(code);
      if (match.showActive) throw new AdminBridgeError('Já tem um Show em andamento nessa partida.', 409);
      const players = [...match.alivePlayers()];
      if (!players.length) throw new AdminBridgeError('Nenhum jogador vivo pra prender no Show.', 409);
      match.runShowEvent(players);
      return { ok: true };
    },

    /** Liga/desliga a flag de debug (dados extras no snapshot só pra quem tem essa flag — ver Match.sendSnapshots). */
    toggleDebug(code, on) {
      const match = findMatch(code);
      match.adminDebug = !!on;
      return { debug: match.adminDebug };
    },

    /** Cancela o Show em andamento (se houver) — usa o mesmo encerramento normal, não um "reset bruto". */
    cancelShow(code) {
      const match = findMatch(code);
      if (match.showActive) match.endShowEvent();
      return { ok: true };
    },
  };
}

export class AdminBridgeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function summarizeMatch({ code, match }) {
  const players = [...match.players.values()].filter((p) => !p.saved).map((p) => ({
    id: p.id, name: p.name, online: p.online, alive: p.alive,
    role: p.role, // só o admin vê isso — NUNCA vai pro snapshot de outro jogador (ver Match.sendSnapshots)
    x: Math.round(p.x), y: Math.round(p.y),
    hp: p.derived ? Math.round((p.hp / p.derived.maxHp) * 100) : null,
    beast: p.role === 'animatronic' && p.beast ? p.beast.hud() : null,
  }));
  return {
    code, night: match.night, difficulty: match.difficulty, mode: match.mode,
    time: Math.round(match.time), duration: match.duration,
    tension: Math.round(match.director.tension), phase: match.director.phase,
    power: Math.round(match.power), lightsOn: match.lightsOn, blackout: match.blackout,
    showActive: match.showActive,
    playerCount: players.length,
    players,
    animatronics: match.mode === 'animatronic' ? [] : match.anims.map((a) => ({ id: a.id, type: a.type, state: a.state, x: Math.round(a.x), y: Math.round(a.y) })),
    recentEvents: match.eventLog.slice(-12),
    quests: match.questView(),
    debug: !!match.adminDebug,
  };
}
