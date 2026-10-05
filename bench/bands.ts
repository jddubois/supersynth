/**
 * Compare two recordings of the same performance (e.g. `npm run live-test -- --record` with and
 * without `--guard`): third-octave band levels (50 Hz–16 kHz) per 100 ms window, counting the
 * bands within 60 dB of the window's loudest band. With the guard's per-buffer state of the
 * second recording, windows are split into those where the guard was active and the others.
 *
 *   node --import tsx bench/bands.ts reference.f32 test.f32 [test.guard] [--buffer 128] [--rate 48000]
 *
 * Recordings are interleaved stereo float32 (what `--record` writes).
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args.splice(i, 2)[1]! : dflt;
};
const SR = Number(opt('rate', '48000'));
const BUF = Number(opt('buffer', '128'));
const [fa, fb, fg] = args as [string, string, string?];
if (!fa || !fb) {
  console.error('usage: bands.ts reference.f32 test.f32 [test.guard] [--buffer 128] [--rate 48000]');
  process.exit(2);
}
const f32 = (f: string) => {
  const b = readFileSync(f);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};
const A = f32(fa);
const B = f32(fb);
const guard = fg ? new Uint8Array(readFileSync(fg)) : undefined;

const N = 4096;
const HOP = SR / 10;
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k), s = Math.sin(a * k);
        const p = i + k + len / 2;
        const xr = re[p]! * c - im[p]! * s, xi = re[p]! * s + im[p]! * c;
        re[p] = re[i + k]! - xr;
        im[p] = im[i + k]! - xi;
        re[i + k] = re[i + k]! + xr;
        im[i + k] = im[i + k]! + xi;
      }
    }
  }
}
const NB = Math.floor(3 * Math.log2(16000 / 50)) + 1;
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
/** Band levels (dB) of the window starting at frame `start`, both channels' power summed. */
function bands(x: Float32Array, start: number): number[] {
  const out = new Array<number>(NB).fill(0);
  for (const ch of [0, 1]) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[2 * (start + i) + ch] ?? 0) * win[i]!;
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const b = Math.round(3 * Math.log2((k * SR) / N / 50));
      if (b >= 0 && b < NB) out[b] = out[b]! + re[k]! ** 2 + im[k]! ** 2;
    }
  }
  return out.map((e) => 10 * Math.log10(e / ((N * N * 0.375) / 4) + 1e-30));
}

const cats: Record<string, number[]> = guard ? { 'guard active': [], 'guard idle': [], all: [] } : { all: [] };
let worst = { d: 0, t: 0, band: 0, a: 0, b: 0 };
const frames = Math.min(A.length, B.length) / 2;
for (let s = 0; s + N <= frames; s += HOP) {
  const a = bands(A, s), b = bands(B, s);
  const loud = Math.max(...a, ...b);
  let active = false;
  if (guard) for (let i = Math.floor(s / BUF); i <= Math.floor((s + N) / BUF) && i < guard.length; i++) if (guard[i]) active = true;
  for (let i = 0; i < NB; i++) {
    if (Math.max(a[i]!, b[i]!) <= loud - 60) continue;
    const d = Math.abs(a[i]! - b[i]!);
    cats.all!.push(d);
    if (guard) cats[active ? 'guard active' : 'guard idle']!.push(d);
    if (d > worst.d) worst = { d, t: s / SR, band: i, a: a[i]!, b: b[i]! };
  }
}
const lines: string[] = [];
for (const [k, d] of Object.entries(cats)) {
  d.sort((x, y) => x - y);
  const q = (p: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))]! : 0);
  lines.push(`${k}: ${d.length} band-windows, |ΔdB| median ${q(0.5).toFixed(2)} p90 ${q(0.9).toFixed(2)} p99 ${q(0.99).toFixed(2)} max ${q(1).toFixed(2)}`);
}
console.log(lines.join('\n'));
console.log(`largest: ${worst.d.toFixed(1)} dB at ${worst.t.toFixed(1)} s, ${(50 * 2 ** (worst.band / 3)).toFixed(0)} Hz band (${worst.a.toFixed(1)} vs ${worst.b.toFixed(1)} dB)`);
if (guard) {
  let on = 0;
  for (const g of guard) on += g;
  console.log(`guard active in ${((100 * on) / guard.length).toFixed(0)} % of the buffers`);
}
