// Entrada: teclado (WASD etc.) e controles touch (joystick virtual + botões).
export class Input {
  constructor() {
    this.keys = new Set();
    this.joy = { x: 0, y: 0, active: false };
    this.touchSprint = false;
    this.touchSneak = false;
    this.handlers = {};
    this.enabled = false;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.emit('pttUp'); this.emit('spaceUp'); });
  }

  on(action, fn) { this.handlers[action] = fn; }
  emit(action, arg) { this.handlers[action]?.(arg); }

  onKey(e, down) {
    if (!this.enabled) return;
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (typing) {
      if (down && k === 'Escape') this.emit('chatClose');
      return;
    }
    if (down) {
      if (k === 'Tab') { e.preventDefault(); if (!e.repeat) this.emit('inv'); return; }
      if (k === ' ') { e.preventDefault(); if (!e.repeat) { this.keys.add(k); this.emit('spaceDown'); } return; }
      if (e.repeat) { if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault(); return; }
      switch (k) {
        case 'e': this.emit('interact'); break;
        case 'f': this.emit('flash'); break;
        case 'c': this.emit('cams'); break;
        case 'm': this.emit('map'); break;
        case 'Escape': this.emit('menu'); break;
        case 'Enter': e.preventDefault(); this.emit('chat'); break;
        case 'v': this.emit('pttDown'); break;
        case '1': case '2': case '3': case '4': case '5': this.emit('hotbar', Number(k) - 1); break;
        case 'q': this.emit('camPrev'); break;
        case 'r': this.emit('camNext'); break;
        case 'j': this.emit('checklist'); break;
      }
      if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
      this.keys.add(k);
    } else {
      this.keys.delete(k);
      if (k === 'v') this.emit('pttUp');
      if (k === ' ') this.emit('spaceUp');
    }
  }

  vector() {
    let x = 0, y = 0;
    const K = this.keys;
    if (K.has('w') || K.has('ArrowUp')) y -= 1;
    if (K.has('s') || K.has('ArrowDown')) y += 1;
    if (K.has('a') || K.has('ArrowLeft')) x -= 1;
    if (K.has('d') || K.has('ArrowRight')) x += 1;
    if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const sprint = K.has('Shift') || this.touchSprint || (this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.97 && this.joyRun);
    const sneak = K.has(' ') || this.touchSneak;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, sprint: !!sprint && !sneak, sneak };
  }

  clear() { this.keys.clear(); this.joy = { x: 0, y: 0, active: false }; this.touchSprint = false; this.touchSneak = false; }

  setupTouch(root) {
    const joy = root.querySelector('#joy');
    const knob = root.querySelector('#joy-knob');
    let id = null;
    const move = (tx, ty) => {
      const r = joy.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (tx - cx) / (r.width / 2), dy = (ty - cy) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.joy = { x: Math.abs(dx) < 0.15 ? 0 : dx, y: Math.abs(dy) < 0.15 ? 0 : dy, active: true };
      knob.style.transform = `translate(${dx * r.width * 0.32}px, ${dy * r.height * 0.32}px)`;
    };
    joy.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; id = t.identifier; move(t.clientX, t.clientY); }, { passive: false });
    joy.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === id) move(t.clientX, t.clientY); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; this.joy = { x: 0, y: 0, active: false }; knob.style.transform = ''; } };
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);

    for (const b of root.querySelectorAll('.tbtn')) {
      const act = b.dataset.t;
      if (act === 'sneak') {
        b.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchSneak = true; b.classList.add('held'); this.emit('spaceDown'); }, { passive: false });
        const up = (e) => { e.preventDefault(); this.touchSneak = false; b.classList.remove('held'); this.emit('spaceUp'); };
        b.addEventListener('touchend', up, { passive: false });
        b.addEventListener('touchcancel', up, { passive: false });
      } else if (act === 'sprint') {
        b.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchSprint = true; b.classList.add('held'); }, { passive: false });
        const up = (e) => { e.preventDefault(); this.touchSprint = false; b.classList.remove('held'); };
        b.addEventListener('touchend', up, { passive: false });
        b.addEventListener('touchcancel', up, { passive: false });
      } else {
        b.addEventListener('touchstart', (e) => { e.preventDefault(); b.classList.add('held'); this.emit(act); }, { passive: false });
        b.addEventListener('touchend', () => b.classList.remove('held'));
        b.addEventListener('click', (e) => { if (e.pointerType !== 'touch' && e.detail !== 0) this.emit(act); });
      }
    }
  }
}
