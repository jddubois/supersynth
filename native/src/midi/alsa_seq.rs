//! MIDI devices through the ALSA sequencer (Linux).
//!
//! The engine is one sequencer client (named after the synth, "supersynth" by default) with a
//! port per input. An input's port takes events only from its own device: its subscription is
//! the only one it makes, the port refuses connections made by other programs (`NO_EXPORT`:
//! session managers such as amidiminder connect every device to every application port), and
//! events from any other sender are dropped. Output goes to a device directly, from one output
//! port, without a subscription.

use std::collections::HashMap;
use std::ffi::CString;
use std::time::Duration;

use alsa::seq::{Addr, ClientIter, EventType, MidiEvent, PortCap, PortInfo, PortIter, PortSubscribe, PortSubscribeIter, PortType, QuerySubsType};
use alsa::{Direction, PollDescriptors, Seq};

use super::devices::Deliver;

/// An encoder or decoder between sequencer events and MIDI bytes.
struct Coder(MidiEvent);

// SAFETY: the coder is only used with the backend's lock held.
unsafe impl Send for Coder {}

struct In {
    /// Our port.
    port: i32,
    /// The device's port it is subscribed to, while connected.
    from: Option<Addr>,
    deliver: Deliver,
}

pub struct Backend {
    seq: Seq,
    me: i32,
    decoder: Coder,
    encoder: Coder,
    ins: HashMap<usize, In>,
    out_port: Option<i32>,
    /// System Exclusive bytes received so far (they can come in several events).
    sysex: Vec<u8>,
}

fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', " ")).unwrap_or_default()
}

impl Backend {
    pub fn new(client_name: &str) -> Result<Self, String> {
        let seq = Seq::open(None, None, true).map_err(|e| format!("could not open the ALSA sequencer: {e}"))?;
        seq.set_client_name(&cstr(client_name)).map_err(|e| format!("could not name the ALSA sequencer client: {e}"))?;
        let me = seq.client_id().map_err(|e| e.to_string())?;
        let decoder = MidiEvent::new(0).map_err(|e| e.to_string())?;
        decoder.enable_running_status(false);
        let encoder = MidiEvent::new(256).map_err(|e| e.to_string())?;
        encoder.enable_running_status(false);
        Ok(Self { seq, me, decoder: Coder(decoder), encoder: Coder(encoder), ins: HashMap::new(), out_port: None, sysex: Vec::new() })
    }

    /// Ports (other than our own) with these capabilities, by name.
    fn ports(&self, caps: PortCap) -> Vec<(String, Addr)> {
        let mut out = Vec::new();
        for c in ClientIter::new(&self.seq) {
            if c.get_client() == self.me {
                continue;
            }
            let client = c.get_name().unwrap_or("").to_string();
            for p in PortIter::new(&self.seq, c.get_client()) {
                if !p.get_type().intersects(PortType::MIDI_GENERIC | PortType::SYNTH | PortType::APPLICATION) || !p.get_capability().contains(caps) {
                    continue;
                }
                let a = p.addr();
                // (the names midir gives, which supersynth used before)
                out.push((format!("{client}:{} {}:{}", p.get_name().unwrap_or(""), a.client, a.port), a));
            }
        }
        out
    }

    pub fn inputs(&self) -> Vec<String> {
        self.ports(PortCap::READ | PortCap::SUBS_READ).into_iter().map(|(n, _)| n).collect()
    }

    pub fn outputs(&self) -> Vec<String> {
        self.ports(PortCap::WRITE | PortCap::SUBS_WRITE).into_iter().map(|(n, _)| n).collect()
    }

    fn create_port(&self, name: &str, caps: PortCap) -> Result<i32, String> {
        let mut info = PortInfo::empty().map_err(|e| e.to_string())?;
        // NO_EXPORT: only we connect our ports; other programs cannot subscribe them
        info.set_capability(caps | PortCap::NO_EXPORT);
        info.set_type(PortType::MIDI_GENERIC | PortType::APPLICATION);
        info.set_midi_channels(16);
        info.set_name(&cstr(name));
        self.seq.create_port(&info).map_err(|e| format!("could not create an ALSA sequencer port: {e}"))?;
        Ok(info.get_port())
    }

    /// Connect input `slot` (its port called `label`) to the device `name`.
    pub fn connect(&mut self, slot: usize, name: &str, label: &str, deliver: Deliver) -> Result<(), String> {
        let from = self.ports(PortCap::READ | PortCap::SUBS_READ).into_iter().find(|(n, _)| n == name).map(|(_, a)| a).ok_or_else(|| format!("MIDI device '{name}' went away"))?;
        self.disconnect(slot);
        let port = match self.ins.get(&slot) {
            Some(i) => i.port,
            None => self.create_port(label, PortCap::WRITE)?,
        };
        self.ins.insert(slot, In { port, from: None, deliver });
        let sub = PortSubscribe::empty().map_err(|e| e.to_string())?;
        sub.set_sender(from);
        sub.set_dest(Addr { client: self.me, port });
        self.seq.subscribe_port(&sub).map_err(|e| format!("could not connect to MIDI device '{name}': {e}"))?;
        self.ins.get_mut(&slot).expect("inserted").from = Some(from);
        Ok(())
    }

