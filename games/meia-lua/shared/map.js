// Mapa da Pizzaria Meia-Lua — gerado a partir de retângulos para ficar legível e fácil de editar.
// Coordenadas em tiles. Compartilhado entre servidor (colisão/IA) e cliente (renderização).

export const TILE = { FLOOR: 0, WALL: 1, SOLID: 2 };
export const MAP_W = 72;
// Era 48 — a "ala de serviço" nova (ver bloco de AREAS logo abaixo, depois
// do comentário "ALA DE SERVIÇO") vive inteiramente em linhas y48-63, que
// não existiam antes. Crescer só pra baixo (em vez de reencaixar o mapa
// antigo) foi de propósito: zero coordenada de sala/porta/câmera/animatrônico
// já existente mudou de lugar, então nada do que já funcionava e já foi
// testado corre risco de ter sido quebrado por essa expansão.
export const MAP_H = 64;

export const AREAS = [
  { id: 'deposito', name: 'Depósito', x1: 1, y1: 1, x2: 11, y2: 10, floor: 'concreto' },
  { id: 'seguranca', name: 'Sala de Segurança', x1: 1, y1: 12, x2: 11, y2: 22, floor: 'carpete', safeLight: true },
  { id: 'escritorio', name: 'Escritório', x1: 1, y1: 24, x2: 11, y2: 34, floor: 'madeira', safeLight: true },
  { id: 'corredor_oeste', name: 'Corredor Oeste', x1: 13, y1: 1, x2: 16, y2: 34, floor: 'ladrilho' },
  { id: 'porao', name: 'Porão', x1: 18, y1: 1, x2: 45, y2: 8, floor: 'porao', dark: true },
  { id: 'corredor_norte', name: 'Corredor Norte', x1: 17, y1: 10, x2: 50, y2: 11, floor: 'ladrilho' },
  { id: 'palco', name: 'Palco', x1: 22, y1: 13, x2: 41, y2: 20, floor: 'palco' },
  { id: 'salao', name: 'Salão Principal', x1: 18, y1: 22, x2: 45, y2: 36, floor: 'xadrez' },
  { id: 'corredor_leste', name: 'Corredor Leste', x1: 47, y1: 10, x2: 50, y2: 36, floor: 'ladrilho' },
  { id: 'sala_secreta', name: 'Sala Secreta', x1: 52, y1: 1, x2: 62, y2: 10, floor: 'secreta', dark: true },
  { id: 'banheiros', name: 'Banheiros', x1: 52, y1: 12, x2: 62, y2: 20, floor: 'azulejo' },
  { id: 'cozinha', name: 'Cozinha', x1: 52, y1: 22, x2: 68, y2: 36, floor: 'cozinha' },
  { id: 'exterior', name: 'Área Externa', x1: 1, y1: 38, x2: 70, y2: 46, floor: 'externo', outdoor: true },

  // ---- ALA DE SERVIÇO (pedido de mapa maior/com função própria) ----
  // Só acessível de um jeito: pela Área Externa, pela porta d_ala_servico
  // (ver DOORS) — é um puxadinho de manutenção nos fundos do prédio, não
  // outra ala "principal". Sala de Máquinas é a entrada; dali um corredor
  // de serviço distribui pras outras 5 salas, cada uma com identidade e
  // função própria (não é só corredor comprido, ver PROPS/OBJECTS abaixo).
  { id: 'sala_maquinas', name: 'Sala de Máquinas', x1: 28, y1: 48, x2: 42, y2: 53, floor: 'maquinas', dark: true },
  { id: 'corredor_servico', name: 'Corredor de Serviço', x1: 5, y1: 55, x2: 69, y2: 56, floor: 'ladrilho' },
  { id: 'manutencao', name: 'Manutenção', x1: 5, y1: 58, x2: 16, y2: 63, floor: 'manutencao' },
  { id: 'sala_eletrica', name: 'Sala Elétrica', x1: 18, y1: 58, x2: 29, y2: 63, floor: 'eletrica' },
  { id: 'estoque', name: 'Estoque', x1: 31, y1: 58, x2: 44, y2: 63, floor: 'concreto' },
  { id: 'area_funcionarios', name: 'Área dos Funcionários', x1: 46, y1: 58, x2: 57, y2: 63, floor: 'carpete' },
  // Sala de Controle secundária: única área do mapa SEM câmera nenhuma
  // apontada pra ela (ver CAMERAS abaixo) — o próprio painel de câmeras
  // não alcança essa sala, de propósito.
  { id: 'sala_controle', name: 'Sala de Controle', x1: 59, y1: 58, x2: 68, y2: 63, floor: 'secreta', safeLight: true },
];
export const AREA_BY_ID = Object.fromEntries(AREAS.map((a, i) => [a.id, { ...a, index: i }]));

