//! Pooled residual-noise synthesis.
//!
//! Every spectral voice describes its noise (breath, bow, hammer, wind) as a
//! power per frequency band. Noise from independent sources adds in *power*, so
//! instead of filtering noise per voice we sum all voice band powers of a part
//! and synthesise one stereo noise signal — cost independent of polyphony.
//!
//! Synthesis is spectral: white noise frames are shaped in the frequency domain
//! by a smooth power-spectral-density curve (log-log interpolated between band
//! centres) and overlap-added with a sqrt-Hann window at 75 % overlap. Unlike IIR
//! band filters, this reproduces arbitrarily steep spectra (no filter skirts
//! leaking loud low bands into silent high ones).

use crate::dsp::biquad::{Biquad, Coeffs};
use crate::dsp::fft::Fft;
use crate::dsp::noise::Rng;
use crate::dsp::BLOCK;
use crate::voice::spectral::MAX_BANDS;

const N: usize = 1024;
const HOP: usize = N / 4;
/// Bands entirely below this are synthesised with IIR band-pass filters: the FFT's
/// ~47 Hz bins are too coarse for them (they would become boxy, tonal bursts).
const IIR_BELOW_HZ: f32 = 430.0;

/// A low band: independent noise through 4th-order skirts on each side.
struct IirBand {
    filt: [[Biquad; 4]; 2],
    norm: f32,
    gain: [f32; 2],
    rng: [Rng; 2],
}

struct Channel {
    rng: Rng,
    /// overlap-add accumulator (N samples), `ready` samples at the front are final
    ola: Vec<f32>,
}

pub struct NoiseBank {
    fft: Fft,
    win: Vec<f32>,
    edges: Vec<f32>,
    /// per band: (centre bin as f32, bins covered) for density computation
    band_center: Vec<f32>,
    band_bins: Vec<f32>,
    /// per FFT bin: (band index below, interpolation weight) in log-frequency
    bin_lo: Vec<u16>,
    bin_w: Vec<f32>,
    bin_valid: Vec<bool>,
    /// band containing each bin (by edges)
    bin_band: Vec<u16>,
    ch: [Channel; 2],
    /// samples at the front of both channels' accumulators that are final / already read
    ready: usize,
    read: usize,
    /// band index → IIR synthesiser (None = FFT band)
    iir: Vec<Option<IirBand>>,
    pub pow_l: [f32; MAX_BANDS],
    pub pow_r: [f32; MAX_BANDS],
    // scratch
    re: Vec<f32>,
    im: Vec<f32>,
    mag: [Vec<f32>; 2],
    active: bool,
}

