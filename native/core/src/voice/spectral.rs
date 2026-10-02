//! Spectral-model voice: additive resynthesis of an analysed instrument.
//!
//! At note-on the voice picks up to four zones (two neighbouring pitches × two
//! neighbouring dynamic layers) and morphs between them every block. Partial
//! amplitudes are interpolated in dB, converted once per block and ramped
//! linearly across the block; oscillators are complex rotators (exact sines,
//! one complex multiply per partial per sample) processed eight at a time so
//! the inner loop vectorises.

use std::sync::Arc;

use crate::dsp::{db_to_amp, noise::Rng, pan_gains, BLOCK};
use crate::model::{a16_to_db, Kind, Model, ReleaseMode, MAX_PARTIALS, PULSE_BINS};

pub const MAX_ZONES: usize = 4;
pub const MAX_BANDS: usize = 32;
const LANES: usize = 8;
const SILENT_DB: f32 = -110.0;

/// Live, part-level parameters shared by all voices of a part (cheap to copy).
#[derive(Clone, Copy, Debug)]
pub struct SpectralParams {
    /// Spectral tilt in dB per octave above the fundamental.
    pub brightness: f32,
    /// Extra gain on even-numbered partials (dB) — hollow (−) vs full (+).
    pub even_db: f32,
    /// Residual noise level offset (dB): breath, bow, hammer, wind.
    pub noise_db: f32,
    /// Attack speed: >1 slower (stretches the onset), <1 snappier.
    pub attack_scale: f32,
    /// Decay/sustain evolution speed for free-decaying instruments: >1 longer.
    pub decay_scale: f32,
    /// Release time scale (>1 longer release).
    pub release_scale: f32,
    /// Extra vibrato (cents) and its rate/delay.
    pub vibrato_cents: f32,
    pub vibrato_rate: f32,
    pub vibrato_delay: f32,
    /// How much of the recorded pitch movement (vibrato, glides) to keep, 0..1.
    pub expression: f32,
    /// Formant preservation 0..1 (None → model default).
    pub formant: f32,
    /// Inharmonicity scale (1 = as recorded).
    pub inharmonicity: f32,
    /// Stereo spread of partials 0..1.
    pub spread: f32,
    /// Random per-note detune (cents, ±).
    pub humanize_cents: f32,
    /// Velocity sensitivity 0..1 (0 = always plays the loudest layer at full level).
    pub velocity_sens: f32,
    /// Maximum number of partials to synthesise (quality/CPU trade-off).
    pub max_partials: usize,
    /// Gain applied to the whole voice (dB).
    pub gain_db: f32,
    /// Scale of the recorded independent partial jitter (0 = partials move in lockstep).
    pub jitter: f32,
    /// Scale of the recorded fast per-partial fluctuation (0 = smooth partials).
    pub shimmer: f32,
}

impl Default for SpectralParams {
    fn default() -> Self {
        Self {
            brightness: 0.0,
            even_db: 0.0,
            noise_db: 0.0,
            attack_scale: 1.0,
            decay_scale: 1.0,
            release_scale: 1.0,
            vibrato_cents: 0.0,
            vibrato_rate: 5.5,
            vibrato_delay: 0.3,
            expression: 1.0,
            formant: -1.0,
            inharmonicity: 1.0,
            spread: -1.0,
            humanize_cents: 0.0,
            velocity_sens: 1.0,
            max_partials: MAX_PARTIALS,
            gain_db: 0.0,
            jitter: 1.0,
            shimmer: 1.0,
        }
    }
}

/// Per-block modulation from the part (pitch bend, modulation wheel, etc.).
#[derive(Clone, Copy, Debug)]
pub struct BlockMod {
    /// Pitch offset in cents (bend + tuning).
    pub cents: f32,
    /// Additional vibrato depth (cents) from the mod wheel.
    pub mod_vibrato: f32,
    /// Expression/volume gain (linear) — e.g. CC11 for winds/strings swells.
    pub expression_gain: f32,
}

impl Default for BlockMod {
    fn default() -> Self {
        Self { cents: 0.0, mod_vibrato: 0.0, expression_gain: 1.0 }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Playing,
    Released,
    Killing,
    Done,
}

pub struct SpectralVoice {
    model: Option<Arc<Model>>,
    pub note: u8,
    pub velocity: u8,
    pub part: usize,
    pub layer_id: u32,
    pub age: u64,
    state: State,
    sr: f32,
    t: f32,
    t_rel: f32,

    nz: usize,
    zone: [usize; MAX_ZONES],
    w: [f32; MAX_ZONES],
    pos: [f32; MAX_ZONES],
    dir: [f32; MAX_ZONES],
    /// current ping-pong turning points (frames) per zone: re-drawn at every turn, so long
    /// notes never repeat the loop with a fixed period
    turn_lo: [f32; MAX_ZONES],
    turn_hi: [f32; MAX_ZONES],
    dominant: usize,

    k: usize,
    /// number of morphed harmonic slots; slots k_h..k are free partials of one zone
    k_h: usize,
    slot_zone: [u8; MAX_PARTIALS],
    slot_idx: [u16; MAX_PARTIALS],
    slot_wdb: [f32; MAX_PARTIALS],
    // fractional partial lookup per zone: index and fraction
    look_i: [[u16; MAX_PARTIALS]; MAX_ZONES],
    look_f: [[f32; MAX_PARTIALS]; MAX_ZONES],
    look_db: [[f32; MAX_PARTIALS]; MAX_ZONES],
    /// tilt + even/odd offset per partial, recomputed when those parameters change
    stat_db: [f32; MAX_PARTIALS],
    stat_key: (f32, f32),
    /// morphing between zones: the dominant zone's envelope (its own attack, beating and
    /// release in time) shifted by the weighted timbre difference at the zones' steady state
    morph_off: [f32; MAX_PARTIALS],
    morph_ok: [bool; MAX_PARTIALS],
    /// free-decay continuation after the analysed frames end (dB/s per partial)
    tail_rate: [f32; MAX_PARTIALS],
    tail_set: bool,
    /// playing the recording's own release after note-off (instead of a synthetic decay)
    in_rel_tail: bool,
    /// per-partial phase jitter (Ornstein-Uhlenbeck), its std (rad) and smoothing
    /// pitch-synchronous noise envelope (mixed over zones), its phase (cycles) and rate
    pulse_tab: [f32; PULSE_BINS],
    pulse_ph: f32,
    pulse_inc: f32,
    /// per-sample noise envelope of the last rendered block (when `pulse_on`)
    pub pulse_buf: [f32; BLOCK],
    pub pulse_on: bool,
    /// recorded stereo: right channel = Re(e^{iφ}·rotator): cos φ / sin φ per partial, and the
    /// quadrature gain ramp of the right channel
    st_c: [f32; MAX_PARTIALS],
    st_s: [f32; MAX_PARTIALS],
    grs: [f32; MAX_PARTIALS],
    /// left channel's own phase offset (recorded phase wander): cos / sin, and the quadrature
    /// gain ramp of the left channel
    st_lc: [f32; MAX_PARTIALS],
    st_ls: [f32; MAX_PARTIALS],
    gls: [f32; MAX_PARTIALS],
    has_lph: bool,
    has_st: bool,
    /// some zone carries a time-varying stereo image: pan_l/pan_r/st_c/st_s follow it per block
    has_img: bool,
    shim_sigma: [f32; MAX_PARTIALS],
    shim_drive: [[f32; 2]; MAX_PARTIALS],
    shim_u: [[f32; 2]; MAX_PARTIALS],
    shim_theta: [f32; MAX_PARTIALS],
    shim_tau: f32,
    jit_phase: [f32; MAX_PARTIALS],
    jit_drive: [f32; MAX_PARTIALS],
    jit_sigma: [f32; MAX_PARTIALS],
    jit_tau: f32,
    rng: Rng,
    /// sounding pitch (MIDI) and legato glide offset (cents, decaying)
    cur_pitch: f32,
    glide_cents: f32,
    glide_tau: f32,
    pub one_shot: bool,

    base_w: [f32; MAX_PARTIALS],
    re: [f32; MAX_PARTIALS],
    im: [f32; MAX_PARTIALS],
    gl: [f32; MAX_PARTIALS],
    gr: [f32; MAX_PARTIALS],
    pan_l: [f32; MAX_PARTIALS],
    pan_r: [f32; MAX_PARTIALS],
    harm: [f32; MAX_PARTIALS],
    rel_rate: [f32; MAX_PARTIALS],
    rel_db: [f32; MAX_PARTIALS],

    nb: usize,
    pub noise_pow: [f32; MAX_BANDS],
    noise_rel_rate: f32,
    voice_pan: (f32, f32),

