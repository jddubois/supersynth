import type { InstrumentParams, ReverbPreset } from '../params.js';

export type InstrumentFamily = 'keyboard' | 'organ' | 'strings' | 'woodwind' | 'brass' | 'percussion';

/** One sound layer: a spectral model played at an offset, optionally over a key range. */
export interface LayerDef {
  /** Model id (file `models/<model>.ssm`). */
  model: string;
  /** Semitones. @default 0 */
  transpose?: number;
  /** dB. @default 0 */
  gain?: number;
  /** -1 … 1. @default 0 */
  pan?: number;
  /** Lowest MIDI key that plays this layer. */
  keyLow?: number;
  /** Highest MIDI key that plays this layer. */
  keyHigh?: number;
  /** Cents. @default 0 */
  detune?: number;
  /** `'release'`: sounds when the key is released (damper / jack noise). */
  trigger?: 'release';
}

/** A preset: parameters (and optionally layers) applied together. */
export interface PresetDef {
  description?: string;
  params?: InstrumentParams;
  /** Replace the instrument's layers. */
  layers?: LayerDef[];
  /** Suggested room for this sound. */
  reverb?: ReverbPreset;
}

export interface InstrumentDef {
  id: string;
  name: string;
  family: InstrumentFamily;
  description: string;
  layers: LayerDef[];
  /** Playable range (MIDI) the recordings cover. */
  range: [number, number];
  /** Suggested room. */
  reverb: ReverbPreset;
  params?: InstrumentParams;
  presets: Record<string, PresetDef>;
  aliases?: string[];
}

/** A single layer playing one model. */
export const one = (model: string): LayerDef[] => [{ model }];

/** Common, always-legit tweaks shared by many instruments. */
export const ROOMS = {
  dry: { description: 'Close-miked, almost no room', params: { reverbSend: 0.03 } },
  hall: { description: 'In a concert hall', params: { reverbSend: 0.3 }, reverb: 'concert-hall' as const },
};
