// desktop-app/main.js
// App de desktop do WifiCord: uma janela do Electron carregando o servidor
// já hospedado (igual o app oficial do Discord faz com o site deles).
'use strict';

const { app, BrowserWindow, session, Menu, shell, desktopCapturer, ipcMain, Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { autoUpdater } = require('electron-updater');

// URL do seu servidor hospedado. Pode trocar via variável de ambiente
// WIFICORD_URL sem precisar mexer no código (útil pra testar local x produção).
const SERVER_URL = process.env.WIFICORD_URL || 'https://wificord.onrender.com';

// O som de notificação (client/js/sounds.js, padrão "message"/"notification")
// é sintetizado via Web Audio API (AudioContext) na própria página — não é
// um <audio>/arquivo tocado pelo processo principal. Por padrão o Chromium
// só libera esse AudioContext depois de um gesto real do usuário (clique)
// NAQUELA janela. Numa aba de navegador normal isso quase nunca é
// perceptível: a pessoa clica em algo (fazer login, abrir uma conversa)
// bem antes de a aba ir pro segundo plano, o que já libera o áudio pro
// resto da sessão. Já o app desktop é feito pra rodar sem nenhuma interação
// — abre minimizado/na bandeja e fica só recebendo mensagens em segundo
// plano (ver 'wificord-window-close' mais abaixo) — então o primeiro som de
// notificação podia chegar antes de qualquer clique acontecer dentro da
// janela, e o AudioContext nunca tinha sido liberado: o som simplesmente
// não tocava (sem erro nenhum, silencioso). Esse switch tem que ser
// aplicado ANTES de app.whenReady() e desliga essa exigência só pra esta
// janela do Electron — não afeta o navegador normal, que continua com a
// política padrão do Chrome.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let tray = null;

// ---------------------------------------------------------------------
// Instância única: sem isso, abrir o atalho/.exe de novo enquanto o app já
// está rodando em segundo plano (ver "fica em segundo plano" mais abaixo,
// no handler de 'wificord-window-close') abriria um SEGUNDO processo do
// zero — em vez disso, o clique novo só traz a janela já aberta pra frente.
// ---------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showMainWindow(); });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Por padrão o app fica igual ao Discord/apps de produção: sem atalho pra
// abrir o DevTools (F12/Ctrl+Shift+I/J/C), então quem só abre o .exe não
// vê a árvore de arquivos do site pelo inspecionar. IMPORTANTE: isso NÃO é
// uma proteção de verdade — o mesmo site aberto num navegador comum
// continua com o código-fonte do lado do cliente 100% visível por
// definição (é assim que a web funciona: o navegador PRECISA baixar esse
// código pra executar). Isso só evita o atalho mais óbvio dentro do app
// desktop. Pra depurar localmente, defina WIFICORD_DEVTOOLS=1 antes de
// abrir o app.
const ALLOW_DEVTOOLS = process.env.WIFICORD_DEVTOOLS === '1';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0a18',
    title: 'WifiCord',
    autoHideMenuBar: true,
    // Sem moldura nativa do Windows/Linux (aquela barra vermelha padrão com
    // "WifiCord" e os quadradinhos de minimizar/maximizar/fechar do
    // sistema) — o site desenha a própria barra de título, escura e no
    // mesmo estilo do resto do app (ver client/js/titlebar.js e o bloco
    // "#wc-titlebar" no final do style.css). Só existe dentro do app
    // desktop: numa aba de navegador normal window.wificordDesktop não
    // existe, então titlebar.js não faz nada e o navegador continua usando
    // a própria barra dele normalmente.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sem isso, o Chromium reduz drasticamente a frequência dos timers da
      // página (setTimeout/setInterval) assim que a janela fica invisível —
      // minimizada, escondida na bandeja (ver 'wificord-window-close' mais
      // abaixo) ou noutra área de trabalho virtual. O client do Socket.IO
      // depende desses timers pro ping/pong de keep-alive e pra reconectar;
      // com eles jogados pra ~1x/minuto, a conexão em WebSocket cai (ou fica
      // tempo demais sem responder ao ping do servidor) bem na hora em que
      // "app em segundo plano" é justamente o cenário que as notificações
      // precisam cobrir — daí mensagem nova chegar sem disparar nada. Manter
      // os timers correndo normal mesmo escondida é o que garante o socket
      // (e portanto as notificações) vivo o tempo todo.
      backgroundThrottling: false,
    },
  });

  // Avisa a barra de título própria quando a janela maximiza/restaura, pra
  // ela trocar o ícone do botão do meio (quadrado "maximizar" vira
  // "restaurar" com dois quadrados sobrepostos, igual qualquer app nativo).
  mainWindow.on('maximize', () => mainWindow?.webContents.send('wificord-window-maximized-changed', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('wificord-window-maximized-changed', false));

  mainWindow.loadURL(SERVER_URL);

  if (!ALLOW_DEVTOOLS) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = (input.key || '').toLowerCase();
      const isF12 = key === 'f12';
      const isToggleCombo = (input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key);
      if (isF12 || isToggleCombo) event.preventDefault();
    });
    // Rede de segurança: fecha o DevTools imediatamente se for aberto por
    // qualquer outro caminho (ex.: menu de contexto de alguma extensão).
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  // Abre links externos (ex: convites, imagens em nova aba) no navegador
  // padrão do sistema em vez de dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SERVER_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------
