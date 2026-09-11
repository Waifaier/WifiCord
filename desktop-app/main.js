// desktop-app/main.js
// App de desktop do WifiCord: uma janela do Electron carregando o servidor
// já hospedado (igual o app oficial do Discord faz com o site deles).
'use strict';

const { app, BrowserWindow, session, Menu, shell, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { autoUpdater } = require('electron-updater');

// URL do seu servidor hospedado. Pode trocar via variável de ambiente
// WIFICORD_URL sem precisar mexer no código (útil pra testar local x produção).
const SERVER_URL = process.env.WIFICORD_URL || 'https://wificord.onrender.com';

let mainWindow = null;

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
ipcMain.on('wificord-window-close', () => { mainWindow?.close(); });
ipcMain.handle('wificord-window-is-maximized', () => !!mainWindow?.isMaximized());

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

  // Primeira checagem logo na abertura (só define a versão atual como
  // base) e depois a cada 5 minutos, silenciosamente em segundo plano.
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
