/* =====================================================================
   camera-filters.js — motor de filtros de câmera do WifiCord.

   Isto é uma extração/adaptação do protótipo "Cabine de Filtros"
   (prototypes/cabine-de-filtros.html): os ~43 filtros, o rastreamento de
   rosto/mão via MediaPipe (com plano B manual quando ele não carrega) e o
   sistema de partículas de reação foram todos portados sem alteração de
   comportamento. O que MUDOU foi a forma de entrada/saída de vídeo:

     - O protótipo chamava getUserMedia() sozinho e desenhava num canvas
       VISÍVEL na tela (era uma página inteira dedicada a isso).
     - Este módulo NUNCA chama getUserMedia. Ele recebe de fora uma
       MediaStreamTrack de vídeo crua (já obtida pelo código de call, que é
       quem sabe negociar câmera/permissões/dispositivo) e devolve outra
       MediaStreamTrack, processada, pronta pra entrar num
       RTCRtpSender.replaceTrack(). O canvas e o <video> intermediário
       existem, mas ficam fora da tela o tempo todo — ninguém olha pra eles
       diretamente, só pro resultado que sai via canvas.captureStream().

   Uso esperado pelo código de call:

     await window.WifiCordFilters.attach(rawVideoTrack);   // 1x por call
     sender.replaceTrack(window.WifiCordFilters.currentOutputTrack);
     window.WifiCordFilters.setFilter('cachorro');          // troca de filtro
     // ...troca de câmera/dispositivo durante a call:
     await window.WifiCordFilters.attach(novaRawTrack);     // reusa o pipeline
     // ...fim da call:
     window.WifiCordFilters.detach();

   API pública, tudo pendurado em window.WifiCordFilters (script global
   comum, sem type="module" — mesmo padrão dos outros arquivos em
   client/js/*.js):

     listFilters()        -> [{id, name, icon}, ...]
     attach(rawTrack)      -> Promise<MediaStreamTrack>  (track processada de saída)
     setFilter(id)          -> void   (id nulo ou 'original' = sem filtro/passthrough)
     isFilterActive()       -> bool
     detach()               -> void
     currentOutputTrack     -> getter, MediaStreamTrack | null
   ===================================================================== */