    gain_db: f32,
    kill_gain: f32,
    vib_phase: f32,
    detune_cents: f32,
    damper_rate: f32,
    first_block: bool,
    peak_db: f32,
    // attack transient playback (per zone): source position and step in source samples
    tr_pos: [f64; MAX_ZONES],
    tr_step: [f64; MAX_ZONES],
    has_tr: bool,
    tr_fade: (f32, f32),
}

impl Default for SpectralVoice {
    fn default() -> Self {
        Self {
            model: None,
            note: 0,
            velocity: 0,
            part: 0,
            layer_id: 0,
            age: 0,
            state: State::Done,
            sr: 48000.0,
            t: 0.0,
            t_rel: 0.0,
            nz: 0,
            zone: [0; MAX_ZONES],
            w: [0.0; MAX_ZONES],
            pos: [0.0; MAX_ZONES],
            dir: [1.0; MAX_ZONES],
            turn_lo: [0.0; MAX_ZONES],
            turn_hi: [f32::MAX; MAX_ZONES],
            dominant: 0,
            k: 0,
            k_h: 0,
            slot_zone: [0; MAX_PARTIALS],
            slot_idx: [0; MAX_PARTIALS],
            slot_wdb: [0.0; MAX_PARTIALS],
            look_i: [[0; MAX_PARTIALS]; MAX_ZONES],
            look_f: [[0.0; MAX_PARTIALS]; MAX_ZONES],
            look_db: [[0.0; MAX_PARTIALS]; MAX_ZONES],
            stat_db: [0.0; MAX_PARTIALS],
            stat_key: (f32::NAN, f32::NAN),
            morph_off: [0.0; MAX_PARTIALS],
            morph_ok: [false; MAX_PARTIALS],
            tail_rate: [60.0; MAX_PARTIALS],
            tail_set: false,
            in_rel_tail: false,
            pulse_tab: [1.0; PULSE_BINS],
            pulse_ph: 0.0,
            pulse_inc: 0.0,
            pulse_buf: [1.0; BLOCK],
            pulse_on: false,
            st_c: [1.0; MAX_PARTIALS],
            st_s: [0.0; MAX_PARTIALS],
            grs: [0.0; MAX_PARTIALS],
            st_lc: [1.0; MAX_PARTIALS],
            st_ls: [0.0; MAX_PARTIALS],
            gls: [0.0; MAX_PARTIALS],
            has_lph: false,
            has_st: false,
            has_img: false,
            shim_sigma: [0.0; MAX_PARTIALS],
            shim_drive: [[0.0; 2]; MAX_PARTIALS],
            shim_u: [[0.0; 2]; MAX_PARTIALS],
            shim_theta: [0.0; MAX_PARTIALS],
            shim_tau: 0.01,
            jit_phase: [0.0; MAX_PARTIALS],
            jit_drive: [0.0; MAX_PARTIALS],
            jit_sigma: [0.0; MAX_PARTIALS],
            jit_tau: 0.025,
            rng: Rng::new(1),
            cur_pitch: 60.0,
            glide_cents: 0.0,
            glide_tau: 0.05,
            one_shot: false,
            base_w: [0.0; MAX_PARTIALS],
            re: [0.0; MAX_PARTIALS],
            im: [0.0; MAX_PARTIALS],
            gl: [0.0; MAX_PARTIALS],
            gr: [0.0; MAX_PARTIALS],
            pan_l: [0.0; MAX_PARTIALS],
            pan_r: [0.0; MAX_PARTIALS],
            harm: [0.0; MAX_PARTIALS],
            rel_rate: [0.0; MAX_PARTIALS],
            rel_db: [0.0; MAX_PARTIALS],
            nb: 0,
            noise_pow: [0.0; MAX_BANDS],
            noise_rel_rate: 0.0,
            voice_pan: (0.707, 0.707),
            gain_db: 0.0,
            kill_gain: 1.0,
            vib_phase: 0.0,
            detune_cents: 0.0,
            damper_rate: 0.0,
            first_block: true,
            peak_db: -200.0,
            tr_pos: [0.0; MAX_ZONES],
            tr_step: [0.0; MAX_ZONES],
            has_tr: false,
            tr_fade: (0.0, 0.0),
        }
    }
}

/// Note-on description passed from the part.
pub struct NoteOn<'a> {
    pub model: &'a Arc<Model>,
    pub note: u8,
    pub velocity: u8,
    /// Sounding pitch as a (fractional) MIDI note, e.g. note + transposition.
    pub pitch: f32,
    pub pan: f32,
    pub params: &'a SpectralParams,
    pub sample_rate: f32,
    pub rng: &'a mut Rng,
}

impl SpectralVoice {
    pub fn is_active(&self) -> bool {
        self.state != State::Done
    }

    pub fn is_released(&self) -> bool {
        matches!(self.state, State::Released | State::Killing)
    }

    /// Current loudness estimate (dB) for voice stealing.
    pub fn level_db(&self) -> f32 {
        self.peak_db
    }

