//! Model loading benchmark: read, inflate and parse every `.ssm` model in directories.
//!
//!   cargo run --release --example load_bench -- packages/organ-friesach/models/organ/friesach
//!
//! Prints the time spent in each step (one thread) and the models' decoded size in memory.

use std::io::Read;
use std::path::PathBuf;
use std::time::Instant;

use supersynth_core::model::Model;

fn main() {
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in std::env::args().skip(1) {
        for e in std::fs::read_dir(&dir).expect("a directory of models") {
            let p = e.expect("directory entry").path();
            if p.extension().is_some_and(|x| x == "ssm") {
                files.push(p);
            }
        }
    }
    files.sort();
    let (mut read, mut inflate, mut parse, mut whole) = (0.0, 0.0, 0.0, 0.0);
    let (mut gz, mut raw_bytes, mut mem) = (0usize, 0usize, 0usize);
    // decoded bytes by kind: amplitude envelopes, their smoothed copy, stereo image, noise, transients
    let mut parts = [0usize; 5];
    for f in &files {
        let t0 = Instant::now();
        let b = std::fs::read(f).expect("model file");
        let t1 = Instant::now();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(&b[..]).read_to_end(&mut raw).expect("gzip");
        let t2 = Instant::now();
        let m = Model::from_bytes(&raw).expect("model");
        let t3 = Instant::now();
        let m2 = Model::from_bytes(&b).expect("model");
        let t4 = Instant::now();
        read += (t1 - t0).as_secs_f64();
        inflate += (t2 - t1).as_secs_f64();
        parse += (t3 - t2).as_secs_f64();
        whole += (t4 - t3).as_secs_f64();
        gz += b.len();
        raw_bytes += raw.len();
        mem += m.heap_bytes();
        for z in &m.zones {
            parts[0] += z.amps.len() * 2;
            parts[1] += z.amps_smooth.len() * 2;
            parts[2] += z.image.as_ref().map_or(0, |i| i.ild.len() + i.iph.len() + i.lph.len());
            parts[3] += z.noise.len();
            parts[4] += z.transient.as_ref().map_or(0, |t| 2 * (t.data.len() + t.data_r.as_ref().map_or(0, |r| r.len())));
        }
        std::hint::black_box((m, m2));
    }
    println!(
        "{} models, {:.1} MB compressed, {:.1} MB raw, {:.1} MB decoded in memory\n\
         read {:.0} ms, inflate {:.0} ms, parse {:.0} ms; Model::from_bytes(gzip) {:.0} ms",
        files.len(),
        gz as f64 / 1e6,
        raw_bytes as f64 / 1e6,
        mem as f64 / 1e6,
        read * 1e3,
        inflate * 1e3,
        parse * 1e3,
        whole * 1e3
    );
    let mb = |b: usize| b as f64 / 1e6;
    println!(
        "decoded: amplitudes {:.1} MB, smoothed amplitudes {:.1} MB, stereo image {:.1} MB, noise {:.1} MB, transients {:.1} MB, other {:.1} MB",
        mb(parts[0]),
        mb(parts[1]),
        mb(parts[2]),
        mb(parts[3]),
        mb(parts[4]),
        mb(mem - parts.iter().sum::<usize>())
    );
}
