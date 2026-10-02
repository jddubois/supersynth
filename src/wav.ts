import { writeFileSync } from 'node:fs';

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
  /** 16 (PCM, dithered) or 32 (IEEE float). @default 16 */
  bitDepth?: 16 | 24 | 32;
  /** Write a mono file (average of both channels). @default false */
  mono?: boolean;
}

/** Encode audio as a WAV file. */
export function encodeWav(audio: AudioBuffer, options: WavOptions = {}): Buffer {
  const bits = options.bitDepth ?? 16;
  const ch = options.mono ? 1 : 2;
  const n = audio.left.length;
  const bytes = bits / 8;
  const data = Buffer.alloc(n * ch * bytes);
  let o = 0;
  let seed = 12345;
  const tpdf = () => {
    // triangular dither for 16-bit
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const a = seed / 4294967296;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return a - seed / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const l = audio.left[i]!;
    const r = audio.right[i]!;
    const frame = ch === 1 ? [0.5 * (l + r)] : [l, r];
    for (const v of frame) {
      if (bits === 32) {
        data.writeFloatLE(v, o);
      } else if (bits === 24) {
        const s = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607)));
        data.writeIntLE(s, o, 3);
      } else {
        const s = Math.max(-32768, Math.min(32767, Math.round(v * 32767 + tpdf())));
        data.writeInt16LE(s, o);
      }
      o += bytes;
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(bits === 32 ? 3 : 1, 20);
  h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(audio.sampleRate, 24);
  h.writeUInt32LE(audio.sampleRate * ch * bytes, 28);
  h.writeUInt16LE(ch * bytes, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Write audio to a WAV file. */
export function writeWav(path: string, audio: AudioBuffer, options: WavOptions = {}): void {
  writeFileSync(path, encodeWav(audio, options));
}
