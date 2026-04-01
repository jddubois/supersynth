/**
 * Analyze and compare supersynth organ output against a reference recording.
 *
 * Usage:
 *   node --import tsx scripts/analyze-comparison.ts \
 *     --midi http://www.jsbach.net/midi/bwv539.mid \
 *     --reference "~/Downloads/Preludes and Fugues/BWV0539i.m4a" \
 *     [--preset principal] [--iter 0] [--out data/rendered/iter-0.wav]
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { renderMidiOffline, getMidiDurationSec } from './render-offline.ts';
import { writeWav } from './write-wav.ts';
import { decodeAudioFile } from './decode-audio.ts';
import { analyzeSpectrum, compareProfiles, normalizeRms } from './spectral.ts';
import type { SynthConfig } from '../src/types.ts';

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

const midiArg = arg('midi', 'http://www.jsbach.net/midi/bwv539.mid')!;
const referenceArg = arg('reference')!;
const presetName = arg('preset', 'principal')!;
const iterStr = arg('iter', '0')!;
const iter = parseInt(iterStr, 10);
const outWav = arg('out', `data/rendered/iter-${iter}.wav`)!;

if (!referenceArg) {
  console.error('Usage: --reference <path-to-m4a>');
  process.exit(1);
}

// ── MIDI download helper ──────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(dirname(dest), { recursive: true });
    const file = createWriteStream(dest);
    const getter = url.startsWith('https') ? httpsGet : httpGet;
    getter(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFile(res.headers.location!, dest).then(resolve, reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function resolveMidi(midiArg: string): Promise<string> {
  if (midiArg.startsWith('http://') || midiArg.startsWith('https://')) {
    const filename = midiArg.split('/').at(-1) ?? 'piece.mid';
    const dest = join('data/midi', filename);
    if (!existsSync(dest)) {
      console.log(`Downloading MIDI: ${midiArg}`);
      await downloadFile(midiArg, dest);
      console.log(`Saved: ${dest}`);
    }
    return dest;
  }
  const expanded = midiArg.startsWith('~')
    ? join(process.env.HOME ?? '', midiArg.slice(2))
    : midiArg;
  if (!existsSync(expanded)) throw new Error(`MIDI file not found: ${expanded}`);
  return expanded;
}

// ── Synth config used for comparison ──────────────────────────────────────────

const synthConfig: Partial<SynthConfig> = {
  // No leslie — would smear spectrum and complicate comparison
  // Reverb settings match render-offline.ts tuned defaults (iter-44 best).
  reverb: { roomSize: 0.87, damping: 0.40, wet: 0.38, dry: 0.65, preDelayMs: 30 },
  keyClickIntensity: 0.12,
  masterVolume: 0.5,
};

// ── Main ──────────────────────────────────────────────────────────────────────

const midiPath = await resolveMidi(midiArg);
console.log(`\nMIDI: ${midiPath}`);
console.log(`Reference: ${referenceArg}`);
console.log(`Preset: ${presetName}  |  Iteration: ${iter}\n`);

// Decode reference recording first so we can compute tempoScale
console.log('Decoding reference audio...');
const refSamples = await decodeAudioFile(referenceArg, 48000);
const refDurSec = refSamples.length / 48000;
console.log(`  Reference duration: ${refDurSec.toFixed(1)}s`);

// Compute tempo scale: speed up MIDI render to match reference duration.
// tempoScale > 1 means faster playback (divides microsecondsPerBeat by scale).
const midiNaturalDurSec = getMidiDurationSec(midiPath);
const tempoScale = midiNaturalDurSec / refDurSec;
console.log(`  MIDI natural duration: ${midiNaturalDurSec.toFixed(1)}s  →  tempoScale: ${tempoScale.toFixed(4)}`);

// Render synth offline
console.log('\nRendering synth offline...');
const t0 = Date.now();
const synthSamples = renderMidiOffline({
  midiPath,
  synthConfig,
  presetName,
  // Left-hand bass voice (Track 2, median A3=57) uses flute (8'+4', no sine mixture)
  // at full volume. The 4' flute restores 200-400 Hz energy from Track 2's mid notes,
  // and there's no 16' adding unwanted sub-octave from higher notes.
  manualBassPreset: 'principal',
  manualBassThreshold: 64,
  sampleRate: 48000,
  tailSec: 5,
  tempoScale,
});
console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${(synthSamples.length / 48000).toFixed(1)}s of audio`);

// Save render to WAV
mkdirSync(dirname(outWav), { recursive: true });
writeWav(outWav, synthSamples, 48000);
console.log(`  Saved: ${outWav}`);

// Analyze multiple windows spread across each recording and average the spectral
// profiles. This is more robust than a single window: it averages out passage-specific
// variation (e.g. bass-heavy ritardandos) so the comparison reflects overall timbral
// character rather than one musical moment.
const analysisDurSec = 12;
const synthDurSec = synthSamples.length / 48000;
// Windows at 15%, 30%, 45%, 60% of each recording
const windowFractions = [0.15, 0.30, 0.45, 0.60];

// Normalize both signals to the same RMS before spectral comparison
const synthNorm = normalizeRms(synthSamples);
const refNorm = normalizeRms(refSamples);

console.log(`\nAnalyzing spectra (${windowFractions.length} windows × ${analysisDurSec}s, RMS-normalized)...`);
windowFractions.forEach(f => {
  const ss = (synthDurSec * f).toFixed(1);
  const rs = (refDurSec * f).toFixed(1);
  console.log(`  synth: ${ss}s–${(parseFloat(ss)+analysisDurSec).toFixed(1)}s  ref: ${rs}s–${(parseFloat(rs)+analysisDurSec).toFixed(1)}s`);
});

// Analyze each window and average the 1/3-octave band energies
function avgProfiles(samples: Float32Array, durSec: number, windowFrac: number[]): import('./spectral.ts').SpectralProfile {
  const profiles = windowFrac.map(f => analyzeSpectrum(samples, 48000, durSec * f, analysisDurSec));
  // Average all band/coefficient arrays
  const nBands = profiles[0]!.octaveBands.length;
  const nHarm = profiles[0]!.harmonics.length;
  const nMfcc = profiles[0]!.mfccs.length;
  const avgOctaveBands = Array.from({ length: nBands }, (_, i) =>
    profiles.reduce((s, p) => s + (p.octaveBands[i] ?? 0), 0) / profiles.length
  );
  const avgHarmonics = Array.from({ length: nHarm }, (_, i) =>
    profiles.reduce((s, p) => s + (p.harmonics[i] ?? 0), 0) / profiles.length
  );
  const avgMfccs = Array.from({ length: nMfcc }, (_, i) =>
    profiles.reduce((s, p) => s + (p.mfccs[i] ?? 0), 0) / profiles.length
  );
  // Use the median window's scalar metrics
  const mid = profiles[Math.floor(profiles.length / 2)]!;
  return {
    ...mid,
    octaveBands: avgOctaveBands,
    harmonics: avgHarmonics,
    mfccs: avgMfccs,
  };
}

const synthProfile = avgProfiles(synthNorm, synthDurSec, windowFractions);
const refProfile = avgProfiles(refNorm, refDurSec, windowFractions);
const diff = compareProfiles(synthProfile, refProfile);

// ── Print human-readable report ───────────────────────────────────────────────

const arrow = (v: number) => v > 0.02 ? '← too high' : v < -0.02 ? '← too low' : '✓ ok';
const hz = (v: number) => `${v.toFixed(0)} Hz`;

console.log('\n' + '='.repeat(60));
console.log(`SPECTRAL COMPARISON  (iteration ${iter})`);
console.log('='.repeat(60));
console.log(`Overall score: ${diff.score.toFixed(4)}  (0 = identical, 1 = completely different)\n`);

console.log('Harmonic power ratios (synth vs reference):');
for (let i = 0; i < 8; i++) {
  const s = (synthProfile.harmonics[i] ?? 0).toFixed(3);
  const r = (refProfile.harmonics[i] ?? 0).toFixed(3);
  const d = ((synthProfile.harmonics[i] ?? 0) - (refProfile.harmonics[i] ?? 0));
  const tag = Math.abs(d) > 0.05 ? ` ← diff ${d > 0 ? '+' : ''}${d.toFixed(3)}` : '';
  console.log(`  H${i + 1}: ${s}  vs  ${r}${tag}`);
}

console.log(`\nDominant freq:     synth=${hz(synthProfile.dominantFreq)}  ref=${hz(refProfile.dominantFreq)}`);
console.log(`Spectral centroid: synth=${hz(synthProfile.spectralCentroid)}  ref=${hz(refProfile.spectralCentroid)}  diff=${diff.centroidDiff > 0 ? '+' : ''}${diff.centroidDiff.toFixed(0)} Hz`);
console.log(`Brightness (>2kHz): synth=${(synthProfile.brightness * 100).toFixed(1)}%  ref=${(refProfile.brightness * 100).toFixed(1)}%  diff=${diff.brightnessDiff > 0 ? '+' : ''}${(diff.brightnessDiff * 100).toFixed(1)}%`);
console.log(`Attack ratio:       synth=${synthProfile.attackRatio.toFixed(3)}  ref=${refProfile.attackRatio.toFixed(3)}  diff=${diff.attackDiff > 0 ? '+' : ''}${diff.attackDiff.toFixed(3)}`);
console.log(`MFCC dist (C1-13):  ${diff.mfccDist.toFixed(4)}  target≈${(12.0).toFixed(1)}  (primary perceptual metric)`);
console.log(`1/3-oct envelope:   dist=${diff.octaveBandDist.toFixed(4)}  (secondary/diagnostic)`);
console.log(`RMS before norm:    synth=${synthProfile.rms.toFixed(4)}  ref=${refProfile.rms.toFixed(4)}`);

// Show 1/3-octave diff by band (highlight significant differences)
const centerFreqs = Array.from({ length: 24 }, (_, i) => 50 * 2 ** (i / 3));
console.log('\n1/3-octave band diff (synth - ref), normalized energy:');
for (let i = 0; i < 24; i++) {
  const s = synthProfile.octaveBands[i] ?? 0;
  const r = refProfile.octaveBands[i] ?? 0;
  const d = s - r;
  const bar = d > 0 ? '+'.repeat(Math.min(20, Math.round(d * 200))) : '-'.repeat(Math.min(20, Math.round(-d * 200)));
  const flag = Math.abs(d) > 0.005 ? ' ◄' : '';
  console.log(`  ${centerFreqs[i]!.toFixed(0).padStart(5)} Hz: ${bar.padEnd(22)} (s=${s.toFixed(4)} r=${r.toFixed(4)})${flag}`);
}

// Diagnostics
console.log('\nDiagnosis:');
if (diff.centroidDiff > 300) console.log('  • Synth is too bright — upper harmonics or high stops too loud');
if (diff.centroidDiff < -300) console.log('  • Synth is too dull — needs more upper partial energy');
if (diff.brightnessDiff > 0.05) console.log('  • Too much high-frequency energy (>2kHz) — reduce upper stops or use warmer waveforms');
if (diff.brightnessDiff < -0.05) console.log('  • Not enough high-frequency energy — add upper stops or brighter waveforms');
if (diff.attackDiff < -0.1) console.log('  • Needs more chiff/pipe speech — increase chiffIntensity, chiffDuration');
if (diff.attackDiff > 0.1) console.log('  • Chiff too prominent — decrease chiffIntensity');
for (let i = 1; i < 8; i++) {
  const d = (synthProfile.harmonics[i] ?? 0) - (refProfile.harmonics[i] ?? 0);
  if (d > 0.1) console.log(`  • H${i + 1} too strong by ${d.toFixed(3)} — reduce amplitude of rank at harmonic ${i + 1}`);
  if (d < -0.1) console.log(`  • H${i + 1} too weak by ${Math.abs(d).toFixed(3)} — increase amplitude of rank at harmonic ${i + 1}`);
}
if (diff.score < 0.06) {
  console.log('\n  ✓ CONVERGED — score below 0.06 threshold!');
}
console.log('='.repeat(60));

// Save JSON output
const analysisOut = `data/analysis/iter-${iter}.json`;
mkdirSync('data/analysis', { recursive: true });
writeFileSync(analysisOut, JSON.stringify({ iter, score: diff.score, diff, synthProfile, refProfile }, null, 2));
console.log(`\nJSON saved: ${analysisOut}`);
