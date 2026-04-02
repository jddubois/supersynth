//! Small, allocation-free radix-2 complex FFT for fixed power-of-two sizes.

use std::f32::consts::PI;

pub struct Fft {
    n: usize,
    rev: Vec<u32>,
    tw_re: Vec<f32>,
    tw_im: Vec<f32>,
}

impl Fft {
    pub fn new(n: usize) -> Self {
        assert!(n.is_power_of_two() && n >= 4);
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| i.reverse_bits() >> (32 - bits)).collect();
        let mut tw_re = Vec::with_capacity(n / 2);
        let mut tw_im = Vec::with_capacity(n / 2);
        for k in 0..n / 2 {
            let a = -2.0 * PI * k as f32 / n as f32;
            tw_re.push(a.cos());
            tw_im.push(a.sin());
        }
        Self { n, rev, tw_re, tw_im }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// In-place forward transform (no scaling). `inverse` conjugates the twiddles;
    /// the caller applies the 1/N scale where needed.
    pub fn process(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        let n = self.n;
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let sign = if inverse { -1.0 } else { 1.0 };
        let mut len = 2;
        while len <= n {
            let half = len / 2;
            let step = n / len;
            for start in (0..n).step_by(len) {
                for k in 0..half {
                    let wr = self.tw_re[k * step];
                    let wi = sign * self.tw_im[k * step];
                    let a = start + k;
                    let b = a + half;
                    let xr = re[b] * wr - im[b] * wi;
                    let xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
            }
            len <<= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_tone() {
        let n = 64;
        let f = Fft::new(n);
        let mut re: Vec<f32> = (0..n).map(|i| (2.0 * PI * 5.0 * i as f32 / n as f32).cos()).collect();
        let mut im = vec![0.0; n];
        let orig = re.clone();
        f.process(&mut re, &mut im, false);
        assert!((re[5] - n as f32 / 2.0).abs() < 1e-3);
        assert!((re[n - 5] - n as f32 / 2.0).abs() < 1e-3);
        f.process(&mut re, &mut im, true);
        for i in 0..n {
            assert!((re[i] / n as f32 - orig[i]).abs() < 1e-4);
        }
    }
}
