//! Spectral instrument models (`.ssm` files).
//!
//! A model is a set of *zones* — analysed recordings of single notes at one
//! dynamic level — each holding partial amplitude envelopes on a shared time
//! grid, partial frequency ratios, start phases, a pitch-deviation track and
//! residual-noise band envelopes. See `tools/ssm/analysis.py` for how they are
//! produced.
//!
//! File layout (after gzip decompression):
//! ```text
//! "SSM1" | u32 LE header_len | header JSON (utf-8) | pad to 4 | blob
//! ```
//! Blob arrays are referenced by byte offsets in the header.

use serde::Deserialize;

#[derive(Clone)]
pub struct ZoneStereo {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
    pub ph: Vec<f32>,
    /// `ph[i].cos()` and `ph[i].sin()` (computed once, not per block)
    pub cos: Vec<f32>,
    pub sin: Vec<f32>,
}

// (the stored fields only: model fingerprints are taken from this text)
impl std::fmt::Debug for ZoneStereo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ZoneStereo").field("l", &self.l).field("r", &self.r).field("ph", &self.ph).finish()
    }
}

/// Time-varying stereo image of the harmonics (frames × `k`, frame-major): inter-channel
/// level difference (q − 128)/4 dB (left over right) and the right channel's phase relative
/// to the left, q/256 turns.
#[derive(Clone, Debug)]
pub struct ZoneImage {
    /// number of stored rows
    pub k: usize,
    /// harmonic index → row (u16::MAX: no time-varying image, use the static one)
    pub row: Vec<u16>,
    pub ild: Vec<u8>,
    pub iph: Vec<u8>,
    /// the left channel's own phase wander (q/256 turns, relative to the start phase);
    /// empty when not stored
    pub lph: Vec<u8>,
}

#[derive(Deserialize)]
struct HStereo {
    l: Vec<u8>,
    r: Vec<u8>,
    ph: Vec<u8>,
}

/// Resolution and range of the stored pitch-synchronous noise envelope.
pub const PULSE_BINS: usize = 32;
pub const PULSE_MAX: f32 = 4.0;

pub const MAX_PARTIALS: usize = 512;

/// Most residual-noise bands a model may have (voices and the noise bank hold this many).
pub const MAX_NOISE_BANDS: usize = 32;

// Limits for untrusted model files (far above any real model): a corrupt or hostile file is
// rejected with an error instead of exhausting memory or overflowing size computations.
const MAX_MODEL_BYTES: usize = 256 << 20;
const MAX_HEADER_BYTES: usize = 16 << 20;
const MAX_MODEL_ZONES: usize = 4096;
const MAX_LAYERS: usize = 128;
const MAX_FRAMES: usize = 1 << 17;
const MAX_STORED_PARTIALS: usize = 8192;
const MAX_TRANSIENT_SAMPLES: usize = 1 << 22;

/// In-memory partial amplitudes: u16 in 1/32 dB above −160 dB (0 = silent).
pub const AMP_UNIT_DB: f32 = 1.0 / 32.0;
pub const AMP_FLOOR_DB: f32 = -160.0;

#[inline]
pub fn a16_to_db(v: u16) -> f32 {
    if v == 0 {
        -200.0
    } else {
        v as f32 * AMP_UNIT_DB + AMP_FLOOR_DB
    }
}

/// Span (s) over which a decaying instrument's zones are compared for morphing: the attack
/// and early decay, where velocity and pitch shape the timbre most.
pub const DECAY_MORPH_S: (f32, f32) = (0.02, 0.3);

/// u8 dB quantisation used for noise envelopes (and amplitude envelopes of older models).
#[inline]
pub fn q_to_db(v: u8) -> f32 {
    if v == 0 {
        -200.0
    } else {
        v as f32 * 0.5 - 120.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Excitation persists while the key is held (organ, winds, bowed strings).
    Sustained,
    /// Free decay after the excitation (piano, plucked, struck).
    Decaying,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReleaseMode {
    /// Partials decay at the per-partial release rates measured from the recording.
    Natural,
    /// A damper stops the sound (piano): extra decay rate that depends on the note.
    Damper,
    /// Note-off has no effect: the note rings out (harp, marimba without damping).
    RingOut,
}

#[derive(Clone, Debug)]
pub struct Layer {
    pub name: String,
    /// Nominal MIDI velocity this dynamic layer represents.
    pub velocity: f32,
    /// Recorded level of this layer (median over its zones, dB). Many sample libraries
    /// level-normalise their dynamic layers; the playback velocity curve compensates.
    pub level_db: f32,
}

/// The first milliseconds of the real recording, used for sharp onsets (hammer,
/// pluck, mallet) that a windowed analysis would smear. Playback crossfades into
/// the additive model between `fade.0` and `fade.1` seconds.
///
/// Kept as the file stores it, 16-bit samples and a scale: sample `i` is `data[i] as f32 *
/// k` (exactly the value a decoded `f32` copy would hold, at half the memory).
#[derive(Clone)]
pub struct Transient {
    pub data: Vec<i16>,
    /// right channel of a stereo recording (`data` is then the left channel)
    pub data_r: Option<Vec<i16>>,
    /// scale of `data` and of `data_r`
    pub k: f32,
    pub k_r: f32,
    pub rate: f32,
    pub fade: (f32, f32),
}

impl Transient {
    /// Samples (per channel).
    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Left (or mono) sample `i`.
    #[inline]
    pub fn left(&self, i: usize) -> f32 {
        self.data[i] as f32 * self.k
    }

    /// Right sample `i` (the left one for a mono recording).
    #[inline]
    pub fn right(&self, i: usize) -> f32 {
        match &self.data_r {
            Some(r) => r[i] as f32 * self.k_r,
            None => self.left(i),
        }
    }
}

/// Samples as their decoded values (the `Debug` text of a `Vec<f32>` of them).
struct Decoded<'a>(&'a [i16], f32);

impl std::fmt::Debug for Decoded<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.0.iter().map(|&x| x as f32 * self.1)).finish()
    }
}

// (as if the samples were decoded to `f32`: model fingerprints are taken from this text)
impl std::fmt::Debug for Transient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Transient")
            .field("data", &Decoded(&self.data, self.k))
            .field("data_r", &self.data_r.as_deref().map(|r| Decoded(r, self.k_r)))
            .field("rate", &self.rate)
            .field("fade", &self.fade)
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct Zone {
    pub note: f32,
    pub f0: f32,
    pub layer: usize,
    pub partials: usize,
    /// The first `harmonic` partials are index-aligned harmonics (morphable across
    /// zones); the rest are free (inharmonic) partials that crossfade between zones.
    pub harmonic: usize,
    pub frames: usize,
    pub loop_range: Option<(usize, usize)>,
    pub ratios: Vec<f32>,
    pub phases: Vec<f32>,
    /// frames × partials, dB in 1/32 dB units (see [`a16_to_db`]).
    pub amps: Vec<u16>,
    /// `amps` smoothed over ~0.6 s (computed at load): when notes are morphed between
    /// recordings, the smooth envelopes are mixed and only the nearest zone's own detail
    /// (beating, timbre drift) is added back, instead of averaging it away.
    pub amps_smooth: Vec<u16>,
    /// Decaying instruments: each harmonic's mean level (dB) over the attack and early decay
    /// (`DECAY_MORPH_S`), the reference at which notes are morphed between zones (computed
    /// at load; empty: the level at the loop start or at 0.5 s).
    pub morph_ref: Vec<f32>,
    /// Mean level (dB) of each harmonic and of each noise band over the frames the recorded
    /// onset covers (zones with a transient, in models that blend zones; computed at load).
    pub onset_db: Vec<f32>,
    pub onset_noise: Vec<f32>,
    /// frame times (s): the zone's own grid (dense around a recorded release) or the model's
    pub grid: Vec<f32>,
    /// frames, cents relative to f0.
    pub pitch: Vec<f32>,
    /// frames × bands, quantised dB.
    pub noise: Vec<u8>,
    /// Release decay per partial, dB/s.
    pub release: Vec<f32>,
    pub release_noise: f32,
    pub gain_db: f32,
    pub transient: Option<Transient>,
    /// Independent frequency jitter per partial (cents std) and its correlation time.
    pub jitter: Vec<f32>,
    pub jitter_tau: f32,
    /// Pitch-synchronous noise envelope: noise amplitude over one period of the fundamental
    /// (`PULSE_BINS` values with unit mean square), empty when the noise is stationary.
    pub pulse: Vec<f32>,
    /// Fast complex fluctuation of each partial relative to its smoothed trajectory (std of
    /// |a − ā| / |ā|) and its correlation time: the energy real partials spread around their
    /// line, which the smoothed model alone would lose (or misplace into the noise bands).
    pub shimmer: Vec<f32>,
    pub shimmer_tau: f32,
    /// Frame where the recording's own release begins (sustained instruments whose analysed
    /// recording keeps its release and room tail after the loop).
    pub rel_frame: Option<usize>,
    /// Alternative releases recorded after shorter key presses (GrandOrgue's
    /// `MaxKeyPressTime`): (longest hold in seconds, first frame), by increasing hold. Each
    /// is a frame segment after the main release, ending where the next begins.
    pub alt_rel: Vec<(f32, usize)>,
    /// End (exclusive) of the main recording: the frames before the first alternative release.
    pub main_end: usize,
    /// Recorded stereo image per harmonic partial (spaced microphones in a room): left/right
    /// gains (l² + r² = 2) and the right channel's phase relative to the left.
    pub stereo: Option<ZoneStereo>,
    /// Time-varying stereo image (overrides `stereo` where present).
    pub image: Option<ZoneImage>,
}

