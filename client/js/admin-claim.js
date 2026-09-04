// Ativação do primeiro administrador — nome honesto, sem código embutido
// aqui no cliente. O código real só existe no servidor (ADMIN_CLAIM_CODE).
// Este arquivo só chama a API e mostra/esconde a seção conforme a resposta.
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  async function checkAvailability() {
    const section = $('admin-claim-section');
    if (!section) return;
    try {
      const r = await fetch('/api/auth/admin-claim-available', { credentials: 'same-origin' });
      if (!r.ok) { section.classList.add('hidden'); return; }
      const data = await r.json();
      section.classList.toggle('hidden', !data?.available);
    } catch (_) {
      section.classList.add('hidden');
    }
  }

  async function submit() {
    const input = $('admin-claim-code');
    const status = $('admin-claim-status');
    const btn = $('admin-claim-submit');
    const code = (input?.value || '').trim();
    if (!code) { if (status) { status.textContent = 'Informe o código.'; status.classList.add('error'); } return; }

    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Verificando…'; status.classList.remove('error'); }

    try {
      const r = await fetch('/api/auth/claim-admin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (status) { status.textContent = data?.error || 'Não foi possível ativar.'; status.classList.add('error'); }
        return;
      }
      if (status) { status.textContent = 'Administrador ativado! Recarregando…'; status.classList.remove('error'); }
      if (input) input.value = '';
      setTimeout(() => window.location.reload(), 900);
    } catch (_) {
      if (status) { status.textContent = 'Erro de conexão. Tente novamente.'; status.classList.add('error'); }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    checkAvailability();
    // Reavalia toda vez que as configurações são abertas: cobre o caso de
    // login ter acontecido depois do carregamento inicial da página (SPA).
    document.getElementById('settings-btn')?.addEventListener('click', checkAvailability);
    const btn = $('admin-claim-submit');
    if (btn) btn.addEventListener('click', submit);
    const input = $('admin-claim-code');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  });
})();
