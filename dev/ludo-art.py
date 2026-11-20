# Gera as ilustrações dos temas do Ludo (SVG, desenho próprio). Rode: python3 dev/ludo-art.py
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'img', 'ludo')
os.makedirs(OUT, exist_ok=True)
def save(name, body, vb):
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" preserveAspectRatio="xMidYMid slice">{body}</svg>'
    open(os.path.join(OUT, name), 'w').write(s)
    print(name, len(s))

def windows(x, y, w, h, cols, rows, lit='#F6C6E2', dark='#2E2A60', seed=1):
    out = []; r = seed
    cw, ch = w / cols, h / rows
    for i in range(cols):
        for j in range(rows):
            r = (r * 1103515245 + 12345) & 0x7fffffff
            on = r % 5 < 3
            out.append(f'<rect x="{x+i*cw+cw*.22:.1f}" y="{y+j*ch+ch*.2:.1f}" width="{cw*.56:.1f}" height="{ch*.55:.1f}" rx="1" fill="{lit if on else dark}"/>')
    return ''.join(out)

def tree(x, y, r=11):
    return (f'<ellipse cx="{x}" cy="{y+r*.75}" rx="{r*.9:.1f}" ry="{r*.35:.1f}" fill="#2A2F58" opacity=".6"/>'
            f'<ellipse cx="{x}" cy="{y}" rx="{r*.8:.1f}" ry="{r:.1f}" fill="#3F6273"/>'
            f'<ellipse cx="{x-r*.25:.1f}" cy="{y-r*.3:.1f}" rx="{r*.35:.1f}" ry="{r*.45:.1f}" fill="#57808C"/>')

