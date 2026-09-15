"""Mini biblioteca de pixel art procedural (numpy + Pillow).

Usada por gerar_sprites.py para desenhar os sprites originais do jogo.
"""
import math
import random
import numpy as np
from PIL import Image, ImageDraw

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=float) / 16.0


def C(h, a=255):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mix(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(4))


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = np.zeros((h, w, 4), dtype=np.uint8)
        self.yy, self.xx = np.mgrid[0:h, 0:w]

    # ---------- máscaras ----------
    def ellipse_mask(self, cx, cy, rx, ry, rot=0.0):
        x = self.xx + 0.5 - cx
        y = self.yy + 0.5 - cy
        if rot:
            c, s = math.cos(rot), math.sin(rot)
            x, y = x * c + y * s, -x * s + y * c
        return (x / rx) ** 2 + (y / ry) ** 2 <= 1.0

    def poly_mask(self, pts):
        img = Image.new('L', (self.w, self.h), 0)
        ImageDraw.Draw(img).polygon([(float(x), float(y)) for x, y in pts], fill=255)
        return np.array(img) > 0

    def rect_mask(self, x0, y0, x1, y1):
        return (self.xx >= x0) & (self.xx <= x1) & (self.yy >= y0) & (self.yy <= y1)

    def line_mask(self, x0, y0, x1, y1, width=1):
        img = Image.new('L', (self.w, self.h), 0)
        ImageDraw.Draw(img).line([(x0, y0), (x1, y1)], fill=255, width=width)
        return np.array(img) > 0

    # ---------- pintura ----------
    def fill(self, mask, color):
        self.px[mask] = color

    def erase(self, mask):
        self.px[mask] = (0, 0, 0, 0)

    def shade(self, mask, cx, cy, rx, ry, pal, light=(-0.6, -0.8), dither=0.9, ambient=0.15):
        """Sombreamento esférico com dithering ordenado usando uma paleta (escuro → claro)."""
        ys, xs = np.nonzero(mask)
        if not len(xs):
            return
        nx = (xs + 0.5 - cx) / max(rx, 0.1)
        ny = (ys + 0.5 - cy) / max(ry, 0.1)
        nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
        lx, ly = light
        lz = 0.55
        ln = math.sqrt(lx * lx + ly * ly + lz * lz)
        l = (nx * lx + ny * ly + nz * lz) / ln
        l = np.clip(l * 0.85 + ambient, 0, 1)
        n = len(pal)
        v = l * (n - 1) + (BAYER[ys % 4, xs % 4] - 0.5) * dither
        idx = np.clip(np.round(v), 0, n - 1).astype(int)
        cols = np.array(pal, dtype=np.uint8)
        self.px[ys, xs] = cols[idx]

    def speckle(self, mask, color, density, seed=1):
        rng = random.Random(seed)
        ys, xs = np.nonzero(mask)
        for x, y in zip(xs, ys):
            if rng.random() < density:
                self.px[y, x] = color

    def put(self, x, y, color):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            if len(color) == 4 and color[3] < 255 and self.px[y, x, 3] > 0:
                a = color[3] / 255
                base = self.px[y, x].astype(float)
                self.px[y, x] = (base[:3] * (1 - a) + np.array(color[:3]) * a).tolist() + [max(base[3], color[3])]
            else:
                self.px[y, x] = color

    def line(self, x0, y0, x1, y1, color, width=1):
        self.fill(self.line_mask(x0, y0, x1, y1, width), color)

    def outline(self, color=C('#0a0608'), inner=False):
        a = self.px[:, :, 3] > 0
        pad = np.pad(a, 1)
        nb = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
        if inner:
            edge = a & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
            self.px[edge] = color
        else:
            self.px[nb & ~a] = color

    def glow(self, x, y, color, radius=2, core=C('#ffffff')):
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                d = math.hypot(dx, dy)
                if 0 < d <= radius + 0.3:
                    a = int(150 * (1 - d / (radius + 1)))
                    self.put(x + dx, y + dy, (color[0], color[1], color[2], a))
        self.put(x, y, color)
        if core:
            self.put(x, y, core)

    def blit(self, other, ox, oy, flip=False):
        src = other.px[:, ::-1] if flip else other.px
        h, w = src.shape[:2]
        for y in range(h):
            ty = oy + y
            if not 0 <= ty < self.h:
                continue
            for x in range(w):
                tx = ox + x
                if 0 <= tx < self.w and src[y, x, 3] > 0:
                    self.px[ty, tx] = src[y, x]

    def image(self):
        return Image.fromarray(self.px, 'RGBA')


def sheet(frames, fw, fh, cols=None):
    cols = cols or len(frames)
    rows = math.ceil(len(frames) / cols)
    img = Image.new('RGBA', (fw * cols, fh * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        img.paste(f.image(), ((i % cols) * fw, (i // cols) * fh))
    return img
