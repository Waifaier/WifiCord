// Pós-processamento em WebGL: CRT curvo, aberração cromática, granulação, bloom, VHS, vinheta de medo e dano.
const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
uniform float uFear;
uniform float uHurt;
uniform float uGlitch;
uniform float uBlackout;
uniform float uCam;
uniform float uFlash;
uniform float uHigh;
uniform float uDark;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 curve(vec2 uv, float k) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) * k;
  uv = uv + uv * off * off;
  return uv * 0.5 + 0.5;
}

vec3 sampleRGB(vec2 uv, float ca) {
  vec2 dir = uv - 0.5;
  float r = texture2D(uTex, uv + dir * ca).r;
  float g = texture2D(uTex, uv).g;
  float b = texture2D(uTex, uv - dir * ca).b;
  return vec3(r, g, b);
}

void main() {
  float k = 0.16 + uCam * 0.1;
  vec2 uv = curve(vUv, k);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // tremor/ondulação do medo
  float wob = uFear * uFear * 0.0025;
  uv.x += sin(uv.y * 40.0 + uTime * 6.0) * wob;

  // rasgos horizontais de VHS
  float line = floor(uv.y * 90.0);
  float tear = step(1.0 - (0.012 + uGlitch * 0.35 + uHurt * 0.25), hash(vec2(line, floor(uTime * 24.0))));
  uv.x += tear * (hash(vec2(line, uTime)) - 0.5) * (0.02 + uGlitch * 0.08 + uHurt * 0.06);
  // faixa rolante
  float band = smoothstep(0.0, 0.02, abs(fract(uv.y - uTime * 0.07) - 0.5) - 0.47 + 0.02);
  uv.x += (1.0 - band) * 0.003;

  float ca = 0.0015 + uFear * 0.004 + uHurt * 0.03 + uGlitch * 0.012 + uCam * 0.002;
  vec3 col = sampleRGB(uv, ca);

  // bloom barato (só no modo alto)
  if (uHigh > 0.5) {
    vec3 bl = vec3(0.0);
    vec2 px = 3.0 / uRes;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec3 s = texture2D(uTex, uv + vec2(cos(a), sin(a)) * px * 2.5).rgb;
      bl += max(s - 0.55, 0.0);
    }
    col += bl * 0.22;
  }

  // gradação: dessaturar, sombras frias, realces quentes
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), 0.22 + uFear * 0.25);
  col = col * vec3(0.95, 1.0, 1.04) + vec3(0.0, 0.006, 0.012);
  col = mix(col, col * vec3(1.35, 0.55, 0.5), uBlackout * 0.35);
  col = mix(col, vec3(lum * 1.4, lum * 0.15, lum * 0.1), uHurt * 0.6);
  if (uCam > 0.5) col = mix(col, vec3(lum * 0.6, lum * 1.15, lum * 0.7), 0.35);

  // relâmpago
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + lum);

  // scanlines e grão
  float sl = sin(uv.y * uRes.y * 1.5708) * 0.5 + 0.5;
  col *= 1.0 - (0.07 + uCam * 0.12) * sl;
  float g = hash(uv * uRes + fract(uTime) * 100.0);
  col += (g - 0.5) * (0.06 + uFear * 0.06 + uCam * 0.1 + uDark * 0.04);

  // vinheta pulsando com o coração
  vec2 d = vUv - 0.5;
  float vig = 1.0 - smoothstep(0.2 - uFear * 0.12, 0.85, length(d * vec2(1.0, 0.9)));
  float beat = uFear > 0.35 ? pow(abs(sin(uTime * (3.0 + uFear * 4.0))), 12.0) * uFear * 0.25 : 0.0;
  col *= mix(0.25, 1.0, vig) * (1.0 - beat);
  col = mix(col, vec3(0.35, 0.0, 0.02), (1.0 - vig) * (uHurt * 0.8 + beat));

  // flicker global leve
  col *= 0.97 + 0.03 * hash(vec2(floor(uTime * 30.0), 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    try {
      // preserveDrawingBuffer:true é essencial aqui: sem ele, o navegador
      // pode "limpar" o buffer da tela logo depois de compor o frame, e se
      // isso acontecer antes do próximo desenho (comum em celulares, onde o
      // ritmo de composição da tela é mais instável que no desktop), a
      // tela do jogo fica completamente preta mesmo com o desenho
      // acontecendo normalmente por baixo. Foi exatamente isso que
      // reproduzi testando em um perfil de celular: o quadro era desenhado
      // certinho, mas ao ler os pixels da tela um instante depois, vinha
      // tudo zerado (preto/transparente).
      const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
        || canvas.getContext('experimental-webgl');
      if (!gl) return;
      this.gl = gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      this.prog = prog;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.u = {};
      for (const n of ['uTex', 'uRes', 'uTime', 'uFear', 'uHurt', 'uGlitch', 'uBlackout', 'uCam', 'uFlash', 'uHigh', 'uDark']) this.u[n] = gl.getUniformLocation(prog, n);
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
      this.ok = true;
    } catch (err) {
      console.warn('[postfx] WebGL indisponível, usando render simples:', err.message);
      this.ok = false;
    }
  }

  render(source, p) {
    if (!this.ok) return false;
    const gl = this.gl;
    const c = this.canvas;
    if (c.width !== source.width || c.height !== source.height) { c.width = source.width; c.height = source.height; }
    gl.viewport(0, 0, c.width, c.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      this.ok = false;
      return false;
    }
    const u = this.u;
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uRes, c.width, c.height);
    gl.uniform1f(u.uTime, p.time);
    gl.uniform1f(u.uFear, p.fear);
    gl.uniform1f(u.uHurt, p.hurt);
    gl.uniform1f(u.uGlitch, p.glitch);
    gl.uniform1f(u.uBlackout, p.blackout);
    gl.uniform1f(u.uCam, p.cam);
    gl.uniform1f(u.uFlash, p.flash);
    gl.uniform1f(u.uHigh, p.high);
    gl.uniform1f(u.uDark, p.dark);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }
}
