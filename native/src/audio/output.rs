use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig, StreamError};
use supersynth_core::engine::Engine;
use supersynth_host::fault::{render_guarded, Fault};

use super::backend::{get_host, BackendKind};

pub struct AudioOutput {
    _stream: Box<dyn StreamTrait>,
}

/// Told when the output reports an xrun, or stops for good (`Some(reason)`: the device went
/// away, the JACK server shut down, the engine failed).
pub type Notify = Box<dyn Fn(Option<&str>) + Send + Sync>;

/// What happens to a running output, for the API: xruns counted, and whether (and why) it
/// stopped by itself.
#[derive(Default)]
pub struct OutputEvents {
    xruns: AtomicU64,
    stopped: AtomicBool,
    notify: Mutex<Option<Notify>>,
}

impl OutputEvents {
    pub fn xruns(&self) -> u64 {
        self.xruns.load(Ordering::Relaxed)
    }

    pub fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    /// A new output starts: stopped no more, told through `notify`.
    pub fn reset(&self, notify: Option<Notify>) {
        self.stopped.store(false, Ordering::Release);
        *self.notify.lock().unwrap_or_else(|e| e.into_inner()) = notify;
    }

    fn tell(&self, what: Option<&str>) {
        if let Some(n) = &*self.notify.lock().unwrap_or_else(|e| e.into_inner()) {
            n(what);
        }
    }

    fn xrun(&self) {
        self.xruns.fetch_add(1, Ordering::Relaxed);
        self.tell(None);
    }

    /// The output stopped for good (once).
    pub fn stop(&self, reason: &str) {
        if !self.stopped.swap(true, Ordering::AcqRel) {
            self.tell(Some(reason));
        }
    }

    /// An error reported by the audio backend: an xrun is counted; the device going away or
    /// the JACK server shutting down stops the output; anything else is printed.
    fn backend_error(&self, e: StreamError) {
        match e {
            StreamError::DeviceNotAvailable => self.stop("the audio device is no longer available"),
            StreamError::BackendSpecific { err } => {
                let d = err.description;
                if d.contains("xrun") {
                    self.xrun();
                } else if d.contains("shut down") {
                    self.stop(&d);
                } else {
                    eprintln!("supersynth audio stream error: {d}");
                }
            }
        }
    }
}

/// Integer-format streams render through a fixed float scratch buffer, in chunks (no
/// allocation in the callback whatever the buffer size).
const SCRATCH_SAMPLES: usize = 8192;

fn render_converted<T>(engine: &Mutex<Engine>, fault: &Fault, scratch: &mut [f32], data: &mut [T], ch: usize, conv: impl Fn(f32) -> T) -> bool {
    let chunk = (scratch.len() / ch).max(1) * ch;
    let mut ok = true;
    for out in data.chunks_mut(chunk) {
        let s = &mut scratch[..out.len()];
        // (render_guarded zeroes the scratch when it cannot render: no stale buffer repeats)
        ok &= render_guarded(engine, fault, s, ch);
        for (o, &x) in out.iter_mut().zip(s.iter()) {
            *o = conv(x);
        }
    }
    ok
}