// Aviso de atualização disponível
// ---------------------------------------------------------------------
// O app não empacota o site — ele só exibe o que está publicado no Render.
// Então "atualizar o app" na prática é: descobrir que o servidor subiu uma
// versão nova (cada deploy reinicia o processo lá e gera um bootId novo em
// /api/version) e avisar o usuário com um botão pra recarregar sem cache.
let currentBootId = null;
let updateNotified = false;

// Busca via módulo http(s) nativo do Node, sem depender de `fetch` global
// estar disponível neste processo/versão do Electron (se `fetch` faltar ou
// lançar antes de qualquer await, o catch de fetchBootIdViaFetch engole o
// erro silenciosamente e o sistema de atualização nunca mais avisa nada —
// por isso ter um caminho alternativo que não depende dele).
function fetchBootIdViaHttp() {
  return new Promise((resolve) => {
    let url;
    try { url = new URL('/api/version', SERVER_URL); } catch (_) { return resolve(null); }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.get(url, { headers: { 'Cache-Control': 'no-store' }, timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data && data.bootId ? String(data.bootId) : null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function fetchBootId() {
  if (typeof fetch === 'function') {
    try {
      const res = await fetch(new URL('/api/version', SERVER_URL), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.bootId) return String(data.bootId);
      }
    } catch (_) { /* cai pro fallback abaixo */ }
  }
  return fetchBootIdViaHttp(); // sem internet ou servidor fora do ar: resolve null e tenta de novo depois
}

async function checkForUpdate() {
  const bootId = await fetchBootId();
  if (!bootId) return;
  if (currentBootId === null) {
    currentBootId = bootId; // primeira leitura: define a base, não avisa nada
    return;
  }
  if (bootId !== currentBootId && !updateNotified) {
    updateNotified = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wificord-update-available');
    }
  }
}

ipcMain.on('wificord-apply-update', async () => {
  try { await session.defaultSession.clearCache(); } catch (_) {}
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  updateNotified = false;
  currentBootId = null; // será redefinido no próximo check, já com a versão nova
});

// ---------------------------------------------------------------------
// Auto-update do EXECUTÁVEL em si (diferente do aviso acima!)
// ---------------------------------------------------------------------
// O bloco anterior só recarrega a página quando o SITE muda (client/,
// server/) — não ajuda em nada quando o que mudou foi este main.js, a
// versão do Electron, o ícone, etc. Pra isso, precisa trocar o .exe
// instalado de verdade. É isso que o electron-updater faz aqui: baixa o
// instalador mais novo publicado nas Releases do GitHub (o workflow
// .github/workflows/desktop-release.yml publica um a cada mudança em
// desktop-app/, igual o android-release.yml já faz pro APK) e, quando
// termina de baixar, avisa a janela pra pessoa clicar em "reiniciar" —
// só nesse momento o instalador roda e substitui o .exe antigo.
//
// Só faz sentido rodar isso num app já instalado via instalador (NSIS) —
// `npm start` (electron .) roda "não empacotado" e o autoUpdater nem
// tenta nesse caso, senão ele quebraria/logaria erro toda hora à toa.
if (app.isPackaged) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // só instala quando a pessoa confirmar, nunca escondido
  let appUpdateReady = false;

  autoUpdater.on('update-downloaded', () => {
    appUpdateReady = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wificord-app-update-ready');
    }
  });
  // Silencioso de propósito: falha de rede/GitHub fora do ar aqui não deve
  // incomodar ninguém com um popup — só tenta de novo no próximo ciclo.
  autoUpdater.on('error', (err) => {
    console.error('Erro ao checar atualização do app:', err?.message || err);
  });

  ipcMain.on('wificord-apply-app-update', () => {
    if (!appUpdateReady) return;
    autoUpdater.quitAndInstall();
  });

  function checkForAppUpdate() {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Erro ao checar atualização do app:', err?.message || err);
    });
  }

  // Primeira checagem pouco depois de abrir (dá tempo da janela principal
  // carregar) e depois a cada 1 hora — trocar o executável é bem mais
  // pesado que só recarregar a página, então não precisa ser tão frequente
  // quanto o aviso de conteúdo (5 min).
  setTimeout(checkForAppUpdate, 15 * 1000);
  setInterval(checkForAppUpdate, 60 * 60 * 1000);
}