impl Zone {
    /// End (exclusive) of the frame segment starting at `start`: the main recording ends at
    /// the first alternative release, each alternative release at the next one.
    pub fn segment_end(&self, start: usize) -> usize {
        if start < self.main_end {
            return self.main_end;
        }
        self.alt_rel.iter().map(|&(_, f)| f).filter(|&f| f > start).min().unwrap_or(self.frames)
    }

    #[inline]
    pub fn amp_db(&self, frame: usize, partial: usize) -> f32 {
        if partial >= self.partials {
            return -200.0;
        }
        a16_to_db(self.amps[frame * self.partials + partial])
    }

    /// Amplitude of harmonic `partial` (free partials are never read as harmonics).
    #[inline]
    pub fn harm_db(&self, frame: usize, partial: usize) -> f32 {
        if partial >= self.harmonic {
            return -200.0;
        }
        a16_to_db(self.amps[frame * self.partials + partial])
    }

    /// Frames `a..b` (at least one) whose times lie in [t0, t1] s.
    pub fn frames_between(&self, t0: f32, t1: f32) -> (usize, usize) {
        let a = self.grid.iter().position(|&g| g >= t0).unwrap_or(0).min(self.frames - 1);
        let b = self.grid.iter().position(|&g| g > t1).unwrap_or(self.frames).clamp(a + 1, self.frames);
        (a, b)
    }

    /// Mean power (dB) of harmonic `partial` over frames `a..b` (`harm_db` of frame `a` when
    /// the range holds one frame).
    pub fn harm_db_mean(&self, a: usize, b: usize, partial: usize) -> f32 {
        if b <= a + 1 {
            return self.harm_db(a, partial);
        }
        if partial >= self.harmonic {
            return -200.0;
        }
        let mut acc = 0.0f64;
        for f in a..b {
            let db = a16_to_db(self.amps[f * self.partials + partial]);
            if db > -150.0 {
                acc += 10f64.powf(db as f64 / 10.0);
            }
        }
        if acc <= 0.0 {
            return -200.0;
        }
        (10.0 * (acc / (b - a) as f64).log10()) as f32
    }
}

/// Instrument-level defaults that shape playback. All are overridable at runtime.
#[derive(Clone, Debug)]
pub struct ModelParams {
    pub gain_db: f32,
    /// 0 = interpolate partial amplitudes by partial index (pianos, pipes);
    /// 1 = by frequency, preserving fixed body formants (violins, voices, winds).
    pub formant: f32,
    pub release_mode: ReleaseMode,
    /// For `Damper`: (note, extra decay dB/s) breakpoints.
    pub damper: Vec<(f32, f32)>,
    /// Notes at or above this have no damper.
    pub undamped_from: f32,
    /// Default release-rate scale (for natural release); also a floor in dB/s.
    pub min_release_db_s: f32,
    /// Stereo spread of partials (0..1).
    pub spread: f32,
    /// Pan by key position (-1..1 over the keyboard), e.g. piano low-left/high-right.
    pub key_pan: f32,
    /// Suggested global reverb preset name.
    pub reverb: Option<String>,
    pub reverb_send: f32,
    pub pitch_jitter_cents: f32,
    pub velocity_brightness: f32,
    /// Keep each recorded note's own tuning (organ pipes, piano stretch, celestes)
    /// instead of normalising every zone to equal temperament.
    pub recorded_tuning: bool,
    /// Interpolate between neighbouring pitches (false: play the nearest recorded note,
    /// transposed — for inharmonic bars and bells, whose mode sets do not correspond).
    pub pitch_morph: bool,
    /// Loudness vs velocity: level(v) = top layer level + velocity_db · 40·log10(v/127).
    /// 1.0 ≈ piano (v=40 → −20 dB), 0 = not touch-sensitive (organ).
    pub velocity_db: f32,
}