    pub fn start(&mut self, on: NoteOn) {
        let m: &Model = on.model;
        let p = on.params;
        self.model = Some(Arc::clone(on.model));
        self.note = on.note;
        self.velocity = on.velocity;
        self.sr = on.sample_rate;
        self.t = 0.0;
        self.t_rel = 0.0;
        self.state = State::Playing;
        self.kill_gain = 1.0;
        self.first_block = true;
        self.vib_phase = on.rng.uniform();
        self.peak_db = 0.0;
        self.stat_key = (f32::NAN, f32::NAN);
        self.tail_set = false;
        self.in_rel_tail = false;
        self.cur_pitch = on.pitch;
        self.glide_cents = 0.0;

        // ── zone selection: pitch × velocity ──────────────────────────────
        let pitch = on.pitch;
        let vel = on.velocity as f32;
        let nl = m.layers.len().max(1);
        // velocity sensitivity: compress towards the loudest layer
        let top_v = m.layers.last().map(|l| l.velocity).unwrap_or(127.0);
        let v_eff = top_v + (vel - top_v) * p.velocity_sens;
        let (la, lb, lw) = bracket(nl, |i| m.layers[i].velocity, v_eff);
        let mut gain = m.params.gain_db + p.gain_db;
        // Loudness follows a fixed velocity curve anchored at the loudest layer; the
        // layers' own recorded level differences are compensated so they only carry timbre.
        if nl > 0 {
            let top_level = m.layers[nl - 1].level_db;
            let rec = m.layers[la].level_db * (1.0 - lw) + m.layers[lb].level_db * lw;
            let v_rel = v_eff.clamp(1.0, 127.0) / top_v.max(1.0);
            gain += m.params.velocity_db * 40.0 * v_rel.log10() - (rec - top_level);
        }
        self.nz = 0;
        let add = |zi: usize, w: f32, this: &mut Self| {
            if w <= 1e-4 {
                return;
            }
            for j in 0..this.nz {
                if this.zone[j] == zi {
                    this.w[j] += w;
                    return;
                }
            }
            if this.nz < MAX_ZONES {
                this.zone[this.nz] = zi;
                this.w[this.nz] = w;
                this.nz += 1;
            }
        };
        for (layer, lwt) in [(la, 1.0 - lw), (lb, lw)] {
            if lwt <= 1e-4 {
                continue;
            }
            let zs = &m.by_layer[layer.min(m.by_layer.len() - 1)];
            if zs.is_empty() {
                continue;
            }
            let (za, zb, mut zw) = bracket(zs.len(), |i| m.zones[zs[i]].note, pitch);
            if !m.params.pitch_morph {
                zw = if zw < 0.5 { 0.0 } else { 1.0 };
            }
            add(zs[za], lwt * (1.0 - zw), self);
            add(zs[zb], lwt * zw, self);
        }
        if self.nz == 0 {
            // layer without zones: fall back to nearest zone in the model
            let zi = (0..m.zones.len())
                .min_by(|&a, &b| {
                    (m.zones[a].note - pitch).abs().partial_cmp(&(m.zones[b].note - pitch).abs()).unwrap()
                })
                .unwrap_or(0);
            self.zone[0] = zi;
            self.w[0] = 1.0;
            self.nz = 1;
        }
        let wsum: f32 = self.w[..self.nz].iter().sum();
        for w in &mut self.w[..self.nz] {
            *w /= wsum;
        }
        self.dominant = (0..self.nz).max_by(|&a, &b| self.w[a].partial_cmp(&self.w[b]).unwrap()).unwrap();
        for j in 0..self.nz {
            self.pos[j] = 0.0;
            self.dir[j] = 1.0;
            let (a, b) = m.zones[self.zone[j]].loop_range.map(|(a, b)| (a as f32, b as f32)).unwrap_or((0.0, f32::MAX));
            self.turn_lo[j] = a;
            self.turn_hi[j] = b;
        }

        // ── partials ───────────────────────────────────────────────────────
        self.detune_cents = if p.humanize_cents > 0.0 { on.rng.bipolar() * p.humanize_cents } else { 0.0 }
            + if m.params.pitch_jitter_cents > 0.0 { on.rng.bipolar() * m.params.pitch_jitter_cents } else { 0.0 };
        // recorded tuning: keep the deviation of the zones from their nominal note
        let tuning_dev = if m.params.recorded_tuning {
            (0..self.nz)
                .map(|j| {
                    let zn = m.zones[self.zone[j]].note;
                    self.w[j] * (zn - zn.round())
                })
                .sum::<f32>()
        } else {
            0.0
        };
        let f_target = crate::dsp::midi_to_hz(pitch + tuning_dev);
        let nyq = 0.47 * self.sr;
        let formant = if p.formant >= 0.0 { p.formant } else { m.params.formant };
        let kmax = (0..self.nz).map(|j| m.zones[self.zone[j]].harmonic).max().unwrap_or(0);
        let kmax = kmax.min(p.max_partials.max(1)).min(MAX_PARTIALS);
        let dz = &m.zones[self.zone[self.dominant]];
        let mut k = 0;
        for i in 0..kmax {
            let h = (i + 1) as f32;
            // frequency ratio: weighted over zones, extrapolated with each zone's stretch
            let mut ratio = 0.0;
            for j in 0..self.nz {
                let z = &m.zones[self.zone[j]];
                let r = if i < z.harmonic {
                    z.ratios[i]
                } else if z.harmonic > 0 {
                    let last = z.harmonic - 1;
                    h * z.ratios[last] / (last + 1) as f32
                } else {
                    h
                };
                ratio += self.w[j] * r;
            }
            ratio = h + (ratio - h) * p.inharmonicity;
            let f = f_target * ratio;
            if f >= nyq {
                break;
            }
            self.harm[i] = h;
            self.slot_zone[i] = u8::MAX;
            self.base_w[i] = std::f32::consts::TAU * f / self.sr;
            let ph = if i < dz.harmonic { dz.phases[i] } else { on.rng.uniform() * std::f32::consts::TAU };
            self.re[i] = ph.cos();
            self.im[i] = ph.sin();
            self.gl[i] = 0.0;
            self.gr[i] = 0.0;
            self.rel_db[i] = 0.0;
            let r = if i < dz.harmonic { dz.release[i] } else { 0.0 };
            self.rel_rate[i] = r.max(m.params.min_release_db_s);
            // fractional lookups (formant mode transposes the spectral envelope)
            for j in 0..self.nz {
                let z = &m.zones[self.zone[j]];
                let jf = h * (f_target / z.f0).powf(formant) - 1.0;
                let (ii, fr, extra) = if jf <= 0.0 {
                    (0usize, 0.0, if jf < 0.0 { 12.0 * (1.0 / (jf + 1.0).max(0.25)).log2() } else { 0.0 })
                } else if formant > 0.0 && (jf - i as f32).abs() > 0.02 {
                    // Interpolate between partials of the same parity as this one, so
                    // odd/even structure (clarinet, stopped pipes) survives the formant shift.
                    let par = i & 1;
                    let mut lo = jf.floor() as usize;
                    if lo & 1 != par {
                        lo = lo.saturating_sub(1);
                    }
                    let fr = ((jf - lo as f32) / 2.0).clamp(0.0, 1.0);
                    (lo, fr, 0.0)
                } else {
                    let ii = jf.round() as usize;
                    (ii, 0.0, 0.0)
                };
                self.look_i[j][i] = ii.min(u16::MAX as usize) as u16;
                self.look_f[j][i] = fr;
                self.look_db[j][i] = -extra;
            }
            k = i + 1;
        }
        self.k_h = k;
        // morph offsets: each zone's level at its steady reference frame (loop start, or 0.5 s)
        let dzi = self.dominant;
        for i in 0..k {
            self.morph_ok[i] = false;
            if self.nz < 2 {
                continue;
            }
            let mut sum = 0.0f32;
            let mut dom = 0.0f32;
            let mut ok = true;
            for j in 0..self.nz {
                let z = &m.zones[self.zone[j]];
                let rf = z.loop_range.map(|(a, _)| a).unwrap_or_else(|| m.grid.iter().position(|&g| g >= 0.5).unwrap_or(0)).min(z.frames - 1);
                let ii = self.look_i[j][i] as usize;
                let fr = self.look_f[j][i];
                let q = |idx: usize| z.harm_db(rf, idx);
                let mut v = q(ii);
                if fr > 0.0 {
                    v = lerp(v, q(ii + 2), fr);
                }
                if v < -150.0 {
                    ok = false;
                    break;
                }
                v += self.look_db[j][i] + z.gain_db;
                sum += self.w[j] * v;
                if j == dzi {
                    dom = v;
                }
            }
            if ok {
                self.morph_off[i] = sum - dom;
                self.morph_ok[i] = true;
            }
        }
        // free (inharmonic) partials: each zone contributes its own, crossfaded in power
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            if self.w[j] < 0.02 || z.harmonic >= z.partials {
                continue;
            }
            let wdb = 10.0 * self.w[j].log10();
            for i in z.harmonic..z.partials {
                if k >= MAX_PARTIALS {
                    break;
                }
                let ratio = z.ratios[i];
                let f = f_target * ratio;
                if f >= nyq || f <= 0.0 {
                    continue;
                }
                self.harm[k] = ratio.max(0.1);
                self.slot_zone[k] = j as u8;
                self.slot_idx[k] = i as u16;
                self.slot_wdb[k] = wdb;
                self.base_w[k] = std::f32::consts::TAU * f / self.sr;
                let ph = z.phases[i];
                self.re[k] = ph.cos();
                self.im[k] = ph.sin();
                self.gl[k] = 0.0;
                self.gr[k] = 0.0;
                self.rel_db[k] = 0.0;
                self.rel_rate[k] = z.release[i].max(m.params.min_release_db_s);
                k += 1;
            }
        }
        self.k = k;

        // ── independent partial jitter: phase std = 2π · σ_f · τ ─────────────────
        self.rng = Rng::new(on.rng.next_u32() as u64 | ((on.rng.next_u32() as u64) << 32));
        self.jit_tau = dz.jitter_tau;
        for i in 0..k {
            let cents = if i < self.k_h {
                let mut c = 0.0;
                for j in 0..self.nz {
                    let z = &m.zones[self.zone[j]];
                    let ii = (self.look_i[j][i] as usize).min(z.harmonic.saturating_sub(1));
                    c += self.w[j] * z.jitter.get(ii).copied().unwrap_or(0.0);
                }
                c
            } else {
                let z = &m.zones[self.zone[self.slot_zone[i] as usize]];
                z.jitter.get(self.slot_idx[i] as usize).copied().unwrap_or(0.0)
            };
            let f = self.base_w[i] * self.sr / std::f32::consts::TAU;
            let sigma_f = cents / 1200.0 * std::f32::consts::LN_2 * f;
            // phase std 2π·σ_f·τ (capped: beyond ~0.6 rad a partial stops sounding like part of
            // one tone); the OU driver carries √2 of it because the smoothing stage halves the variance
            self.jit_sigma[i] = (std::f32::consts::TAU * sigma_f * self.jit_tau).min(0.6) * std::f32::consts::SQRT_2;
            self.jit_phase[i] = 0.0;
            self.jit_drive[i] = 0.0;
        }

