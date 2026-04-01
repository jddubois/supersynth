/**
 * Write a Float32Array of mono PCM samples to a 16-bit PCM WAV file.
 */
import { writeFileSync, readFileSync } from 'node:fs';

export function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const numSamples = samples.length;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  const buf = Buffer.allocUnsafe(44 + dataSize);
  let off = 0;

  // RIFF header
  buf.write('RIFF', off); off += 4;
  buf.writeUInt32LE(fileSize, off); off += 4;
  buf.write('WAVE', off); off += 4;

  // fmt chunk
  buf.write('fmt ', off); off += 4;
  buf.writeUInt32LE(16, off); off += 4;         // chunk size
  buf.writeUInt16LE(1, off); off += 2;           // PCM format
  buf.writeUInt16LE(numChannels, off); off += 2;
  buf.writeUInt32LE(sampleRate, off); off += 4;
  buf.writeUInt32LE(byteRate, off); off += 4;
  buf.writeUInt16LE(blockAlign, off); off += 2;
  buf.writeUInt16LE(bitsPerSample, off); off += 2;

  // data chunk
  buf.write('data', off); off += 4;
  buf.writeUInt32LE(dataSize, off); off += 4;

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    buf.writeInt16LE(Math.round(int16), off);
    off += 2;
  }

  writeFileSync(path, buf);
}

/** Read a 16-bit PCM WAV file back into a Float32Array. */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = Buffer.from(readFileSync(path));
  const sampleRate = buf.readUInt32LE(24);
  const numChannels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);

  // Find data chunk (skip non-standard chunks)
  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const tag = buf.toString('ascii', dataOffset, dataOffset + 4);
    const size = buf.readUInt32LE(dataOffset + 4);
    if (tag === 'data') { dataOffset += 8; break; }
    dataOffset += 8 + size;
  }

  const numSamples = Math.floor((buf.length - dataOffset) / (bitsPerSample / 8)) / numChannels;
  const samples = new Float32Array(numSamples);

  if (bitsPerSample === 16) {
    for (let i = 0; i < numSamples; i++) {
      const int16 = buf.readInt16LE(dataOffset + i * numChannels * 2);
      samples[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < numSamples; i++) {
      samples[i] = buf.readFloatLE(dataOffset + i * numChannels * 4);
    }
  }

  return { samples, sampleRate };
}