impl Default for ModelParams {
    fn default() -> Self {
        Self {
            gain_db: 0.0,
            formant: 0.0,
            release_mode: ReleaseMode::Natural,
            damper: vec![],
            undamped_from: 128.0,
            min_release_db_s: 20.0,
            spread: 0.3,
            key_pan: 0.0,
            reverb: None,
            reverb_send: 0.25,
            pitch_jitter_cents: 0.0,
            velocity_brightness: 0.0,
            recorded_tuning: false,
            pitch_morph: true,
            velocity_db: 0.7,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Model {
    pub name: String,
    pub display_name: String,
    pub family: String,
    pub kind: Kind,
    pub source: String,
    pub grid: Vec<f32>,
    pub noise_edges: Vec<f32>,
    pub layers: Vec<Layer>,
    pub zones: Vec<Zone>,
    pub params: ModelParams,
    /// Per layer: zone indices sorted by note.
    pub by_layer: Vec<Vec<usize>>,
    pub note_range: (f32, f32),
}

// ── header JSON ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HLayer {
    name: String,
    velocity: f32,
    #[serde(default)]
    level: Option<f32>,
}

#[derive(Deserialize)]
struct HOffsets {
    ratios: usize,
    phases: usize,
    amps: usize,
    pitch: usize,
    noise: usize,
    release: usize,
    #[serde(default)]
    jitter: Option<usize>,
    /// 16-bit amplitude envelopes (time-delta coded, low/high byte planes, partial-major),
    /// in units of `ampsStep` dB above −160 dB; replaces the u8 `amps` when present.
    #[serde(default)]
    amps16: Option<usize>,
    #[serde(rename = "ampsStep", default)]
    amps_step: Option<f32>,
    #[serde(default)]
    ild: Option<usize>,
    #[serde(default)]
    iph: Option<usize>,
    #[serde(rename = "imgK", default)]
    img_k: Option<usize>,
    #[serde(default)]
    lph: Option<usize>,
    /// harmonics that have image rows (absent: the first `imgK` harmonics)
    #[serde(rename = "imgIdx", default)]
    img_idx: Option<Vec<usize>>,
    /// the zone's own frame times (f32 seconds, `frames` values); absent: the model's grid
    #[serde(default)]
    grid: Option<usize>,
}

#[derive(Deserialize)]
struct HTransient {
    o: usize,
    n: usize,
    #[serde(default)]
    enc: Option<String>,
    scale: f32,
    rate: f32,
    fade: (f32, f32),
    /// right channel (same length and encoding) for stereo zones
    #[serde(default)]
    o_r: Option<usize>,
    #[serde(default)]
    scale_r: Option<f32>,
}

#[derive(Deserialize)]
struct HZone {
    note: f32,
    f0: f32,
    layer: usize,
    partials: usize,
    #[serde(default)]
    harmonic: Option<usize>,
    frames: usize,
    #[serde(rename = "loop")]
    loop_range: Option<(usize, usize)>,
    #[serde(rename = "releaseNoise", default)]
    release_noise: f32,
    #[serde(rename = "gainDb", default)]
    gain_db: f32,
    #[serde(default)]
    transient: Option<HTransient>,
    #[serde(rename = "jitterTau", default)]
    jitter_tau: Option<f32>,
    #[serde(default)]
    pulse: Vec<u8>,
    #[serde(default)]
    shimmer: Vec<u8>,
    #[serde(rename = "shimmerTau", default)]
    shimmer_tau: Option<f32>,
    #[serde(rename = "relFrame", default)]
    rel_frame: Option<usize>,
    #[serde(rename = "altRel", default)]
    alt_rel: Vec<(f32, usize)>,
    #[serde(default)]
    stereo: Option<HStereo>,
    o: HOffsets,
}

/// Valid alternative releases of a zone: inside the frames, after the main release, sorted.
fn alt_rel(hz: &HZone, t: usize) -> Vec<(f32, usize)> {
    let Some(rf) = hz.rel_frame else { return Vec::new() };
    let mut v: Vec<(f32, usize)> = hz.alt_rel.iter().copied().filter(|&(h, f)| h > 0.0 && f > rf && f < t.saturating_sub(2)).collect();
    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    v
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HParams {
    #[serde(rename = "gainDb")]
    gain_db: Option<f32>,
    formant: Option<f32>,
    #[serde(rename = "releaseMode")]
    release_mode: Option<String>,
    damper: Option<Vec<(f32, f32)>>,
    #[serde(rename = "undampedFrom")]
    undamped_from: Option<f32>,
    #[serde(rename = "minReleaseDbS")]
    min_release_db_s: Option<f32>,
    spread: Option<f32>,
    #[serde(rename = "keyPan")]
    key_pan: Option<f32>,
    reverb: Option<String>,
    #[serde(rename = "reverbSend")]
    reverb_send: Option<f32>,
    #[serde(rename = "pitchJitterCents")]
    pitch_jitter_cents: Option<f32>,
    #[serde(rename = "velocityBrightness")]
    velocity_brightness: Option<f32>,
    tuning: Option<String>,
    #[serde(rename = "pitchMorph")]
    pitch_morph: Option<bool>,
    #[serde(rename = "velocityDb")]
    velocity_db: Option<f32>,
}

#[derive(Deserialize)]
struct Header {
    format: u32,
    name: String,
    #[serde(rename = "displayName", default)]
    display_name: String,
    #[serde(default)]
    family: String,
    kind: String,
    #[serde(default)]
    source: String,
    grid: Vec<f32>,
    #[serde(rename = "noiseEdges")]
    noise_edges: Vec<f32>,
    layers: Vec<HLayer>,
    zones: Vec<HZone>,
    #[serde(default)]
    params: HParams,
}

impl Header {
    /// Model-level sanity checks (counts, sizes, finite numbers).
    fn validate(&self) -> Result<(), String> {
        if self.layers.is_empty() || self.layers.len() > MAX_LAYERS {
            return Err(format!("model must have 1–{MAX_LAYERS} layers (has {})", self.layers.len()));
        }
        if self.zones.is_empty() || self.zones.len() > MAX_MODEL_ZONES {
            return Err(format!("model must have 1–{MAX_MODEL_ZONES} zones (has {})", self.zones.len()));
        }
        if self.noise_edges.len().saturating_sub(1) > MAX_NOISE_BANDS {
            return Err(format!("model has more than {MAX_NOISE_BANDS} noise bands"));
        }
        if self.noise_edges.iter().any(|e| !e.is_finite() || *e < 0.0) || self.noise_edges.windows(2).any(|w| w[1] <= w[0]) {
            return Err("model noise band edges must be increasing frequencies".into());
        }
        if self.grid.len() > MAX_FRAMES || self.grid.iter().any(|g| !g.is_finite()) {
            return Err("model time grid out of range".into());
        }
        for l in &self.layers {
            check_finite(l.velocity, "layer velocity")?;
            check_opt(l.level, "layer level")?;
        }
        let p = &self.params;
        for (v, what) in [
            (p.gain_db, "gainDb"),
            (p.formant, "formant"),
            (p.undamped_from, "undampedFrom"),
            (p.min_release_db_s, "minReleaseDbS"),
            (p.spread, "spread"),
            (p.key_pan, "keyPan"),
            (p.reverb_send, "reverbSend"),
            (p.pitch_jitter_cents, "pitchJitterCents"),
            (p.velocity_brightness, "velocityBrightness"),
            (p.velocity_db, "velocityDb"),
        ] {
            check_opt(v, what)?;
        }
        for &(n, r) in p.damper.iter().flatten() {
            check_finite(n, "damper note")?;
            check_finite(r, "damper rate")?;
        }
        Ok(())
    }
}

impl HZone {
    fn validate(&self, layers: usize) -> Result<(), String> {
        if self.frames == 0 || self.frames > MAX_FRAMES {
            return Err(format!("zone frame count {} out of range", self.frames));
        }
        if self.partials > MAX_STORED_PARTIALS {
            return Err(format!("zone partial count {} out of range", self.partials));
        }
        if self.layer >= layers {
            return Err(format!("zone layer {} out of range", self.layer));
        }
        check_finite(self.note, "zone note")?;
        if !(self.f0.is_finite() && self.f0 > 0.0) {
            return Err("zone f0 must be a positive frequency".into());
        }
        check_finite(self.release_noise, "zone releaseNoise")?;
        check_finite(self.gain_db, "zone gainDb")?;
        check_opt(self.jitter_tau, "zone jitterTau")?;
        check_opt(self.shimmer_tau, "zone shimmerTau")?;
        check_opt(self.o.amps_step, "zone ampsStep")?;
        if self.alt_rel.len() > MAX_FRAMES {
            return Err("zone has too many alternative releases".into());
        }
        for &(hold, _) in &self.alt_rel {
            check_finite(hold, "zone altRel hold time")?;
        }
        if let Some(t) = &self.transient {
            if t.n > MAX_TRANSIENT_SAMPLES {
                return Err("zone transient too long".into());
            }
            check_finite(t.scale, "transient scale")?;
            check_finite(t.rate, "transient rate")?;
            check_finite(t.fade.0, "transient fade")?;
            check_finite(t.fade.1, "transient fade")?;
            check_opt(t.scale_r, "transient scale")?;
        }
        if let Some(ik) = self.o.img_k {
            // image rows belong to stored harmonics
            let kmax = self.partials.min(MAX_PARTIALS);
            if ik > kmax {
                return Err("zone image row count out of range".into());
            }
            if let Some(idx) = &self.o.img_idx {
                if idx.len() > kmax || idx.iter().any(|&h| h >= kmax) {
                    return Err("zone image index out of range".into());
                }
            }
        }
        Ok(())
    }
}

fn slice<'a>(blob: &'a [u8], off: usize, len: usize, what: &str) -> Result<&'a [u8], String> {
    off.checked_add(len)
        .and_then(|end| blob.get(off..end))
        .ok_or_else(|| format!("model blob truncated reading {what}"))
}

/// Product of array dimensions, or an error when it overflows.
fn dims(d: &[usize], what: &str) -> Result<usize, String> {
    d.iter().try_fold(1usize, |a, &b| a.checked_mul(b)).ok_or_else(|| format!("model {what} size out of range"))
}

fn check_finite(x: f32, what: &str) -> Result<f32, String> {
    if x.is_finite() {
        Ok(x)
    } else {
        Err(format!("model {what} is not a finite number"))
    }
}

fn check_opt(x: Option<f32>, what: &str) -> Result<(), String> {
    x.map(|v| check_finite(v, what)).transpose().map(|_| ())
}

/// Frames whose grid times lie within ±`half_s` of each frame's: (first, last), both
/// non-decreasing.
fn smooth_windows(frames: usize, grid: &[f32], half_s: f32) -> (Vec<usize>, Vec<usize>) {
    let t = |f: usize| grid.get(f).copied().unwrap_or(f as f32 * 0.05);
    let (mut lo, mut hi) = (vec![0usize; frames], vec![0usize; frames]);
    let (mut a, mut b) = (0usize, 0usize);
    for f in 0..frames {
        while t(a) < t(f) - half_s {
            a += 1;
        }
        while b + 1 < frames && t(b + 1) <= t(f) + half_s {
            b += 1;
        }
        lo[f] = a;
        hi[f] = b.max(f);
    }
    (lo, hi)
}

/// Moving average of quantised dB rows (frames × partials) over ±`half_s` of grid time,
/// rounded half up.
///
/// A running sum per partial slides along the frames (each row is added once and taken away
/// once). The sums are integers held exactly in f64; the rounded mean ⌊(S + ⌊n/2⌋)/n⌋ is
/// computed as ⌊(S + ⌊n/2⌋)·(1/n) + 2⁻²⁰⌋, which is exact: the product is within 2⁻³⁵ of the true
/// quotient (≤ 65536), and a quotient that is not an integer is at least 1/n ≥ 2⁻¹⁷ below the
/// next one (n ≤ `MAX_FRAMES`).
fn smooth_rows(amps: &[u16], frames: usize, partials: usize, grid: &[f32], half_s: f32) -> Vec<u16> {
    if frames == 0 || partials == 0 {
        return amps.to_vec();
    }
    debug_assert!(frames <= MAX_FRAMES);
    let (lo, hi) = smooth_windows(frames, grid, half_s);
    let mut out = vec![0u16; amps.len()];
    let mut sum = vec![0f64; partials];
    // rows a..b are in `sum`
    let (mut a, mut b) = (0usize, 0usize);
    for f in 0..frames {
        while b <= hi[f] {
            // silence (0) counts as the floor of the scale, not as −200 dB
            for (s, &v) in sum.iter_mut().zip(&amps[b * partials..(b + 1) * partials]) {
                *s += v.max(1) as i32 as f64;
            }
            b += 1;
        }
        while a < lo[f] {
            for (s, &v) in sum.iter_mut().zip(&amps[a * partials..(a + 1) * partials]) {
                *s -= v.max(1) as i32 as f64;
            }
            a += 1;
        }
        let n = b - a;
        let (half, inv) = ((n / 2) as f64, 1.0 / n as f64);
        let row = f * partials..(f + 1) * partials;
        for ((o, &v), &s) in out[row.clone()].iter_mut().zip(&amps[row]).zip(&sum) {
            // (≤ 65535.5: no overflow)
            let m = ((s + half) * inv + 1.0 / (1u32 << 20) as f64) as i32;
            *o = if v == 0 { 0 } else { m.min(u16::MAX as i32) as u16 };
        }
    }
    out
}

/// Decode partial-major, time-delta-coded u8 envelopes into frame-major values,
/// keeping the first `keep` of `k` columns.
fn undelta_pm(b: &[u8], t: usize, _k: usize, keep: usize) -> Vec<u8> {
    let mut out = vec![0u8; t * keep];
    for (c, col) in b.chunks_exact(t.max(1)).take(keep).enumerate() {
        let mut acc = 0u8;
        for (o, &d) in out[c..].iter_mut().step_by(keep).zip(col) {
            acc = acc.wrapping_add(d);
            *o = acc;
        }
    }
    out
}

/// Partial-major, time-delta coded i16 (low byte plane, then high byte plane) → frame-major
/// u16 amplitudes in 1/32 dB, keeping the first `keep` of `k` columns.
fn undelta_pm16(b: &[u8], t: usize, k: usize, keep: usize, step_db: f32) -> Vec<u16> {
    let (lo, hi) = b.split_at(t * k);
    let mut out = vec![0u16; t * keep];
    if t == 0 {
        return out;
    }
    let scale = step_db / AMP_UNIT_DB;
    // A whole-number scale (1/16 dB steps: ×2, every model so far) is an integer product: the
    // same values as rounding the float product (exact below 2²⁴), without the float rounding.
    let int_scale = ((1.0..=512.0).contains(&scale) && scale.fract() == 0.0).then_some(scale as u32);
    for (c, (lo, hi)) in lo.chunks_exact(t).zip(hi.chunks_exact(t)).take(keep).enumerate() {
        let mut acc = 0i16;
        let col = out[c..].iter_mut().step_by(keep).zip(lo.iter().zip(hi));
        match int_scale {
            Some(s) => {
                for (o, (&l, &h)) in col {
                    acc = acc.wrapping_add(i16::from_le_bytes([l, h]));
                    *o = (acc.max(0) as u32 * s).min(u16::MAX as u32) as u16;
                }
            }
            None => {
                for (o, (&l, &h)) in col {
                    acc = acc.wrapping_add(i16::from_le_bytes([l, h]));
                    *o = if acc <= 0 { 0 } else { ((acc as f32 * scale).round() as u32).min(u16::MAX as u32) as u16 };
                }
            }
        }
    }
    out
}

/// Decompress gzip data (the first member) of at most `limit` bytes (a small file can inflate
/// to any size). The data's CRC and length are checked.
fn gunzip(bytes: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    use flate2::{Decompress, FlushDecompress, Status};
    let too_large = || format!("model larger than {} MiB uncompressed", limit >> 20);
    // the trailer's length field sizes the output in one allocation (when it is plausible:
    // deflate expands at most ~1032×), so the data is neither copied nor zeroed while it grows
    let hint = match bytes.len().checked_sub(4).and_then(|i| bytes.get(i..)) {
        Some(t) => (u32::from_le_bytes([t[0], t[1], t[2], t[3]]) as usize).min(bytes.len().saturating_mul(1032)),
        None => 0,
    };
    let mut out: Vec<u8> = Vec::with_capacity(hint.min(limit) + 1);
    let mut d = Decompress::new_gzip(15);
    loop {
        let input = bytes.get(d.total_in() as usize..).unwrap_or(&[]);
        let before = (d.total_in(), d.total_out());
        let status = d.decompress_vec(input, &mut out, FlushDecompress::Finish).map_err(|e| format!("gzip: {e}"))?;
        if out.len() > limit {
            return Err(too_large());
        }
        match status {
            Status::StreamEnd => return Ok(out),
            _ if out.len() < out.capacity() && (d.total_in(), d.total_out()) == before => {
                return Err("gzip: unexpected end of file".into());
            }
            _ => {
                if out.len() == out.capacity() {
                    out.reserve((out.capacity() / 2).max(1 << 16).min(limit + 1 - out.len()));
                }
            }
        }
    }
}

fn f32s(b: &[u8]) -> Vec<f32> {
    b.as_chunks::<4>().0.iter().map(|&c| f32::from_le_bytes(c)).collect()
}

impl Model {
    /// Parse a model from bytes (gzip-compressed or raw).
    pub fn from_bytes(bytes: &[u8]) -> Result<Model, String> {
        let raw: Vec<u8>;
        let data: &[u8] = if bytes.len() > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
            raw = gunzip(bytes, MAX_MODEL_BYTES)?;
            &raw
        } else {
            bytes
        };
        if data.len() > MAX_MODEL_BYTES {
            return Err(format!("model larger than {} MiB", MAX_MODEL_BYTES >> 20));
        }
        if data.len() < 8 || &data[0..4] != b"SSM1" {
            return Err("not a supersynth model (bad magic)".into());
        }
        let hlen = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        if hlen > MAX_HEADER_BYTES {
            return Err("model header too large".into());
        }
        let hjson = data.get(8..8 + hlen).ok_or("truncated header")?;
        let h: Header = serde_json::from_slice(hjson).map_err(|e| format!("header: {e}"))?;
        if h.format != 1 {
            return Err(format!("unsupported model format {}", h.format));
        }
        h.validate()?;
        let blob_start = (8 + hlen + 3) & !3;
        let blob = data.get(blob_start..).ok_or("missing blob")?;
        let nb = h.noise_edges.len().saturating_sub(1);