        // ── pitch-synchronous noise: zones without a stored envelope count as flat ──
        let mut tab = [0.0f32; PULSE_BINS];
        let mut any_pulse = false;
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            if z.pulse.len() == PULSE_BINS {
                any_pulse = true;
                for (t, &g) in tab.iter_mut().zip(z.pulse.iter()) {
                    *t += self.w[j] * g;
                }
            } else {
                for t in tab.iter_mut() {
                    *t += self.w[j];
                }
            }
        }
        let ms = tab.iter().map(|g| g * g).sum::<f32>() / PULSE_BINS as f32;
        if any_pulse && ms > 1e-6 {
            let norm = 1.0 / ms.sqrt();
            for t in tab.iter_mut() {
                *t *= norm;
            }
        }
        self.pulse_tab = tab;
        self.pulse_on = any_pulse;
        self.pulse_ph = 0.0;
        self.pulse_inc = f_target / self.sr;

        // ── shimmer: per-partial σ weighted over zones like the jitter ────────────
        self.shim_tau = dz.shimmer_tau;
        for i in 0..k {
            let sig = if i < self.k_h {
                let mut c = 0.0;
                for j in 0..self.nz {
                    let z = &m.zones[self.zone[j]];
                    let ii = (self.look_i[j][i] as usize).min(z.harmonic.saturating_sub(1));
                    c += self.w[j] * z.shimmer.get(ii).copied().unwrap_or(0.0);
                }
                c
            } else {
                let z = &m.zones[self.zone[self.slot_zone[i] as usize]];
                z.shimmer.get(self.slot_idx[i] as usize).copied().unwrap_or(0.0)
            };
            self.shim_sigma[i] = sig.min(1.5);
            self.shim_drive[i] = [0.0; 2];
            self.shim_u[i] = [0.0; 2];
            self.shim_theta[i] = 0.0;
        }

        // ── attack transients ──────────────────────────────────────────────
        self.has_tr = false;
        let mut fade = (0.0f32, 0.0f32);
        let mut fw = 0.0f32;
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            self.tr_pos[j] = 0.0;
            self.tr_step[j] = 0.0;
            if let Some(tr) = &z.transient {
                // the recorded onset of the dominant zone only: two onsets played at different
                // speeds and mixed would smear (and comb-filter) the attack
                if j == self.dominant {
                    self.has_tr = true;
                    self.tr_step[j] = (f_target / z.f0) as f64 * (tr.rate / self.sr) as f64;
                    fade.0 += self.w[j] * tr.fade.0;
                    fade.1 += self.w[j] * tr.fade.1;
                    fw += self.w[j];
                }
            }
        }
        if fw > 0.0 {
            // A transient played faster than recorded (note above its zone) lasts less
            // time: shrink the crossfade so it completes before the recorded attack ends.
            let mut max_step = 1.0f64;
            let mut min_len_s = f32::INFINITY;
            for j in 0..self.nz {
                if let Some(tr) = &m.zones[self.zone[j]].transient {
                    if self.tr_step[j] > 0.0 {
                        max_step = max_step.max(self.tr_step[j] * self.sr as f64 / tr.rate as f64);
                        min_len_s = min_len_s.min(((tr.data.len() - 1) as f64 / self.tr_step[j] / self.sr as f64) as f32);
                    }
                }
            }
            let k = (1.0 / max_step) as f32;
            let (mut a, mut b) = (fade.0 / fw * k, fade.1 / fw * k);
            if b > min_len_s * 0.98 {
                let r = min_len_s * 0.98 / b;
                a *= r;
                b *= r;
            }
            self.tr_fade = (a, b);
        }
        // pad to a multiple of LANES with silent partials
        let kp = k.div_ceil(LANES) * LANES;
        for i in k..kp.min(MAX_PARTIALS) {
            self.base_w[i] = 0.0;
            self.re[i] = 0.0;
            self.im[i] = 0.0;
            self.gl[i] = 0.0;
            self.gr[i] = 0.0;
        }

        // ── stereo placement ───────────────────────────────────────────────
        let key_pan = m.params.key_pan * ((pitch - 64.0) / 40.0).clamp(-1.0, 1.0);
        let vpan = (on.pan + key_pan).clamp(-1.0, 1.0);
        self.voice_pan = pan_gains(vpan);
        let spread = if p.spread >= 0.0 { p.spread } else { m.params.spread };
        for i in 0..k {
            // fundamental stays near the voice position; higher partials spread out more
            let s = spread * (1.0 - 1.0 / (1.0 + i as f32 * 0.5));
            let (l, r) = pan_gains(vpan + s * on.rng.bipolar());
            self.pan_l[i] = l;
            self.pan_r[i] = r;
        }
        // recorded stereo image (organ pipes in their case, room microphones): per-partial
        // left/right gains and inter-channel phase replace the synthetic spread
        self.has_st = (0..self.nz).any(|j| m.zones[self.zone[j]].stereo.is_some());
        for i in 0..MAX_PARTIALS {
            self.st_c[i] = 1.0;
            self.st_s[i] = 0.0;
            self.grs[i] = 0.0;
            self.st_lc[i] = 1.0;
            self.st_ls[i] = 0.0;
            self.gls[i] = 0.0;
        }
        if self.has_st {
            let pg = pan_gains(on.pan.clamp(-1.0, 1.0));
            self.voice_pan = pg;
            for i in 0..k.min(self.k_h) {
                let (mut gl, mut gr, mut vc, mut vs) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for j in 0..self.nz {
                    let z = &m.zones[self.zone[j]];
                    let w = self.w[j];
                    let ii = self.look_i[j][i] as usize;
                    match &z.stereo {
                        Some(st) if ii < st.l.len() => {
                            gl += w * st.l[ii];
                            gr += w * st.r[ii];
                            vc += w * st.ph[ii].cos();
                            vs += w * st.ph[ii].sin();
                        }
                        _ => {
                            gl += w;
                            gr += w;
                            vc += w;
                        }
                    }
                }
                let norm = ((gl * gl + gr * gr) * 0.5).sqrt().max(1e-6);
                self.pan_l[i] = gl / norm * pg.0;
                self.pan_r[i] = gr / norm * pg.1;
                let vm = (vc * vc + vs * vs).sqrt().max(1e-6);
                self.st_c[i] = vc / vm;
                self.st_s[i] = vs / vm;
            }
        }

        self.has_img = self.has_st && (0..self.nz).any(|j| m.zones[self.zone[j]].image.is_some());
        self.has_lph = self.has_img
            && (0..self.nz).any(|j| m.zones[self.zone[j]].image.as_ref().map(|im| !im.lph.is_empty()).unwrap_or(false));
        if self.has_lph {
            // the recorded phase wander replaces the synthetic per-partial jitter
            for i in 0..k.min(self.k_h) {
                let covered = (0..self.nz).all(|j| {
                    m.zones[self.zone[j]]
                        .image
                        .as_ref()
                        .map(|im| !im.lph.is_empty() && im.row.get(self.look_i[j][i] as usize).map(|&r| r != u16::MAX).unwrap_or(false))
                        .unwrap_or(false)
                });
                if covered {
                    self.jit_sigma[i] = 0.0;
                }
            }
        }
        if self.has_img {
            self.update_image(m);
        }
        self.gain_db = gain;
        self.nb = m.noise_bands().min(MAX_BANDS);
        self.noise_rel_rate = dz.release_noise.max(m.params.min_release_db_s);
        self.damper_rate = match m.params.release_mode {
            ReleaseMode::Damper => m.damper_rate(pitch),
            _ => 0.0,
        };
        for b in 0..MAX_BANDS {
            self.noise_pow[b] = 0.0;
        }
    }

    /// Legato: move this sounding voice to a new note without a new attack. Oscillator
    /// phases and current amplitudes carry over (no click, no re-articulation), the new
    /// note's zones start in their sustain, and the pitch glides over `glide_s`.
    pub fn legato(&mut self, on: NoteOn, glide_s: f32) {
        if self.state != State::Playing {
            self.start(on);
            return;
        }
        let old_pitch = self.cur_pitch + self.glide_cents / 100.0;
        let old_kh = self.k_h;
        let (re, im, gl, gr) = (self.re, self.im, self.gl, self.gr);
        let t = self.t;
        let vib = self.vib_phase;
        let pph = self.pulse_ph;
        self.start(on);
        self.pulse_ph = pph;
        let n = old_kh.min(self.k_h);
        self.re[..n].copy_from_slice(&re[..n]);
        self.im[..n].copy_from_slice(&im[..n]);
        self.gl[..n].copy_from_slice(&gl[..n]);
        self.gr[..n].copy_from_slice(&gr[..n]);
        let m = Arc::clone(self.model.as_ref().unwrap());
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            self.pos[j] = match z.loop_range {
                Some((a, _)) => a as f32,
                None => m.grid.iter().position(|&g| g >= 0.3).unwrap_or(0).min(z.frames - 1) as f32,
            };
        }
        self.has_tr = false;
        self.first_block = false;
        self.t = t.max(0.3);
        self.vib_phase = vib;
        self.glide_cents = (old_pitch - self.cur_pitch) * 100.0;
        self.glide_tau = glide_s.max(0.001);
    }

    /// Per-partial stereo gains and inter-channel phase from the zones' time-varying images at
    /// the current playheads (zones without one contribute their static image).
    fn update_image(&mut self, m: &Model) {
        let lut = phase_lut();
        let pg = self.voice_pan;
        for i in 0..self.k.min(self.k_h) {
            let (mut gl, mut gr, mut vc, mut vs) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
            let (mut lc, mut ls) = (0.0f32, 0.0f32);
            for j in 0..self.nz {
                let z = &m.zones[self.zone[j]];
                let w = self.w[j];
                // Phases come from the dominant zone: two recordings' phase wander is
                // unrelated, and averaging unit vectors of unrelated phases makes them jump.
                let pw = if j == self.dominant { 1.0 } else { 1e-3 * w };
                let ii = self.look_i[j][i] as usize;
                match (&z.image, &z.stereo) {
                    (Some(im), _) if im.row.get(ii).map(|&r| r != u16::MAX).unwrap_or(false) => {
                        let ri = im.row[ii] as usize;
                        let f0 = (self.pos[j].floor() as usize).min(z.frames - 1);
                        let f1 = (f0 + 1).min(z.frames - 1);
                        let ft = self.pos[j] - f0 as f32;
                        let (am, a0, a1, a2) =
                            (f0.saturating_sub(1) * im.k + ri, f0 * im.k + ri, f1 * im.k + ri, (f1 + 1).min(z.frames - 1) * im.k + ri);
                        // phases as unit vectors, cubic between frames (a phase interpolated
                        // linearly has a stepped frequency: FM at the frame rate)
                        let vec = |tab: &[u8]| {
                            let (pm, p0, p1, p2) = (lut[tab[am] as usize], lut[tab[a0] as usize], lut[tab[a1] as usize], lut[tab[a2] as usize]);
                            (cubic_free(pm.0, p0.0, p1.0, p2.0, ft), cubic_free(pm.1, p0.1, p1.1, p2.1, ft))
                        };
                        if im.lph.is_empty() {
                            lc += pw;
                        } else {
                            let (c, sn) = vec(&im.lph);
                            lc += pw * c;
                            ls += pw * sn;
                        }
                        let ild = cubic(im.ild[am] as f32, im.ild[a0] as f32, im.ild[a1] as f32, im.ild[a2] as f32, ft) * 0.25 - 32.0;
                        // R/L amplitude ratio; gains normalised so gL² + gR² = 2
                        let r = fast_db_to_amp(-ild);
                        let l_g = (2.0 / (1.0 + r * r)).sqrt();
                        gl += w * l_g;
                        gr += w * l_g * r;
                        let (c, sn) = vec(&im.iph);
                        vc += pw * c;
                        vs += pw * sn;
                    }
                    (_, Some(st)) if ii < st.l.len() => {
                        gl += w * st.l[ii];
                        gr += w * st.r[ii];
                        vc += pw * st.ph[ii].cos();
                        vs += pw * st.ph[ii].sin();
                        lc += pw;
                    }
                    _ => {
                        gl += w;
                        gr += w;
                        vc += pw;
                        lc += pw;
                    }
                }
            }
            let norm = ((gl * gl + gr * gr) * 0.5).sqrt().max(1e-6);
            self.pan_l[i] = gl / norm * pg.0;
            self.pan_r[i] = gr / norm * pg.1;
            let vm = (vc * vc + vs * vs).sqrt().max(1e-6);
            let (ic, is) = (vc / vm, vs / vm);
            let lm = (lc * lc + ls * ls).sqrt().max(1e-6);
            let (lc, ls) = (lc / lm, ls / lm);
            self.st_lc[i] = lc;
            self.st_ls[i] = ls;
            // right = left phase + inter-channel phase
            self.st_c[i] = lc * ic - ls * is;
            self.st_s[i] = ls * ic + lc * is;
        }
    }

    /// Next ping-pong turning point inside the loop [a, b]: at least 75 % of the loop (and
    /// 0.4 s) away from the current turn `from`, at a random place beyond that.
    fn draw_turn(&mut self, m: &Model, a: usize, b: usize, from: f32, upward: bool) -> f32 {
        let g = |f: usize| m.grid.get(f).copied().unwrap_or(0.0);
        let (ta, tb) = (g(a), g(b));
        let span = tb - ta;
        let min_len = (0.75 * span).max(0.4).min(span);
        let tf = {
            let f = from.clamp(a as f32, b as f32);
            let i = f.floor() as usize;
            let fr = f - i as f32;
            g(i) + (g((i + 1).min(b)) - g(i)) * fr
        };
        let t = if upward {
            let lo = (tf + min_len).min(tb);
            lo + (tb - lo) * self.rng.uniform()
        } else {
            let hi = (tf - min_len).max(ta);
            hi - (hi - ta) * self.rng.uniform()
        };
        // time → fractional frame
        let mut i = a;
        while i < b && g(i + 1) < t {
            i += 1;
        }
        let seg = (g(i + 1) - g(i)).max(1e-6);
        (i as f32 + ((t - g(i)) / seg).clamp(0.0, 1.0)).clamp(a as f32, b as f32)
    }

    fn compute_tail_rates(&mut self, m: &Model) {
        self.tail_set = true;
        let dj = self.dominant;
        let z = &m.zones[self.zone[dj]];
        // Measure the decay over [end − 1.0 s, end − 0.25 s]: the last moments of a
        // recording are often an edit fade-out, not the instrument's own decay.
        let end = z.frames - 1;
        let t_end = m.grid[end.min(m.grid.len() - 1)];
        let mut last = end;
        while last > 0 && t_end - m.grid[last] < 0.25 {
            last -= 1;
        }
        let t_last = m.grid[last];
        let mut first = last;
        while first > 0 && t_last - m.grid[first] < 0.75 {
            first -= 1;
        }
        let span = (t_last - m.grid[first]).max(1e-3);
        for i in 0..self.k {
            let idx = if i < self.k_h { self.look_i[dj][i] as usize } else if self.slot_zone[i] as usize == dj { self.slot_idx[i] as usize } else { usize::MAX };
            let rate = if idx < z.partials {
                let a = z.amp_db(first, idx);
                let b = z.amp_db(last, idx);
                if a > -150.0 && b > -150.0 { (a - b) / span } else { 60.0 }
            } else {
                60.0
            };
            self.tail_rate[i] = rate.clamp(3.0, 90.0);
        }
    }

    fn update_static_db(&mut self, p: &SpectralParams) {
        for i in 0..self.k {
            let even = if i < self.k_h && (i & 1) == 1 { p.even_db } else { 0.0 };
            self.stat_db[i] = p.brightness * self.harm[i].log2() + even;
        }
        self.stat_key = (p.brightness, p.even_db);
    }

    /// Release-triggered one-shots (damper noises) are not released by their own key.
    pub fn layer_released_by_key(&self) -> bool {
        !self.one_shot
    }

    pub fn release(&mut self) {
        if self.state == State::Playing {
            let ring = self
                .model
                .as_ref()
                .map(|m| m.params.release_mode == ReleaseMode::RingOut)
                .unwrap_or(false);
            if ring {
                // ring-out instruments ignore note-off but are still marked released
                // so voice stealing prefers them.
                self.state = State::Released;
                self.t_rel = -1.0;
                return;
            }
            self.state = State::Released;
            self.t_rel = 0.0;
            // sustained recordings that keep their own release: jump there and play it
            if let Some(m) = self.model.as_ref() {
                let m = Arc::clone(m);
                let natural = m.kind == Kind::Sustained && m.params.release_mode == ReleaseMode::Natural;
                if natural && self.nz > 0 && (0..self.nz).all(|j| m.zones[self.zone[j]].rel_frame.is_some()) {
                    for j in 0..self.nz {
                        let rf = m.zones[self.zone[j]].rel_frame.unwrap() as f32;
                        if self.pos[j] < rf {
                            self.pos[j] = rf;
                        }
                        self.dir[j] = 1.0;
                    }
                    self.in_rel_tail = true;
                }
            }
        }
    }

    /// Fast fade-out (voice stealing / all-sound-off).
    pub fn kill(&mut self) {
        if self.state != State::Done {
            self.state = State::Killing;
        }
    }

    /// Render one block (n ≤ BLOCK) adding into `out_l`/`out_r`.
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32], p: &SpectralParams, md: &BlockMod) {
        let n = out_l.len().min(BLOCK);
        if self.state == State::Done || n == 0 {
            return;
        }
        let model = match &self.model {
            Some(m) => Arc::clone(m),
            None => {
                self.state = State::Done;
                return;
            }
        };
        let m: &Model = &model;
        let dt = n as f32 / self.sr;
        let k = self.k;
        let kp = k.div_ceil(LANES) * LANES;

        // ── advance playheads ──────────────────────────────────────────────
        let mut ended = false;
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            let fi = self.pos[j].floor() as usize;
            let fi = fi.min(z.frames - 1);
            let seg = if fi + 1 < m.grid.len() { (m.grid[fi + 1] - m.grid[fi]).max(1e-4) } else { 0.05 };
            let in_attack = z.loop_range.map(|(a, _)| fi < a).unwrap_or(self.t < 0.25);
            let rate = if self.in_rel_tail {
                1.0 / p.release_scale.max(0.05)
            } else if in_attack {
                1.0 / p.attack_scale.max(0.05)
            } else if m.kind == Kind::Decaying {
                1.0 / p.decay_scale.max(0.05)
            } else {
                1.0
            };
            let mut np = self.pos[j] + self.dir[j] * dt * rate / seg;
            if let Some((a, b)) = z.loop_range {
                if m.kind == Kind::Sustained && !self.in_rel_tail {
                    let (lo, hi) = (self.turn_lo[j], self.turn_hi[j]);
                    if np >= hi {
                        np = hi - (np - hi);
                        self.dir[j] = -1.0;
                        self.turn_lo[j] = self.draw_turn(m, a, b, hi, false);
                    } else if self.dir[j] < 0.0 && np <= lo {
                        np = lo + (lo - np);
                        self.dir[j] = 1.0;
                        self.turn_hi[j] = self.draw_turn(m, a, b, lo, true);
                    }
                }
            }
            let last = (z.frames - 1) as f32;
            if np >= last {
                np = last;
                if m.kind == Kind::Decaying
                    || self.in_rel_tail
                    || z.loop_range.is_none() && m.kind == Kind::Sustained && self.state != State::Playing
                {
                    if j == self.dominant {
                        ended = true;
                    }
                }
            }
            self.pos[j] = np.max(0.0);
        }
        self.t += dt;

        // ── release bookkeeping ────────────────────────────────────────────
        let mut release_extra = 0.0;
        if self.state == State::Released && self.t_rel >= 0.0 {
            self.t_rel += dt;
            let rs = 1.0 / p.release_scale.max(0.01);
            match m.params.release_mode {
                ReleaseMode::Natural if !self.in_rel_tail => {
                    for i in 0..k {
                        self.rel_db[i] += self.rel_rate[i] * rs * dt;
                    }
                }
                ReleaseMode::Natural => {}
                ReleaseMode::Damper => release_extra = self.damper_rate * rs * dt,
                ReleaseMode::RingOut => {}
            }
            if release_extra > 0.0 {
                for i in 0..k {
                    self.rel_db[i] += release_extra;
                }
            }
        }
        if self.state == State::Killing {
            self.kill_gain *= 0.25f32.powf(n as f32 / (0.004 * self.sr));
            if self.kill_gain < 1e-4 {
                self.state = State::Done;
                return;
            }
        }
        if ended {
            // The analysed recording is exhausted (decaying instruments): continue the free
            // decay of every partial at the rate it had over the last ~0.3 s of analysis.
            if !self.tail_set {
                self.compute_tail_rates(m);
            }
            for i in 0..k {
                self.rel_db[i] += self.tail_rate[i] * dt;
            }
        }

        // ── target amplitudes ──────────────────────────────────────────────
        let mut peak = -200.0f32;
        let common = self.gain_db + 20.0 * (md.expression_gain.max(1e-6)).log10() + 20.0 * self.kill_gain.max(1e-9).log10();
        let inv_n = 1.0 / n as f32;
        if p.brightness != self.stat_key.0 || p.even_db != self.stat_key.1 {
            self.update_static_db(p);
        }
        // per-zone frame rows and interpolation weights (hoisted out of the partial loop)
        let mut rowm: [&[u16]; MAX_ZONES] = [&[]; MAX_ZONES];
        let mut row0: [&[u16]; MAX_ZONES] = [&[]; MAX_ZONES];
        let mut row1: [&[u16]; MAX_ZONES] = [&[]; MAX_ZONES];
        let mut row2: [&[u16]; MAX_ZONES] = [&[]; MAX_ZONES];
        let mut srow0: [&[u16]; MAX_ZONES] = [&[]; MAX_ZONES];
        let mut srow1: [&[u16]; MAX_ZONES] = [&[]; MAX_ZONES];
        let mut ftj = [0.0f32; MAX_ZONES];
        let mut kh_z = [0usize; MAX_ZONES];
        let mut zgain = [0.0f32; MAX_ZONES];
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            let f0 = (self.pos[j].floor() as usize).min(z.frames - 1);
            let f1 = (f0 + 1).min(z.frames - 1);
            let fm = f0.saturating_sub(1);
            let f2 = (f1 + 1).min(z.frames - 1);
            rowm[j] = &z.amps[fm * z.partials..(fm + 1) * z.partials];
            row0[j] = &z.amps[f0 * z.partials..(f0 + 1) * z.partials];
            row1[j] = &z.amps[f1 * z.partials..(f1 + 1) * z.partials];
            row2[j] = &z.amps[f2 * z.partials..(f2 + 1) * z.partials];
            if self.nz > 1 && !z.amps_smooth.is_empty() {
                srow0[j] = &z.amps_smooth[f0 * z.partials..(f0 + 1) * z.partials];
                srow1[j] = &z.amps_smooth[f1 * z.partials..(f1 + 1) * z.partials];
            }
            ftj[j] = self.pos[j] - f0 as f32;
            kh_z[j] = z.harmonic;
            zgain[j] = z.gain_db;
        }
        if self.has_img {
            self.update_image(m);
        }
        // partials more than 96 dB below the loudest are inaudible: skip them
        let cull = (self.peak_db - 96.0).max(SILENT_DB);
        let mut tgt_l = [0.0f32; MAX_PARTIALS];
        let mut tgt_r = [0.0f32; MAX_PARTIALS];
        let kh = self.k_h;
        for i in 0..k {
            let mut db;
            if i < kh && self.morph_ok[i] {
                let j = self.dominant;
                let ii = self.look_i[j][i] as usize;
                let fr = self.look_f[j][i];
                let khj = kh_z[j];
                let q = |row: &[u16], idx: usize| if idx < khj { a16_to_db(row[idx]) } else { -200.0 };
                let ft = ftj[j];
                let mut v = cubic(q(rowm[j], ii), q(row0[j], ii), q(row1[j], ii), q(row2[j], ii), ft);
                if fr > 0.0 {
                    v = lerp(v, cubic(q(rowm[j], ii + 2), q(row0[j], ii + 2), q(row1[j], ii + 2), q(row2[j], ii + 2), ft), fr);
                }
                db = v + self.look_db[j][i] + zgain[j] + self.morph_off[i];
            } else if i < kh {
                db = 0.0;
                let detail = self.nz > 1 && !srow0[self.dominant].is_empty();
                for j in 0..self.nz {
                    let ii = self.look_i[j][i] as usize;
                    let fr = self.look_f[j][i];
                    let khj = kh_z[j];
                    let ft = ftj[j];
                    let q = |row: &[u16], idx: usize| if idx < khj { a16_to_db(row[idx]) } else { -200.0 };
                    let at = |r0: &[u16], r1: &[u16]| {
                        let a = lerp(q(r0, ii), q(r1, ii), ft);
                        if fr > 0.0 { lerp(a, lerp(q(r0, ii + 2), q(r1, ii + 2), ft), fr) } else { a }
                    };
                    // the zone's own envelope: cubic between frames (linear interpolation's
                    // corners at the frame rate are audible as a fast flutter on steady tones)
                    let at4 = || {
                        let a = cubic(q(rowm[j], ii), q(row0[j], ii), q(row1[j], ii), q(row2[j], ii), ft);
                        if fr > 0.0 {
                            lerp(a, cubic(q(rowm[j], ii + 2), q(row0[j], ii + 2), q(row1[j], ii + 2), q(row2[j], ii + 2), ft), fr)
                        } else {
                            a
                        }
                    };
                    let v = if detail {
                        // smooth envelope from every zone; the dominant zone adds its own detail
                        let sm = at(srow0[j], srow1[j]);
                        if j == self.dominant { sm + (at4() - sm).clamp(-30.0, 30.0) / self.w[j] } else { sm }
                    } else {
                        at4()
                    };
                    db += self.w[j] * (v + self.look_db[j][i] + zgain[j]);
                }
            } else {
                let j = self.slot_zone[i] as usize;
                let ii = self.slot_idx[i] as usize;
                db = cubic(a16_to_db(rowm[j][ii]), a16_to_db(row0[j][ii]), a16_to_db(row1[j][ii]), a16_to_db(row2[j][ii]), ftj[j])
                    + zgain[j]
                    + self.slot_wdb[i];
            }
            db += self.stat_db[i] - self.rel_db[i] + common;
            peak = peak.max(db);
            let amp = if db < cull { 0.0 } else { fast_db_to_amp(db) };
            tgt_l[i] = amp * self.pan_l[i];
            tgt_r[i] = amp * self.pan_r[i];
        }
        self.peak_db = peak;
        // crossfade from the recorded transient into the model
        let ga = if self.has_tr { smoothstep(self.tr_fade.0, self.tr_fade.1, self.t) } else { 1.0 };
        if ga < 1.0 {
            for i in 0..k {
                tgt_l[i] *= ga;
                tgt_r[i] *= ga;
            }
        }
        // the transient must be rendered for every block that *starts* inside the crossfade,
        // even when the model's gain has already reached 1 by the end of the block
        if self.has_tr && self.t - dt < self.tr_fade.1 {
            self.render_transient(m, out_l, out_r, n, common);
        }
        if self.first_block {
            // start partials from silence: the analysed attack provides the rise
            self.first_block = false;
        }

        // ── pitch ──────────────────────────────────────────────────────────
        let dz = &m.zones[self.zone[self.dominant]];
        let pos = self.pos[self.dominant];
        let f0i = (pos.floor() as usize).min(dz.frames - 1);
        let f1i = (f0i + 1).min(dz.frames - 1);
        let rec_cents = cubic(
            dz.pitch[f0i.saturating_sub(1)],
            dz.pitch[f0i],
            dz.pitch[f1i],
            dz.pitch[(f1i + 1).min(dz.frames - 1)],
            pos - f0i as f32,
        ) * p.expression;
        let vib_depth = p.vibrato_cents * ((self.t - p.vibrato_delay) / 0.4).clamp(0.0, 1.0) + md.mod_vibrato;
        self.vib_phase = (self.vib_phase + p.vibrato_rate * dt).fract();
        let vib = if vib_depth > 0.0 { vib_depth * (std::f32::consts::TAU * self.vib_phase).sin() } else { 0.0 };
        if self.glide_cents != 0.0 {
            self.glide_cents *= (-dt / self.glide_tau).exp();
            if self.glide_cents.abs() < 0.05 {
                self.glide_cents = 0.0;
            }
        }
        let ratio = ((rec_cents + vib + md.cents + self.detune_cents + self.glide_cents) / 1200.0).exp2();
        if self.pulse_on {
            let inc = self.pulse_inc * ratio;
            let mut ph = self.pulse_ph;
            for g in self.pulse_buf[..n].iter_mut() {
                let x = ph * PULSE_BINS as f32;
                let i0 = x as usize % PULSE_BINS;
                let fr = x - x.floor();
                *g = lerp(self.pulse_tab[i0], self.pulse_tab[(i0 + 1) % PULSE_BINS], fr);
                ph += inc;
                if ph >= 1.0 {
                    ph -= 1.0;
                }
            }
            self.pulse_ph = ph;
        }

        // ── oscillator bank ────────────────────────────────────────────────
        let mut wr = [0.0f32; MAX_PARTIALS];
        let mut wi = [0.0f32; MAX_PARTIALS];
        let mut dl = [0.0f32; MAX_PARTIALS];
        let mut dr = [0.0f32; MAX_PARTIALS];
        // jitter: each partial's phase offset is a smoothed Ornstein-Uhlenbeck process (OU driver
        // → one-pole with the same τ), so the frequency deviation is continuous with std 2π·σ_f
        // instead of the white, block-stepped FM a raw OU phase would produce.
        let jit_on = p.jitter > 0.0;
        let ja = (-dt / self.jit_tau).exp();
        let jb = (1.0 - ja * ja).sqrt() * p.jitter;
        let jc = 1.0 - ja;
        let mut jstep = [0.0f32; MAX_PARTIALS];
        if jit_on {
            for i in 0..k {
                let sig = self.jit_sigma[i];
                if sig > 0.0 {
                    let d = self.jit_drive[i] * ja + sig * jb * self.rng.gauss();
                    self.jit_drive[i] = d;
                    let step = (d - self.jit_phase[i]) * jc;
                    jstep[i] = step * inv_n;
                    self.jit_phase[i] += step;
                }
            }
        }
        // shimmer: complex multiplier m = 1 + σ·u per partial (u: smoothed OU, E|u|² = 1);
        // |m| rides the gain ramp, arg m is spread over the block as a frequency offset
        if p.shimmer > 0.0 {
            let sa = (-dt / self.shim_tau).exp();
            // unit-variance driver → each smoothed component has variance ½, so E|u|² = 1
            let sb = (1.0 - sa * sa).sqrt();
            let sc = 1.0 - sa;
            for i in 0..k {
                let sig = self.shim_sigma[i] * p.shimmer;
                if sig <= 0.0 || (tgt_l[i] == 0.0 && tgt_r[i] == 0.0) {
                    continue;
                }
                let mut u = [0.0f32; 2];
                for c in 0..2 {
                    let d = self.shim_drive[i][c] * sa + sb * self.rng.gauss();
                    self.shim_drive[i][c] = d;
                    self.shim_u[i][c] += (d - self.shim_u[i][c]) * sc;
                    u[c] = self.shim_u[i][c];
                }
                let (mr, mi) = (1.0 + sig * u[0], sig * u[1]);
                let mag = (mr * mr + mi * mi).sqrt();
                // E|m|² = 1 + σ²: the smoothed line plus the fluctuation's own power, as measured
                let g = mag;
                tgt_l[i] *= g;
                tgt_r[i] *= g;
                let th = mi.atan2(mr);
                let mut dth = th - self.shim_theta[i];
                if dth > std::f32::consts::PI {
                    dth -= std::f32::consts::TAU;
                } else if dth < -std::f32::consts::PI {
                    dth += std::f32::consts::TAU;
                }
                self.shim_theta[i] = th;
                jstep[i] += dth * inv_n;
            }
        }
        let mut tgt_s = [0.0f32; MAX_PARTIALS];
        let mut ds = [0.0f32; MAX_PARTIALS];
        let mut tgt_ls = [0.0f32; MAX_PARTIALS];
        let mut dls = [0.0f32; MAX_PARTIALS];
        if self.has_st {
            for i in 0..k {
                tgt_s[i] = tgt_r[i] * self.st_s[i];
                tgt_r[i] *= self.st_c[i];
            }
        }
        if self.has_lph {
            for i in 0..k {
                tgt_ls[i] = tgt_l[i] * self.st_ls[i];
                tgt_l[i] *= self.st_lc[i];
            }
        }
        for i in 0..kp {
            let w = (self.base_w[i] * ratio + jstep[i]).clamp(0.0, std::f32::consts::PI * 0.98);
            let (s, c) = sincos_0_pi(w);
            wr[i] = c;
            wi[i] = s;
            dl[i] = (tgt_l[i] - self.gl[i]) * inv_n;
            dr[i] = (tgt_r[i] - self.gr[i]) * inv_n;
            ds[i] = (tgt_s[i] - self.grs[i]) * inv_n;
            dls[i] = (tgt_ls[i] - self.gls[i]) * inv_n;
        }
        let mut acc_l = [[0.0f32; LANES]; BLOCK];
        let mut acc_r = [[0.0f32; LANES]; BLOCK];
        let mut c0 = 0;
        while c0 < kp {
            let mut re = [0.0f32; LANES];
            let mut im = [0.0f32; LANES];
            let mut gl = [0.0f32; LANES];
            let mut gr = [0.0f32; LANES];
            let mut cr = [0.0f32; LANES];
            let mut ci = [0.0f32; LANES];
            let mut sl = [0.0f32; LANES];
            let mut sr = [0.0f32; LANES];
            // skip groups of partials that are silent for this whole block
            let silent = (c0..c0 + LANES).all(|i| {
                self.gl[i] == 0.0 && self.gr[i] == 0.0 && self.grs[i] == 0.0 && self.gls[i] == 0.0
                    && tgt_l[i] == 0.0 && tgt_r[i] == 0.0 && tgt_s[i] == 0.0 && tgt_ls[i] == 0.0
            });
            if silent {
                // still advance the phases: a partial fading in later (after a stored attack
                // transient, or after a cull) must continue the recording's phase
                for i in c0..(c0 + LANES).min(kp) {
                    let (sn, cs) = (self.base_w[i] * ratio + jstep[i]).clamp(0.0, std::f32::consts::PI * 0.98).mul_add(n as f32, 0.0).sin_cos();
                    let (r0, i0) = (self.re[i], self.im[i]);
                    self.re[i] = r0 * cs - i0 * sn;
                    self.im[i] = r0 * sn + i0 * cs;
                }
                c0 += LANES;
                continue;
            }
            re.copy_from_slice(&self.re[c0..c0 + LANES]);
            im.copy_from_slice(&self.im[c0..c0 + LANES]);
            gl.copy_from_slice(&self.gl[c0..c0 + LANES]);
            gr.copy_from_slice(&self.gr[c0..c0 + LANES]);
            cr.copy_from_slice(&wr[c0..c0 + LANES]);
            ci.copy_from_slice(&wi[c0..c0 + LANES]);
            sl.copy_from_slice(&dl[c0..c0 + LANES]);
            sr.copy_from_slice(&dr[c0..c0 + LANES]);
            if self.has_lph {
                let mut gs = [0.0f32; LANES];
                let mut ss = [0.0f32; LANES];
                let mut gq = [0.0f32; LANES];
                let mut sq = [0.0f32; LANES];
                gs.copy_from_slice(&self.grs[c0..c0 + LANES]);
                ss.copy_from_slice(&ds[c0..c0 + LANES]);
                gq.copy_from_slice(&self.gls[c0..c0 + LANES]);
                sq.copy_from_slice(&dls[c0..c0 + LANES]);
                for s in 0..n {
                    let al = &mut acc_l[s];
                    let ar = &mut acc_r[s];
                    for l in 0..LANES {
                        let nr = re[l] * cr[l] - im[l] * ci[l];
                        let ni = re[l] * ci[l] + im[l] * cr[l];
                        re[l] = nr;
                        im[l] = ni;
                        gl[l] += sl[l];
                        gr[l] += sr[l];
                        gs[l] += ss[l];
                        gq[l] += sq[l];
                        // each channel = Re(e^{iφ_c}·rot) = cos φ_c·re − sin φ_c·im
                        al[l] += gl[l] * nr - gq[l] * ni;
                        ar[l] += gr[l] * nr - gs[l] * ni;
                    }
                }
            } else if self.has_st {
                let mut gs = [0.0f32; LANES];
                let mut ss = [0.0f32; LANES];
                gs.copy_from_slice(&self.grs[c0..c0 + LANES]);
                ss.copy_from_slice(&ds[c0..c0 + LANES]);
                for s in 0..n {
                    let al = &mut acc_l[s];
                    let ar = &mut acc_r[s];
                    for l in 0..LANES {
                        let nr = re[l] * cr[l] - im[l] * ci[l];
                        let ni = re[l] * ci[l] + im[l] * cr[l];
                        re[l] = nr;
                        im[l] = ni;
                        gl[l] += sl[l];
                        gr[l] += sr[l];
                        gs[l] += ss[l];
                        al[l] += gl[l] * nr;
                        // right channel = Re(e^{iφ}·rot) = cos φ·re − sin φ·im
                        ar[l] += gr[l] * nr - gs[l] * ni;
                    }
                }
            } else {
                for s in 0..n {
                    let al = &mut acc_l[s];
                    let ar = &mut acc_r[s];
                    for l in 0..LANES {
                        let nr = re[l] * cr[l] - im[l] * ci[l];
                        let ni = re[l] * ci[l] + im[l] * cr[l];
                        re[l] = nr;
                        im[l] = ni;
                        gl[l] += sl[l];
                        gr[l] += sr[l];
                        al[l] += gl[l] * nr;
                        ar[l] += gr[l] * nr;
                    }
                }
            }
            // renormalise the rotators (prevents slow amplitude drift)
            for l in 0..LANES {
                let m2 = re[l] * re[l] + im[l] * im[l];
                let g = 1.5 - 0.5 * m2;
                re[l] *= g;
                im[l] *= g;
            }
            self.re[c0..c0 + LANES].copy_from_slice(&re);
            self.im[c0..c0 + LANES].copy_from_slice(&im);
            c0 += LANES;
        }
        // targets reached exactly at block end
        self.gl[..k].copy_from_slice(&tgt_l[..k]);
        self.gr[..k].copy_from_slice(&tgt_r[..k]);
        self.grs[..k].copy_from_slice(&tgt_s[..k]);
        self.gls[..k].copy_from_slice(&tgt_ls[..k]);
        for s in 0..n {
            let mut l = 0.0;
            let mut r = 0.0;
            for c in 0..LANES {
                l += acc_l[s][c];
                r += acc_r[s][c];
            }
            out_l[s] += l;
            out_r[s] += r;
        }

        // ── noise band powers (summed by the part's noise generator) ─────────
        let nb = self.nb;
        if nb > 0 {
            let noise_off = p.noise_db + common
                - if self.state == State::Released && self.t_rel >= 0.0 {
                    match m.params.release_mode {
                        ReleaseMode::Natural if self.in_rel_tail => 0.0,
                        ReleaseMode::Natural => self.noise_rel_rate / p.release_scale.max(0.01) * self.t_rel,
                        ReleaseMode::Damper => self.rel_db[0],
                        ReleaseMode::RingOut => 0.0,
                    }
                } else {
                    0.0
                }
                - if ended { self.rel_db[0] } else { 0.0 };
            let mut nrow0: [&[u8]; MAX_ZONES] = [&[]; MAX_ZONES];
            let mut nrow1: [&[u8]; MAX_ZONES] = [&[]; MAX_ZONES];
            for j in 0..self.nz {
                let z = &m.zones[self.zone[j]];
                let f0 = (self.pos[j].floor() as usize).min(z.frames - 1);
                let f1 = (f0 + 1).min(z.frames - 1);
                nrow0[j] = &z.noise[f0 * nb..(f0 + 1) * nb];
                nrow1[j] = &z.noise[f1 * nb..(f1 + 1) * nb];
            }
            let tr_db = if self.has_tr { 20.0 * ga.max(1e-6).log10() } else { 0.0 };
            for b in 0..nb {
                let mut db = 0.0;
                for j in 0..self.nz {
                    let a = DB_LUT[nrow0[j][b] as usize];
                    let c = DB_LUT[nrow1[j][b] as usize];
                    db += self.w[j] * (lerp(a, c, ftj[j]) + zgain[j]);
                }
                db += noise_off + tr_db;
                // stored as band power in dB (10·log10): linear power = 10^(dB/10)
                self.noise_pow[b] = if db < -150.0 { 0.0 } else { fast_exp2(db * 0.332_192_8) };
            }
        }

        // ── termination ────────────────────────────────────────────────────
        if peak < SILENT_DB + 5.0 && self.t > 0.05 && (self.state != State::Playing || m.kind == Kind::Decaying) {
            self.state = State::Done;
            for b in 0..MAX_BANDS {
                self.noise_pow[b] = 0.0;
            }
        }
    }

    fn render_transient(&mut self, m: &Model, out_l: &mut [f32], out_r: &mut [f32], n: usize, common: f32) {
        let g = db_to_amp(common);
        let (pl, pr) = self.voice_pan;
        let t0 = self.t - n as f32 / self.sr;
        let inv_sr = 1.0 / self.sr;
        for j in 0..self.nz {
            let z = &m.zones[self.zone[j]];
            let Some(tr) = &z.transient else { continue };
            if self.tr_step[j] <= 0.0 {
                continue;
            }
            let gz = g * db_to_amp(z.gain_db);
            let data = &tr.data;
            let last = data.len() as f64 - 1.0;
            let mut pos = self.tr_pos[j];
            for s in 0..n {
                if pos >= last {
                    break;
                }
                let t = t0 + s as f32 * inv_sr;
                let gt = 1.0 - smoothstep(self.tr_fade.0, self.tr_fade.1, t);
                if gt <= 0.0 {
                    break;
                }
                let i = pos as usize;
                let fr = (pos - i as f64) as f32;
                let v = data[i] + (data[i + 1] - data[i]) * fr;
                out_l[s] += v * gz * gt * pl;
                let vr = match &tr.data_r {
                    Some(dr) => dr[i] + (dr[i + 1] - dr[i]) * fr,
                    None => v,
                };
                out_r[s] += vr * gz * gt * pr;
                pos += self.tr_step[j];
            }
            self.tr_pos[j] = pos;
        }
    }

    #[doc(hidden)]
    pub fn debug_pos(&self) -> Vec<(usize, f32, f32)> {
        (0..self.nz).map(|j| (self.zone[j], self.w[j], self.pos[j])).collect()
    }

    /// Current loudness of the voice's strongest partial, linear (for the wind model).
    pub fn level(&self) -> f32 {
        if self.state == State::Done || self.peak_db < -150.0 {
            0.0
        } else {
            fast_db_to_amp(self.peak_db)
        }
    }

    /// (left, right) pan gains used for this voice's noise contribution.
    pub fn noise_pan(&self) -> (f32, f32) {
        self.voice_pan
    }

    pub fn noise_bands(&self) -> usize {
        self.nb
    }
}