# ───────── Jantar em Paris: cena (céu, torre, jardins, prédios, rua com varal de luzes) ─────────
def paris_scene():
    b = ['<defs>',
         '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2552"/><stop offset=".55" stop-color="#4A3B7D"/><stop offset="1" stop-color="#3A3270"/></linearGradient>',
         '<radialGradient id="glow" cx="195" cy="215" r="170" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FF9B85" stop-opacity=".75"/><stop offset=".5" stop-color="#C46A9A" stop-opacity=".3"/><stop offset="1" stop-color="#4A3B7D" stop-opacity="0"/></radialGradient>',
         '<linearGradient id="tw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7CE"/><stop offset="1" stop-color="#FF8A66"/></linearGradient>',
         '<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="url(#tw)"/><path d="M0 0V6M3 0V6" stroke="#C4583F" stroke-width=".9" opacity=".7"/></pattern>',
         '<linearGradient id="street" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B3676"/><stop offset=".7" stop-color="#4C3A7A"/><stop offset="1" stop-color="#E58AA6"/></linearGradient>',
         '<radialGradient id="bulb"><stop offset="0" stop-color="#FFF3C8"/><stop offset=".35" stop-color="#FFD98A" stop-opacity=".8"/><stop offset="1" stop-color="#FFD98A" stop-opacity="0"/></radialGradient>',
         '</defs>',
         '<rect width="390" height="844" fill="url(#sky)"/>',
         '<rect width="390" height="844" fill="url(#glow)"/>']
    # gramados com árvores dos dois lados da torre
    for x0 in (14, 252):
        b.append(f'<rect x="{x0}" y="70" width="124" height="74" rx="6" fill="#33406F" stroke="#C6A6E0" stroke-opacity=".35"/>')
        for i in range(4):
            for j in range(2):
                b.append(tree(x0 + 18 + i * 29, 92 + j * 32, 10))
    b.append('<rect x="150" y="238" width="90" height="70" rx="6" fill="#33406F" stroke="#C6A6E0" stroke-opacity=".35"/>')
    for i in range(3): b.append(tree(168 + i * 27, 270, 9))
    # prédios nos cantos e laterais
    for (x, y, w, h, c, r) in [(-8, -6, 150, 54, 9, 2), (248, -6, 150, 54, 9, 2), (-8, 160, 92, 120, 5, 7), (306, 160, 92, 120, 5, 7)]:
        b.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="#3A3D80"/><rect x="{x}" y="{y}" width="{w}" height="6" fill="#5357A6"/>')
        b.append(windows(x + 6, y + 10, w - 12, h - 14, c, r, seed=x + y + 7))
    # torre (estilizada)
    b.append('<ellipse cx="195" cy="246" rx="74" ry="10" fill="#2A2350" opacity=".55"/>')
    tower = ('M195 34 L196.5 58 L200 58 L205 112 L210 112 L210 118 L206 118 L216 168 L224 168 L224 176 L218 176 '
             'C224 196 234 216 246 238 L226 238 C220 214 208 202 195 202 C182 202 170 214 164 238 L144 238 C156 216 166 196 172 176 '
             'L166 176 L166 168 L174 168 L184 118 L180 118 L180 112 L185 112 L190 58 L193.5 58 Z')
    b.append(f'<path d="{tower}" fill="url(#hatch)" stroke="#FFD2B8" stroke-width="1.2" stroke-linejoin="round"/>')
    b.append('<path d="M166 168h58M180 112h30" stroke="#FFF1DF" stroke-width="2.4" stroke-linecap="round"/>')
    b.append('<circle cx="195" cy="40" r="3" fill="#FFF6D6"/><circle cx="195" cy="40" r="10" fill="url(#bulb)"/>')
    # rua de baixo: fachadas com janelas acesas, porta iluminada e varal de luzes
    b.append('<rect y="640" width="390" height="204" fill="url(#street)"/>')
    xs = [-6, 70, 150, 240, 318]
    ws = [72, 76, 86, 74, 80]
    for i, (x, w) in enumerate(zip(xs, ws)):
        h = 96 + (i % 2) * 14
        b.append(f'<rect x="{x}" y="{752-h}" width="{w}" height="{h}" fill="{"#403C82" if i % 2 else "#373373"}"/>')
        b.append(f'<rect x="{x}" y="{752-h}" width="{w}" height="5" fill="#5A55A8"/>')
        b.append(windows(x + 5, 752 - h + 10, w - 10, h - 34, 4, 3, lit='#F2B9DA', seed=i * 31 + 3))
    b.append('<rect x="165" y="716" width="60" height="36" rx="3" fill="#FFE7B8"/><rect x="171" y="722" width="22" height="30" fill="#FFF6DD"/><rect x="197" y="722" width="22" height="30" fill="#FFF6DD"/>')
    b.append('<path d="M158 714h74l-6-10h-62z" fill="#C2577E"/>')
    b.append('<rect y="752" width="390" height="10" fill="#2C285E"/>')
    pts = []
    for i in range(0, 19):
        x = i * 22 - 4; y = 776 + 10 * math.sin(i / 18 * math.pi * 3) ** 2
        pts.append((x, y))
    b.append('<path d="M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + '" stroke="#FFE2B0" stroke-opacity=".6" fill="none"/>')
    for x, y in pts: b.append(f'<circle cx="{x:.1f}" cy="{y+3:.1f}" r="8" fill="url(#bulb)"/><circle cx="{x:.1f}" cy="{y+3:.1f}" r="2" fill="#FFF3C8"/>')
    save('paris-scene.svg', ''.join(b), '0 0 390 844')

# ───────── Jantar em Paris: mesa (cada casa), com rosas da cor da jogadora ─────────
def rose_cluster(cx, cy, col, dark, n=5, r=4.2):
    out = [f'<ellipse cx="{cx-6}" cy="{cy+3}" rx="5" ry="2.4" fill="#3D7A44" transform="rotate(-25 {cx-6} {cy+3})"/>',
           f'<ellipse cx="{cx+6}" cy="{cy+3}" rx="5" ry="2.4" fill="#3D7A44" transform="rotate(25 {cx+6} {cy+3})"/>']
    for k in range(n):
        a = k / n * math.tau
        x = cx + math.cos(a) * r * 1.05; y = cy + math.sin(a) * r * .8
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*.75:.1f}" fill="{col}"/><circle cx="{x:.1f}" cy="{y:.1f}" r="{r*.32:.1f}" fill="{dark}"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r*.8:.1f}" fill="{col}"/><circle cx="{cx}" cy="{cy}" r="{r*.35:.1f}" fill="{dark}"/>')
    return ''.join(out)