/// After a buffer: the first time the engine has failed, the output stops (it plays silence
/// from now on).
#[inline]
fn check_fault(rendered: bool, fault: &Fault, events: &OutputEvents) {
    if !rendered && !events.stopped() {
        // (once: allocates, and takes the notification's lock, on the audio thread)
        events.stop(&fault.message().unwrap_or_else(|| "the audio engine failed".into()));
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
    /// `client_name`: the output's name where the backend shows one (JACK: `<name>_out`).
    ///
    /// The audio callback is the only place the engine is locked while streaming
    /// (the API thread talks to it through the lock-free command queue), so the
    /// lock is uncontended and never blocks the audio thread.
    pub fn start(
        engine: Arc<Mutex<Engine>>,
        fault: Arc<Fault>,
        events: Arc<OutputEvents>,
        backend: &BackendKind,
        sample_rate: u32,
        buffer_frames: Option<u32>,
        client_name: &str,
    ) -> Result<Self, String> {
        #[cfg(target_os = "linux")]
        if *backend == BackendKind::Jack {
            // a JACK client named after the synth (cpal's own JACK host names it cpal_client_out)
            match cpal::platform::JackDevice::default_output_device(client_name, true, false) {
                Ok(device) => return Self::start_on(device, engine, fault, events, sample_rate, buffer_frames),
                Err(e) => eprintln!("supersynth: JACK not available ({e}), falling back to default"),
            }
        }
        let _ = client_name;
        let host = get_host(backend);
        let device = host.default_output_device().ok_or_else(|| "No output audio device found".to_string())?;
        Self::start_on(device, engine, fault, events, sample_rate, buffer_frames)
    }

    fn start_on<D: DeviceTrait>(
        device: D,
        engine: Arc<Mutex<Engine>>,
        fault: Arc<Fault>,
        events: Arc<OutputEvents>,
        sample_rate: u32,
        buffer_frames: Option<u32>,
    ) -> Result<Self, String>
    where
        D::Stream: 'static,
    {
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
        let ev = Arc::clone(&events);
        let err_fn = move |e| ev.backend_error(e);
        let stream = match format {
            SampleFormat::F32 => {
                let eng = Arc::clone(&engine);
                device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _| {
                        let ok = render_guarded(&eng, &fault, data, ch);
                        check_fault(ok, &fault, &events);
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
                        let ok = render_converted(&eng, &fault, &mut scratch, data, ch, |s| (s.clamp(-1.0, 1.0) * 32767.0) as i16);
                        check_fault(ok, &fault, &events);
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
                        let ok = render_converted(&eng, &fault, &mut scratch, data, ch, |s| ((s.clamp(-1.0, 1.0) * 32767.0) as i32 + 32768) as u16);
                        check_fault(ok, &fault, &events);
                    },
                    err_fn,
                    None,
                )
            }
        }
        .map_err(|e| format!("Failed to build audio stream: {e}"))?;
        stream.play().map_err(|e| format!("Failed to start audio stream: {e}"))?;
        Ok(Self { _stream: Box::new(stream) })
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
        let path = format!("{}/../packages/instruments/models/marimba.ssm", env!("CARGO_MANIFEST_DIR"));
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
        assert!(!render_converted(&eng, &fault, &mut scratch, &mut ints, 2, |s| (s * 32767.0) as i16));
        assert!(fault.is_set());
        assert!(ints.iter().all(|&v| v == 0), "integer output is silent, no stale buffer");
    }
}

#[cfg(test)]
mod event_tests {
    use super::*;
    use cpal::BackendSpecificError;

    #[test]
    fn xruns_are_counted_and_a_lost_device_stops_the_output_once() {
        let ev = OutputEvents::default();
        let told = Arc::new(Mutex::new(Vec::<Option<String>>::new()));
        let t = Arc::clone(&told);
        ev.reset(Some(Box::new(move |w| t.lock().unwrap().push(w.map(String::from)))));
        let backend = |d: &str| StreamError::BackendSpecific { err: BackendSpecificError { description: d.into() } };
        ev.backend_error(backend("xrun (buffer over or under run)"));
        ev.backend_error(backend("xrun (buffer over or under run)"));
        assert_eq!(ev.xruns(), 2);
        assert!(!ev.stopped());
        ev.backend_error(backend("JACK was shut down for reason: server is gone"));
        ev.backend_error(StreamError::DeviceNotAvailable);
        assert!(ev.stopped());
        let told = told.lock().unwrap();
        assert_eq!(*told, [None, None, Some("JACK was shut down for reason: server is gone".to_string())]);
        ev.reset(None);
        assert!(!ev.stopped());
    }
}
