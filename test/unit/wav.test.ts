import { SupersynthError } from '../../src/errors.js';
import { encodeWav, makeAudioBuffer, type WavOptions } from '../../src/wav.js';

/** The chunks of a RIFF/WAVE file, checking the layout on the way. */
function chunks(buf: Buffer): Record<string, Buffer> {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  const out: Record<string, Buffer> = {};
  let p = 12;
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const len = buf.readUInt32LE(p + 4);
    out[id] = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1); // chunks are padded to even sizes
  }
  expect(p).toBe(buf.length);
  return out;
}

function fmt(c: Buffer) {
  return {
    format: c.readUInt16LE(0),
    channels: c.readUInt16LE(2),
    sampleRate: c.readUInt32LE(4),
    byteRate: c.readUInt32LE(8),
    blockAlign: c.readUInt16LE(12),
    bits: c.readUInt16LE(14),
    ...(c.length >= 18 ? { cbSize: c.readUInt16LE(16) } : {}),
  };
}

const audio = (left: number[], right = left) => makeAudioBuffer(48000, Float32Array.from(left), Float32Array.from(right));
const encode = (a: ReturnType<typeof audio>, o: WavOptions = {}) => chunks(encodeWav(a, o));

describe('WAV encoding', () => {
  test.each([
    [16, false, 1, 16],
    [16, true, 1, 16],
    [24, false, 1, 16],
    [24, true, 1, 16],
    [32, false, 3, 18],
    [32, true, 3, 18],
  ] as const)('%i bits, mono %s: header fields', (bits, mono, format, fmtLen) => {
    const c = encode(audio([0, 0.1, -0.1, 0.5, 1]), { bitDepth: bits, mono });
    const ch = mono ? 1 : 2;
    const bytes = bits / 8;
    expect(c['fmt ']!.length).toBe(fmtLen);
    expect(fmt(c['fmt ']!)).toEqual({
      format, channels: ch, sampleRate: 48000, byteRate: 48000 * ch * bytes, blockAlign: ch * bytes, bits,
      ...(fmtLen === 18 ? { cbSize: 0 } : {}),
    });
    expect(c.data!.length).toBe(5 * ch * bytes);
    if (bits === 32) expect(c.fact!.readUInt32LE(0)).toBe(5);
    else expect(c.fact).toBeUndefined();
  });

  test('16-bit: digital silence stays exactly 0 (dithered or not)', () => {
    for (const dither of [true, false]) {
      const d = encode(audio(new Array(1000).fill(0)), { dither }).data!;
      expect(d.every((b) => b === 0)).toBe(true);
    }
  });

  test('16-bit: dither is TPDF (at most ±1 LSB) and can be turned off', () => {
    const x = new Array(1000).fill(0.25);
    const exact = Math.round(0.25 * 32767);
    const plain = encode(audio(x), { dither: false }).data!;
    for (let i = 0; i < plain.length; i += 2) expect(plain.readInt16LE(i)).toBe(exact);
    const dithered = encode(audio(x)).data!;
    const values = new Set<number>();
    for (let i = 0; i < dithered.length; i += 2) values.add(dithered.readInt16LE(i) - exact);
    expect([...values].every((v) => Math.abs(v) <= 1)).toBe(true);
    expect(values.size).toBeGreaterThan(1);
  });

  test('integer samples are clipped to full scale; NaN is written as 0', () => {
    const c16 = encode(audio([2, -2, 1, -1, NaN]), { dither: false, mono: true }).data!;
    expect([0, 2, 4, 6, 8].map((i) => c16.readInt16LE(i))).toEqual([32767, -32768, 32767, -32767, 0]);
    const c24 = encode(audio([2, -2, 0.5, -1]), { bitDepth: 24, mono: true }).data!;
    expect([0, 3, 6, 9].map((i) => c24.readIntLE(i, 3))).toEqual([8388607, -8388608, 4194304, -8388607]);
  });

  test('32-bit float keeps the values as they are', () => {
    const d = encode(audio([0.5, -0.25, 1.5], [0, 0, 0]), { bitDepth: 32 }).data!;
    expect([0, 4, 8, 12, 16, 20].map((i) => d.readFloatLE(i))).toEqual([0.5, 0, -0.25, 0, 1.5, 0]);
  });

  test('mono is the average of both channels', () => {
    const d = encode(audio([0.5, 1], [0, -1]), { bitDepth: 32, mono: true }).data!;
    expect([d.readFloatLE(0), d.readFloatLE(4)]).toEqual([0.25, 0]);
  });

  test('odd-sized data gets a pad byte', () => {
    const buf = encodeWav(audio([0.1, 0.2, 0.3]), { bitDepth: 24, mono: true });
    expect(buf.length).toBe(44 + 9 + 1);
    expect(buf[buf.length - 1]).toBe(0);
    expect(chunks(buf).data!.length).toBe(9);
  });

  test('an unknown bit depth throws', () => {
    expect(() => encodeWav(audio([0]), { bitDepth: 8 as never })).toThrow(SupersynthError);
  });

  test('audio too long for a WAV file, and a bad sample rate, are refused', () => {
    const huge = { length: 2 ** 30 } as unknown as Float32Array; // 4 GiB as 16-bit stereo
    expect(() => encodeWav({ sampleRate: 48000, left: huge, right: huge, duration: 0 })).toThrow(/too long/);
    const one = new Float32Array(1);
    expect(() => encodeWav({ sampleRate: 0, left: one, right: one, duration: 0 })).toThrow(/sampleRate/);
    expect(() => encodeWav({ sampleRate: 44100.5, left: one, right: one, duration: 0 })).toThrow(/sampleRate/);
  });
});
