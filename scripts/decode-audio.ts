/**
 * Decode M4A / MP3 / WAV audio files to mono Float32Array PCM.
 * Uses macOS afconvert (built-in) with ffmpeg as fallback.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { readWav } from './write-wav.ts';

export async function decodeAudioFile(
  inputPath: string,
  targetSampleRate = 48000,
): Promise<Float32Array> {
  const expanded = inputPath.startsWith('~')
    ? join(process.env.HOME ?? '/tmp', inputPath.slice(2))
    : inputPath;

  if (!existsSync(expanded)) {
    throw new Error(`Audio file not found: ${expanded}`);
  }

  const tmpDir = join(tmpdir(), 'supersynth-decode');
  mkdirSync(tmpDir, { recursive: true });
  const outWav = join(tmpDir, basename(expanded).replace(/\.[^.]+$/, '.wav'));

  // Try afconvert (macOS built-in)
  try {
    execSync(
      `afconvert -f WAVE -d LEI16@${targetSampleRate} "${expanded}" "${outWav}"`,
      { stdio: 'pipe' },
    );
  } catch {
    // Fallback to ffmpeg
    try {
      execSync(
        `ffmpeg -y -i "${expanded}" -ac 1 -ar ${targetSampleRate} -f wav "${outWav}"`,
        { stdio: 'pipe' },
      );
    } catch (e) {
      throw new Error(`Failed to decode audio file. Install ffmpeg or use macOS. Error: ${e}`);
    }
  }

  const { samples } = readWav(outWav);
  return samples;
}