def paris_table(key, col, dark):
    b = ['<defs><linearGradient id="cl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F6CFE2"/></linearGradient>',
         '<radialGradient id="fl"><stop offset="0" stop-color="#FFF6CC"/><stop offset=".4" stop-color="#FFC86A" stop-opacity=".7"/><stop offset="1" stop-color="#FFC86A" stop-opacity="0"/></radialGradient></defs>',
         '<rect width="120" height="120" fill="#4B3E7C"/>',
         '<circle cx="60" cy="60" r="58" fill="#56488C" stroke="#3F3370" stroke-width="2"/>',
         '<circle cx="60" cy="60" r="46" fill="none" stroke="#3F3370" stroke-width="1.2" stroke-dasharray="3 4"/>']
    # cadeiras
    for x in (6, 104):
        b.append(f'<rect x="{x}" y="40" width="10" height="48" rx="4" fill="#CDA8EC"/><rect x="{x+(2 if x < 60 else 0)}" y="40" width="8" height="48" rx="3" fill="#A97AD0" opacity=".55"/>')
    # toalha com barra ondulada
    path = 'M18 16 Q60 10 102 16 V104 ' + ' '.join(f'Q{102-i*10.5-5.25:.1f} {111 if i % 2 == 0 else 104} {102-(i+1)*10.5:.1f} 105' for i in range(8)) + ' Z'
    b.append(f'<path d="{path}" fill="url(#cl)" stroke="#E7B5CF" stroke-width="1"/>')
    b.append('<rect x="52" y="14" width="16" height="92" fill="#9468BE" opacity=".55"/>')
    b.append('<path d="M30 30v70M90 30v70" stroke="#EBC4D8" stroke-width="1" opacity=".7"/>')
    # castiçal com três velas
    b.append('<ellipse cx="60" cy="72" rx="9" ry="3" fill="#B7832E"/><rect x="58.5" y="56" width="3" height="16" fill="#E6B54E"/>')
    b.append('<path d="M47 58 Q60 66 73 58" fill="none" stroke="#E6B54E" stroke-width="2.4"/>')
    for x, h in ((47, 12), (60, 16), (73, 12)):
        b.append(f'<circle cx="{x}" cy="{58-h-3}" r="9" fill="url(#fl)"/><rect x="{x-2}" y="{58-h}" width="4" height="{h}" rx="1" fill="#F9C3D3"/><ellipse cx="{x}" cy="{58-h-3}" rx="1.8" ry="3.2" fill="#FFF0B5"/>')
    # buquê de rosas
    b.append('<path d="M54 98 h12 l-2 10 h-8 z" fill="#9A3E2C"/>')
    b.append(rose_cluster(60, 92, col, dark, 6, 4))
    save(f'paris-table-{key}.svg', ''.join(b), '0 0 120 120')

def heart_dots(cx, cy, s, col, n=26):
    out = []
    for i in range(n):
        t = i / n * math.tau
        x = 16 * math.sin(t) ** 3; y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        out.append(f'<ellipse cx="{cx + x*s:.2f}" cy="{cy + y*s:.2f}" rx="{1.1+ (i%3)*.25:.2f}" ry=".8" fill="{col}" transform="rotate({i*37 % 180} {cx + x*s:.2f} {cy + y*s:.2f})"/>')
    return ''.join(out)

def paris_center():
    b = ['<rect width="60" height="60" fill="#463A75"/>',
         '<path d="M0 0L60 60M60 0L0 60" stroke="#2F2756" stroke-width="1.4"/>',
         '<path d="M0 0L60 0L30 30Z" fill="#4E4180"/><path d="M60 60L0 60L30 30Z" fill="#4E4180"/>']
    save('paris-center.svg', ''.join(b), '0 0 60 60')

