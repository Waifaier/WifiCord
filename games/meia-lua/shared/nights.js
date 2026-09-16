// Configuração das noites e missões cooperativas.
// Missão: type = interact | collect | deliver | repair | unlock | read | survive | escape
export const FINAL_NIGHT = 5;

export const ANIMATRONIC_INFO = {
  tonho: { name: 'Tonho, o Tatu Baterista', short: 'Tonho', color: '#b0703a', eye: '#ffcf4a',
    desc: 'O tatu anda batendo as baquetas no chão. Reparei que ele congela quando eu fico olhando pelas câmeras.' },
  marola: { name: 'Marola, a Foca Cantora', short: 'Marola', color: '#5d7c8f', eye: '#8ff7ff',
    desc: 'A foca se arrasta devagar, mas quando me vê dá uma arrancada absurda. Se eu aguentar uns segundos, ela cansa.' },
  lume: { name: 'Lume, a Mariposa Lanterneira', short: 'Lume', color: '#c9b67a', eye: '#ff7af2',
    desc: 'A mariposa é surda — correr, gritar, nada disso adianta com ela. Mas enxerga rápido demais: com a lanterna acesa ela me vê de longe, e no escuro quase não enxerga nada. É a mais veloz de todas.' },
  gregorio: { name: 'Gregório, o Gorila Garçom', short: 'Gregório', color: '#3d3a44', eye: '#ff3b3b',
    desc: 'O gorila ouve qualquer barulho — passos, portas, e até minha própria voz no microfone. Abre porta num instante e esmurra as blindadas até arrombar, gastando a energia.' },
  maestro: { name: 'O Maestro', short: 'Maestro', color: '#1c1320', eye: '#ffffff',
    desc: 'O Maestro enxerga pra todo lado. De vez em quando ele simplesmente aparece do nada bem perto de alguém — a tela treme quando ele faz isso — e quando me acha, rege os outros até mim.' },
  pipoca: { name: 'Pipoca, o Macaco dos Pratos', short: 'Pipoca', color: '#8f5a33', eye: '#ff2a1a',
    desc: 'O macaco não machuca ninguém — é só uma alucinação pra mexer com a cabeça da gente. Ele se teleporta perto e a tela tremeluz, ou bate os pratos se eu passar correndo ou de lanterna perto dele (aí todo mundo ouve). Perto dele eu ando agachado (Espaço). E ele muda de lugar quando ninguém tá olhando.' },
};

export const DIFFICULTIES = {
  normal: { name: 'Normal', desc: 'Mais retornos e animatrônicos menos atentos.', aggr: 0, damage: 1, respawn: 1, drain: 1, reward: 1, events: 1 },
  dificil: { name: 'Difícil', desc: 'A experiência pensada para o jogo.', aggr: 0.35, damage: 1.25, respawn: 0, drain: 1.2, reward: 1.35, events: 0.85 },
  pesadelo: { name: 'Pesadelo', desc: 'Sem retornos. Energia escassa. Eles não perdoam.', aggr: 0.8, damage: 1.6, respawn: -99, drain: 1.45, reward: 1.9, events: 0.65 },
};
export const DEFAULT_DIFFICULTY = 'dificil';