// Aberturas sem porta
const OPENINGS = [
  { x1: 26, y1: 21, x2: 37, y2: 21, area: 'salao' }, // palco aberto para o salão
  { x1: 31, y1: 37, x2: 32, y2: 37, area: 'salao' }, // entrada principal
];

// Portas: normal (qualquer um abre/fecha), power (porta blindada elétrica: gasta energia fechada)
export const DOORS = [
  { id: 'd_deposito', x: 12, y: 6, kind: 'normal', name: 'Porta do Depósito' },
  { id: 'd_seguranca', x: 12, y: 17, kind: 'power', name: 'Porta Blindada (Segurança)' },
  { id: 'd_escritorio', x: 12, y: 29, kind: 'power', name: 'Porta Blindada (Escritório)' },
  { id: 'd_porao', x: 30, y: 9, kind: 'normal', name: 'Escada do Porão' },
  { id: 'd_bastidores', x: 24, y: 12, kind: 'normal', name: 'Porta dos Bastidores' },
  { id: 'd_salao_oeste', x: 17, y: 28, kind: 'normal', name: 'Porta Oeste do Salão' },
  { id: 'd_salao_leste', x: 46, y: 28, kind: 'normal', name: 'Porta Leste do Salão' },
  { id: 'd_banheiros', x: 51, y: 16, kind: 'normal', name: 'Porta dos Banheiros' },
  { id: 'd_cozinha', x: 51, y: 28, kind: 'normal', name: 'Porta da Cozinha' },
  { id: 'd_secreta', x: 57, y: 11, kind: 'normal', name: 'Porta Selada' },
  { id: 'd_fundos', x: 60, y: 37, kind: 'normal', name: 'Porta dos Fundos' },

  // Segunda porta da Sala de Segurança (pedido: sala de segurança com duas
  // entradas, uma de cada lado — a existente d_seguranca já dá pro
  // Corredor Oeste a leste; essa aqui abre direto pro Depósito ao norte).
  // Dá pra perceber som vindo de UM lado específico sem ver o outro — é
  // essa assimetria que cria a tensão espacial pedida (ver TensionDirector
  // e os eventos 'passosAtras'/'somAssimetrico' em Match.js).
  { id: 'd_seguranca_norte', x: 6, y: 11, kind: 'normal', name: 'Porta Norte da Segurança' },

  // ---- Ala de Serviço ----
  { id: 'd_ala_servico', x: 35, y: 47, kind: 'normal', name: 'Porta da Ala de Serviço' },
  { id: 'd_maquinas_corredor', x: 35, y: 54, kind: 'normal', name: 'Porta da Sala de Máquinas' },
  { id: 'd_manutencao', x: 10, y: 57, kind: 'normal', name: 'Porta da Manutenção' },
  { id: 'd_eletrica', x: 23, y: 57, kind: 'power', name: 'Porta da Sala Elétrica' },
  { id: 'd_estoque', x: 37, y: 57, kind: 'normal', name: 'Porta do Estoque' },
  { id: 'd_funcionarios', x: 51, y: 57, kind: 'normal', name: 'Porta da Área dos Funcionários' },
  { id: 'd_controle', x: 63, y: 57, kind: 'normal', name: 'Porta da Sala de Controle' },
];
export const DOOR_BY_ID = Object.fromEntries(DOORS.map((d) => [d.id, d]));