# ───────── Jantar em Paris: trilhas de pétalas (sobre o tabuleiro inteiro, 15×15 casas de 10) ─────────
def petal(x, y, ang, sz, col, dark):
    return (f'<g transform="translate({x:.2f} {y:.2f}) rotate({ang:.0f})"><ellipse rx="{sz:.2f}" ry="{sz*.62:.2f}" fill="{col}"/>'
            f'<ellipse cx="{sz*.25:.2f}" rx="{sz*.45:.2f}" ry="{sz*.3:.2f}" fill="{dark}" opacity=".45"/></g>')

def trail(pts, col, dark, seed, step=1.5):
    # pétalas espalhadas ao longo de uma linha, com um leve zigue-zague
    out = []; r = seed
    def rnd():
        nonlocal r; r = (r * 1103515245 + 12345) & 0x7fffffff; return (r % 1000) / 1000
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / step))
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        for i in range(n):
            t = i / n
            w = math.sin((x0 + y0 + t * L) * .55) * 1.6 + (rnd() - .5) * 1.4
            x = x0 + (x1 - x0) * t + nx * w; y = y0 + (y1 - y0) * t + ny * w
            out.append(petal(x, y, rnd() * 180, .85 + rnd() * .6, col, dark))
            if rnd() < .35: out.append(petal(x + (rnd() - .5) * 2.4, y + (rnd() - .5) * 2.4, rnd() * 180, .55 + rnd() * .3, col, dark))
    return ''.join(out)

def heart(cx, cy, s, ang, col, dark, n=30):
    out = []
    for i in range(n):
        t = i / n * math.tau
        x = 16 * math.sin(t) ** 3; y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        a = math.radians(ang); X = x * math.cos(a) - y * math.sin(a); Y = x * math.sin(a) + y * math.cos(a)
        out.append(petal(cx + X * s, cy + Y * s, i * 47 % 180, .9 + (i % 3) * .2, col, dark))
        if i % 2: out.append(petal(cx + X * s * .82, cy + Y * s * .82, i * 31 % 180, .6, col, dark))
    return ''.join(out)

def paris_petals():
    b = []
    # vermelho: entra pela esquerda (linha 7), sobe até a saída e corre até o coração do lado esquerdo do centro
    R, Rd = '#E2384B', '#8E1E2C'; G, Gd = '#7CC86A', '#2F6B33'; Y, Yd = '#F5C842', '#A87A10'; B_, Bd = '#4D8BE8', '#25407F'
    b.append(trail([(2, 75), (15, 66), (30, 75), (52, 75), (60, 75)], R, Rd, 11))
    b.append(heart(65, 75, .3, -90, R, Rd))
    b.append(trail([(148, 75), (135, 84), (120, 75), (98, 75), (90, 75)], Y, Yd, 23))
    b.append(heart(85, 75, .3, 90, Y, Yd))
    b.append(trail([(75, 2), (84, 15), (75, 30), (75, 52), (75, 60)], G, Gd, 37))
    b.append(heart(75, 65, .3, 0, G, Gd))
    b.append(trail([(75, 148), (66, 135), (75, 120), (75, 98), (75, 90)], B_, Bd, 51))
    b.append(heart(75, 85, .3, 180, B_, Bd))
    save('paris-petals.svg', ''.join(b), '0 0 150 150')

