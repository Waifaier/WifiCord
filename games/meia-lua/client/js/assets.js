// Carregamento dos sprites em pixel art (client/assets/sprites). Se falhar, o jogo usa a arte procedural.
export const assets = { ready: false, manifest: null, img: {} };

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

export async function loadAssets() {
  try {
    const res = await fetch('assets/sprites/sprites.json');
    const m = await res.json();
    assets.manifest = m;
    const jobs = [];
    const add = (key, src) => jobs.push(loadImage(`assets/sprites/${src}`).then((im) => { if (im) assets.img[key] = im; }));
    for (const [k, v] of Object.entries(m.anims)) add(`anim_${k}`, v.src);
    for (const [k, v] of Object.entries(m.faces)) add(`face_${k}`, v.src);
    add('players', m.players.src);
    add('props', m.props.src);
    add('tiles', m.tiles.src);
    await Promise.all(jobs);
    assets.ready = !!(assets.img.players && assets.img.props && assets.img.tiles);
  } catch (err) {
    console.warn('[assets] usando arte procedural:', err);
  }
  return assets;
}

/** Desenha um quadro de uma folha de sprites. */
export function drawFrame(ctx, img, fw, fh, col, row, dx, dy, dw, dh, flip = false) {
  if (!img) return false;
  if (flip) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, col * fw, row * fh, fw, fh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, col * fw, row * fh, fw, fh, dx, dy, dw, dh);
  }
  return true;
}

export function propIndex(name) {
  const names = assets.manifest?.props?.names;
  return names ? names.indexOf(name) : -1;
}

export function drawProp32(ctx, name, dx, dy, size) {
  const m = assets.manifest?.props;
  const i = propIndex(name);
  if (!m || i < 0 || !assets.img.props) return false;
  return drawFrame(ctx, assets.img.props, m.fw, m.fh, i % m.cols, Math.floor(i / m.cols), dx, dy, size, size);
}
