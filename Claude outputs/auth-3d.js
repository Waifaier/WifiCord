// Órbita 3D discreta atrás da tela de entrada (login/registro).
// Requisitos que este arquivo respeita de propósito:
// - Nunca quebra a tela de login se o WebGL ou o Three.js não estiverem
//   disponíveis: nesse caso simplesmente não desenha nada (o CSS já cobre
//   o fundo com um degradê estático).
// - Para de renderizar assim que a tela de entrada sai de vista (depois do
//   login) e quando a aba não está visível, para não gastar GPU/bateria à
//   toa em segundo plano.
// - Respeita "prefers-reduced-motion": desenha um quadro único parado, sem
//   loop de animação.
(function () {
  function start() {
    var canvas = document.getElementById('auth-orbit');
    var authScreen = document.getElementById('auth-screen');
    if (!canvas || !authScreen || typeof THREE === 'undefined') return;

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (_) {
      return; // sem WebGL: fica só o degradê CSS, sem erro nenhum no console
    }

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 6.2);

    // Detalhe 0 (icosaedro simples, 20 faces) em vez de 1 (80 faces):
    // menos linhas cruzando a tela, leitura mais limpa como acento, não
    // como uma "teia" cobrindo o painel inteiro.
    var group = new THREE.Group();
    var geometry = new THREE.IcosahedronGeometry(2.3, 0);

    var wireframe = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.38 })
    );
    group.add(wireframe);

    var vertexCount = geometry.attributes.position.count;
    var points = [];
    for (var i = 0; i < vertexCount; i++) {
      points.push(new THREE.Vector3(
        geometry.attributes.position.getX(i),
        geometry.attributes.position.getY(i),
        geometry.attributes.position.getZ(i)
      ));
    }
    var dots = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.PointsMaterial({ color: 0x22d3ee, size: 0.06, transparent: true, opacity: 0.6 })
    );
    group.add(dots);

    scene.add(group);
    var light = new THREE.PointLight(0x7c5cff, 1.2);
    light.position.set(3, 2, 4);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x22d3ee, 0.3));

    function resize() {
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    var resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    var frameId = null;

    function isVisible() {
      return !authScreen.classList.contains('hidden') && !document.hidden && canvas.clientWidth > 0;
    }

    // Arrasta pra girar: clica/toca e arrasta em cima da forma pra girar
    // ela na mão. Ao soltar, continua girando por inércia e vai
    // desacelerando, até a rotação automática de ambiente assumir de novo
    // sozinha por cima.
    var dragging = false;
    var lastX = 0, lastY = 0;
    var dragOffsetY = 0, dragOffsetX = 0;
    var velocityY = 0, velocityX = 0;

    function pointFromEvent(e) {
      var p = (e.touches && e.touches[0]) || e;
      return { x: p.clientX, y: p.clientY };
    }

    function onDragStart(e) {
      if (!isVisible()) return;
      dragging = true;
      velocityY = 0; velocityX = 0;
      var p = pointFromEvent(e);
      lastX = p.x; lastY = p.y;
      canvas.style.cursor = 'grabbing';
      if (reduceMotion) maybeStart();
    }
    function onDragMove(e) {
      if (!dragging) return;
      var p = pointFromEvent(e);
      var dx = p.x - lastX, dy = p.y - lastY;
      lastX = p.x; lastY = p.y;
      var rotY = dx * 0.008, rotX = dy * 0.008;
      dragOffsetY += rotY;
      dragOffsetX = Math.max(-1.1, Math.min(1.1, dragOffsetX + rotX));
      velocityY = rotY; velocityX = rotX;
      if (e.cancelable) e.preventDefault();
      if (reduceMotion) renderer.render(scene, camera);
    }
    function onDragEnd() {
      dragging = false;
      canvas.style.cursor = 'grab';
    }

    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onDragStart);
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);

    function renderFrame(t) {
      if (!isVisible()) { frameId = null; return; }
      if (!dragging && (Math.abs(velocityY) > 0.00005 || Math.abs(velocityX) > 0.00005)) {
        dragOffsetY += velocityY;
        dragOffsetX = Math.max(-1.1, Math.min(1.1, dragOffsetX + velocityX));
        velocityY *= 0.94;
        velocityX *= 0.94;
      }
      group.rotation.y = t * 0.00018 + dragOffsetY;
      group.rotation.x = Math.sin(t * 0.00012) * 0.25 + dragOffsetX;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderFrame);
    }

    function maybeStart() {
      if (reduceMotion) {
        if (isVisible()) {
          resize();
          group.rotation.y = dragOffsetY;
          group.rotation.x = dragOffsetX;
          renderer.render(scene, camera);
        }
        return;
      }
      if (isVisible() && frameId === null) frameId = requestAnimationFrame(renderFrame);
    }

    // A tela de entrada troca a classe "hidden" via JS de app.js/auth.js
    // depois do login — observamos isso para pausar o loop sem precisar
    // mexer nesses outros arquivos.
    var classObserver = new MutationObserver(maybeStart);
    classObserver.observe(authScreen, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', maybeStart);

    maybeStart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
