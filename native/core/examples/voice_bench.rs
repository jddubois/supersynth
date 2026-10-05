//! Voice benchmark: what one note costs, per model, on one thread.
//!
//!   cargo run --release --example voice_bench -- packages/organ-friesach/models/organ/friesach
//!
//! For every `.ssm` model in the directories: the note-on set-up, and a block (64 frames) of
//! a held note and of its release, in microseconds, with the partials sounding.
//! `SUPERSYNTH_SIMD=baseline` measures the baseline instruction set.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use supersynth_core::dsp::denormal::FlushDenormals;
use supersynth_core::dsp::noise::Rng;
use supersynth_core::dsp::BLOCK;
use supersynth_core::model::Model;
use supersynth_core::voice::spectral::{BlockMod, NoteOn, SpectralParams, SpectralVoice, VoiceScratch};

fn main() {
    let _ftz = FlushDenormals::new();
    supersynth_core::dsp::simd::init();
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
    println!("instruction set: {}; one voice's state: {} kB", supersynth_core::dsp::simd::name(), std::mem::size_of::<SpectralVoice>() / 1024);
    println!("{:<40} {:>8} {:>9} {:>9} {:>9}", "model", "start µs", "held µs", "release µs", "partials");
    let p = SpectralParams::default();
    let md = BlockMod::default();
    let mut sc = VoiceScratch::boxed();
    let (mut ts, mut th, mut tr) = (0.0, 0.0, 0.0);
    for f in &files {
        let m = Arc::new(Model::from_bytes(&std::fs::read(f).expect("model file")).expect("model"));
        let notes = [36u8, 48, 60, 72, 84];
        let mut partials = 0;
        let (mut l, mut r) = ([0.0f32; BLOCK], [0.0f32; BLOCK]);
        // the fastest of three runs (other programs only ever slow a run down)
        let mut best = (f64::INFINITY, f64::INFINITY, f64::INFINITY, 0usize);
        for _ in 0..3 {
            let mut v = SpectralVoice::default();
            let mut rng = Rng::new(1);
            let (mut start, mut held, mut rel, mut nblk_h, mut nblk_r) = (0.0, 0.0, 0.0, 0, 0);
            for &note in &notes {
                let t0 = Instant::now();
                for _ in 0..20 {
                    v.start(NoteOn { model: &m, note, velocity: 100, pitch: note as f32 + std::env::var("VB_DETUNE").ok().and_then(|v| v.parse::<f32>().ok()).unwrap_or(0.0), pan: 0.0, params: &p, sample_rate: 48000.0, rng: &mut rng });
                }
                start += t0.elapsed().as_secs_f64() / 20.0;
                partials = partials.max(v.partials());
                let t0 = Instant::now();
                for _ in 0..750 {
                    v.render_with(&mut sc, &mut l, &mut r, &p, &md);
                }
                held += t0.elapsed().as_secs_f64();
                nblk_h += 750;
                v.release();
                let t0 = Instant::now();
                let mut b = 0;
                while v.is_active() && b < 750 * 8 {
                    v.render_with(&mut sc, &mut l, &mut r, &p, &md);
                    b += 1;
                }
                rel += t0.elapsed().as_secs_f64();
                nblk_r += b;
            }
            let (s, h, rr) = (start / notes.len() as f64 * 1e6, held / nblk_h as f64 * 1e6, rel / nblk_r.max(1) as f64 * 1e6);
            best = (best.0.min(s), best.1.min(h), best.2.min(rr), nblk_r);
        }
        let (s, h, rr, nblk_r) = best;
        let name = f.file_stem().unwrap().to_string_lossy();
        ts += s;
        th += h;
        tr += rr;
        println!("{name:<40} {s:>8.1} {h:>9.2} {rr:>9.2} {partials:>9}   (release {:.1} s)", nblk_r as f64 * BLOCK as f64 / 48000.0 / notes.len() as f64);
    }
    let n = files.len().max(1) as f64;
    println!("{:<40} {:>8.1} {:>9.2} {:>9.2}", "mean", ts / n, th / n, tr / n);
    println!("(a 64-frame block lasts 1333 µs: a voice costs held/13.3 % of a core while held)");
}
