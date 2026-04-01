/**
 * Zero-dependency FFT-based spectral analysis for organ sound comparison.
 *
 * Features extracted:
 *   - mfccs[13]:   Mel-frequency cepstral coefficients C1–C13 (primary perceptual metric)
 *   - harmonics[8]: relative power at the first 8 harmonics of the dominant pitch
 *   - spectralCentroid: amplitude-weighted mean frequency (Hz)
 *   - brightness: fraction of total power above 2 kHz
 *   - attackRatio: ratio of 0–100ms energy vs 100–500ms energy (measures chiff / pipe speech)
 *   - spectralFlatness: Wiener entropy (0 = pure tone, 1 = white noise)
 *   - octaveBands[24]: 1/3-octave band energies (diagnostic / secondary metric)
 */

export interface SpectralProfile {
  harmonics: number[];          // [8] normalized to harmonics[0] = 1.0
  spectralCentroid: number;     // Hz
  brightness: number;           // fraction of power above 2 kHz
  attackRatio: number;          // 0–100ms RMS / 100–500ms RMS
  spectralFlatness: number;     // 0..1
  dominantFreq: number;         // Hz of strongest peak
  rms: number;                  // overall RMS
  octaveBands: number[];        // normalized 1/3-octave band powers (24 bands)
  mfccs: number[];              // 13 cepstral coefficients C1–C13 (C0/energy excluded)
}

export interface SpectralDiff {
  harmonicDist: number;       // L2 distance of normalized harmonic vectors
  centroidDiff: number;       // (synth - ref) Hz
  brightnessDiff: number;     // synth.brightness - ref.brightness
  attackDiff: number;         // synth.attackRatio - ref.attackRatio
  flatnessDiff: number;       // synth.flatness - ref.flatness
  octaveBandDist: number;     // L2 distance of normalized 1/3-octave spectral envelope
  mfccDist: number;           // Euclidean distance of MFCC C1–C13 vectors (primary metric)
  score: number;              // composite 0..1 (lower = more similar)
  synth: SpectralProfile;
  ref: SpectralProfile;
}

/** Normalize a Float32Array to a target RMS level. Returns a new Float32Array. */
export function normalizeRms(samples: Float32Array, targetRms = 0.1): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i]! ** 2;
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms < 1e-10) return samples.slice();
  const gain = targetRms / rms;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * gain;
  return out;
}

