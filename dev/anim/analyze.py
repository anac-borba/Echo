#!/usr/bin/env python3
"""Separa quadro a quadro as animações gravadas por record.cjs, usando o ffmpeg.

Para cada cena:
  1. ffmpeg tblend=difference + signalstats: quanto a tela mudou de um quadro para o outro (0–255);
  2. acha o trecho em movimento depois do toque (início, fim, duração real = duração no vídeo ÷ câmera lenta);
  3. mede a suavidade: quadros parados no meio do movimento (engasgo) e saltos (um quadro que muda
     sozinho mais de 35% de toda a mudança = algo que "pula" em vez de animar);
  4. ffmpeg tile: uma folha de contato com os quadros da animação, para ver a curva com os olhos.
Uso: python3 dev/anim/analyze.py <pasta-com-cenas.json>
"""
import json, subprocess, sys, os, re, statistics

def diffs(video):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vf',
        'format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
        '-f', 'null', '-'], capture_output=True, text=True).stdout
    ts, vs = [], []
    for line in out.splitlines():
        m = re.search(r'pts_time:([\d.]+)', line)
        if m: ts.append(float(m.group(1)))
        m = re.search(r'YAVG=([\d.]+)', line)
        if m: vs.append(float(m.group(1)))
    return list(zip(ts, vs))

def analyze(sc, out):
    d = diffs(sc['file']); fps = 25; slow = sc['slow']
    after = [(t, v) for t, v in d if t >= sc['trigger'] - 0.1]
    if not after: return {**sc, 'erro': 'sem quadros'}
    MOV = 0.02                      # abaixo disto a tela está parada (ruído de compressão)
    moving = [(t, v) for t, v in after if v > MOV]
    if not moving: return {**sc, 'movimento': False}
    t0 = moving[0][0]
    # fim: último quadro com movimento antes de 1 s (10 s reais ÷ 10) de calma; ignora loops infinitos
    end, calm = t0, 0
    for t, v in after:
        if t < t0: continue
        if v > MOV: end, calm = t, 0
        else:
            calm += 1 / fps
            if calm > 1.0: break
    seg = [(t, v) for t, v in after if t0 <= t <= end]
    vals = [v for _, v in seg]
    still = sum(1 for v in vals if v <= MOV)
    med = statistics.median([v for v in vals if v > MOV]) if any(v > MOV for v in vals) else 0
    # corte seco: um quadro só fazendo mais de 35% de toda a mudança (o resto é animação de verdade)
    total = sum(vals) or 1
    jumps = [(round((t - t0) / slow * 1000), round(100 * v / total)) for t, v in seg if v / total > .35]
    first = vals[0] / med if med else 0
    # folha de contato: até 24 quadros espaçados ao longo do trecho
    n = max(1, round((end - t0) * fps)); step = max(1, n // 24)
    sheet = os.path.join(out, sc['name'] + '.png')
    w = 200 if sc['w'] < 600 else 320
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{max(0, t0 - 0.08):.3f}', '-t', f'{end - t0 + 0.2:.3f}', '-i', sc['file'],
        '-vf', f"select='not(mod(n\\,{step}))',scale={w}:-1,drawtext=text='%{{eif\\:(t)*{1000 // slow}\\:d}} ms':x=w-tw-6:y=h-th-6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6,tile=6x4:padding=4:color=0x222222",
        '-frames:v', '1', sheet], capture_output=True)
    return {'cena': sc['name'], 'duracao_ms': round((end - t0) / slow * 1000), 'quadros': len(seg),
            'parados_no_meio': still, 'cortes_secos(ms,%)': jumps[:6], 'primeiro_quadro_x_mediana': round(first, 1), 'folha': sheet}

if __name__ == '__main__':
    out = sys.argv[1]
    cenas = json.load(open(os.path.join(out, 'cenas.json')))
    res = [analyze(sc, out) for sc in cenas]
    json.dump(res, open(os.path.join(out, 'resultado.json'), 'w'), ensure_ascii=False, indent=1)
    for r in res: print(json.dumps(r, ensure_ascii=False))
