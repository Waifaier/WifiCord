// client/js/announcements.js
// Pop-up de "Aviso da Equipe": quando um admin manda um aviso pelo painel
// (aba Avisos, ver features.js), aparece na tela de todo mundo. Dois
// caminhos alimentam a mesma função handleIncoming(): o evento de socket
// 'admin:announcement' (pra quem já está com o site aberto na hora do
// envio) e a busca em /api/announcements/current logo depois de conectar
// (pra quem abre o site DEPOIS que o aviso já foi enviado). Em ambos os
// casos, só mostra de novo se a pessoa ainda não tiver marcado ESSE aviso
// específico como lido (guardado por id no localStorage, por navegador).
(function () {
  'use strict';

  const DISMISSED_KEY = 'wificord-announcement-dismissed-id';
  let current = null;

  function getDismissedId() {
    try { return localStorage.getItem(DISMISSED_KEY); } catch (_) { return null; }
  }
  function setDismissedId(id) {
    try { localStorage.setItem(DISMISSED_KEY, String(id)); } catch (_) {}
  }

  function show(announcement) {
    if (!announcement) return;
    const overlay = document.getElementById('announcement-overlay');
    const title = document.getElementById('announcement-title');
    const message = document.getElementById('announcement-message');
    if (!overlay || !title || !message) return;
    current = announcement;
    title.textContent = announcement.title || '';
    message.textContent = announcement.message || '';
    overlay.classList.remove('hidden');
  }

  function dismiss() {
    document.getElementById('announcement-overlay')?.classList.add('hidden');
    // Aviso de pré-visualização (id 'preview', usado só pelo botão
    // "Pré-visualizar" no painel admin) nunca é marcado como lido de
    // verdade — senão um aviso de teste podia "esconder" o aviso real.
    if (current && current.id !== 'preview') setDismissedId(current.id);
    current = null;
  }

  function handleIncoming(announcement) {
    if (!announcement) return;
    if (String(getDismissedId()) === String(announcement.id)) return; // essa pessoa já leu esse aviso
    show(announcement);
  }

  async function checkCurrent() {
    try {
      const res = await fetch('/api/announcements/current', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      handleIncoming(data && data.announcement);
    } catch (_) { /* sem internet/sessão nesse instante — tenta de novo na próxima reconexão */ }
  }

  document.getElementById('announcement-close')?.addEventListener('click', dismiss);
  document.getElementById('announcement-ok')?.addEventListener('click', dismiss);

  window.WCAnnouncements = { handleIncoming, checkCurrent, preview: show };
})();
