//! Fast deterministic random number generation for audio noise.

/// xoshiro128+ — fast, good-quality 32-bit generator, plenty for audio noise.
#[derive(Clone)]
pub struct Rng {
    s: [u32; 4],
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        // splitmix64 to expand the seed
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut next = || {
            z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut x = z;
            x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            x ^ (x >> 31)
        };
        let a = next();
        let b = next();
        let mut s = [a as u32, (a >> 32) as u32, b as u32, (b >> 32) as u32];
        if s.iter().all(|&v| v == 0) {
            s[0] = 1;
        }
        Self { s }
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let result = self.s[0].wrapping_add(self.s[3]);
        let t = self.s[1] << 9;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(11);
        result
    }

    /// Uniform in [0, 1).
    #[inline]
    pub fn uniform(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    /// Uniform in [-1, 1).
    #[inline]
    pub fn bipolar(&mut self) -> f32 {
        self.uniform() * 2.0 - 1.0
    }

    /// Approximately Gaussian (sum of 4 uniforms, scaled to unit variance).
    #[inline]
    pub fn gauss(&mut self) -> f32 {
        let s = self.uniform() + self.uniform() + self.uniform() + self.uniform();
        (s - 2.0) * 1.732_050_8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gauss_has_unit_variance() {
        let mut r = Rng::new(42);
        let n = 200_000;
        let mut s = 0.0f64;
        let mut s2 = 0.0f64;
        for _ in 0..n {
            let v = r.gauss() as f64;
            s += v;
            s2 += v * v;
        }
        let mean = s / n as f64;
        let var = s2 / n as f64 - mean * mean;
        assert!(mean.abs() < 0.01, "mean {mean}");
        assert!((var - 1.0).abs() < 0.02, "var {var}");
    }
}