// ---------------------------------------------------------------------
// Barra de título própria (ver frame:false em createWindow() e
// client/js/titlebar.js) — sem moldura nativa, os botões de minimizar/
// maximizar/fechar viram HTML normal do lado do site, que manda esses 3
// comandos por IPC pro processo principal (só ele pode de fato mexer na
// janela).
// ---------------------------------------------------------------------
ipcMain.on('wificord-window-minimize', () => { mainWindow?.minimize(); });
ipcMain.on('wificord-window-maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
// O "X" da barra de título própria NÃO fecha o app de verdade — só esconde
// a janela, e o processo continua rodando em segundo plano (é o que deixa
// o socket conectado pra notificações de mensagem chegarem mesmo com o
// app "fechado" na visão da pessoa). Só Alt+F4 (fecha a janela de
// verdade, dispara 'window-all-closed' abaixo) ou matar pelo gerenciador
// de tarefas encerram o processo — nenhum dos dois passa por aqui.
let hasShownTrayHint = false;
ipcMain.on('wificord-window-close', () => {
  if (!mainWindow) return;
  mainWindow.hide();
  if (!hasShownTrayHint) {
    hasShownTrayHint = true;
    if (Notification.isSupported()) {
      new Notification({
        title: 'WifiCord continua rodando',
        body: 'O app ficou em segundo plano, na bandeja do sistema — é assim que as notificações de mensagem continuam chegando. Clique no ícone da bandeja pra abrir de novo, ou clique com o botão direito nele pra sair de vez.',
        icon: nativeImage.createFromPath(path.join(__dirname, 'tray-icon-256.png')),
      }).show();
    }
  }
});
ipcMain.handle('wificord-window-is-maximized', () => !!mainWindow?.isMaximized());

// ---------------------------------------------------------------------
// Ícone na bandeja do sistema — é o que dá pra pessoa reabrir a janela
// depois de fechar no "X" (ver handler acima) e sair de vez quando quiser.
// ---------------------------------------------------------------------
function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon-32.png'));
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('WifiCord');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir WifiCord', click: showMainWindow },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.quit(); } },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

// ---------------------------------------------------------------------
// Notificação nativa de mensagem nova (client/js/notifications.js chama
// isso via preload.js quando uma mensagem chega e a pessoa não está
// olhando aquela conversa) — funciona com a janela minimizada, em segundo
// plano ou escondida na bandeja, porque o processo (e o socket dele)
// continua rodando o tempo todo; não depende de nenhum serviço de push.
// ---------------------------------------------------------------------
ipcMain.on('wificord-show-notification', (_event, payload) => {
  if (!Notification.isSupported()) return;
  const title = String(payload?.title || 'WifiCord').slice(0, 200);
  const body = String(payload?.body || '').slice(0, 500);
  const notification = new Notification({
    title,
    body,
    icon: nativeImage.createFromPath(path.join(__dirname, 'tray-icon-256.png')),
  });
  notification.on('click', () => {
    showMainWindow();
    mainWindow?.webContents.send('wificord-notification-clicked', payload?.target || null);
  });
  notification.show();
  // Chama atenção pra janela mesmo se ela estiver minimizada/atrás de
  // outros apps — mesma ideia já usada em 'wificord-incoming-call'.
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    if (process.platform === 'darwin') app.dock?.bounce?.();
    else {
      mainWindow.flashFrame(true);
      mainWindow.once('focus', () => mainWindow?.flashFrame(false));
    }
  }
});

// Ligação chegando: o site (call.js) avisa por aqui assim que mostra a
// telinha de "fulano está te ligando". Se a janela estiver minimizada ou
// atrás de outros apps, ninguém veria essa telinha sem isso — então
// trazemos a janela pra frente e chamamos atenção (pisca a barra de
// tarefas no Windows/Linux, quica o ícone no dock do Mac).
ipcMain.on('wificord-incoming-call', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') {
    app.dock?.bounce?.('critical');
  } else {
    mainWindow.flashFrame(true);
    mainWindow.once('focus', () => mainWindow?.flashFrame(false));
  }
});

// Chamadas de voz/vídeo precisam de permissão de câmera e microfone.
// Sem isso o Electron bloqueia getUserMedia por padrão. 'fullscreen' também
// passa por aqui: o botão de tela cheia da chamada usa a API padrão da web
// (Element.requestFullscreen()), e sem essa permissão liberada o Electron
// REJEITA o pedido silenciosamente (a promise rejeita, cai no catch do
// fullscreen() em call.js, mostrando "Tela cheia não está disponível neste
// navegador") — era por isso que o botão nunca funcionava dentro do app
// desktop, mesmo já funcionando normal num navegador comum (que não passa
// por esse handler).
function allowMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'];
    callback(allowed.includes(permission));
  });
}