/// (cos, sin) of q/256 turns.
fn phase_lut() -> &'static [(f32, f32); 256] {
    static LUT: std::sync::OnceLock<[(f32, f32); 256]> = std::sync::OnceLock::new();
    LUT.get_or_init(|| {
        let mut t = [(1.0f32, 0.0f32); 256];
        for (q, v) in t.iter_mut().enumerate() {
            let a = q as f32 / 256.0 * std::f32::consts::TAU;
            *v = (a.cos(), a.sin());
        }
        t
    })
}

/// u8 → dB lookup (see `model::q_to_db`).
static DB_LUT: [f32; 256] = {
    let mut t = [0.0f32; 256];
    let mut i = 1;
    t[0] = -200.0;
    while i < 256 {
        t[i] = i as f32 * 0.5 - 120.0;
        i += 1;
    }
    t
};

/// 2^x, relative error < 2e-7 for x in [-126, 127].
#[inline]
fn fast_exp2(x: f32) -> f32 {
    let x = x.clamp(-126.0, 126.0);
    let xi = x.floor();
    let f = x - xi;
    let p = 1.0 + f * (0.693_147_2 + f * (0.240_226_5 + f * (0.055_504_1 + f * (0.009_618_1 + f * 0.001_333_3))));
    f32::from_bits(((xi as i32 + 127) as u32) << 23) * p
}

