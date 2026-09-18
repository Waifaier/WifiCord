// Testes do pedido "Request F" (ver conversa): travas de papel pro
// jogador-animatrônico (não pode fazer missão de trabalhador), missões
// PRÓPRIAS do lado bestial (this.beastQuests) com vitória antecipada quando
// termina todas as 4, o mesmo pro lado humano ("quem terminar primeiro
// ganha"), e o cômputo de vitória/derrota PESSOAL por papel em endMatch()
// (Match.personalWon) — sem isso, `result==='defeat'` (o animatrônico
// VENCENDO) dava tratamento de derrota justo pra quem tinha acabado de
// ganhar. Mesmo padrão de stub de room/io dos outros __smokeTest*.mjs.
import { Match } from './Match.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.error(`  ❌ ${name}`); failures++; }
}

const room = { channel: 'request-f-room', systemMessage: () => {}, onMatchEnd: () => {} };
const io = { to: () => ({ emit: () => {} }) };

function account(id, name) {
  return {
    id, displayName: name,
    attrs: { coragem: 5, investigacao: 5, velocidade: 5, resistencia: 5, tecnica: 5 },
    equipment: {}, level: 5, xp: 0, money: 0, inventory: {},
  };
}
// 4 participantes -> animCountFor(4) = 1 (ver shared/animatronicMode.js)
const participants = [1, 2, 3, 4].map((n) => ({ account: account(n, `Jogador ${n}`), socketId: `sock${n}` }));

function freshMatch() {
  const m = new Match(room, io, 1, participants.map((pt) => ({ ...pt, account: account(pt.account.id, pt.account.displayName) })), 'normal', 'animatronic');
  clearInterval(m.interval);
  for (const p of m.players.values()) p.invulnUntil = Infinity;
  return m;
}

console.log('=== 1: travas de papel — animatrônico não consegue fazer NENHUMA ação de trabalhador ===');
{
  const m = freshMatch();
  const beast = [...m.players.values()].find((p) => p.role === 'animatronic');
  const human = [...m.players.values()].find((p) => p.role !== 'animatronic');

  check('canAct(animatrônico) é false (bloqueia useItem/remoteDoor/interact)', m.canAct(beast) === false);
  check('canAct(humano) continua true normalmente', m.canAct(human) === true);

  const container = [...m.containers.keys()][0];
  const before = beast.action;
  m.interactObject(beast, { type: 'container', id: container });
  check('interactObject não deixa o animatrônico iniciar uma busca de container', beast.action === before);

  beast.inv.bateria = 1;
  m.equip(beast.id, 'lanterna');
  check('equip() é ignorado pro animatrônico (não equipa lanterna)', !beast.equipment.lanterna);

  m.toggleFlashlight(beast.id);
  check('toggleFlashlight() é ignorado pro animatrônico', beast.flash !== true);

  const camBefore = beast.cam;
  m.setCamera(beast.id, 'cam1');
  check('setCamera() é ignorado pro animatrônico', beast.cam === camBefore);
}