// Objetos decorativos (solid bloqueia movimento)
export const PROPS = [];
function prop(type, x, y, solid = true, w = 1, h = 1) {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) PROPS.push({ type, x: x + i, y: y + j, solid });
}
// Salão
for (const x of [21, 25, 29, 34, 38, 42]) for (const y of [25, 29, 33]) prop('mesa', x, y);
prop('fliperama', 18, 31, true, 1, 5);
prop('balcao', 43, 35, true, 2, 1);
prop('bandeirolas', 20, 22, false, 24, 1);
// Palco
prop('cortina', 22, 13, false, 20, 1);
prop('bateria', 26, 15, false);
prop('microfone', 31, 14, false);
prop('teclado', 37, 15, false);
prop('caixa_som', 22, 20, true);
prop('caixa_som', 41, 20, true);
// Cozinha
prop('bancada', 55, 26, true, 6, 1);
prop('bancada', 55, 31, true, 6, 1);
prop('fogao', 68, 24, true, 1, 6);
prop('geladeira', 63, 22, true, 2, 1);
// Banheiros
prop('pia', 54, 20, true, 7, 1);
prop('divisoria', 54, 12, true, 1, 2);
prop('divisoria', 57 + 1, 12, true, 1, 2);
prop('divisoria', 61, 12, true, 1, 2);
// Depósito
prop('prateleira', 2, 3, true, 7, 1);
prop('prateleira', 2, 7, true, 7, 1);
// Segurança
prop('mesa_monitores', 3, 13, true, 6, 1);
prop('fitas', 9, 12, true, 2, 1);
// Escritório
prop('escrivaninha', 3, 26, true, 5, 1);
prop('estante', 5, 34, true, 4, 1);
// Corredores
prop('quadro', 14, 12, false);
prop('cadeiras', 42, 10, true);
// Porão
prop('caixotes', 20, 2, true, 2, 2);
prop('caixotes', 25, 6, true, 2, 1);
prop('canos', 18, 1, false, 28, 1);
prop('caldeira', 43, 6, true, 2, 2);
prop('pecas', 35, 3, false, 3, 1);
// Sala secreta
prop('pecas', 54, 5, false, 2, 2);
prop('pecas', 59, 6, false, 2, 1);
prop('cabos', 52, 1, false, 11, 1);
// Ala de Serviço — reaproveita o mesmo vocabulário visual de porão/cozinha/
// segurança (não inventa tipo de prop novo sem sprite: ver PROP_SPRITE em
// client/js/render.js e o switch em client/js/sprites.js drawProp — um tipo
// sem case ali não desenha nada, então reaproveitar é o que garante que
// essas salas não fiquem vazias).
prop('caldeira', 30, 49, true, 2, 2);
prop('caldeira', 38, 51, true, 2, 2);
prop('canos', 28, 48, false, 15, 1);
prop('pecas', 33, 52, false, 3, 1);
prop('prateleira', 6, 59, true, 7, 1);
prop('prateleira', 6, 62, true, 7, 1);
prop('caixotes', 13, 62, true, 2, 1);
prop('cabos', 18, 58, false, 11, 1);
prop('pecas', 22, 61, false, 3, 1);
prop('prateleira', 32, 59, true, 8, 1);
prop('caixotes', 32, 61, true, 2, 2);
prop('caixotes', 40, 61, true, 2, 1);
prop('mesa', 49, 60, false);
prop('mesa', 53, 60, false);
prop('cadeiras', 49, 62, true);
prop('quadro', 46, 58, false);
prop('mesa_monitores', 60, 59, true, 6, 1);
prop('fitas', 66, 61, true, 2, 1);
// Exterior
prop('carro', 8, 41, true, 3, 2);
prop('carro', 50, 42, true, 3, 2);
prop('arvore', 20, 44, true);
prop('arvore', 26, 40, true);
prop('arvore', 45, 45, true);
prop('arvore', 64, 45, true);
prop('placa', 36, 39, true);
prop('cerca', 1, 46, false, 34, 1);
prop('cerca', 36, 46, false, 35, 1);

