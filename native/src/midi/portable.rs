//! MIDI devices through midir (macOS: CoreMIDI; Windows: WinMM).

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};

use super::devices::Deliver;

pub struct Backend {
    client_name: String,
    ins: HashMap<usize, MidiInputConnection<()>>,
    outs: HashMap<String, MidiOutputConnection>,
}

impl Backend {
    pub fn new(client_name: &str) -> Result<Self, String> {
        Ok(Self { client_name: client_name.to_string(), ins: HashMap::new(), outs: HashMap::new() })
    }

    // (a client per call: its port lists are current)
    fn midi_in(&self) -> Option<MidiInput> {
        MidiInput::new(&self.client_name).ok()
    }

    pub fn inputs(&self) -> Vec<String> {
        let Some(m) = self.midi_in() else { return vec![] };
        m.ports().iter().filter_map(|p| m.port_name(p).ok()).collect()
    }

    pub fn outputs(&self) -> Vec<String> {
        let Ok(m) = MidiOutput::new(&self.client_name) else { return vec![] };
        m.ports().iter().filter_map(|p| m.port_name(p).ok()).collect()
    }

    pub fn connect(&mut self, slot: usize, name: &str, label: &str, deliver: Deliver) -> Result<(), String> {
        self.disconnect(slot);
        let m = self.midi_in().ok_or("could not open MIDI input")?;
        let port = m.ports().into_iter().find(|p| m.port_name(p).ok().as_deref() == Some(name)).ok_or_else(|| format!("MIDI device '{name}' went away"))?;
        let conn = m
            .connect(&port, &format!("{}-{label}", self.client_name), move |_, bytes, _| deliver(bytes), ())
            .map_err(|e| format!("could not connect to MIDI device '{name}': {e}"))?;
        self.ins.insert(slot, conn);
        Ok(())
    }

    /// (A device still listed is taken to be connected.)
    pub fn alive(&self, slot: usize) -> bool {
        self.ins.contains_key(&slot)
    }

    pub fn disconnect(&mut self, slot: usize) {
        if let Some(c) = self.ins.remove(&slot) {
            c.close();
        }
    }

    pub fn remove(&mut self, slot: usize) {
        self.disconnect(slot);
    }

    /// (midir delivers input on threads of its own.)
    pub fn pump(&mut self) {}

    pub fn send(&mut self, name: &str, msgs: &[&[u8]]) -> Result<(), String> {
        for attempt in 0..2 {
            if !self.outs.contains_key(name) {
                let m = MidiOutput::new(&self.client_name).map_err(|e| e.to_string())?;
                let port = m.ports().into_iter().find(|p| m.port_name(p).ok().as_deref() == Some(name)).ok_or_else(|| format!("MIDI device '{name}' went away"))?;
                let conn = m.connect(&port, &format!("{}-output", self.client_name)).map_err(|e| format!("could not connect to MIDI device '{name}': {e}"))?;
                self.outs.insert(name.to_string(), conn);
            }
            let conn = self.outs.get_mut(name).expect("connected");
            match msgs.iter().try_for_each(|m| conn.send(m)) {
                Ok(()) => return Ok(()),
                // the device may have gone away and come back: reconnect once
                Err(e) => {
                    self.outs.remove(name);
                    if attempt == 1 {
                        return Err(format!("could not send MIDI to '{name}': {e}"));
                    }
                }
            }
        }
        Ok(())
    }

    pub fn waiter(&self) -> Result<(Wait, Waker), String> {
        let w = Arc::new((Mutex::new(false), Condvar::new()));
        Ok((Wait(Arc::clone(&w)), Waker(w)))
    }
}

type Flag = Arc<(Mutex<bool>, Condvar)>;

pub struct Wait(Flag);

impl Wait {
    pub fn wait(&self, timeout: Duration) {
        let (m, c) = &*self.0;
        let g = m.lock().unwrap_or_else(|e| e.into_inner());
        let (mut g, _) = c.wait_timeout_while(g, timeout, |woken| !*woken).unwrap_or_else(|e| e.into_inner());
        *g = false;
    }
}

pub struct Waker(Flag);

impl Waker {
    pub fn wake(&self) {
        let (m, c) = &*self.0;
        *m.lock().unwrap_or_else(|e| e.into_inner()) = true;
        c.notify_all();
    }
}
