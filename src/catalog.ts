import type { InstrumentParams, ReverbPreset } from './params.js';

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

export interface PresetDef {
  description: string;
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

const one = (model: string): LayerDef[] => [{ model }];

/** Common, always-legit tweaks shared by many instruments. */
const ROOMS = {
  dry: { description: 'Close-miked, almost no room', params: { reverbSend: 0.03 } },
  hall: { description: 'In a concert hall', params: { reverbSend: 0.3 }, reverb: 'concert-hall' as const },
};

export const INSTRUMENTS: InstrumentDef[] = [
  // ── keyboards ───────────────────────────────────────────────────────────────
  {
    id: 'grand-piano',
    name: 'Concert Grand Piano',
    family: 'keyboard',
    description: 'Steinway model B, three dynamic layers, with real hammer attacks, string stiffness, damper and sympathetic resonances.',
    layers: [{ model: 'grand-piano' }, { model: 'grand-piano-release', trigger: 'release' }],
    range: [21, 108],
    reverb: 'hall',
    aliases: ['piano', 'grand', 'steinway'],
    presets: {
      default: { description: 'As recorded' },
      bright: { description: 'Harder hammers, pop/rock piano', params: { brightness: 1.2, eqHighGain: 2, eqHighFreq: 5000 } },
      mellow: { description: 'Soft hammers, warm and dark', params: { brightness: -1.6, noise: -3 } },
      felt: { description: 'Felt-muffled "una corda" intimate piano', params: { brightness: -4, noise: -8, attack: 1.4, velocitySensitivity: 0.75, reverbSend: 0.12 } },
      concert: { description: 'Concert hall perspective', params: { reverbSend: 0.28, spread: 0.45 }, reverb: 'concert-hall' },
      studio: { description: 'Close studio miking', params: { reverbSend: 0.05, spread: 0.5 }, reverb: 'studio' },
      'honky-tonk': {
        description: 'Detuned saloon piano (two mistuned strings)',
        layers: [
          { model: 'grand-piano', detune: -11, gain: -3, pan: -0.15 }, { model: 'grand-piano', detune: 9, gain: -3, pan: 0.15 },
          { model: 'grand-piano-release', trigger: 'release' },
        ],
        params: { brightness: 0.6, reverbSend: 0.08 },
        reverb: 'room',
      },
      'long-sustain': { description: 'Longer ringing notes', params: { decay: 1.6, release: 1.5 } },
    },
  },
  {
    id: 'upright-piano',
    name: 'Upright Piano',
    family: 'keyboard',
    description: 'Yamaha upright: intimate, a little brighter and boxier than the grand.',
    layers: [{ model: 'upright-piano' }, { model: 'upright-piano-release', trigger: 'release' }],
    range: [21, 108],
    reverb: 'room',
    aliases: ['upright'],
    presets: {
      default: { description: 'As recorded' },
      vintage: { description: 'Older instrument: duller, slightly out of tune', params: { brightness: -1.2, humanize: 5 } },
      'honky-tonk': {
        description: 'Bar-room detuned upright',
        layers: [
          { model: 'upright-piano', detune: -12, gain: -3 }, { model: 'upright-piano', detune: 10, gain: -3 },
          { model: 'upright-piano-release', trigger: 'release' },
        ],
        params: { brightness: 0.8 },
      },
      dry: ROOMS.dry,
    },
  },
  {
    id: 'harpsichord',
    name: 'Harpsichord',
    family: 'keyboard',
    description: 'French double-manual harpsichord, plucked attack transients from the real instrument.',
    layers: [{ model: 'harpsichord' }, { model: 'harpsichord-release', trigger: 'release' }],
    range: [29, 89],
    reverb: 'chamber',
    presets: {
      default: { description: "Single 8' choir" },
      '8-4': {
        description: "8' + 4' (brilliant, octave coupled)",
        layers: [
          { model: 'harpsichord' }, { model: 'harpsichord', transpose: 12, gain: -5 },
          { model: 'harpsichord-release', trigger: 'release' },
        ],
      },
      lute: { description: 'Buff/lute stop: muted, short and soft', params: { brightness: -3, decay: 0.45, noise: -4 } },
      flemish: {
        description: 'Flemish harpsichord (8\')',
        layers: [{ model: 'harpsichord-flemish' }, { model: 'harpsichord-flemish-release', trigger: 'release' }],
      },
      hall: ROOMS.hall,
    },
  },
  // ── organs (single-sound models; see the Organ class for the full church organ) ──
  {
    id: 'pipe-organ',
    name: 'Pipe Organ (full)',
    family: 'organ',
    description: 'A church organ with a full registration, recorded in its building.',
    layers: one('pipe-organ'),
    range: [24, 96],
    reverb: 'church',
    aliases: ['church-organ'],
    presets: {
      default: { description: 'Full swell' },
      soft: { description: 'Soft flutes', layers: one('pipe-organ-soft') },
      'with-pedal': {
        description: 'Manual plus 16\' pedal below C3',
        layers: [{ model: 'pipe-organ', keyLow: 48 }, { model: 'pipe-organ-pedal', keyHigh: 47 }],
      },
      cathedral: { description: 'In a vast cathedral', params: { reverbSend: 0.3 }, reverb: 'cathedral' },
    },
  },
  {
    id: 'chamber-organ',
    name: 'Renaissance Chamber Organ',
    family: 'organ',
    description: "A small Renaissance-style positive organ: sweet wooden flutes.",
    layers: one('renaissance-organ-8'),
    range: [36, 89],
    reverb: 'chamber',
    aliases: ['positive-organ'],
    presets: {
      default: { description: "8' flute" },
      '4ft': { description: "4' flute alone", layers: one('renaissance-organ-4') },
      '8-4': { description: "8' + 4'", layers: [{ model: 'renaissance-organ-8' }, { model: 'renaissance-organ-4', gain: -2 }] },
      full: { description: 'Full organ', layers: one('renaissance-organ-full') },
    },
  },
  // ── plucked / struck strings ────────────────────────────────────────────────
  {
    id: 'harp',
    name: 'Concert Harp',
    family: 'strings',
    description: 'Pedal harp with real pluck transients; notes ring until they decay.',
    layers: one('harp'),
    range: [24, 103],
    reverb: 'hall',
    presets: {
      default: { description: 'As recorded' },
      warm: { description: 'Plucked closer to the middle of the string', params: { brightness: -1.5 } },
      'pres-de-la-table': { description: 'Plucked near the soundboard: metallic, guitar-like', params: { brightness: 2.5, decay: 0.6 } },
      hall: ROOMS.hall,
    },
  },
  {
    id: 'violin-pizzicato',
    name: 'Violin Pizzicato',
    family: 'strings',
    description: 'Plucked solo violin.',
    layers: one('violin-pizzicato'),
    range: [55, 100],
    reverb: 'hall',
    presets: { default: { description: 'As recorded' }, dry: ROOMS.dry },
  },
  {
    id: 'cello-pizzicato',
    name: 'Cello Section Pizzicato',
    family: 'strings',
    description: 'Plucked cello section.',
    layers: one('cello-pizzicato'),
    range: [36, 76],
    reverb: 'hall',
    presets: { default: { description: 'As recorded' }, dry: ROOMS.dry },
  },
  {
    id: 'contrabass-pizzicato',
    name: 'Contrabass Pizzicato',
    family: 'strings',
    description: 'Plucked double bass — also a lovely jazz walking bass.',
    layers: one('contrabass-pizzicato'),
    range: [28, 67],
    reverb: 'hall',
    aliases: ['upright-bass', 'jazz-bass'],
    presets: { default: { description: 'As recorded' }, jazz: { description: 'Dry jazz-club bass', params: { reverbSend: 0.05, brightness: 0.5 }, reverb: 'room' } },
  },
  // ── bowed strings ───────────────────────────────────────────────────────────
  {
    id: 'violin',
    name: 'Solo Violin',
    family: 'strings',
    description: 'Solo violin with natural vibrato.',
    layers: one('violin'),
    range: [55, 103],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
      default: { description: 'As recorded' },
      'senza-vibrato': { description: 'Straight tone, no vibrato (baroque style)', params: { naturalVibrato: 0.15 } },
      expressive: { description: 'Wider romantic vibrato', params: { naturalVibrato: 1.4, vibrato: 6, vibratoDelay: 0.25 } },
      intimate: { description: 'Close and dry', params: { reverbSend: 0.06, noise: 2 } },
    },
  },
  {
    id: 'violins',
    name: 'Violin Section',
    family: 'strings',
    description: 'Orchestral first violins.',
    layers: one('violins'),
    range: [55, 100],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
      default: { description: 'As recorded' },
      lush: { description: 'Bigger, wider section', params: { chorus: 0.25, chorusDepth: 4, spread: 0.85, humanize: 3 } },
      soft: { description: 'Gentle, slow bow attack', params: { attack: 2.2, brightness: -1 } },
    },
  },
  {
    id: 'violas',
    name: 'Viola Section',
    family: 'strings',
    description: 'Orchestral violas.',
    layers: one('violas'),
    range: [48, 91],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, soft: { description: 'Slow bow attack', params: { attack: 2.2, brightness: -1 } } },
  },
  {
    id: 'cellos',
    name: 'Cello Section',
    family: 'strings',
    description: 'Orchestral cellos with vibrato.',
    layers: one('cellos'),
    range: [36, 76],
    reverb: 'hall',
    aliases: ['cello'],
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, soft: { description: 'Slow bow attack', params: { attack: 2.0, brightness: -1 } } },
  },
  {
    id: 'contrabass',
    name: 'Contrabass',
    family: 'strings',
    description: 'Double bass, bowed.',
    layers: one('contrabass'),
    range: [28, 67],
    reverb: 'hall',
    aliases: ['double-bass'],
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
  },
  {
    id: 'strings',
    name: 'String Orchestra',
    family: 'strings',
    description: 'Full string section split across the keyboard: basses, cellos, violas and violins.',
    layers: [
      { model: 'contrabass', keyHigh: 47, gain: -2 },
      { model: 'cellos', keyLow: 36, keyHigh: 62 },
      { model: 'violas', keyLow: 55, keyHigh: 72, gain: -2 },
      { model: 'violins', keyLow: 60 },
    ],
    range: [28, 100],
    reverb: 'hall',
    aliases: ['string-ensemble', 'orchestra-strings'],
    presets: {
      default: { description: 'Divisi across the keyboard' },
      octaves: {
        description: 'Violins doubled by cellos an octave below (classic film voicing)',
        layers: [{ model: 'violins', keyLow: 55 }, { model: 'cellos', transpose: -12, gain: -3 }],
      },
      lush: { description: 'Wider and softer', params: { chorus: 0.2, attack: 1.6, spread: 0.9 } },
    },
  },
  // ── woodwinds ───────────────────────────────────────────────────────────────
  {
    id: 'flute',
    name: 'Flute',
    family: 'woodwind',
    description: 'Concert flute, straight tone.',
    layers: one('flute'),
    range: [59, 98],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
      default: { description: 'Straight tone' },
      vibrato: { description: 'With natural flute vibrato', layers: one('flute-vibrato') },
      breathy: { description: 'More air in the tone', params: { noise: 6, brightness: -0.5 } },
      piccolo: { description: 'Piccolo', layers: one('piccolo') },
    },
  },
  {
    id: 'oboe',
    name: 'Oboe',
    family: 'woodwind',
    description: 'Oboe.',
    layers: one('oboe'),
    range: [58, 91],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, vibrato: { description: 'Light vibrato', params: { vibrato: 8, vibratoRate: 5.2 } } },
  },
  {
    id: 'clarinet',
    name: 'Clarinet',
    family: 'woodwind',
    description: 'B♭ clarinet.',
    layers: one('clarinet'),
    range: [50, 91],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, dark: { description: 'Dark, covered tone', params: { brightness: -1.5, evenHarmonics: -3 } } },
  },
  {
    id: 'bassoon',
    name: 'Bassoon',
    family: 'woodwind',
    description: 'Bassoon.',
    layers: one('bassoon'),
    range: [34, 75],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
  },
  {
    id: 'tenor-sax',
    name: 'Tenor Saxophone',
    family: 'woodwind',
    description: 'Tenor saxophone, straight tone.',
    layers: one('tenor-sax'),
    range: [44, 88],
    reverb: 'room',
    aliases: ['sax', 'saxophone'],
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
      default: { description: 'Straight tone' },
      jazz: { description: 'Jazz ballad: breathy with vibrato', params: { noise: 4, vibrato: 14, vibratoRate: 5.0, vibratoDelay: 0.35 } },
      bright: { description: 'Edgy rock tone', params: { brightness: 1.5, drive: 2 } },
    },
  },
  // ── brass ───────────────────────────────────────────────────────────────────
  {
    id: 'trumpet',
    name: 'Trumpet',
    family: 'brass',
    description: 'B♭ trumpet.',
    layers: one('trumpet'),
    range: [52, 84],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } },
      default: { description: 'Open' },
      muted: { description: 'Straight mute', layers: one('trumpet-muted') },
      vibrato: { description: 'Lyrical vibrato', params: { vibrato: 10, vibratoRate: 5.5 } },
    },
  },
  {
    id: 'french-horn',
    name: 'French Horn',
    family: 'brass',
    description: 'Horn in F.',
    layers: one('french-horn'),
    range: [34, 77],
    reverb: 'hall',
    aliases: ['horn'],
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' }, distant: { description: 'Distant, at the back of the hall', params: { reverbSend: 0.45, brightness: -1 } } },
  },
  {
    id: 'trombone',
    name: 'Trombone',
    family: 'brass',
    description: 'Tenor trombone.',
    layers: one('trombone'),
    range: [28, 72],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
  },
  {
    id: 'tuba',
    name: 'Tuba',
    family: 'brass',
    description: 'Tuba.',
    layers: one('tuba'),
    range: [22, 60],
    reverb: 'hall',
    presets: {
      legato: { description: 'Slurred melody: notes connect without re-attacking', params: { legato: true, glide: 0.05 } }, default: { description: 'As recorded' } },
  },
  {
    id: 'brass',
    name: 'Brass Section',
    family: 'brass',
    description: 'Tuba, trombone, horn and trumpet split across the keyboard.',
    layers: [
      { model: 'tuba', keyHigh: 45 },
      { model: 'trombone', keyLow: 40, keyHigh: 60 },
      { model: 'french-horn', keyLow: 48, keyHigh: 70, gain: -2 },
      { model: 'trumpet', keyLow: 58 },
    ],
    range: [22, 84],
    reverb: 'hall',
    aliases: ['brass-section'],
    presets: { default: { description: 'As recorded' } },
  },
  // ── mallets & bells ─────────────────────────────────────────────────────────
  {
    id: 'marimba',
    name: 'Marimba',
    family: 'percussion',
    description: 'Rosewood marimba.',
    layers: one('marimba'),
    range: [45, 96],
    reverb: 'hall',
    presets: { default: { description: 'As recorded' }, soft: { description: 'Yarn mallets', params: { brightness: -2, noise: -6 } } },
  },
  {
    id: 'vibraphone',
    name: 'Vibraphone',
    family: 'percussion',
    description: 'Vibraphone with hard mallets; note-off engages the damper pedal behaviour.',
    layers: one('vibraphone'),
    range: [53, 89],
    reverb: 'hall',
    aliases: ['vibes'],
    presets: {
      default: { description: 'As recorded' },
      'let-ring': { description: 'Pedal down: notes ring', params: { release: 8 } },
      motor: { description: 'Motor on: the classic vibraphone pulse', params: { tremolo: 4, tremoloRate: 5.5, release: 4 } },
    },
  },
  {
    id: 'xylophone',
    name: 'Xylophone',
    family: 'percussion',
    description: 'Xylophone.',
    layers: one('xylophone'),
    range: [60, 108],
    reverb: 'hall',
    presets: { default: { description: 'As recorded' } },
  },
  {
    id: 'glockenspiel',
    name: 'Glockenspiel',
    family: 'percussion',
    description: 'Glockenspiel.',
    layers: one('glockenspiel'),
    range: [72, 108],
    reverb: 'hall',
    presets: { default: { description: 'As recorded' } },
  },
  {
    id: 'tubular-bells',
    name: 'Tubular Bells',
    family: 'percussion',
    description: 'Orchestral chimes.',
    layers: one('tubular-bells'),
    range: [60, 77],
    reverb: 'church',
    aliases: ['chimes'],
    presets: { default: { description: 'As recorded' } },
  },
];

const BY_ID = new Map<string, InstrumentDef>();
for (const d of INSTRUMENTS) {
  BY_ID.set(d.id, d);
  for (const a of d.aliases ?? []) BY_ID.set(a, d);
}

/** Look up an instrument by id or alias. */
export function findInstrument(id: string): InstrumentDef | undefined {
  return BY_ID.get(id.toLowerCase());
}

/** All instrument ids (and aliases with `withAliases`). */
export function instrumentIds(withAliases = false): string[] {
  return withAliases ? [...BY_ID.keys()] : INSTRUMENTS.map((d) => d.id);
}
