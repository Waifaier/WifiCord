# 🌙 Meia-Lua: Turno da Noite

RPG multiplayer online de terror, cooperativo, em uma pizzaria abandonada. Original — apenas inspirado no gênero "sobreviva à noite". Personagens, mapa, história, arte e sons são próprios: gráficos desenhados via Canvas e sons sintetizados com Web Audio (nenhum arquivo de terceiros).

- **Front-end:** HTML5 + CSS3 + JavaScript (módulos ES, sem build)
- **Back-end:** Node.js + Express
- **Tempo real:** Socket.IO (servidor autoritativo)
- **Banco:** SQLite (módulo nativo `node:sqlite`, nada para compilar)
- **Voz:** WebRTC P2P com STUN público gratuito
- **Custo:** zero. Sem API paga, sem chave de API.

---

## 1. Rodar localmente

### Jeito mais fácil (Windows)
1. Instale o **Node.js LTS** em https://nodejs.org (só na primeira vez).
2. Extraia o zip.
3. Entre na pasta `game` e dê **dois cliques em `iniciar.bat`**.
4. O navegador abre sozinho em http://localhost:3000. Para desligar, feche a janela preta.

(Linux/Mac/Chromebook: rode `./iniciar.sh`.)

### Jeito manual

Requisito: **Node.js 22.13 ou mais novo** (recomendado: Node 24 LTS). Confira com `node -v`.

```bash
cd game
npm install
npm start
```

Abra **http://localhost:3000**.

Opcional: copie `.env.example` para `.env` e ajuste (porta, duração da noite, jogadores por sala…).

> O banco `data/game.sqlite` é criado sozinho na primeira execução.
> Aviso "ExperimentalWarning: SQLite" é normal no Node 22 e pode ser ignorado.
> Se usar Node mais antigo: `npm i better-sqlite3` e o jogo usa esse driver automaticamente.

### Testar o multiplayer na mesma máquina
Abra duas janelas (uma normal e uma anônima, para serem contas diferentes):
1. Janela 1: *Convidado* → **Criar sala** → recebe o código (ex.: `NOITE-4821`).
2. Janela 2: *Convidado* → **Entrar em sala** → digita o código (ou só `4821`) → **Estou pronto**.
3. Janela 1: **Iniciar partida**.

### Jogar com amigos na mesma rede Wi-Fi
Descubra o IP do seu PC (`ipconfig` no Windows, `ip a` no Linux/Chromebook) e peça para eles abrirem `http://SEU_IP:3000`.
*Obs.: o microfone só funciona em `localhost` ou HTTPS — use uma das opções de deploy abaixo para voz entre máquinas.*

### Teste automatizado do fluxo completo
```bash
npm test
```
Sobe um servidor temporário e simula 2 jogadores: criar sala → entrar → iniciar → mover → trapaça de velocidade bloqueada → interagir → missão concluída → animatrônico persegue → noite termina → XP concedido → progresso salvo no SQLite → Noite 2 liberada.

---

## 2. Deploy gratuito