// Objetos interativos
export const OBJECTS = [
  // Contêineres revistáveis
  { id: 'c_brinquedos', type: 'container', x: 19, y: 23, name: 'Caixa de Brinquedos' },
  { id: 'c_premios', type: 'container', x: 44, y: 23, name: 'Máquina de Prêmios' },
  { id: 'c_lixo_salao', type: 'container', x: 19, y: 36, name: 'Lixeira do Salão' },
  { id: 'c_case', type: 'container', x: 40, y: 18, name: 'Case de Instrumentos' },
  { id: 'c_fantasias', type: 'container', x: 23, y: 18, name: 'Baú de Fantasias' },
  { id: 'c_panelas', type: 'container', x: 53, y: 35, name: 'Armário de Panelas' },
  { id: 'c_geladeira', type: 'container', x: 67, y: 32, name: 'Geladeira Industrial' },
  { id: 'c_despensa', type: 'container', x: 61, y: 23, name: 'Despensa' },
  { id: 'c_limpeza', type: 'container', x: 62, y: 18, name: 'Armário de Limpeza' },
  { id: 'c_lixo_banheiro', type: 'container', x: 52, y: 19, name: 'Lixeira do Banheiro' },
  { id: 'c_papelao', type: 'container', x: 16, y: 33, name: 'Caixa de Papelão' },
  { id: 'c_achados', type: 'container', x: 13, y: 8, name: 'Achados e Perdidos' },
  { id: 'c_carrinho', type: 'container', x: 47, y: 13, name: 'Carrinho de Limpeza' },
  { id: 'c_manutencao', type: 'container', x: 50, y: 24, name: 'Caixa de Manutenção' },
  { id: 'c_arquivo', type: 'container', x: 10, y: 33, name: 'Arquivo de Aço' },
  { id: 'c_gaveta', type: 'container', x: 2, y: 25, name: 'Gaveta Emperrada' },
  { id: 'c_fitas', type: 'container', x: 10, y: 15, name: 'Armário de Fitas' },
  { id: 'c_pecas', type: 'container', x: 10, y: 4, name: 'Prateleira de Peças' },
  { id: 'c_fusiveis_velhos', type: 'container', x: 2, y: 5, name: 'Caixa Velha' },
  { id: 'c_bau_porao', type: 'container', x: 19, y: 7, name: 'Baú Empoeirado' },
  { id: 'c_ferramentas', type: 'container', x: 33, y: 2, name: 'Caixa de Ferramentas' },
  { id: 'c_capsula', type: 'container', x: 61, y: 9, name: 'Cápsula de Reparos' },
  { id: 'c_cacamba', type: 'container', x: 68, y: 44, name: 'Caçamba' },
  { id: 'c_correio', type: 'container', x: 3, y: 45, name: 'Caixa de Correio' },
  { id: 'c_bilheteria', type: 'container', x: 38, y: 36, name: 'Bilheteria' },

  // Esconderijos
  { id: 'h_armario_esc', type: 'hide', x: 1, y: 33, name: 'Armário' },
  { id: 'h_armario_seg', type: 'hide', x: 1, y: 21, name: 'Armário de Uniformes' },
  { id: 'h_deposito', type: 'hide', x: 1, y: 9, name: 'Atrás das Caixas' },
  { id: 'h_cabine1', type: 'hide', x: 53, y: 13, name: 'Cabine 1' },
  { id: 'h_cabine2', type: 'hide', x: 56, y: 13, name: 'Cabine 2' },
  { id: 'h_cabine3', type: 'hide', x: 60, y: 13, name: 'Cabine 3' },
  { id: 'h_cortina_e', type: 'hide', x: 22, y: 14, name: 'Atrás da Cortina' },
  { id: 'h_cortina_d', type: 'hide', x: 41, y: 14, name: 'Atrás da Cortina' },
  { id: 'h_armario_leste', type: 'hide', x: 50, y: 34, name: 'Armário de Funcionários' },
  { id: 'h_armario_oeste', type: 'hide', x: 13, y: 2, name: 'Armário Enferrujado' },
  { id: 'h_freezer', type: 'hide', x: 66, y: 35, name: 'Câmara Fria' },
  { id: 'h_caixote', type: 'hide', x: 44, y: 1, name: 'Caixote Grande' },
  { id: 'h_lixeira_ext1', type: 'hide', x: 4, y: 39, name: 'Lixeira Grande' },
  { id: 'h_lixeira_ext2', type: 'hide', x: 66, y: 39, name: 'Lixeira Grande' },
  { id: 'h_mesa_salao', type: 'hide', x: 42, y: 30, name: 'Debaixo da Mesa' },

  // Sistemas e missões
  { id: 'o_palco', type: 'investigate', x: 31, y: 16, name: 'Centro do Palco' },
  { id: 'o_fusiveis', type: 'fusebox', x: 11, y: 2, name: 'Caixa de Fusíveis' },
  { id: 'o_console_seg', type: 'console', x: 5, y: 14, name: 'Monitores de Segurança' },
  { id: 'o_console_esc', type: 'console', x: 5, y: 27, name: 'Monitor do Escritório' },
  { id: 'o_painel_cam', type: 'campanel', x: 11, y: 21, name: 'Painel das Câmeras' },
  { id: 'o_disjuntor', type: 'breaker', x: 1, y: 17, name: 'Disjuntor das Luzes' },
  { id: 'o_toca_fitas', type: 'tapedeck', x: 9, y: 25, name: 'Toca-fitas' },
  { id: 'o_telefone', type: 'phone', x: 2, y: 28, name: 'Telefone' },
  { id: 'o_gerador', type: 'generator', x: 40, y: 4, name: 'Gerador' },
  { id: 'o_cracha', type: 'keycutter', x: 6, y: 9, name: 'Máquina de Crachás' },
  { id: 'o_altar', type: 'altar', x: 57, y: 4, name: 'Altar de Controle' },
  { id: 'o_doc1', type: 'document', x: 53, y: 2, name: 'Relatório Rasgado' },
  { id: 'o_doc2', type: 'document', x: 61, y: 2, name: 'Planta do Maestro' },
  { id: 'o_doc3', type: 'document', x: 53, y: 9, name: 'Diário do Gerente' },
  { id: 'o_mural', type: 'lore', x: 31, y: 23, name: 'Mural de Aniversários' },
  { id: 'o_portao', type: 'gate', x: 35, y: 45, name: 'Portão de Saída' },

  // ---- Ala de Serviço ----
  // Só tipos 100% genéricos aqui (container/hide/console/breaker) — nenhum
  // deles depende de nenhuma quest/id pré-cadastrado em outro arquivo (ver
  // interactObject() em Match.js: 'document'/'investigate'/'campanel'/
  // 'generator' são amarrados a quests específicas e um objeto novo desses
  // sem uma quest cadastrada pra ele ficaria mudo — por isso não usei
  // nenhum desses tipos aqui).
  { id: 'c_maquinas', type: 'container', x: 41, y: 50, name: 'Caixa de Ferramentas Pesadas' },
  { id: 'c_kit_manutencao', type: 'container', x: 15, y: 59, name: 'Kit de Manutenção' },
  { id: 'c_estoque_ala', type: 'container', x: 43, y: 59, name: 'Caixa de Estoque' },
  { id: 'c_funcionarios_ala', type: 'container', x: 56, y: 61, name: 'Armário dos Funcionários' },
  { id: 'c_controle', type: 'container', x: 67, y: 62, name: 'Gaveta da Sala de Controle' },
  { id: 'h_maquinas', type: 'hide', x: 29, y: 52, name: 'Atrás da Caldeira' },
  { id: 'h_eletrica', type: 'hide', x: 19, y: 62, name: 'Atrás dos Painéis' },
  // Segundo disjuntor físico: reaproveita o mesmo type 'breaker' do
  // o_disjuntor original — interactObject() só olha o.type, então isso já
  // funciona como um segundo interruptor de verdade pras mesmas luzes
  // (ver o case 'breaker' em Match.js), sem precisar de nenhuma lógica nova.
  { id: 'o_disjuntor2', type: 'breaker', x: 20, y: 60, name: 'Disjuntor Auxiliar' },
  // Segundo painel de câmeras: mesmo raciocínio, o case 'console' só abre
  // o painel de câmeras de todo mundo — não é um console "da sala", é só
  // mais um jeito de acessar o mesmo sistema.
  { id: 'o_console_controle', type: 'console', x: 61, y: 61, name: 'Console de Controle' },
];
export const OBJECT_BY_ID = Object.fromEntries(OBJECTS.map((o) => [o.id, o]));

