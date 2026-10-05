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
}