    /// Whether input `slot` is still subscribed to its device: a device that went away and
    /// came back (at the same address) has lost the subscription.
    pub fn alive(&self, slot: usize) -> bool {
        let Some(In { port, from: Some(from), .. }) = self.ins.get(&slot) else { return false };
        PortSubscribeIter::new(&self.seq, Addr { client: self.me, port: *port }, QuerySubsType::WRITE).any(|s| s.get_sender() == *from)
    }

    /// Disconnect input `slot` from its device (keeping its port).
    pub fn disconnect(&mut self, slot: usize) {
        if let Some(i) = self.ins.get_mut(&slot) {
            if let Some(from) = i.from.take() {
                let _ = self.seq.unsubscribe_port(from, Addr { client: self.me, port: i.port });
            }
        }
    }

    /// Close input `slot`: disconnect it and delete its port.
    pub fn remove(&mut self, slot: usize) {
        self.disconnect(slot);
        if let Some(i) = self.ins.remove(&slot) {
            let _ = self.seq.delete_port(i.port);
        }
    }

    /// Deliver the events waiting, each to the input whose port it came to, if it comes from
    /// that input's device.
    pub fn pump(&mut self) {
        let mut input = self.seq.input();
        let mut buf = [0u8; 12];
        loop {
            match input.event_input_pending(true) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let mut ev = match input.event_input() {
                Ok(ev) => ev,
                // ENOSPC: the input buffer overran (events were lost); EAGAIN: nothing after all
                Err(e) if e.errno() == libc::ENOSPC => continue,
                Err(_) => break,
            };
            let dest = ev.get_dest().port;
            let source = ev.get_source();
            let Some(inp) = self.ins.values().find(|i| i.port == dest && i.from == Some(source)) else { continue };
            match ev.get_type() {
                EventType::PortSubscribed | EventType::PortUnsubscribed => {}
                EventType::Sysex => {
                    if let Some(data) = ev.get_ext() {
                        self.sysex.extend_from_slice(data);
                        if self.sysex.last() == Some(&0xF7) {
                            (inp.deliver)(&self.sysex);
                            self.sysex.clear();
                        }
                    }
                }
                _ => {
                    if let Ok(n) = self.decoder.0.decode(&mut buf, &mut ev) {
                        if n > 0 {
                            (inp.deliver)(&buf[..n]);
                        }
                    }
                }
            }
        }
    }

    /// Send whole MIDI messages to the output device `name`.
    pub fn send(&mut self, name: &str, msgs: &[&[u8]]) -> Result<(), String> {
        let dest = self.ports(PortCap::WRITE | PortCap::SUBS_WRITE).into_iter().find(|(n, _)| n == name).map(|(_, a)| a).ok_or_else(|| format!("MIDI device '{name}' went away"))?;
        let port = match self.out_port {
            Some(p) => p,
            None => {
                let p = self.create_port("output", PortCap::READ)?;
                self.out_port = Some(p);
                p
            }
        };
        for m in msgs {
            if m.len() > 256 {
                self.encoder.0.resize_buffer(m.len() as u32).map_err(|e| e.to_string())?;
            }
            self.encoder.0.reset_encode();
            let (_, ev) = self.encoder.0.encode(m).map_err(|e| format!("could not encode a MIDI message: {e}"))?;
            let Some(mut ev) = ev else { continue };
            ev.set_source(port);
            ev.set_dest(dest);
            ev.set_direct();
            self.seq.event_output_direct(&mut ev).map_err(|e| format!("could not send MIDI to '{name}': {e}"))?;
        }
        Ok(())
    }

    /// What the MIDI thread waits on: the sequencer's input, and a pipe to wake it.
    pub fn waiter(&self) -> Result<(Wait, Waker), String> {
        let mut fds = [0i32; 2];
        // SAFETY: a plain pipe(2)
        if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
            return Err("could not create a pipe for the MIDI thread".into());
        }
        let desc = (&self.seq, Some(Direction::Capture));
        let mut polls = vec![libc::pollfd { fd: fds[0], events: libc::POLLIN, revents: 0 }; desc.count() + 1];
        desc.fill(&mut polls[1..]).map_err(|e| e.to_string())?;
        Ok((Wait { polls, read: fds[0] }, Waker { write: fds[1] }))
    }
}

pub struct Wait {
    polls: Vec<libc::pollfd>,
    read: i32,
}

