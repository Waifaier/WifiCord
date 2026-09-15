// Falas do vigia noturno. Tudo que aparece em caixas de texto durante a partida vem daqui,
// escrito como pensamento do próprio guarda (ou dos colegas, pelo rádio).
const pickOne = (v) => (Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v);

export const FALAS = {
  // ---------- lanterna / itens ----------
  lanternaApagou: ['Droga... a lanterna morreu. Preciso de uma bateria.', 'Apagou. Sem bateria. Justo agora.'],
  semLanterna: 'Eu nem tô com uma lanterna na mão...',
  semBateria: 'Tá sem bateria. Não adianta nem tentar.',
  naoPrecisa: ['Não preciso disso agora.', 'Melhor guardar isso pra quando eu precisar.'],
  sinalizador: ['Isso! O clarão travou {n} deles!', 'Toma essa! {n} ficaram atordoados.'],
  sinalizadorNada: 'Gastei o sinalizador à toa... não tinha nada perto.',
  radioIsca: 'Deixei o rádio chiando aqui. Hora de sumir.',
  pegouDinheiro: ['+${v}. Alguém esqueceu isso aqui.', '+${v}. Vai ajudar.'],
  pegouItem: ['Peguei: {item}.', 'Isso vai servir. {item}.'],
  achou: ['Achei: {itens}.', 'Olha só... {itens}.'],
  nadaUtil: ['Só poeira e embalagem velha.', 'Nada útil aqui.', 'Vazio. Alguém já passou por aqui.'],
  vazio: ['Já revirei isso.', 'Vazio.'],
  recebeu: 'Guardei comigo: {item}.',

  // ---------- respiração / esconderijo ----------
  ofegou: ['Não aguentei... soltei o ar alto demais!', 'Precisei respirar. Ele ouviu!'],
  ocupado: 'Já tem alguém escondido aí dentro.',
  viuEntrar: ['{anim} me viu entrar aqui!', 'Não... {anim} viu onde eu me escondi!'],

  // ---------- câmeras ----------
  camSemMonitor: 'Preciso chegar num monitor... ou arrumar aquele tablet.',
  camSemEnergia: 'As câmeras apagaram. Sem energia.',
  remotoSoMonitor: 'Essas portas só abrem e fecham pelos monitores.',
  monitorSemEnergia: 'Os monitores estão mortos. Sem energia.',

  // ---------- portas ----------
  portaEmperrada: 'Emperrou! Não fecha!',
  portaSemEnergia: 'Sem energia, a porta blindada não fecha.',
  portaAlguem: 'Tem alguém bem no meio da porta.',
  portaSegurando: ['Tem algo segurando a porta do outro lado...', 'Ela não fecha... algo tá empurrando.'],
  portaSelada: ['{porta}: lacrada. Hoje não abre.', 'Selaram isso por dentro. Esquece.'],
  portaTrancada: 'Trancada. Vou precisar de: {item}.',

  // ---------- objetos ----------
  palcoNada: 'Marcas de garra no piso do palco... melhor não pensar nisso.',
  geradorOk: 'O gerador tá funcionando.',
  painelOk: 'O painel parece ok.',
  jaConsertado: 'Isso já tá consertado.',
  naoDaConsertar: 'Ainda não consigo mexer nisso.',
  semEnergia: 'Sem energia.',
  telefoneMudo: 'Linha muda. Só chiado... e uma respiração?',
  telefoneBonus: 'Alguém do outro lado me ajudou. (+$40, +25 XP)',
  portaoTrancado: 'O portão tá trancado com correntes grossas.',
  jaFeito: 'Isso já tá feito.',
  nadaAqui: 'Não tenho nada pra fazer aqui agora.',
  primeiro: 'Antes disso eu preciso: {lista}.',
  precisaEntregar: 'Preciso trazer {item} aqui. ({p}/{t})',
  entregou: '{item}: {p}/{t}. Faltam mais.',
  pipoca: ['O macaco bateu os pratos! Todo mundo ouviu... preciso sair daqui!', 'Aquele barulho... vão vir pra cá!'],

  // ---------- rádio (mensagens para a equipe) ----------
  rDestrancou: '📻 {nome}: "Abri {porta}."',
  rLuzes: '📻 {nome}: "{acao} as luzes."',
  rLeu: '📻 {nome}: "Achei um documento: {doc}. ({p}/{t})"',
  rAchou: '📻 {nome}: "Achei {itens}!"',
  rPego: ['📻 {nome}: "NÃO— {anim} me pe—" *chiado*', '📻 *grito* ...{nome} não responde. Foi {anim}.'],
  rVolta: ' (acordando no Escritório em 12s)',
  rSemVolta: ' (sem retornos restantes)',
  rVoltou: '📻 {nome}: "Acordei no Escritório... tô vivo."',
  rNivel: '⭐ {nome} ficou mais experiente (nível {n}).',
  rMissao: '📻 {nome}: "{fala}"',
  rMissaoEquipe: '📻 "{fala}"',
  rEnergia: '📻 A energia voltou (+{n}%).',
  rApagao: '📻 A ENERGIA CAIU. As portas blindadas destravaram. Câmeras fora do ar.',
  rArrombada: '📻 Barulho de metal... {porta} foi arrombada!',
  rFinal: '🎼 3:00 — As cortinas se abriram sozinhas. Tem música tocando no palco.',
  rDesligado: '📻 "O Maestro parou! O portão lá fora destrancou. CORRE!"',
  rDesconectou: '📻 {nome} perdeu o sinal do rádio... (60s para voltar)',
  rReconectou: '📻 {nome}: "Voltei, voltei. O rádio tinha caído."',
  rSaiu: '📻 {nome} largou o turno.',
  rInicio: '🌙 {noite}. Bati o ponto. Que venha a noite.',
  rEntrou: '{nome} bateu o ponto.',
  rChefe: '{nome} agora é o chefe do turno.',

  // ---------- eventos ----------
  arrastado: ['Ouvi algo sendo arrastado no chão...', 'Isso foi... alguma coisa se mexendo?'],
  telefoneTocando: 'O telefone do escritório tá tocando. Quem ligaria pra cá a essa hora?',
  dourado: 'Vi algo dourado brilhando lá no(a) {area}.',

  // ---------- cliente ----------
  meViu: ['{anim} me viu. CORRE!', 'Ele me viu... {anim} tá vindo!', 'NÃO. {anim} olhou direto pra mim!'],
  notando: ['Tem algo me olhando...', 'Fica parado... ele tá olhando pra cá.', 'Não se mexe. Não se mexe.'],
  apagao: 'A luz caiu. Tá tudo escuro...',
  energiaVoltou: 'A energia voltou. Graças a Deus.',
  camerasOk: 'Pronto, as câmeras voltaram.',
  energiaBaixa: 'A energia tá acabando. Preciso economizar.',
  pego: 'Me pegaram... tudo ficou escuro. (acordando em 12s)',
  pegoFim: 'Me pegaram. Agora só consigo ouvir os outros pelo rádio.',
  cortinas: 'AS CORTINAS SE ABRIRAM',
  desligouMaestro: 'Ele parou! O portão tá aberto. Preciso correr!',
  nivel: 'Tô pegando o jeito disso. (Nível {n} — pontos para gastar no perfil)',
  semCameras: 'Agora não dá pra olhar câmera nenhuma.',
  aquiE: 'é aqui. [E]',
}

export function fala(key, vars = {}) {
  const v = pickOne(FALAS[key] ?? key);
  return String(v).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}