        let mut zones: Vec<Zone> = Vec::with_capacity(h.zones.len());
        for hz in &h.zones {
            hz.validate(h.layers.len())?;
            let k = hz.partials.min(MAX_PARTIALS);
            let kk = hz.partials;
            let t = hz.frames;
            let zgrid = match hz.o.grid {
                Some(o) => f32s(slice(blob, o, dims(&[t, 4], "grid")?, "grid")?),
                None => {
                    if t > h.grid.len() {
                        return Err("zone frame count out of range".into());
                    }
                    h.grid[..t].to_vec()
                }
            };
            if zgrid.iter().any(|g| !g.is_finite()) || zgrid.windows(2).any(|w| w[1] <= w[0]) {
                return Err("zone frame times out of range".into());
            }
            let ratios_all = f32s(slice(blob, hz.o.ratios, dims(&[kk, 4], "ratios")?, "ratios")?);
            if ratios_all.iter().any(|r| !r.is_finite()) {
                return Err("model partial ratio is not a finite number".into());
            }
            let phases_q = slice(blob, hz.o.phases, kk, "phases")?;
            let amps = match hz.o.amps16 {
                Some(o) => undelta_pm16(slice(blob, o, dims(&[t, kk, 2], "amps16")?, "amps16")?, t, kk, k, hz.o.amps_step.unwrap_or(1.0 / 16.0)),
                None => {
                    // u8 0.5 dB codes → 1/32 dB units
                    let a8 = undelta_pm(slice(blob, hz.o.amps, dims(&[t, kk], "amps")?, "amps")?, t, kk, k);
                    let lut: [u16; 256] =
                        std::array::from_fn(|q| if q == 0 { 0 } else { ((q_to_db(q as u8) - AMP_FLOOR_DB) / AMP_UNIT_DB).round().max(1.0) as u16 });
                    a8.iter().map(|&q| lut[q as usize]).collect()
                }
            };
            let pitch_q = slice(blob, hz.o.pitch, dims(&[t, 2], "pitch")?, "pitch")?;
            let noise = undelta_pm(slice(blob, hz.o.noise, dims(&[t, nb], "noise")?, "noise")?, t, nb, nb);
            let rel_q = slice(blob, hz.o.release, kk, "release")?;
            zones.push(Zone {
                note: hz.note,
                f0: hz.f0,
                layer: hz.layer,
                partials: k,
                harmonic: hz.harmonic.unwrap_or(kk).min(k),
                frames: t,
                loop_range: hz.loop_range.filter(|(a, b)| a < b && *b < t),
                ratios: ratios_all[..k].to_vec(),
                phases: phases_q[..k].iter().map(|&q| q as f32 * (std::f32::consts::TAU / 256.0)).collect(),
                amps,
                amps_smooth: Vec::new(),
                morph_ref: Vec::new(),
                onset_db: Vec::new(),
                onset_noise: Vec::new(),
                grid: zgrid,
                pitch: pitch_q.as_chunks::<2>().0.iter().map(|&c| i16::from_le_bytes(c) as f32 / 100.0).collect(),
                noise,
                release: rel_q[..k].iter().map(|&q| q as f32 * 2.0).collect(),
                release_noise: hz.release_noise,
                gain_db: hz.gain_db,
                jitter: match hz.o.jitter {
                    Some(off) => slice(blob, off, kk, "jitter")?[..k].iter().map(|&q| q as f32 / 10.0).collect(),
                    None => vec![0.0; k],
                },
                jitter_tau: hz.jitter_tau.unwrap_or(0.025).clamp(0.002, 0.5),
                shimmer: hz.shimmer.iter().map(|&q| q as f32 / 100.0).collect(),
                shimmer_tau: hz.shimmer_tau.unwrap_or(0.01).clamp(0.001, 0.2),
                rel_frame: hz.rel_frame.filter(|&f| f + 2 < t),
                alt_rel: alt_rel(hz, t),
                main_end: hz.alt_rel.iter().map(|&(_, f)| f).min().unwrap_or(t).clamp(1, t),
                image: match (hz.o.ild, hz.o.iph, hz.o.img_k) {
                    (Some(a), Some(b), Some(ik)) if ik > 0 => Some(ZoneImage {
                        k: ik,
                        row: {
                            let idx: Vec<usize> = hz.o.img_idx.clone().unwrap_or_else(|| (0..ik).collect());
                            let n = idx.iter().copied().max().map(|m| m + 1).unwrap_or(0);
                            let mut row = vec![u16::MAX; n];
                            for (r, &h) in idx.iter().enumerate().take(ik) {
                                row[h] = r as u16;
                            }
                            row
                        },
                        ild: undelta_pm(slice(blob, a, dims(&[t, ik], "ild")?, "ild")?, t, ik, ik),
                        iph: undelta_pm(slice(blob, b, dims(&[t, ik], "iph")?, "iph")?, t, ik, ik),
                        lph: match hz.o.lph {
                            Some(o) => undelta_pm(slice(blob, o, dims(&[t, ik], "lph")?, "lph")?, t, ik, ik),
                            None => Vec::new(),
                        },
                    }),
                    _ => None,
                },
                stereo: hz.stereo.as_ref().filter(|st| st.l.len() == st.r.len() && st.l.len() == st.ph.len()).map(|st| {
                    let g = |q: &u8| *q as f32 / 255.0 * std::f32::consts::SQRT_2;
                    let ph: Vec<f32> = st.ph.iter().map(|&q| q as f32 / 255.0 * std::f32::consts::TAU - std::f32::consts::PI).collect();
                    ZoneStereo {
                        l: st.l.iter().map(g).collect(),
                        r: st.r.iter().map(g).collect(),
                        cos: ph.iter().map(|p| p.cos()).collect(),
                        sin: ph.iter().map(|p| p.sin()).collect(),
                        ph,
                    }
                }),
                pulse: if hz.pulse.len() == PULSE_BINS {
                    hz.pulse.iter().map(|&q| q as f32 * (PULSE_MAX / 255.0)).collect()
                } else {
                    Vec::new()
                },
                transient: match &hz.transient {
                    Some(t) if t.n > 4 && t.rate > 0.0 => {
                        let decode = |o: usize| -> Result<Vec<i16>, String> {
                            let b = slice(blob, o, dims(&[t.n, 2], "transient")?, "transient")?;
                            Ok(if t.enc.as_deref() == Some("dp16") {
                                // first differences, low byte plane then high byte plane
                                let (lo, hi) = b.split_at(t.n);
                                let mut acc = 0i16;
                                lo.iter()
                                    .zip(hi)
                                    .map(|(&l, &h)| {
                                        acc = acc.wrapping_add(i16::from_le_bytes([l, h]));
                                        acc
                                    })
                                    .collect()
                            } else {
                                b.as_chunks::<2>().0.iter().map(|&c| i16::from_le_bytes(c)).collect()
                            })
                        };
                        let data_r = match t.o_r {
                            Some(o) => Some(decode(o)?),
                            None => None,
                        };
                        Some(Transient {
                            data_r,
                            data: decode(t.o)?,
                            k: t.scale / 32767.0,
                            k_r: t.scale_r.unwrap_or(t.scale) / 32767.0,
                            rate: t.rate,
                            fade: (t.fade.0.max(0.0), t.fade.1.max(t.fade.0 + 1e-3)),
                        })
                    }
                    _ => None,
                },
            });
        }
        if zones.is_empty() {
            return Err("model has no zones".into());
        }
        let layers: Vec<Layer> =
            h.layers.into_iter().map(|l| Layer { name: l.name, velocity: l.velocity, level_db: l.level.unwrap_or(0.0) }).collect();
        let nl = layers.len().max(1);
        let mut by_layer = vec![Vec::new(); nl];
        for (i, z) in zones.iter().enumerate() {
            if z.layer < nl {
                by_layer[z.layer].push(i);
            }
        }
        for v in &mut by_layer {
            v.sort_by(|&a, &b| zones[a].note.total_cmp(&zones[b].note));
        }
        let lo = zones.iter().map(|z| z.note).fold(f32::INFINITY, f32::min);
        let hi = zones.iter().map(|z| z.note).fold(f32::NEG_INFINITY, f32::max);