console.log('=== 2: missões do lado bestial — as 4 progridem de verdade e terminam a partida na hora ===');
{
  const m = freshMatch();
  const beast = [...m.players.values()].find((p) => p.role === 'animatronic');
  const humans = [...m.players.values()].filter((p) => p.role !== 'animatronic');
  beast.beast.energy = beast.beast.energyMax;

  check('começa com as 4 missões bestiais, nenhuma concluída', m.beastQuests.length === 4 && m.beastQuests.every((q) => !q.done));

  // --- 'sense': sendSnapshots() precisa marcar progresso quando o beast
  // realmente vê/ouve um humano (ver o hook novo dentro de sendSnapshots).
  humans[0].x = beast.x; humans[0].y = beast.y; // mesma posição = visão garantida
  m.sendSnapshots();
  const senseQ = m.beastQuests.find((q) => q.id === 'sense');
  check("'sense' concluída depois de realmente perceber um humano via sendSnapshots", senseQ.done === true);

  // --- 'scare': duas habilidades miradas em DOIS alvos diferentes.
  humans[1].x = beast.x; humans[1].y = beast.y;
  beast.beast.cooldowns.clear();
  const okScare1 = m.useAnimAbility(beast.id, 'passosAtras', { targetId: humans[0].id });
  beast.beast.cooldowns.clear();
  const okScare2 = m.useAnimAbility(beast.id, 'respiracaoDistante', { targetId: humans[1].id });
  const scareQ = m.beastQuests.find((q) => q.id === 'scare');
  check("'scare' progrediu nos dois usos válidos", okScare1 === true && okScare2 === true);
  check("'scare' concluída (2 alvos diferentes)", scareQ.done === true);

  // --- 'chase' + 'catch': inicia perseguição e encosta no alvo.
  beast.beast.cooldowns.clear();
  beast.beast.chaseState = 'idle';
  humans[2].x = beast.x; humans[2].y = beast.y;
  const okChase = m.useAnimAbility(beast.id, 'chase', { targetId: humans[2].id });
  const chaseQ = m.beastQuests.find((q) => q.id === 'chase');
  check("'chase' funcionou e já marca a missão na hora (não espera pegar)", okChase === true && chaseQ.done === true);

  check('partida NÃO acabou ainda (só 3 das 4 concluídas)', m.ended === false);

  m.updateBeastChases(0.1); // alvo está na MESMA posição -> dentro do catchRadius
  const catchQ = m.beastQuests.find((q) => q.id === 'catch');
  check("'catch' concluída (updateBeastChases pegou o alvo)", catchQ.done === true);

  check('as 4 missões bestiais concluídas -> partida termina NA HORA', m.ended === true);

  console.log('=== 3: personalWon — quem venceu de verdade recebe tratamento de vitória, por PAPEL, não por result literal ===');
  const beastSummary = [...m.players.values()].map((p) => m.personalWon(p, 'defeat'));
  check("Match.personalWon(beast, 'defeat') é true (o animatrônico venceu ao terminar as missões)", m.personalWon(beast, 'defeat') === true);
  check("Match.personalWon(humano, 'defeat') é false (perdeu)", humans.every((h) => m.personalWon(h, 'defeat') === false));
  void beastSummary;
}

console.log('=== 4: lado humano — terminar as missões (não-opcionais) primeiro também vence na hora ===');
{
  const m = freshMatch();
  const beast = [...m.players.values()].find((p) => p.role === 'animatronic');
  const required = m.quests.filter((q) => !q.def.optional);
  check('existe pelo menos 1 missão não-opcional pra testar (config da noite 1)', required.length > 0);

  for (let i = 0; i < required.length - 1; i++) {
    m.completeQuest(required[i], null);
  }
  check('partida NÃO acabou ainda (falta a última missão não-opcional)', m.ended === false);
  m.completeQuest(required[required.length - 1], null);
  check("todas as missões não-opcionais concluídas -> partida termina em 'victory'/'missions' na hora, sem esperar o amanhecer", m.ended === true);

  const humans = [...m.players.values()].filter((p) => p.role !== 'animatronic');
  check("Match.personalWon(humano, 'victory') é true", humans.every((h) => m.personalWon(h, 'victory') === true));
  check("Match.personalWon(beast, 'victory') é false (perdeu — os humanos terminaram primeiro)", m.personalWon(beast, 'victory') === false);
}

console.log('=== 5: fora do Modo Animatronic, personalWon nunca inverte nada (modo normal não tem papel bestial jogável) ===');
{
  const room2 = { channel: 'normal-room', systemMessage: () => {}, onMatchEnd: () => {} };
  const m2 = new Match(room2, io, 1, participants.map((pt) => ({ ...pt, account: account(pt.account.id, pt.account.displayName) })), 'normal');
  clearInterval(m2.interval);
  const anyPlayer = [...m2.players.values()][0];
  check("modo normal: personalWon(p,'victory') === true", m2.personalWon(anyPlayer, 'victory') === true);
  check("modo normal: personalWon(p,'defeat') === false", m2.personalWon(anyPlayer, 'defeat') === false);
}

if (failures) {
  console.error(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\n✅ todas as verificações do Request F (travas de papel + missões dos dois lados + personalWon) passaram.');
}
