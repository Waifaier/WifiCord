"""Animatrônicos originais em pixel art (estilo 'sujo e quebrado').

Cada função recebe a pose e devolve um Canvas virado para a DIREITA.
Poses: idle0 idle1 walk0 walk1 walk2 walk3 chase0 chase1 stun
"""
import math
from pixel import Canvas, C, mix

POSES = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'chase0', 'chase1', 'stun']
OUT = C('#0a0608')

ENDO = [C('#1e1e23'), C('#3c3c44'), C('#6a6a74'), C('#9c9ca6'), C('#cfcfd6')]
RUST = C('#7a3b14')
WIRE_R = C('#b3261e')
WIRE_Y = C('#d9a21b')
TEETH = C('#d8d2c4')
MOUTH = C('#170507')


def pose_params(pose):
    p = dict(bob=0, legA=0, legB=0, arm=0, chase=False, stun=False, jaw=0, lean=0, k=0)
    if pose.startswith('idle'):
        p['bob'] = int(pose[-1])
    elif pose.startswith('walk'):
        k = int(pose[-1])
        ph = k / 4 * math.tau
        p.update(legA=round(math.sin(ph) * 2), legB=-round(math.sin(ph) * 2), bob=round(abs(math.sin(ph))), arm=round(math.cos(ph) * 2), k=k)
    elif pose.startswith('chase'):
        k = int(pose[-1])
        p.update(chase=True, legA=2 if k == 0 else -2, legB=-2 if k == 0 else 2, bob=k, jaw=2 + k, lean=2, arm=-3 + k * 2, k=k)
    elif pose == 'stun':
        p.update(stun=True, bob=1, lean=-1)
    return p


def eye(c, x, y, p, color, size=1):
    if p['stun']:
        c.put(x, y, C('#2a2a2a'))
        return
    col = C('#ff2a1a') if p['chase'] else color
    c.glow(x, y, col, radius=2 if size == 1 else 3)
    if size > 1:
        c.put(x + 1, y, col)
        c.put(x, y + 1, col)


def sparks(c, x, y):
    for dx, dy in [(0, 0), (1, -1), (-1, -2), (2, 1)]:
        c.put(x + dx, y + dy, C('#9ff6ff'))
    c.put(x, y - 1, C('#ffffff'))


def exposed_patch(c, cx, cy, rx, ry, seed=3):
    m = c.ellipse_mask(cx, cy, rx, ry)
    c.shade(m, cx, cy, rx, ry, ENDO[1:4], dither=1.2)
    c.put(cx, cy, ENDO[4])
    c.put(cx - 1, cy + 1, WIRE_R)
    c.put(cx + 1, cy + 1, WIRE_Y)