### Opção A — Seu PC + Cloudflare Tunnel (grátis, banco persistente, HTTPS)
Melhor opção para jogar com amigos: o SQLite fica no seu computador e nada se perde.
1. `npm start`
2. Instale o [cloudflared](https://github.com/cloudflare/cloudflared) e rode:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Ele mostra um link `https://algo.trycloudflare.com`. Mande para seus amigos. WebSocket e microfone funcionam (é HTTPS).

O link muda cada vez que você roda o comando. Para um link fixo, crie um túnel nomeado na conta gratuita da Cloudflare.

### Opção B — Render (plano Free)
1. Suba o projeto para um repositório no GitHub (o `.gitignore` já exclui `node_modules`, `data` e `.env`).
2. Em render.com → **New → Web Service** → conecte o repositório.
3. Configure:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
   - Environment: `NODE_VERSION=24` (e, se quiser, `NIGHT_SECONDS`, `MAX_PLAYERS_PER_ROOM`)
4. Deploy. O Render define `PORT` automaticamente.

⚠ Limitações do plano gratuito do Render ([docs](https://render.com/docs/free)):
- O serviço "dorme" após ~15 min sem acesso e demora ~1 min para acordar.
- O disco é **efêmero**: o arquivo SQLite é apagado quando o serviço reinicia, dorme ou é reimplantado. Contas e progresso **não** sobrevivem a isso. Use a Opção A se quiser progresso permanente, ou troque o SQLite por um banco gerenciado gratuito no futuro.

### Voz (WebRTC)
Usa STUN público gratuito (`stun.l.google.com`). Funciona na maioria das redes domésticas e 4G. Em redes muito restritivas (algumas empresas/escolas) pode ser necessário um servidor TURN — dá para rodar um **coturn** gratuito no seu PC e adicionar em `ICE_SERVERS` no `.env`.

---

## 3. Como jogar

| Ação | PC | Celular |
|---|---|---|
| Mover | `W A S D` / setas | joystick |
| Correr | `Shift` | 🏃 (segurar) |
| Andar agachado (silencioso) / prender a respiração no esconderijo | `Espaço` (segurar) | 🤫 (segurar) |
| Checklist da noite | `J` | 📋 |
| Interagir / revistar / esconder / portas | `E` | **E** |
| Lanterna | `F` | 🔦 |
| Inventário | `TAB` | 🎒 |
| Mapa | `M` | 🗺 |
| Câmeras (perto de um monitor ou com Tablet) | `C` · `Q`/`R` trocam | 📷 |
| Usar item | `1`–`5` | barra inferior |
| Chat | `Enter` | 💬 |
| Falar (se push-to-talk ativo) | `V` | — |
| Menu | `ESC` | ☰ |

**Dicas:** a seta no topo da tela aponta para o próximo objetivo e o checklist (J) explica cada missão. Correr faz barulho e atrai animatrônicos. Esconda-se em armários — mas não na frente deles. Portas blindadas (Segurança e Escritório) seguram quase todos, mas gastam energia. A Lume enxerga lanternas acesas de longe. O Tonho congela enquanto alguém o observa pelas câmeras.

---

## 4. Funcionalidades implementadas

**Multiplayer real (servidor autoritativo)**
- Contas (convidado, registro e login com senha `scrypt`), sessões por token, converter convidado em conta.
- Salas com código `NOITE-XXXX`, salas públicas listadas, limite configurável de jogadores, anfitrião, "pronto", expulsar, troca automática de anfitrião.
- Lobby com chat, escolha de noite (limitada ao progresso do anfitrião) e início sincronizado.
- Partida simulada no servidor a 20 ticks/s; snapshots a 10/s com dados filtrados por jogador.
- Cliente envia **só direção** do movimento; servidor calcula posição, colisão e velocidade (limitador contra aceleração por DevTools).
- Predição local + reconciliação para o próprio jogador; interpolação para os demais.
- Reconexão: se cair durante a partida, tem 60s para voltar ao mesmo personagem.
- Uma conexão por conta; rate-limit por evento; validação de todos os dados recebidos.
- Fim de partida simultâneo para todos, com tela de resultados e volta ao lobby.

**RPG**
- Nível, XP (curva progressiva), dinheiro, 2 pontos de atributo por nível.
- Atributos com efeito real: **Coragem** (medo e atordoamento), **Investigação** (tempo de revista, dinheiro, sentir itens de missão próximos), **Velocidade** (movimento e stamina), **Resistência** (HP e redução de dano), **Técnica** (conserto e gasto das câmeras).
- Inventário persistente, 4 slots de equipamento (lanterna, corpo, pés, acessório), 10 equipamentos, 5 consumíveis, 7 itens de missão.
- Loja validada no servidor.
- Estatísticas salvas: noites jogadas/vencidas, missões, itens, sustos, mortes, tempo, final verdadeiro; progresso por noite; ranking.

**Mundo**
- Pizzaria com 13 áreas: Salão, Palco, Cozinha, Escritório, Corredores Oeste/Norte/Leste, Banheiros, Sala de Segurança, Depósito, Sala Secreta, Porão, Área Externa.
- 11 portas (normais, blindadas elétricas, trancadas por chave ou seladas por noite), 25 contêineres com saque aleatório, 15 esconderijos, 11 câmeras, disjuntor de luzes, telefone, gerador, altar, documentos.

**Animatrônicos originais (IA no servidor)**
- Estados `IDLE → PATROL → INVESTIGATE → CHASE → SEARCH → RETURN` + `STUNNED`, `DORMANT`, `DISABLED`.
- Visão com campo de visão, alcance e linha de visão (paredes/portas bloqueiam); audição de passos, corrida, portas, respiração ofegante e eventos; pathfinding A*.
- **Tonho, o Tatu Baterista** — congela quando observado nas câmeras; rola em alta velocidade e fica tonto.
- **Marola, a Foca Cantora** — arrancada fortíssima e curta, depois cansa.
- **Lume, a Mariposa Lanterneira** — atraída por lanternas e luz.
- **Gregório, o Gorila Garçom** — ouve de longe, abre portas rápido, esmurra portas blindadas drenando energia até arrombar.
- **O Maestro** (noite final) — dormente até 3:00; enxerga 360°, rege os outros até o alvo e "pisca" para perto dos jogadores.
- Comportamento influenciado pelos jogadores (área onde estão, barulho, luz, câmeras).

**Sistemas da noite**
- 5 noites com progressão (novos inimigos, áreas, agressividade e mecânicas) e Noite Final com evento especial, final verdadeiro (desligar o Maestro e fugir) e final ruim.
- Relógio 00:00 → 06:00, energia limitada (portas blindadas, luzes, câmeras), apagão com portas destravadas e câmeras offline.
- Missões cooperativas sincronizadas com pré-requisitos, progresso compartilhado e recompensas para a equipe.
- Medo, stamina, bateria da lanterna, dano, morte, retornos (respawn) limitados por noite, espectador.
- Eventos aleatórios ponderados, sem repetição imediata: luzes piscando, portas batendo, câmeras falhando, objetos arrastados, sons misteriosos (que atraem inimigos), aparições, mudança de rota, sussurros, telefone secreto, dinheiro dourado, surto de energia.

**Interface e áudio**
- Menu, Jogar/Solo, Criar/Entrar em sala, Lobby, Perfil, Inventário & Loja, Configurações, Créditos, Resultados.
- HUD: HP, stamina, medo, bateria, XP/nível/dinheiro, energia com barra de consumo, relógio, missões, equipe, barra de itens, prompts de interação, indicadores de som.
- Estilo CRT/VHS, glitch, câmeras com estática/visão noturna/sinal perdido, mapa completo, jumpscares.
- Iluminação dinâmica (salas acesas, escuridão, cone de lanterna, sinalizadores).
- Áudio sintetizado: passos, portas, máquinas (gerador, câmara fria, zumbido), interferência, ambiente, perseguição, batimentos, eventos e jumpscares com posição estéreo.
- Controles touch (joystick + botões), layout responsivo, opção de qualidade baixa.
- Voz WebRTC com volume por proximidade e push-to-talk.

---

## 4.1 Novidades da versão 2

- **Sprites em pixel art originais** (`client/assets/sprites/`): 6 animatrônicos com poses de parado, andando, perseguindo e atordoado; vigias em 8 cores; 21 objetos; pisos e paredes com variações. Gerados por `tools/gerar_sprites.py` (Python + Pillow).
- **Jumpscares novos**: corte seco para o preto, rosto em pixel art avançando na tela com mandíbula animada, tremor, rasgos de VHS, flash e grito metálico distorcido. Golpe fatal tem versão mais longa com "VOCÊ FOI PEGO".
- **Shader WebGL** (`client/js/postfx.js`): tela CRT curva, aberração cromática, granulação, bloom, faixas de VHS, vinheta que pulsa com o coração, tons vermelhos no dano e no apagão. Ajustável em Configurações (Alto / Leve / Desligado).
- **Imersão**: olhos dos animatrônicos brilhando na escuridão, alucinações quando o medo está alto (olhos e vultos falsos, passos), chuva e relâmpagos na área externa, luzes de emergência piscando no apagão, poeira no feixe da lanterna, lanterna falhando com pouca bateria, relógio com glitch.
- **Mais difícil**: seletor de dificuldade (Normal, Difícil, Pesadelo sem retornos), animatrônicos mais rápidos e atentos, menos retornos, energia e bateria acabam mais rápido, Marola já aparece na Noite 1.
- **Novo animatrônico: Pipoca, o Macaco dos Pratos** — armadilha sonora que bate os pratos e chama todos os outros; muda de lugar quando ninguém olha.
- **Novas mecânicas**: andar agachado, prender a respiração dentro do esconderijo (se ficar sem ar, você ofega e é encontrado), item **Rádio Isca** para atrair inimigos, animatrônicos "ligando" no palco nos primeiros segundos.
- **Checklist e seta de objetivo**: painel (J) com cada missão, dica de onde ir, pré-requisitos, primeiros passos marcados automaticamente e o que cada animatrônico da noite faz.

## 4.2 Novidades da versão 3

- **Tensão quando um animatrônico te vê**: antes de perseguir, ele para e te encara enquanto a "suspeita" enche (mais rápido se você estiver perto, na luz, de lanterna ou correndo; mais devagar agachado). Nesse tempo: olho vermelho abrindo na tela, barras de cinema fechando, zoom de visão de túnel, batimento acelerando, som dissonante subindo, bordas vermelhas pulsando e um brilho indicando de onde vem o olhar. Se você sair da vista a tempo, ele vai investigar onde te viu.
- **Textos na voz do vigia**: avisos, dicas, anotações (J), introdução das noites, conclusão de missões, descrição dos animatrônicos e resultados agora são pensamentos do guarda. Mensagens dos colegas chegam como falas de rádio (`shared/falas.js`).
- Servidor não deixa mais o navegador usar arquivos antigos em cache após atualizar.

## 5. Ideias para próximas versões

- Banco gerenciado gratuito (ex.: Postgres/Turso) para progresso permanente em hospedagem efêmera.
- Sprites e sons próprios em arquivo (pixel art / gravações CC0) substituindo os procedurais.
- Mais noites, modo "Noite Personalizada" com dificuldade por animatrônico, conquistas.
- Classes de vigia (Técnico, Detetive, Atleta) e árvore de habilidades.
- Crafting (baterias, armadilhas sonoras), itens raros e trocas entre jogadores.
- Sombreamento com linha de visão no cliente (fog of war real).
- Modo PvP assimétrico (um jogador controla um animatrônico).
- Servidor TURN próprio e chat de voz por rádio (canal com estática).
- Painel de administração, moderação do chat e denúncias.
- PWA instalável e suporte a gamepad.

---

## 6. Estrutura

```
game/
├── client/              # front-end estático
│   ├── index.html
│   ├── css/style.css
│   ├── js/              # main, game, render, sprites, audio, input, voice, api, settings, ui
│   ├── assets/icon.svg
│   └── audio/README.md  # sons são sintetizados em js/audio.js
├── shared/              # código usado por servidor E cliente
│   ├── map.js           # mapa, colisão, linha de visão
│   ├── items.js         # itens e loja
│   ├── nights.js        # noites, missões, lore, animatrônicos
│   └── rpg.js           # fórmulas de nível/atributos
├── server/
│   ├── server.js
│   ├── config.js
│   ├── sockets/index.js # eventos Socket.IO + rate limit
│   ├── game/            # Match (simulação), RoomManager (salas/lobby), loot
│   ├── ai/              # Animatronic (máquina de estados), pathfinding A*, tipos
│   ├── database/        # SQLite: schema, contas, progresso
│   └── routes/api.js    # REST: auth, perfil, inventário, loja, ranking
├── tools/               # gerador dos sprites em pixel art (Python)
├── tests/flow.test.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

**Ajustar dificuldade:** `shared/nights.js` (agressividade, energia, retornos, eventos) e `server/ai/types.js` (velocidade, visão, audição, dano de cada animatrônico).
