// Teste isolado (SEM Match nenhuma) do controlador de recurso/cooldown/
// perseguição do modo Animatronic — exatamente pra poder testar essa peça
// sozinha antes de acoplar em qualquer coisa maior, como o pedido original
// descreveu ("PlayerAnimatronic... testável em isolamento sem uma Match
// completa").
import { PlayerAnimatronic } from './PlayerAnimatronic.js';
import { ABILITIES, CHASE } from '../../shared/animatronicMode.js';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.error(`  ❌ ${name}`); failures++; }
}

console.log('=== 1: energia nunca fica negativa, habilidade bloqueada sem recurso suficiente ===');
{
  const b = new PlayerAnimatronic('gregorio');
  let uses = 0;
  for (let i = 0; i < 50; i++) { if (b.use('vultoRapido')) uses++; }
  check('energia nunca negativa depois de tentar spammar', b.energy >= 0);
  check('parou de conseguir usar antes de chegar a 50 usos (recurso finito de verdade)', uses < 50);
}

console.log('=== 2: cooldown realmente bloqueia reuso imediato da MESMA habilidade ===');
{
  const b = new PlayerAnimatronic('tonho');
  const first = b.use('passosAtras');
  const second = b.use('passosAtras'); // cooldown ainda de pé, mesmo com energia sobrando
  check('primeiro uso funcionou', first === true);
  check('segundo uso imediato foi bloqueado pelo cooldown', second === false);
  check('cooldownLeft > 0 logo após usar', b.cooldownLeft('passosAtras') > 0);
}

console.log('=== 3: energia regenera ao longo do tempo (tick) ===');
{
  const b = new PlayerAnimatronic('maestro');
  b.energy = 0;
  for (let i = 0; i < 300; i++) b.tick(0.1); // 30s simulados
  check('energia subiu de 0 depois de 30s de regeneração', b.energy > 0);
  check('energia nunca passa do teto (energyMax)', b.energy <= b.energyMax + 1e-9);
}

console.log('=== 4: perseguição tem duração máxima e cooldown depois — não é infinita ===');
{
  const b = new PlayerAnimatronic('gregorio');
  b.energy = b.energyMax;
  const started = b.use('chase');
  check('perseguição iniciou com energia cheia', started === true);
  check('chaseState = active logo após iniciar', b.chaseState === 'active');
  // não deixa iniciar uma segunda em cima da primeira
  check('não dá pra iniciar outra perseguição enquanto uma já está ativa', b.canUse('chase') === false);
  // roda além da duração máxima configurada
  const ticks = Math.ceil((CHASE.maxDuration + 2) / 0.1);
  for (let i = 0; i < ticks; i++) b.tick(0.1);
  check('perseguição terminou sozinha depois da duração máxima', b.chaseState === 'cooldown');
  check('não dá pra iniciar outra logo em seguida (cooldown pós-perseguição)', b.canUse('chase') === false);
  // roda além do cooldown
  const ticks2 = Math.ceil((CHASE.cooldownAfter + 2) / 0.1);
  for (let i = 0; i < ticks2; i++) b.tick(0.1);
  check('depois do cooldown inteiro, volta a poder perseguir (se tiver energia)', b.chaseState === 'idle');
}

console.log('=== 5: manifestTimeLeft controla quando a entidade deve aparecer pros humanos ===');
{
  const b = new PlayerAnimatronic('tonho');
  b.energy = b.energyMax;
  check('não está "manifestando" no início', b.isManifesting() === false);
  b.use('observando');
  check('manifestando logo após usar uma habilidade de manifestação', b.isManifesting() === true);
  const dur = ABILITIES.observando.manifestFor;
  for (let i = 0; i < Math.ceil((dur + 1) / 0.1); i++) b.tick(0.1);
  check('parou de manifestar depois do tempo da habilidade', b.isManifesting() === false);
}

console.log('=== 6: presets diferentes por tipo realmente mudam custo/regeneração (identidade real, não só cosmética) ===');
{
  const g = new PlayerAnimatronic('gregorio'); // agressivo: perseguição mais barata
  const t = new PlayerAnimatronic('tonho'); // observador: eventos pequenos mais baratos
  check('gregorio paga menos que tonho por uma perseguição', g.costFor('chase') < t.costFor('chase'));
  check('tonho paga menos que gregorio por um evento pequeno (passosAtras)', t.costFor('passosAtras') < g.costFor('passosAtras'));
  check('energyMax difere entre os dois tipos', g.energyMax !== t.energyMax);
}

if (failures) {
  console.error(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\n✅ todas as verificações do PlayerAnimatronic isolado passaram.');
}
