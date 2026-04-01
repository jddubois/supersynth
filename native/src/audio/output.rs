use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use std::sync::{Arc, Mutex};

use super::backend::{get_host, BackendKind};
use super::engine::Engine;

pub struct AudioOutput {
    _stream: Stream,
}

impl AudioOutput {
    pub fn start(engine: Arc<Mutex<Engine>>, backend: &BackendKind, sample_rate: u32) -> Result<Self, String> {
        let host = get_host(backend);

        let device = host
            .default_output_device()
            .ok_or_else(|| "No output audio device found".to_string())?;

        let supported = device
            .supported_output_configs()
            .map_err(|e| format!("Failed to get output configs: {e}"))?
            .next()
            .ok_or_else(|| "No supported output configs".to_string())?;

        let channels = supported.channels() as usize;
        let config = StreamConfig {
            channels: supported.channels(),
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let engine_cb = Arc::clone(&engine);
        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    if let Ok(mut eng) = engine_cb.lock() {
                        eng.fill_buffer(data, channels);
                    }
                },
                move |err| {
                    eprintln!("supersynth audio stream error: {err}");
                },
                None,
            )
            .map_err(|e| format!("Failed to build audio stream: {e}"))?;

        stream.play().map_err(|e| format!("Failed to start audio stream: {e}"))?;

        Ok(Self { _stream: stream })
    }
}
