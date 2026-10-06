//! MIDI devices, kept connected: each input (a source of the engine's MIDI routes) follows the
//! first device whose name contains its pattern. A thread checks the devices twice a second,
//! connecting an input when its device appears (plugged in, switched on) and noticing when it
//! goes away; on Linux the same thread reads the input. Output goes straight to a device.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use super::backend::Backend;
use super::messages;

/// Delivers one MIDI message from an input's device.
pub type Deliver = Arc<dyn Fn(&[u8]) + Send + Sync>;
/// Told when an input's device connects (`true`, with its name) or goes away.
pub type OnState = Arc<dyn Fn(bool, &str) + Send + Sync>;

/// How often devices are checked.
const RESCAN: Duration = Duration::from_millis(500);

struct Input {
    /// Lower-case substring of the device name ("" for the first device).
    pattern: String,
    /// What the input's port is called in the system's MIDI graph (ALSA).
    label: String,
    /// The device connected now.
    port: Option<String>,
    deliver: Deliver,
    on_state: OnState,
}

struct State {
    backend: Backend,
    inputs: Vec<Option<Input>>,
}

struct Inner {
    state: Mutex<State>,
    stop: AtomicBool,
}

fn lock(m: &Mutex<State>) -> MutexGuard<'_, State> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The first device whose name contains `pattern` (already lower-case).
fn find<'a>(names: &'a [String], pattern: &str) -> Option<&'a String> {
    names.iter().find(|n| n.to_lowercase().contains(pattern))
}

/// MIDI inputs and outputs of one engine.
pub struct MidiDevices {
    inner: Arc<Inner>,
    thread: Option<JoinHandle<()>>,
    waker: super::backend::Waker,
}

impl MidiDevices {
    /// `client_name`: what the engine is called in the system's MIDI graph (ALSA's client).
    pub fn new(client_name: &str, sources: usize) -> Result<Self, String> {
        let backend = Backend::new(client_name)?;
        let (wait, waker) = backend.waiter()?;
        let inner = Arc::new(Inner { state: Mutex::new(State { backend, inputs: (0..sources).map(|_| None).collect() }), stop: AtomicBool::new(false) });
        let it = Arc::clone(&inner);
        let thread = std::thread::Builder::new()
            .name("supersynth-midi".into())
            .spawn(move || {
                let mut last = std::time::Instant::now();
                while !it.stop.load(Ordering::Acquire) {
                    let left = RESCAN.saturating_sub(last.elapsed());
                    wait.wait(left);
                    if it.stop.load(Ordering::Acquire) {
                        break;
                    }
                    let mut st = lock(&it.state);
                    st.backend.pump();
                    if last.elapsed() >= RESCAN {
                        rescan(&mut st);
                        last = std::time::Instant::now();
                    }
                }
            })
            .map_err(|e| format!("could not start the MIDI thread: {e}"))?;
        Ok(Self { inner, thread: Some(thread), waker })
    }

    /// Open input `slot`: connect it to the first device whose name contains `pattern`
    /// (ignoring case; the first device when `None`), now if there is one, and whenever such a
    /// device appears later. Replaces what the slot had. Returns the device's name, or `None`
    /// if there is none now; with `optional` false, no device is an error instead.
    pub fn open(&self, slot: usize, pattern: Option<&str>, optional: bool, deliver: Deliver, on_state: OnState) -> Result<Option<String>, String> {
        let mut st = lock(&self.inner.state);
        if slot >= st.inputs.len() {
            return Err(format!("MIDI input {slot} is out of range"));
        }
        close_slot(&mut st, slot);
        let names = st.backend.inputs();
        let pattern = pattern.unwrap_or("").to_lowercase();
        let found = find(&names, &pattern).cloned();
        if found.is_none() && !optional {
            return Err(if names.is_empty() { "No MIDI input devices found".to_string() } else { format!("MIDI device '{pattern}' not found (devices: {})", names.join(", ")) });
        }
        let label = if pattern.is_empty() { "input".to_string() } else { pattern.clone() };
        st.inputs[slot] = Some(Input { pattern, label, port: None, deliver, on_state });
        if let Some(name) = &found {
            connect(&mut st, slot, name).inspect_err(|_| st.inputs[slot] = None)?;
        }
        Ok(found)
    }

    /// Close input `slot` (nothing is told: the caller knows).
    pub fn close(&self, slot: usize) {
        let mut st = lock(&self.inner.state);
        if slot < st.inputs.len() {
            close_slot(&mut st, slot);
        }
    }

    /// Names of the input devices.
    pub fn inputs(&self) -> Vec<String> {
        lock(&self.inner.state).backend.inputs()
    }

    /// Names of the output devices.
    pub fn outputs(&self) -> Vec<String> {
        lock(&self.inner.state).backend.outputs()
    }

    /// Send `bytes` (one or more whole messages) to the first output device whose name contains
    /// `pattern` (ignoring case). `false` if there is no such device.
    pub fn send(&self, pattern: &str, bytes: &[u8]) -> Result<bool, String> {
        let msgs = messages::split(bytes)?;
        let mut st = lock(&self.inner.state);
        let names = st.backend.outputs();
        let Some(name) = find(&names, &pattern.to_lowercase()).cloned() else { return Ok(false) };
        st.backend.send(&name, &msgs)?;
        Ok(true)
    }
}

impl Drop for MidiDevices {
    fn drop(&mut self) {
        self.inner.stop.store(true, Ordering::Release);
        self.waker.wake();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        let mut st = lock(&self.inner.state);
        for slot in 0..st.inputs.len() {
            close_slot(&mut st, slot);
        }
    }
}