# ============================================================ TONHO (tatu baterista)
def tonho(pose):
    p = pose_params(pose)
    c = Canvas(48, 48)
    b, L = p['bob'], p['lean']
    shell = [C('#12140f'), C('#262b20'), C('#3d4533'), C('#586249'), C('#768264')]
    belly = [C('#5a4638'), C('#8a6f5e'), C('#b39583'), C('#d4b8a6')]
    skin = [C('#26170f'), C('#4f3222'), C('#7d5741'), C('#a8806a'), C('#c9a48e')]
    # pernas
    for lx, off in ((19, p['legB']), (27, p['legA'])):
        c.shade(c.rect_mask(lx + off, 38, lx + off + 4, 45), lx + off + 2, 41, 3, 5, skin[:4])
        c.fill(c.rect_mask(lx + off - 1, 45, lx + off + 5, 46), C('#1a0f0a'))
    # corpo / carapaça
    bx, by = 23 + L, 29 + b
    body = c.ellipse_mask(bx, by, 11, 12)
    c.shade(body, bx, by, 11, 12, shell)
    for i in range(-3, 2):
        band = c.ellipse_mask(bx + i * 4, by, 1.2, 11.5) & body
        c.fill(band, C('#0f110c'))
    bel = c.ellipse_mask(bx + 5, by + 2, 6, 9) & body
    c.shade(bel, bx + 5, by + 2, 6, 9, belly)
    for yy in range(by - 5, by + 10, 3):
        c.fill(c.rect_mask(bx + 1, yy, bx + 10, yy) & bel, belly[0])
    # braço de trás
    c.shade(c.ellipse_mask(bx + 2, by - 1 + p['arm'], 3, 5), bx + 2, by - 1, 3, 5, skin[:4])
    # cabeça
    hx, hy = 31 + L + (1 if p['chase'] else 0), 16 + b + (2 if p['stun'] else 0)
    head = c.ellipse_mask(hx, hy, 7, 6)
    snout_top = hy - 3 - (1 if p['jaw'] else 0)
    snout = c.poly_mask([(hx + 2, snout_top), (hx + 13, hy - 1), (hx + 13, hy + 1), (hx + 2, hy + 3)])
    c.shade(head | snout, hx + 2, hy - 1, 11, 6, skin)
    c.shade(c.ellipse_mask(hx - 2, hy - 7, 2, 4, 0.3), hx - 2, hy - 7, 2, 4, skin[1:4])  # orelha
    c.shade(c.ellipse_mask(hx + 1, hy - 7, 2, 3.5, -0.2), hx + 1, hy - 7, 2, 3.5, skin[1:4])
    if p['jaw']:
        jaw = c.poly_mask([(hx + 1, hy + 2), (hx + 12, hy + 2 + p['jaw']), (hx + 11, hy + 4 + p['jaw']), (hx, hy + 5)])
        c.shade(jaw, hx + 5, hy + 4, 7, 3, skin[:4])
    # braço da frente + baquetas
    ax, ay = bx + 7, by - 2 + p['arm']
    c.shade(c.ellipse_mask(ax, ay, 3, 5, -0.4), ax, ay, 3, 5, skin[:4])
    c.outline(OUT)
    # detalhes internos
    if p['jaw']:
        m = c.poly_mask([(hx + 2, hy + 1), (hx + 12, hy + 1), (hx + 11, hy + 2 + p['jaw']), (hx + 2, hy + 3)])
        c.fill(m, MOUTH)
        for tx in range(hx + 3, hx + 12, 2):
            c.put(tx, hy + 1, TEETH)
            c.put(tx + 1, hy + 2 + p['jaw'], TEETH)
    c.put(hx + 13, hy - 1, C('#140a06'))
    c.put(hx + 13, hy, C('#140a06'))
    exposed_patch(c, bx + 3, by - 7, 2, 2)
    eye(c, hx + 3, hy - 2, p, C('#ffcf4a'), size=2)
    c.put(hx + 2, hy - 3, C('#1a0f08'))
    c.put(hx + 3, hy - 3, C('#1a0f08'))
    sw = -6 if p['chase'] else (-3 + p['k'] * 2 if pose.startswith('walk') else -2 + p['bob'])
    c.line(ax + 1, ay + 3, ax + 9, ay + sw, C('#d8c7a0'))
    c.line(ax - 1, ay + 4, ax + 7, ay + 4 - sw // 2, C('#bfae88'))
    c.speckle(body, RUST, 0.05, seed=11)
    c.speckle(body, C('#120904'), 0.04, seed=12)
    c.put(bx - 6, by - 4, ENDO[3])
    c.put(bx - 7, by + 3, ENDO[3])
    if p['stun']:
        sparks(c, hx - 3, hy - 9)
    return c


# ============================================================ MAROLA (foca cantora)
def marola(pose):
    p = pose_params(pose)
    c = Canvas(48, 48)
    b, L = p['bob'] * (2 if pose.startswith('walk') else 1), p['lean']
    fur = [C('#141c24'), C('#243340'), C('#3a5162'), C('#587487'), C('#7c98aa')]
    bel = [C('#3f4a4f'), C('#6b7b82'), C('#95a6ab'), C('#bccacc')]
    # cauda / nadadeiras traseiras
    c.shade(c.poly_mask([(12, 44 - p['legA']), (24, 38), (20, 46)]), 18, 42, 7, 4, fur[:4])
    c.shade(c.poly_mask([(28, 46), (26, 38), (38, 45 + p['legB'] // 2)]), 30, 43, 6, 4, fur[:4])
    bx, by = 22 + L, 31 - b
    body = c.ellipse_mask(bx, by, 11, 13, -0.15)
    c.shade(body, bx, by, 11, 13, fur)
    bm = c.ellipse_mask(bx + 5, by + 1, 6, 10, -0.15) & body
    c.shade(bm, bx + 5, by + 1, 6, 10, bel)
    hx, hy = 29 + L + (2 if p['chase'] else 0), 15 - b + (3 if p['stun'] else 0)
    head = c.ellipse_mask(hx, hy, 8, 7)
    c.shade(head, hx, hy, 8, 7, fur)
    muz = c.ellipse_mask(hx + 7, hy + 3, 5, 3.5)
    c.shade(muz, hx + 7, hy + 3, 5, 3.5, bel)
    if p['jaw']:
        jm = c.ellipse_mask(hx + 7, hy + 6 + p['jaw'] // 2, 5, 2.5)
        c.shade(jm, hx + 7, hy + 7, 5, 2.5, bel[:3])
    # nadadeira com microfone
    fx, fy = bx + 8, by - 3 + p['arm']
    c.shade(c.ellipse_mask(fx, fy, 3, 6, -0.6), fx, fy, 3, 6, fur[:4])
    c.outline(OUT)
    c.line(fx + 2, fy - 3, fx + 5, fy - 8, C('#5a5a5a'))
    c.fill(c.ellipse_mask(fx + 6, fy - 10, 2, 2), C('#2d2d2d'))
    c.put(fx + 6, fy - 11, C('#9a9a9a'))
    if p['jaw']:
        m = c.rect_mask(hx + 3, hy + 4, hx + 11, hy + 4 + p['jaw'])
        c.fill(m, MOUTH)
        for tx in range(hx + 4, hx + 12, 2):
            c.put(tx, hy + 4, TEETH)
            c.put(tx, hy + 4 + p['jaw'], TEETH)
    c.put(hx + 11, hy + 2, C('#0b0b0b'))
    c.put(hx + 12, hy + 2, C('#0b0b0b'))
    for k in (-1, 1):
        c.line(hx + 9, hy + 4 + k, hx + 15, hy + 3 + k * 2, C('#cfdde6'))
    eye(c, hx + 3, hy - 2, p, C('#8ff7ff'))
    # gravata borboleta vermelha rasgada
    tx, ty = hx - 1, hy + 8
    c.fill(c.poly_mask([(tx, ty), (tx - 3, ty - 2), (tx - 3, ty + 2)]), C('#9e1f1a'))
    c.fill(c.poly_mask([(tx, ty), (tx + 3, ty - 2), (tx + 3, ty + 2)]), C('#c2352c'))
    c.put(tx, ty, C('#5a0e0b'))
    exposed_patch(c, bx - 4, by + 4, 3, 2.5)
    c.line(bx - 4, by + 6, bx - 6, by + 10, WIRE_R)
    c.speckle(body, C('#0c1116'), 0.05, seed=21)
    c.speckle(body, C('#8a6b4a'), 0.02, seed=22)
    if p['stun']:
        sparks(c, hx, hy - 9)
    return c


# ============================================================ LUME (mariposa)
def lume(pose):
    p = pose_params(pose)
    c = Canvas(48, 48)
    wing = [C('#3a2f1e'), C('#6b5a3a'), C('#9c8759'), C('#c4ae7a'), C('#e0cfa0')]
    fuzz = [C('#2b2418'), C('#56492f'), C('#85744e'), C('#b3a071'), C('#d8c89a')]
    if pose.startswith('idle'):
        flap = [10, 7][p['bob']]
        hover = p['bob']
    elif pose.startswith('walk'):
        flap = [11, 6, 2, 6][p['k']]
        hover = [0, 1, 2, 1][p['k']]
    elif p['chase']:
        flap = [12, 4][p['k']]
        hover = p['k']
    else:
        flap, hover = 3, 4
    cx, cy = 24, 25 + hover
    f = flap / 12
    # asa traseira (atrás do corpo)
    back = c.poly_mask([(cx - 1, cy - 1), (cx - 14, cy - 3 - 12 * f), (cx - 20, cy - 1 - 7 * f), (cx - 13, cy + 3)])
    c.shade(back, cx - 10, cy - 6, 10, 8, [mix(w, C('#000000'), 0.4) for w in wing])
    # abdômen segmentado
    ab = c.ellipse_mask(cx - 6, cy + 7, 4, 7.5, 0.7)
    c.shade(ab, cx - 6, cy + 7, 4, 7.5, fuzz)
    # tórax peludo
    th = c.ellipse_mask(cx + 1, cy, 5, 5)
    c.shade(th, cx + 1, cy, 5, 5, fuzz, dither=1.6)
    # cabeça
    hx, hy = cx + 6, cy - 4
    hd = c.ellipse_mask(hx, hy, 3.5, 3.5)
    c.shade(hd, hx, hy, 3.5, 3.5, fuzz, dither=1.6)
    # asa da frente (rasgada): triangular com borda recortada
    fw = c.poly_mask([(cx + 1, cy - 2), (cx - 10, cy - 6 - 16 * f), (cx - 19, cy - 4 - 12 * f), (cx - 16, cy + 1 - 2 * f), (cx - 6, cy + 3)])
    tear = c.poly_mask([(cx - 18, cy - 5 - 12 * f), (cx - 13, cy - 3 - 8 * f), (cx - 16, cy - 1)])
    c.shade(fw & ~tear, cx - 8, cy - 6 - 6 * f, 10, 9, wing)
    hind = c.poly_mask([(cx - 2, cy + 1), (cx - 12, cy + 4), (cx - 10, cy + 8), (cx - 3, cy + 5)])
    c.shade(hind, cx - 7, cy + 4, 6, 4, wing[:4])
    # pernas
    for i, (lx, ly) in enumerate([(cx - 1, cy + 6), (cx + 2, cy + 6), (cx + 4, cy + 5)]):
        c.line(lx, ly, lx - 1 + i, ly + 6, C('#3b3222'))
    c.outline(OUT)
    if flap > 4:
        spot = c.ellipse_mask(cx - 9, cy - 5 - 7 * f, 2.2, 2.2) & fw
        c.fill(spot, C('#2a1830'))
        c.put(cx - 9, cy - 5 - 7 * f, C('#c86fd0'))
        c.line(cx - 3, cy - 2, cx - 15, cy - 4 - 11 * f, mix(wing[1], C('#000000'), 0.3))
    for i in range(4):
        c.fill(c.line_mask(cx - 10 + i * 2, cy + 3 + i * 3, cx - 5 + i * 2, cy + 6 + i * 3) & ab, fuzz[0])
    # antenas plumosas
    c.line(hx + 1, hy - 3, hx + 7, hy - 11, C('#d9c99a'))
    c.line(hx - 1, hy - 3, hx + 1, hy - 12, C('#b8a878'))
    for k in range(3):
        c.put(hx + 4 + k, hy - 6 - k * 2, C('#8f7f55'))
        c.put(hx + 2 + k, hy - 7 - k * 2, C('#8f7f55'))
    # olhos compostos
    ecol = C('#ff7af2')
    if not p['stun']:
        col = C('#ff2a1a') if p['chase'] else ecol
        c.glow(hx + 2, hy, col, radius=3)
        c.put(hx + 3, hy, col)
        c.put(hx + 2, hy + 1, col)
    else:
        sparks(c, hx, hy - 7)
    # lamparina
    lx, ly = cx + 6, cy + 13
    c.line(cx + 3, cy + 4, lx, ly - 2, C('#3a3a3a'))
    c.fill(c.rect_mask(lx - 2, ly - 1, lx + 2, ly + 3), C('#3a2f1e'))
    c.glow(lx, ly + 1, C('#ffcf6a') if not p['stun'] else C('#553311'), radius=3, core=C('#fff6c0'))
    exposed_patch(c, cx, cy + 1, 1.6, 1.6)
    return c


# ============================================================ GREGÓRIO (gorila garçom) 56x56
def gregorio(pose):
    p = pose_params(pose)
    c = Canvas(56, 56)
    b, L = p['bob'], p['lean']
    fur = [C('#0d0c10'), C('#1d1b22'), C('#302d37'), C('#48444f'), C('#625d6b')]
    face = [C('#1c1a20'), C('#3a3640'), C('#5a5562'), C('#7d7786')]
    apron = [C('#6f6a5e'), C('#9f998a'), C('#c7c1b0'), C('#e3ddcc')]
    # pernas
    for lx, off in ((18, p['legB']), (28, p['legA'])):
        c.shade(c.ellipse_mask(lx + off, 49, 4, 5), lx + off, 49, 4, 5, fur[:4])
    bx, by = 25 + L, 36 + b
    body = c.ellipse_mask(bx, by, 16, 14)
    c.shade(body, bx, by, 16, 14, fur, dither=1.3)
    # braço de trás segurando bandeja
    tx, ty = 22 + (p['arm'] if not p['chase'] else -8), 8 + b + (4 if p['chase'] else 0)
    upper = c.poly_mask([(bx - 8, by - 9), (bx - 1, by - 12), (tx + 3, ty + 3), (tx - 2, ty + 3)])
    c.shade(upper, bx - 4, by - 12, 7, 10, [C('#1d1b22'), C('#3b3743'), C('#57525f'), C('#77717f')])
    tray = c.ellipse_mask(tx, ty, 9, 2.5)
    c.shade(tray, tx, ty - 2, 9, 3, [C('#3d3d3d'), C('#6a6a6a'), C('#9a9a9a'), C('#c4c4c4')])
    # avental
    ap = c.poly_mask([(bx - 2, by - 8), (bx + 12, by - 7), (bx + 13, by + 12), (bx - 1, by + 12)]) & body
    c.shade(ap, bx + 5, by - 2, 10, 14, apron)
    # cabeça
    hx, hy = 38 + L + (2 if p['chase'] else 0), 19 + b + (3 if p['stun'] else 0)
    head = c.ellipse_mask(hx, hy, 9, 8)
    c.shade(head, hx, hy, 9, 8, fur)
    mz = c.ellipse_mask(hx + 4, hy + 3, 6, 4.5)
    c.shade(mz, hx + 4, hy + 3, 6, 4.5, face)
    if p['jaw']:
        jm = c.ellipse_mask(hx + 4, hy + 7 + p['jaw'], 5, 3)
        c.shade(jm, hx + 4, hy + 8, 5, 3, face)
    # braço da frente até o chão
    ax = bx + 13 + (p['arm'] if not p['chase'] else 3)
    arm = c.poly_mask([(bx + 7, by - 9), (bx + 14, by - 8), (ax + 4, 52), (ax - 4, 52)])
    c.shade(arm, ax, by + 2, 6, 16, fur)
    c.shade(c.ellipse_mask(ax, 51, 4, 3), ax, 51, 4, 3, face)
    c.outline(OUT)
    # detalhes
    c.fill(c.rect_mask(hx - 5, hy - 4, hx + 6, hy - 3), C('#07060a'))  # sobrancelha
    if p['jaw']:
        c.fill(c.rect_mask(hx, hy + 5, hx + 9, hy + 5 + p['jaw']), MOUTH)
        for k in range(hx, hx + 10, 2):
            c.put(k, hy + 5, TEETH)
        c.put(hx + 1, hy + 6, TEETH)
        c.put(hx + 8, hy + 6, TEETH)
    c.put(hx + 7, hy + 1, C('#050505'))
    c.put(hx + 9, hy + 1, C('#050505'))
    if not p['stun']:
        col = C('#ff2a1a')
        c.glow(hx + 2, hy - 2, col, radius=2)
        c.glow(hx + 6, hy - 2, mix(col, C('#200000'), 0.6) if p['k'] % 2 else col, radius=1)
    else:
        sparks(c, hx, hy - 10)
    c.fill(c.rect_mask(hx - 3, hy + 9, hx + 3, hy + 10), C('#0a0a0a'))  # gravatinha
    c.speckle(ap, C('#6b3b1c'), 0.08, seed=41)
    c.speckle(ap, C('#3a1b0c'), 0.03, seed=42)
    # pizza podre na bandeja
    c.fill(c.poly_mask([(tx - 4, ty - 2), (tx + 4, ty - 3), (tx, ty + 1)]), C('#b8862e'))
    c.put(tx, ty - 2, C('#6b2a12'))
    c.put(tx - 2, ty - 2, C('#4e6b2a'))
    exposed_patch(c, bx - 6, by - 7, 3, 2.5)
    c.line(bx - 6, by - 5, bx - 8, by + 1, WIRE_Y)
    return c


# ============================================================ O MAESTRO 64x64
def maestro(pose):
    p = pose_params(pose)
    c = Canvas(64, 64)
    b, L = p['bob'], p['lean']
    coat = [C('#07050a'), C('#130d18'), C('#221729'), C('#34243d'), C('#4a3556')]
    mask = [C('#6e6a70'), C('#a39ea6'), C('#cfcad2'), C('#ece8ef')]
    # pernas finas
    for lx, off in ((28, p['legB']), (34, p['legA'])):
        c.fill(c.rect_mask(lx + off, 48, lx + off + 2, 61), coat[1])
        c.fill(c.rect_mask(lx + off - 1, 61, lx + off + 3, 62), C('#000000'))
    # fraque com caudas
    cx, cy = 32 + L, 36 + b
    coatm = c.poly_mask([(cx - 7, cy - 14), (cx + 7, cy - 14), (cx + 9, cy + 12), (cx - 3, cy + 12), (cx - 13, cy + 22), (cx - 10, cy + 6)])
    c.shade(coatm, cx, cy - 2, 12, 20, coat)
    shirt = c.poly_mask([(cx + 1, cy - 13), (cx + 6, cy - 13), (cx + 6, cy + 4), (cx + 2, cy + 8)])
    c.shade(shirt, cx + 4, cy - 5, 4, 10, [C('#6c6870'), C('#aaa5ae'), C('#d6d1da')])
    # gola alta
    c.shade(c.poly_mask([(cx - 8, cy - 14), (cx - 11, cy - 22), (cx - 2, cy - 15)]), cx - 7, cy - 17, 4, 5, coat)
    # braço regendo
    raise_ = -4 if p['chase'] else p['arm']
    hx0, hy0 = cx + 5, cy - 11
    hx1, hy1 = cx + 14, cy - 18 + raise_
    c.fill(c.line_mask(hx0, hy0, hx1, hy1, 3), coat[2])
    c.fill(c.line_mask(cx - 5, cy - 11, cx - 9, cy + 2 - raise_ // 2, 3), coat[1])
    # cabeça / máscara lisa
    mx, my = cx + 1, cy - 23 + (3 if p['stun'] else 0)
    mm = c.ellipse_mask(mx, my, 6.5, 8.5, 0.12 if p['stun'] else 0)
    c.shade(mm, mx, my, 6.5, 8.5, mask)
    c.outline(OUT)
    # rachadura
    c.line(mx - 1, my - 8, mx + 1, my - 3, C('#3d3940'))
    c.line(mx + 1, my - 3, mx - 1, my + 1, C('#3d3940'))
    if p['chase']:
        split = c.poly_mask([(mx - 2, my - 1), (mx + 4, my - 1), (mx + 3, my + 9), (mx - 1, my + 9)])
        c.fill(split, MOUTH)
        for k in range(my, my + 9, 2):
            c.put(mx - 1, k, TEETH)
            c.put(mx + 3, k + 1, TEETH)
    col = C('#ff2a1a') if p['chase'] else C('#ffffff')
    if not p['stun']:
        c.glow(mx - 2, my - 2, col, radius=2, core=C('#ffffff'))
        c.glow(mx + 3, my - 2, col, radius=2, core=C('#ffffff'))
    else:
        sparks(c, mx, my - 11)
    # batuta
    c.line(hx1, hy1, hx1 + 8, hy1 - 9 + (p['k'] * 4 if not p['chase'] else 0), C('#f5f0e0'))
    c.put(hx1, hy1, C('#e9e4ea'))
    # cabos saindo das costas
    for i, (dx, col2) in enumerate([(-10, WIRE_R), (-12, C('#402a50')), (-8, WIRE_Y)]):
        c.line(cx - 6, cy - 6 + i * 3, cx + dx, cy + 18 + i * 3 + (p['k'] % 2), col2)
    c.speckle(coatm, C('#000000'), 0.05, seed=61)
    return c


# ============================================================ PIPOCA (macaco dos pratos) — armadilha sonora
def pipoca(pose):
    p = pose_params(pose)
    c = Canvas(48, 48)
    fur = [C('#24130a'), C('#452612'), C('#6b3e1f'), C('#8f5a33'), C('#b07b4e')]
    face = [C('#6b4a34'), C('#a0775a'), C('#c89c7c'), C('#e2bf9f')]
    vest = [C('#3a0a0c'), C('#6b1418'), C('#9e2127'), C('#c9393e')]
    clash = p['chase'] and p['k'] == 1
    shake = 1 if p['chase'] and p['k'] == 0 else 0
    cx, cy = 24 + shake, 33 + p['bob']
    # pernas sentadas
    c.shade(c.ellipse_mask(cx - 6, cy + 9, 5, 3), cx - 6, cy + 9, 5, 3, fur[:4])
    c.shade(c.ellipse_mask(cx + 6, cy + 9, 5, 3), cx + 6, cy + 9, 5, 3, fur[:4])
    body = c.ellipse_mask(cx, cy, 8, 9)
    c.shade(body, cx, cy, 8, 9, fur)
    c.shade(c.poly_mask([(cx - 7, cy - 6), (cx + 7, cy - 6), (cx + 6, cy + 5), (cx - 6, cy + 5)]) & body, cx, cy, 8, 9, vest)
    # braços + pratos
    spread = 3 if clash else 13
    for side in (-1, 1):
        ax = cx + side * spread
        c.fill(c.line_mask(cx + side * 6, cy - 3, ax, cy - 1, 3), fur[2])
        cym = c.ellipse_mask(ax + side * 1, cy - 2, 2.2, 6)
        c.shade(cym, ax, cy - 4, 2.2, 6, [C('#6b4a10'), C('#a8801e'), C('#d9b33a'), C('#fff0a0')])
    # cabeça
    hx, hy = cx, cy - 15 + (2 if p['stun'] else 0)
    c.shade(c.ellipse_mask(hx - 8, hy, 3, 3.5), hx - 8, hy, 3, 3.5, face)  # orelhas
    c.shade(c.ellipse_mask(hx + 8, hy, 3, 3.5), hx + 8, hy, 3, 3.5, face)
    c.shade(c.ellipse_mask(hx, hy, 7.5, 7), hx, hy, 7.5, 7, fur)
    c.shade(c.ellipse_mask(hx, hy + 2, 5.5, 4.5), hx, hy + 2, 5.5, 4.5, face)
    # chapéu fez
    fez = c.poly_mask([(hx - 4, hy - 6), (hx + 4, hy - 6), (hx + 3, hy - 12), (hx - 3, hy - 12)])
    c.shade(fez, hx, hy - 9, 4, 4, vest)
    c.outline(OUT)
    c.line(hx + 1, hy - 12, hx + 5, hy - 9 + shake, C('#d9b33a'))
    # sorriso enorme
    grin = c.ellipse_mask(hx, hy + 3, 4.5, 2.5 if (p['chase'] or clash) else 1.5)
    c.fill(grin, MOUTH)
    for k in range(hx - 4, hx + 5, 2):
        c.put(k, hy + 2, TEETH)
        c.put(k + 1, hy + 4 if p['chase'] else hy + 3, TEETH)
    # olhos de vidro
    for ex in (hx - 3, hx + 3):
        c.put(ex, hy - 2, C('#f2efe6'))
        c.put(ex + 1, hy - 2, C('#f2efe6'))
        c.put(ex, hy - 1, C('#f2efe6'))
        c.put(ex + 1, hy - 1, C('#f2efe6'))
        if not p['stun']:
            c.put(ex + (1 if shake else 0), hy - 1, C('#ff2a1a') if p['chase'] else C('#111111'))
    if clash:
        for i in range(6):
            a = i / 6 * math.tau
            c.put(cx + math.cos(a) * 11, cy - 3 + math.sin(a) * 9, C('#fff6b0'))
    if p['stun']:
        sparks(c, hx, hy - 14)
    c.speckle(body, C('#1a0d06'), 0.05, seed=71)
    return c


ANIMS = {
    'tonho': (tonho, 48),
    'marola': (marola, 48),
    'lume': (lume, 48),
    'gregorio': (gregorio, 56),
    'maestro': (maestro, 64),
    'pipoca': (pipoca, 48),
}
