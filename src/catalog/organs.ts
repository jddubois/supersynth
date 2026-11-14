// Organs (single-sound models; see `supersynth/organs` for the full church organs) and the rock organ
import { type InstrumentDefinition, one } from './types.js';

/** Pipe Organ (full). */
export const PIPE_ORGAN: InstrumentDefinition = {
  id: 'pipe-organ',
  name: 'Pipe Organ (full)',
  family: 'organ',
  description: 'A church organ with a full registration, recorded in its building.',
  // the full-organ and pedal models are filed an octave below the pitch they sound (see vcsl.ts)
  layers: [{ model: 'pipe-organ', transpose: -12 }],
  range: [36, 96],
  reverb: 'church',
  presets: {
    default: { description: 'Full swell' },
    soft: { description: 'Soft flutes', layers: one('pipe-organ-soft') },
    'with-pedal': {
      description: 'Manual plus 16\' pedal below C3',
      layers: [{ model: 'pipe-organ', transpose: -12, keyLow: 48 }, { model: 'pipe-organ-pedal', transpose: -24, keyHigh: 47 }],
    },
    cathedral: { description: 'In a vast cathedral', parameters: { reverbSend: 0.3 }, reverb: 'cathedral' },
  },
};

/** Renaissance Chamber Organ. */
export const CHAMBER_ORGAN: InstrumentDefinition = {
  id: 'chamber-organ',
  name: 'Renaissance Chamber Organ',
  family: 'organ',
  description: "A small Renaissance-style positive organ: sweet wooden flutes.",
  layers: one('renaissance-organ-8'),
  range: [36, 89],
  reverb: 'chamber',
  presets: {
    default: { description: "8' flute" },
    '4ft': { description: "4' flute alone", layers: one('renaissance-organ-4') },
    '8-4': { description: "8' + 4'", layers: [{ model: 'renaissance-organ-8' }, { model: 'renaissance-organ-4', gain: -2 }] },
    full: { description: 'Full organ', layers: one('renaissance-organ-full') },
  },
};

/** Rock Organ (tonewheel organ through a rotary speaker). */
export const ROCK_ORGAN: InstrumentDefinition = {
  id: 'rock-organ',
  name: 'Rock Organ',
  family: 'organ',
  description: 'A tonewheel organ with all nine drawbars out, through a rotary speaker: the classic rock organ. The tone is steady; the swirl is the speaker, shared by every note that sounds (`leslie`: fast, slow or stopped).',
  // the model is filed by its 16' drawbar, an octave below the key
  layers: [{ model: 'rock-organ', transpose: -12 }],
  range: [36, 96],
  reverb: 'room',
  parameters: { leslie: 'fast' },
  presets: {
    default: { description: 'Rotary speaker fast (tremolo), as recorded' },
    slow: { description: 'Rotary speaker slow (chorale)', parameters: { leslie: 'slow' } },
    brake: { description: 'Rotary speaker stopped: the cabinet alone', parameters: { leslie: 'stop' } },
    overdrive: { description: 'The amplifier driven hard into the fast speaker', parameters: { drive: 4, driveTone: 7000, driveLevel: 0.42 } },
    'overdrive-slow': { description: 'Driven hard, speaker slow', parameters: { drive: 4, driveTone: 7000, driveLevel: 0.42, leslie: 'slow' } },
    mellow: { description: 'Darker, with the speaker slow: ballad organ', parameters: { brightness: -2, leslie: 'slow' } },
    arena: { description: 'Fast speaker in a big hall', parameters: { reverbSend: 0.25 }, reverb: 'concert-hall' },
    direct: { description: 'No speaker: the organ straight into the desk', parameters: { leslie: 'off' } },
  },
};
