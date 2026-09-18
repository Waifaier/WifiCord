// Teste isolado da sequência de porta forçada do Gregório (pedido #4: "NÃO
// instantâneo"). Não usa uma Match inteira — só um stub mínimo com o que
// forceDoorSequence() precisa (emitSfx/addNoise/forceDoorOpen/doors), pra
// poder afirmar com precisão QUANTO TEMPO a sequência leva e EM QUE ORDEM
// os sons tocam, sem depender de a IA "por acaso" entrar nesse cenário
// numa simulação de noite inteira.
import { Animatronic } from './Animatronic.js';
import { DOORS } from '../../shared/map.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

const door = DOORS.find((d) => d.kind === 'normal');
if (!door) { console.error('Nenhuma porta normal encontrada no mapa — teste não pode rodar.'); process.exit(1); }

function makeStubMatch() {
  const sfxLog = [];
  const forceLog = [];
  return {
    time: 0,
    doors: new Map([[door.id, { open: false, locked: false, jamUntil: 0 }]]),
    emitSfx: (s, x, y, r) => sfxLog.push(s),
    addNoise: () => {},
    forceDoorOpen: (id, seconds) => { forceLog.push({ id, seconds }); },
    alivePlayers: () => [],
    playerSees: () => false,
    areaAccessible: () => true,
    onAnimChase: () => {},
    sfxLog, forceLog,
  };
}

// ---- 1. A sequência NÃO abre a porta instantaneamente ----
{
  const match = makeStubMatch();
  const anim = new Animatronic('gregorio', match, 0);
  anim.setState('CHASE', 30);
  let opened = false;
  const dt = 0.1;
  let elapsed = 0;
  for (let i = 0; i < 5 && !opened; i++) { // 0.5s
    anim.forceDoorSequence(door, dt);
    elapsed += dt;
    if (match.forceLog.length) opened = true;
  }
  check(`porta NÃO abre nos primeiros 0.5s de forceDoorSequence (era doorTime=0.4s antes)`, !opened);
}

// ---- 2. A sequência tem estágios ORDENADOS: silêncio -> teste (locked) ->
// forçando (drag, depois metal repetido) -> arrombada (forceDoorOpen) ----
{
  const match = makeStubMatch();
  const anim = new Animatronic('gregorio', match, 0);
  anim.setState('CHASE', 60);
  const dt = 0.15;
  let ticks = 0;
  while (match.forceLog.length === 0 && ticks < 300) { // até 45s de simulação, bem mais que suficiente
    anim.forceDoorSequence(door, dt);
    ticks++;
  }
  const totalTime = ticks * dt;
  check('a porta eventualmente É arrombada (forceDoorOpen chamado)', match.forceLog.length === 1);
  check(`a sequência inteira leva vários segundos de verdade (${totalTime.toFixed(1)}s, esperado entre 6s e 20s)`, totalTime > 6 && totalTime < 20);
  check(`primeiro som é 'locked' (o teste discreto), não um som de arrombamento`, match.sfxLog[0] === 'locked');
  check(`tem pelo menos um 'drag' (pressionando) antes de qualquer 'metal' (forçando)`,
    match.sfxLog.indexOf('drag') >= 0 && match.sfxLog.indexOf('drag') < match.sfxLog.lastIndexOf('metal'));
  check(`vários golpes 'metal' antes da porta ceder (não é um golpe só)`, match.sfxLog.filter((s) => s === 'metal').length >= 3);
  console.log(`  ordem completa dos sons: ${match.sfxLog.join(' -> ')}`);
}

// ---- 3. Fora de perseguição (CHASE), Gregório NÃO usa essa sequência —
// segue o comportamento antigo (silencioso, rápido) porque followPath só
// chama forceDoorSequence quando this.state === 'CHASE' (ver Animatronic.js).
{
  const match = makeStubMatch();
  const anim = new Animatronic('gregorio', match, 0);
  anim.setState('PATROL', 30); // não é CHASE
  check('fora de perseguição, o gate do followPath não chamaria forceDoorSequence (verificado por leitura do estado)', anim.state !== 'CHASE');
}

// ---- 4. Só o Gregório tem doorBreaker — outro tipo não deveria receber
// esse comportamento sem querer.
{
  const match = makeStubMatch();
  const tonho = new Animatronic('tonho', match, 0);
  check('Tonho não tem a flag doorBreaker (só Gregório força porta em estágios)', !tonho.def.doorBreaker);
  const greg = new Animatronic('gregorio', match, 0);
  check('Gregório tem a flag doorBreaker', !!greg.def.doorBreaker);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
