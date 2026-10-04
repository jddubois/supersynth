"""Instrument definitions: which real recordings each model is analysed from.

Sources (all freely licensed):
  VCSL      — Versilian Community Sample Library, CC0 (github.com/sgossner/VCSL)
  VSCO-2-CE — Versilian Studios Chamber Orchestra 2 Community Edition, CC0
              (github.com/sgossner/VSCO-2-CE)
  Bureå     — Bureå Church organ GrandOrgue sample set by Lars Palo, CC BY-SA 2.5
              (familjenpalo.se/vpo/download)
"""

VCSL = 'VCSL'
VSCO = 'VSCO-2-CE'
CC0_VCSL = 'Analysed from the Versilian Community Sample Library (CC0)'
CC0_VSCO = 'Analysed from VSCO 2 Community Edition (CC0)'

RR_EXTRA = r'(_rr[2-9]|_RR[2-9]|_0[2-9][_.]|_var[2-9])'

PIANO_DAMPER = [[21, 18.0], [36, 28.0], [48, 40.0], [60, 55.0], [72, 70.0], [84, 90.0]]

INSTRUMENTS: dict[str, dict] = {
    # ── keyboards ──────────────────────────────────────────────────────────
    'grand-piano': dict(
        display='Concert Grand Piano (Steinway B)', family='keyboard', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Chordophones/Zithers/Grand Piano, Steinway B/NoSus/*.wav'],
        layer_regex=r'_vl(\d)_', exclude=RR_EXTRA, periods=4.0, transient=True, max_partials=512, free_partials=24, max_stiffness=0.05,
        params=dict(tuning='recorded', releaseMode='damper', damper=PIANO_DAMPER, undampedFrom=89, keyPan=0.55, spread=0.35,
                    reverb='hall', reverbSend=0.16, formant=0.0),
    ),
    'upright-piano': dict(
        display='Upright Piano (Yamaha)', family='keyboard', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Chordophones/Zithers/Upright Piano, Yamaha/Sustains/*.wav'],
        layer_regex=r'_vl(\d)_', exclude=RR_EXTRA, periods=4.0, transient=True, max_partials=512, free_partials=24, max_stiffness=0.05,
        params=dict(tuning='recorded', releaseMode='damper', damper=PIANO_DAMPER, undampedFrom=89, keyPan=0.4, spread=0.3,
                    reverb='room', reverbSend=0.14),
    ),
    'harpsichord': dict(
        display='French Double Harpsichord', family='keyboard', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Chordophones/Zithers/Harpsichord, French/Sustains/*.wav'],
        exclude=RR_EXTRA, periods=4.0, transient=True, max_partials=512,
        params=dict(tuning='recorded', releaseMode='damper', damper=[[21, 60.0], [60, 90.0], [96, 120.0]], keyPan=0.4,
                    spread=0.3, reverb='chamber', reverbSend=0.2),
    ),
    'harpsichord-flemish': dict(
        display='Flemish Harpsichord (8\')', family='keyboard', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Chordophones/Zithers/Harpsichord, Flemish/Sustains/Low/*.wav'],
        exclude=RR_EXTRA, periods=4.0, transient=True, max_partials=512,
        params=dict(tuning='recorded', releaseMode='damper', damper=[[21, 60.0], [60, 90.0], [96, 120.0]], keyPan=0.4,
                    spread=0.3, reverb='chamber', reverbSend=0.2),
    ),
    # ── organs ─────────────────────────────────────────────────────────────
    'pipe-organ': dict(
        display='Pipe Organ — Full Swell (church)', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f'{VCSL}/Aerophones/Edge-blown Aerophones/Pipe Organ/Loud/*.wav'],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512, locked=False, free_partials=12,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.5, reverb='church', reverbSend=0.12, formant=0.0,
                    minReleaseDbS=25.0),
    ),
    'pipe-organ-soft': dict(
        display='Pipe Organ — Soft Flutes (church)', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f'{VCSL}/Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/*.wav'],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.5, reverb='church', reverbSend=0.12, minReleaseDbS=25.0),
    ),
    'pipe-organ-pedal': dict(
        display='Pipe Organ — Pedal 16\'+8\'', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f'{VCSL}/Aerophones/Edge-blown Aerophones/Pipe Organ/Loud Pedal/*.wav'],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512, locked=False, free_partials=12,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.4, reverb='church', reverbSend=0.12, minReleaseDbS=20.0),
    ),
    'pipe-organ-pedal-soft': dict(
        display='Pipe Organ — Soft Pedal 16\'', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f'{VCSL}/Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet Pedal/*.wav'],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.4, reverb='church', reverbSend=0.12, minReleaseDbS=20.0),
    ),
    'renaissance-organ-8': dict(
        display='Renaissance Chamber Organ 8\'', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f"{VCSL}/Aerophones/Edge-blown Aerophones/Renaissance Organ/8'/*.wav"],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.3, reverb='chamber', reverbSend=0.15, minReleaseDbS=30.0),
    ),
    'renaissance-organ-4': dict(
        display='Renaissance Chamber Organ 4\'', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f"{VCSL}/Aerophones/Edge-blown Aerophones/Renaissance Organ/4'/*.wav"],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.3, reverb='chamber', reverbSend=0.15, minReleaseDbS=30.0),
    ),
    'renaissance-organ-full': dict(
        display='Renaissance Chamber Organ — Full', family='organ', kind='sustained', source=CC0_VCSL,
        files=[f"{VCSL}/Aerophones/Edge-blown Aerophones/Renaissance Organ/Full/*.wav"],
        exclude=RR_EXTRA, stereo=True, transient=True, transient_max_s=0.09, max_partials=512, locked=False, free_partials=12,
        params=dict(tuning='recorded', releaseMode='natural', spread=0.4, reverb='chamber', reverbSend=0.15, minReleaseDbS=30.0),
    ),
    # ── plucked / struck strings ───────────────────────────────────────────
    'harp': dict(
        display='Concert Harp', family='strings', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Chordophones/Composite Chordophones/Concert Harp/*.wav'],
        layer_regex=r'_(f|mf)\d', exclude=RR_EXTRA, periods=4.0, transient=True, max_partials=512,
        params=dict(releaseMode='ringout', keyPan=0.4, spread=0.3, reverb='hall', reverbSend=0.22),
    ),
    'violin-pizzicato': dict(
        display='Violin Pizzicato', family='strings', kind='decaying', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Solo Violin/Pizz/*.wav'],
        layer_regex=r'_(p|f)_RR', exclude=RR_EXTRA, periods=4.0, transient=True,
        params=dict(releaseMode='damper', damper=[[0, 30.0]], spread=0.25, reverb='hall', reverbSend=0.22,
                    formant=0.6),
    ),
    'cello-pizzicato': dict(
        display='Cello Section Pizzicato', family='strings', kind='decaying', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Cello Section/pizzT/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, periods=4.0, transient=True,
        params=dict(releaseMode='damper', damper=[[0, 25.0]], spread=0.35, reverb='hall', reverbSend=0.22,
                    formant=0.6),
    ),
    'contrabass-pizzicato': dict(
        display='Contrabass Pizzicato', family='strings', kind='decaying', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Solo Contrabass/Pizz/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, periods=4.0, transient=True,
        params=dict(releaseMode='damper', damper=[[0, 20.0]], spread=0.2, reverb='hall', reverbSend=0.18,
                    formant=0.6),
    ),
    # ── bowed strings ──────────────────────────────────────────────────────
    'violin': dict(
        display='Solo Violin', family='strings', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Solo Violin/Arco Vib/*.wav'],
        layer_regex=r'_(p|f)\.wav', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.25, reverb='hall', reverbSend=0.22, formant=0.8,
                    minReleaseDbS=40.0),
    ),
    'violins': dict(
        display='Violin Section', family='strings', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Violin Section/susVib/*.wav'],
        layer_regex=r'_v(\d)', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.6, reverb='hall', reverbSend=0.2, formant=0.8,
                    minReleaseDbS=30.0),
    ),
    'violas': dict(
        display='Viola Section', family='strings', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Viola Section/susvib/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.15, max_partials=512,
        weak_after_attack=True,
        params=dict(releaseMode='natural', spread=0.6, reverb='hall', reverbSend=0.2, formant=0.8,
                    minReleaseDbS=30.0),
    ),
    'cellos': dict(
        display='Cello Section', family='strings', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Cello Section/susvib/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.6, reverb='hall', reverbSend=0.2, formant=0.8,
                    minReleaseDbS=30.0),
    ),
    'contrabass': dict(
        display='Contrabass', family='strings', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Strings/Solo Contrabass/SusVib/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.4, reverb='hall', reverbSend=0.18, formant=0.8,
                    minReleaseDbS=30.0),
    ),
    # ── woodwinds ──────────────────────────────────────────────────────────
    'flute': dict(
        display='Concert Flute', family='woodwind', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Woodwinds/Flute/susNV/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=48,
        params=dict(releaseMode='natural', spread=0.2, reverb='hall', reverbSend=0.22, formant=0.5,
                    minReleaseDbS=50.0),
    ),
    'flute-vibrato': dict(
        display='Concert Flute (vibrato)', family='woodwind', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Woodwinds/Flute/susvib/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=48,
        params=dict(releaseMode='natural', spread=0.2, reverb='hall', reverbSend=0.22, formant=0.5,
                    minReleaseDbS=50.0),
    ),
    'piccolo': dict(
        display='Piccolo', family='woodwind', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Woodwinds/Piccolo/Sus/*.wav'],
        layer_regex=r'_v(\d)', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=32,
        params=dict(releaseMode='natural', spread=0.2, reverb='hall', reverbSend=0.22, minReleaseDbS=50.0),
    ),
    'oboe': dict(
        display='Oboe', family='woodwind', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Woodwinds/Oboe/Sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.2, reverb='hall', reverbSend=0.2, formant=0.8,
                    minReleaseDbS=50.0),
    ),
    'clarinet': dict(
        display='Clarinet', family='woodwind', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Woodwinds/Clarinet/susLong/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.2, reverb='hall', reverbSend=0.2, formant=0.6,
                    minReleaseDbS=50.0),
    ),
    'bassoon': dict(
        display='Bassoon', family='woodwind', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Woodwinds/Bassoon/sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.2, reverb='hall', reverbSend=0.2, formant=0.8,
                    minReleaseDbS=50.0),
    ),
    'tenor-sax': dict(
        display='Tenor Saxophone', family='woodwind', kind='sustained', source=CC0_VCSL,
        files=[f'{VCSL}/Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/*.wav'],
        layer_regex=r'_vl(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.2, reverb='room', reverbSend=0.18, formant=0.8,
                    minReleaseDbS=50.0),
    ),
    # ── brass ──────────────────────────────────────────────────────────────
    'trumpet': dict(
        display='Trumpet', family='brass', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Brass/Trumpet/sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.25, reverb='hall', reverbSend=0.2, formant=0.7,
                    minReleaseDbS=50.0),
    ),
    'trumpet-muted': dict(
        display='Trumpet (straight mute)', family='brass', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Brass/Trumpet/straightM-sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.25, reverb='hall', reverbSend=0.2, formant=0.7,
                    minReleaseDbS=50.0),
    ),
    'french-horn': dict(
        display='French Horn', family='brass', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Brass/F Horn/sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.35, reverb='hall', reverbSend=0.24, formant=0.7,
                    minReleaseDbS=40.0),
    ),
    'trombone': dict(
        display='Tenor Trombone', family='brass', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Brass/Tenor Trombone/sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.3, reverb='hall', reverbSend=0.2, formant=0.7,
                    minReleaseDbS=40.0),
    ),
    'tuba': dict(
        display='Tuba', family='brass', kind='sustained', source=CC0_VSCO,
        files=[f'{VSCO}/Brass/Tuba/sus/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, transient=True, transient_max_s=0.09, max_partials=512,
        params=dict(releaseMode='natural', spread=0.3, reverb='hall', reverbSend=0.18, formant=0.7,
                    minReleaseDbS=40.0),
    ),
    # ── mallets & bells ────────────────────────────────────────────────────
    'marimba': dict(
        display='Marimba', family='percussion', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Idiophones/Struck Idiophones/Marimba/*.wav'],
        layer_regex=r'_(soft|med|loud)_', exclude=RR_EXTRA, periods=4.0, transient=True, harmonic=False, free_partials=24, free_window_s=0.03, max_partials=0,
        params=dict(releaseMode='ringout', keyPan=0.5, spread=0.2, reverb='hall', reverbSend=0.18),
    ),
    'vibraphone': dict(
        display='Vibraphone (hard mallets)', family='percussion', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/*.wav'],
        layer_regex=r'_v(\d)_', exclude=RR_EXTRA, periods=4.0, transient=True, harmonic=False, free_partials=24, free_window_s=0.03, max_partials=0,
        params=dict(pitchMorph=False, releaseMode='damper', damper=[[0, 25.0]], keyPan=0.4, spread=0.2, reverb='hall',
                    reverbSend=0.2),
    ),
    'xylophone': dict(
        display='Xylophone', family='percussion', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Idiophones/Struck Idiophones/Xylophone/Medium Mallets/*.wav'],
        layer_regex=r'_(pp|ff)_', exclude=RR_EXTRA, periods=4.0, transient=True, harmonic=False, free_partials=24, free_window_s=0.03, max_partials=0,
        params=dict(releaseMode='ringout', keyPan=0.4, spread=0.2, reverb='hall', reverbSend=0.18),
    ),
    'glockenspiel': dict(
        display='Glockenspiel', family='percussion', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Idiophones/Struck Idiophones/Glockenspiel/*.wav'],
        layer_regex=r'glock_([a-z]+)_', exclude=RR_EXTRA, periods=4.0, transient=True, harmonic=False, free_partials=16, free_window_s=0.03, max_partials=0,
        params=dict(releaseMode='ringout', keyPan=0.3, spread=0.2, reverb='hall', reverbSend=0.2),
    ),
    'tubular-bells': dict(
        display='Tubular Bells', family='percussion', kind='decaying', source=CC0_VCSL,
        files=[f'{VCSL}/Idiophones/Struck Idiophones/Tubular Bells 1/*.wav'],
        layer_regex=r'_(pp|f|ff)_', exclude=RR_EXTRA, periods=4.0, transient=True, harmonic=False, free_partials=40, free_window_s=0.03, max_partials=0,
        params=dict(pitchMorph=False, releaseMode='ringout', keyPan=0.3, spread=0.3, reverb='church', reverbSend=0.22),
    ),
}

# ── Bureå Church pipe organ (Nils Hammarberg 1967) — every pipe of every stop ─────
# GrandOrgue sample set by Lars Palo, CC BY-SA 2.5 SE. Pipes are wet (church acoustic).
BUREA = 'grandorgue/Burea_wav'
BUREA_SRC = ("Analysed from the Bureå Church organ sample set by Lars Palo "
             "(CC BY-SA 2.5 SE, familjenpalo.se/vpo)")
# folder, id, display name, footage offset (semitones from 8'), kind of stop
BUREA_STOPS = [
    # Huvudverk (Great)
    ('HVPrincipal8', 'great-principal-8', "Principal 8'", 0, 'principal'),
    ('HVGedakt8', 'great-gedackt-8', "Gedackt 8'", 0, 'flute'),
    ('HVOktava4', 'great-octave-4', "Octave 4'", 12, 'principal'),
    ('HVRorflojt4', 'great-rohrflute-4', "Rohrflöte 4'", 12, 'flute'),
    ('HVOktava2', 'great-octave-2', "Octave 2'", 24, 'principal'),
    ('HVSesquialtera', 'great-sesquialtera', 'Sesquialtera II', 0, 'mixture'),
    ('HVMixtur', 'great-mixture', 'Mixture V', 0, 'mixture'),
    ('HVTrumpet8', 'great-trumpet-8', "Trumpet 8'", 0, 'reed'),
    # Svällverk (Swell)
    ('SVRorflojt8', 'swell-rohrflute-8', "Rohrflöte 8'", 0, 'flute'),
    ('SVSalicional8', 'swell-salicional-8', "Salicional 8'", 0, 'string'),
    ('SVPrincipal4', 'swell-principal-4', "Principal 4'", 12, 'principal'),
    ('SVHalflojt4', 'swell-hohlflute-4', "Hohlflöte 4'", 12, 'flute'),
    ('SVValdflojt2', 'swell-waldflute-2', "Waldflöte 2'", 24, 'flute'),
    ('SVKvinta113', 'swell-nasard-1-1-3', "Nasat 1 1/3'", 31, 'mutation'),
    ('SVTers135', 'swell-tierce-1-3-5', "Terz 1 3/5'", 28, 'mutation'),
    ('SVSeptima117', 'swell-septime-1-1-7', "Septime 1 1/7'", 34, 'mutation'),
    ('SVScharff', 'swell-scharf', 'Scharf III', 0, 'mixture'),
    ('SVSkalmeja8', 'swell-schalmei-8', "Schalmei 8'", 0, 'reed'),
    # Bröstverk (Positive)
    ('POSGedakt8', 'positive-gedackt-8', "Gedackt 8'", 0, 'flute'),
    ('POSKoppelflojt4', 'positive-koppelflute-4', "Koppelflöte 4'", 12, 'flute'),
    ('POSKvinta223', 'positive-quint-2-2-3', "Rohrquinte 2 2/3'", 19, 'mutation'),
    ('POSPrincipal2', 'positive-principal-2', "Principal 2'", 24, 'principal'),
    ('POSOktava1', 'positive-octave-1', "Octave 1'", 36, 'principal'),
    ('POSCymbel', 'positive-cymbel', 'Cymbel II', 0, 'mixture'),
    ('POSKrummhorn8', 'positive-krummhorn-8', "Krummhorn 8'", 0, 'reed'),
    # Pedal
    ('PEDSubbas16', 'pedal-subbass-16', "Subbass 16'", -12, 'flute'),
    ('PEDPrincipal8', 'pedal-principal-8', "Principal 8'", 0, 'principal'),
    ('PEDGedakt8', 'pedal-gedackt-8', "Gedackt 8'", 0, 'flute'),
    ('PEDOktava4', 'pedal-octave-4', "Octave 4'", 12, 'principal'),
    ('PEDNachthorn2', 'pedal-nachthorn-2', "Nachthorn 2'", 24, 'flute'),
    ('PEDRauschpfeife', 'pedal-rauschpfeife', 'Rauschpfeife IV', 0, 'mixture'),
    ('PEDBasun16', 'pedal-bassoon-16', "Fagott 16'", -12, 'reed'),
    ('PEDTrumpet4', 'pedal-trumpet-4', "Trumpet 4'", 12, 'reed'),
    # extended set
    ('Violon16', 'extra-violone-16', "Violon 16'", -12, 'string'),
    ('ViolCeleste8', 'extra-voix-celeste-8', "Voix céleste 8'", 0, 'string'),
    ('Quintadena8', 'extra-quintadena-8', "Quintadena 8'", 0, 'flute'),
    ('Gemshorn4', 'extra-gemshorn-4', "Gemshorn 4'", 12, 'principal'),
    ('Halflojt8', 'extra-hohlflute-8', "Hohlflöte 8'", 0, 'flute'),
    ('Flojtlein2', 'extra-flautino-2', "Flötlein 2'", 24, 'flute'),
    ('Sivflojt1', 'extra-sifflote-1', "Sifflöte 1'", 36, 'flute'),
]

# stop id -> sample-set folder / transposition (semitones from the key to the sounding pitch)
BUREA_FOLDER = {sid: folder for folder, sid, *_ in BUREA_STOPS}
BUREA_TRANSPOSE = {sid: offset for _, sid, _, offset, _ in BUREA_STOPS}


def burea_pipe(stop_id: str, key: int) -> str | None:
    """The recording of one Bureå pipe (stop id, key number), or None if that pipe is missing."""
    import os
    from paths import DATA_ROOT
    folder = os.path.join(DATA_ROOT, 'samples', BUREA, BUREA_FOLDER[stop_id])
    names = sorted(f for f in os.listdir(folder) if f.startswith(f'{key:03d}-'))
    return os.path.join(folder, names[0]) if names else None


for folder, sid, disp, offset, family in BUREA_STOPS:
    INSTRUMENTS[f'organ/{sid}'] = dict(
        display=f'Bureå organ — {disp}', family='organ', kind='sustained', source=BUREA_SRC,
        files=[f'{BUREA}/{folder}/*.wav'], note_from_number=True, note_offset=offset,
        octave_search=(family != 'mixture'), use_cue=True, max_loop_s=1.6, stereo=True,
        transient=True, transient_max_s=0.05,
        max_partials=512, locked=(family != 'mixture'), free_partials=(12 if family == 'mixture' else 0),
        stop=dict(name=disp, footage_offset=offset, family=family, folder=folder),
        fixed_gain_from='organ/great-principal-8',
        params=dict(releaseMode='natural', spread=0.35, reverb='church', reverbSend=0.06,
                    formant=0.0, minReleaseDbS=20.0, tuning='recorded'),
    )

# ── release sounds (played on key-up): damper felt on piano strings, harpsichord jacks ──
for _rid, _parent, _glob, _lre in [
    ('grand-piano-release', 'grand-piano', f'{VCSL}/Chordophones/Zithers/Grand Piano, Steinway B/Rel/*.wav', r'_vl(\d)_'),
    ('upright-piano-release', 'upright-piano', f'{VCSL}/Chordophones/Zithers/Upright Piano, Yamaha/Releases/*.wav', r'_vl(\d)_'),
    ('harpsichord-release', 'harpsichord', f'{VCSL}/Chordophones/Zithers/Harpsichord, French/Releases/*.wav', None),
    ('harpsichord-flemish-release', 'harpsichord-flemish', f'{VCSL}/Chordophones/Zithers/Harpsichord, Flemish/Releases/Low/*.wav', None),
]:
    INSTRUMENTS[_rid] = dict(
        display=f'{INSTRUMENTS[_parent]["display"]} — release noise', family='keyboard', kind='decaying',
        source=INSTRUMENTS[_parent]['source'], files=[_glob], exclude=RR_EXTRA, periods=4.0,
        transient=True, transient_max_s=0.1, max_partials=48, fixed_gain_from=_parent,
        **({'layer_regex': _lre} if _lre else {}),
        params=dict(releaseMode='ringout', spread=0.3, releaseOf=_parent, tuning='recorded'),
    )

# ── Piotr Grabowski's free sample sets — every stop as the sample set plays it ─────
# (piotr.py: stop catalogues in piotr_organs/<organ>.json, recordings rendered per key)
def _piotr_organs():
    import glob
    import json
    import os
    from piotr import model_id, spec_for
    for path in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'piotr_organs', '*.json'))):
        with open(path) as f:
            cat = json.load(f)
        for st in cat['stops']:
            INSTRUMENTS[model_id(cat['id'], st['id'])] = spec_for(cat, st)


_piotr_organs()