impl Wait {
    /// Until MIDI arrives, the waker is woken, or `timeout` passes.
    pub fn wait(&self, timeout: Duration) {
        let mut polls = self.polls.clone();
        // SAFETY: polling our own descriptors
        let r = unsafe { libc::poll(polls.as_mut_ptr(), polls.len() as libc::nfds_t, timeout.as_millis().min(i32::MAX as u128) as i32) };
        if r > 0 && polls[0].revents & libc::POLLIN != 0 {
            let mut b = [0u8; 64];
            // SAFETY: reading into a local buffer
            unsafe { libc::read(self.read, b.as_mut_ptr() as *mut libc::c_void, b.len()) };
        }
    }
}

impl Drop for Wait {
    fn drop(&mut self) {
        // SAFETY: our own descriptor
        unsafe { libc::close(self.read) };
    }
}

pub struct Waker {
    write: i32,
}

impl Waker {
    pub fn wake(&self) {
        let b = [1u8];
        // SAFETY: writing to our own pipe
        unsafe { libc::write(self.write, b.as_ptr() as *const libc::c_void, 1) };
    }
}

impl Drop for Waker {
    fn drop(&mut self) {
        // SAFETY: our own descriptor
        unsafe { libc::close(self.write) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi::devices::{Deliver, MidiDevices, OnState};
    use alsa::seq::{EvCtrl, Event};
    use std::sync::{mpsc, Arc, Mutex};

    /// A device of our own: a client with a port that others can read, which (`NO_EXPORT`) a
    /// session manager cannot connect elsewhere while the test runs.
    fn device(name: &str) -> Option<(Seq, i32)> {
        let seq = Seq::open(None, Some(Direction::Playback), false).ok()?;
        seq.set_client_name(&cstr(name)).ok()?;
        let port = seq.create_simple_port(&cstr("out"), PortCap::READ | PortCap::SUBS_READ | PortCap::NO_EXPORT, PortType::MIDI_GENERIC | PortType::APPLICATION).ok()?;
        Some((seq, port))
    }

    /// Send CC 1 = `value` on channel 16 (nothing that sounds) to the device's subscribers, or
    /// straight to `to`.
    fn send(dev: &(Seq, i32), value: i32, to: Option<Addr>) {
        let mut ev = Event::new(EventType::Controller, &EvCtrl { channel: 15, param: 1, value });
        ev.set_source(dev.1);
        match to {
            Some(a) => ev.set_dest(a),
            None => ev.set_subs(),
        }
        ev.set_direct();
        dev.0.event_output_direct(&mut ev).unwrap();
    }

    fn listen() -> (Deliver, OnState, mpsc::Receiver<Vec<u8>>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (Arc::new(move |b: &[u8]| drop(tx.lock().unwrap().send(b.to_vec()))), Arc::new(|_, _| {}), rx)
    }

    #[test]
    fn an_input_hears_only_its_own_device() {
        let pid = std::process::id();
        let (Some(keys), Some(pedals)) = (device(&format!("sstest keys {pid}")), device(&format!("sstest pedals {pid}"))) else {
            eprintln!("no ALSA sequencer: skipped");
            return;
        };
        let devices = MidiDevices::new("supersynth-test", 4).unwrap();
        let (d1, s1, keys_in) = listen();
        let (d2, s2, pedals_in) = listen();
        devices.open(1, Some(&format!("sstest keys {pid}")), false, d1, s1).unwrap();
        devices.open(2, Some(&format!("sstest pedals {pid}")), false, d2, s2).unwrap();
        // our input ports, as the system lists them
        let probe = Seq::open(None, None, false).unwrap();
        let ours: Vec<Addr> = ClientIter::new(&probe)
            .filter(|c| c.get_name().map(|n| n == "supersynth-test").unwrap_or(false))
            .flat_map(|c| PortIter::new(&probe, c.get_client()).map(|p| p.addr()).collect::<Vec<_>>())
            .collect();
        assert_eq!(ours.len(), 2);
        // a session manager (another client) cannot connect the pedals to the keys' input
        let sub = PortSubscribe::empty().unwrap();
        sub.set_sender(Addr { client: pedals.0.client_id().unwrap(), port: pedals.1 });
        for &port in &ours {
            sub.set_dest(port);
            assert!(probe.subscribe_port(&sub).is_err(), "connected to {port:?}");
        }
        let wait = |rx: &mpsc::Receiver<Vec<u8>>| rx.recv_timeout(std::time::Duration::from_secs(2)).ok();
        send(&keys, 11, None);
        assert_eq!(wait(&keys_in), Some(vec![0xBF, 1, 11]));
        send(&pedals, 22, None);
        assert_eq!(wait(&pedals_in), Some(vec![0xBF, 1, 22]));
        // sent straight to the other input's port: dropped
        for &port in &ours {
            send(&pedals, 33, Some(port));
        }
        send(&keys, 44, None);
        assert_eq!(wait(&keys_in), Some(vec![0xBF, 1, 44]));
        assert_eq!(wait(&pedals_in), Some(vec![0xBF, 1, 33]), "its own input still hears it");
        assert!(keys_in.try_recv().is_err() && pedals_in.try_recv().is_err());
    }
}
