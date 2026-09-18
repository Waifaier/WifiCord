// Teste isolado do EncounterResolver — sem Match, sem Animatronic, só a
// função pura + um RNG determinístico (sequência fixa de números 0..1), pra
// poder afirmar coisas estatísticas sobre a distribuição sem flakiness.
import { resolveEncounter, weightsFor, OUTCOMES } from './EncounterResolver.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

// RNG determinístico simples (LCG) — mesma semente sempre dá a mesma
// sequência, então os testes de distribuição são reprodutíveis.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function distribution(type, ctx, n = 20000, seed = 1) {
  const rand = makeRng(seed);
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (let i = 0; i < n; i++) counts[resolveEncounter(type, ctx, rand)]++;
  return counts;
}

// ---- 1. Toda saída é sempre um OUTCOME válido ----
{
  const rand = makeRng(7);
  let ok = true;
  for (let i = 0; i < 5000; i++) {
    const o = resolveEncounter('gregorio', { tension: Math.random() }, rand);
    if (!OUTCOMES.includes(o)) ok = false;
  }
  check('resolveEncounter sempre devolve um outcome da lista', ok);
}

// ---- 2. REGRA FUNDAMENTAL: "viu = vai perseguir" tem que ser falso ----
// Em tensão média (0.5), sem contexto especial, chase não pode dominar a
// distribuição — tem que ser só mais uma fatia entre 11.
{
  const counts = distribution('tonho', { tension: 0.5, trigger: 'sense', isolated: false, recent: [] }, 20000, 11);
  const chaseShare = counts.chase / 20000;
  check(`chase não domina (tonho, tensão média): ${(chaseShare * 100).toFixed(1)}% < 30%`, chaseShare < 0.3);
  // e pelo menos uns 6 outcomes diferentes de 'chase' aparecem de verdade
  const distinctNonChase = OUTCOMES.filter((o) => o !== 'chase' && counts[o] > 50).length;
  check(`pelo menos 6 desfechos não-chase realmente acontecem: ${distinctNonChase}`, distinctNonChase >= 6);
}

// ---- 3. Tensão alta aumenta chase; tensão baixa reduz ----
{
  const low = distribution('marola', { tension: 0.05, trigger: 'sense', isolated: false, recent: [] }, 15000, 22);
  const high = distribution('marola', { tension: 0.95, trigger: 'sense', isolated: false, recent: [] }, 15000, 22);
  check(`tensão alta aumenta chase (low=${low.chase} high=${high.chase})`, high.chase > low.chase);
  check(`tensão baixa favorece 'nothing' mais que tensão alta (low=${low.nothing} high=${high.nothing})`, low.nothing > high.nothing);
}

// ---- 4. Identidade por arquétipo é real, não decorativa ----
{
  const ctx = { tension: 0.5, trigger: 'sense', isolated: false, recent: [] };
  const wGreg = weightsFor('gregorio', ctx);
  const wLume = weightsFor('lume', ctx);
  const wMaestro = weightsFor('maestro', ctx);
  const wTonho = weightsFor('tonho', ctx);
  check('Gregório pesa MUITO mais bloquear/porta que Lume', wGreg.block > wLume.block * 3 && wGreg.doorManipulate > wLume.doorManipulate * 3);
  check('Lume pesa muito mais "manifest" (aparição rápida) que Tonho', wLume.manifest > wTonho.manifest * 2);
  check('Maestro pesa muitíssimo mais "relocate" que qualquer outro', wMaestro.relocate > wGreg.relocate && wMaestro.relocate > wLume.relocate && wMaestro.relocate > wTonho.relocate);
  check('Tonho pesa muito mais "observe" que Gregório', wTonho.observe > wGreg.observe * 1.8);
  check(`Gregório quase nunca foge (peso residual, não zero absoluto): wGreg.flee=${wGreg.flee.toFixed(2)} << wLume.flee=${wLume.flee.toFixed(2)}`, wGreg.flee < wLume.flee * 0.15);
  check('Maestro nunca bloqueia rota "de propósito físico" tanto quanto Gregório', wMaestro.block < wGreg.block);
}

// ---- 5. Blackout (apagão do Gregório) continua genuinamente perigoso ----
{
  const normal = distribution('gregorio', { tension: 0.4, trigger: 'sense', isolated: true, recent: [] }, 15000, 33);
  const blackout = distribution('gregorio', { tension: 0.4, trigger: 'blackout', isolated: true, recent: [] }, 15000, 33);
  check(`apagão aumenta chance de chase vs. um relance normal (normal=${normal.chase} blackout=${blackout.chase})`, blackout.chase > normal.chase);
}

// ---- 6. Anti-repetição: repetir o MESMO outcome que acabou de acontecer
// fica bem mais raro (nunca impossível) ----
{
  const ctx0 = { tension: 0.5, trigger: 'sense', isolated: false, recent: [] };
  const ctxRepeat = { tension: 0.5, trigger: 'sense', isolated: false, recent: ['observe'] };
  const base = distribution('tonho', ctx0, 20000, 44);
  const suppressed = distribution('tonho', ctxRepeat, 20000, 44);
  check(`'observe' fica bem mais raro logo depois de já ter sido 'observe' (base=${base.observe} suppressed=${suppressed.observe})`,
    suppressed.observe < base.observe * 0.6 && suppressed.observe > 0);
}

// ---- 7. Isolamento muda a curva sem virar "sozinho = chase garantido" ----
{
  const together = distribution('marola', { tension: 0.5, trigger: 'sense', isolated: false, recent: [] }, 20000, 55);
  const alone = distribution('marola', { tension: 0.5, trigger: 'sense', isolated: true, recent: [] }, 20000, 55);
  check(`sozinho aumenta chase, mas não domina (together=${together.chase} alone=${alone.chase}, alone<40%)`,
    alone.chase > together.chase && alone.chase / 20000 < 0.4);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