export const NIGHTS = {
  1: {
    title: 'Noite 1 — Primeiro Turno',
    intro: 'Primeira noite. Me contrataram pra fazer o "inventário" da Pizzaria Meia-Lua, fechada há 12 anos. A energia mal funciona... e juro que vi os bonecos do palco mexerem a cabeça.',
    animatronics: ['tonho', 'marola'],
    aggression: 1.05,
    powerDrain: 1.0,
    respawns: 2,
    eventInterval: [32, 58],
    locks: { d_deposito: 'chave_deposito', d_porao: null, d_secreta: null },
    spawns: [
      { item: 'fusivel', count: 3, areas: ['salao', 'palco', 'cozinha', 'banheiros', 'corredor_oeste', 'corredor_leste', 'escritorio'] },
    ],
    quests: [
      { id: 'n1_palco', type: 'interact', target: 'o_palco', title: 'Investigar o palco', desc: 'Tem algo brilhando no centro do palco.', hint: 'Primeiro o palco. Fica ao norte do salão. Se eu chegar perto do ponto de interrogação e apertar E, vejo o que é.', done: 'Uma chave presa entre as tábuas do palco... é a do depósito.', reward: { xp: 40, money: 15 }, gives: 'chave_deposito' },
      { id: 'n1_fusiveis', type: 'collect', item: 'fusivel', count: 3, title: 'Encontrar três fusíveis', desc: 'Os fusíveis devem estar jogados por aí.', hint: 'Vou revirar caixas e armários com E. Quando aparece aquele brilho roxo ✦, sei que tem algo importante por perto.', done: 'Três fusíveis. Agora é levar pro depósito.', reward: { xp: 60, money: 20 } },
      { id: 'n1_energia', type: 'deliver', item: 'fusivel', count: 3, target: 'o_fusiveis', requires: ['n1_fusiveis', 'n1_palco'], title: 'Restaurar a energia', desc: 'Tenho que colocar os fusíveis na caixa do depósito.', hint: 'Com a chave, abro o depósito pelo Corredor Oeste. A caixa de fusíveis fica num canto lá dentro.', done: 'Clack. As luzes zumbiram. A energia voltou!', reward: { xp: 80, money: 35 }, effect: { power: 45 } },
      { id: 'n1_sobreviver', type: 'survive', title: 'Sobreviver até 6:00', desc: 'Só preciso aguentar até as 6.', hint: 'Se algo vier, fecho uma porta blindada (Segurança ou Escritório) ou me escondo num armário. As portas comem energia, então nada de deixar fechado à toa.', done: 'Seis da manhã. Consegui.', reward: { xp: 100, money: 50 } },
    ],
  },
  2: {
    title: 'Noite 2 — Vozes na Fita',
    intro: 'Segunda noite. Alguém arrancou os fios das câmeras enquanto eu tava fora. E o gerente deixou uma fita escondida por aqui.',
    animatronics: ['tonho', 'marola', 'lume', 'pipoca'],
    aggression: 1.3,
    powerDrain: 1.15,
    respawns: 2,
    eventInterval: [30, 60],
    camerasBroken: true,
    locks: { d_porao: null, d_secreta: null },
    spawns: [
      { item: 'gravador', count: 1, areas: ['cozinha', 'banheiros', 'corredor_leste', 'palco'] },
    ],
    quests: [
      { id: 'n2_cameras', type: 'repair', target: 'o_painel_cam', seconds: 7, title: 'Consertar as câmeras', desc: 'Alguém sabotou as câmeras.', hint: 'O painel fica na Sala de Segurança, no oeste. Tenho que ficar perto até terminar o conserto.', done: 'Pronto. As câmeras voltaram a mostrar a pizzaria.', reward: { xp: 70, money: 25 }, effect: { cameras: true } },
      { id: 'n2_gravador', type: 'collect', item: 'gravador', count: 1, title: 'Encontrar o gravador', desc: 'Tem um gravador escondido na ala leste.', hint: 'Vou procurar na Cozinha, nos Banheiros, no Corredor Leste ou no Palco.', done: 'Achei o gravador. Tem uma fita dentro escrito "NÃO TOCAR".', reward: { xp: 50, money: 20 } },
      { id: 'n2_fita', type: 'deliver', item: 'gravador', count: 1, target: 'o_toca_fitas', requires: ['n2_gravador'], title: 'Ouvir a fita no escritório', desc: 'Preciso ouvir essa fita.', hint: 'O toca-fitas fica no Escritório, lá no sudoeste.', done: 'A fita terminou... e agora eu queria não ter ouvido.', reward: { xp: 80, money: 40 }, lore: 'tape' },
      { id: 'n2_sobreviver', type: 'survive', title: 'Sobreviver até 6:00', desc: 'Aguentar até as 6.', hint: 'Tem um macaco de pratos por aí. Se eu passar correndo perto dele, ele toca e chama todo mundo. Melhor andar agachado (Espaço).', done: 'Seis horas. Mais uma noite.', reward: { xp: 120, money: 60 } },
    ],
  },
  3: {
    title: 'Noite 3 — O Porão',
    intro: 'Terceira noite. A fita falava de um gerador no porão. Hoje o gorila garçom saiu da cozinha... com a bandeja na mão.',
    animatronics: ['tonho', 'marola', 'lume', 'gregorio', 'pipoca'],
    aggression: 1.55,
    powerDrain: 1.3,
    respawns: 1,
    startPower: 75,
    eventInterval: [25, 50],
    locks: { d_porao: 'chave_porao', d_secreta: null },
    spawns: [
      { item: 'chave_porao', count: 1, areas: ['cozinha', 'escritorio', 'seguranca', 'deposito', 'salao'] },
    ],
    quests: [
      { id: 'n3_chave', type: 'collect', item: 'chave_porao', count: 1, title: 'Encontrar a chave do porão', desc: 'A chave do porão tá em algum lugar.', hint: 'O gerente guardava tudo: Cozinha, Escritório, Segurança, Depósito ou Salão. Vou revirar tudo.', done: 'A chave do porão. Pesada e gelada.', reward: { xp: 50, money: 20 } },
      { id: 'n3_porta', type: 'unlock', target: 'd_porao', requires: ['n3_chave'], title: 'Descer ao porão', desc: 'Hora de descer ao porão.', hint: 'A escada fica no Corredor Norte, atrás do Palco.', done: 'A porta do porão rangeu... tá aberta.', reward: { xp: 40, money: 15 } },
      { id: 'n3_gerador', type: 'repair', target: 'o_gerador', seconds: 11, requires: ['n3_porta'], title: 'Religar o gerador', desc: 'O gerador lá embaixo tá desligado.', hint: 'Fica no fundo do Porão, onde é tudo escuro. Tenho que levar bateria pra lanterna.', done: 'O gerador pegou! Dá pra sentir o chão vibrando.', reward: { xp: 110, money: 60 }, effect: { power: 55 } },
      { id: 'n3_sobreviver', type: 'survive', title: 'Sobreviver até 6:00', desc: 'Aguentar até as 6.', hint: 'O gorila ouve tudo e arromba porta blindada. Não posso ficar parado num lugar só.', done: 'Seis horas. Ainda tô inteiro.', reward: { xp: 140, money: 70 } },
    ],
  },
  4: {
    title: 'Noite 4 — Arquivo Secreto',
    intro: 'Quarta noite. Tem uma sala que não aparece na planta. Quatro funcionários tinham acesso. Nenhum deles voltou.',
    animatronics: ['tonho', 'marola', 'lume', 'gregorio', 'pipoca'],
    aggression: 1.85,
    powerDrain: 1.4,
    respawns: 1,
    eventInterval: [22, 45],
    locks: { d_secreta: 'chave_secreta' },
    spawns: [
      { item: 'cartao_funcionario', count: 4, areas: ['salao', 'cozinha', 'banheiros', 'porao', 'escritorio', 'palco', 'corredor_oeste', 'corredor_leste', 'exterior'] },
    ],
    quests: [
      { id: 'n4_crachas', type: 'collect', item: 'cartao_funcionario', count: 4, title: 'Encontrar 4 crachás', desc: 'Quatro crachás de funcionários antigos.', hint: 'Estão espalhados pela pizzaria inteira, até na área externa. Com eles eu gravo uma chave magnética.', done: 'Os quatro crachás. Nomes riscados em todos.', reward: { xp: 90, money: 40 } },
      { id: 'n4_chave', type: 'deliver', item: 'cartao_funcionario', count: 4, target: 'o_cracha', requires: ['n4_crachas'], title: 'Gravar a chave magnética', desc: 'Preciso gravar a chave magnética.', hint: 'A máquina de crachás fica no Depósito.', done: 'A máquina cuspiu uma chave magnética.', reward: { xp: 60, money: 25 }, gives: 'chave_secreta' },
      { id: 'n4_porta', type: 'unlock', target: 'd_secreta', requires: ['n4_chave'], title: 'Abrir a sala secreta', desc: 'Tem uma sala que não aparece na planta.', hint: 'A porta lacrada fica no fundo dos Banheiros, no norte.', done: 'A porta selada abriu. Cheira a óleo queimado.', reward: { xp: 50, money: 20 } },
      { id: 'n4_docs', type: 'read', targets: ['o_doc1', 'o_doc2', 'o_doc3'], requires: ['n4_porta'], title: 'Descobrir o que aconteceu com a pizzaria', desc: 'Quero entender o que aconteceu aqui.', hint: 'Os 3 documentos estão dentro da Sala Secreta. Vou ler todos.', done: 'Agora eu sei por que fecharam a Meia-Lua.', reward: { xp: 130, money: 80 } },
      { id: 'n4_sobreviver', type: 'survive', title: 'Sobreviver até 6:00', desc: 'Aguentar até as 6.', hint: 'Se a energia acabar, as portas blindadas abrem sozinhas. Tenho que economizar.', done: 'Seis horas. Só falta uma noite.', reward: { xp: 160, money: 80 } },
    ],
  },
  5: {
    title: 'Noite Final — O Último Show',
    intro: 'Última noite. Às 3:00 as cortinas vão abrir e o Maestro vai reger o último show. Dessa vez eu tenho que desligar ele... ou sair correndo.',
    animatronics: ['tonho', 'marola', 'lume', 'gregorio', 'maestro', 'pipoca'],
    aggression: 2.15,
    powerDrain: 1.5,
    respawns: 1,
    eventInterval: [18, 38],
    finalEventHour: 3,
    locks: {},
    spawns: [
      { item: 'nucleo_memoria', count: 3, areas: ['porao', 'sala_secreta', 'cozinha', 'deposito', 'palco', 'banheiros'] },
    ],
    quests: [
      { id: 'n5_nucleos', type: 'collect', item: 'nucleo_memoria', count: 3, title: 'Recuperar 3 núcleos de memória', desc: 'Os núcleos de memória mantêm o show vivo.', hint: 'Estão no Porão, na Sala Secreta, na Cozinha, no Depósito, no Palco ou nos Banheiros.', done: 'Três núcleos. Eles pulsam como se tivessem coração.', reward: { xp: 110, money: 50 } },
      { id: 'n5_altar', type: 'deliver', item: 'nucleo_memoria', count: 3, target: 'o_altar', requires: ['n5_nucleos'], title: 'Desligar o Maestro', desc: 'Tenho que colocar os núcleos no altar.', hint: 'O altar fica na Sala Secreta. Às 3:00 o Maestro acorda, então é melhor ser rápido.', done: 'Encaixei o último núcleo. A música parou.', reward: { xp: 180, money: 120 }, effect: { shutdown: true } },
      { id: 'n5_fuga', type: 'escape', target: 'o_portao', requires: ['n5_altar'], title: 'Fugir pela saída', desc: 'A saída tá aberta. CORRE.', hint: 'O portão fica no sul da área externa!', done: 'Atravessei o portão. Não vou olhar pra trás.', reward: { xp: 250, money: 180 } },
      { id: 'n5_sobreviver', type: 'survive', optional: true, title: 'Sobreviver até 6:00', desc: 'Ou eu saio, ou aguento até as 6.', hint: 'Se só sobreviver até as 6, o Maestro continua ligado lá dentro.', done: 'O sol nasceu... mas ele ainda tá lá dentro.', reward: { xp: 120, money: 60 } },
    ],
  },
};

