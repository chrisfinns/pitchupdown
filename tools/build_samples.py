#!/usr/bin/env python3
"""Build the bundled piano samples from Salamander Grand Piano V3.

Source: npm packages @audio-samples/piano-mp3-velocityN (Salamander Grand
Piano V3 by Alexander Holm, CC BY 3.0). For each sample this script trims the
onset, shortens it, measures its true tuning (inharmonic partial fit), applies
one global gain, and writes samples/*.mp3 plus samples.js (the manifest the
app uses to correct each sample to exact pitch).

Usage: python3 tools/build_samples.py <download-dir>
Needs: ffmpeg (with libmp3lame), numpy, network access to registry.npmjs.org.
"""
import io, json, os, subprocess, sys, tarfile, urllib.request
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples')
SR = 44100
LAYERS = [5, 8, 11, 14]                      # Salamander velocity layers (1..16)
NOTES = ['C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3',
         'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5']
KEEP = 2.2       # seconds kept per sample
FADE = 0.4       # fade-out at the end of the kept part
PEAK_DB = -1.0   # loudest sample peak after the global gain

PC = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def midi_of(name):
    return PC[name[:-1]] + 12 * (int(name[-1]) + 1)


def fetch(dl):
    for v in LAYERS:
        d = os.path.join(dl, f'v{v}')
        if os.path.isdir(os.path.join(d, 'package', 'audio')):
            continue
        meta = json.load(urllib.request.urlopen(f'https://registry.npmjs.org/@audio-samples/piano-mp3-velocity{v}/latest'))
        data = urllib.request.urlopen(meta['dist']['tarball']).read()
        tarfile.open(fileobj=io.BytesIO(data)).extractall(d, filter='data')


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def partials(x, midi):
    """Peak frequencies/amplitudes of the first partials over the audible window."""
    mono = x.mean(axis=1)[int(0.05 * SR):int(1.0 * SR)]
    w = mono * np.hanning(len(mono))
    nfft = 1 << 20
    spec = np.abs(np.fft.rfft(w, nfft))
    logs = np.log(spec + 1e-12)
    df = SR / nfft
    f_nom = 440 * 2 ** ((midi - 69) / 12)
    b_guess = min(0.002, max(0.00006, 0.00035 * (f_nom / 262) ** 1.1))
    top = spec.max()
    out = []
    for n in range(1, 13):
        center = n * f_nom * np.sqrt(1 + b_guess * n * n)
        if center > 7000:
            break
        lo, hi = int(center * 2 ** (-60 / 1200) / df), int(center * 2 ** (60 / 1200) / df)
        k = lo + int(np.argmax(spec[lo:hi]))
        if spec[k] < top * 10 ** (-45 / 20):
            continue
        a, b, c = logs[k - 1], logs[k], logs[k + 1]
        out.append((n, (k + 0.5 * (a - c) / (a - 2 * b + c)) * df, spec[k]))
    return np.array(out)


def fit_B(parts):
    """Inharmonicity from f_n^2 = f0^2 n^2 + f0^2 B n^4 (weighted least squares)."""
    n, f, amp = parts.T
    w = np.sqrt(amp / amp.max())
    A = np.stack([n ** 2, n ** 4], axis=1) * w[:, None]
    (a2, b2), *_ = np.linalg.lstsq(A, f ** 2 * w, rcond=None)
    return b2 / a2


def tuning_cents(parts, midi, B):
    """Amplitude-weighted f0 from all partials given the string's B, vs 12-TET."""
    n, f, amp = parts.T
    f0 = np.average(f / (n * np.sqrt(1 + B * n * n)), weights=amp)
    return 1200 * np.log2(f0 / (440 * 2 ** ((midi - 69) / 12)))


def trim(x):
    env = np.abs(x).max(axis=1)
    onset = int(np.argmax(env > env.max() * 0.05))
    start = max(0, onset - int(0.003 * SR))
    y = x[start:start + int(KEEP * SR)].copy()
    fi = int(0.002 * SR)
    y[:fi] *= np.linspace(0, 1, fi)[:, None]
    fo = int(FADE * SR)
    y[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    return y


def main():
    dl = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.samples-src')
    fetch(dl)
    os.makedirs(OUT, exist_ok=True)
    items = []
    for name in NOTES:
        for v in LAYERS:
            x = trim(decode(os.path.join(dl, f'v{v}', 'package', 'audio', f'{name}v{v}.mp3')))
            items.append((name, v, x))
    gain = 10 ** (PEAK_DB / 20) / max(np.abs(x).max() for *_, x in items)

    manifest = {}
    for name in NOTES:
        midi = midi_of(name)
        layer = []
        for nm, v, x in items:
            if nm != name:
                continue
            y = (x * gain).astype(np.float32)
            fname = f"{name.replace('#', 's')}-v{v}.mp3"
            path = os.path.join(OUT, fname)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                            '-c:a', 'libmp3lame', '-b:a', '128k', path], input=y.tobytes(), check=True)
            # Measure the encoded file, i.e. exactly what the browser will play.
            layer.append((v, fname, partials(decode(path), midi)))
        B = float(np.median([fit_B(p) for *_, p in layer]))  # same string for every layer
        cents = [tuning_cents(p, midi, B) for *_, p in layer]
        manifest[midi] = [{'v': v, 'file': f, 'cents': round(float(c), 2)} for (v, f, _), c in zip(layer, cents)]
        print(f"{name:4} B={B:.5f}  " + '  '.join(f'v{v}:{c:+5.2f}c' for (v, *_), c in zip(layer, cents))
              + f'  spread={max(cents) - min(cents):.2f}c')

    notes = [{'midi': m, 'layers': manifest[m]} for m in sorted(manifest)]
    with open(os.path.join(ROOT, 'samples.js'), 'w') as f:
        f.write('// Generated by tools/build_samples.py. Salamander Grand Piano V3, Alexander Holm, CC BY 3.0.\n')
        f.write('// cents = measured tuning of each sample vs 12-TET; the player corrects it out.\n')
        f.write(f'export const LAYERS = {json.dumps(LAYERS)};\n')
        f.write('export const SAMPLES = [\n  ' + ',\n  '.join(json.dumps(n) for n in notes) + ',\n];\n')


if __name__ == '__main__':
    main()
