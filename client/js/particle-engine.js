// ---------------------------------------------------------------------
// Motor de partículas compartilhado — UM único requestAnimationFrame pra
// todos os canvases registrados (nunca um loop por elemento), com
// IntersectionObserver pra pausar quem está fora da tela. Existe
// especificamente pra camada de atmosfera do PERFIL GRANDE
// (#profile-effect-layer): era a única parte do sistema de cosméticos
// que ainda simulava "partículas" com um truque de box-shadow (várias
// sombras estáticas se movendo juntas) — bonito o bastante em CSS pra
// avatar pequeno, mas no cartão de perfil inteiro dá pra fazer partículas
// de verdade (profundidade, velocidades e tamanhos variados) sem o custo
// de N loops independentes, porque é só ESSE contexto (um por vez, o
// perfil que está aberto) que usa canvas — em chat/listas/chamadas a
// aura/efeito continuam 100% CSS (ver identity.js e style.css), que é a
// ferramenta certa pra dezenas de avatares pequenos ao mesmo tempo.
(function () {
  'use strict';

  const registry = new Map(); // canvas -> { ctx, particles, recipe, w, h, paused }
  let rafId = null;
  let lastT = 0;

  function ensureLoop() {
    if (rafId) return;
    lastT = performance.now();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      let any = false;
      for (const entry of registry.values()) {
        if (entry.paused) continue;
        any = true;
        step(entry, dt);
      }
      rafId = any ? requestAnimationFrame(tick) : null;
    };
    rafId = requestAnimationFrame(tick);
  }

  function step(entry, dt) {
    const { ctx, particles, w, h, recipe } = entry;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        recipe.respawn(p, w, h);
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife)) * (recipe.baseAlpha || 1);
      ctx.fillStyle = p.color || recipe.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // recipe: { count, color, baseAlpha, respawn(p,w,h) }
  const RECIPES = {
    float: {
      color: '#a88bff', baseAlpha: 0.8,
      respawn(p, w, h) { p.x = Math.random() * w; p.y = h + 10; p.vx = (Math.random() - 0.5) * 8; p.vy = -(10 + Math.random() * 14); p.r = 1.5 + Math.random() * 2; p.life = p.maxLife = 4 + Math.random() * 3; },
    },
    particles: {
      color: '#b7a8ff', baseAlpha: 0.9,
      respawn(p, w, h) { p.x = Math.random() * w; p.y = h * (0.6 + Math.random() * 0.4); p.vx = (Math.random() - 0.5) * 4; p.vy = -(30 + Math.random() * 40); p.r = 1 + Math.random() * 1.6; p.life = p.maxLife = 2 + Math.random() * 1.5; },
    },
    snow: {
      color: '#eafcff', baseAlpha: 0.85,
      respawn(p, w, h) { p.x = Math.random() * w; p.y = -10; p.vx = (Math.random() - 0.5) * 10; p.vy = 20 + Math.random() * 25; p.r = 1.5 + Math.random() * 2.2; p.life = p.maxLife = 5 + Math.random() * 3; },
    },
    confete: {
      color: null, baseAlpha: 0.95,
      colors: ['#ff5c7a', '#ffd75c', '#5cffb0', '#5cd8ff', '#a95cff'],
      respawn(p, w, h) { p.x = Math.random() * w; p.y = -10; p.vx = (Math.random() - 0.5) * 30; p.vy = 40 + Math.random() * 40; p.r = 2 + Math.random() * 2; p.color = this.colors[(Math.random() * this.colors.length) | 0]; p.life = p.maxLife = 2.2 + Math.random() * 1.4; },
    },
    bolhas: {
      color: '#8ff2ff', baseAlpha: 0.6,
      respawn(p, w, h) { p.x = Math.random() * w; p.y = h + 10; p.vx = (Math.random() - 0.5) * 6; p.vy = -(18 + Math.random() * 20); p.r = 1.5 + Math.random() * 3; p.life = p.maxLife = 3 + Math.random() * 2.5; },
    },
    nebulosa: {
      color: null, baseAlpha: 0.5,
      colors: ['#6c4cff', '#ff6ca0', '#4c9bff', '#fff'],
      respawn(p, w, h) { p.x = Math.random() * w; p.y = Math.random() * h; p.vx = (Math.random() - 0.5) * 5; p.vy = (Math.random() - 0.5) * 5; p.r = 0.8 + Math.random() * 1.4; p.color = this.colors[(Math.random() * this.colors.length) | 0]; p.life = p.maxLife = 4 + Math.random() * 4; },
    },
  };

  function perfCount(base) {
    const tier = document.documentElement.dataset.cq || 'auto';
    if (tier === 'off') return 0;
    if (tier === 'low') return Math.round(base * 0.35);
    if (tier === 'medium') return Math.round(base * 0.65);
    return base; // auto/high
  }

  // Liga um canvas a uma receita nomeada (uma das chaves de RECIPES).
  // `baseCount` é o número de partículas em qualidade alta; escala pra
  // baixo sozinho conforme o nível de performance (settings.cosmeticsQuality,
  // ver identity.js) — nunca sobe além do pedido.
  function attach(canvas, recipeName, baseCount = 24) {
    const recipe = RECIPES[recipeName];
    if (!recipe || !canvas) return null;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      entry.w = rect.width; entry.h = rect.height;
    };
    const count = perfCount(baseCount);
    const particles = Array.from({ length: count }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 1, life: 0, maxLife: 1 }));
    const entry = { ctx, particles, recipe, w: canvas.clientWidth || 200, h: canvas.clientHeight || 200, paused: false };
    resize();
    particles.forEach((p) => { p.life = 0; recipe.respawn(p, entry.w, entry.h); p.life = Math.random() * p.maxLife; });
    registry.set(canvas, entry);
    ensureLoop();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) entry.paused = !e.isIntersecting;
        if (!entry.paused) ensureLoop();
      }, { threshold: 0.01 });
      io.observe(canvas);
    }
    return {
      detach() {
        registry.delete(canvas);
        ro.disconnect();
        io?.disconnect();
      },
    };
  }

  window.WCParticles = { attach, recipes: Object.keys(RECIPES) };
})();