/** Compute normalized 1/3-octave band power (24 bands, ~50 Hz to 12 kHz). */
export function octaveBandEnvelope(power: Float64Array, sampleRate: number): number[] {
  const binHz = sampleRate / (power.length * 2);
  // 24 center frequencies from ~50 Hz to ~12.5 kHz (1/3-octave spacing = 2^(1/3))
  const centerFreqs: number[] = [];
  for (let i = 0; i < 24; i++) centerFreqs.push(50 * 2 ** (i / 3));

  const bands: number[] = centerFreqs.map(fc => {
    const lo = fc / 2 ** (1 / 6);
    const hi = fc * 2 ** (1 / 6);
    const loBin = Math.max(1, Math.floor(lo / binHz));
    const hiBin = Math.min(power.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    for (let b = loBin; b <= hiBin; b++) sum += power[b]!;
    return sum;
  });

  // Normalize to sum = 1
  const total = bands.reduce((s, v) => s + v, 0) || 1;
  return bands.map(b => b / total);
}

// ── MFCC parameters (HTK standard) ────────────────────────────────────────────
const MEL_NUM_FILTERS = 26;
const MEL_NUM_COEFFS  = 13;   // C1–C13
const MEL_LOW_HZ      = 80;
const MEL_HIGH_HZ     = 8000;

/** Standard HTK mel scale: linear below 1 kHz, logarithmic above. */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

/** Build sparse mel filterbank: returns start/center/end bin index for each of the 26 filters. */
function buildMelFilterbank(
  fftSize: number,
  sampleRate: number,
): Array<{ start: number; center: number; end: number }> {
  const lowMel  = hzToMel(MEL_LOW_HZ);
  const highMel = hzToMel(MEL_HIGH_HZ);
  const melPoints = Array.from({ length: MEL_NUM_FILTERS + 2 }, (_, i) =>
    lowMel + (i / (MEL_NUM_FILTERS + 1)) * (highMel - lowMel)
  );
  const binHz = sampleRate / fftSize;
  const bins = melPoints.map(m => Math.round(melToHz(m) / binHz));
  return Array.from({ length: MEL_NUM_FILTERS }, (_, m) => ({
    start:  bins[m]!,
    center: bins[m + 1]!,
    end:    bins[m + 2]!,
  }));
}

/**
 * Compute 13 MFCC coefficients (C1–C13, C0/energy excluded) from an averaged
 * power spectrum. Input is the same `avgPower` Float64Array already computed
 * in analyzeSpectrum (length = FFT_SIZE/2 = 2048 at 48 kHz).
 */
export function computeMFCCs(power: Float64Array, sampleRate: number): number[] {
  const filters = buildMelFilterbank(power.length * 2, sampleRate);
  const maxBin = power.length - 1;

  // Apply triangular mel filters → log filterbank energies
  const logEnergy = new Float64Array(MEL_NUM_FILTERS);
  for (let m = 0; m < MEL_NUM_FILTERS; m++) {
    const { start, center, end } = filters[m]!;
    let energy = 0;
    if (center > start) {
      for (let b = Math.max(start, 0); b < center; b++) {
        energy += (power[Math.min(b, maxBin)] ?? 0) * (b - start) / (center - start);
      }
    }
    if (end > center) {
      for (let b = center; b <= Math.min(end, maxBin); b++) {
        energy += (power[b] ?? 0) * (end - b) / (end - center);
      }
    } else {
      energy += power[Math.min(center, maxBin)] ?? 0;
    }
    logEnergy[m] = Math.log(Math.max(energy, 1e-20));
  }

  // DCT-II to cepstral coefficients — skip C0 (k=0), return C1–C13
  const mfccs: number[] = [];
  for (let k = 1; k <= MEL_NUM_COEFFS; k++) {
    let sum = 0;
    for (let m = 0; m < MEL_NUM_FILTERS; m++) {
      sum += logEnergy[m]! * Math.cos((Math.PI * k * (m + 0.5)) / MEL_NUM_FILTERS);
    }
    mfccs.push(sum);
  }
  return mfccs;
}

// ── Radix-2 Cooley-Tukey FFT ──────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        const vRe = re[i + k + len / 2]! * curRe - im[i + k + len / 2]! * curIm;
        const vIm = re[i + k + len / 2]! * curIm + im[i + k + len / 2]! * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }
}

// ── Power spectrum from a window of samples ───────────────────────────────────

const FFT_SIZE = 4096;

function powerSpectrum(samples: Float32Array, offset: number, count: number): Float64Array {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const n = Math.min(count, FFT_SIZE);
  // Hann window
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (samples[offset + i] ?? 0) * w;
  }
  fft(re, im);
  const power = new Float64Array(FFT_SIZE / 2);
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    power[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  }
  return power;
}

// ── Main analysis function ─────────────────────────────────────────────────────

