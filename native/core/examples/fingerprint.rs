//! Print a fingerprint of each model as parsed: an FNV-1a hash of its whole `Debug` text (every
//! field and value; floats as their shortest round-trip text, so bit for bit). Two builds of the
//! parser decode the models identically when their outputs match.
//!
//!   cargo run --release --example fingerprint -- ../models/*.ssm > a.txt

use supersynth_core::model::Model;

struct Fnv(u64);

impl std::fmt::Write for Fnv {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        for &b in s.as_bytes() {
            self.0 = (self.0 ^ b as u64).wrapping_mul(0x100_0000_01b3);
        }
        Ok(())
    }
}

fn main() {
    for file in std::env::args().skip(1) {
        let bytes = std::fs::read(&file).expect("model file");
        match Model::from_bytes(&bytes) {
            Ok(m) => {
                let mut h = Fnv(0xcbf2_9ce4_8422_2325);
                std::fmt::write(&mut h, format_args!("{m:?}")).expect("formatting");
                println!("{:016x} {file}", h.0);
            }
            Err(e) => println!("error: {e} {file}"),
        }
    }
}
