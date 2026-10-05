//! The audio thread must never allocate or free memory: rendering and applying the usual
//! commands are checked with a counting global allocator (armed only around the engine's
//! render calls, on the rendering thread).

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Arc;

use supersynth_core::engine::params::{MasterParam, PartParam};
use supersynth_core::engine::{Command, Controller, Engine, EngineConfig, InstLayer, Instrument};
use supersynth_core::model::Model;

struct Counting;

thread_local! {
    static ARMED: Cell<bool> = const { Cell::new(false) };
    static COUNT: Cell<usize> = const { Cell::new(0) };
}

fn note_alloc() {
    let _ = ARMED.try_with(|a| {
        if a.get() {
            COUNT.with(|c| c.set(c.get() + 1));
        }
    });
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        note_alloc();
        System.alloc(l)
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        note_alloc();
        System.alloc_zeroed(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        note_alloc();
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        note_alloc();
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

fn model(name: &str) -> Option<Arc<Model>> {
    let path = format!("{}/../../models/{name}.ssm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(path).ok().map(|b| Arc::new(Model::from_bytes(&b).expect("model parses")))
}

/// Render `frames` with the allocation counter armed; returns the number of (de)allocations.
fn render(eng: &mut Engine, frames: usize) -> usize {
    let mut l = vec![0.0f32; frames];
    let mut r = vec![0.0f32; frames];
    COUNT.with(|c| c.set(0));
    ARMED.with(|a| a.set(true));
    for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        eng.process_planar(cl, cr);
    }
    ARMED.with(|a| a.set(false));
    COUNT.with(|c| c.get())
}

fn layer(model: Arc<Model>, transpose: f32, enabled: bool) -> InstLayer {
    InstLayer { model, transpose, gain_db: 0.0, pan: 0.0, key_lo: 0, key_hi: 127, enabled, detune_cents: 0.0, on_release: false }
}

fn check(eng: &mut Engine, ctl: &mut Controller, what: &str, cmds: Vec<Command>, frames: usize) {
    for c in cmds {
        ctl.send(0, c).unwrap();
    }
    let n = render(eng, frames);
    ctl.collect_garbage();
    assert_eq!(n, 0, "{what}: {n} allocations/frees on the audio thread");
}

#[test]
fn rendering_and_commands_do_not_allocate() {
    let (Some(piano), Some(p8), Some(o4), Some(flute), Some(violin)) = (
        model("grand-piano"),
        model("organ/great-principal-8"),
        model("organ/great-octave-4"),
        model("organ/swell-rohrflute-8"),
        model("violin"),
    ) else {
        return;
    };
    let (mut eng, mut ctl) = Engine::new(EngineConfig { max_voices: 24, ..EngineConfig::default() });
    let (e, c) = (&mut eng, &mut ctl);
    check(e, c, "instrument change", vec![Command::set_instrument(0, Instrument::single(piano.clone()))], 4800);
    check(e, c, "idle", vec![], 4800);
    let chord = (48..60).map(|n| Command::NoteOn { part: 0, note: n, velocity: 100 }).collect();
    check(e, c, "notes", chord, 9600);
    check(
        e,
        c,
        "controllers",
        vec![
            Command::ControlChange { part: 0, controller: 64, value: 127 },
            Command::PitchBend { part: 0, value: 0.5 },
            Command::ControlChange { part: 0, controller: 11, value: 0 },
            Command::ControlChange { part: 0, controller: 1, value: 90 },
            Command::SetPartParam { part: 0, param: PartParam::Brightness, value: 2.0 },
            Command::SetPartParam { part: 0, param: PartParam::EqHighDb, value: -6.0 },
            Command::SetPartParam { part: 0, param: PartParam::ChorusMix, value: 0.4 },
            Command::SetPartParam { part: 0, param: PartParam::DriveAmount, value: 3.0 },
            Command::SetPartParam { part: 0, param: PartParam::Leslie, value: 3.0 },
            Command::SetMasterParam { param: MasterParam::Volume, value: -3.0 },
            Command::SetMasterParam { param: MasterParam::ReverbReturn, value: -2.0 },
            Command::SetMasterParam { param: MasterParam::ReverbDecay, value: 3.5 },
        ],
        9600,
    );
    let damp = (48..60).map(|n| Command::NoteOff { part: 0, note: n }).chain([Command::ControlChange { part: 0, controller: 64, value: 0 }]);
    check(e, c, "note-off and pedal", damp.collect(), 9600);
    // voice stealing: far more notes than voices
    let many = (30..90).map(|n| Command::NoteOn { part: 0, note: n, velocity: 90 }).collect();
    check(e, c, "voice stealing", many, 9600);
    check(e, c, "all sound off", vec![Command::AllSoundOff], 4800);

    // an organ division: stops added and switched while keys are held
    check(e, c, "organ", vec![Command::set_instrument(1, Instrument::single(p8.clone()))], 4800);
    let keys = [60u8, 64, 67].iter().map(|&n| Command::NoteOn { part: 1, note: n, velocity: 100 }).collect();
    check(e, c, "organ keys", keys, 4800);
    check(e, c, "add stop", vec![Command::add_layer(1, layer(o4.clone(), 12.0, true))], 4800);
    check(e, c, "add disabled stop", vec![Command::add_layer(1, layer(flute.clone(), 0.0, false))], 4800);
    for _ in 0..3 {
        check(
            e,
            c,
            "stop toggles",
            vec![
                Command::SetLayerEnabled { part: 1, layer: 2, enabled: true },
                Command::SetLayerEnabled { part: 1, layer: 1, enabled: false },
            ],
            2400,
        );
        check(
            e,
            c,
            "stop toggles",
            vec![
                Command::SetLayerEnabled { part: 1, layer: 2, enabled: false },
                Command::SetLayerEnabled { part: 1, layer: 1, enabled: true },
            ],
            2400,
        );
    }
    // more layers than the instrument has room for: moved into the controller's spare
    let stops = (0..70).map(|i| Command::add_layer(1, layer(flute.clone(), (i % 3) as f32 * 12.0, false))).collect();
    check(e, c, "many stops", stops, 4800);
    check(e, c, "couplers", vec![Command::SetCouplers { part: 0, targets: 1 << 1 }, Command::NoteOn { part: 0, note: 72, velocity: 90 }], 4800);
    check(e, c, "all notes off", vec![Command::AllNotesOff { part: None }], 48000);

    // legato
    check(
        e,
        c,
        "legato",
        vec![
            Command::set_instrument(2, Instrument::single(violin.clone())),
            Command::SetPartParam { part: 2, param: PartParam::Legato, value: 1.0 },
            Command::NoteOn { part: 2, note: 69, velocity: 100 },
        ],
        4800,
    );
    check(e, c, "legato", vec![Command::NoteOn { part: 2, note: 72, velocity: 100 }], 4800);
    // replacing instruments: the old models' last references leave through the garbage ring
    check(e, c, "replace", vec![Command::set_instrument(2, Instrument::single(piano.clone())), Command::NoteOn { part: 2, note: 60, velocity: 90 }], 4800);
    drop((piano, p8, o4, flute, violin));
    check(e, c, "unload", vec![Command::set_instrument(0, Instrument::default()), Command::set_instrument(1, Instrument::default())], 48000);
    check(e, c, "unload", vec![Command::set_instrument(2, Instrument::default())], 48000);
}

#[test]
fn reverb_parameter_changes_do_not_allocate() {
    let (mut eng, mut ctl) = Engine::new(EngineConfig::default());
    render(&mut eng, 4800);
    check(&mut eng, &mut ctl, "reverb", vec![Command::SetMasterParam { param: MasterParam::ReverbDecay, value: 3.5 }], 4800);
}