// Câmeras de segurança
export const CAMERAS = [
  { id: 'cam1', name: 'CAM 01 · Salão', area: 'salao', cx: 31.5, cy: 29, vw: 30, vh: 17 },
  { id: 'cam2', name: 'CAM 02 · Palco', area: 'palco', cx: 31.5, cy: 16.5, vw: 22, vh: 12 },
  { id: 'cam3', name: 'CAM 03 · Corredor Oeste', area: 'corredor_oeste', cx: 15, cy: 18, vw: 16, vh: 20 },
  { id: 'cam4', name: 'CAM 04 · Corredor Leste', area: 'corredor_leste', cx: 49, cy: 23, vw: 16, vh: 20 },
  { id: 'cam5', name: 'CAM 05 · Cozinha', area: 'cozinha', cx: 60.5, cy: 29, vw: 19, vh: 16 },
  { id: 'cam6', name: 'CAM 06 · Banheiros', area: 'banheiros', cx: 57.5, cy: 16.5, vw: 14, vh: 11 },
  { id: 'cam7', name: 'CAM 07 · Depósito', area: 'deposito', cx: 6.5, cy: 5.5, vw: 14, vh: 12 },
  { id: 'cam8', name: 'CAM 08 · Corredor Norte', area: 'corredor_norte', cx: 33, cy: 10.5, vw: 36, vh: 8 },
  { id: 'cam9', name: 'CAM 09 · Porão', area: 'porao', cx: 31.5, cy: 5, vw: 30, vh: 10 },
  { id: 'cam10', name: 'CAM 10 · Área Externa', area: 'exterior', cx: 35, cy: 42, vw: 40, vh: 12 },
  { id: 'cam11', name: 'CAM 11 · Sala Secreta', area: 'sala_secreta', cx: 57, cy: 5.5, vw: 14, vh: 12 },
  // Ala de Serviço — 5 câmeras novas cobrem 5 das 6 salas; a Sala de
  // Controle (ver AREAS) fica de propósito fora da rede de câmeras.
  { id: 'cam12', name: 'CAM 12 · Sala de Máquinas', area: 'sala_maquinas', cx: 35, cy: 50.5, vw: 15, vh: 6 },
  { id: 'cam13', name: 'CAM 13 · Corredor de Serviço', area: 'corredor_servico', cx: 37, cy: 55.5, vw: 65, vh: 3 },
  { id: 'cam14', name: 'CAM 14 · Manutenção', area: 'manutencao', cx: 10.5, cy: 60.5, vw: 12, vh: 6 },
  { id: 'cam15', name: 'CAM 15 · Sala Elétrica', area: 'sala_eletrica', cx: 23.5, cy: 60.5, vw: 12, vh: 6 },
  { id: 'cam16', name: 'CAM 16 · Estoque', area: 'estoque', cx: 37.5, cy: 60.5, vw: 14, vh: 6 },
  { id: 'cam17', name: 'CAM 17 · Área dos Funcionários', area: 'area_funcionarios', cx: 51.5, cy: 60.5, vw: 12, vh: 6 },
];
export const CAMERA_BY_ID = Object.fromEntries(CAMERAS.map((c) => [c.id, c]));

