import { Synth } from '../src/Synth.js';
import { Organ } from '../src/instruments/organ.js';

describe('Synth offline rendering', () => {
  let synth: Synth;

  beforeEach(() => {
    synth = new Synth({ sampleRate: 48000 });
  });

  test('render() returns Float32Array of correct length', () => {
    const samples = synth.render(1024);
    // Use ArrayBuffer.isView for cross-realm typed array check
    expect(ArrayBuffer.isView(samples)).toBe(true);
    expect(samples.length).toBe(1024);
  });

  test('silence when no notes have been played', () => {
    const samples = synth.render(1024);
    const allZero = Array.from(samples).every((s) => s === 0);
    expect(allZero).toBe(true);
  });

  test('note on produces non-zero audio', () => {
    synth.noteOn(69, 100);
    const samples = synth.render(1024);
    const hasSignal = Array.from(samples).some((s) => Math.abs(s) > 1e-6);
    expect(hasSignal).toBe(true);
  });

  test('all samples are finite (no NaN/Infinity)', () => {
    synth.noteOn(69, 100);
    const samples = synth.render(4096);
    for (const s of samples) {
      expect(isFinite(s)).toBe(true);
    }
  });

  test('limiter keeps output bounded when many notes play', () => {
    for (let i = 0; i < 16; i++) {
      synth.noteOn(60 + i, 127);
    }
    // Warm up: let the limiter envelope settle
    synth.render(2400);
    const samples = synth.render(2048);
    for (const s of samples) {
      expect(Math.abs(s)).toBeLessThanOrEqual(2.0);
    }
  });

  test('note off eventually produces silence', () => {
    synth.noteOn(69, 100);
    synth.render(4800); // let attack settle
    synth.noteOff(69);
    synth.render(96000); // wait for release
    expect(synth.activeNoteCount).toBe(0);
  });

  test('multiple simultaneous notes produce audio', () => {
    [60, 64, 67].forEach((note) => synth.noteOn(note, 80));
    const samples = synth.render(1024);
    expect(Array.from(samples).some((s) => Math.abs(s) > 1e-6)).toBe(true);
  });

  test('activeNoteCount reflects note on/off state', () => {
    expect(synth.activeNoteCount).toBe(0);
    synth.noteOn(60, 100);
    synth.noteOn(64, 100);
    expect(synth.activeNoteCount).toBe(2);
    synth.noteOff(60);
    // Count stays 2 until release finishes — just check it's still tracked
    expect(synth.activeNoteCount).toBeGreaterThanOrEqual(1);
  });

  test('voice override per note', () => {
    synth.noteOn(69, 100, { voice: { oscillators: [{ waveform: 'trumpet' }] } });
    const samples = synth.render(1024);
    expect(Array.from(samples).some((s) => Math.abs(s) > 1e-6)).toBe(true);
  });

  test('setVoice changes default voice', () => {
    synth.setVoice({ oscillators: [{ waveform: 'sine' }] });
    synth.noteOn(69, 100);
    const samples = synth.render(1024);
    expect(Array.from(samples).some((s) => Math.abs(s) > 1e-6)).toBe(true);
  });

  test('setMasterVolume(0) produces silence', () => {
    synth.noteOn(69, 100);
    synth.render(480); // let attack start
    synth.setMasterVolume(0);
    // Render enough samples for the loudness filter's biquad state to drain to
    // effective silence (the filter decays asymptotically, not to exact zero).
    synth.render(4800); // drain biquad state (~100ms)
    const samples = synth.render(1024);
    const peak = Math.max(...Array.from(samples).map(Math.abs));
    expect(peak).toBeLessThan(1e-6);
  });
});

describe('Synth with reverb', () => {
  test('reverb-enabled synth produces finite audio', () => {
    const synth = new Synth({
      reverb: { roomSize: 0.85, wet: 0.35, dry: 0.65, preDelayMs: 20 },
    });
    synth.noteOn(69, 100);
    const samples = synth.render(4096);
    for (const s of samples) {
      expect(isFinite(s)).toBe(true);
    }
  });

  test('reverb tail continues after note off', () => {
    const synth = new Synth({
      reverb: { roomSize: 0.85, wet: 0.8, dry: 0.2 },
    });
    synth.noteOn(69, 127);
    synth.render(4800);
    synth.noteOff(69);
    synth.render(96000); // wait for note release
    // After note finishes, reverb tail keeps producing audio
    const tail = synth.render(512);
    const hasReverb = Array.from(tail).some((s) => Math.abs(s) > 1e-10);
    expect(hasReverb).toBe(true);
  });
});

describe('Synth sendMidiBytes', () => {
  test('note on via MIDI bytes produces audio', () => {
    const synth = new Synth();
    synth.sendMidiBytes(Buffer.from([0x90, 69, 100])); // NoteOn ch1 A4 vel100
    const samples = synth.render(1024);
    expect(Array.from(samples).some((s) => Math.abs(s) > 1e-6)).toBe(true);
  });

  test('note off via MIDI bytes stops note', () => {
    const synth = new Synth();
    synth.sendMidiBytes(Buffer.from([0x90, 69, 100]));
    synth.render(4800);
    synth.sendMidiBytes(Buffer.from([0x80, 69, 0]));
    synth.render(96000);
    expect(synth.activeNoteCount).toBe(0);
  });
});

describe('Organ addOscillator / removeOscillator', () => {
  test('Organ activatePreset produces audio', () => {
    const organ = new Organ({ sampleRate: 48000 });
    organ.activatePreset('principal');
    organ.noteOn(60, 100);
    const samples = organ.render(1024);
    expect(Array.from(samples).some((s) => Math.abs(s) > 1e-6)).toBe(true);
  });

  test('shared stop refcount: deactivating one preset keeps shared stop active', () => {
    const organ = new Organ({ sampleRate: 48000 });
    // both cornet and mixture include "8' Principal"
    organ.activatePreset('cornet');
    organ.activatePreset('mixture');
    organ.deactivatePreset('cornet');
    organ.noteOn(60, 100);
    const samples = organ.render(1024);
    expect(Array.from(samples).some((s) => Math.abs(s) > 1e-6)).toBe(true);
  });

  test('Organ activatePreset with breaking stop produces finite audio', () => {
    const organ = new Organ({ sampleRate: 48000 });
    organ.activatePreset('mixture'); // includes Mixture III ranks (breaking stops)
    // Test across the break ranges: low, mid, high
    for (const note of [36, 60, 72, 84]) {
      organ.noteOn(note, 80);
      const samples = organ.render(512);
      for (const s of samples) {
        expect(isFinite(s)).toBe(true);
      }
      organ.noteOff(note);
    }
  });
});

describe('Synth utility methods', () => {
  test('listAudioBackends returns array of strings', () => {
    const synth = new Synth();
    const backends = synth.listAudioBackends();
    expect(Array.isArray(backends)).toBe(true);
    expect(backends.length).toBeGreaterThan(0);
    backends.forEach((b) => expect(typeof b).toBe('string'));
  });

  test('listMidiDevices returns array', () => {
    const synth = new Synth();
    const devices = synth.listMidiDevices();
    expect(Array.isArray(devices)).toBe(true);
  });
});