export const LORE = {
  mural: [
    '"Parabéns, Lucas! 7 anos!"... alguém riscou o rosto de todos os animatrônicos nessa foto. Com força.',
    'Um desenho de criança: cinco bonecos e um sexto, alto, sem rosto, segurando uma varinha. Embaixo tá escrito "ELE NÃO DEIXA A GENTE IR".',
  ],
  tape: 'FITA: "...se estiver ouvindo, não confie nas câmeras. O Maestro aprende com a gente. Ele guarda as memórias nos núcleos... o gerador fica no porão. Não desça sozinho."',
  docs: {
    o_doc1: 'RELATÓRIO: "Incidente na festa de 14/08. Os animatrônicos seguiram o mesmo convidado por 40 minutos. Recomendação: desligar o módulo de regência."',
    o_doc2: 'PLANTA: "Projeto MAESTRO — unidade central que coordena a banda. Núcleos de memória armazenam o comportamento aprendido dos visitantes."',
    o_doc3: 'DIÁRIO: "Não consegui desligá-lo. Ele desligou as luzes antes. Lacrei a sala e fechei a pizzaria. Se alguém voltar... coloque os núcleos no altar."',
  },
  phone: [
    'TELEFONE: "Alô? Ah, que bom, você atendeu. Dica: portas blindadas gastam muita energia. Feche só quando precisar."',
    'TELEFONE: "...a mariposa odeia o escuro. Desligue a lanterna se ouvir asas."',
    'TELEFONE: "Esconda-se nos armários. Eles só procuram onde ouviram algo."',
    'TELEFONE: "*chiado* ...ele sabe seu nome agora..."',
  ],
  whispers: [
    'V O C Ê   V O L T O U',
    'o show não pode parar',
    'quem apagou as luzes?',
    'ESTAMOS TODOS AQUI',
    'feliz aniversário...',
    'não olhe para o palco',
    'SORRIA PARA A CÂMERA',
  ],
};

export function hourFromProgress(p) {
  return Math.min(6, Math.floor(p * 6));
}