export const SPAWN_POINTS = [
  { x: 30.5, y: 41.5 }, { x: 33.5, y: 41.5 }, { x: 30.5, y: 43.5 }, { x: 33.5, y: 43.5 },
  { x: 28.5, y: 42.5 }, { x: 35.5, y: 42.5 }, { x: 32, y: 40.5 }, { x: 32, y: 44.5 },
];
export const RESPAWN_POINT = { x: 6.5, y: 30.5 }; // escritório

// ---------- Construção da grade ----------
export const grid = new Uint8Array(MAP_W * MAP_H).fill(TILE.WALL);
export const areaGrid = new Int8Array(MAP_W * MAP_H).fill(-1);

AREAS.forEach((a, i) => {
  for (let y = a.y1; y <= a.y2; y++)
    for (let x = a.x1; x <= a.x2; x++) {
      grid[y * MAP_W + x] = TILE.FLOOR;
      if (areaGrid[y * MAP_W + x] === -1) areaGrid[y * MAP_W + x] = i;
    }
});
for (const o of OPENINGS) {
  for (let y = o.y1; y <= o.y2; y++)
    for (let x = o.x1; x <= o.x2; x++) {
      grid[y * MAP_W + x] = TILE.FLOOR;
      areaGrid[y * MAP_W + x] = AREA_BY_ID[o.area].index;
    }
}
for (const d of DOORS) {
  grid[d.y * MAP_W + d.x] = TILE.FLOOR;
  // área da porta = área vizinha mais "interna"
  const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => areaGrid[(d.y + dy) * MAP_W + d.x + dx]).filter((v) => v >= 0);
  areaGrid[d.y * MAP_W + d.x] = n[0] ?? -1;
  d.horizontal = grid[d.y * MAP_W + d.x - 1] === TILE.WALL; // parede à esquerda/direita => porta horizontal? (bloqueia N-S)
  d.areas = [...new Set(n.map((i) => AREAS[i].id))];
}
for (const p of PROPS) if (p.solid) grid[p.y * MAP_W + p.x] = TILE.SOLID;
for (const o of OBJECTS) {
  o.area = AREAS[areaGrid[o.y * MAP_W + o.x]]?.id || null;
  if (o.type === 'hide') grid[o.y * MAP_W + o.x] = TILE.SOLID;
}