        let d = ModelParams::default();
        let p = h.params;
        let params = ModelParams {
            gain_db: p.gain_db.unwrap_or(d.gain_db),
            formant: p.formant.unwrap_or(d.formant),
            release_mode: match p.release_mode.as_deref() {
                Some("damper") => ReleaseMode::Damper,
                Some("ringout") => ReleaseMode::RingOut,
                _ => ReleaseMode::Natural,
            },
            damper: p.damper.unwrap_or_default(),
            undamped_from: p.undamped_from.unwrap_or(d.undamped_from),
            min_release_db_s: p.min_release_db_s.unwrap_or(d.min_release_db_s),
            spread: p.spread.unwrap_or(d.spread),
            key_pan: p.key_pan.unwrap_or(d.key_pan),
            reverb: p.reverb,
            reverb_send: p.reverb_send.unwrap_or(d.reverb_send),
            pitch_jitter_cents: p.pitch_jitter_cents.unwrap_or(d.pitch_jitter_cents),
            velocity_brightness: p.velocity_brightness.unwrap_or(d.velocity_brightness),
            recorded_tuning: p.tuning.as_deref() == Some("recorded"),
            pitch_morph: p.pitch_morph.unwrap_or(true),
            velocity_db: p.velocity_db.unwrap_or(d.velocity_db),
        };

