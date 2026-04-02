import { Organ as OrganHandle, type OrganOptions } from './Organ.js';
import { Part, type PlayOptions, type TimeOptions } from './Part.js';
import type { NoteLike } from './notes.js';
import type { InstrumentParams } from './params.js';
import { Synth, type SynthOptions } from './Synth.js';
import type { AudioBuffer, WavOptions } from './wav.js';

export interface InstrumentOptions extends SynthOptions {
  /** Preset name. @default 'default' */
  preset?: string;
  /** Parameter tweaks. */
  params?: InstrumentParams;
}

/**
 * A single instrument with its own engine — the quickest way to make sound.
 *
 * ```ts
 * import { Piano } from 'supersynth';
 * const piano = new Piano({ preset: 'mellow' });
 * await piano.start();
 * piano.play(['C4', 'E4', 'G4'], { duration: 2 });
 * ```
 */
export class Instrument {
  /** The underlying engine (add more instruments to it with `synth.add`). */
  readonly synth: Synth;
  /** The instrument's part (channel). */
  readonly part: Part;

  constructor(id: string, options: InstrumentOptions = {}) {
    const { preset, params, ...synthOptions } = options;
    this.synth = new Synth(synthOptions);
    this.part = this.synth.add(id, { ...(preset ? { preset } : {}), ...(params ? { params } : {}) });
  }

  get presets(): string[] {
    return this.part.presets;
  }

  get currentTime(): number {
    return this.synth.currentTime;
  }

  async start(): Promise<this> {
    await this.synth.start();
    return this;
  }

  stop(): this {
    this.synth.stop();
    return this;
  }

  close(): void {
    this.synth.close();
  }

  play(notes: NoteLike | NoteLike[], options: PlayOptions = {}): this {
    this.part.play(notes, options);
    return this;
  }

  noteOn(note: NoteLike, velocity = 90, options: TimeOptions = {}): this {
    this.part.noteOn(note, velocity, options);
    return this;
  }

  noteOff(note: NoteLike, options: TimeOptions = {}): this {
    this.part.noteOff(note, options);
    return this;
  }

  sequence(...args: Parameters<Part['sequence']>): number {
    return this.part.sequence(...args);
  }

  sustain(down: boolean, options: TimeOptions = {}): this {
    this.part.sustain(down, options);
    return this;
  }

  set(params: InstrumentParams): this {
    this.part.set(params);
    return this;
  }

  usePreset(name: string, extra: InstrumentParams = {}): this {
    this.part.usePreset(name, extra);
    return this;
  }

  render(seconds: number): AudioBuffer {
    return this.synth.render(seconds);
  }

  renderToFile(file: string, seconds: number, options: WavOptions = {}): AudioBuffer {
    return this.synth.renderToFile(file, seconds, options);
  }
}

/** Concert grand piano (Steinway B). */
export class Piano extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('grand-piano', options); }
}
/** Upright piano. */
export class UprightPiano extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('upright-piano', options); }
}
/** French double harpsichord. */
export class Harpsichord extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('harpsichord', options); }
}
/** Concert harp. */
export class Harp extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('harp', options); }
}
/** Solo violin. */
export class Violin extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('violin', options); }
}
/** Cello section. */
export class Cello extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('cellos', options); }
}
/** Full string orchestra split across the keyboard. */
export class Strings extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('strings', options); }
}
/** Concert flute. */
export class Flute extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('flute', options); }
}
/** Oboe. */
export class Oboe extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('oboe', options); }
}
/** Clarinet. */
export class Clarinet extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('clarinet', options); }
}
/** Bassoon. */
export class Bassoon extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('bassoon', options); }
}
/** Tenor saxophone. */
export class Saxophone extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('tenor-sax', options); }
}
/** Trumpet. */
export class Trumpet extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('trumpet', options); }
}
/** French horn. */
export class FrenchHorn extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('french-horn', options); }
}
/** Trombone. */
export class Trombone extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('trombone', options); }
}
/** Tuba. */
export class Tuba extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('tuba', options); }
}
/** Marimba. */
export class Marimba extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('marimba', options); }
}
/** Vibraphone. */
export class Vibraphone extends Instrument {
  constructor(options: InstrumentOptions = {}) { super('vibraphone', options); }
}

/**
 * The church organ with its own engine.
 *
 * ```ts
 * const organ = new ChurchOrgan({ registration: 'plenum' });
 * await organ.start();
 * organ.great.play(['C3', 'G3', 'C4', 'E4'], { duration: 4 });
 * organ.pedal.play('C2', { duration: 4 });
 * ```
 */
export class ChurchOrgan extends OrganHandle {
  constructor(options: OrganOptions & SynthOptions = {}) {
    const { registration, tremulant, ...synthOptions } = options;
    const synth = new Synth({ reverb: 'church', ...synthOptions });
    super(synth, { ...(registration ? { registration } : {}), ...(tremulant ? { tremulant } : {}) });
  }

  async start(): Promise<this> {
    await this.synth.start();
    return this;
  }

  stop(): this {
    this.synth.stop();
    return this;
  }

  render(seconds: number): AudioBuffer {
    return this.synth.render(seconds);
  }

  renderToFile(file: string, seconds: number, options: WavOptions = {}): AudioBuffer {
    return this.synth.renderToFile(file, seconds, options);
  }
}
