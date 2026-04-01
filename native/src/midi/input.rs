use midir::{MidiInput, MidiInputConnection};
use std::sync::{Arc, Mutex};

pub type MidiCallback = Box<dyn Fn(Vec<u8>) + Send + 'static>;

/// Manages a MIDI input connection to a named device.
pub struct MidiInputHandle {
    // Keep connection alive — dropping it disconnects
    _connection: MidiInputConnection<()>,
}

pub fn list_midi_devices() -> Vec<String> {
    let Ok(midi_in) = MidiInput::new("supersynth-list") else {
        return vec![];
    };
    midi_in
        .ports()
        .iter()
        .filter_map(|p| midi_in.port_name(p).ok())
        .collect()
}

pub fn connect_midi_device(
    device_name: Option<&str>,
    callback: MidiCallback,
) -> Result<MidiInputHandle, String> {
    let midi_in = MidiInput::new("supersynth")
        .map_err(|e| format!("Failed to create MIDI input: {e}"))?;

    let ports = midi_in.ports();
    if ports.is_empty() {
        return Err("No MIDI input devices found".to_string());
    }

    // Select port: by name substring if given, otherwise first available
    let port = if let Some(name) = device_name {
        ports
            .iter()
            .find(|p| midi_in.port_name(p).map(|n| n.contains(name)).unwrap_or(false))
            .ok_or_else(|| format!("MIDI device '{name}' not found"))?
    } else {
        &ports[0]
    };

    let port_name = midi_in
        .port_name(port)
        .map_err(|e| format!("Failed to get port name: {e}"))?;

    let cb = Arc::new(Mutex::new(callback));
    let connection = midi_in
        .connect(
            port,
            &format!("supersynth-{port_name}"),
            move |_timestamp, message, _| {
                if let Ok(cb) = cb.lock() {
                    cb(message.to_vec());
                }
            },
            (),
        )
        .map_err(|e| format!("Failed to connect to MIDI device: {e}"))?;

    Ok(MidiInputHandle { _connection: connection })
}
