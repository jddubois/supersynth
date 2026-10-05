use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use supersynth_core::engine::Engine;
use supersynth_host::fault::{render_guarded, Fault};

use super::backend::{get_host, BackendKind};

pub struct AudioOutput {
    _stream: Stream,
}

/// Integer-format streams render through a fixed float scratch buffer, in chunks (no
/// allocation in the callback whatever the buffer size).
const SCRATCH_SAMPLES: usize = 8192;

fn render_converted<T>(engine: &Mutex<Engine>, fault: &Fault, scratch: &mut [f32], data: &mut [T], ch: usize, conv: impl Fn(f32) -> T) {
    let chunk = (scratch.len() / ch).max(1) * ch;
    for out in data.chunks_mut(chunk) {
        let s = &mut scratch[..out.len()];
        // (render_guarded zeroes the scratch when it cannot render: no stale buffer repeats)
        render_guarded(engine, fault, s, ch);
        for (o, &x) in out.iter_mut().zip(s.iter()) {
            *o = conv(x);
        }
    }
}

/// The default output device's preferred sample rate, if a device exists.
pub fn default_output_rate(backend: &BackendKind) -> Option<u32> {
    let host = get_host(backend);
    let dev = host.default_output_device()?;
    dev.default_output_config().ok().map(|c| c.sample_rate().0)
}

impl AudioOutput {
    /// Open the default output device at the engine's sample rate and start streaming.
    ///
    /// The audio callback is the only place the engine is locked while streaming
    /// (the API thread talks to it through the lock-free command queue), so the
    /// lock is uncontended and never blocks the audio thread.
    pub fn start(
        engine: Arc<Mutex<Engine>>,
        fault: Arc<Fault>,
        backend: &BackendKind,
        sample_rate: u32,
        buffer_frames: Option<u32>,
    ) -> Result<Self, String> {
        let host = get_host(backend);
        let device = host.default_output_device().ok_or_else(|| "No output audio device found".to_string())?;

        // pick a supported config at our sample rate, preferring f32 and 2 channels
        let mut best: Option<(cpal::SupportedStreamConfigRange, i32)> = None;
        for range in device.supported_output_configs().map_err(|e| format!("Failed to query output configs: {e}"))? {
            if range.min_sample_rate().0 > sample_rate || range.max_sample_rate().0 < sample_rate {
                continue;
            }
            let fmt_score = match range.sample_format() {
                SampleFormat::F32 => 3,
                SampleFormat::I16 => 2,
                SampleFormat::U16 => 1,
                _ => -100,
            };
            let ch_score = if range.channels() == 2 { 2 } else if range.channels() >= 2 { 1 } else { 0 };
            let score = fmt_score * 10 + ch_score;
            if best.as_ref().map(|b| score > b.1).unwrap_or(true) {
                best = Some((range, score));
            }
        }
        let (range, score) = best.ok_or_else(|| {
            let dflt = device.default_output_config().map(|c| c.sample_rate().0).unwrap_or(0);
            format!(
                "The output device does not support {sample_rate} Hz (its default is {dflt} Hz). \
                 Create the Synth with {{ sampleRate: {dflt} }} or omit sampleRate to use the device rate."
            )
        })?;
        if score < 0 {
            return Err("No supported sample format (need f32, i16 or u16)".into());
        }
        let format = range.sample_format();
        let channels = range.channels();
        let config = StreamConfig {
            channels,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: match buffer_frames {
                Some(n) => cpal::BufferSize::Fixed(n),
                None => cpal::BufferSize::Default,
            },
        };
        let ch = channels as usize;
        let err_fn = |err| eprintln!("supersynth audio stream error: {err}");
        let stream = match format {
            SampleFormat::F32 => {
                let eng = Arc::clone(&engine);
                device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _| {
                        render_guarded(&eng, &fault, data, ch);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let eng = Arc::clone(&engine);
                let mut scratch = vec![0.0f32; SCRATCH_SAMPLES.max(ch)];
                device.build_output_stream(
                    &config,
                    move |data: &mut [i16], _| {
                        render_converted(&eng, &fault, &mut scratch, data, ch, |s| (s.clamp(-1.0, 1.0) * 32767.0) as i16);
                    },
                    err_fn,
                    None,
                )
            }
            _ => {
                let eng = Arc::clone(&engine);
                let mut scratch = vec![0.0f32; SCRATCH_SAMPLES.max(ch)];
                device.build_output_stream(
                    &config,
                    move |data: &mut [u16], _| {
                        render_converted(&eng, &fault, &mut scratch, data, ch, |s| ((s.clamp(-1.0, 1.0) * 32767.0) as i32 + 32768) as u16);
                    },
                    err_fn,
                    None,
                )
            }
        }
        .map_err(|e| format!("Failed to build audio stream: {e}"))?;
        stream.play().map_err(|e| format!("Failed to start audio stream: {e}"))?;
        Ok(Self { _stream: stream })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use supersynth_core::engine::{Command, EngineConfig, Instrument};
    use supersynth_core::model::Model;

    /// A failed engine also leaves integer output silent: no stale scratch buffer repeats.
    #[test]
    fn a_panic_while_rendering_silences_integer_output() {
        let path = format!("{}/../models/marimba.ssm", env!("CARGO_MANIFEST_DIR"));
        let Ok(bytes) = std::fs::read(path) else { return };
        let mut m = Model::from_bytes(&bytes).unwrap();
        for z in m.zones.iter_mut() {
            z.amps.clear(); // inconsistent with its frame count: the voice indexes out of bounds
        }
        let (eng, mut ctl) = Engine::new(EngineConfig::default());
        ctl.send(0, Command::set_instrument(0, Instrument::single(Arc::new(m)))).unwrap();
        ctl.send(0, Command::NoteOn { part: 0, note: 60, velocity: 100 }).unwrap();
        let eng = Mutex::new(eng);
        let fault = Fault::default();
        let mut ints = [7i16; 300];
        let mut scratch = [1.0f32; 64];
        render_converted(&eng, &fault, &mut scratch, &mut ints, 2, |s| (s * 32767.0) as i16);
        assert!(fault.is_set());
        assert!(ints.iter().all(|&v| v == 0), "integer output is silent, no stale buffer");
    }
}
