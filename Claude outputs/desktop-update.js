// client/js/desktop-update.js
// Só faz alguma coisa dentro do app desktop (window.wificordDesktop só
// existe lá, exposto pelo preload.js do Electron). Em navegador normal
// este arquivo não faz nada — o site já se atualiza sozinho a cada reload.
(function () {
  'use strict';
  if (!window.wificordDesktop || typeof window.wificordDesktop.onUpdateAvailable !== 'function') return;

  function showBanner() {
    if (document.getElementById('desktop-update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'desktop-update-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span>✨ Uma nova versão do WifiCord está disponível.</span>' +
      '<button type="button" id="desktop-update-btn">Reiniciar e atualizar</button>';
    document.body.appendChild(bar);
    document.getElementById('desktop-update-btn').addEventListener('click', function () {
      this.disabled = true;
      this.textContent = 'Atualizando…';
      window.wificordDesktop.restartApp();
    });
  }

  window.wificordDesktop.onUpdateAvailable(showBanner);
})();