        // smoothed envelopes serve only notes blended from two recordings (pitch morphing, or
        // between velocity layers); a model that plays every note from one recording does
        // without them (half its amplitude memory)
        if params.pitch_morph || layers.len() > 1 {
            let decaying = h.kind == "decaying";
            let nb = h.noise_edges.len().saturating_sub(1);
            for z in zones.iter_mut() {
                z.amps_smooth = smooth_rows(&z.amps, z.frames, z.partials, &z.grid, 0.3);
                if decaying && z.loop_range.is_none() {
                    let (a, b) = z.frames_between(DECAY_MORPH_S.0, DECAY_MORPH_S.1);
                    z.morph_ref = (0..z.harmonic).map(|i| z.harm_db_mean(a, b, i)).collect();
                }
                // (sustained instruments, organs among them, morph and play their onsets as before)
                if let (true, Some(tr)) = (decaying, &z.transient) {
                    let (a, b) = z.frames_between(0.0, tr.fade.1.max(0.03));
                    z.onset_db = (0..z.harmonic).map(|i| z.harm_db_mean(a, b, i)).collect();
                    z.onset_noise = (0..nb)
                        .map(|band| {
                            let p: f64 = (a..b).map(|f| 10f64.powf(q_to_db(z.noise[f * nb + band]) as f64 / 10.0)).sum();
                            (10.0 * (p / (b - a) as f64).max(1e-30).log10()) as f32
                        })
                        .collect();
                }
            }
        }

        Ok(Model {
            name: h.name,
            display_name: h.display_name,
            family: h.family,
            kind: if h.kind == "decaying" { Kind::Decaying } else { Kind::Sustained },
            source: h.source,
            grid: h.grid,
            noise_edges: h.noise_edges,
            layers,
            zones,
            params,
            by_layer,
            note_range: (lo, hi),
        })
    }

    pub fn noise_bands(&self) -> usize {
        self.noise_edges.len().saturating_sub(1)
    }

    /// Bytes of decoded data the model holds on the heap (its arrays; small fields not counted).
    pub fn heap_bytes(&self) -> usize {
        fn b<T>(v: &[T]) -> usize {
            std::mem::size_of_val(v)
        }
        let zones: usize = self
            .zones
            .iter()
            .map(|z| {
                let st = z.stereo.as_ref().map_or(0, |s| b(&s.l) + b(&s.r) + b(&s.ph) + b(&s.cos) + b(&s.sin));
                let im = z.image.as_ref().map_or(0, |i| b(&i.row) + b(&i.ild) + b(&i.iph) + b(&i.lph));
                let tr = z.transient.as_ref().map_or(0, |t| b(&t.data) + t.data_r.as_deref().map_or(0, b));
                b(&z.ratios)
                    + b(&z.phases)
                    + b(&z.amps)
                    + b(&z.amps_smooth)
                    + b(&z.morph_ref)
                    + b(&z.onset_db)
                    + b(&z.onset_noise)
                    + b(&z.grid)
                    + b(&z.pitch)
                    + b(&z.noise)
                    + b(&z.release)
                    + b(&z.jitter)
                    + b(&z.pulse)
                    + b(&z.shimmer)
                    + b(&z.alt_rel)
                    + st
                    + im
                    + tr
                    + std::mem::size_of::<Zone>()
            })
            .sum();
        zones + b(&self.grid) + b(&self.noise_edges) + self.by_layer.iter().map(|v| b(v)).sum::<usize>()
    }

    /// Damper extra decay (dB/s) for a note.
    pub fn damper_rate(&self, note: f32) -> f32 {
        if note >= self.params.undamped_from {
            return 0.0;
        }
        interp_breakpoints(&self.params.damper, note).unwrap_or(40.0)
    }
}

pub fn interp_breakpoints(bp: &[(f32, f32)], x: f32) -> Option<f32> {
    if bp.is_empty() {
        return None;
    }
    if x <= bp[0].0 {
        return Some(bp[0].1);
    }
    for w in bp.windows(2) {
        if x <= w[1].0 {
            let t = (x - w[0].0) / (w[1].0 - w[0].0).max(1e-6);
            return Some(w[0].1 + t * (w[1].1 - w[0].1));
        }
    }
    Some(bp[bp.len() - 1].1)
}

/// Small synthetic models for tests.
#[cfg(test)]
pub(crate) mod testing {
    use serde_json::{json, Value};

    pub const FRAMES: usize = 40;
    pub const PARTIALS: usize = 24;
    pub const EDGES: [f32; 4] = [100.0, 1000.0, 4000.0, 12000.0];

