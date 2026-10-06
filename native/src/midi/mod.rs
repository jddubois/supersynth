//! MIDI devices: inputs that stay connected across unplugging, and output to a device.

pub mod devices;
pub mod messages;

#[cfg(target_os = "linux")]
mod alsa_seq;
#[cfg(target_os = "linux")]
use alsa_seq as backend;

#[cfg(not(target_os = "linux"))]
mod portable;
#[cfg(not(target_os = "linux"))]
use portable as backend;