// ---------------------------------------------------------------------
// Compartilhamento de tela
// ---------------------------------------------------------------------
// `useSystemPicker: true` pede pro Electron mostrar o seletor NATIVO do
// Windows/macOS (com preview ao vivo de cada tela/janela). Em versões
// compatíveis (Windows 10 build 19041+/Windows 11, macOS 14+) ele aparece
// sozinho e a função handler abaixo nem chega a ser chamada. O PROBLEMA:
// em versões mais antigas do Windows — ou sempre que o suporte nativo falha
// por qualquer motivo — o Electron cai pro handler manual, e esse handler
// simplesmente pegava a PRIMEIRA fonte (`sources[0]`, o monitor principal)
// sem perguntar nada. Por isso nunca dava pra escolher uma janela
// específica: o seletor nativo não estava disponível nesse Windows, e o
// fallback não tinha nenhuma interface de escolha. Agora o fallback abre
// uma janelinha própria (screen-picker.html) com miniaturas de todas as
// telas e janelas disponíveis pra pessoa escolher — funciona em qualquer
// versão do Windows/macOS/Linux, mesmo sem suporte ao seletor nativo.
function allowScreenShare() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    pickScreenSource()
      .then((source) => { callback(source ? { video: source } : {}); })
      .catch(() => callback({}));
  }, { useSystemPicker: true });
}

let pickerWindow = null;

// Abre a janela de seleção de tela/janela e resolve com a fonte escolhida
// (ou null se a pessoa cancelar/fechar a janela). Só uma por vez: se já
// houver uma aberta (ex.: clique duplo no botão de compartilhar), fecha a
// anterior antes de abrir a nova, pra nunca empilhar seletores.
function pickScreenSource() {
  return new Promise((resolve) => {
    if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();

    let settled = false;
    let sourcesCache = [];
    const onChoose = (_e, sourceId) => {
      finish(sourcesCache.find((s) => s.id === sourceId) || null);
    };
    const onCancel = () => finish(null);
    function finish(source) {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('wifi-screen-picker:choose', onChoose);
      ipcMain.removeListener('wifi-screen-picker:cancel', onCancel);
      const win = pickerWindow;
      pickerWindow = null;
      if (win && !win.isDestroyed()) win.close();
      resolve(source);
    }

    ipcMain.on('wifi-screen-picker:choose', onChoose);
    ipcMain.on('wifi-screen-picker:cancel', onCancel);

    // nodeIntegration/contextIsolation liberados só porque esta janela
    // carrega EXCLUSIVAMENTE o arquivo local screen-picker.html (nunca
    // conteúdo remoto/de terceiros) — não é o mesmo risco de liberar isso
    // pra janela principal, que exibe o site hospedado.
    pickerWindow = new BrowserWindow({
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'Escolher tela ou janela — WifiCord',
      backgroundColor: '#0d0a18',
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    pickerWindow.setMenuBarVisibility(false);
    pickerWindow.on('closed', () => { pickerWindow = null; finish(null); });

    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true })
      .then((sources) => {
        sourcesCache = sources;
        if (!pickerWindow || pickerWindow.isDestroyed()) return;
        const payload = sources.map((s) => ({
          id: s.id,
          name: s.name || (s.id.startsWith('screen') ? 'Tela' : 'Janela'),
          thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
          isScreen: s.id.startsWith('screen'),
        }));
        pickerWindow.loadFile(path.join(__dirname, 'screen-picker.html'));
        pickerWindow.webContents.once('did-finish-load', () => {
          pickerWindow?.webContents.send('wifi-screen-picker:sources', payload);
        });
      })
      .catch(() => finish(null));
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  allowMediaPermissions();
  allowScreenShare();
  // Como este app só exibe o site hospedado (igual um navegador dedicado),
  // ele guarda cache HTTP dos arquivos (Cache-Control: max-age=1d no
  // servidor). Sem isso, o app pode continuar mostrando uma versão antiga
  // do site por até 1 dia depois de cada atualização. Limpar o cache a
  // cada abertura garante que o app sempre carregue a versão mais nova.
  await session.defaultSession.clearCache();
  createWindow();
  createTray();

  // Primeira checagem logo na abertura (só define a versão atual como
  // base) e depois a cada 5 minutos, silenciosamente em segundo plano.
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// Só dispara quando a janela fecha de VERDADE (Alt+F4, ou o processo é
// encerrado outra hora) — fechar pelo "X" da barra própria só esconde a
// janela (ver 'wificord-window-close' acima) e nunca chega a emitir
// 'closed', então nunca cai aqui.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