    /// A valid sustained model (one zone at middle C, looped) as `.ssm` bytes; `edit` may
    /// change the header before it is serialised.
    pub fn bytes_with(edit: impl FnOnce(&mut Value)) -> Vec<u8> {
        let (t, k, nb) = (FRAMES, PARTIALS, EDGES.len() - 1);
        let mut blob = Vec::new();
        let mut put = |b: &[u8]| {
            let o = blob.len();
            blob.extend_from_slice(b);
            o
        };
        let ratios: Vec<u8> = (0..k).flat_map(|i| ((i + 1) as f32).to_le_bytes()).collect();
        let o_ratios = put(&ratios);
        let o_phases = put(&vec![0u8; k]);
        // partial-major, time-delta coded: the first frame carries the level, then no change
        let mut amps = vec![0u8; t * k];
        for c in 0..k {
            amps[c * t] = 220 - 4 * c as u8;
        }
        let o_amps = put(&amps);
        let o_pitch = put(&vec![0u8; t * 2]);
        let mut noise = vec![0u8; t * nb];
        for b in 0..nb {
            noise[b * t] = 120;
        }
        let o_noise = put(&noise);
        let o_release = put(&vec![20u8; k]);
        let mut h = json!({
            "format": 1,
            "name": "test",
            "kind": "sustained",
            "grid": (0..t).map(|f| f as f32 * 0.05).collect::<Vec<_>>(),
            "noiseEdges": EDGES,
            "layers": [{"name": "f", "velocity": 100.0}],
            "zones": [{
                "note": 60.0, "f0": 261.63, "layer": 0, "partials": k, "frames": t, "loop": [4, t - 4],
                "o": {"ratios": o_ratios, "phases": o_phases, "amps": o_amps, "pitch": o_pitch,
                      "noise": o_noise, "release": o_release}
            }],
            "params": {"reverbSend": 0.2}
        });
        edit(&mut h);
        let hj = serde_json::to_vec(&h).unwrap();
        let mut out = b"SSM1".to_vec();
        out.extend_from_slice(&(hj.len() as u32).to_le_bytes());
        out.extend_from_slice(&hj);
        while !out.len().is_multiple_of(4) {
            out.push(b' ');
        }
        out.extend_from_slice(&blob);
        out
    }

    pub fn bytes() -> Vec<u8> {
        bytes_with(|_| {})
    }

    pub fn model() -> std::sync::Arc<super::Model> {
        std::sync::Arc::new(super::Model::from_bytes(&bytes()).expect("test model parses"))
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{bytes, bytes_with};
    use super::*;
    use crate::dsp::noise::Rng;
    use crate::voice::spectral::{BlockMod, NoteOn, SpectralParams, SpectralVoice};
    use serde_json::json;

    /// A parsed model must be playable: start and render a few notes without panicking.
    fn play(m: Model) {
        let m = std::sync::Arc::new(m);
        let mut rng = Rng::new(3);
        let p = SpectralParams::default();
        for note in [21u8, 60, 108] {
            let mut v = SpectralVoice::default();
            v.start(NoteOn { model: &m, note, velocity: 90, pitch: note as f32, pan: 0.0, params: &p, sample_rate: 48000.0, rng: &mut rng });
            let (mut l, mut r) = ([0.0f32; 64], [0.0f32; 64]);
            for _ in 0..20 {
                v.render(&mut l, &mut r, &p, &BlockMod::default());
            }
            v.release();
            v.render(&mut l, &mut r, &p, &BlockMod::default());
        }
    }

    #[test]
    fn the_test_model_parses_and_plays() {
        let m = Model::from_bytes(&bytes()).unwrap();
        assert_eq!(m.zones.len(), 1);
        assert_eq!(m.noise_bands(), 3);
        play(m);
    }

    #[test]
    fn degenerate_models_are_rejected() {
        type Edit = Box<dyn Fn(&mut serde_json::Value)>;
        let cases: Vec<(&str, Edit)> = vec![
            ("no layers", Box::new(|h| h["layers"] = json!([]))),
            ("no zones", Box::new(|h| h["zones"] = json!([]))),
            ("zone layer out of range", Box::new(|h| h["zones"][0]["layer"] = json!(3))),
            ("no frames", Box::new(|h| h["zones"][0]["frames"] = json!(0))),
            ("huge frames", Box::new(|h| h["zones"][0]["frames"] = json!(1u64 << 40))),
            (
                "frames × partials overflow",
                Box::new(|h| {
                    h["zones"][0]["frames"] = json!(100_000);
                    h["zones"][0]["partials"] = json!(8000);
                }),
            ),
            ("huge partials", Box::new(|h| h["zones"][0]["partials"] = json!(usize::MAX / 2))),
            ("overflowing offset", Box::new(|h| h["zones"][0]["o"]["ratios"] = json!(usize::MAX - 2))),
            ("zero f0", Box::new(|h| h["zones"][0]["f0"] = json!(0.0))),
            ("infinite note", Box::new(|h| h["zones"][0]["note"] = json!(1e39))),
            ("infinite gain", Box::new(|h| h["params"]["gainDb"] = json!(-1e39))),
            (
                "too many noise bands",
                Box::new(|h| h["noiseEdges"] = json!((0..40).map(|i| 50.0 * (i + 1) as f32).collect::<Vec<_>>())),
            ),
            ("unsorted noise edges", Box::new(|h| h["noiseEdges"] = json!([100.0, 50.0, 4000.0]))),
            (
                "huge image index",
                Box::new(|h| {
                    h["zones"][0]["o"]["ild"] = json!(0);
                    h["zones"][0]["o"]["iph"] = json!(0);
                    h["zones"][0]["o"]["imgK"] = json!(1);
                    h["zones"][0]["o"]["imgIdx"] = json!([1u64 << 40]);
                }),
            ),
            (
                "huge image rows",
                Box::new(|h| {
                    h["zones"][0]["o"]["ild"] = json!(0);
                    h["zones"][0]["o"]["iph"] = json!(0);
                    h["zones"][0]["o"]["imgK"] = json!(usize::MAX / 3);
                }),
            ),
            (
                "huge transient",
                Box::new(|h| {
                    h["zones"][0]["transient"] =
                        json!({"o": 0, "n": usize::MAX / 2, "scale": 1.0, "rate": 48000.0, "fade": [0.01, 0.02]})
                }),
            ),
        ];
        for (what, edit) in cases {
            let b = bytes_with(|h| edit(h));
            assert!(Model::from_bytes(&b).is_err(), "{what} must be rejected");
        }
    }

    #[test]
    fn truncated_and_corrupted_files_are_errors_not_panics() {
        let good = bytes();
        for cut in 0..good.len() {
            if let Ok(m) = Model::from_bytes(&good[..cut]) {
                play(m);
            }
        }
        let mut rng = Rng::new(99);
        for _ in 0..3000 {
            let mut b = good.clone();
            for _ in 0..1 + rng.next_u32() % 6 {
                let i = rng.next_u32() as usize % b.len();
                b[i] = rng.next_u32() as u8;
            }
            if let Ok(m) = Model::from_bytes(&b) {
                play(m);
            }
        }
        // the header length itself
        let mut b = good.clone();
        b[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Model::from_bytes(&b).is_err());
    }

    #[test]
    fn alternative_releases_are_accepted_and_bad_ones_ignored() {
        let b = bytes_with(|h| {
            h["zones"][0]["relFrame"] = json!(20);
            h["zones"][0]["altRel"] = json!([[0.3, 28], [0.1, 24], [1.0, usize::MAX - 1], [0.5, 5]]);
        });
        let m = Model::from_bytes(&b).unwrap();
        assert_eq!(m.zones[0].alt_rel, vec![(0.1, 24), (0.3, 28)]);
        // short presses play their own release segment, a long one the main release
        for hold_blocks in [10, 40, 400] {
            let m = std::sync::Arc::new(m.clone());
            let mut rng = Rng::new(5);
            let p = SpectralParams::default();
            let mut v = SpectralVoice::default();
            v.start(NoteOn { model: &m, note: 60, velocity: 90, pitch: 60.0, pan: 0.0, params: &p, sample_rate: 48000.0, rng: &mut rng });
            let (mut l, mut r) = ([0.0f32; 64], [0.0f32; 64]);
            for _ in 0..hold_blocks {
                v.render(&mut l, &mut r, &p, &BlockMod::default());
            }
            v.release();
            for _ in 0..2000 {
                v.render(&mut l, &mut r, &p, &BlockMod::default());
            }
            assert!(l.iter().all(|x| x.is_finite()));
        }
        let b = bytes_with(|h| h["zones"][0]["altRel"] = json!([[1e39, 24]]));
        assert!(Model::from_bytes(&b).is_err(), "infinite hold time");
    }

    #[test]
    fn decompression_is_bounded() {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let zeros = vec![0u8; 1 << 16];
        for _ in 0..64 {
            enc.write_all(&zeros).unwrap();
        }
        let gz = enc.finish().unwrap();
        assert!(gunzip(&gz, 1 << 20).is_err(), "4 MiB inflated past a 1 MiB limit");
        assert_eq!(gunzip(&gz, 8 << 20).unwrap().len(), 4 << 20);
        assert!(Model::from_bytes(&gz).is_err());
    }

    /// FNV-1a over a model's whole `Debug` text: every field and value (floats as their
    /// shortest round-trip text, so bit for bit). Same as `examples/fingerprint.rs`.
    fn fingerprint(m: &Model) -> u64 {
        struct Fnv(u64);
        impl std::fmt::Write for Fnv {
            fn write_str(&mut self, s: &str) -> std::fmt::Result {
                for &b in s.as_bytes() {
                    self.0 = (self.0 ^ b as u64).wrapping_mul(0x100_0000_01b3);
                }
                Ok(())
            }
        }
        let mut h = Fnv(0xcbf2_9ce4_8422_2325);
        // (without the levels derived at load for morphing, added after the fingerprints
        // were taken; the caller clears them)
        let text = format!("{m:?}").replace("morph_ref: [], onset_db: [], onset_noise: [], ", "");
        std::fmt::Write::write_str(&mut h, &text).unwrap();
        h.0
    }

    /// The faster decoder gives exactly the models the original one did (fingerprints taken
    /// with the parser before the loading optimisations; all 416 shipped models were compared
    /// with `examples/fingerprint.rs`). Covers u8 and 16-bit envelopes, transients (mono,
    /// stereo, dp16), stereo images, zone grids, pulse envelopes and alternative releases.
    /// The organ fingerprints were retaken for the 0.3.0 models (short-press releases, noises)
    /// and for models played from one recording per note, which no longer keep smoothed
    /// envelopes; Skrzatusz's Principal 8' (an unchanged file) gives the old fingerprint with
    /// the smoothing forced on, so the decoder itself is unchanged.
    #[test]
    fn real_models_decode_exactly_as_before() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut checked = 0;
        for (file, want) in [
            ("packages/instruments/models/piccolo.ssm", &[0xf2b4f066de1e07b1][..]),
            ("packages/instruments/models/flute-vibrato.ssm", &[0x083da5ae8a225130][..]),
            // (0.3.0, and the same recordings with the faster piano damper in the header)
            ("packages/instruments/models/grand-piano.ssm", &[0xc81e687ca2ab0d26, 0x9b93_c3f2_7cc2_30e2][..]),
            ("packages/organ-friesach/models/organ/friesach/great-gambe-8.ssm", &[0xeb675083369b8aed][..]),
            ("packages/organ-harmonium/models/organ/harmonium/great-diapason-8-forte.ssm", &[0x3f1d1b3079439eb8][..]),
            ("packages/organ-saint-jean-de-luz/models/organ/saint-jean-de-luz/pedal-bourdon-8.ssm", &[0x66f40dc18eefa477][..]),
            ("packages/organ-skrzatusz/models/organ/skrzatusz/great-principal-8.ssm", &[0xa583729ec5cfac89][..]),
            ("packages/organ-skrzatusz/models/organ/skrzatusz/noise-keys-pedal-down.ssm", &[0x0b3d143ddd459f05][..]),
        ] {
            let Ok(bytes) = std::fs::read(root.join(file)) else {
                eprintln!("not found, skipped: {file}");
                continue;
            };
            let mut m = Model::from_bytes(&bytes).unwrap_or_else(|e| panic!("{file}: {e}"));
            // (levels derived at load for morphing, after the fingerprints were taken)
            for z in m.zones.iter_mut() {
                z.morph_ref.clear();
                z.onset_db.clear();
                z.onset_noise.clear();
            }
            let got = fingerprint(&m);
            assert!(want.contains(&got), "{file} decodes differently: {got:#x}");
            checked += 1;
        }
        assert!(checked >= 3, "the shipped models are part of the repository");
    }