fn connect(st: &mut State, slot: usize, name: &str) -> Result<(), String> {
    let input = st.inputs[slot].as_ref().expect("slot open");
    let (label, deliver, on_state) = (input.label.clone(), Arc::clone(&input.deliver), Arc::clone(&input.on_state));
    st.backend.connect(slot, name, &label, deliver)?;
    st.inputs[slot].as_mut().expect("slot open").port = Some(name.to_string());
    on_state(true, name);
    Ok(())
}

fn close_slot(st: &mut State, slot: usize) {
    if st.inputs[slot].take().is_some() {
        st.backend.remove(slot);
    }
}

/// Notice devices that went away, and connect inputs whose device has appeared.
fn rescan(st: &mut State) {
    if st.inputs.iter().all(|i| i.is_none()) {
        return;
    }
    let names = st.backend.inputs();
    for slot in 0..st.inputs.len() {
        let Some(input) = &st.inputs[slot] else { continue };
        if let Some(port) = input.port.clone() {
            if names.contains(&port) && st.backend.alive(slot) {
                continue;
            }
            st.backend.disconnect(slot);
            let input = st.inputs[slot].as_mut().expect("slot open");
            input.port = None;
            (input.on_state)(false, &port);
        }
        let pattern = st.inputs[slot].as_ref().expect("slot open").pattern.clone();
        if let Some(name) = find(&names, &pattern).cloned() {
            // (a device that refuses the connection is tried again at the next scan)
            let _ = connect(st, slot, &name);
        }
    }
}

// (virtual ports: not on Windows)
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use midir::os::unix::{VirtualInput, VirtualOutput};
    use midir::{MidiInput, MidiOutput};
    use std::sync::mpsc;
    use std::time::Instant;

    /// Waits for what `rx` gets, up to 3 s.
    fn next<T>(rx: &mpsc::Receiver<T>) -> Option<T> {
        rx.recv_timeout(Duration::from_secs(3)).ok()
    }

    /// A device of our own (a virtual port), plugged in and out; skipped where the system has no
    /// MIDI (a CI machine without the ALSA sequencer). It sends only on channel 16, and nothing
    /// that sounds (a session manager may connect it to other programs).
    #[test]
    fn inputs_follow_their_device_and_output_reaches_one() {
        let name = format!("sstest{}", std::process::id());
        let Ok(devices) = MidiDevices::new("supersynth-test", 4) else {
            eprintln!("no MIDI here: skipped");
            return;
        };
        let (msg_tx, msgs) = mpsc::channel::<Vec<u8>>();
        let (state_tx, states) = mpsc::channel::<(bool, String)>();
        let msg_tx = Mutex::new(msg_tx);
        let state_tx = Mutex::new(state_tx);
        let deliver: Deliver = Arc::new(move |b: &[u8]| {
            let _ = msg_tx.lock().unwrap().send(b.to_vec());
        });
        let on_state: OnState = Arc::new(move |c: bool, n: &str| {
            let _ = state_tx.lock().unwrap().send((c, n.to_string()));
        });
        // no such device yet: an error, unless optional
        assert!(devices.open(1, Some(&name.to_uppercase()), false, Arc::clone(&deliver), Arc::clone(&on_state)).is_err());
        assert_eq!(devices.open(1, Some(&name.to_uppercase()), true, deliver, on_state).unwrap(), None);

        for round in 0..2 {
            // the device appears: the input connects to it
            let mut dev = MidiOutput::new("sstest-device").unwrap().create_virtual(&name).unwrap();
            let (c, n) = next(&states).expect("connected");
            assert!(c && n.contains(&name), "round {round}: {n}");
            assert!(devices.inputs().iter().any(|i| i.contains(&name)));
            let t = Instant::now();
            // (a connection made a moment ago may miss the first message)
            let got = loop {
                dev.send(&[0x9F, 60, 0]).unwrap();
                if let Ok(m) = msgs.recv_timeout(Duration::from_millis(100)) {
                    break m;
                }
                assert!(t.elapsed() < Duration::from_secs(3), "round {round}: no message");
            };
            assert_eq!(got, [0x9F, 60, 0]);
            dev.send(&[0xBF, 1, 0]).unwrap();
            assert_eq!(next(&msgs).unwrap(), [0xBF, 1, 0]);
            // the device goes away
            drop(dev);
            let (c, _) = next(&states).expect("disconnected");
            assert!(!c, "round {round}");
            while msgs.try_recv().is_ok() {}
        }
        devices.close(1);

        // output
        let (out_tx, outs) = mpsc::channel::<Vec<u8>>();
        let out_name = format!("sstestout{}", std::process::id());
        let _sink = MidiInput::new("sstest-sink")
            .unwrap()
            .create_virtual(&out_name, move |_, b, _| {
                let _ = out_tx.send(b.to_vec());
            }, ())
            .unwrap();
        let t = Instant::now();
        while !devices.outputs().iter().any(|o| o.contains(&out_name)) {
            assert!(t.elapsed() < Duration::from_secs(3), "the output device is not listed");
            std::thread::sleep(Duration::from_millis(50));
        }
        let local_off: Vec<u8> = (0..16u8).flat_map(|c| [0xB0 | c, 122, 0]).collect();
        assert!(devices.send(&out_name.to_uppercase(), &local_off).unwrap());
        for c in 0..16u8 {
            assert_eq!(next(&outs).expect("sent"), [0xB0 | c, 122, 0]);
        }
        assert!(!devices.send("no such device anywhere", &[0xB0, 122, 0]).unwrap());
        assert!(devices.send(&out_name, &[0x90, 60]).is_err(), "an incomplete message is refused");
    }
}