# ───────── Casinha: mesa de madeira com plantas, livro, borboleta e a fachada da casa embaixo ─────────
def casa_scene():
    b = ['<defs><linearGradient id="lt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4D8" stop-opacity=".35"/><stop offset=".6" stop-color="#FFF4D8" stop-opacity="0"/></linearGradient></defs>']
    for i in range(11):
        c = '#CE9A62' if i % 2 else '#C48D56'
        b.append(f'<rect x="{i*38-8}" y="0" width="38" height="844" fill="{c}"/><path d="M{i*38+8} 0 C{i*38+2} 200 {i*38+16} 420 {i*38+6} 844" stroke="#A9733F" stroke-opacity=".35" fill="none"/>')
    b.append('<rect width="390" height="844" fill="url(#lt)"/>')
    # livro
    b.append('<g transform="rotate(-8 60 50)"><rect x="18" y="12" width="88" height="70" rx="4" fill="#7FA77B"/><rect x="18" y="12" width="8" height="70" fill="#5F855C"/><rect x="38" y="24" width="56" height="34" rx="3" fill="#F4ECD8"/><circle cx="66" cy="41" r="9" fill="#E6D2C2"/><circle cx="62" cy="38" r="2" fill="#B98F7A"/></g>')
    # plantas em vasos
    for (x, y, s) in ((26, 128, 1), (60, 160, .8), (24, 196, .9)):
        b.append(f'<g transform="translate({x} {y}) scale({s})"><path d="M-14 6h28l-4 18h-20z" fill="#C46A45"/><rect x="-16" y="2" width="32" height="7" rx="2" fill="#D77F57"/>')
        for k in range(7):
            a = k / 7 * math.tau
            b.append(f'<ellipse cx="{math.cos(a)*7:.1f}" cy="{-4+math.sin(a)*5:.1f}" rx="7" ry="3.4" fill="{"#7FB77E" if k % 2 else "#5E9E66"}" transform="rotate({k/7*360:.0f} {math.cos(a)*7:.1f} {-4+math.sin(a)*5:.1f})"/>')
        b.append('<circle cx="0" cy="-4" r="4" fill="#A6D49A"/></g>')
    # borboleta e caneca
    b.append('<g transform="translate(116 132) rotate(-15)"><ellipse cx="-7" cy="-5" rx="8" ry="6" fill="#C9E7F7"/><ellipse cx="7" cy="-5" rx="8" ry="6" fill="#C9E7F7"/><ellipse cx="-6" cy="5" rx="6" ry="4.5" fill="#F7D7E8"/><ellipse cx="6" cy="5" rx="6" ry="4.5" fill="#F7D7E8"/><rect x="-1.2" y="-9" width="2.4" height="18" rx="1.2" fill="#6B5A4A"/></g>')
    b.append('<circle cx="336" cy="52" r="24" fill="#F4F1EA"/><circle cx="336" cy="52" r="18" fill="#7B4A2B"/><circle cx="330" cy="46" r="5" fill="#9B6A48"/><path d="M358 44 q14 8 0 16" stroke="#F4F1EA" stroke-width="5" fill="none"/>')
    b.append('<g transform="translate(350 170)"><path d="M-12 8h24l-3 16h-18z" fill="#E3B23C"/>' + ''.join(f'<ellipse cx="{math.cos(k)*6:.1f}" cy="{-8+math.sin(k)*4:.1f}" rx="4" ry="10" fill="#6BAF6E" transform="rotate({k*57:.0f} {math.cos(k)*6:.1f} {-8+math.sin(k)*4:.1f})"/>' for k in range(6)) + '</g>')
    # fachada embaixo
    b.append('<rect x="34" y="676" width="322" height="128" fill="#F4E8D4"/><rect x="34" y="676" width="322" height="10" fill="#B3463F"/>')
    for x in (52, 112, 240, 300):
        b.append(f'<rect x="{x}" y="704" width="40" height="44" rx="3" fill="#FFFFFF"/><rect x="{x+4}" y="708" width="14" height="17" fill="#BFE0F2"/><rect x="{x+22}" y="708" width="14" height="17" fill="#BFE0F2"/><rect x="{x+4}" y="728" width="14" height="17" fill="#BFE0F2"/><rect x="{x+22}" y="728" width="14" height="17" fill="#BFE0F2"/>')
    b.append('<rect x="172" y="716" width="46" height="88" rx="4" fill="#FFFFFF"/><rect x="177" y="722" width="17" height="76" fill="#CBE6F5"/><rect x="196" y="722" width="17" height="76" fill="#CBE6F5"/>')
    for i in range(14):
        x = 30 + i * 24
        b.append(f'<circle cx="{x}" cy="806" r="14" fill="{"#5E9E66" if i % 2 else "#4C8C57"}"/>')
    b.append('<rect y="812" width="390" height="40" fill="#8CBF72"/>')
    save('casa-scene.svg', ''.join(b), '0 0 390 844')

