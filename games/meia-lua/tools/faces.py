"""Rostos de jumpscare (vista frontal, 128x128, 2 quadros: mandíbula abrindo)."""
import math
import random
from pixel import Canvas, C, mix
from anims import ENDO, MOUTH, TEETH, WIRE_R, WIRE_Y, OUT

S = 128


def maw(c, cx, cy, w, h, open_, seed=1, upper=True):
    """Boca escancarada com dentes de metal e endoesqueleto."""
    rng = random.Random(seed)
    hh = h * open_
    m = c.ellipse_mask(cx, cy, w, max(2, hh))
    c.fill(m, MOUTH)
    # garganta vermelha
    c.fill(c.ellipse_mask(cx, cy + hh * 0.2, w * 0.55, max(1, hh * 0.55)), C('#3a0508'))
    c.fill(c.ellipse_mask(cx, cy + hh * 0.3, w * 0.25, max(1, hh * 0.3)), C('#12000a'))
    # dentes superiores e inferiores (triangulares, metálicos)
    n = int(w // 3.2)
    for i in range(n):
        tx = cx - w + 3 + i * (2 * w - 6) / max(1, n - 1)
        top = cy - hh + 1
        L = rng.randint(4, 7)
        pts_top = [(tx - 2.5, top - 1), (tx + 2.5, top - 1), (tx, top + L)]
        c.shade(c.poly_mask(pts_top), tx, top, 3, L, ENDO[2:], dither=0.4)
        bot = cy + hh - 1
        L2 = rng.randint(3, 6)
        pts_b = [(tx - 2.5, bot + 1), (tx + 2.5, bot + 1), (tx, bot - L2)]
        c.shade(c.poly_mask(pts_b), tx, bot, 3, L2, [C('#8e887c'), TEETH, C('#f2eee4')], dither=0.4)
    # hastes da mandíbula
    for side in (-1, 1):
        c.line(cx + side * (w - 1), cy - hh * 0.6, cx + side * (w + 3), cy + hh * 0.8, ENDO[3], 2)


def glow_eye(c, x, y, r, color, seed=0, pupil=True):
    for rr in range(r + 6, r, -1):
        a = int(90 * (1 - (rr - r) / 6))
        m = c.ellipse_mask(x, y, rr, rr)
        ys, xs = m.nonzero()
        for yy, xx in zip(ys, xs):
            c.put(xx, yy, (color[0], color[1], color[2], a))
    c.fill(c.ellipse_mask(x, y, r, r), color)
    c.fill(c.ellipse_mask(x, y, r * 0.55, r * 0.55), mix(color, C('#ffffff'), 0.6))
    if pupil:
        c.fill(c.ellipse_mask(x, y, max(1, r * 0.22), max(1, r * 0.22)), C('#ffffff'))


def socket(c, x, y, rx, ry):
    c.fill(c.ellipse_mask(x, y, rx, ry), C('#050304'))


def cables(c, x0, y0, n, seed):
    rng = random.Random(seed)
    for i in range(n):
        col = rng.choice([WIRE_R, WIRE_Y, C('#3a3a42'), C('#2b5da8')])
        x = x0 + rng.randint(-10, 10)
        y = y0
        pts = []
        for k in range(8):
            pts.append((x, y))
            x += rng.randint(-3, 3)
            y += rng.randint(3, 6)
        for a, b in zip(pts, pts[1:]):
            c.line(a[0], a[1], b[0], b[1], col, 2)


def tonho(open_):
    c = Canvas(S, S)
    skin = [C('#26170f'), C('#4f3222'), C('#7d5741'), C('#a8806a'), C('#c9a48e'), C('#e0c3b0')]
    armor = [C('#12140f'), C('#262b20'), C('#3d4533'), C('#586249'), C('#768264'), C('#98a384')]
    cx, cy = 64, 58
    # orelhas estreitas e eretas
    for s_ in (-1, 1):
        m = c.poly_mask([(cx + s_ * 22, cy - 30), (cx + s_ * 34, cy - 70), (cx + s_ * 40, cy - 66), (cx + s_ * 34, cy - 26)])
        c.shade(m, cx + s_ * 32, cy - 48, 8, 22, skin[1:5])
        c.fill(c.poly_mask([(cx + s_ * 27, cy - 34), (cx + s_ * 34, cy - 62), (cx + s_ * 36, cy - 32)]), C('#4a2820'))
    # cabeça em forma de gota (estreita embaixo)
    head = c.poly_mask([(cx - 44, cy - 20), (cx - 30, cy - 46), (cx, cy - 54), (cx + 30, cy - 46), (cx + 44, cy - 20), (cx + 30, cy + 30), (cx, cy + 62), (cx - 30, cy + 30)])
    c.shade(head, cx, cy - 10, 46, 60, skin)
    # couraça em placas cobrindo a cabeça
    for i in range(5):
        y0 = cy - 50 + i * 9
        plate = head & (c.yy >= y0) & (c.yy < y0 + 8) & c.ellipse_mask(cx, cy - 20, 46 - i * 2, 44)
        c.shade(plate, cx, y0 - 6, 44, 14, armor, dither=1.0)
        c.fill(head & (c.yy == y0 + 8) & c.ellipse_mask(cx, cy - 20, 46 - i * 2, 44), armor[0])
    for k in range(-4, 5):
        c.fill(head & c.line_mask(cx + k * 10, cy - 52, cx + k * 11, cy - 6) & (c.yy < cy - 6), armor[1])
    c.speckle(head & (c.yy < cy - 6), C('#7a3b14'), 0.03, seed=5)
    # focinho longo apontando para a câmera
    sn = c.ellipse_mask(cx, cy + 22, 16, 26)
    c.shade(sn, cx, cy + 10, 16, 30, skin[1:])
    c.outline(OUT)
    c.fill(c.ellipse_mask(cx, cy + 40, 9, 5), C('#241410'))
    c.fill(c.ellipse_mask(cx - 4, cy + 40, 2, 2), C('#050303'))
    c.fill(c.ellipse_mask(cx + 4, cy + 40, 2, 2), C('#050303'))
    # olhos pequenos e fundos: um plástico amarelo, outro soquete de endoesqueleto
    socket(c, cx - 22, cy, 10, 8)
    socket(c, cx + 22, cy, 10, 8)
    glow_eye(c, cx - 22, cy, 5, C('#ffcf4a'))
    c.shade(c.ellipse_mask(cx + 22, cy, 7, 6), cx + 22, cy - 2, 7, 6, ENDO[1:])
    glow_eye(c, cx + 22, cy, 3, C('#ff3a1a'))
    c.line(cx + 16, cy + 6, cx + 12, cy + 26, WIRE_R)
    c.line(cx + 28, cy + 6, cx + 34, cy + 24, WIRE_Y)
    # boca abre dos lados do focinho
    maw(c, cx, cy + 52, 22, 12, open_, seed=3)
    cables(c, cx - 26, cy + 56, 3, 9)
    return c


def marola(open_):
    c = Canvas(S, S)
    fur = [C('#0a1016'), C('#18232d'), C('#2a3c4a'), C('#43596a'), C('#61798b'), C('#85a0b1')]
    bel = [C('#4d5a60'), C('#7c8c93'), C('#a8b8bc'), C('#d2dfe0')]
    cx, cy = 64, 58
    head = c.ellipse_mask(cx, cy, 52, 50)
    c.shade(head, cx, cy - 4, 52, 54, fur)
    # pele rasgada revelando crânio
    torn = c.poly_mask([(cx + 18, cy - 46), (cx + 48, cy - 26), (cx + 40, cy - 4), (cx + 26, cy - 18), (cx + 14, cy - 30)]) & head
    c.shade(torn, cx + 30, cy - 26, 20, 20, ENDO[1:])
    for i in range(3):
        c.put(cx + 28 + i * 5, cy - 20 + i * 3, ENDO[4])
    muz = c.ellipse_mask(cx, cy + 22, 32, 22)
    c.shade(muz, cx, cy + 14, 32, 26, bel)
    c.outline(OUT)
    socket(c, cx - 24, cy - 12, 15, 16)
    socket(c, cx + 24, cy - 12, 15, 16)
    glow_eye(c, cx - 24, cy - 12, 5, C('#8ff7ff'))
    glow_eye(c, cx + 24, cy - 12, 5, C('#8ff7ff'))
    c.fill(c.ellipse_mask(cx, cy + 6, 9, 6), C('#0b0b0b'))
    for s in (-1, 1):
        for k in range(3):
            c.line(cx + s * 16, cy + 16 + k * 5, cx + s * 58, cy + 8 + k * 9, C('#cfdde6'))
    maw(c, cx, cy + 34, 26, 18, open_, seed=7)
    # gravata borboleta
    c.fill(c.poly_mask([(cx, 116), (cx - 22, 104), (cx - 22, 127)]), C('#9e1f1a'))
    c.fill(c.poly_mask([(cx, 116), (cx + 22, 104), (cx + 22, 127)]), C('#c2352c'))
    c.fill(c.ellipse_mask(cx, 116, 5, 5), C('#5a0e0b'))
    return c


def lume(open_):
    c = Canvas(S, S)
    wing = [C('#2a2216'), C('#51432c'), C('#7c6a47'), C('#a6915f'), C('#cbb682')]
    fuzz = [C('#221c12'), C('#4a3f29'), C('#776746'), C('#a39068'), C('#c9b78f')]
    cx, cy = 64, 64
    for s in (-1, 1):
        w = c.poly_mask([(cx, cy), (cx + s * 64, cy - 60), (cx + s * 70, cy + 10), (cx + s * 30, cy + 40)])
        c.shade(w, cx + s * 40, cy - 20, 40, 40, wing)
        c.fill(c.ellipse_mask(cx + s * 44, cy - 24, 9, 9), C('#1e1224'))
        c.fill(c.ellipse_mask(cx + s * 44, cy - 24, 4, 4), C('#c86fd0'))
    head = c.ellipse_mask(cx, cy, 38, 36)
    c.shade(head, cx, cy - 4, 38, 40, fuzz, dither=1.8)
    c.outline(OUT)
    # antenas plumosas
    for s in (-1, 1):
        c.line(cx + s * 10, cy - 30, cx + s * 30, cy - 62, C('#d9c99a'), 2)
        for k in range(6):
            bx = cx + s * (12 + k * 3.3)
            by = cy - 34 - k * 5
            c.line(bx, by, bx + s * 6, by + 2, C('#a89668'))
    # olhos compostos enormes
    for s in (-1, 1):
        ex, ey = cx + s * 20, cy - 4
        m = c.ellipse_mask(ex, ey, 17, 19)
        c.fill(m, C('#2a0a2e'))
        ys, xs = m.nonzero()
        for y, x in zip(ys, xs):
            if (x + (y // 3) % 2 * 1) % 3 == 0 and y % 3 == 0:
                c.put(x, y, C('#ff7af2'))
        glow_eye(c, ex, ey, 5, C('#ff7af2'))
    # mandíbulas mecânicas
    for s in (-1, 1):
        mand = c.poly_mask([(cx + s * 6, cy + 20), (cx + s * (18 + 10 * open_), cy + 30), (cx + s * (6 + 6 * open_), cy + 52), (cx + s * 2, cy + 34)])
        c.shade(mand, cx + s * 10, cy + 34, 10, 14, ENDO[1:])
    maw(c, cx, cy + 34, 10, 12, open_, seed=11)
    return c


def gregorio(open_):
    c = Canvas(S, S)
    fur = [C('#060508'), C('#131118'), C('#221f28'), C('#35313d'), C('#4c4757')]
    face = [C('#16141a'), C('#2f2b35'), C('#4a4552'), C('#67616f'), C('#857e8e')]
    cx, cy = 64, 64
    head = c.ellipse_mask(cx, cy, 58, 56)
    c.shade(head, cx, cy - 6, 58, 60, fur, dither=1.5)
    fm = c.ellipse_mask(cx, cy + 10, 42, 40)
    c.shade(fm, cx, cy, 42, 46, face)
    c.outline(OUT)
    # sobrancelha enorme
    c.shade(c.ellipse_mask(cx, cy - 22, 44, 9), cx, cy - 26, 44, 10, fur[:4])
    socket(c, cx - 20, cy - 10, 11, 8)
    socket(c, cx + 20, cy - 10, 11, 8)
    glow_eye(c, cx - 20, cy - 10, 5, C('#ff2a1a'))
    glow_eye(c, cx + 20, cy - 10, 3, C('#8a1010'), pupil=False)
    # narinas largas
    c.fill(c.ellipse_mask(cx - 9, cy + 6, 5, 4), C('#050405'))
    c.fill(c.ellipse_mask(cx + 9, cy + 6, 5, 4), C('#050405'))
    maw(c, cx, cy + 32, 36, 22, open_, seed=13)
    # presas grandes
    for s in (-1, 1):
        c.shade(c.poly_mask([(cx + s * 26, cy + 32 - 22 * open_), (cx + s * 18, cy + 32 - 22 * open_), (cx + s * 22, cy + 32)]), cx + s * 22, cy + 20, 5, 12, [C('#8e887c'), TEETH, C('#ffffff')])
    exposed = c.ellipse_mask(cx + 40, cy - 30, 12, 10) & head
    c.shade(exposed, cx + 40, cy - 32, 12, 10, ENDO[1:])
    cables(c, cx + 44, cy - 24, 3, 17)
    # gravatinha
    c.fill(c.rect_mask(cx - 16, 120, cx + 16, 127), C('#0a0a0a'))
    return c


def maestro(open_):
    c = Canvas(S, S)
    mask = [C('#4a464c'), C('#7e7a82'), C('#aba6ae'), C('#d2cdd5'), C('#f0ecf2')]
    cx, cy = 64, 60
    # gola alta
    c.shade(c.poly_mask([(4, 127), (18, 70), (40, 100), (88, 100), (110, 70), (124, 127)]), 64, 110, 60, 30, [C('#07050a'), C('#170f1d'), C('#2a1d33')])
    m = c.ellipse_mask(cx, cy, 40, 54)
    c.shade(m, cx, cy - 8, 40, 60, mask)
    c.outline(OUT)
    # rachadura abrindo em bocarra vertical
    gap = 3 + 18 * open_
    split = c.poly_mask([(cx - 2, cy - 30), (cx + 2, cy - 30), (cx + gap, cy - 4), (cx + gap * 0.8, cy + 40), (cx, cy + 52), (cx - gap * 0.8, cy + 40), (cx - gap, cy - 4)])
    c.fill(split, MOUTH)
    c.fill(split & c.ellipse_mask(cx, cy + 10, gap * 0.5 + 1, 30), C('#3a0508'))
    ys, xs = split.nonzero()
    rng = random.Random(21)
    for y in range(cy - 24, cy + 46, 5):
        row = xs[ys == y]
        if len(row):
            l, r = row.min(), row.max()
            L = rng.randint(3, 6)
            c.shade(c.poly_mask([(l - 1, y - 2), (l - 1, y + 2), (l + L, y)]), l, y, L, 2, [C('#8e887c'), TEETH, C('#ffffff')], dither=0.3)
            c.shade(c.poly_mask([(r + 1, y - 2 + 2), (r + 1, y + 4), (r - L, y + 2)]), r, y, L, 2, [C('#8e887c'), TEETH, C('#ffffff')], dither=0.3)
    # rachaduras finas
    for (x0, y0, x1, y1) in [(cx - 18, cy - 50, cx - 8, cy - 30), (cx + 20, cy - 44, cx + 10, cy - 20), (cx - 30, cy + 10, cx - 12, cy + 16)]:
        c.line(x0, y0, x1, y1, C('#2b282d'))
    # olhos: pontos brancos que ficam vermelhos
    col = mix(C('#ffffff'), C('#ff1a1a'), open_)
    glow_eye(c, cx - 17, cy - 16, 4, col)
    glow_eye(c, cx + 17, cy - 16, 4, col)
    cables(c, 14, 72, 3, 31)
    cables(c, 112, 72, 3, 32)
    return c


FACES = {'tonho': tonho, 'marola': marola, 'lume': lume, 'gregorio': gregorio, 'maestro': maestro}