#[inline]
fn fast_db_to_amp(db: f32) -> f32 {
    fast_exp2(db * 0.166_096_4)
}

/// (sin x, cos x) for x in [0, π], max error ~6e-8.
#[inline]
fn sincos_0_pi(x: f32) -> (f32, f32) {
    let half = std::f32::consts::FRAC_PI_2;
    let (y, sgn) = if x > half { (std::f32::consts::PI - x, -1.0) } else { (x, 1.0) };
    let y2 = y * y;
    let s = y * (1.0 - y2 / 6.0 * (1.0 - y2 / 20.0 * (1.0 - y2 / 42.0 * (1.0 - y2 / 72.0 * (1.0 - y2 / 110.0)))));
    let c = 1.0 - y2 / 2.0 * (1.0 - y2 / 12.0 * (1.0 - y2 / 30.0 * (1.0 - y2 / 56.0 * (1.0 - y2 / 90.0 * (1.0 - y2 / 132.0)))));
    (s, sgn * c)
}

#[inline]
fn smoothstep(a: f32, b: f32, t: f32) -> f32 {
    if t <= a {
        0.0
    } else if t >= b {
        1.0
    } else {
        let x = (t - a) / (b - a);
        x * x * (3.0 - 2.0 * x)
    }
}

/// Catmull-Rom between `b` (t = 0) and `c` (t = 1), kept within the range of the four
/// points (no overshoot at onsets); linear next to silence.
#[inline]
fn cubic(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
    if a < -150.0 || b < -150.0 || c < -150.0 || d < -150.0 {
        return lerp(b, c, t);
    }
    let lo = a.min(b).min(c).min(d);
    let hi = a.max(b).max(c).max(d);
    cubic_free(a, b, c, d, t).clamp(lo, hi)
}

#[inline]
fn cubic_free(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;
    0.5 * ((2.0 * b) + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (3.0 * b - a - 3.0 * c + d) * t3)
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Find the two entries bracketing `x` in a sorted sequence given by `key`.
/// Returns (lower index, upper index, weight of upper).
fn bracket(n: usize, key: impl Fn(usize) -> f32, x: f32) -> (usize, usize, f32) {
    if n <= 1 {
        return (0, 0, 0.0);
    }
    if x <= key(0) {
        return (0, 0, 0.0);
    }
    if x >= key(n - 1) {
        return (n - 1, n - 1, 0.0);
    }
    for i in 0..n - 1 {
        let (a, b) = (key(i), key(i + 1));
        if x >= a && x <= b {
            let w = if b > a { (x - a) / (b - a) } else { 0.0 };
            return (i, i + 1, w);
        }
    }
    (n - 1, n - 1, 0.0)
}