    /// The original moving average (prefix sums and integer division per value).
    fn smooth_rows_reference(amps: &[u16], frames: usize, partials: usize, grid: &[f32], half_s: f32) -> Vec<u16> {
        let (lo, hi) = smooth_windows(frames, grid, half_s);
        let mut out = vec![0u16; amps.len()];
        let mut cum = vec![0u64; frames + 1];
        for k in 0..partials {
            for f in 0..frames {
                cum[f + 1] = cum[f] + amps[f * partials + k].max(1) as u64;
            }
            for f in 0..frames {
                let n = (hi[f] + 1 - lo[f]) as u64;
                let v = (cum[hi[f] + 1] - cum[lo[f]] + n / 2) / n;
                out[f * partials + k] = if amps[f * partials + k] == 0 { 0 } else { v.min(u16::MAX as u64) as u16 };
            }
        }
        out
    }

    #[test]
    fn the_sliding_moving_average_matches_the_exact_one() {
        let mut rng = Rng::new(7);
        for case in 0..300 {
            let frames = 1 + rng.next_u32() as usize % if case < 290 { 400 } else { 20_000 };
            let partials = 1 + rng.next_u32() as usize % 9;
            // dense and sparse grids: windows of 1 to all frames
            let step = [0.001f32, 0.01, 0.05, 0.3, 1.0][case % 5];
            let grid: Vec<f32> = (0..frames).map(|f| f as f32 * step).collect();
            let amps: Vec<u16> = (0..frames * partials)
                .map(|_| match rng.next_u32() % 8 {
                    0 => 0,
                    1 => u16::MAX,
                    2 => u16::MAX - (rng.next_u32() % 3) as u16,
                    3 => 1,
                    _ => rng.next_u32() as u16,
                })
                .collect();
            assert_eq!(
                smooth_rows(&amps, frames, partials, &grid, 0.3),
                smooth_rows_reference(&amps, frames, partials, &grid, 0.3),
                "{frames} frames × {partials}, step {step}"
            );
        }
        // every window length with sums that are exact multiples of it (the rounding edge)
        for n in 1..400 {
            let grid: Vec<f32> = (0..n).map(|f| f as f32 * (0.6 / n as f32) * 0.999).collect();
            for v in [1u16, 2, 3, 7, 1000, 32767, 65534, 65535] {
                let amps = vec![v; n];
                assert_eq!(smooth_rows(&amps, n, 1, &grid, 0.3), smooth_rows_reference(&amps, n, 1, &grid, 0.3));
            }
        }
    }

    #[test]
    fn gzip_errors_are_reported() {
        use std::io::Write;
        let raw = bytes();
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&raw).unwrap();
        let gz = enc.finish().unwrap();
        assert_eq!(gunzip(&gz, MAX_MODEL_BYTES).unwrap(), raw);
        assert!(Model::from_bytes(&gz).is_ok());
        // a wrong length in the trailer is only a size hint, and then a checked error
        let mut bad_len = gz.clone();
        let n = bad_len.len();
        bad_len[n - 4..].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(gunzip(&bad_len, MAX_MODEL_BYTES).is_err());
        let mut bad_crc = gz.clone();
        bad_crc[n - 8] ^= 1;
        assert!(gunzip(&bad_crc, MAX_MODEL_BYTES).is_err());
        for cut in [3, 10, gz.len() / 2, gz.len() - 9, gz.len() - 1] {
            assert!(Model::from_bytes(&gz[..cut]).is_err(), "cut at {cut}");
        }
    }

    #[test]
    fn a_hand_built_model_without_layers_does_not_panic_the_voice() {
        let mut m = Model::from_bytes(&bytes()).unwrap();
        m.layers.clear();
        m.by_layer.clear();
        play(m);
        let mut m = Model::from_bytes(&bytes()).unwrap();
        m.zones.clear();
        play(m);
    }
}