export function analyzeSpectrum(
  samples: Float32Array,
  sampleRate: number,
  windowStartSec = 0,
  windowDurSec = 10,
): SpectralProfile {
  const startSample = Math.floor(windowStartSec * sampleRate);
  const windowSamples = Math.floor(windowDurSec * sampleRate);

  // Average multiple overlapping 4096-point FFT windows for smoother spectrum
  const numFrames = Math.floor(windowSamples / (FFT_SIZE / 2));
  const avgPower = new Float64Array(FFT_SIZE / 2);
  let framesUsed = 0;

  for (let f = 0; f < numFrames; f++) {
    const offset = startSample + f * (FFT_SIZE / 2);
    if (offset + FFT_SIZE > samples.length) break;
    const p = powerSpectrum(samples, offset, FFT_SIZE);
    for (let i = 0; i < avgPower.length; i++) avgPower[i]! += p[i]!;
    framesUsed++;
  }
  if (framesUsed === 0) {
    // fallback: use whatever we have
    const p = powerSpectrum(samples, startSample, Math.min(FFT_SIZE, samples.length - startSample));
    for (let i = 0; i < avgPower.length; i++) avgPower[i] = p[i]!;
    framesUsed = 1;
  }
  for (let i = 0; i < avgPower.length; i++) avgPower[i]! /= framesUsed;

  const binHz = sampleRate / FFT_SIZE;

  // Find dominant frequency (peak in 50-2000 Hz range, ignoring DC)
  const minBin = Math.ceil(50 / binHz);
  const maxBin = Math.floor(2000 / binHz);
  let peakBin = minBin;
  for (let i = minBin + 1; i <= maxBin; i++) {
    if ((avgPower[i] ?? 0) > (avgPower[peakBin] ?? 0)) peakBin = i;
  }
  const dominantFreq = peakBin * binHz;

  // Extract harmonic power ratios (8 harmonics of dominant frequency)
  const harmonics: number[] = [];
  for (let h = 1; h <= 8; h++) {
    const hFreq = dominantFreq * h;
    const hBin = Math.round(hFreq / binHz);
    // Sum ±2 bins for robustness
    let power = 0;
    for (let d = -2; d <= 2; d++) {
      const b = hBin + d;
      if (b >= 0 && b < avgPower.length) power += avgPower[b]!;
    }
    harmonics.push(power);
  }
  // Normalize to fundamental = 1.0
  const h1 = harmonics[0] ?? 1;
  const normalizedHarmonics = harmonics.map(h => (h1 > 0 ? h / h1 : 0));

  // Spectral centroid
  let weightedSum = 0;
  let totalPower = 0;
  for (let i = 1; i < avgPower.length; i++) {
    const freq = i * binHz;
    weightedSum += freq * (avgPower[i] ?? 0);
    totalPower += avgPower[i] ?? 0;
  }
  const spectralCentroid = totalPower > 0 ? weightedSum / totalPower : 0;

  // Brightness: fraction of power above 2 kHz
  const cutoffBin = Math.ceil(2000 / binHz);
  let highPower = 0;
  for (let i = cutoffBin; i < avgPower.length; i++) highPower += avgPower[i]!;
  const brightness = totalPower > 0 ? highPower / totalPower : 0;

  // Spectral flatness (geometric mean / arithmetic mean of power spectrum)
  let logSum = 0;
  let arithSum = 0;
  const numBins = avgPower.length;
  for (let i = 1; i < numBins; i++) {
    const p = Math.max(avgPower[i]!, 1e-20);
    logSum += Math.log(p);
    arithSum += p;
  }
  const geomMean = Math.exp(logSum / (numBins - 1));
  const arithMean = arithSum / (numBins - 1);
  const spectralFlatness = arithMean > 0 ? Math.min(1, geomMean / arithMean) : 0;

  // Attack ratio: energy in first 100ms vs next 400ms
  const attack100 = Math.floor(0.1 * sampleRate);
  const attack500 = Math.floor(0.5 * sampleRate);
  let e0_100 = 0, e100_500 = 0;
  for (let i = startSample; i < Math.min(startSample + attack100, samples.length); i++) {
    e0_100 += (samples[i] ?? 0) ** 2;
  }
  for (let i = startSample + attack100; i < Math.min(startSample + attack500, samples.length); i++) {
    e100_500 += (samples[i] ?? 0) ** 2;
  }
  const attackRatio = e100_500 > 0 ? e0_100 / e100_500 : 0;

  // Overall RMS
  let sumSq = 0;
  for (let i = startSample; i < Math.min(startSample + windowSamples, samples.length); i++) {
    sumSq += (samples[i] ?? 0) ** 2;
  }
  const rms = Math.sqrt(sumSq / windowSamples);

  // 1/3-octave spectral envelope (secondary diagnostic metric)
  const octaveBands = octaveBandEnvelope(avgPower, sampleRate);

  // MFCC — primary perceptual metric
  const mfccs = computeMFCCs(avgPower, sampleRate);

  return {
    harmonics: normalizedHarmonics,
    spectralCentroid,
    brightness,
    attackRatio,
    spectralFlatness,
    dominantFreq,
    rms,
    octaveBands,
    mfccs,
  };
}