export function tileAt(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return TILE.WALL;
  return grid[y * MAP_W + x];
}
export function areaAt(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return null;
  const i = areaGrid[ty * MAP_W + tx];
  return i >= 0 ? AREAS[i] : null;
}

const doorIndex = new Map(DOORS.map((d) => [d.y * MAP_W + d.x, d]));
export function doorAtTile(tx, ty) {
  return doorIndex.get(ty * MAP_W + tx) || null;
}

/**
 * Colisão de círculo contra a grade. `isDoorClosed(doorId)` informa o estado atual das portas.
 */
export function blockedTile(tx, ty, isDoorClosed) {
  const t = tileAt(tx, ty);
  if (t !== TILE.FLOOR) return true;
  const d = doorIndex.get(ty * MAP_W + tx);
  return !!(d && isDoorClosed(d.id));
}

function collides(x, y, r, isDoorClosed) {
  const minX = Math.floor(x - r), maxX = Math.floor(x + r);
  const minY = Math.floor(y - r), maxY = Math.floor(y + r);
  for (let ty = minY; ty <= maxY; ty++)
    for (let tx = minX; tx <= maxX; tx++) {
      if (!blockedTile(tx, ty, isDoorClosed)) continue;
      const cx = Math.max(tx, Math.min(x, tx + 1));
      const cy = Math.max(ty, Math.min(y, ty + 1));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  return false;
}

/** Move com colisão eixo a eixo (desliza nas paredes). */
export function moveWithCollision(x, y, dx, dy, r, isDoorClosed) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx && !collides(x + sx, y, r, isDoorClosed)) x += sx;
    if (sy && !collides(x, y + sy, r, isDoorClosed)) y += sy;
  }
  return { x, y };
}

/** Linha de visão (DDA) — paredes, props sólidos altos e portas fechadas bloqueiam. */
export function lineOfSight(x0, y0, x1, y1, isDoorClosed) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / 0.25);
  for (let i = 1; i < steps; i++) {
    const px = x0 + (dx * i) / steps, py = y0 + (dy * i) / steps;
    const tx = Math.floor(px), ty = Math.floor(py);
    const t = tileAt(tx, ty);
    if (t === TILE.WALL) return false;
    const d = doorIndex.get(ty * MAP_W + tx);
    if (d && isDoorClosed(d.id)) return false;
  }
  return true;
}

export function randomFloorInArea(areaId, rand = Math.random) {
  const a = AREA_BY_ID[areaId];
  for (let tries = 0; tries < 60; tries++) {
    const x = a.x1 + Math.floor(rand() * (a.x2 - a.x1 + 1));
    const y = a.y1 + Math.floor(rand() * (a.y2 - a.y1 + 1));
    if (tileAt(x, y) === TILE.FLOOR && !doorAtTile(x, y)) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: (a.x1 + a.x2) / 2 + 0.5, y: (a.y1 + a.y2) / 2 + 0.5 };
}
