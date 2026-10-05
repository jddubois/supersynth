//! ssrender — offline renderer for evaluating spectral models.
//!
//! ```text
//! ssrender <model.ssm> <out.wav> [options] <note:velocity:start:duration>...
//!   --sr 48000            sample rate
//!   --tail 2.0            seconds rendered after the last note-off
//!   --reverb <preset|off> reverb preset (default: off → dry)
//!   --set name=value      part parameter (repeatable), e.g. --set brightness=1.5
//!   --mono                write a mono file
//!   --bench               report real-time factor
//!   --threads N           rendering threads (default: one per core but one)
//! ```

use std::sync::Arc;

use supersynth_core::engine::params::{MasterParam, PartParam};
use supersynth_core::engine::{Command, Engine, EngineConfig, Instrument};
use supersynth_core::fx::reverb::ReverbParams;
use supersynth_core::model::Model;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: ssrender <model.ssm> <out.wav> [--sr N] [--tail S] [--reverb P] [--set k=v] note:vel:start:dur ...");
        std::process::exit(2);
    }
    let model_path = &args[1];
    let out_path = &args[2];
    let mut sr = 48000.0f32;
    let mut tail = 2.0f32;
    let mut reverb: Option<String> = None;
    let mut sets: Vec<(String, f32)> = vec![];
    let mut notes: Vec<(u8, u8, f32, f32)> = vec![];
    let mut mono = false;
    let mut bench = false;
    let mut threads = supersynth_core::engine::default_threads();
    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--sr" => {
                sr = args[i + 1].parse().unwrap();
                i += 1;
            }
            "--tail" => {
                tail = args[i + 1].parse().unwrap();
                i += 1;
            }
            "--reverb" => {
                reverb = Some(args[i + 1].clone());
                i += 1;
            }
            "--set" => {
                let (k, v) = args[i + 1].split_once('=').expect("--set k=v");
                sets.push((k.to_string(), v.parse().unwrap()));
                i += 1;
            }
            "--threads" => {
                threads = args[i + 1].parse().unwrap();
                i += 1;
            }
            "--mono" => mono = true,
            "--bench" => bench = true,
            s => {
                let p: Vec<&str> = s.split(':').collect();
                notes.push((p[0].parse().unwrap(), p[1].parse().unwrap(), p[2].parse().unwrap(), p[3].parse().unwrap()));
            }
        }
        i += 1;
    }
    let bytes = std::fs::read(model_path).expect("read model");
    let model = Arc::new(Model::from_bytes(&bytes).expect("parse model"));
    let rp = reverb
        .as_deref()
        .filter(|r| *r != "off")
        .and_then(ReverbParams::preset)
        .unwrap_or_else(|| ReverbParams::preset("hall").unwrap());
    let (mut eng, mut ctl) = Engine::new(EngineConfig { sample_rate: sr, max_voices: 256, reverb: rp, threads });
    ctl.send(0, Command::set_instrument(0, Instrument::single(model))).unwrap();
    ctl.send(0, Command::SetMasterParam { param: MasterParam::Volume, value: 0.0 }).unwrap();
    if reverb.as_deref().map(|r| r == "off").unwrap_or(true) {
        ctl.send(0, Command::SetPartParam { part: 0, param: PartParam::ReverbSend, value: 0.0 }).unwrap();
    }
    for (k, v) in &sets {
        let p = PartParam::parse(k).unwrap_or_else(|| panic!("unknown param {k}"));
        ctl.send(0, Command::SetPartParam { part: 0, param: p, value: *v }).unwrap();
    }
    let mut end = 0.0f32;
    for &(n, v, s, d) in &notes {
        let t0 = (s * sr) as u64 + 1;
        let t1 = ((s + d) * sr) as u64 + 1;
        ctl.send(t0, Command::NoteOn { part: 0, note: n, velocity: v }).unwrap();
        ctl.send(t1, Command::NoteOff { part: 0, note: n }).unwrap();
        end = end.max(s + d);
    }
    let total = ((end + tail) * sr) as usize;
    let mut l = vec![0.0f32; total];
    let mut r = vec![0.0f32; total];
    let t = std::time::Instant::now();
    let chunk = 512;
    let mut pos = 0;
    let mut max_voices = 0;
    while pos < total {
        let n = chunk.min(total - pos);
        let (a, b) = (&mut l[pos..pos + n], &mut r[pos..pos + n]);
        eng.process_planar(a, b);
        max_voices = max_voices.max(eng.active_voices());
        pos += n;
    }
    let el = t.elapsed().as_secs_f64();
    if bench {
        eprintln!(
            "rendered {:.2}s in {:.3}s → {:.1}x real time (peak voices {})",
            total as f64 / sr as f64,
            el,
            total as f64 / sr as f64 / el,
            max_voices
        );
    }
    write_wav(out_path, sr as u32, &l, &r, mono).expect("write wav");
}

fn write_wav(path: &str, sr: u32, l: &[f32], r: &[f32], mono: bool) -> std::io::Result<()> {
    let ch: u16 = if mono { 1 } else { 2 };
    let n = l.len();
    let data_len = (n * ch as usize * 4) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    out.extend_from_slice(&ch.to_le_bytes());
    out.extend_from_slice(&sr.to_le_bytes());
    out.extend_from_slice(&(sr * ch as u32 * 4).to_le_bytes());
    out.extend_from_slice(&(ch * 4).to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..n {
        if mono {
            out.extend_from_slice(&(0.5 * (l[i] + r[i])).to_le_bytes());
        } else {
            out.extend_from_slice(&l[i].to_le_bytes());
            out.extend_from_slice(&r[i].to_le_bytes());
        }
    }
    std::fs::write(path, out)
}