// ── Profile comparison ─────────────────────────────────────────────────────────

/**
 * Target for MFCC distance normalization.
 * Calibrated so score ≈ 1.0 when mfccDist ≈ 12 (clearly different timbres)
 * and score ≈ 0.06 when mfccDist ≈ 1.1 (near-identical timbres).
 * Adjust after first run based on observed mfccDist values.
 */
// Calibrated to iter-51 baseline (mfccDist=7.58). At TARGET=12: current≈0.50,
// a "convincing" match (mfccDist≈3) would score ≈0.22. Adjust after each phase.
const MFCC_TARGET = 12.0;

export function compareProfiles(synth: SpectralProfile, ref: SpectralProfile): SpectralDiff {
  // L2 distance of normalized harmonic vectors
  let harmonicDistSq = 0;
  for (let i = 0; i < Math.min(synth.harmonics.length, ref.harmonics.length); i++) {
    const diff = (synth.harmonics[i] ?? 0) - (ref.harmonics[i] ?? 0);
    harmonicDistSq += diff * diff;
  }
  const harmonicDist = Math.sqrt(harmonicDistSq / synth.harmonics.length);

  // 1/3-octave envelope L2 distance (secondary/diagnostic)
  let octaveDistSq = 0;
  const nBands = Math.min(synth.octaveBands.length, ref.octaveBands.length);
  for (let i = 0; i < nBands; i++) {
    const diff = (synth.octaveBands[i] ?? 0) - (ref.octaveBands[i] ?? 0);
    octaveDistSq += diff * diff;
  }
  const octaveBandDist = Math.sqrt(octaveDistSq / nBands);

  // MFCC Euclidean distance C1–C13 (primary perceptual metric)
  let mfccDistSq = 0;
  const nMfcc = Math.min(synth.mfccs.length, ref.mfccs.length);
  for (let i = 0; i < nMfcc; i++) {
    const d = (synth.mfccs[i] ?? 0) - (ref.mfccs[i] ?? 0);
    mfccDistSq += d * d;
  }
  const mfccDist = Math.sqrt(mfccDistSq);

  const centroidDiff = synth.spectralCentroid - ref.spectralCentroid;
  const brightnessDiff = synth.brightness - ref.brightness;
  const attackDiff = synth.attackRatio - ref.attackRatio;
  const flatnessDiff = synth.spectralFlatness - ref.spectralFlatness;

  // Composite score — MFCC is the primary perceptual metric (0.65 weight).
  // 1/3-octave dist kept as secondary (0.15) for spectral envelope shape.
  // Centroid and attack as tie-breakers (0.10 each).
  const score = Math.min(1,
    0.65 * Math.min(1, mfccDist / MFCC_TARGET) +
    0.15 * Math.min(1, octaveBandDist / 0.06) +
    0.10 * Math.min(1, Math.abs(centroidDiff) / 3000) +
    0.10 * Math.min(1, Math.abs(attackDiff) / 1.0),
  );

  return { harmonicDist, centroidDiff, brightnessDiff, attackDiff, flatnessDiff, octaveBandDist, mfccDist, score, synth, ref };
}
