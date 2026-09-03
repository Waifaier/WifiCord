// Substitui emojis dos controles principais por ícones SVG (estilo outline, tipo Discord).
// Mantém title/aria-label originais, só troca o conteúdo interno do elemento.
(function () {
  function svg(paths, extra) {
    return '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths + (extra || '') + '</svg>';
  }

  const ICONS = {
    home: svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1v-9"/>'),
    link: svg('<path d="M9 15l6-6"/><path d="M8.5 8.5 11 6a3.5 3.5 0 0 1 5 5l-1.2 1.2"/><path d="M15.5 15.5 13 18a3.5 3.5 0 0 1-5-5l1.2-1.2"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
    shield: svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>'),
    store: svg('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    games: svg('<rect x="2" y="8" width="20" height="10" rx="4"/><path d="M7 11v4M5 13h4"/><path d="M16 12h.01M18.5 14h.01"/>'),
    logout: svg('<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 8l4 4-4 4M19 12H9"/>'),
    phone: svg('<path d="M5 4h3l2 5-2 1a11 11 0 0 0 6 6l1-2 5 2v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
    'phone-off': svg('<path d="M5 4h3l2 5-1.5.9"/><path d="M9.8 15.2A11 11 0 0 0 15 19l1-2 5 2v3a1 1 0 0 1-1 1 15.9 15.9 0 0 1-7.3-2.2"/><path d="M4 4l16 16"/>'),
    video: svg('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>'),
    camera: svg('<path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.3"/>'),
    mic: svg('<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M9 21h6"/>'),
    monitor: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    headphones: svg('<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2" y="13" width="5" height="7" rx="2"/><rect x="17" y="13" width="5" height="7" rx="2"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="M21 16l-5-5-4 4-2-2-4 4"/>'),
    smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01"/><path d="M8 14.5a5 5 0 0 0 8 0"/>'),
    maximize: svg('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
    pin: svg('<path d="M9 4h6l1 6 3 3v2H5v-2l3-3z"/><path d="M12 15v6"/>'),
    trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>'),
  };

  function setIcon(id, name) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = ICONS[name];
  }

  function applyStaticIcons() {
    setIcon('home-btn', 'home');
    setIcon('join-server-btn', 'link');
    setIcon('admin-btn', 'shield');
    setIcon('store-btn', 'store');
    setIcon('games-btn', 'games');
    setIcon('settings-btn', 'settings');
    setIcon('logout-btn', 'logout');
    setIcon('start-voice-call-btn', 'phone');
    setIcon('start-video-call-btn', 'video');
    setIcon('media-btn', 'image');
    setIcon('emoji-btn', 'smile');
    setIcon('call-toggle-mic', 'mic');
    setIcon('call-toggle-cam', 'camera');
    setIcon('call-toggle-screen', 'monitor');
    setIcon('call-fullscreen', 'maximize');
    setIcon('call-hangup', 'phone-off');
    setIcon('mini-call-mic', 'mic');
    setIcon('mini-call-cam', 'camera');
    setIcon('mini-call-screen', 'monitor');
    setIcon('mini-call-headphones', 'headphones');
    setIcon('mini-call-hangup', 'phone-off');
    setIcon('incoming-call-accept', 'phone');
    setIcon('incoming-call-reject', 'phone-off');

    const miniStatus = document.querySelector('.mini-call-status');
    if (miniStatus) miniStatus.innerHTML = ICONS.phone + ' Em chamada';

    const stageEmpty = document.querySelector('.call-stage-empty');
    if (stageEmpty) stageEmpty.innerHTML = ICONS.phone;
  }

  document.addEventListener('DOMContentLoaded', applyStaticIcons);
  window.WCIcons = ICONS;
})();
