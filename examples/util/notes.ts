/**
 * MIDI note number constants — full range 0–127.
 *
 * Naming convention:
 *   <note><octave>  — naturals    e.g. C4 = 60, A4 = 69
 *   <note>s<octave> — sharps      e.g. Cs4 = 61, Fs4 = 66
 *   <note>b<octave> — flats       e.g. Bb4 = 70, Eb4 = 63
 *
 * Middle C is C4 = 60 (standard General MIDI / Roland convention).
 * Enharmonic equivalents share the same value: Cs4 === Db4 = 61.
 */

// ── Octave –1  (MIDI 0–11) ───────────────────────────────────────────────────
export const C_1  =  0;
export const Cs_1 =  1; export const Db_1 =  1;
export const D_1  =  2;
export const Ds_1 =  3; export const Eb_1 =  3;
export const E_1  =  4;
export const F_1  =  5;
export const Fs_1 =  6; export const Gb_1 =  6;
export const G_1  =  7;
export const Gs_1 =  8; export const Ab_1 =  8;
export const A_1  =  9;
export const As_1 = 10; export const Bb_1 = 10;
export const B_1  = 11;

// ── Octave 0  (MIDI 12–23) ───────────────────────────────────────────────────
export const C0  = 12;
export const Cs0 = 13; export const Db0 = 13;
export const D0  = 14;
export const Ds0 = 15; export const Eb0 = 15;
export const E0  = 16;
export const F0  = 17;
export const Fs0 = 18; export const Gb0 = 18;
export const G0  = 19;
export const Gs0 = 20; export const Ab0 = 20;
export const A0  = 21;
export const As0 = 22; export const Bb0 = 22;
export const B0  = 23;

// ── Octave 1  (MIDI 24–35) ───────────────────────────────────────────────────
export const C1  = 24;
export const Cs1 = 25; export const Db1 = 25;
export const D1  = 26;
export const Ds1 = 27; export const Eb1 = 27;
export const E1  = 28;
export const F1  = 29;
export const Fs1 = 30; export const Gb1 = 30;
export const G1  = 31;
export const Gs1 = 32; export const Ab1 = 32;
export const A1  = 33;
export const As1 = 34; export const Bb1 = 34;
export const B1  = 35;

// ── Octave 2  (MIDI 36–47) ───────────────────────────────────────────────────
export const C2  = 36;
export const Cs2 = 37; export const Db2 = 37;
export const D2  = 38;
export const Ds2 = 39; export const Eb2 = 39;
export const E2  = 40;
export const F2  = 41;
export const Fs2 = 42; export const Gb2 = 42;
export const G2  = 43;
export const Gs2 = 44; export const Ab2 = 44;
export const A2  = 45;
export const As2 = 46; export const Bb2 = 46;
export const B2  = 47;

// ── Octave 3  (MIDI 48–59) ───────────────────────────────────────────────────
export const C3  = 48;
export const Cs3 = 49; export const Db3 = 49;
export const D3  = 50;
export const Ds3 = 51; export const Eb3 = 51;
export const E3  = 52;
export const F3  = 53;
export const Fs3 = 54; export const Gb3 = 54;
export const G3  = 55;
export const Gs3 = 56; export const Ab3 = 56;
export const A3  = 57;
export const As3 = 58; export const Bb3 = 58;
export const B3  = 59;

// ── Octave 4  (MIDI 60–71) — middle octave ───────────────────────────────────
export const C4  = 60;  // middle C
export const Cs4 = 61; export const Db4 = 61;
export const D4  = 62;
export const Ds4 = 63; export const Eb4 = 63;
export const E4  = 64;
export const F4  = 65;
export const Fs4 = 66; export const Gb4 = 66;
export const G4  = 67;
export const Gs4 = 68; export const Ab4 = 68;
export const A4  = 69;  // concert pitch 440 Hz
export const As4 = 70; export const Bb4 = 70;
export const B4  = 71;

// ── Octave 5  (MIDI 72–83) ───────────────────────────────────────────────────
export const C5  = 72;
export const Cs5 = 73; export const Db5 = 73;
export const D5  = 74;
export const Ds5 = 75; export const Eb5 = 75;
export const E5  = 76;
export const F5  = 77;
export const Fs5 = 78; export const Gb5 = 78;
export const G5  = 79;
export const Gs5 = 80; export const Ab5 = 80;
export const A5  = 81;
export const As5 = 82; export const Bb5 = 82;
export const B5  = 83;

// ── Octave 6  (MIDI 84–95) ───────────────────────────────────────────────────
export const C6  = 84;
export const Cs6 = 85; export const Db6 = 85;
export const D6  = 86;
export const Ds6 = 87; export const Eb6 = 87;
export const E6  = 88;
export const F6  = 89;
export const Fs6 = 90; export const Gb6 = 90;
export const G6  = 91;
export const Gs6 = 92; export const Ab6 = 92;
export const A6  = 93;
export const As6 = 94; export const Bb6 = 94;
export const B6  = 95;

// ── Octave 7  (MIDI 96–107) ──────────────────────────────────────────────────
export const C7  = 96;
export const Cs7 = 97; export const Db7 = 97;
export const D7  = 98;
export const Ds7 = 99; export const Eb7 = 99;
export const E7  = 100;
export const F7  = 101;
export const Fs7 = 102; export const Gb7 = 102;
export const G7  = 103;
export const Gs7 = 104; export const Ab7 = 104;
export const A7  = 105;
export const As7 = 106; export const Bb7 = 106;
export const B7  = 107;

// ── Octave 8  (MIDI 108–119) ─────────────────────────────────────────────────
export const C8  = 108;
export const Cs8 = 109; export const Db8 = 109;
export const D8  = 110;
export const Ds8 = 111; export const Eb8 = 111;
export const E8  = 112;
export const F8  = 113;
export const Fs8 = 114; export const Gb8 = 114;
export const G8  = 115;
export const Gs8 = 116; export const Ab8 = 116;
export const A8  = 117;
export const As8 = 118; export const Bb8 = 118;
export const B8  = 119;

// ── Octave 9  (MIDI 120–127) ─────────────────────────────────────────────────
export const C9  = 120;
export const Cs9 = 121; export const Db9 = 121;
export const D9  = 122;
export const Ds9 = 123; export const Eb9 = 123;
export const E9  = 124;
export const F9  = 125;
export const Fs9 = 126; export const Gb9 = 126;
export const G9  = 127;
