// desktop-app/preload.js
// Ponte segura entre o site (renderer) e o processo principal do Electron.
// Expõe só o mínimo necessário: o banner de atualização (main.js) avisa o
// site quando detecta uma versão nova no servidor, e o site pede pra
// reiniciar/aplicar quando o usuário clica no botão.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wificordDesktop', {
  onUpdateAvailable(callback) {
    ipcRenderer.on('wificord-update-available', () => {
      try { callback(); } catch (_) {}
    });
  },
  restartApp() {
    ipcRenderer.send('wificord-apply-update');
  },
  // Atualização do EXECUTÁVEL (novo instalador já baixado em segundo
  // plano pelo electron-updater) — diferente do reload de conteúdo acima.
  onAppUpdateReady(callback) {
    ipcRenderer.on('wificord-app-update-ready', () => {
      try { callback(); } catch (_) {}
    });
  },
  installAppUpdate() {
    ipcRenderer.send('wificord-apply-app-update');
  },
  // Controles da barra de título própria (ver frame:false em main.js) — o
  // site não tem acesso nenhum a Node/Electron diretamente (contextIsolation
  // ligado), só a essas 4 funções bem específicas.
  // Avisa o processo principal que uma ligação chegou, pra ele trazer a
  // janela pra frente mesmo se estiver minimizada/em segundo plano.
  notifyIncomingCall() {
    ipcRenderer.send('wificord-incoming-call');
  },
  titlebar: {
    minimize() { ipcRenderer.send('wificord-window-minimize'); },
    toggleMaximize() { ipcRenderer.send('wificord-window-maximize-toggle'); },
    close() { ipcRenderer.send('wificord-window-close'); },
    isMaximized() { return ipcRenderer.invoke('wificord-window-is-maximized'); },
    onMaximizedChange(callback) {
      ipcRenderer.on('wificord-window-maximized-changed', (_e, isMaximized) => {
        try { callback(isMaximized); } catch (_) {}
      });
    },
  },
});
