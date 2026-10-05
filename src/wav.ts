import { writeFileSync } from 'node:fs';

import { SupersynthError } from './errors.js';

/** Rendered stereo audio. */
export interface AudioBuffer {
  sampleRate: number;
  /** Left channel samples in [-1, 1]. */
  left: Float32Array;
  /** Right channel samples in [-1, 1]. */
  right: Float32Array;
  /** Duration in seconds. */
  readonly duration: number;
}

export function makeAudioBuffer(sampleRate: number, left: Float32Array, right: Float32Array): AudioBuffer {
  return { sampleRate, left, right, duration: left.length / sampleRate };
}

/** Split interleaved stereo into channels. */
export function deinterleave(inter: Float32Array): [Float32Array, Float32Array] {
  const n = inter.length >> 1;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = inter[2 * i]!;
    r[i] = inter[2 * i + 1]!;
  }
  return [l, r];
}

export interface WavOptions {
  /** 16 or 24 (integer PCM) or 32 (IEEE float). @default 16 */
  bitDepth?: 16 | 24 | 32;
  /** Write a mono file (average of both channels). @default false */
  mono?: boolean;
  /** Add triangular (TPDF) dither when writing 16 bits. Digital silence stays exactly 0 either
   *  way. @default true */
  dither?: boolean;
}

/** Encode audio as a WAV file. Integer samples are clipped to full scale. */
export function encodeWav(audio: AudioBuffer, options: WavOptions = {}): Buffer {
  const bits = options.bitDepth ?? 16;
  if (bits !== 16 && bits !== 24 && bits !== 32) throw new SupersynthError(`bitDepth must be 16, 24 or 32, got ${String(bits)}`);
  const float = bits === 32;
  const ch = options.mono ? 1 : 2;
  const n = audio.left.length;
  const bytes = bits / 8;
  const dataLen = n * ch * bytes;
  const pad = dataLen & 1;
  // fmt: 16 bytes for PCM; 18 (cbSize = 0) for IEEE float, which also needs a fact chunk
  const fmtLen = float ? 18 : 16;
  const headerLen = 12 + 8 + fmtLen + (float ? 12 : 0) + 8;
  const buf = Buffer.alloc(headerLen + dataLen + pad);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const tag = (s: string) => {
    buf.write(s, o, 'ascii');
    o += 4;
  };
  const u32 = (x: number) => {
    v.setUint32(o, x, true);
    o += 4;
  };
  const u16 = (x: number) => {
    v.setUint16(o, x, true);
    o += 2;
  };
  tag('RIFF');
  u32(buf.length - 8);
  tag('WAVE');
  tag('fmt ');
  u32(fmtLen);
  u16(float ? 3 : 1); // WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM
  u16(ch);
  u32(audio.sampleRate);
  u32(audio.sampleRate * ch * bytes);
  u16(ch * bytes);
  u16(bits);
  if (float) {
    u16(0); // cbSize
    tag('fact');
    u32(4);
    u32(n);
  }
  tag('data');
  u32(dataLen);

  const dither = bits === 16 && options.dither !== false;
  let seed = 12345;
  const tpdf = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const a = seed / 4294967296;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return a - seed / 4294967296;
  };
  const { left, right } = audio;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let x = ch === 1 ? 0.5 * (left[i]! + right[i]!) : c === 0 ? left[i]! : right[i]!;
      if (Number.isNaN(x)) x = 0;
      if (float) {
        v.setFloat32(o, x, true);
      } else if (bits === 24) {
        const s = x === 0 ? 0 : Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607)));
        v.setUint16(o, s & 0xffff, true);
        v.setInt8(o + 2, s >> 16);
      } else {
        const s = x === 0 ? 0 : Math.max(-32768, Math.min(32767, Math.round(x * 32767 + (dither ? tpdf() : 0))));
        v.setInt16(o, s, true);
      }
      o += bytes;
    }
  }
  return buf; // a pad byte (0) follows odd-sized data
}

/** Write audio to a WAV file. */
export function writeWav(path: string, audio: AudioBuffer, options: WavOptions = {}): void {
  writeFileSync(path, encodeWav(audio, options));
}