impl NoiseBank {
    pub fn new(sample_rate: f32, edges: &[f32], seed: u64) -> Self {
        let nb = edges.len().saturating_sub(1).min(MAX_BANDS);
        let df = sample_rate / N as f32;
        let nyq = sample_rate * 0.5;
        let mut band_center = Vec::with_capacity(nb);
        let mut band_bins = Vec::with_capacity(nb);
        for b in 0..nb {
            let lo = edges[b].max(1.0);
            let hi = edges[b + 1].min(nyq);
            let c = (lo * hi.max(lo)).sqrt();
            band_center.push(c);
            band_bins.push(((hi - lo).max(0.0) / df).max(0.5));
        }
        // per bin: interpolate log-density between neighbouring band centres
        let mut bin_lo = vec![0u16; N / 2 + 1];
        let mut bin_w = vec![0.0f32; N / 2 + 1];
        let mut bin_valid = vec![false; N / 2 + 1];
        let mut bin_band = vec![0u16; N / 2 + 1];
        for k in 1..N / 2 {
            let f = k as f32 * df;
            if nb == 0 || f < edges[0] || f >= edges[nb].min(nyq) {
                continue;
            }
            bin_valid[k] = true;
            let mut bb = 0;
            while bb + 1 < nb && edges[bb + 1] <= f {
                bb += 1;
            }
            bin_band[k] = bb as u16;
            if f <= band_center[0] {
                bin_lo[k] = 0;
                bin_w[k] = 0.0;
            } else if f >= band_center[nb - 1] {
                bin_lo[k] = (nb - 1) as u16;
                bin_w[k] = 0.0;
            } else {
                let mut b = 0;
                while b + 1 < nb && band_center[b + 1] < f {
                    b += 1;
                }
                let w = (f / band_center[b]).ln() / (band_center[b + 1] / band_center[b]).ln();
                bin_lo[k] = b as u16;
                bin_w[k] = w.clamp(0.0, 1.0);
            }
        }
        // low bands: IIR synthesis (and their bins are removed from the FFT)
        let mut iir: Vec<Option<IirBand>> = Vec::with_capacity(nb);
        for b in 0..nb {
            let lo = edges[b].max(10.0);
            let hi = edges[b + 1].min(nyq * 0.97);
            if edges[b + 1] > IIR_BELOW_HZ || lo >= hi {
                iir.push(None);
                continue;
            }
            let hp = Coeffs::high_pass(lo, std::f32::consts::FRAC_1_SQRT_2, sample_rate);
            let lp = Coeffs::low_pass(hi, std::f32::consts::FRAC_1_SQRT_2, sample_rate);
            let steps = 8192;
            let mut acc = 0.0f64;
            for i in 0..steps {
                let f = (i as f32 + 0.5) / steps as f32 * nyq;
                let g = hp.power_at(f, sample_rate) * lp.power_at(f, sample_rate);
                acc += (g * g) as f64;
            }
            let pg = (acc / steps as f64) as f32;
            let chain = [Biquad::new(hp), Biquad::new(hp), Biquad::new(lp), Biquad::new(lp)];
            iir.push(Some(IirBand {
                filt: [chain, chain],
                norm: if pg > 0.0 { 1.0 / pg.sqrt() } else { 0.0 },
                gain: [0.0; 2],
                rng: [Rng::new(seed ^ (b as u64 * 7919 + 1)), Rng::new(seed ^ (b as u64 * 104_729 + 3))],
            }));
        }
        for k in 1..N / 2 {
            if bin_valid[k] && iir[bin_band[k] as usize].is_some() {
                bin_valid[k] = false;
            }
        }
        // sqrt-Hann at 75 % overlap: Σ w² = 2 → scale by 1/√2 for unit power
        let win: Vec<f32> = (0..N)
            .map(|i| {
                let h = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / N as f32).cos();
                h.sqrt() * std::f32::consts::FRAC_1_SQRT_2
            })
            .collect();
        let mk = |s: u64| Channel { rng: Rng::new(s), ola: vec![0.0; N] };
        Self {
            fft: Fft::new(N),
            win,
            edges: edges.to_vec(),
            band_center,
            band_bins,
            bin_lo,
            bin_w,
            bin_valid,
            bin_band,
            iir,
            ch: [mk(seed), mk(seed ^ 0xA5A5_5A5A_1234_5678)],
            ready: 0,
            read: 0,
            pow_l: [0.0; MAX_BANDS],
            pow_r: [0.0; MAX_BANDS],
            re: vec![0.0; N],
            im: vec![0.0; N],
            mag: [vec![0.0; N / 2 + 1], vec![0.0; N / 2 + 1]],
            active: false,
        }
    }

    pub fn edges(&self) -> &[f32] {
        &self.edges
    }

    pub fn clear_powers(&mut self) {
        self.pow_l = [0.0; MAX_BANDS];
        self.pow_r = [0.0; MAX_BANDS];
    }

    /// Render the accumulated band powers, adding into `out_l`/`out_r`.
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        self.render_iir(out_l, out_r);
        let nb = self.band_center.len();
        let any = self.pow_l[..nb].iter().chain(self.pow_r[..nb].iter()).any(|&p| p > 0.0);
        if !any && !self.active {
            return;
        }
        self.active = any || self.ch.iter().any(|c| c.ola.iter().any(|&v| v != 0.0));
        let n = out_l.len().min(out_r.len());
        let mut i = 0;
        while i < n {
            if self.read >= self.ready {
                self.synth_frames();
            }
            let take = (self.ready - self.read).min(n - i);
            let (a, b) = (&self.ch[0].ola[self.read..self.read + take], &self.ch[1].ola[self.read..self.read + take]);
            for s in 0..take {
                out_l[i + s] += a[s];
                out_r[i + s] += b[s];
            }
            self.read += take;
            i += take;
        }
    }

    fn render_iir(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        let n = out_l.len().min(BLOCK);
        let inv_n = 1.0 / n.max(1) as f32;
        for (b, band) in self.iir.iter_mut().enumerate() {
            let Some(band) = band else { continue };
            for ch in 0..2 {
                let pw = if ch == 0 { self.pow_l[b] } else { self.pow_r[b] };
                let target = pw.sqrt() * band.norm;
                let g0 = band.gain[ch];
                if target <= 1e-7 && g0 <= 1e-7 {
                    band.gain[ch] = 0.0;
                    continue;
                }
                let mut tmp = [0.0f32; BLOCK];
                let rng = &mut band.rng[ch];
                for v in tmp[..n].iter_mut() {
                    *v = rng.gauss();
                }
                for f in band.filt[ch].iter_mut() {
                    f.process_block(&mut tmp[..n]);
                }
                let out: &mut [f32] = if ch == 0 { &mut *out_l } else { &mut *out_r };
                let dg = (target - g0) * inv_n;
                let mut g = g0;
                for i in 0..n {
                    g += dg;
                    out[i] += tmp[i] * g;
                }
                band.gain[ch] = target;
            }
        }
    }

    /// Per-bin magnitude (density shape scaled so every band carries exactly its power).
    fn shape(&mut self, c: usize) {
        // spectral magnitude from band powers: per-bin one-sided density D(k),
        // |M(k)|² = N·D(k)/2 on both halves → output variance Σ D(k)
        let pows = if c == 0 { self.pow_l } else { self.pow_r };
        let nb = self.band_center.len();
        let mut ldens = [-60.0f32; MAX_BANDS];
        for b in 0..nb {
            let d = pows[b] / self.band_bins[b];
            ldens[b] = if d > 1e-30 { d.ln() } else { -69.0 };
        }
        let mag = &mut self.mag[c];
        // pass 1: smooth shape (log-log interpolation between band centres)
        let mut bsum = [0.0f32; MAX_BANDS];
        for k in 0..=N / 2 {
            mag[k] = if self.bin_valid[k] {
                let b = self.bin_lo[k] as usize;
                let w = self.bin_w[k];
                let ld = if w > 0.0 && b + 1 < nb { ldens[b] + (ldens[b + 1] - ldens[b]) * w } else { ldens[b] };
                let d = if ld < -68.0 { 0.0 } else { ld.exp() };
                bsum[self.bin_band[k] as usize] += d;
                d
            } else {
                0.0
            };
        }
        // pass 2: rescale so every band carries exactly its power, then to magnitudes
        let mut bscale = [0.0f32; MAX_BANDS];
        for b in 0..nb {
            bscale[b] = if bsum[b] > 0.0 { pows[b] / bsum[b] } else { 0.0 };
        }
        let scale = N as f32 * 0.5;
        for k in 0..=N / 2 {
            if mag[k] > 0.0 {
                mag[k] = (mag[k] * bscale[self.bin_band[k] as usize] * scale).sqrt();
            }
        }
    }

    /// Shift out consumed samples and overlap-add one new shaped noise frame per channel.
    ///
    /// The spectrum of a white Gaussian noise frame is itself white complex Gaussian noise
    /// (variance N per bin, real at DC and Nyquist), so it is drawn directly instead of
    /// transforming time-domain noise; and the two channels' real frames come out of one
    /// complex inverse transform of Z = X_L + i·X_R.
    fn synth_frames(&mut self) {
        for chn in self.ch.iter_mut() {
            chn.ola.copy_within(HOP.., 0);
            for v in chn.ola[N - HOP..].iter_mut() {
                *v = 0.0;
            }
        }
        self.shape(0);
        self.shape(1);
        // white spectrum: Re and Im each of variance N/2 (DC and Nyquist: real, variance N)
        let h = (N as f32 * 0.5).sqrt();
        let full = (N as f32).sqrt();
        let half = N / 2;
        let (ml, mr) = (&self.mag[0], &self.mag[1]);
        let (rl, rr) = self.ch.split_at_mut(1);
        let (gl, gr) = (&mut rl[0].rng, &mut rr[0].rng);
        for k in [0, half] {
            let xl = gl.gauss() * full * ml[k];
            let xr = gr.gauss() * full * mr[k];
            self.re[k] = xl;
            self.im[k] = xr;
        }
        for k in 1..half {
            let (al, bl) = (gl.gauss() * h * ml[k], gl.gauss() * h * ml[k]);
            let (ar, br) = (gr.gauss() * h * mr[k], gr.gauss() * h * mr[k]);
            // Z[k] = X_L[k] + i·X_R[k];  Z[N−k] = conj(X_L[k]) + i·conj(X_R[k])
            self.re[k] = al - br;
            self.im[k] = bl + ar;
            self.re[N - k] = al + br;
            self.im[N - k] = ar - bl;
        }
        self.fft.process(&mut self.re, &mut self.im, true);
        let inv = 1.0 / N as f32;
        let (c0, c1) = self.ch.split_at_mut(1);
        let (ol, or) = (&mut c0[0].ola, &mut c1[0].ola);
        for i in 0..N {
            let w = inv * self.win[i];
            ol[i] += self.re[i] * w;
            or[i] += self.im[i] * w;
        }
        self.ready = HOP;
        self.read = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::BLOCK;

    fn measure(edges: &[f32], set: &[(usize, f32)], sr: f32) -> f64 {
        let mut nb = NoiseBank::new(sr, edges, 7);
        for &(b, p) in set {
            nb.pow_l[b] = p;
            nb.pow_r[b] = p;
        }
        let mut acc = 0.0f64;
        let mut cnt = 0usize;
        for blk in 0..3000 {
            let mut l = [0.0f32; BLOCK];
            let mut r = [0.0f32; BLOCK];
            nb.render(&mut l, &mut r);
            if blk > 100 {
                for &v in &l {
                    acc += (v as f64) * (v as f64);
                    cnt += 1;
                }
            }
        }
        acc / cnt as f64
    }

    #[test]
    fn channels_are_calibrated_and_independent() {
        let edges = [20.0, 200.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
        let mut nb = NoiseBank::new(48000.0, &edges, 11);
        for b in 0..7 {
            nb.pow_l[b] = 0.001;
            nb.pow_r[b] = 0.004;
        }
        let (mut ll, mut rr, mut lr) = (0.0f64, 0.0f64, 0.0f64);
        for blk in 0..3000 {
            let mut l = [0.0f32; BLOCK];
            let mut r = [0.0f32; BLOCK];
            nb.render(&mut l, &mut r);
            if blk > 100 {
                for i in 0..BLOCK {
                    ll += (l[i] as f64).powi(2);
                    rr += (r[i] as f64).powi(2);
                    lr += l[i] as f64 * r[i] as f64;
                }
            }
        }
        let ratio = rr / ll;
        assert!((ratio - 4.0).abs() < 0.4, "right/left power {ratio}");
        let corr = lr / (ll * rr).sqrt();
        assert!(corr.abs() < 0.05, "left/right correlation {corr}");
    }

    #[test]
    fn total_power_is_calibrated() {
        let edges = [
            20.0, 60.0, 100.0, 150.0, 200.0, 260.0, 330.0, 420.0, 530.0, 670.0, 840.0, 1060.0, 1330.0, 1680.0,
            2120.0, 2660.0, 3350.0, 4220.0, 5310.0, 6680.0, 8410.0, 10000.0, 11900.0, 13500.0, 15000.0, 16500.0,
            18000.0, 19500.0, 21000.0,
        ];
        let all: Vec<(usize, f32)> = (0..28).map(|b| (b, 0.001)).collect();
        let p = measure(&edges, &all, 48000.0) / (0.028);
        assert!((p - 1.0).abs() < 0.12, "flat spectrum relative power {p}");
        let one = measure(&edges, &[(12, 0.01)], 48000.0) / 0.01;
        assert!((one - 1.0).abs() < 0.25, "single band relative power {one}");
    }
}
