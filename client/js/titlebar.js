// client/js/titlebar.js
// Barra de título própria — só existe DENTRO do app desktop (Electron abre
// a janela sem moldura nativa, frame:false, ver createWindow() em main.js),
// pra sair daquela barra vermelha padrão do Windows com "WifiCord" e trocar
// por algo escuro e discreto, no mesmo estilo do resto do app (mais perto
// do app oficial do Discord). Numa aba de navegador normal
// window.wificordDesktop não existe (só é injetado pelo preload.js dentro
// do Electron), então esse script simplesmente não faz nada — o navegador
// continua usando a própria barra dele, como sempre.
(function () {
  'use strict';

  const api = window.wificordDesktop && window.wificordDesktop.titlebar;
  if (!api) return;

  const bar = document.createElement('div');
  bar.id = 'wc-titlebar';
  bar.innerHTML =
    '<div class="wc-titlebar-drag">' +
      '<img class="wc-titlebar-logo" src="/assets/logo.svg" alt="">' +
      '<span class="wc-titlebar-name">WifiCord</span>' +
    '</div>' +
    '<div class="wc-titlebar-controls">' +
      '<button type="button" class="wc-titlebar-btn" id="wc-titlebar-min" title="Minimizar" aria-label="Minimizar">' +
        '<svg viewBox="0 0 10 10" aria-hidden="true"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>' +
      '</button>' +
      '<button type="button" class="wc-titlebar-btn" id="wc-titlebar-max" title="Maximizar" aria-label="Maximizar">' +
        '<svg viewBox="0 0 10 10" aria-hidden="true">' +
          '<rect class="wc-ico-restore-back" x="3" y="1" width="6" height="6" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/>' +
          '<rect class="wc-ico-sq" x="1" y="3" width="6" height="6" rx=".5" fill="var(--bg-deepest,#05060C)" stroke="currentColor" stroke-width="1"/>' +
        '</svg>' +
      '</button>' +
      '<button type="button" class="wc-titlebar-btn wc-titlebar-btn-close" id="wc-titlebar-close" title="Fechar" aria-label="Fechar">' +
        '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>' +
      '</button>' +
    '</div>';

  document.documentElement.classList.add('has-custom-titlebar');
  document.body.insertBefore(bar, document.body.firstChild);

  const maxBtn = bar.querySelector('#wc-titlebar-max');
  bar.querySelector('#wc-titlebar-min').addEventListener('click', () => api.minimize());
  maxBtn.addEventListener('click', () => api.toggleMaximize());
  bar.querySelector('#wc-titlebar-close').addEventListener('click', () => api.close());
  // Clique duplo na área de arrastar também maximiza/restaura — igual
  // qualquer barra de título nativa (Windows já faz isso sozinho na região
  // marcada como -webkit-app-region:drag, mas o próprio duplo-clique no
  // botão do meio faz sentido continuar funcionando também).
  bar.querySelector('.wc-titlebar-drag').addEventListener('dblclick', () => api.toggleMaximize());

  function setMaximized(isMaximized) {
    maxBtn.classList.toggle('is-maximized', !!isMaximized);
    const label = isMaximized ? 'Restaurar' : 'Maximizar';
    maxBtn.title = label;
    maxBtn.setAttribute('aria-label', label);
  }
  if (typeof api.isMaximized === 'function') {
    api.isMaximized().then(setMaximized).catch(() => {});
  }
  if (typeof api.onMaximizedChange === 'function') {
    api.onMaximizedChange(setMaximized);
  }
})();