def room(key):
    b = []
    if key == 'r':  # sala: carpete vermelho, sofá, TV, estante
        b += ['<rect width="120" height="120" fill="#D9B184"/>', ''.join(f'<path d="M0 {y}h120" stroke="#C49A6C" stroke-width="1"/>' for y in range(10, 120, 12)),
              '<rect x="16" y="30" width="88" height="72" rx="4" fill="#C93A36"/><rect x="22" y="36" width="76" height="60" rx="3" fill="none" stroke="#E7766F" stroke-width="1.5"/>',
              '<rect x="22" y="6" width="76" height="20" rx="6" fill="#8E2A2C"/><rect x="26" y="9" width="22" height="13" rx="4" fill="#B53B3B"/><rect x="50" y="9" width="22" height="13" rx="4" fill="#B53B3B"/><rect x="74" y="9" width="20" height="13" rx="4" fill="#B53B3B"/>',
              '<rect x="96" y="40" width="20" height="40" rx="2" fill="#7A5236"/><rect x="99" y="44" width="14" height="10" fill="#E8C35A"/><rect x="99" y="58" width="14" height="10" fill="#6FA3D8"/>',
              '<rect x="40" y="104" width="40" height="12" rx="2" fill="#5A3A26"/><rect x="44" y="106" width="32" height="6" fill="#1E1E28"/>',
              '<rect x="48" y="56" width="24" height="16" rx="3" fill="#9A6A44"/><circle cx="60" cy="64" r="3" fill="#F3E3C0"/>',
              '<circle cx="8" cy="112" r="7" fill="#5E9E66"/><circle cx="8" cy="112" r="3" fill="#7FB77E"/>']
    elif key == 'g':  # quarto: cama verde, tapete, criado-mudo
        b += ['<rect width="120" height="120" fill="#EADFC8"/>', ''.join(f'<path d="M{x} 0v120" stroke="#DCCBAA" stroke-width="1"/>' for x in range(12, 120, 14)),
              '<ellipse cx="66" cy="84" rx="40" ry="26" fill="#9CCB8F"/><ellipse cx="66" cy="84" rx="32" ry="19" fill="none" stroke="#C6E3B9" stroke-width="2"/>',
              '<rect x="8" y="8" width="54" height="66" rx="5" fill="#8A5A3A"/><rect x="11" y="12" width="48" height="58" rx="4" fill="#FFFFFF"/><rect x="11" y="32" width="48" height="38" rx="3" fill="#5FA463"/><path d="M11 40h48M11 50h48" stroke="#4E8A52" stroke-width="1.2"/>',
              '<rect x="15" y="16" width="18" height="11" rx="4" fill="#F2F0EA"/><rect x="37" y="16" width="18" height="11" rx="4" fill="#F2F0EA"/>',
              '<rect x="68" y="10" width="16" height="16" rx="2" fill="#8A5A3A"/><circle cx="76" cy="18" r="4" fill="#FFE29A"/>',
              '<rect x="92" y="6" width="22" height="6" rx="2" fill="#BFE0F2"/>']
    elif key == 'y':  # cozinha: piso xadrez, balcão em L, mesa redonda
        b += ['<rect width="120" height="120" fill="#F4E3C4"/>', ''.join(f'<rect x="{x}" y="{y}" width="12" height="12" fill="#E9CB96"/>' for x in range(0, 120, 12) for y in range(0, 120, 12) if (x // 12 + y // 12) % 2 == 0),
              '<rect x="4" y="4" width="112" height="22" rx="3" fill="#B98552"/><rect x="4" y="4" width="112" height="16" rx="3" fill="#F6F2EA"/>',
              '<rect x="4" y="4" width="22" height="84" rx="3" fill="#B98552"/><rect x="4" y="4" width="16" height="84" rx="3" fill="#F6F2EA"/>',
              '<circle cx="40" cy="12" r="4.5" fill="#3A3A44"/><circle cx="54" cy="12" r="4.5" fill="#3A3A44"/><rect x="74" y="7" width="22" height="10" rx="3" fill="#A9C9DE"/>',
              '<circle cx="70" cy="70" r="20" fill="#C58A54"/><circle cx="70" cy="70" r="16" fill="#D9A06A"/><circle cx="70" cy="70" r="5" fill="#F2C94C"/>',
              '<rect x="64" y="40" width="12" height="9" rx="3" fill="#E07A4A"/><rect x="64" y="92" width="12" height="9" rx="3" fill="#E07A4A"/><rect x="40" y="64" width="9" height="12" rx="3" fill="#E07A4A"/><rect x="92" y="64" width="9" height="12" rx="3" fill="#E07A4A"/>']
    else:  # banheiro: azulejo, banheira, pia, vaso
        b += ['<rect width="120" height="120" fill="#D8ECF7"/>', ''.join(f'<path d="M{v} 0v120M0 {v}h120" stroke="#BCD9EC" stroke-width="1"/>' for v in range(10, 120, 10)),
              '<rect x="6" y="6" width="44" height="64" rx="16" fill="#FFFFFF" stroke="#B9CCDA" stroke-width="1.5"/><rect x="12" y="12" width="32" height="52" rx="12" fill="#8FC9EA"/><circle cx="22" cy="24" r="3" fill="#FFFFFF" opacity=".8"/><circle cx="32" cy="34" r="2" fill="#FFFFFF" opacity=".8"/>',
              '<rect x="86" y="6" width="28" height="20" rx="4" fill="#FFFFFF" stroke="#B9CCDA"/><ellipse cx="100" cy="16" rx="9" ry="6" fill="#CFE6F4"/>',
              '<rect x="92" y="88" width="20" height="10" rx="3" fill="#FFFFFF" stroke="#B9CCDA"/><ellipse cx="102" cy="106" rx="9" ry="11" fill="#FFFFFF" stroke="#B9CCDA"/>',
              '<rect x="54" y="80" width="30" height="22" rx="6" fill="#F7B6C8"/><path d="M58 84h22M58 90h22M58 96h22" stroke="#FFFFFF" stroke-width="1.2" opacity=".7"/>']
    save(f'casa-room-{key}.svg', ''.join(b), '0 0 120 120')

def casa_center():
    b = ['<path d="M0 0L60 0L30 30Z" fill="#A8D79A"/><path d="M60 0L60 60L30 30Z" fill="#F5C77E"/><path d="M60 60L0 60L30 30Z" fill="#9FD0EE"/><path d="M0 60L0 0L30 30Z" fill="#E77F72"/>',
         '<rect x="19" y="19" width="22" height="22" fill="#C38B55"/>']
    for i in range(6):
        y = 19 + i * 3.7
        b.append(f'<rect x="20" y="{y:.1f}" width="20" height="3.2" fill="{"#E0B07A" if i % 2 else "#D7A26A"}"/>')
    b.append('<path d="M19 19v22M41 19v22" stroke="#8A5A33" stroke-width="2"/>')
    b.append('<circle cx="16" cy="16" r="3" fill="#6BAF6E"/><circle cx="44" cy="16" r="3" fill="#6BAF6E"/>')
    save('casa-center.svg', ''.join(b), '0 0 60 60')

paris_scene()
for k, c, d in (('r', '#D9374A', '#8E1E2C'), ('g', '#5FAE5A', '#2F6B33'), ('y', '#F2C23E', '#B07E12'), ('b', '#4D7BD6', '#25407F')):
    paris_table(k, c, d)
paris_center()
paris_petals()
casa_scene()
for k in 'rgyb': room(k)
casa_center()
