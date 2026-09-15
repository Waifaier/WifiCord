"""Gera todos os sprites do jogo em client/assets/sprites/.

Uso:  python tools/gerar_sprites.py   (requer: pip install pillow numpy)
Os PNGs já vêm prontos no projeto; rode só se quiser alterar a arte.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from pixel import Canvas, C, mix, sheet
from anims import ANIMS, POSES, ENDO, OUT, WIRE_R, WIRE_Y
from faces import FACES

OUTDIR = os.path.join(os.path.dirname(__file__), '..', 'client', 'assets', 'sprites')
os.makedirs(OUTDIR, exist_ok=True)

PLAYER_COLORS = ['#e7b04a', '#6fd5d0', '#e56b9b', '#9ee56b', '#b28bff', '#ff8a4a', '#6b9bff', '#f5f5f5']
PLAYER_POSES = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'hurt']


# ============================================================ vigias
def vigia(pose, color):
    c = Canvas(32, 32)
    col = C(color)
    uni = [C('#0b1220'), C('#17243a'), C('#243756'), C('#344c72')]
    skin = [C('#6b4430'), C('#a36f52'), C('#cf9d7c'), C('#e8c0a0')]
    k = int(pose[-1]) if pose.startswith('walk') else 0
    ph = k / 4 * math.tau
    la = round(math.sin(ph) * 2) if pose.startswith('walk') else 0
    bob = round(abs(math.sin(ph))) if pose.startswith('walk') else (1 if pose == 'idle1' else 0)
    # pernas
    for lx, off in ((12, -la), (17, la)):
        c.fill(c.rect_mask(lx + off, 22, lx + off + 3, 28), C('#1a1a22'))
        c.fill(c.rect_mask(lx + off - 1, 29, lx + off + 4, 30), C('#0c0c0c'))
    # tronco
    body = c.rect_mask(11, 13 + bob, 21, 22 + bob)
    c.shade(body, 16, 17, 6, 6, uni)
    c.fill(c.rect_mask(11, 20 + bob, 21, 20 + bob), C('#2b1d12'))  # cinto
    c.put(15, 20 + bob, C('#c9a227'))
    # cabeça
    head = c.ellipse_mask(17, 9 + bob, 5, 5)
    c.shade(head, 17, 9 + bob, 5, 5, skin)
    # boné
    cap = c.ellipse_mask(16.5, 6 + bob, 5.2, 3) & (c.yy <= 7 + bob)
    c.shade(cap, 16, 5, 5, 3, uni)
    c.fill(c.rect_mask(19, 7 + bob, 24, 7 + bob), uni[1])
    # braço com lanterna
    arm_y = 15 + bob + (la // 2 if pose.startswith('walk') else 0)
    c.fill(c.rect_mask(18, arm_y, 23, arm_y + 2), uni[2])
    c.fill(c.rect_mask(23, arm_y - 1, 26, arm_y + 2), C('#555a60'))
    c.outline(OUT)
    # detalhes de cor do jogador
    c.fill(c.rect_mask(12, 14 + bob, 20, 14 + bob), col)
    c.fill(c.rect_mask(12, 5 + bob, 20, 5 + bob) & cap, col)
    c.put(20, 9 + bob, C('#151515'))
    c.put(26, arm_y, C('#fff6c0'))
    if pose == 'hurt':
        c.px[:, :, 0] = (c.px[:, :, 0].astype(int) * 0.6 + 100 * (c.px[:, :, 3] > 0)).clip(0, 255).astype('uint8')
    return c


# ============================================================ objetos (32x32)
def prop(kind):
    c = Canvas(32, 32)
    wood = [C('#1f130b'), C('#3e2716'), C('#5e3c22'), C('#80552f'), C('#a0703f')]
    metal = [C('#15171b'), C('#2d3138'), C('#4a5059'), C('#6c737d'), C('#959ca6')]
    if kind == 'mesa':
        c.shade(c.ellipse_mask(16, 18, 14, 9), 16, 18, 14, 9, [C('#6d6558'), C('#9d9383'), C('#c9bfae'), C('#e4dccb')])
        c.fill(c.ellipse_mask(16, 17, 11, 6.5), C('#7e1f1c'))
        c.fill(c.ellipse_mask(16, 16.5, 10, 5.5), C('#9a2a24'))
        for x in range(8, 25, 4):
            c.fill(c.ellipse_mask(x, 17, 1.2, 4) & c.ellipse_mask(16, 16.5, 10, 5.5), C('#e8e0cc'))
        c.fill(c.rect_mask(15, 25, 17, 30), metal[1])
        c.outline(OUT)
        # caixa de pizza velha + chapéu de festa
        c.fill(c.rect_mask(9, 11, 17, 16), C('#b58a55'))
        c.fill(c.rect_mask(9, 11, 17, 11), C('#8a6337'))
        c.put(12, 13, C('#5a3a1a'))
        c.fill(c.poly_mask([(20, 16), (23, 8), (26, 16)]), C('#3a78a0'))
        c.put(23, 11, C('#e7b04a'))
        c.put(23, 8, C('#e7b04a'))
    elif kind == 'fliperama':
        body = c.rect_mask(5, 2, 26, 30)
        c.shade(body, 12, 10, 14, 16, [C('#0e0a18'), C('#1d1530'), C('#2d2148'), C('#3f2f63')])
        c.fill(c.rect_mask(8, 6, 23, 16), C('#050508'))
        c.fill(c.rect_mask(9, 7, 22, 15), C('#0f3a44'))
        for y in range(7, 16, 2):
            c.fill(c.rect_mask(9, y, 22, y), C('#0b2a33'))
        c.put(13, 10, C('#7ee7e0')); c.put(17, 12, C('#e04848')); c.put(19, 9, C('#e7b04a'))
        c.fill(c.rect_mask(6, 18, 25, 22), C('#211733'))
        c.fill(c.ellipse_mask(11, 20, 1.6, 1.6), C('#e04848'))
        c.fill(c.ellipse_mask(18, 20, 1.6, 1.6), C('#48a0e0'))
        c.fill(c.ellipse_mask(22, 20, 1.6, 1.6), C('#e7b04a'))
        c.outline(OUT)
        c.line(7, 3, 24, 29, C('#9ab0b8'))  # tela rachada
    elif kind in ('armario', 'armario_ocupado'):
        c.shade(c.rect_mask(6, 1, 25, 30), 12, 8, 12, 18, [C('#141c22'), C('#24333d'), C('#344a57'), C('#476372')])
        for y in (6, 9, 12):
            c.fill(c.rect_mask(10, y, 21, y), C('#0a0f13'))
        c.fill(c.rect_mask(15, 1, 16, 30), C('#0e1418'))
        c.put(21, 17, C('#b0b8c0'))
        c.speckle(c.rect_mask(6, 1, 25, 30), C('#6b3b1c'), 0.05, seed=3)
        c.outline(OUT)
        if kind == 'armario_ocupado':
            c.put(12, 9, C('#ffffff')); c.put(13, 9, C('#ffffff'))
    elif kind in ('caixa', 'caixa_aberta'):
        c.shade(c.rect_mask(5, 11, 26, 28), 12, 14, 14, 12, [C('#3a2a14'), C('#6b4f2a'), C('#8f6c3c'), C('#b58c52')])
        if kind == 'caixa':
            c.shade(c.poly_mask([(4, 11), (27, 11), (25, 6), (6, 6)]), 16, 6, 12, 5, [C('#6b4f2a'), C('#a3804a'), C('#c9a468')])
            c.fill(c.rect_mask(14, 6, 17, 16), C('#c8b489'))
        else:
            c.fill(c.rect_mask(6, 12, 25, 16), C('#140d06'))
            c.shade(c.poly_mask([(5, 11), (1, 3), (6, 2), (10, 11)]), 5, 6, 4, 5, [C('#6b4f2a'), C('#a3804a')])
            c.shade(c.poly_mask([(26, 11), (30, 3), (25, 2), (21, 11)]), 26, 6, 4, 5, [C('#6b4f2a'), C('#a3804a')])
        c.outline(OUT)
    elif kind == 'gerador':
        c.shade(c.rect_mask(2, 8, 29, 29), 12, 12, 16, 12, [C('#23240f'), C('#43451d'), C('#62652b'), C('#83873c')])
        for x in range(5, 27, 4):
            c.fill(c.rect_mask(x, 12, x + 1, 25), C('#151606'))
        c.fill(c.ellipse_mask(24, 6, 3, 3), metal[2])
        c.outline(OUT)
        c.put(6, 10, C('#ff3b3b'))
    elif kind == 'console':
        c.shade(c.rect_mask(3, 4, 28, 26), 12, 10, 14, 14, metal[:4])
        c.fill(c.rect_mask(6, 7, 25, 19), C('#051008'))
        c.fill(c.rect_mask(7, 8, 24, 18), C('#123a1e'))
        for y in range(8, 19, 2):
            c.fill(c.rect_mask(7, y, 24, y), C('#0d2c16'))
        c.put(10, 11, C('#7f7')); c.put(18, 14, C('#ff4b4b'))
        c.fill(c.rect_mask(6, 22, 25, 25), metal[1])
        c.outline(OUT)
    elif kind == 'painel':
        c.shade(c.rect_mask(7, 3, 24, 28), 12, 8, 10, 14, metal[:4])
        c.fill(c.rect_mask(10, 7, 21, 17), C('#111111'))
        for i in range(3):
            c.fill(c.rect_mask(11 + i * 4, 9, 12 + i * 4, 15), C('#c9a227'))
        c.fill(c.poly_mask([(13, 20), (18, 20), (15, 25)]), C('#e7b04a'))
        c.outline(OUT)
        c.put(20, 25, C('#ff3b3b'))
    elif kind == 'altar':
        c.shade(c.rect_mask(1, 12, 30, 28), 16, 14, 16, 12, [C('#0f0f1f'), C('#1f1f3a'), C('#30305a'), C('#454578')])
        for i, x in enumerate((7, 16, 25)):
            c.fill(c.ellipse_mask(x, 18, 3, 3), C('#0b0b18'))
            c.glow(x, 18, C('#7ab8ff'), radius=2)
        c.outline(OUT)
    elif kind == 'telefone':
        c.shade(c.rect_mask(7, 14, 24, 26), 12, 16, 10, 8, [C('#3a0a0c'), C('#6b1418'), C('#8e2227')])
        c.shade(c.ellipse_mask(15.5, 13, 9, 3), 15, 12, 9, 3, [C('#3a0a0c'), C('#8e2227'), C('#b8393e')])
        c.fill(c.ellipse_mask(15.5, 20, 3, 3), C('#e8e0cc'))
        c.outline(OUT)
    elif kind == 'documento':
        c.fill(c.poly_mask([(8, 6), (22, 4), (25, 26), (10, 28)]), C('#d8ccb0'))
        for y in range(9, 24, 3):
            c.line(11, y + 1, 21, y - 1, C('#6d6558'))
        c.fill(c.ellipse_mask(19, 22, 3, 2), C('#7a1a14'))
        c.outline(OUT)
    elif kind == 'prateleira':
        c.shade(c.rect_mask(0, 3, 31, 28), 16, 8, 16, 14, wood)
        for y in (10, 18, 26):
            c.fill(c.rect_mask(0, y, 31, y + 1), C('#1a0f08'))
        c.fill(c.rect_mask(3, 5, 9, 9), C('#5a6a7a')); c.fill(c.rect_mask(18, 13, 26, 17), C('#6b4f2a'))
        c.fill(c.rect_mask(11, 20, 14, 25), C('#8a1f1f')); c.put(25, 7, C('#e7b04a'))
        c.outline(OUT)
    elif kind == 'caixote':
        c.shade(c.rect_mask(2, 2, 29, 29), 12, 10, 16, 16, wood)
        c.line(3, 3, 28, 28, wood[0], 2); c.line(28, 3, 3, 28, wood[0], 2)
        c.fill(c.rect_mask(2, 2, 29, 3) | c.rect_mask(2, 28, 29, 29), wood[1])
        c.outline(OUT)
    elif kind == 'bancada':
        c.shade(c.rect_mask(0, 6, 31, 26), 16, 8, 16, 12, metal[1:])
        c.fill(c.rect_mask(0, 6, 31, 8), metal[4])
        c.speckle(c.rect_mask(0, 9, 31, 26), C('#4a3020'), 0.05, seed=9)
        c.outline(OUT)
    elif kind == 'fogao':
        c.shade(c.rect_mask(2, 1, 29, 30), 12, 8, 14, 16, metal[:4])
        for y in (8, 22):
            c.fill(c.ellipse_mask(16, y, 7, 5), C('#0a0a0a'))
            c.fill(c.ellipse_mask(16, y, 4, 3), C('#2a2a2a'))
        c.outline(OUT)
    elif kind == 'geladeira':
        c.shade(c.rect_mask(2, 1, 29, 30), 12, 8, 14, 16, [C('#7d8487'), C('#a9b0b3'), C('#cfd4d6'), C('#e9eced')])
        c.fill(c.rect_mask(24, 6, 25, 16), C('#555'))
        c.speckle(c.rect_mask(2, 1, 29, 30), C('#6b3b1c'), 0.06, seed=4)
        c.outline(OUT)
    elif kind == 'pia':
        c.shade(c.rect_mask(1, 6, 30, 26), 16, 10, 16, 12, [C('#6f7a79'), C('#9fb0b0'), C('#d4dcdc')])
        c.fill(c.ellipse_mask(16, 16, 9, 6), C('#586767'))
        c.fill(c.ellipse_mask(16, 16, 2, 1.5), C('#111'))
        c.outline(OUT)
    elif kind == 'caixa_som':
        c.shade(c.rect_mask(4, 2, 27, 29), 12, 8, 12, 16, [C('#050505'), C('#141414'), C('#262626')])
        c.fill(c.ellipse_mask(16, 19, 8, 8), C('#2e2e2e')); c.fill(c.ellipse_mask(16, 19, 3, 3), C('#0a0a0a'))
        c.fill(c.ellipse_mask(16, 7, 3, 3), C('#2e2e2e'))
        c.outline(OUT)
    elif kind == 'bateria_musical':
        c.shade(c.ellipse_mask(16, 20, 9, 7), 16, 18, 9, 8, [C('#3a0a0c'), C('#7a1a1e'), C('#a8282e')])
        c.fill(c.ellipse_mask(16, 18, 7, 4), C('#d8d2c4'))
        for x in (4, 28):
            c.fill(c.ellipse_mask(x, 10, 4, 1.5), C('#c9a227'))
            c.line(x, 11, x, 26, C('#555'))
        c.outline(OUT)
    elif kind == 'arvore':
        c.shade(c.ellipse_mask(16, 14, 15, 13), 16, 12, 15, 14, [C('#050b07'), C('#0e1c12'), C('#18301d'), C('#24452a')], dither=1.6)
        c.fill(c.rect_mask(14, 25, 17, 31), C('#1f140b'))
        c.outline(OUT)
    elif kind == 'caixote_ferro':
        c.shade(c.rect_mask(3, 6, 28, 28), 12, 10, 14, 12, metal[:4])
        c.outline(OUT)
    return c


PROPS = ['mesa', 'fliperama', 'armario', 'armario_ocupado', 'caixa', 'caixa_aberta', 'gerador', 'console', 'painel', 'altar',
         'telefone', 'documento', 'prateleira', 'caixote', 'bancada', 'fogao', 'geladeira', 'pia', 'caixa_som',
         'bateria_musical', 'arvore']


# ============================================================ pisos (16x16)
def tile(kind, v=0):
    import random
    rng = random.Random(hash((kind, v)) & 0xffff)
    c = Canvas(16, 16)
    def base(a, b, noise=0.25, dark=None):
        m = c.rect_mask(0, 0, 15, 15)
        c.fill(m, a)
        c.speckle(m, b, noise, seed=rng.randint(0, 999))
        if dark:
            c.speckle(m, dark, 0.04, seed=rng.randint(0, 999))
    if kind == 'xadrez':
        # variantes 0/1 = casa escura, 2/3 = casa vermelha (o renderizador alterna por posição)
        base_c = C('#141213') if v < 2 else C('#3a1719')
        c.fill(c.rect_mask(0, 0, 15, 15), base_c)
        c.fill(c.rect_mask(0, 15, 15, 15) | c.rect_mask(15, 0, 15, 15), mix(base_c, C('#000000'), 0.35))
        c.speckle(c.rect_mask(0, 0, 14, 14), mix(base_c, C('#000000'), 0.3), 0.05, seed=v)
        if v % 2:
            c.fill(c.ellipse_mask(5, 9, 3, 2), mix(base_c, C('#000000'), 0.25))
    elif kind == 'ladrilho':
        base(C('#35363b'), C('#2f3035'), 0.3, C('#1c1c20'))
        c.fill(c.rect_mask(0, 15, 15, 15) | c.rect_mask(15, 0, 15, 15), C('#1f2024'))
    elif kind == 'madeira' or kind == 'palco':
        a, b = (C('#4a3322'), C('#3f2b1c')) if kind == 'madeira' else (C('#3b2216'), C('#321c12'))
        base(a, b, 0.35)
        for y in (3, 7, 11, 15):
            c.fill(c.rect_mask(0, y, 15, y), C('#1e130b'))
        c.put(rng.randint(0, 15), rng.choice((1, 5, 9, 13)), C('#1e130b'))
    elif kind == 'carpete':
        base(C('#1b2234'), C('#232c42'), 0.45, C('#0e1220'))
    elif kind == 'concreto':
        base(C('#37352f'), C('#2e2c27'), 0.4, C('#1d1b17'))
    elif kind == 'porao':
        base(C('#232820'), C('#1c2019'), 0.45, C('#0f110d'))
        if v % 3 == 0:
            c.line(2, 3, 10, 12, C('#0f110d'))
    elif kind == 'secreta':
        base(C('#281f30'), C('#221a29'), 0.3)
        c.fill(c.rect_mask(0, 0, 15, 0) | c.rect_mask(0, 0, 0, 15), C('#3a2e45'))
        c.put(2, 2, C('#6a5a7a')); c.put(13, 13, C('#6a5a7a'))
    elif kind in ('azulejo', 'cozinha'):
        a, b = (C('#5f6a69'), C('#566160')) if kind == 'azulejo' else (C('#59564f'), C('#4d4a44'))
        for y in range(16):
            for x in range(16):
                c.put(x, y, a if ((x // 4 + y // 4) % 2 == 0) else b)
        for k in range(0, 16, 4):
            c.fill(c.rect_mask(0, k, 15, k) | c.rect_mask(k, 0, k, 15), mix(b, C('#000000'), 0.35))
        c.speckle(c.rect_mask(0, 0, 15, 15), C('#3a2a1a'), 0.04, seed=v)
    elif kind == 'externo':
        base(C('#1a1b1d'), C('#141517'), 0.5, C('#2a2a2c'))
    elif kind == 'grama':
        base(C('#132016'), C('#1b2e1f'), 0.5, C('#0a120c'))
    elif kind == 'parede_topo':
        base(C('#0d0b10'), C('#131016'), 0.2)
    elif kind == 'parede_face':
        base(C('#261f2c'), C('#2e2635'), 0.3)
        c.fill(c.rect_mask(0, 0, 15, 1), C('#3d3345'))
        for y in (5, 10):
            c.fill(c.rect_mask(0, y, 15, y), C('#1a1520'))
        c.fill(c.rect_mask(0, 12, 15, 15), C('#1a141e'))
        c.speckle(c.rect_mask(0, 2, 15, 11), C('#4a1e16'), 0.03, seed=v)
    return c


TILES = ['xadrez', 'ladrilho', 'madeira', 'carpete', 'concreto', 'porao', 'palco', 'secreta', 'azulejo', 'cozinha', 'externo', 'grama', 'parede_topo', 'parede_face']
TILE_VARIANTS = 4


def main():
    manifest = {'anims': {}, 'faces': {}, 'players': {}, 'props': {}, 'tiles': {}}
    # animatrônicos
    for name, (fn, size) in ANIMS.items():
        frames = [fn(p) for p in POSES]
        sheet(frames, size, size).save(os.path.join(OUTDIR, f'anim_{name}.png'))
        manifest['anims'][name] = {'src': f'anim_{name}.png', 'fw': size, 'fh': size, 'poses': POSES}
    # rostos
    for name, fn in FACES.items():
        frames = [fn(0.35), fn(0.7), fn(1.0)]
        sheet(frames, 128, 128).save(os.path.join(OUTDIR, f'face_{name}.png'))
        manifest['faces'][name] = {'src': f'face_{name}.png', 'fw': 128, 'fh': 128, 'frames': 3}
    # vigias
    frames = []
    for col in PLAYER_COLORS:
        frames += [vigia(p, col) for p in PLAYER_POSES]
    sheet(frames, 32, 32, cols=len(PLAYER_POSES)).save(os.path.join(OUTDIR, 'vigias.png'))
    manifest['players'] = {'src': 'vigias.png', 'fw': 32, 'fh': 32, 'poses': PLAYER_POSES, 'colors': len(PLAYER_COLORS)}
    # objetos
    sheet([prop(k) for k in PROPS], 32, 32, cols=8).save(os.path.join(OUTDIR, 'objetos.png'))
    manifest['props'] = {'src': 'objetos.png', 'fw': 32, 'fh': 32, 'cols': 8, 'names': PROPS}
    # pisos
    frames = []
    for k in TILES:
        frames += [tile(k, v) for v in range(TILE_VARIANTS)]
    sheet(frames, 16, 16, cols=TILE_VARIANTS).save(os.path.join(OUTDIR, 'pisos.png'))
    manifest['tiles'] = {'src': 'pisos.png', 'fw': 16, 'fh': 16, 'variants': TILE_VARIANTS, 'names': TILES}
    with open(os.path.join(OUTDIR, 'sprites.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    print('Sprites gerados em', os.path.abspath(OUTDIR))


if __name__ == '__main__':
    main()
