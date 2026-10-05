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

use std::io::Read;

use serde::Deserialize;

#[derive(Clone, Debug)]
pub struct ZoneStereo {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
    pub ph: Vec<f32>,
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
#[derive(Clone, Debug)]
pub struct Transient {
    pub data: Vec<f32>,
    /// right channel of a stereo recording (`data` is then the left channel)
    pub data_r: Option<Vec<f32>>,
    pub rate: f32,
    pub fade: (f32, f32),
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
    let mut v: Vec<(f32, usize)> = hz.alt_rel.iter().copied().filter(|&(h, f)| h > 0.0 && f > rf && f + 2 < t).collect();
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

fn slice<'a>(blob: &'a [u8], off: usize, len: usize, what: &str) -> Result<&'a [u8], String> {
    blob.get(off..off + len).ok_or_else(|| format!("model blob truncated reading {what}"))
}

/// Decode partial-major, time-delta-coded u8 envelopes into frame-major values,
/// keeping the first `keep` of `k` columns.
/// Moving average of quantised dB rows (frames × partials) over ±`half_s` of grid time.
fn smooth_rows(amps: &[u16], frames: usize, partials: usize, grid: &[f32], half_s: f32) -> Vec<u16> {
    if frames == 0 || partials == 0 {
        return amps.to_vec();
    }
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
    let mut out = vec![0u16; amps.len()];
    let mut cum = vec![0u64; frames + 1];
    for k in 0..partials {
        for f in 0..frames {
            // silence (0) counts as the floor of the scale, not as −200 dB
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

fn undelta_pm(b: &[u8], t: usize, _k: usize, keep: usize) -> Vec<u8> {
    let mut out = vec![0u8; t * keep];
    for c in 0..keep {
        let col = &b[c * t..(c + 1) * t];
        let mut acc = 0u8;
        for (f, &d) in col.iter().enumerate() {
            acc = acc.wrapping_add(d);
            out[f * keep + c] = acc;
        }
    }
    out
}

/// Partial-major, time-delta coded i16 (low byte plane, then high byte plane) → frame-major
/// u16 amplitudes in 1/32 dB, keeping the first `keep` of `k` columns.
fn undelta_pm16(b: &[u8], t: usize, k: usize, keep: usize, step_db: f32) -> Vec<u16> {
    let (lo, hi) = b.split_at(t * k);
    let mut out = vec![0u16; t * keep];
    let scale = step_db / AMP_UNIT_DB;
    for c in 0..keep {
        let mut acc = 0i16;
        for f in 0..t {
            let i = c * t + f;
            acc = acc.wrapping_add(i16::from_le_bytes([lo[i], hi[i]]));
            out[f * keep + c] = if acc <= 0 { 0 } else { ((acc as f32 * scale).round() as u32).min(u16::MAX as u32) as u16 };
        }
    }
    out
}

fn f32s(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

impl Model {
    /// Parse a model from bytes (gzip-compressed or raw).
    pub fn from_bytes(bytes: &[u8]) -> Result<Model, String> {
        let raw: Vec<u8>;
        let data: &[u8] = if bytes.len() > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
            let mut d = flate2::read::GzDecoder::new(bytes);
            let mut v = Vec::new();
            d.read_to_end(&mut v).map_err(|e| format!("gzip: {e}"))?;
            raw = v;
            &raw
        } else {
            bytes
        };
        if data.len() < 8 || &data[0..4] != b"SSM1" {
            return Err("not a supersynth model (bad magic)".into());
        }
        let hlen = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let hjson = data.get(8..8 + hlen).ok_or("truncated header")?;
        let h: Header = serde_json::from_slice(hjson).map_err(|e| format!("header: {e}"))?;
        if h.format != 1 {
            return Err(format!("unsupported model format {}", h.format));
        }
        let blob_start = (8 + hlen + 3) & !3;
        let blob = data.get(blob_start..).ok_or("missing blob")?;
        let nb = h.noise_edges.len().saturating_sub(1);

        let mut zones = Vec::with_capacity(h.zones.len());
        for hz in &h.zones {
            let k = hz.partials.min(MAX_PARTIALS);
            let kk = hz.partials;
            let t = hz.frames;
            let zgrid = match hz.o.grid {
                Some(o) => f32s(slice(blob, o, t * 4, "grid")?),
                None => {
                    if t > h.grid.len() {
                        return Err("zone frame count out of range".into());
                    }
                    h.grid[..t].to_vec()
                }
            };
            if t == 0 || zgrid.windows(2).any(|w| w[1] <= w[0]) {
                return Err("zone frames out of range".into());
            }
            let ratios_all = f32s(slice(blob, hz.o.ratios, kk * 4, "ratios")?);
            let phases_q = slice(blob, hz.o.phases, kk, "phases")?;
            let amps = match hz.o.amps16 {
                Some(o) => undelta_pm16(slice(blob, o, t * kk * 2, "amps16")?, t, kk, k, hz.o.amps_step.unwrap_or(1.0 / 16.0)),
                None => {
                    // u8 0.5 dB codes → 1/32 dB units
                    let a8 = undelta_pm(slice(blob, hz.o.amps, t * kk, "amps")?, t, kk, k);
                    a8.iter().map(|&q| if q == 0 { 0 } else { ((q_to_db(q) - AMP_FLOOR_DB) / AMP_UNIT_DB).round().max(1.0) as u16 }).collect()
                }
            };
            let pitch_q = slice(blob, hz.o.pitch, t * 2, "pitch")?;
            let noise = undelta_pm(slice(blob, hz.o.noise, t * nb, "noise")?, t, nb, nb);
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
                grid: zgrid,
                pitch: pitch_q.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 100.0).collect(),
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
                        ild: undelta_pm(slice(blob, a, t * ik, "ild")?, t, ik, ik),
                        iph: undelta_pm(slice(blob, b, t * ik, "iph")?, t, ik, ik),
                        lph: match hz.o.lph {
                            Some(o) => undelta_pm(slice(blob, o, t * ik, "lph")?, t, ik, ik),
                            None => Vec::new(),
                        },
                    }),
                    _ => None,
                },
                stereo: hz.stereo.as_ref().filter(|st| st.l.len() == st.r.len() && st.l.len() == st.ph.len()).map(|st| {
                    let g = |q: &u8| *q as f32 / 255.0 * std::f32::consts::SQRT_2;
                    ZoneStereo {
                        l: st.l.iter().map(g).collect(),
                        r: st.r.iter().map(g).collect(),
                        ph: st.ph.iter().map(|&q| q as f32 / 255.0 * std::f32::consts::TAU - std::f32::consts::PI).collect(),
                    }
                }),
                pulse: if hz.pulse.len() == PULSE_BINS {
                    hz.pulse.iter().map(|&q| q as f32 * (PULSE_MAX / 255.0)).collect()
                } else {
                    Vec::new()
                },
                transient: match &hz.transient {
                    Some(t) if t.n > 4 && t.rate > 0.0 => {
                        let decode = |o: usize, scale: f32| -> Result<Vec<f32>, String> {
                            let b = slice(blob, o, t.n * 2, "transient")?;
                            let k = scale / 32767.0;
                            let pcm: Vec<i16> = if t.enc.as_deref() == Some("dp16") {
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
                                b.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
                            };
                            Ok(pcm.iter().map(|&v| v as f32 * k).collect())
                        };
                        let data_r = match t.o_r {
                            Some(o) => Some(decode(o, t.scale_r.unwrap_or(t.scale))?),
                            None => None,
                        };
                        Some(Transient {
                            data_r,
                            data: decode(t.o, t.scale)?,
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
            v.sort_by(|&a, &b| zones[a].note.partial_cmp(&zones[b].note).unwrap());
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

        let mut zones = zones;
        for z in zones.iter_mut() {
            z.amps_smooth = smooth_rows(&z.amps, z.frames, z.partials, &z.grid, 0.3);
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
