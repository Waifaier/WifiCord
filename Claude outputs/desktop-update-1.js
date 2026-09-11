// client/js/desktop-update.js
// Avisa quando existe uma versão mais nova publicada e ela ainda não foi
// carregada nesta aba/janela — dentro do app desktop (Electron, via
// window.wificordDesktop) E também numa aba de navegador normal.
//
// Por que isso importa pro navegador também: o fix de cache (ver
// server.js) garante que um CARREGAMENTO NOVO da página sempre pega a
// versão certa, mas uma aba que já estava aberta ANTES de um deploy
// continua rodando o JS antigo pra sempre até alguém dar F5 — nada força
// isso sozinho. Foi exatamente esse cenário que causou "na aba anônima
// funciona, na aba normal a chamada some e dá erro": a aba normal, aberta
// antes da correção, continuava com o call.js antigo em memória
// conversando (mal) com a aba nova. Por isso agora toda aba fica de olho
// no /api/version e avisa pra recarregar assim que percebe que ficou
// desatualizada — sem precisar que a pessoa descubra isso sozinha.
(function () {
  'use strict';

  const isDesktop = !!(window.wificordDesktop && typeof window.wificordDesktop.onUpdateAvailable === 'function');

  function showBanner(onClick, label) {
    if (document.getElementById('desktop-update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'desktop-update-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span>✨ Uma nova versão do WifiCord está disponível.</span>' +
      '<button type="button" id="desktop-update-btn">' + label + '</button>';
    document.body.appendChild(bar);
    document.getElementById('desktop-update-btn').addEventListener('click', function () {
      this.disabled = true;
      this.textContent = 'Atualizando…';
      onClick();
    });
  }

  if (isDesktop) {
    // App Electron: o main.js já faz o polling e avisa por IPC; o botão
    // limpa o cache do processo e recarrega (isso atualiza o SITE dentro
    // do app, não o executável em si).
    window.wificordDesktop.onUpdateAvailable(function () {
      showBanner(function () { window.wificordDesktop.restartApp(); }, 'Reiniciar e atualizar');
    });
    // Atualização do EXECUTÁVEL — o electron-updater já baixou um instalador
    // mais novo em segundo plano; só falta reiniciar pra ele ser aplicado.
    // Tem prioridade visual (mensagem diferente) porque é mais "definitivo"
    // que o reload de conteúdo acima.
    if (typeof window.wificordDesktop.onAppUpdateReady === 'function') {
      window.wificordDesktop.onAppUpdateReady(function () {
        const existing = document.getElementById('desktop-update-banner');
        if (existing) existing.remove();
        showBanner(function () { window.wificordDesktop.installAppUpdate(); }, 'Reiniciar e instalar');
      });
    }
    return;
  }

  // Aba de navegador normal: faz o próprio polling do /api/version.
  let baseBootId = null;
  let stopped = false;

  async function fetchBootId() {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.bootId ? String(data.bootId) : null;
    } catch (_) {
      return null; // sem internet: tenta de novo no próximo ciclo
    }
  }

  async function check() {
    if (stopped) return;
    const bootId = await fetchBootId();
    if (!bootId) return;
    if (baseBootId === null) { baseBootId = bootId; return; } // primeira leitura: só define a base
    if (bootId !== baseBootId) {
      stopped = true; // já avisou, não precisa mais checar
      showBanner(function () { location.reload(); }, 'Recarregar');
    }
  }

  check();
  const timer = setInterval(check, 5 * 60 * 1000);
  // Além do polling periódico, checa também quando a aba volta a ficar
  // visível/em foco — cobre o caso comum de deixar a aba minimizada/atrás
  // de outras por um tempo e só voltar a usar bem depois.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('beforeunload', () => { clearInterval(timer); });
})();