(function () {
  'use strict';

  /* =====================================================================
     CONSTANTES
     ===================================================================== */
  // Mesmo CDN/modelos do protótipo — trocar de versão aqui é o único lugar
  // que precisa mudar se um dia atualizarmos o MediaPipe.
  const MP_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

  // FPS fixo do canvas.captureStream(). Não precisa bater com o fps real da
  // câmera crua — é só o teto de quadros que a track de SAÍDA pode emitir.
  // 30 é um valor seguro e universal pra uma chamada de vídeo.
  const CAPTURE_FPS = 30;

  const DEFAULT_W = 640, DEFAULT_H = 480; // fallback quando a track não informa resolução

  // Teto de resolução INTERNA do pipeline de filtros (independente da
  // resolução real da câmera). A chamada pede até 1920x1080 (ou
  // 3840x2160 pra quem tem WFNA — ver makeMediaConstraints em call.js), e
  // processar CADA pixel disso — detecção do MediaPipe, gradientes,
  // partículas, remapeamento térmico pixel a pixel — em toda uma câmera
  // 1080p/4K a cada frame é pesado demais pra qualquer celular aguentar
  // (relato real: "meu celular só faltou explodir"). 720px no lado maior
  // já é mais que suficiente pra uma prévia de chamada de vídeo (ninguém
  // vê o filtro em tela cheia 4K) e derruba o custo por pixel em várias
  // vezes comparado a 1080p/4K — a saída ainda vai pro WebRTC normalmente,
  // só processada numa resolução menor.
  const MAX_DIM = 720;

  /* =====================================================================
     ESTADO DO PIPELINE (vídeo oculto -> canvas oculto -> captureStream)
     Tudo isso é construído UMA VEZ em attach() e reaproveitado em chamadas
     seguintes (troca de câmera/dispositivo), como pedido: não recriamos
     canvas/contexto/track de saída a cada troca, só trocamos a entrada.
     ===================================================================== */
  let video = null;          // <video> oculto, só recebe a track crua de entrada
  let canvas = null;         // canvas oculto onde os filtros desenham
  let ctx = null;            // contexto 2D do canvas acima
  let rawStream = null;      // MediaStream([rawTrack]) atual, só pra alimentar o <video>
  let outputStream = null;   // canvas.captureStream(CAPTURE_FPS)
  let outputTrack = null;    // track de vídeo processada, devolvida pro chamador

  let vw = 0, vh = 0;        // resolução de trabalho do canvas (= resolução da track de entrada)
  let attached = false;      // true depois do primeiro attach() bem-sucedido
  let trackingStarted = false; // evita reinicializar o MediaPipe a cada attach()

  let intensity = 0.6; // no protótipo isso vinha de um slider; aqui fica fixo num valor
                        // central equivalente — nenhum filtro depende de UI pra funcionar.

  /* =====================================================================
     LOOPS DE RENDER
     Há dois loops, e só um deles roda por vez:

     1) Loop "pesado" (requestAnimationFrame): roda o filtro ativo de
        verdade — detecção de rosto/mão, partículas, todo o desenho do
        filtro. Só existe enquanto um filtro estiver selecionado.

     2) Loop de passthrough (requestVideoFrameCallback no <video>): quando
        nenhum filtro está ativo ('original'/null), o filtro é "não fazer
        nada" — não faz sentido pagar o custo de um rAF completo + toda a
        lógica de detecção/partículas só pra espelhar o vídeo sem tocar
        nele. Só assim dá pra cumprir "zero-overhead passthrough" de
        verdade.

        Só que a track de SAÍDA (canvas.captureStream) precisa continuar
        entregando vídeo AO VIVO mesmo nesse estado — se simplesmente
        parássemos de desenhar, o último quadro desenhado ficaria
        "congelado" pra sempre no canvas, e quem está do outro lado da
        call veria uma imagem parada. A solução mais simples e correta:
        continuamos desenhando, só que pelo caminho mais barato possível
        (um drawImage espelhado, sem nenhuma lógica de filtro) e só
        exatamente quando o <video> realmente tem um quadro novo — é pra
        isso que serve requestVideoFrameCallback, que dispara só na
        cadência real de quadros da câmera (tipicamente ~30fps), em vez de
        um rAF genérico que dispararia até mais rápido que isso à toa.
        Deixamos o captureStream() no seu comportamento padrão (CAPTURE_FPS
        fixo definido na criação) — ele só reamostra o que já está no
        canvas, então continua funcionando perfeitamente desde que o
        canvas continue sendo atualizado por este loop leve.
     ===================================================================== */
  let rafId = null;
  let renderLoopRunning = false;
  let lastTs = 0;

  let vfcHandle = null;           // handle do requestVideoFrameCallback (ou do setInterval de fallback)
  let vfcIsInterval = false;      // true quando caímos no fallback de setInterval
  let passthroughRunning = false;

  let activeFilterId = null; // null = passthrough (sem filtro). string = id de FILTERS.
  let activeIndex = -1;      // índice correspondente em FILTERS, -1 quando activeFilterId é null

  /* =====================================================================
     RASTREAMENTO (MediaPipe: rosto, mão e segmentação de pessoa) — idêntico
     ao protótipo: cada tarefa carrega e falha de forma independente, com
     plano B manual próprio por tarefa.
     ===================================================================== */
  let faceLandmarker = null, handLandmarker = null, imageSegmenter = null;
  let trackingMode = 'loading'; // loading | active | manual  (rosto)
  let handMode = 'loading';     // loading | active | manual  (mão)
  let segMode = 'loading';      // loading | active | manual  (fundo desfocado)
  let lastVideoTs = -1, lastHandTs = -1, lastSegTs = -1;
  let faceDetected = false, handDetected = false;

  // alvo cru (por frame de detecção) e valor suavizado (por frame de render)
  const BS_DEFAULT = { smile: 0, blinkL: 0, blinkR: 0, browUp: 0, pucker: 0, cheekPuff: 0, browDown: 0, eyeWide: 0, mouthFrown: 0, noseSneer: 0 };
  const faceRaw = { nose: { x: 0, y: 0 }, earL: { x: 0, y: 0 }, earR: { x: 0, y: 0 }, eyeL: { x: 0, y: 0 }, eyeR: { x: 0, y: 0 }, mouth: { x: 0, y: 0 }, center: { x: 0, y: 0 }, scale: 1, roll: 0, jawOpen: 0, bs: { ...BS_DEFAULT } };
  const face = { nose: { x: 0, y: 0 }, earL: { x: 0, y: 0 }, earR: { x: 0, y: 0 }, eyeL: { x: 0, y: 0 }, eyeR: { x: 0, y: 0 }, mouth: { x: 0, y: 0 }, center: { x: 0, y: 0 }, scale: 1, roll: 0, jawOpen: 0, bs: { ...BS_DEFAULT }, ready: false };
  const handRaw = { center: { x: 0, y: 0 }, scale: 1, roll: 0, openness: 0 };
  const hand = { center: { x: 0, y: 0 }, scale: 1, roll: 0, openness: 0, ready: false };
  // moldura das duas mãos (filtro "Moldura Mágica") — só existe em rastreamento
  // ativo de verdade, não dá pra simular com uma âncora manual só.
  let handsFrameRaw = null, handsFrameSeen = false;
  let handsFrame = [null, null, null, null], handsFrameReady = false, handsFrameAlpha = 0;

  async function initTracking() {
    let vision, fileset;
    try {
      vision = await import(MP_CDN);
      fileset = await vision.FilesetResolver.forVisionTasks(MP_CDN + '/wasm');
    } catch (e) {
      console.warn('[WifiCordFilters] Biblioteca de rastreamento indisponível, tudo em modo manual:', e);
      trackingMode = 'manual'; handMode = 'manual'; segMode = 'manual';
      return;
    }

    async function makeTask(Cls, modelAssetPath, extraOpts) {
      try { return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate: 'GPU' }, ...extraOpts }); }
      catch (e1) { return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate: 'CPU' }, ...extraOpts }); }
    }

    try {
      faceLandmarker = await makeTask(vision.FaceLandmarker, FACE_MODEL, { outputFaceBlendshapes: true, runningMode: 'VIDEO', numFaces: 1 });
      trackingMode = 'active';
    } catch (e) { console.warn('[WifiCordFilters] Rastreamento facial indisponível, modo manual:', e); trackingMode = 'manual'; }

    try {
      handLandmarker = await makeTask(vision.HandLandmarker, HAND_MODEL, { runningMode: 'VIDEO', numHands: 2 });
      handMode = 'active';
    } catch (e) { console.warn('[WifiCordFilters] Rastreamento de mão indisponível, modo manual:', e); handMode = 'manual'; }

    try {
      imageSegmenter = await makeTask(vision.ImageSegmenter, SEG_MODEL, { runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
      segMode = 'active';
    } catch (e) { console.warn('[WifiCordFilters] Segmentação de fundo indisponível, usando recorte aproximado:', e); segMode = 'manual'; }
  }

  // índices do MediaPipe FaceMesh (478 pontos). Cantos dos olhos (33/263) são
  // os únicos pontos cujo lado exato (qual índice cai à esquerda/direita NA
  // TELA já espelhada) não é assumido por adivinhação — é decidido comparando
  // o x de cada um a cada frame (ver detectFace). Isso evita depender de uma
  // convenção de "olho esquerdo/direito" do modelo que, combinada com o
  // espelhamento, tinha o giro (roll) inteiro invertido (~180°) — era a causa
  // da língua apontando pra cima e do filtro "girando" quando a cabeça virava
  // rápido (o ângulo cruzava o ponto de virada de -180°/180° o tempo todo).
  const IDX = { nose: 1, eyeA: 33, eyeB: 263, mouthTop: 13, mouthBottom: 14 };

  function toPx(p) { return { x: vw - (p.x * vw), y: p.y * vh }; } // espelhado no X

  // interpola ângulos pelo caminho mais curto (nunca gira "pelo lado errado")
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }

  function detectFace(ts) {
    if (!faceLandmarker || video.readyState < 2) return;
    // Sem isso, a detecção rodava em TODO frame de TELA (requestAnimationFrame,
    // que em celular costuma ser 60-120Hz), mesmo a câmera só entregando um
    // frame novo de verdade a ~30fps — reprocessando a MESMA imagem várias
    // vezes à toa, o maior consumo de CPU/GPU do módulo inteiro (relato
    // real: "meu celular só faltou explodir"). video.currentTime só avança
    // quando o <video> decodifica um frame novo — comparar com ele em vez
    // do timestamp do rAF prende a detecção no ritmo real da câmera, não
    // da tela. `ts` (rAF) continua indo pro MediaPipe normalmente — ele só
    // exige um número crescente, não que seja chamado em todo frame.
    if (video.currentTime === lastVideoTs) return;
    lastVideoTs = video.currentTime;
    let result;
    try { result = faceLandmarker.detectForVideo(video, ts); } catch (e) { return; }
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    if (!lm) { faceDetected = false; return; }
    faceDetected = true;

    const nose = toPx(lm[IDX.nose]);
    const eA = toPx(lm[IDX.eyeA]);
    const eB = toPx(lm[IDX.eyeB]);
    const mTop = toPx(lm[IDX.mouthTop]);
    const mBot = toPx(lm[IDX.mouthBottom]);
    // decide na hora quem está à esquerda/direita NA TELA — nunca confia em
    // qual índice "deveria" ser qual lado, então o giro nunca sai invertido.
    const eyeScreenL = eA.x <= eB.x ? eA : eB;
    const eyeScreenR = eA.x <= eB.x ? eB : eA;
    const eyeDist = Math.hypot(eyeScreenR.x - eyeScreenL.x, eyeScreenR.y - eyeScreenL.y) || 1;
    const roll = Math.atan2(eyeScreenR.y - eyeScreenL.y, eyeScreenR.x - eyeScreenL.x);
    const eyeMid = { x: (eyeScreenL.x + eyeScreenR.x) / 2, y: (eyeScreenL.y + eyeScreenR.y) / 2 };

    // orelhas derivadas geometricamente da linha dos olhos (não de landmarks
    // de orelha específicos, que na prática caíam perto do maxilar) — ficam
    // sempre simetricamente acima e ao redor da cabeça, girando junto com ela.
    const axisX = Math.cos(roll), axisY = Math.sin(roll);   // eixo "dos olhos"
    const upX = Math.sin(roll), upY = -Math.cos(roll);      // perpendicular, "pra cima" da cabeça
    const outward = eyeDist * 1.25, upward = eyeDist * 1.0;
    faceRaw.earL = { x: eyeMid.x - axisX * outward + upX * upward, y: eyeMid.y - axisY * outward + upY * upward };
    faceRaw.earR = { x: eyeMid.x + axisX * outward + upX * upward, y: eyeMid.y + axisY * outward + upY * upward };

    faceRaw.nose = nose;
    faceRaw.eyeL = eyeScreenL; faceRaw.eyeR = eyeScreenR;
    faceRaw.mouth = { x: (mTop.x + mBot.x) / 2, y: (mTop.y + mBot.y) / 2 };
    faceRaw.scale = eyeDist / (vw * 0.11); // normaliza pra ~1 numa distância "normal" de webcam
    faceRaw.roll = roll;
    faceRaw.center = eyeMid;

    const cats = (result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories) || [];
    const bsScore = (name) => { const c = cats.find(c => c.categoryName === name); return c ? c.score : 0; };
    const jaw = cats.find(c => c.categoryName === 'jawOpen');
    const mouthDist = Math.hypot(mBot.x - mTop.x, mBot.y - mTop.y) / eyeDist;
    faceRaw.jawOpen = jaw ? jaw.score : Math.max(0, Math.min(1, (mouthDist - 0.08) / 0.35));

    // outras expressões (blendshapes ARKit-style que o FaceLandmarker já dá de
    // graça) — usadas pelos filtros reativos (sorriso, piscada, sobrancelha,
    // beicinho, bochecha). Quando o modelo não manda blendshapes por algum
    // motivo, tudo fica 0 (filtro reativo simplesmente não dispara, sem
    // travar nada).
    faceRaw.bs = {
      smile: Math.max(bsScore('mouthSmileLeft'), bsScore('mouthSmileRight')),
      blinkL: bsScore('eyeBlinkLeft'),
      blinkR: bsScore('eyeBlinkRight'),
      browUp: Math.max(bsScore('browInnerUp'), bsScore('browOuterUpLeft'), bsScore('browOuterUpRight')),
      pucker: bsScore('mouthPucker'),
      cheekPuff: bsScore('cheekPuff'),
      browDown: Math.max(bsScore('browDownLeft'), bsScore('browDownRight')),
      eyeWide: Math.max(bsScore('eyeWideLeft'), bsScore('eyeWideRight')),
      mouthFrown: Math.max(bsScore('mouthFrownLeft'), bsScore('mouthFrownRight')),
      noseSneer: Math.max(bsScore('noseSneerLeft'), bsScore('noseSneerRight')),
    };
  }

  // suavização por frame de render (independente da taxa de detecção)
  function smoothFace(dt) {
    if (trackingMode === 'active' && faceDetected) {
      const k = 1 - Math.pow(0.001, dt); // lerp consistente mesmo com fps variável
      face.nose.x += (faceRaw.nose.x - face.nose.x) * k;
      face.nose.y += (faceRaw.nose.y - face.nose.y) * k;
      face.earL.x += (faceRaw.earL.x - face.earL.x) * k;
      face.earL.y += (faceRaw.earL.y - face.earL.y) * k;
      face.earR.x += (faceRaw.earR.x - face.earR.x) * k;
      face.earR.y += (faceRaw.earR.y - face.earR.y) * k;
      face.mouth.x += (faceRaw.mouth.x - face.mouth.x) * k;
      face.mouth.y += (faceRaw.mouth.y - face.mouth.y) * k;
      face.center.x += (faceRaw.center.x - face.center.x) * k;
      face.center.y += (faceRaw.center.y - face.center.y) * k;
      face.eyeL.x += (faceRaw.eyeL.x - face.eyeL.x) * k;
      face.eyeL.y += (faceRaw.eyeL.y - face.eyeL.y) * k;
      face.eyeR.x += (faceRaw.eyeR.x - face.eyeR.x) * k;
      face.eyeR.y += (faceRaw.eyeR.y - face.eyeR.y) * k;
      face.scale += (faceRaw.scale - face.scale) * k;
      face.roll = lerpAngle(face.roll, faceRaw.roll, k);
      face.jawOpen += (faceRaw.jawOpen - face.jawOpen) * Math.min(1, k * 1.6);
      for (const key in BS_DEFAULT) face.bs[key] += (faceRaw.bs[key] - face.bs[key]) * Math.min(1, k * 1.8);
      face.ready = true;
    } else if (trackingMode === 'manual') {
      // Modo manual headless: sem UI de arrastar âncora aqui (isso era o
      // ícone 🐾 arrastável do protótipo, que só existia porque havia um
      // canvas visível na tela pra arrastar em cima). Este módulo não expõe
      // nenhuma superfície visível, então a âncora fica fixa no centro do
      // quadro — os acessórios de rosto continuam desenhando (só não seguem
      // seu rosto de verdade). manualTongueOn nunca vira true por não haver
      // botão de "segurar ação" — degradação aceitável, documentada aqui.
      face.nose.x = manualAnchor.x; face.nose.y = manualAnchor.y;
      face.earL.x = manualAnchor.x - 46; face.earL.y = manualAnchor.y - 60;
      face.earR.x = manualAnchor.x + 46; face.earR.y = manualAnchor.y - 60;
      face.mouth.x = manualAnchor.x; face.mouth.y = manualAnchor.y + 46;
      face.center.x = manualAnchor.x; face.center.y = manualAnchor.y - 10;
      face.eyeL.x = manualAnchor.x - 20; face.eyeL.y = manualAnchor.y - 8;
      face.eyeR.x = manualAnchor.x + 20; face.eyeR.y = manualAnchor.y - 8;
      // mesma fórmula do modo ativo (eyeDist / (vw*0.11)), usando a distância
      // sintética de 40px entre os olhos manuais acima — sem isso, face.scale
      // ficava fixo em 1 (calibrado pra uma distância de olhos real de ~105px),
      // deixando acessórios como cartola/coroa de flores gigantes e flutuando
      // longe da âncora manual, em vez de do tamanho de um rosto normal.
      face.scale = 40 / (vw * 0.11); face.roll = 0;
      const target = manualTongueOn ? 1 : 0;
      const bk = Math.min(1, (1 - Math.pow(0.001, dt)) * 1.6);
      face.jawOpen += (target - face.jawOpen) * bk;
      for (const key in BS_DEFAULT) face.bs[key] += (target - face.bs[key]) * bk;
      face.ready = true;
    }
  }

  // índices do MediaPipe HandLandmarker (21 pontos por mão)
  const HIDX = { wrist: 0, idxMcp: 5, idxPip: 6, idxTip: 8, midMcp: 9, midPip: 10, midTip: 12, ringMcp: 13, ringPip: 14, ringTip: 16, pinMcp: 17, pinPip: 18, pinTip: 20 };

  function detectHand(ts) {
    if (!handLandmarker || video.readyState < 2) return;
    // Mesmo motivo/comentário grande de detectFace() acima — prende a
    // detecção ao ritmo real de frames da câmera (video.currentTime), não
    // ao refresh da tela.
    if (video.currentTime === lastHandTs) return;
    lastHandTs = video.currentTime;
    let result;
    try { result = handLandmarker.detectForVideo(video, ts); } catch (e) { return; }
    const lm = result && result.landmarks && result.landmarks[0];
    if (!lm) { handDetected = false; return; }
    handDetected = true;

    const wrist = toPx(lm[HIDX.wrist]);
    const idxMcp = toPx(lm[HIDX.idxMcp]), pinMcp = toPx(lm[HIDX.pinMcp]), midMcp = toPx(lm[HIDX.midMcp]);
    // mesma técnica do rosto: decide na hora quem é "esquerda/direita na tela"
    // pra nunca inverter o giro da mão.
    const kL = idxMcp.x <= pinMcp.x ? idxMcp : pinMcp;
    const kR = idxMcp.x <= pinMcp.x ? pinMcp : idxMcp;
    const roll = Math.atan2(kR.y - kL.y, kR.x - kL.x);
    const palmScale = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y) || 1;

    // "abertura" da mão: pra cada dedo, a ponta fica bem mais longe do pulso
    // que a junta do meio quando o dedo está esticado; perto ou mais perto
    // quando está fechado. Dá uma nota 0..1 de "mão aberta".
    let ext = 0;
    for (const [tipI, pipI] of [[HIDX.idxTip, HIDX.idxPip], [HIDX.midTip, HIDX.midPip], [HIDX.ringTip, HIDX.ringPip], [HIDX.pinTip, HIDX.pinPip]]) {
      const tip = toPx(lm[tipI]), pip = toPx(lm[pipI]);
      const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
      const dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
      if (dTip > dPip * 1.12) ext += 1;
    }
    handRaw.center = midMcp;
    handRaw.roll = roll;
    handRaw.scale = palmScale / (vw * 0.075);
    handRaw.openness = ext / 4;

    // moldura com as duas mãos (efeito "Moldura Mágica"): quando as duas mãos
    // aparecem, pega a ponta do polegar + do indicador de cada uma (os dedos
    // que a galera usa pra fazer o gesto de moldura/L) e monta um quadrilátero
    // com os 4 pontos, sempre em ordem não-cruzada.
    if (result.landmarks && result.landmarks.length >= 2) {
      // ordena por "handedness" (Esquerda/Direita) pra manter a MESMA mão
      // sempre no mesmo papel entre um frame e outro — sem isso, quando o
      // MediaPipe troca a ordem de detecção das mãos, os pontos embaralham
      // e a forma "pisca"/inverte sozinha.
      let h0 = result.landmarks[0], h1 = result.landmarks[1];
      const labels = result.handedness;
      if (labels && labels[0] && labels[0][0] && labels[1] && labels[1][0]) {
        // a câmera já é espelhada na tela, então "Right" do MediaPipe (mão
        // direita da PESSOA na imagem crua) aparece do lado esquerdo da tela.
        if (labels[0][0].categoryName === 'Left') { h0 = result.landmarks[1]; h1 = result.landmarks[0]; }
      }
      // ordem FIXA pelos dedos (não por ângulo!): polegar e indicador de cada
      // mão formam um "L"; ligar polegarA→indicadorA→indicadorB→polegarB
      // desenha um quadrilátero normal quando as mãos estão alinhadas, e vira
      // sozinho um laço cruzado (efeito "borboleta") quando você gira uma mão
      // pra frente e a outra pra trás.
      handsFrameRaw = [toPx(h0[4]), toPx(h0[8]), toPx(h1[8]), toPx(h1[4])];
      handsFrameSeen = true;
    } else {
      handsFrameSeen = false;
    }
  }

  function smoothHand(dt) {
    if (handMode === 'active' && handDetected) {
      const k = 1 - Math.pow(0.001, dt);
      hand.center.x += (handRaw.center.x - hand.center.x) * k;
      hand.center.y += (handRaw.center.y - hand.center.y) * k;
      hand.scale += (handRaw.scale - hand.scale) * k;
      hand.roll = lerpAngle(hand.roll, handRaw.roll, k);
      const target = handRaw.openness > 0.7 ? 1 : (handRaw.openness < 0.35 ? 0 : hand.openness);
      hand.openness += (target - hand.openness) * Math.min(1, k * 1.8);
      hand.ready = true;
    } else if (handMode === 'manual') {
      // mesma limitação headless do rosto: sem drag/botão de ação aqui, a
      // âncora fica fixa e manualHandOpen nunca é acionado.
      hand.center.x = manualAnchor.x; hand.center.y = manualAnchor.y;
      hand.scale = 1; hand.roll = 0;
      const target = manualHandOpen ? 1 : 0;
      hand.openness += (target - hand.openness) * Math.min(1, (1 - Math.pow(0.001, dt)) * 2.2);
      hand.ready = true;
    } else {
      hand.ready = false;
    }
    // moldura das duas mãos: só suaviza/mostra quando as duas mãos estão
    // sendo detectadas de verdade nesse instante (sem fallback manual —
    // simular duas mãos com uma âncora só não faz sentido).
    const targetAlpha = (handMode === 'active' && handsFrameSeen) ? 1 : 0;
    handsFrameAlpha += (targetAlpha - handsFrameAlpha) * Math.min(1, (1 - Math.pow(0.001, dt)) * 2.4);
    if (handMode === 'active' && handsFrameSeen && handsFrameRaw) {
      const k = 1 - Math.pow(0.001, dt);
      for (let i = 0; i < 4; i++) {
        if (!handsFrame[i]) handsFrame[i] = { x: handsFrameRaw[i].x, y: handsFrameRaw[i].y };
        handsFrame[i].x += (handsFrameRaw[i].x - handsFrame[i].x) * k;
        handsFrame[i].y += (handsFrameRaw[i].y - handsFrame[i].y) * k;
      }
      handsFrameReady = true;
    }
    if (handsFrameAlpha < 0.01) handsFrameReady = false;
  }

  /* ---- âncora manual (plano B sem rastreamento) — sem drag/botão de ação
     nesta versão headless (ver comentários em smoothFace/smoothHand). Fica
     recentralizada sempre que o canvas muda de tamanho. ---- */
  const manualAnchor = { x: 0, y: 0 };
  let manualTongueOn = false;   // cachorro: "segurar a língua pra fora" — sempre false aqui
  let manualHandOpen = false;   // figurinha-mão: "mão aberta" — sempre false aqui
  function resetManualAnchor() { manualAnchor.x = vw / 2; manualAnchor.y = vh * 0.42; }

  /* =====================================================================
     DESENHO BASE
     ===================================================================== */
  function drawMirroredVideo(targetCtx = ctx, w = vw, h = vh) {
    targetCtx.save();
    targetCtx.translate(w, 0);
    targetCtx.scale(-1, 1);
    targetCtx.drawImage(video, 0, 0, w, h);
    targetCtx.restore();
  }

  /* ---- imagem escolhida pelo usuário (figurinha no rosto / na mão). O
     protótipo tinha um <input type=file> pra isso; este módulo não tem UI
     nenhuma, então userImage fica sempre null e esses dois filtros caem no
     placeholder — escolher uma imagem de verdade é responsabilidade de uma
     camada de UI futura, fora do escopo deste motor. ---- */
  let userImage = null;
  // recorta a imagem como um quadrado "cover" (preenche sem distorcer)
  function drawImageCover(img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale, sh = dh / scale;
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.save();
    const r = Math.min(dw, dh) * 0.14;
    ctx.beginPath();
    ctx.moveTo(dx + r, dy);
    ctx.arcTo(dx + dw, dy, dx + dw, dy + dh, r);
    ctx.arcTo(dx + dw, dy + dh, dx, dy + dh, r);
    ctx.arcTo(dx, dy + dh, dx, dy, r);
    ctx.arcTo(dx, dy, dx + dw, dy, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
    ctx.strokeStyle = 'rgba(63,238,208,.8)';
    ctx.lineWidth = Math.max(1.5, dw * 0.015);
    ctx.beginPath();
    ctx.moveTo(dx + r, dy);
    ctx.arcTo(dx + dw, dy, dx + dw, dy + dh, r);
    ctx.arcTo(dx + dw, dy + dh, dx, dy + dh, r);
    ctx.arcTo(dx, dy + dh, dx, dy, r);
    ctx.arcTo(dx, dy, dx + dw, dy, r);
    ctx.closePath();
    ctx.stroke();
  }
  function drawPlaceholderSquare(size, cx, cy) {
    ctx.save();
    ctx.translate(cx || 0, cy || 0);
    ctx.strokeStyle = 'rgba(234,250,246,.55)';
    ctx.lineWidth = Math.max(1.5, size * 0.02);
    ctx.setLineDash([size * 0.06, size * 0.05]);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(234,250,246,.8)';
    ctx.font = `${Math.round(size * 0.28)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🖼️', 0, 0);
    ctx.restore();
  }

  /* =====================================================================
     PARTÍCULAS DE REAÇÃO — usado pelos filtros de rosto interativos
     (sorriso, beicinho, sobrancelha, piscada, etc.) pra soltar um efeito no
     instante em que a expressão é detectada, não só desenhar algo estático.
     ===================================================================== */
  let burstParticles = [];
  function spawnBurst(x, y, count, opts = {}) {
    const dir = opts.dir != null ? opts.dir : null;
    const spread = opts.spread != null ? opts.spread : Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = dir != null ? dir + (Math.random() - 0.5) * spread : Math.random() * Math.PI * 2;
      const sp = (opts.speed || 60) * (0.5 + Math.random() * 0.8);
      burstParticles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, maxLife: (opts.life || 0.8) * (0.7 + Math.random() * 0.6),
        size: (opts.size || 6) * (0.7 + Math.random() * 0.6),
        color: opts.color || '#3feed0',
        glyph: opts.glyph || null,
      });
    }
  }
  function updateDrawBursts(dt) {
    if (!burstParticles.length) return;
    burstParticles = burstParticles.filter(p => p.life < p.maxLife);
    for (const p of burstParticles) {
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 70 * dt;
      const t = p.life / p.maxLife;
      const a = 1 - t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      if (p.glyph) {
        ctx.font = `${Math.round(p.size * 3.4)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.glyph, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* =====================================================================
     FILTROS — cada um desenha direto no canvas principal. Função hoisting
     do JS permite declarar este array antes das funções draw* virem
     definidas mais abaixo (mesma ordem do protótipo original).
     ===================================================================== */
  const FILTERS = [
    { id: 'original', name: 'Original', icon: '✨', desc: 'Sem filtro, só o espelho.', draw: () => drawOriginal() },
    { id: 'cinema', name: 'Cinema', icon: '🎞️', desc: 'Contraste de filme, grão e vinheta.', draw: (ts) => drawCinema(ts) },
    { id: 'aurora', name: 'Aurora', icon: '🌌', desc: 'Luz colorida em movimento, tipo aurora polar.', draw: (ts) => drawAurora(ts) },
    { id: 'glitch', name: 'Glitch', icon: '📺', desc: 'Aberração cromática, scanlines e falhas.', draw: (ts) => drawGlitch(ts) },
    { id: 'blur', name: 'Fundo desfocado', icon: '🌫️', desc: 'Recorta seu corpo de verdade e borra só o fundo.', draw: (ts) => drawBlurBg(ts), needsSeg: true },
    { id: 'neve', name: 'Neve', icon: '❄️', desc: 'Neve caindo com clima de inverno.', draw: (ts, dt) => drawSnow(ts, dt) },
    { id: 'confete', name: 'Confete', icon: '🎉', desc: 'Chuva de confete colorido.', draw: (ts, dt) => drawConfetti(ts, dt) },
    { id: 'neon', name: 'Contorno Néon', icon: '🖊️', desc: 'Seu contorno desenhado em néon.', draw: () => drawNeon() },
    { id: 'cachorro', name: 'Cachorro', icon: '🐶', desc: 'Orelhas, focinho e língua que reage quando você abre a boca.', draw: (ts, dt) => drawDog(ts, dt), needsFace: true },
    { id: 'figurinha-rosto', name: 'Sua figurinha', icon: '🖼️', desc: 'Escolha uma imagem e ela gruda no seu rosto.', draw: () => drawFaceSticker(), needsFace: true },
    { id: 'figurinha-mao', name: 'Na mão', icon: '🤲', desc: 'Feche a mão: nada. Abra a mão: aparece sua imagem, em quadrado.', draw: () => drawHandSticker(), needsHand: true },
    { id: 'oculos', name: 'Óculos', icon: '🕶️', desc: 'Óculos escuros que seguem seu rosto.', draw: () => drawSunglasses(), needsFace: true },
    { id: 'chapeu', name: 'Chapéu', icon: '🎩', desc: 'Cartola acompanhando a cabeça.', draw: () => drawHat(), needsFace: true },
    { id: 'bigode', name: 'Bigode', icon: '👨', desc: 'Bigode clássico debaixo do nariz.', draw: () => drawMustache(), needsFace: true },
    { id: 'coroa-flores', name: 'Coroa de Flores', icon: '🌸', desc: 'Grinalda de flores no topo da cabeça.', draw: () => drawFlowerCrown(), needsFace: true },
    { id: 'mascara-heroi', name: 'Máscara Herói', icon: '🦸', desc: 'Máscara de super-herói ao redor dos olhos.', draw: () => drawHeroMask(), needsFace: true },
    { id: 'coracao-olhos', name: 'Apaixonado', icon: '😍', desc: 'Sorria: corações saltam dos olhos.', draw: (ts, dt) => drawHeartEyes(ts, dt), needsFace: true },
    { id: 'beijo-voador', name: 'Beijo Voador', icon: '😘', desc: 'Faça beicinho: corações voam da boca.', draw: (ts, dt) => drawFlyingKiss(ts, dt), needsFace: true },
    { id: 'esquilo', name: 'Esquilo', icon: '🐿️', desc: 'Infle a bochecha pra ficar com cara de esquilo.', draw: () => drawChipmunk(), needsFace: true },
    { id: 'sobrancelha', name: 'Cético', icon: '🤨', desc: 'Levante a sobrancelha e veja a mágica.', draw: (ts, dt) => drawBrowRaise(ts, dt), needsFace: true },
    { id: 'piscada-magica', name: 'Piscada Mágica', icon: '✨', desc: 'Pisque: solta brilho do olho que piscou.', draw: (ts, dt) => drawMagicBlink(ts, dt), needsFace: true },
    { id: 'dinheiro', name: 'Chuva de Grana', icon: '💵', desc: 'Notas de dinheiro caindo e girando.', draw: (ts, dt) => drawMoneyRain(ts, dt) },
    { id: 'rastro', name: 'Rastro', icon: '🌀', desc: 'Rastro fantasma que reage ao seu movimento.', draw: () => drawMotionTrail() },
    { id: 'caleidoscopio', name: 'Caleidoscópio', icon: '🔮', desc: 'Sua imagem espelhada em mosaico giratório.', draw: (ts) => drawKaleidoscope(ts) },
    { id: 'termica', name: 'Visão Térmica', icon: '🌡️', desc: 'Cores de câmera térmica, do frio ao quente.', draw: () => drawThermal() },
    { id: 'mao-magica', name: 'Mão Mágica', icon: '🌀', desc: 'O efeito de redemoinho pela mão: feche a mão pra sugar, abra pra girar suave.', draw: (ts, dt) => drawHandWarp(ts, dt), needsHand: true },
    { id: 'bravo', name: 'Bravo', icon: '😠', desc: 'Franza a sobrancelha e solte vapor de raiva.', draw: (ts, dt) => drawAngry(ts, dt), needsFace: true },
    { id: 'chocado', name: 'Chocado', icon: '😲', desc: 'Arregale os olhos de susto.', draw: (ts, dt) => drawShocked(ts, dt), needsFace: true },
    { id: 'choroso', name: 'Choroso', icon: '😢', desc: 'Faça bico de triste e a lágrima escorre.', draw: (ts, dt) => drawCrying(ts, dt), needsFace: true },
    { id: 'nojinho', name: 'Nojinho', icon: '🤢', desc: 'Franza o nariz de nojo.', draw: (ts, dt) => drawDisgust(ts, dt), needsFace: true },
    { id: 'risada', name: 'Risada', icon: '😂', desc: 'Sorria com a boca bem aberta pra gargalhar.', draw: (ts, dt) => drawLaugh(ts, dt), needsFace: true },
    { id: 'coroa-real', name: 'Coroa Real', icon: '👑', desc: 'Coroa dourada com joias no topo da cabeça.', draw: () => drawCrown(), needsFace: true },
    { id: 'chifres', name: 'Chifres', icon: '😈', desc: 'Par de chifres de diabinho na testa.', draw: () => drawHorns(), needsFace: true },
    { id: 'gato', name: 'Gato', icon: '🐱', desc: 'Orelhas de gato, bigodes e naricinho rosa.', draw: () => drawCatEars(), needsFace: true },
    { id: 'bandana', name: 'Bandana Ninja', icon: '🥷', desc: 'Faixa na testa com as pontas esvoaçando.', draw: (ts) => drawBandana(ts), needsFace: true },
    { id: 'halo', name: 'Halo de Anjo', icon: '😇', desc: 'Anel dourado brilhante flutuando sobre a cabeça.', draw: (ts) => drawHalo(ts), needsFace: true },
    { id: 'capacete', name: 'Capacete Espacial', icon: '👨‍🚀', desc: 'Bolha de vidro de astronauta ao redor da cabeça.', draw: () => drawHelmet(), needsFace: true },
    { id: 'vhs', name: 'VHS Retrô', icon: '📼', desc: 'Aberração cromática, scanlines e falhas de fita.', draw: (ts, dt) => drawVHS(ts, dt) },
    { id: 'matrix', name: 'Chuva Digital', icon: '💻', desc: 'Câmera "hackeada": colunas de caracteres caindo.', draw: (ts, dt) => drawMatrix(ts, dt) },
    { id: 'fogos', name: 'Fogos de Artifício', icon: '🎆', desc: 'Explosões coloridas de partículas pela tela.', draw: (ts, dt) => drawFireworks(ts, dt) },
    { id: 'estrelas-cadentes', name: 'Estrelas Cadentes', icon: '🌠', desc: 'Rastros de luz cruzando o céu.', draw: (ts, dt) => drawShootingStars(ts, dt) },
    { id: 'tunel', name: 'Túnel Warp', icon: '🕳️', desc: 'Zoom em anéis concêntricos, efeito hipnótico.', draw: (ts) => drawTunnel(ts) },
    { id: 'moldura-magica', name: 'Moldura Mágica', icon: '🔲', desc: 'Forme uma moldura com as duas mãos (polegar + indicador) e veja outra realidade por dentro dela.', draw: (ts, dt) => drawHandFrame(ts, dt), needsHand: true },
  ];

  /* ---------------------------------------------------------------------
     Original: só o espelho, sem processamento nenhum.
     --------------------------------------------------------------------- */
  function drawOriginal() { drawMirroredVideo(); }

  /* ---- Cinema: contraste + vinheta + grão sutil ---- */
  let grainCanvas = null;
  function getGrain() {
    if (grainCanvas) return grainCanvas;
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainCanvas = c; return c;
  }
  function drawCinema(ts) {
    ctx.filter = 'contrast(1.12) saturate(0.86) brightness(0.97)';
    drawMirroredVideo();
    ctx.filter = 'none';
    const vg = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.25, vw / 2, vh / 2, vh * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${0.55 * intensity})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, vw, vh);
    ctx.globalAlpha = 0.05 + intensity * 0.1;
    ctx.globalCompositeOperation = 'overlay';
    const g = getGrain();
    const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
    const pat = ctx.createPattern(g, 'repeat');
    ctx.save(); ctx.translate(-ox, -oy); ctx.fillStyle = pat; ctx.fillRect(ox, oy, vw, vh); ctx.restore();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  /* ---- Aurora: gradiente colorido animado em screen ---- */
  function drawAurora(ts) {
    drawMirroredVideo();
    const t = ts * 0.00025;
    const g = ctx.createLinearGradient(0, 0, vw * (0.6 + 0.4 * Math.sin(t)), vh);
    g.addColorStop(0, `hsla(${170 + 40 * Math.sin(t * 1.3)},90%,55%,${0.35 * intensity})`);
    g.addColorStop(0.5, `hsla(${280 + 30 * Math.cos(t)},80%,55%,${0.25 * intensity})`);
    g.addColorStop(1, `hsla(${320 + 20 * Math.sin(t * 0.7)},85%,55%,${0.3 * intensity})`);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- Glitch: aberração cromática + scanlines + falhas ---- */
  function drawGlitch(ts) {
    const shift = 2 + intensity * 8;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save(); ctx.translate(shift, 0); ctx.filter = 'sepia(1) saturate(6) hue-rotate(-60deg) brightness(.9)'; drawMirroredVideo(); ctx.restore();
    ctx.save(); ctx.translate(-shift, 0); ctx.filter = 'sepia(1) saturate(6) hue-rotate(140deg) brightness(.9)'; drawMirroredVideo(); ctx.restore();
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.5;
    drawMirroredVideo();
    ctx.globalAlpha = 1;

    ctx.fillStyle = `rgba(0,0,0,${0.18 * intensity})`;
    for (let y = 0; y < vh; y += 3) ctx.fillRect(0, y, vw, 1);

    if (Math.random() < 0.05 * intensity) {
      const h = 6 + Math.random() * 18;
      const y = Math.random() * vh;
      const dx = (Math.random() - 0.5) * 30 * intensity;
      const slice = ctx.getImageData(0, Math.max(0, y), vw, Math.min(h, vh - y));
      ctx.putImageData(slice, dx, y);
    }
  }

  /* ---- Fundo desfocado: recorta você de verdade (segmentação de pessoa),
     não um círculo/elipse geométrico. Se o modelo de segmentação não
     carregar, cai num plano B em formato de "cabeça + ombros" com borda bem
     suave em camadas. ---- */
  let segSmall = null, segSmallCtx = null, segMaskCanvas = null, segMaskCtx = null, sharpCanvas = null, sharpCtx = null;
  function ensureSegCanvases(mw, mh) {
    if (!segSmall || segSmall.width !== mw || segSmall.height !== mh) {
      segSmall = document.createElement('canvas'); segSmall.width = mw; segSmall.height = mh;
      segSmallCtx = segSmall.getContext('2d', { willReadFrequently: true });
    }
    if (!segMaskCanvas || segMaskCanvas.width !== vw || segMaskCanvas.height !== vh) {
      segMaskCanvas = document.createElement('canvas'); segMaskCanvas.width = vw; segMaskCanvas.height = vh;
      segMaskCtx = segMaskCanvas.getContext('2d');
      sharpCanvas = document.createElement('canvas'); sharpCanvas.width = vw; sharpCanvas.height = vh;
      sharpCtx = sharpCanvas.getContext('2d');
    }
  }
  function detectSeg(ts) {
    if (!imageSegmenter || video.readyState < 2) return;
    // Mesmo motivo/comentário grande de detectFace() acima.
    if (video.currentTime === lastSegTs) return;
    lastSegTs = video.currentTime;
    let result;
    try { result = imageSegmenter.segmentForVideo(video, ts); } catch (e) { return; }
    const masks = result && result.confidenceMasks;
    const mask = masks && masks[0];
    if (!mask) return;
    const mw = mask.width, mh = mask.height;
    ensureSegCanvases(mw, mh);
    const data = mask.getAsFloat32Array();
    const img = segSmallCtx.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      const a = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
      const o = i * 4; img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = a;
    }
    segSmallCtx.putImageData(img, 0, 0);
    masks.forEach(m => { try { m.close && m.close(); } catch (e) { } });

    segMaskCtx.clearRect(0, 0, vw, vh);
    segMaskCtx.save();
    segMaskCtx.translate(vw, 0); segMaskCtx.scale(-1, 1);
    segMaskCtx.imageSmoothingEnabled = true;
    segMaskCtx.filter = 'blur(3px)'; // amacia ainda mais a transição da borda
    segMaskCtx.drawImage(segSmall, 0, 0, vw, vh);
    segMaskCtx.filter = 'none';
    segMaskCtx.restore();
  }
  function drawBlurBg(ts) {
    if (segMode === 'active') detectSeg(ts);
    const blurPx = 6 + intensity * 22;
    ctx.filter = `blur(${blurPx}px)`;
    drawMirroredVideo();
    ctx.filter = 'none';

    if (segMode === 'active' && segMaskCanvas) {
      sharpCtx.clearRect(0, 0, vw, vh);
      sharpCtx.save();
      sharpCtx.translate(vw, 0); sharpCtx.scale(-1, 1);
      sharpCtx.drawImage(video, 0, 0, vw, vh);
      sharpCtx.restore();
      sharpCtx.globalCompositeOperation = 'destination-in';
      sharpCtx.drawImage(segMaskCanvas, 0, 0);
      sharpCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(sharpCanvas, 0, 0);
      return;
    }

    // plano B: silhueta "cabeça + ombros", não um círculo — várias camadas
    // com blur decrescente pra transição suave em vez de um traço duro.
    const anchor = face.ready ? face.center : { x: vw / 2, y: vh * 0.36 };
    const scale = face.ready ? face.scale : 1;
    const headR = 62 * scale, shoulderW = 118 * scale;
    for (const [growth, blur] of [[1.6, blurPx * 0.7], [1.32, blurPx * 0.35], [1.12, blurPx * 0.12], [1, 0]]) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(anchor.x, anchor.y + headR * 0.3, headR * growth, headR * 1.2 * growth, 0, Math.PI, 0);
      ctx.lineTo(anchor.x + shoulderW * growth, vh + 40);
      ctx.lineTo(anchor.x - shoulderW * growth, vh + 40);
      ctx.closePath();
      ctx.clip();
      ctx.filter = blur > 0.5 ? `blur(${blur}px)` : 'none';
      drawMirroredVideo();
      ctx.filter = 'none';
      ctx.restore();
    }
  }

  /* ---- Neve ---- */
  let snow = null;
  function ensureSnow() {
    const n = Math.round(30 + intensity * 90);
    if (snow && snow.length === n) return;
    snow = Array.from({ length: n }, () => ({
      x: Math.random() * vw, y: Math.random() * vh, r: 1.5 + Math.random() * 3,
      sp: 20 + Math.random() * 40, sway: Math.random() * Math.PI * 2, swaySp: 0.5 + Math.random()
    }));
  }
  function drawSnow(ts, dt) {
    ctx.filter = 'saturate(0.8) brightness(0.95) hue-rotate(10deg)';
    drawMirroredVideo();
    ctx.filter = 'none';
    ctx.fillStyle = `rgba(140,190,255,${0.10 * intensity})`;
    ctx.fillRect(0, 0, vw, vh);
    ensureSnow();
    ctx.fillStyle = '#fff';
    for (const p of snow) {
      p.y += p.sp * dt; p.sway += p.swaySp * dt;
      if (p.y > vh) { p.y = -10; p.x = Math.random() * vw; }
      const x = p.x + Math.sin(p.sway) * 10;
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(p.sway * 2);
      ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- Confete ---- */
  let confetti = null;
  const CONF_COLORS = ['#3feed0', '#ffb454', '#ff6f91', '#8f7bff', '#7cf29c'];
  function ensureConfetti() {
    if (confetti) return;
    confetti = [];
  }
  function drawConfetti(ts, dt) {
    drawMirroredVideo();
    ensureConfetti();
    const spawnRate = 6 + intensity * 26;
    if (Math.random() < spawnRate * dt) {
      confetti.push({
        x: Math.random() * vw, y: -10, r: 0, vr: (Math.random() - 0.5) * 6,
        w: 6 + Math.random() * 5, h: 4 + Math.random() * 4,
        vy: 60 + Math.random() * 70, vx: (Math.random() - 0.5) * 40,
        c: CONF_COLORS[(Math.random() * CONF_COLORS.length) | 0]
      });
    }
    confetti = confetti.filter(p => p.y < vh + 20);
    for (const p of confetti) {
      p.y += p.vy * dt; p.x += p.vx * dt; p.r += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
  }

  /* ---- Contorno Néon: Sobel em baixa resolução + glow ---- */
  const EW = 160, EH = 120;
  let edgeSrc = null, edgeSrcCtx = null, edgeOut = null, edgeOutCtx = null;
  function ensureEdgeCanvases() {
    if (edgeSrc) return;
    edgeSrc = document.createElement('canvas'); edgeSrc.width = EW; edgeSrc.height = EH; edgeSrcCtx = edgeSrc.getContext('2d', { willReadFrequently: true });
    edgeOut = document.createElement('canvas'); edgeOut.width = EW; edgeOut.height = EH; edgeOutCtx = edgeOut.getContext('2d');
  }
  function drawNeon() {
    ensureEdgeCanvases();
    ctx.filter = 'brightness(0.32) saturate(0.5)';
    drawMirroredVideo();
    ctx.filter = 'none';

    edgeSrcCtx.drawImage(video, 0, 0, EW, EH);
    const img = edgeSrcCtx.getImageData(0, 0, EW, EH);
    const gray = new Float32Array(EW * EH);
    for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
      gray[p] = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
    }
    const out = edgeOutCtx.createImageData(EW, EH);
    const th = 60 - intensity * 30;
    for (let y = 1; y < EH - 1; y++) {
      for (let x = 1; x < EW - 1; x++) {
        const i = y * EW + x;
        const gx = gray[i - EW - 1] - gray[i - EW + 1] + 2 * gray[i - 1] - 2 * gray[i + 1] + gray[i + EW - 1] - gray[i + EW + 1];
        const gy = gray[i - EW - 1] + 2 * gray[i - EW] + gray[i - EW + 1] - gray[i + EW - 1] - 2 * gray[i + EW] - gray[i + EW + 1];
        const mag = Math.sqrt(gx * gx + gy * gy);
        const a = mag > th ? Math.min(255, mag) : 0;
        const o = i * 4;
        out.data[o] = 63; out.data[o + 1] = 238; out.data[o + 2] = 208; out.data[o + 3] = a;
      }
    }
    edgeOutCtx.putImageData(out, 0, 0);

    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(vw, 0); ctx.scale(-1, 1); // espelha o mapa de bordas junto
    ctx.filter = 'blur(2px)';
    ctx.drawImage(edgeOut, 0, 0, vw, vh);
    ctx.filter = 'none';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(edgeOut, 0, 0, vw, vh);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- Cachorro: orelhas + focinho + língua reativa ---- */
  let tongueLen = 0;   // 0..1, suavizado com easing assimétrico
  let tongueWiggle = 0;
  function drawDog(ts, dt) {
    drawMirroredVideo();
    if (!face.ready) return;

    const s = face.scale * (0.6 + intensity * 0.8);
    const roll = face.roll;

    // orelhas
    drawEar(face.earL.x, face.earL.y, s, roll, -1, ts);
    drawEar(face.earR.x, face.earR.y, s, roll, 1, ts);

    // focinho — formato de "coração" de cachorro, com narinas, em vez de
    // uma elipse lisa grande demais.
    ctx.save();
    ctx.translate(face.nose.x, face.nose.y);
    ctx.rotate(roll);
    const nw = 15 * s, nh = 12 * s;
    const ng = ctx.createRadialGradient(-nw * 0.25, -nh * 0.35, 1, 0, 0, nw * 1.1);
    ng.addColorStop(0, '#3c302a'); ng.addColorStop(1, '#0a0807');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.moveTo(0, -nh * 0.55);
    ctx.bezierCurveTo(nw * 0.8, -nh * 0.6, nw * 0.9, nh * 0.3, 0, nh * 0.65);
    ctx.bezierCurveTo(-nw * 0.9, nh * 0.3, -nw * 0.8, -nh * 0.6, 0, -nh * 0.55);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.ellipse(-nw * 0.3, 0, nw * 0.14, nh * 0.18, 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(nw * 0.3, 0, nw * 0.14, nh * 0.18, -0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(-nw * 0.22, -nh * 0.22, nw * 0.16, nh * 0.09, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // língua — máquina de estados suavizada (extende / balança / recolhe)
    const target = face.jawOpen > 0.32 ? 1 : (face.jawOpen > 0.14 ? tongueLen : 0);
    const speed = target > tongueLen ? 7.5 : 3.2; // sai rápido, recolhe com calma
    tongueLen += (target - tongueLen) * Math.min(1, speed * dt);
    if (tongueLen > 0.01) {
      tongueWiggle += dt * (4 + tongueLen * 4);
      const wig = tongueLen > 0.7 ? Math.sin(tongueWiggle * 3) * 6 * s : 0;
      const baseX = face.mouth.x, baseY = face.mouth.y + 4 * s;
      const len = 46 * s * easeOutCubic(tongueLen);
      const w = 15 * s * (0.85 + 0.15 * Math.sin(tongueWiggle * 3));
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.rotate(roll);
      const tg = ctx.createLinearGradient(0, 0, 0, len);
      tg.addColorStop(0, '#ff8aa6'); tg.addColorStop(1, '#ff5c82');
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.quadraticCurveTo(-w / 2 + wig, len * 0.6, 0, len);
      ctx.quadraticCurveTo(w / 2 + wig, len * 0.6, w / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,40,80,.55)';
      ctx.lineWidth = Math.max(1, s);
      ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(wig * 0.5, len * 0.85); ctx.stroke();
      ctx.restore();
    }
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function drawEar(x, y, s, roll, side, ts) {
    // balanço de "orelha caída" — some quase todo com a rotação real da
    // cabeça (não fica um leque fixo grudado ali), só um leve floppy extra.
    const flop = Math.sin(ts * 0.003 + side * 1.7) * 0.05;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(roll + side * 0.62 + flop);
    const w = 34 * s, h = 70 * s;
    const eg = ctx.createLinearGradient(0, -h, 0, 0);
    eg.addColorStop(0, '#b98352'); eg.addColorStop(1, '#6e4a2c');
    ctx.beginPath();
    ctx.moveTo(0, 4 * s);
    ctx.quadraticCurveTo(side * w * 1.05, -h * 0.5, side * w * 0.3, -h);
    ctx.quadraticCurveTo(-side * w * 0.4, -h * 0.62, 0, 4 * s);
    ctx.closePath();
    ctx.fillStyle = eg;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.6 * s);
    ctx.strokeStyle = 'rgba(50,32,18,.6)';
    ctx.stroke();
    // orelha interna (rosa)
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.05);
    ctx.quadraticCurveTo(side * w * 0.6, -h * 0.48, side * w * 0.22, -h * 0.8);
    ctx.quadraticCurveTo(-side * w * 0.2, -h * 0.48, 0, -h * 0.05);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,185,195,.55)';
    ctx.fill();
    // franjinha de pelo na ponta, pra não ficar uma forma lisa demais
    ctx.strokeStyle = 'rgba(60,38,20,.5)';
    ctx.lineWidth = Math.max(1, s);
    for (let i = -2; i <= 2; i++) {
      const t = i / 2;
      const bx = side * w * (0.28 + t * 0.18), by = -h * (0.86 + Math.abs(t) * 0.06);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + side * 3 * s, by - 6 * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---- Sua figurinha: imagem escolhida grudada no rosto, sempre quadrada ---- */
  function drawFaceSticker() {
    drawMirroredVideo();
    const anchor = face.ready ? face.center : { x: vw / 2, y: vh * 0.4 };
    const scale = face.ready ? face.scale : 1;
    const size = 190 * scale * (0.55 + intensity * 0.9);
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(face.ready ? face.roll : 0);
    if (userImage) drawImageCover(userImage, -size / 2, -size / 2, size, size);
    else drawPlaceholderSquare(size, 0, 0);
    ctx.restore();
  }

  /* ---- Na mão: fecha = nada, abre = a imagem escolhida aparece, em quadrado ---- */
  function drawHandSticker() {
    drawMirroredVideo();
    if (!hand.ready) return;
    const reveal = hand.openness;
    if (reveal < 0.02) return; // mão fechada — nada acontece, como pedido
    const size = 130 * hand.scale * (0.6 + intensity * 0.8) * easeOutCubic(reveal);
    ctx.save();
    ctx.globalAlpha = Math.min(1, reveal * 1.3);
    ctx.translate(hand.center.x, hand.center.y);
    ctx.rotate(hand.roll);
    if (userImage) drawImageCover(userImage, -size / 2, -size / 2, size, size);
    else drawPlaceholderSquare(size, 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---- Óculos escuros: lentes + ponte + hastes, seguindo olhos/rotação ---- */
  function drawSunglasses() {
    drawMirroredVideo();
    if (!face.ready) return;
    // eyeDist aqui é canto-externo a canto-externo (landmarks 33/263) — borda
    // externa ~0.71*eyeDist (óculos um pouco mais largos que o rosto entre os
    // olhos, como um óculos de verdade) e as lentes quase se tocando na
    // ponte, sem sobrepor.
    const eyeDist = Math.hypot(face.eyeR.x - face.eyeL.x, face.eyeR.y - face.eyeL.y) || 40 * face.scale;
    const lensR = eyeDist * 0.33, halfEye = eyeDist * 0.38;
    ctx.save();
    ctx.translate(face.center.x, face.center.y);
    ctx.rotate(face.roll);
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * halfEye, 0);
      const lg = ctx.createLinearGradient(0, -lensR, 0, lensR);
      lg.addColorStop(0, '#1c2c2a'); lg.addColorStop(1, '#050f0d');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.ellipse(0, 0, lensR, lensR * 0.78, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#080808'; ctx.lineWidth = Math.max(1.5, lensR * 0.1); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath(); ctx.ellipse(-lensR * 0.3, -lensR * 0.26, lensR * 0.28, lensR * 0.13, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const innerGap = Math.max(1.5, halfEye - lensR);
    ctx.strokeStyle = '#080808'; ctx.lineWidth = Math.max(1.5, lensR * 0.12);
    ctx.beginPath(); ctx.moveTo(-innerGap, 0); ctx.lineTo(innerGap, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-halfEye - lensR * 0.9, 0); ctx.lineTo(-halfEye - lensR * 1.5, -lensR * 0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(halfEye + lensR * 0.9, 0); ctx.lineTo(halfEye + lensR * 1.5, -lensR * 0.18); ctx.stroke();
    ctx.restore();
  }

  /* ---- Cartola: aba + copa + faixa, presa no topo da cabeça ---- */
  function drawHat() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    const upX = Math.sin(face.roll), upY = -Math.cos(face.roll);
    const topX = face.center.x + upX * 66 * s, topY = face.center.y + upY * 66 * s;
    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(face.roll);
    const w = 92 * s;
    const brimG = ctx.createLinearGradient(0, -4 * s, 0, 8 * s);
    brimG.addColorStop(0, '#1c1c1c'); brimG.addColorStop(1, '#040404');
    ctx.fillStyle = brimG;
    ctx.beginPath(); ctx.ellipse(0, 4 * s, w * 0.62, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
    const crownG = ctx.createLinearGradient(-w * 0.32, -88 * s, w * 0.32, 0);
    crownG.addColorStop(0, '#2b2b2b'); crownG.addColorStop(0.5, '#101010'); crownG.addColorStop(1, '#2b2b2b');
    ctx.fillStyle = crownG;
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, 4 * s);
    ctx.lineTo(-w * 0.3, -72 * s);
    ctx.quadraticCurveTo(0, -85 * s, w * 0.3, -72 * s);
    ctx.lineTo(w * 0.32, 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3feed0';
    ctx.fillRect(-w * 0.31, -15 * s, w * 0.62, 7 * s);
    ctx.restore();
  }

  /* ---- Bigode clássico, debaixo do nariz ---- */
  function drawMustache() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    ctx.save();
    ctx.translate(face.nose.x, face.nose.y + 13 * s);
    ctx.rotate(face.roll);
    const w = 32 * s;
    ctx.fillStyle = '#26190f';
    ctx.beginPath();
    ctx.moveTo(0, -2 * s);
    ctx.bezierCurveTo(w * 0.25, -13 * s, w * 0.55, -1 * s, w, 6 * s);
    ctx.bezierCurveTo(w * 0.68, 4 * s, w * 0.38, -2 * s, 0, 4 * s);
    ctx.bezierCurveTo(-w * 0.38, -2 * s, -w * 0.68, 4 * s, -w, 6 * s);
    ctx.bezierCurveTo(-w * 0.55, -1 * s, -w * 0.25, -13 * s, 0, -2 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ---- Coroa de flores no topo da cabeça ---- */
  function drawFlower(x, y, r, color, rot) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = color;
    for (let p = 0; p < 5; p++) {
      ctx.save(); ctx.rotate(p * (Math.PI * 2 / 5));
      ctx.beginPath(); ctx.ellipse(0, -r * 0.7, r * 0.42, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawFlowerCrown() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    const upX = Math.sin(face.roll), upY = -Math.cos(face.roll);
    const axisX = Math.cos(face.roll), axisY = Math.sin(face.roll);
    const cx = face.center.x + upX * 68 * s, cy = face.center.y + upY * 68 * s;
    const colors = ['#ff8fb3', '#ffd166', '#c88fff', '#8fd6ff', '#ffb454'];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      const x = cx + axisX * t * 128 * s + upX * Math.abs(t) * 14 * s;
      const y = cy + axisY * t * 128 * s + upY * Math.abs(t) * 14 * s;
      drawFlower(x, y, 11 * s, colors[i % colors.length], face.roll + t * 0.6);
    }
  }

  /* ---- Máscara de super-herói ao redor dos olhos ---- */
  function drawHeroMask() {
    drawMirroredVideo();
    if (!face.ready) return;
    const eyeDist = Math.hypot(face.eyeR.x - face.eyeL.x, face.eyeR.y - face.eyeL.y) || 40 * face.scale;
    ctx.save();
    ctx.translate(face.center.x, face.center.y);
    ctx.rotate(face.roll);
    const w = eyeDist * 1.65, h = eyeDist * 0.62;
    const mg = ctx.createLinearGradient(0, -h, 0, h);
    mg.addColorStop(0, '#1a1428'); mg.addColorStop(1, '#0a0714');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.quadraticCurveTo(-w / 2, -h * 1.3, -w * 0.12, -h * 1.1);
    ctx.quadraticCurveTo(0, -h * 0.7, w * 0.12, -h * 1.1);
    ctx.quadraticCurveTo(w / 2, -h * 1.3, w / 2, 0);
    ctx.quadraticCurveTo(w / 2, h * 0.9, w * 0.18, h * 0.6);
    ctx.quadraticCurveTo(0, h * 0.35, -w * 0.18, h * 0.6);
    ctx.quadraticCurveTo(-w / 2, h * 0.9, -w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(63,238,208,.7)'; ctx.lineWidth = Math.max(1.5, eyeDist * 0.04);
    ctx.stroke();
    ctx.restore();
  }

  /* ---- Apaixonado: sorria e corações saltam dos olhos + confete de coração ---- */
  let prevSmile = 0;
  function drawHeartShape(x, y, s, color) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s, -s * 0.5, -s * 1.3, s * 0.5, 0, s * 1.4);
    ctx.bezierCurveTo(s * 1.3, s * 0.5, s, -s * 0.5, 0, s * 0.35);
    ctx.fill();
    ctx.restore();
  }
  function drawHeartEyes(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const smile = face.bs.smile, s = face.scale;
      if (smile > 0.32) {
        const size = 15 * s * (0.6 + smile * 0.8);
        ctx.save(); ctx.rotate(0); drawHeartShape(face.eyeL.x, face.eyeL.y, size, '#ff5c82'); ctx.restore();
        drawHeartShape(face.eyeR.x, face.eyeR.y, size, '#ff5c82');
      }
      if (smile > 0.55 && prevSmile <= 0.55) {
        spawnBurst(face.center.x, face.center.y - 40 * s, 10, { glyph: '💗', life: 0.9, speed: 70, dir: -Math.PI / 2, spread: Math.PI });
      }
      prevSmile = smile;
    }
    updateDrawBursts(dt);
  }

  /* ---- Beijo Voador: faça beicinho e corações/beijos saem voando ---- */
  let kissSpawnTimer = 0;
  function drawFlyingKiss(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const pucker = face.bs.pucker, s = face.scale;
      if (pucker > 0.35) {
        ctx.save(); ctx.translate(face.mouth.x, face.mouth.y); ctx.rotate(face.roll);
        ctx.fillStyle = '#ff6f91';
        ctx.beginPath(); ctx.ellipse(0, 0, 9 * s * (0.6 + pucker * 0.6), 7 * s * (0.6 + pucker * 0.6), 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        kissSpawnTimer -= dt;
        if (kissSpawnTimer <= 0) {
          spawnBurst(face.mouth.x, face.mouth.y, 1, { glyph: '💋', life: 1.3, speed: 55, dir: -Math.PI / 2, spread: 0.7 });
          kissSpawnTimer = 0.32;
        }
      }
    }
    updateDrawBursts(dt);
  }

  /* ---- Esquilo: infle a bochecha (cheekPuff) e ela incha de verdade ---- */
  function drawChipmunk() {
    drawMirroredVideo();
    if (!face.ready) return;
    const puff = face.bs.cheekPuff, s = face.scale;
    if (puff < 0.06) return;
    ctx.save();
    ctx.translate(face.center.x, face.center.y);
    ctx.rotate(face.roll);
    for (const side of [-1, 1]) {
      const r = 20 * s * (0.4 + puff * 1.15);
      const cx = side * 40 * s, cy = 14 * s;
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
      g.addColorStop(0, 'rgba(255,185,165,.85)'); g.addColorStop(1, 'rgba(255,140,120,.5)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---- Cético: levante a sobrancelha ---- */
  let prevBrow = 0;
  function drawBrowRaise(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const b = face.bs.browUp, s = face.scale;
      ctx.save();
      ctx.translate(face.center.x, face.center.y);
      ctx.rotate(face.roll);
      ctx.strokeStyle = '#2a1c14'; ctx.lineWidth = Math.max(2, 5 * s); ctx.lineCap = 'round';
      const lift = 10 * s + b * 24 * s;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 32 * s, -6 * s - lift);
        ctx.quadraticCurveTo(side * 20 * s, -14 * s - lift, side * 8 * s, -8 * s - lift);
        ctx.stroke();
      }
      ctx.restore();
      if (b > 0.5 && prevBrow <= 0.5) {
        spawnBurst(face.center.x, face.center.y - 60 * s, 8, { glyph: '❗', life: 0.55, speed: 40, dir: -Math.PI / 2, spread: 0.8 });
      }
      prevBrow = b;
    }
    updateDrawBursts(dt);
  }

  /* ---- Piscada Mágica: pisque e brilho sai do olho que piscou ---- */
  let prevBlinkL = 0, prevBlinkR = 0;
  function drawMagicBlink(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      if (face.bs.blinkL > 0.55 && prevBlinkL <= 0.55) spawnBurst(face.eyeL.x, face.eyeL.y, 10, { color: '#3feed0', life: 0.6, speed: 90 });
      if (face.bs.blinkR > 0.55 && prevBlinkR <= 0.55) spawnBurst(face.eyeR.x, face.eyeR.y, 10, { color: '#ffd166', life: 0.6, speed: 90 });
      prevBlinkL = face.bs.blinkL; prevBlinkR = face.bs.blinkR;
    }
    updateDrawBursts(dt);
  }

  /* ---- Chuva de Grana: notas caindo e girando ---- */
  let money = null;
  function ensureMoney() {
    const n = Math.round(14 + intensity * 26);
    if (money && money.length === n) return;
    money = Array.from({ length: n }, () => ({
      x: Math.random() * vw, y: Math.random() * vh - vh,
      sp: 60 + Math.random() * 70, rot: Math.random() * Math.PI * 2, rotSp: (Math.random() - 0.5) * 3,
      sway: Math.random() * Math.PI * 2, swaySp: 0.6 + Math.random() * 0.6, w: 26 + Math.random() * 10
    }));
  }
  function drawMoneyRain(ts, dt) {
    drawMirroredVideo();
    ensureMoney();
    for (const b of money) {
      b.y += b.sp * dt; b.rot += b.rotSp * dt; b.sway += b.swaySp * dt;
      if (b.y > vh + 30) { b.y = -30; b.x = Math.random() * vw; }
      const x = b.x + Math.sin(b.sway) * 18;
      ctx.save();
      ctx.translate(x, b.y); ctx.rotate(b.rot);
      ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(b.rot * 0.6))));
      const g = ctx.createLinearGradient(-b.w / 2, 0, b.w / 2, 0);
      g.addColorStop(0, '#2f6e44'); g.addColorStop(0.5, '#6fca85'); g.addColorStop(1, '#2f6e44');
      ctx.fillStyle = g; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-b.w / 2, -b.w * 0.42, b.w, b.w * 0.84, 4);
      else ctx.rect(-b.w / 2, -b.w * 0.42, b.w, b.w * 0.84);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.arc(0, 0, b.w * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f6e44'; ctx.font = `${Math.round(b.w * 0.22)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, 0);
      ctx.restore();
    }
  }

  /* ---- Rastro: eco fantasma que só aparece de verdade onde você se move ---- */
  let trailCanvas = null, trailCtx = null;
  function ensureTrail() {
    if (trailCanvas && trailCanvas.width === vw && trailCanvas.height === vh) return;
    trailCanvas = document.createElement('canvas'); trailCanvas.width = vw; trailCanvas.height = vh;
    trailCtx = trailCanvas.getContext('2d');
  }
  function drawMotionTrail() {
    ensureTrail();
    const a = Math.max(0.06, 0.42 - intensity * 0.32); // intensidade alta = rastro mais longo
    trailCtx.globalAlpha = a;
    trailCtx.save();
    trailCtx.translate(vw, 0); trailCtx.scale(-1, 1);
    trailCtx.drawImage(video, 0, 0, vw, vh);
    trailCtx.restore();
    trailCtx.globalAlpha = 1;
    ctx.drawImage(trailCanvas, 0, 0);
  }

  /* ---- Caleidoscópio: espelha a imagem em fatias giratórias ---- */
  function drawKaleidoscope(ts) {
    const N = 8;
    const cx = vw / 2, cy = vh / 2, R = Math.max(vw, vh) * 1.05;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh);
    for (let i = 0; i < N; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((i * Math.PI * 2 / N) + ts * 0.00012);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, -Math.PI / N, Math.PI / N);
      ctx.closePath();
      ctx.clip();
      if (i % 2 === 1) ctx.scale(1, -1);
      ctx.translate(-cx, -cy);
      drawMirroredVideo();
      ctx.restore();
    }
  }

  /* ---- Visão Térmica: remapeia luminância pra uma paleta de câmera térmica ---- */
  let thermSmall = null, thermCtx = null, thermLUT = null;
  function buildThermalLUT() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, '#000033'); grad.addColorStop(0.25, '#3300aa');
    grad.addColorStop(0.45, '#cc00cc'); grad.addColorStop(0.6, '#ff3300');
    grad.addColorStop(0.8, '#ffcc00'); grad.addColorStop(1, '#ffffee');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 1);
    thermLUT = g.getImageData(0, 0, 256, 1).data;
  }
  function drawThermal() {
    if (!thermLUT) buildThermalLUT();
    const TW = 160, TH = 120;
    if (!thermSmall) { thermSmall = document.createElement('canvas'); thermSmall.width = TW; thermSmall.height = TH; thermCtx = thermSmall.getContext('2d', { willReadFrequently: true }); }
    thermCtx.save(); thermCtx.translate(TW, 0); thermCtx.scale(-1, 1);
    thermCtx.drawImage(video, 0, 0, TW, TH);
    thermCtx.restore();
    const img = thermCtx.getImageData(0, 0, TW, TH);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      const li = lum * 4;
      d[i] = thermLUT[li]; d[i + 1] = thermLUT[li + 1]; d[i + 2] = thermLUT[li + 2];
    }
    thermCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(thermSmall, 0, 0, vw, vh);
  }

  /* ---- Mão Mágica: o efeito de redemoinho controlado pela mão — a mão
     fechada suga a imagem pra dentro tipo buraco negro, a mão aberta faz um
     redemoinho suave. Distorção de verdade, pixel a pixel, numa versão
     reduzida do quadro (mesma técnica da térmica/neon) por performance, com
     o giro só acontecendo perto da mão. ---- */
  let warpSmall = null, warpCtx = null;
  function drawHandWarp(ts, dt) {
    if (!hand.ready) { drawMirroredVideo(); return; }
    const WW = 240, WH = Math.max(1, Math.round(WW * vh / vw));
    if (!warpSmall) { warpSmall = document.createElement('canvas'); warpSmall.width = WW; warpSmall.height = WH; warpCtx = warpSmall.getContext('2d', { willReadFrequently: true }); }
    warpCtx.save();
    warpCtx.translate(WW, 0); warpCtx.scale(-1, 1);
    warpCtx.drawImage(video, 0, 0, WW, WH);
    warpCtx.restore();
    const sx = WW / vw, sy = WH / vh;
    const cx = hand.center.x * sx, cy = hand.center.y * sy;
    const closed = 1 - hand.openness; // 0 mão aberta .. 1 mão fechada
    const R = Math.max(16, 42 * hand.scale * sx * (0.7 + intensity * 0.8));
    const swirlMax = (0.9 + closed * 2.6) * (0.6 + intensity * 0.8);
    const pull = closed * 0.55;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(WW, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(WH, Math.ceil(cy + R));
    if (x1 > x0 && y1 > y0) {
      const img = warpCtx.getImageData(0, 0, WW, WH);
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const dx = x - cx, dy = y - cy;
          const dist = Math.hypot(dx, dy);
          if (dist >= R || dist < 0.001) continue;
          const t = 1 - dist / R;
          const ang = Math.atan2(dy, dx) + swirlMax * t * t;
          const rr = dist * (1 - pull * t * t);
          const sxp = cx + Math.cos(ang) * rr, syp = cy + Math.sin(ang) * rr;
          const ix = Math.max(0, Math.min(WW - 1, sxp | 0)), iy = Math.max(0, Math.min(WH - 1, syp | 0));
          const si = (iy * WW + ix) * 4, di = (y * WW + x) * 4;
          d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2]; d[di + 3] = src[si + 3];
        }
      }
      warpCtx.putImageData(img, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(warpSmall, 0, 0, vw, vh);
    ctx.save();
    const glowR = R / sx;
    const g = ctx.createRadialGradient(hand.center.x, hand.center.y, 0, hand.center.x, hand.center.y, glowR);
    g.addColorStop(0, `rgba(180,140,255,${0.16 + closed * 0.14})`);
    g.addColorStop(1, 'rgba(180,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hand.center.x, hand.center.y, glowR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---- Bravo: sobrancelha franzida (browDown) + vapor de raiva ---- */
  let prevAngry = 0, angrySteamTimer = 0;
  function drawAngry(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const b = face.bs.browDown, s = face.scale;
      ctx.save();
      ctx.translate(face.center.x, face.center.y);
      ctx.rotate(face.roll);
      ctx.strokeStyle = '#2a1c14'; ctx.lineWidth = Math.max(2, 5 * s); ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 10 * s, -18 * s - b * 3 * s);
        ctx.lineTo(side * 32 * s, -7 * s - b * 9 * s);
        ctx.stroke();
      }
      ctx.restore();
      if (b > 0.4) {
        angrySteamTimer -= dt;
        if (angrySteamTimer <= 0) {
          spawnBurst(face.center.x + (Math.random() - 0.5) * 20 * s, face.center.y - 44 * s, 1, { color: '#c8c8c8', life: 0.8, speed: 22, dir: -Math.PI / 2, spread: 0.6, size: 4 });
          angrySteamTimer = 0.35;
        }
      }
      if (b > 0.55 && prevAngry <= 0.55) {
        spawnBurst(face.center.x, face.center.y - 40 * s, 5, { color: '#ff5c4d', life: 0.5, speed: 50, dir: -Math.PI / 2, spread: 1.2 });
      }
      prevAngry = b;
    }
    updateDrawBursts(dt);
  }

  /* ---- Chocado: olhos arregalam (eyeWide) + estrelas de susto ---- */
  let prevShock = 0;
  function drawShocked(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const w = face.bs.eyeWide, s = face.scale;
      if (w > 0.15) {
        for (const eye of [face.eyeL, face.eyeR]) {
          ctx.save();
          ctx.translate(eye.x, eye.y);
          const r = (6 + w * 10) * s;
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
          g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.55, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#12181c';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      if (w > 0.55 && prevShock <= 0.55) {
        spawnBurst(face.center.x, face.center.y - 50 * s, 7, { glyph: '✦', life: 0.6, speed: 70, spread: Math.PI * 2 });
      }
      prevShock = w;
    }
    updateDrawBursts(dt);
  }

  /* ---- Choroso: lágrima escorre enquanto a boca cai de tristeza (mouthFrown) ---- */
  let tearPhaseL = 0, tearPhaseR = 0.4;
  function drawCrying(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const f = face.bs.mouthFrown, s = face.scale;
      ctx.save();
      ctx.translate(face.center.x, face.center.y);
      ctx.rotate(face.roll);
      ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = Math.max(2, 4 * s); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-24 * s, 34 * s + f * 3 * s);
      ctx.quadraticCurveTo(0, 34 * s + f * 10 * s, 24 * s, 34 * s + f * 3 * s);
      ctx.stroke();
      ctx.restore();
      if (f > 0.3) {
        tearPhaseL = (tearPhaseL + dt * 0.7) % 1;
        tearPhaseR = (tearPhaseR + dt * 0.7) % 1;
        for (const pair of [[face.eyeL, tearPhaseL], [face.eyeR, tearPhaseR]]) {
          const eye = pair[0], ph = pair[1];
          const drop = 30 * s * ph;
          const alpha = ph < 0.85 ? 1 : (1 - ph) / 0.15;
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * Math.min(1, f * 2);
          ctx.fillStyle = '#5ec8ff';
          ctx.beginPath();
          ctx.moveTo(eye.x, eye.y + 4 * s + drop);
          ctx.bezierCurveTo(eye.x - 3.5 * s, eye.y + 10 * s + drop, eye.x - 3.5 * s, eye.y + 16 * s + drop, eye.x, eye.y + 17 * s + drop);
          ctx.bezierCurveTo(eye.x + 3.5 * s, eye.y + 16 * s + drop, eye.x + 3.5 * s, eye.y + 10 * s + drop, eye.x, eye.y + 4 * s + drop);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  /* ---- Nojinho: nariz franze (noseSneer) + fumacinha esverdeada ---- */
  let sneerTimer = 0;
  function drawDisgust(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const n = face.bs.noseSneer, s = face.scale;
      if (n > 0.15) {
        ctx.save();
        ctx.translate(face.nose.x, face.nose.y);
        ctx.rotate(face.roll);
        ctx.strokeStyle = `rgba(120,200,90,${Math.min(0.9, n * 1.4)})`;
        ctx.lineWidth = Math.max(1.2, 2 * s);
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.moveTo(-6 * s - i * 3 * s, -6 * s - i * 3 * s);
          ctx.lineTo(6 * s + i * 3 * s, -6 * s - i * 3 * s);
          ctx.stroke();
        }
        ctx.restore();
        sneerTimer -= dt;
        if (sneerTimer <= 0) {
          spawnBurst(face.nose.x, face.nose.y - 14 * s, 3, { color: '#8fd97a', life: 0.6, speed: 18, dir: -Math.PI / 2, spread: 1.0, size: 4 });
          sneerTimer = 0.5;
        }
      }
    }
    updateDrawBursts(dt);
  }

  /* ---- Risada: sorriso + boca bem aberta ao mesmo tempo = gargalhada ---- */
  let laughTimer = 0;
  function drawLaugh(ts, dt) {
    drawMirroredVideo();
    if (face.ready) {
      const on = face.bs.smile > 0.45 && face.jawOpen > 0.35;
      const s = face.scale;
      if (on) {
        const wob = Math.sin(ts * 0.02) * 3 * s;
        ctx.save();
        ctx.translate(face.center.x + wob, face.center.y);
        ctx.rotate(face.roll + Math.sin(ts * 0.02) * 0.03);
        ctx.strokeStyle = '#2a1c14'; ctx.lineWidth = Math.max(2, 4 * s); ctx.lineCap = 'round';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side * 10 * s, -20 * s);
          ctx.quadraticCurveTo(side * 22 * s, -26 * s, side * 32 * s, -18 * s);
          ctx.stroke();
        }
        ctx.restore();
        laughTimer -= dt;
        if (laughTimer <= 0) {
          spawnBurst(face.eyeL.x, face.eyeL.y, 1, { glyph: '😂', life: 0.9, speed: 40, dir: -Math.PI / 2.4, spread: 0.5 });
          laughTimer = 0.45;
        }
      }
    }
    updateDrawBursts(dt);
  }

  /* ---- Coroa Real: coroa dourada com joias no topo da cabeça ---- */
  function drawCrown() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    const upX = Math.sin(face.roll), upY = -Math.cos(face.roll);
    const topX = face.center.x + upX * 64 * s, topY = face.center.y + upY * 64 * s;
    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(face.roll);
    const w = 124 * s, h = 54 * s;
    const g = ctx.createLinearGradient(-w / 2, -h, w / 2, 0);
    g.addColorStop(0, '#e8b93c'); g.addColorStop(0.5, '#fff3b0'); g.addColorStop(1, '#c9931c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 4 * s);
    ctx.lineTo(-w / 2, -h * 0.3);
    ctx.lineTo(-w * 0.32, -h * 0.7);
    ctx.lineTo(-w * 0.16, -h * 0.35);
    ctx.lineTo(0, -h);
    ctx.lineTo(w * 0.16, -h * 0.35);
    ctx.lineTo(w * 0.32, -h * 0.7);
    ctx.lineTo(w / 2, -h * 0.3);
    ctx.lineTo(w / 2, 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8a6410'; ctx.lineWidth = Math.max(1, s); ctx.stroke();
    const jewels = [[-w * 0.28, -h * 0.1, '#e0475a'], [0, -h * 0.55, '#3fa7ee'], [w * 0.28, -h * 0.1, '#4bd07a']];
    for (const j of jewels) {
      ctx.fillStyle = j[2];
      ctx.beginPath(); ctx.arc(j[0], j[1], 7 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(j[0] - 2 * s, j[1] - 2 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---- Chifres: par de chifres de diabinho, curvos, na testa ---- */
  function drawHorns() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    const upX = Math.sin(face.roll), upY = -Math.cos(face.roll);
    const topX = face.center.x + upX * 48 * s, topY = face.center.y + upY * 48 * s;
    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(face.roll);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 32 * s, 0);
      ctx.rotate(side * 0.35);
      const g = ctx.createLinearGradient(0, 0, 0, -48 * s);
      g.addColorStop(0, '#6b1616'); g.addColorStop(1, '#1c0505');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-10 * s, 9 * s);
      ctx.quadraticCurveTo(-11 * s, -22 * s, 0, -48 * s);
      ctx.quadraticCurveTo(11 * s, -22 * s, 10 * s, 9 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---- Gato: orelhas triangulares + bigodes + naricinho rosa ---- */
  function drawCatEars() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    for (const pair of [[face.earL, -1], [face.earR, 1]]) {
      const ear = pair[0], side = pair[1];
      ctx.save();
      ctx.translate(ear.x, ear.y);
      ctx.rotate(face.roll + side * 0.15);
      const g = ctx.createLinearGradient(0, 16 * s, 0, -48 * s);
      g.addColorStop(0, '#3a2c26'); g.addColorStop(1, '#171110');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-21 * s, 16 * s); ctx.lineTo(21 * s, 16 * s); ctx.lineTo(0, -45 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e69bb0';
      ctx.beginPath(); ctx.moveTo(-11 * s, 9 * s); ctx.lineTo(11 * s, 9 * s); ctx.lineTo(0, -26 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(face.nose.x, face.nose.y);
    ctx.rotate(face.roll);
    ctx.fillStyle = '#ff8fa8';
    ctx.beginPath(); ctx.moveTo(-6 * s, -4 * s); ctx.lineTo(6 * s, -4 * s); ctx.lineTo(0, 5 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,15,15,.75)'; ctx.lineWidth = Math.max(1, 2 * s); ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const yy = -5 * s + i * 5 * s;
        ctx.beginPath();
        ctx.moveTo(side * 8 * s, yy);
        ctx.lineTo(side * (48 + i * 5) * s, yy - i * 2.5 * s);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---- Bandana Ninja: faixa na testa com pontas esvoaçando ---- */
  function drawBandana(ts) {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    const upX = Math.sin(face.roll), upY = -Math.cos(face.roll);
    const topX = face.center.x + upX * 14 * s, topY = face.center.y + upY * 14 * s;
    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(face.roll);
    // largura da faixa perto da largura toda da cabeça (mesma referência dos
    // 1.25x eyeDist usado pras orelhas), senão fica um adesivinho na testa.
    ctx.fillStyle = '#1c2320';
    ctx.fillRect(-108 * s, -12 * s, 216 * s, 22 * s);
    ctx.fillStyle = '#c0342f';
    ctx.fillRect(-108 * s, -2 * s, 216 * s, 4 * s);
    const wave = Math.sin(ts * 0.006) * 16 * s;
    ctx.fillStyle = '#1c2320';
    ctx.beginPath();
    ctx.moveTo(102 * s, -6 * s);
    ctx.quadraticCurveTo(138 * s + wave, 9 * s, 168 * s + wave, -9 * s + wave * 0.4);
    ctx.lineTo(160 * s + wave, 3 * s);
    ctx.quadraticCurveTo(128 * s + wave, 15 * s, 102 * s, 9 * s);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(102 * s, 4 * s);
    ctx.quadraticCurveTo(132 * s - wave, 24 * s, 160 * s - wave, 12 * s - wave * 0.3);
    ctx.lineTo(150 * s - wave, 22 * s);
    ctx.quadraticCurveTo(118 * s - wave, 30 * s, 102 * s, 15 * s);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---- Halo de Anjo: anel dourado brilhante flutuando sobre a cabeça ---- */
  function drawHalo(ts) {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    const upX = Math.sin(face.roll), upY = -Math.cos(face.roll);
    const topX = face.center.x + upX * 100 * s, topY = face.center.y + upY * 100 * s;
    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(Math.sin(ts * 0.0012) * 0.25);
    ctx.scale(1, 0.32);
    const r = 80 * s;
    const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.5);
    glow.addColorStop(0, 'rgba(255,238,150,.55)'); glow.addColorStop(1, 'rgba(255,238,150,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe58a'; ctx.lineWidth = Math.max(2, 5 * s);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, 1.6 * s);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  /* ---- Capacete Espacial: bolha de vidro ao redor da cabeça ---- */
  function drawHelmet() {
    drawMirroredVideo();
    if (!face.ready) return;
    const s = face.scale;
    ctx.save();
    ctx.translate(face.center.x, face.center.y - 10 * s);
    ctx.rotate(face.roll);
    const r = 138 * s;
    ctx.lineWidth = Math.max(3, 7 * s);
    ctx.strokeStyle = '#c7d4d6';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    const tint = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 4, 0, 0, r);
    tint.addColorStop(0, 'rgba(190,230,255,.10)'); tint.addColorStop(1, 'rgba(120,180,210,.28)');
    ctx.fillStyle = tint;
    ctx.beginPath(); ctx.arc(0, 0, r - 3 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.4, r * 0.22, r * 0.4, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---- VHS Retrô: aberração cromática, scanlines e falhas de fita ---- */
  let vhsCanvas = null, vhsCtx = null, vhsGlitchTimer = 0, vhsBars = [];
  function ensureVhs() {
    if (vhsCanvas) return;
    vhsCanvas = document.createElement('canvas');
    vhsCtx = vhsCanvas.getContext('2d');
  }
  function drawVhsChannel(dx, color, alpha) {
    vhsCanvas.width = vw; vhsCanvas.height = vh;
    vhsCtx.save();
    vhsCtx.translate(vw, 0); vhsCtx.scale(-1, 1);
    vhsCtx.drawImage(video, 0, 0, vw, vh);
    vhsCtx.restore();
    vhsCtx.globalCompositeOperation = 'source-in';
    vhsCtx.fillStyle = color;
    vhsCtx.fillRect(0, 0, vw, vh);
    vhsCtx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(vhsCanvas, dx, 0);
    ctx.restore();
  }
  function drawVHS(ts, dt) {
    ensureVhs();
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, vw, vh);
    drawVhsChannel(-2.4, '#ff2244', 0.55);
    drawVhsChannel(2.4, '#22e0ff', 0.55);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    for (let y = 0; y < vh; y += 3) ctx.fillRect(0, y, vw, 1);
    ctx.restore();
    const gr = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.3, vw / 2, vh / 2, vh * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh);
    vhsGlitchTimer -= dt;
    if (vhsGlitchTimer <= 0) {
      const n = 1 + Math.floor(Math.random() * 2);
      vhsBars = Array.from({ length: n }, () => ({ y: Math.random() * vh, h: 4 + Math.random() * 10, life: 0.12 + Math.random() * 0.1 }));
      vhsGlitchTimer = 0.6 + Math.random() * 1.4;
    }
    for (const bar of vhsBars) {
      bar.life -= dt;
      if (bar.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(canvas, 0, bar.y, vw, bar.h, 6, bar.y, vw, bar.h);
      ctx.restore();
    }
    vhsBars = vhsBars.filter(b => b.life > 0);
    ctx.save();
    ctx.font = `${Math.round(14 * (vw / 480))}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    // canto inferior direito, onde não atrapalha nenhuma UI sobreposta
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    if (Math.floor(ts / 500) % 2 === 0) ctx.fillText('● REC', vw - 14, vh - 12);
    ctx.restore();
  }

  /* ---- Chuva Digital: câmera "hackeada", colunas de caracteres caindo ---- */
  let matrixCols = null;
  function ensureMatrix() {
    const cw = 16;
    const n = Math.ceil(vw / cw);
    if (matrixCols && matrixCols.length === n) return;
    matrixCols = Array.from({ length: n }, (_, i) => ({
      x: i * cw + cw / 2, y: Math.random() * vh, sp: 90 + Math.random() * 140, len: 6 + Math.floor(Math.random() * 8)
    }));
  }
  const MATRIX_CHARS = '01アイウエオカキクケコサシスセソ+-*/<>{}';
  function drawMatrix(ts, dt) {
    ensureMatrix();
    ctx.save();
    ctx.filter = 'grayscale(1) brightness(.5) contrast(1.2)';
    drawMirroredVideo();
    ctx.restore();
    ctx.fillStyle = 'rgba(2,10,4,.55)';
    ctx.fillRect(0, 0, vw, vh);
    ctx.font = '15px monospace';
    ctx.textAlign = 'center';
    for (const c of matrixCols) {
      c.y += c.sp * dt;
      if (c.y - c.len * 16 > vh) { c.y = -Math.random() * 200; c.sp = 90 + Math.random() * 140; }
      for (let i = 0; i < c.len; i++) {
        const yy = c.y - i * 16;
        if (yy < -16 || yy > vh + 16) continue;
        const a = i === 0 ? 1 : Math.max(0, 1 - i / c.len);
        ctx.fillStyle = i === 0 ? '#d6ffe2' : `rgba(60,230,110,${a})`;
        ctx.fillText(MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)], c.x, yy);
      }
    }
  }

  /* ---- Fogos de Artifício: explosões periódicas de partículas coloridas ---- */
  let fireworkTimer = 1.0;
  const FIREWORK_COLORS = ['#ff5c6c', '#ffd166', '#5ec8ff', '#a78bfa', '#4ce0a0', '#ff8fd6'];
  function drawFireworks(ts, dt) {
    drawMirroredVideo();
    fireworkTimer -= dt;
    if (fireworkTimer <= 0) {
      const x = vw * 0.15 + Math.random() * vw * 0.7;
      const y = vh * 0.12 + Math.random() * vh * 0.42;
      const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
      spawnBurst(x, y, 30, { color, life: 1.1, speed: 130, spread: Math.PI * 2, size: 3.5 });
      spawnBurst(x, y, 10, { color: '#ffffff', life: 0.5, speed: 60, spread: Math.PI * 2, size: 2 });
      fireworkTimer = 0.55 + Math.random() * 0.9;
    }
    updateDrawBursts(dt);
  }

  /* ---- Estrelas Cadentes: rastros de luz cruzando o céu ---- */
  let shootingStars = [], starTimer = 0.6;
  function drawShootingStars(ts, dt) {
    drawMirroredVideo();
    starTimer -= dt;
    if (starTimer <= 0) {
      const fromLeft = Math.random() < 0.5;
      shootingStars.push({
        x: fromLeft ? -20 : vw + 20, y: Math.random() * vh * 0.55,
        vx: (fromLeft ? 1 : -1) * (260 + Math.random() * 160), vy: 90 + Math.random() * 70,
        life: 0, maxLife: 1.1, len: 46 + Math.random() * 30
      });
      starTimer = 0.5 + Math.random() * 1.3;
    }
    for (const st of shootingStars) {
      st.life += dt; st.x += st.vx * dt; st.y += st.vy * dt;
      const a = Math.max(0, 1 - st.life / st.maxLife);
      const ang = Math.atan2(st.vy, st.vx);
      const tx = st.x - Math.cos(ang) * st.len, ty = st.y - Math.sin(ang) * st.len;
      const g = ctx.createLinearGradient(st.x, st.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    shootingStars = shootingStars.filter(st => st.life < st.maxLife && st.x > -60 && st.x < vw + 60);
  }

  /* ---- Túnel Warp: zoom em anéis concêntricos, efeito hipnótico ---- */
  function drawTunnel(ts) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh);
    const N = 7;
    const speed = 0.00035;
    for (let i = N - 1; i >= 0; i--) {
      const phase = ((ts * speed) + i / N) % 1;
      const scale = 0.12 + phase * 1.7;
      const alpha = Math.min(1, phase * 2) * Math.max(0, 1 - phase * 0.9);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(vw / 2, vh / 2);
      ctx.rotate((phase - 0.5) * 0.5);
      ctx.scale(scale, scale);
      ctx.translate(-vw / 2, -vh / 2);
      drawMirroredVideo();
      ctx.restore();
    }
  }

  /* ---- Moldura Mágica: gesto de fazer uma moldura com as duas mãos
     (polegar + indicador de cada mão) pra ver "outra realidade" só dentro
     dela. Precisa das DUAS mãos de verdade — não tem como simular no modo
     manual, que só tem uma âncora — então some se o rastreamento não
     estiver ativo ou só uma mão aparecer. ---- */
  function drawHandFrame(ts, dt) {
    drawMirroredVideo();
    if (handsFrameAlpha < 0.02 || !handsFrameReady) return;
    const pts = handsFrame;
    ctx.save();
    ctx.globalAlpha = handsFrameAlpha;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    // "evenodd" preenche os dois triângulos certinho quando o laço cruza
    // (mãos giradas em sentidos opostos, tipo "borboleta"), em vez de deixar
    // um dos lados vazio dependendo de qual direção o laço cruzou.
    ctx.clip('evenodd');
    // "outra realidade" dentro da moldura: cor girando lentamente no tempo,
    // bem saturada, tipo portal/dimensão alternativa.
    ctx.filter = `hue-rotate(${Math.round((ts * 0.05) % 360)}deg) saturate(2.6) contrast(1.25) brightness(1.08)`;
    drawMirroredVideo();
    ctx.filter = 'none';
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = handsFrameAlpha;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(200,160,255,.95)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(180,120,255,.9)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
  }

  /* =====================================================================
     PIPELINE: construção/gestão de <video>+<canvas> ocultos e da track de
     saída. Tudo aqui foi criado do zero pra este módulo — não existia no
     protótipo, que usava um <video>/<canvas> fixos no HTML da página.
     ===================================================================== */

  // estilo comum pros dois elementos ocultos — fora da área visível e sem
  // interceptar clique/toque em lugar nenhum da UI real do WifiCord.
  const HIDDEN_STYLE = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;opacity:0;pointer-events:none;';

  function ensureElements() {
    if (video && canvas) return; // pipeline já existe — attach() seguinte só troca a entrada
    video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.style.cssText = HIDDEN_STYLE;
    document.body.appendChild(video);

    canvas = document.createElement('canvas');
    canvas.style.cssText = HIDDEN_STYLE;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { willReadFrequently: false });
  }

  // espera o <video> ter pelo menos um frame decodificado (readyState >= 2)
  // antes de começarmos a desenhar — sem isso o primeiro drawImage falha
  // silenciosamente (desenha um quadro preto/transparente).
  function waitForVideoReady() {
    return new Promise((resolve) => {
      if (video.readyState >= 2) { resolve(); return; }
      const onReady = () => { video.removeEventListener('loadedmetadata', onReady); resolve(); };
      video.addEventListener('loadedmetadata', onReady);
    });
  }

  // redimensiona o canvas de trabalho pra bater com a resolução real da
  // track (settings.width/height) — chamado tanto no primeiro attach()
  // quanto numa troca de dispositivo que mude de resolução. As caches
  // internas dependentes de tamanho (rastro, neve, chuva de grana, matrix,
  // segmentação etc.) já conferem sozinhas se o tamanho mudou e se
  // reconstroem — não precisamos invalidar nada explicitamente aqui.
  function resizeCanvas(w, h) {
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    vw = w; vh = h;
    resetManualAnchor();
  }

  /* =====================================================================
     LOOP PESADO (filtro ativo de verdade)
     ===================================================================== */
  // Teto de ~30fps pro DESENHO pesado (detecção + partículas + gradientes
  // etc.) — sem isso o loop rodava no refresh nativo da TELA (60-120Hz em
  // boa parte dos celulares), fazendo o dobro/quádruplo de trabalho que
  // qualquer chamada de vídeo realmente aproveita (a saída em si já sai
  // limitada a CAPTURE_FPS=30 mais abaixo). Reagendar o rAF continua
  // acontecendo todo frame (mantém o relógio fino pra próxima checagem),
  // só o TRABALHO caro é que fica represado até passar tempo suficiente.
  const RENDER_MIN_DT_MS = 1000 / 30;
  function renderLoop(ts) {
    if (!renderLoopRunning) return; // detach()/setFilter(null) já pararam — não reagenda
    rafId = requestAnimationFrame(renderLoop);
    if (!video || video.readyState < 2) return;
    if (!lastTs) lastTs = ts;
    if (ts - lastTs < RENDER_MIN_DT_MS) return;
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;

    const f = FILTERS[activeIndex];
    if (!f) return; // defensivo — não deveria acontecer fora de setFilter()
    if (f.needsFace) { detectFace(ts); smoothFace(dt); }
    if (f.needsHand) { detectHand(ts); smoothHand(dt); }

    ctx.save();
    f.draw(ts, dt);
    ctx.restore();
  }
  function startRenderLoop() {
    if (renderLoopRunning) return;
    renderLoopRunning = true;
    lastTs = 0;
    rafId = requestAnimationFrame(renderLoop);
  }
  function stopRenderLoop() {
    renderLoopRunning = false;
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  /* =====================================================================
     LOOP LEVE DE PASSTHROUGH (nenhum filtro ativo)
     Ver o comentário grande lá em cima, na seção "LOOPS DE RENDER", pro
     raciocínio completo. Resumo: desenha só o espelho, sem nenhuma lógica
     de filtro/rastreamento/partículas, e só quando o <video> realmente tem
     um quadro novo (requestVideoFrameCallback) — assim a track de saída
     continua ao vivo sem pagar o custo do loop pesado.
     ===================================================================== */
  function passthroughStep() {
    if (!passthroughRunning) return;
    if (ctx && video && video.readyState >= 2) drawMirroredVideo();
    if (typeof video.requestVideoFrameCallback === 'function') {
      vfcHandle = video.requestVideoFrameCallback(passthroughStep);
    }
  }
  function startPassthroughLoop() {
    if (passthroughRunning || !video) return;
    passthroughRunning = true;
    if (typeof video.requestVideoFrameCallback === 'function') {
      vfcHandle = video.requestVideoFrameCallback(passthroughStep);
      vfcIsInterval = false;
    } else {
      // plano B pra navegadores sem requestVideoFrameCallback (bem raro
      // hoje em dia): redesenha a ~15fps por setInterval — barato o
      // bastante pra não pesar mesmo sem filtro nenhum ativo, e ainda assim
      // mantém a track de saída viva em vez de congelada.
      vfcHandle = setInterval(passthroughStep, 66);
      vfcIsInterval = true;
    }
  }
  function stopPassthroughLoop() {
    passthroughRunning = false;
    if (vfcHandle != null) {
      if (vfcIsInterval) clearInterval(vfcHandle);
      else if (video && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(vfcHandle);
      vfcHandle = null;
    }
    vfcIsInterval = false;
  }

  /* =====================================================================
     API PÚBLICA
     ===================================================================== */

  // Lista enxuta pra popular UI (tray de filtros etc.) — só os campos que
  // uma tela de escolha de filtro precisa, sem vazar internals (draw,
  // needsFace/needsHand/needsSeg, desc).
  function listFilters() {
    return FILTERS.map(f => ({ id: f.id, name: f.name, icon: f.icon }));
  }

  // Conecta (ou reconecta) uma track de vídeo crua ao pipeline e devolve a
  // track processada de saída. Chamar de novo com uma track NOVA (troca de
  // câmera, toggle de vídeo, etc.) reaproveita todo o pipeline já montado —
  // só troca o srcObject do <video> interno e redimensiona o canvas se a
  // resolução mudou, sem recriar contexto 2D, sem reiniciar o MediaPipe e
  // sem perder a track de saída (quem já fez replaceTrack com ela continua
  // recebendo o mesmo objeto de track, só que agora mostrando a nova
  // entrada).
  async function attach(rawTrack) {
    if (!rawTrack || rawTrack.kind !== 'video') {
      throw new Error('WifiCordFilters.attach precisa receber uma MediaStreamTrack de vídeo.');
    }

    ensureElements();

    const settings = (typeof rawTrack.getSettings === 'function' && rawTrack.getSettings()) || {};
    let w = settings.width || DEFAULT_W;
    let h = settings.height || DEFAULT_H;
    // Reduz proporcionalmente pro teto de MAX_DIM no lado maior, mantendo
    // a proporção da câmera real (ver comentário em MAX_DIM acima).
    const longEdge = Math.max(w, h);
    if (longEdge > MAX_DIM) {
      const scale = MAX_DIM / longEdge;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    resizeCanvas(w, h);

    rawStream = new MediaStream([rawTrack]);
    video.srcObject = rawStream;
    try { await video.play(); } catch (e) { /* alguns browsers reclamam de play() redundante — inofensivo */ }
    await waitForVideoReady();

    if (!outputTrack) {
      outputStream = canvas.captureStream(CAPTURE_FPS);
      outputTrack = outputStream.getVideoTracks()[0];
    }

    // garante que ALGUM loop esteja rodando assim que há vídeo de verdade —
    // por padrão isso é o passthrough (nenhum filtro selecionado ainda).
    if (activeFilterId == null && !renderLoopRunning) startPassthroughLoop();

    // inicialização do MediaPipe é pesada (baixa modelos) e só precisa
    // rodar uma vez por "sessão" deste módulo — não a cada troca de câmera.
    if (!trackingStarted) {
      trackingStarted = true;
      initTracking(); // não bloqueia — degrada pra modo manual sozinho se falhar
    }

    attached = true;
    return outputTrack;
  }

  // Troca o filtro ativo. null ou 'original' = passthrough (loop pesado
  // desligado). Um id desconhecido é ignorado (com aviso no console) em vez
  // de quebrar a call em andamento.
  function setFilter(id) {
    const targetId = (id == null || id === 'original') ? null : id;
    if (targetId === activeFilterId) return; // já está nesse estado

    let idx = -1;
    if (targetId != null) {
      idx = FILTERS.findIndex(f => f.id === targetId);
      if (idx === -1) {
        console.warn(`[WifiCordFilters] Filtro desconhecido "${id}", ignorando.`);
        return;
      }
    }

    activeFilterId = targetId;
    activeIndex = idx;

    if (activeFilterId == null) {
      stopRenderLoop();
      startPassthroughLoop();
    } else {
      stopPassthroughLoop();
      startRenderLoop();
    }
  }

  function isFilterActive() {
    return activeFilterId != null;
  }

  // Desliga tudo e libera pra garbage collection. NÃO para a track crua de
  // entrada (rawTrack) — essa é dona do código de call, que decide quando
  // parar a câmera de verdade; aqui só soltamos nossa referência a ela.
  function detach() {
    stopRenderLoop();
    stopPassthroughLoop();

    if (outputStream) {
      outputStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
    }
    outputStream = null;
    outputTrack = null;
    rawStream = null;

    if (video) {
      try { video.pause(); } catch (e) { }
      video.srcObject = null;
      video.remove();
      video = null;
    }
    if (canvas) {
      canvas.remove();
      canvas = null;
      ctx = null;
    }

    // libera os landmarkers do MediaPipe (eles seguram memória de WASM/GPU)
    try { faceLandmarker && faceLandmarker.close && faceLandmarker.close(); } catch (e) { }
    try { handLandmarker && handLandmarker.close && handLandmarker.close(); } catch (e) { }
    try { imageSegmenter && imageSegmenter.close && imageSegmenter.close(); } catch (e) { }
    faceLandmarker = null; handLandmarker = null; imageSegmenter = null;
    trackingMode = 'loading'; handMode = 'loading'; segMode = 'loading';
    lastVideoTs = -1; lastHandTs = -1; lastSegTs = -1;
    faceDetected = false; handDetected = false;
    face.ready = false; hand.ready = false;
    handsFrameSeen = false; handsFrameReady = false; handsFrameAlpha = 0;
    handsFrame = [null, null, null, null];

    // reseta estados transitórios de efeitos/partículas — evita que "sobre"
    // confete/fogos/rastro etc. de uma call pra outra quando o módulo for
    // reusado (attach() de novo) mais tarde na mesma aba.
    burstParticles = [];
    snow = null; confetti = null; money = null; matrixCols = null;
    shootingStars = []; vhsBars = [];
    trailCanvas = null; trailCtx = null;
    warpSmall = null; warpCtx = null;

    vw = 0; vh = 0;
    attached = false;
    trackingStarted = false;
    activeFilterId = null;
    activeIndex = -1;
  }

  /* =====================================================================
     EXPORT
     ===================================================================== */
  window.WifiCordFilters = {
    listFilters,
    attach,
    setFilter,
    isFilterActive,
    detach,
    get currentOutputTrack() { return outputTrack; },
  };
})();
