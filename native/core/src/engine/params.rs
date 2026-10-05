//! Parameter identifiers (stable string names are used by the JS API).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartParam {
    Volume,
    Pan,
    ReverbSend,
    Brightness,
    EvenDb,
    NoiseDb,
    AttackScale,
    DecayScale,
    ReleaseScale,
    VibratoCents,
    VibratoRate,
    VibratoDelay,
    Expression,
    Formant,
    Inharmonicity,
    Spread,
    Humanize,
    VelocitySens,
    MaxPartials,
    GainDb,
    Jitter,
    Shimmer,
    Transpose,
    Tune,
    BendRange,
    ModDepth,
    Mono,
    Legato,
    Glide,
    TremDepth,
    TremPitch,
    TremRate,
    EqLowDb,
    EqLowHz,
    EqMidDb,
    EqMidHz,
    EqMidQ,
    EqHighDb,
    EqHighHz,
    LowCut,
    HighCut,
    ChorusMix,
    ChorusRate,
    ChorusDepth,
    DriveAmount,
    DriveTone,
    DriveLevel,
    Leslie,
    SwellBox,
    Wind,
}

impl PartParam {
    pub const ALL: &'static [(&'static str, PartParam)] = &[
        ("volume", PartParam::Volume),
        ("pan", PartParam::Pan),
        ("reverbSend", PartParam::ReverbSend),
        ("brightness", PartParam::Brightness),
        ("evenHarmonics", PartParam::EvenDb),
        ("noise", PartParam::NoiseDb),
        ("attack", PartParam::AttackScale),
        ("decay", PartParam::DecayScale),
        ("release", PartParam::ReleaseScale),
        ("vibrato", PartParam::VibratoCents),
        ("vibratoRate", PartParam::VibratoRate),
        ("vibratoDelay", PartParam::VibratoDelay),
        ("naturalVibrato", PartParam::Expression),
        ("formant", PartParam::Formant),
        ("inharmonicity", PartParam::Inharmonicity),
        ("spread", PartParam::Spread),
        ("humanize", PartParam::Humanize),
        ("velocitySensitivity", PartParam::VelocitySens),
        ("maxPartials", PartParam::MaxPartials),
        ("gain", PartParam::GainDb),
        ("jitter", PartParam::Jitter),
        ("shimmer", PartParam::Shimmer),
        ("transpose", PartParam::Transpose),
        ("tune", PartParam::Tune),
        ("bendRange", PartParam::BendRange),
        ("modDepth", PartParam::ModDepth),
        ("mono", PartParam::Mono),
        ("legato", PartParam::Legato),
        ("glide", PartParam::Glide),
        ("tremolo", PartParam::TremDepth),
        ("tremoloPitch", PartParam::TremPitch),
        ("tremoloRate", PartParam::TremRate),
        ("eqLowGain", PartParam::EqLowDb),
        ("eqLowFreq", PartParam::EqLowHz),
        ("eqMidGain", PartParam::EqMidDb),
        ("eqMidFreq", PartParam::EqMidHz),
        ("eqMidQ", PartParam::EqMidQ),
        ("eqHighGain", PartParam::EqHighDb),
        ("eqHighFreq", PartParam::EqHighHz),
        ("lowCut", PartParam::LowCut),
        ("highCut", PartParam::HighCut),
        ("chorus", PartParam::ChorusMix),
        ("chorusRate", PartParam::ChorusRate),
        ("chorusDepth", PartParam::ChorusDepth),
        ("drive", PartParam::DriveAmount),
        ("driveTone", PartParam::DriveTone),
        ("driveLevel", PartParam::DriveLevel),
        ("leslie", PartParam::Leslie),
        ("swellBox", PartParam::SwellBox),
        ("wind", PartParam::Wind),
    ];

    pub fn parse(name: &str) -> Option<PartParam> {
        Self::ALL.iter().find(|(n, _)| *n == name).map(|(_, p)| *p)
    }

    /// The range values are clamped to: far beyond musical use, but small enough that no
    /// setting can overflow the synthesis (negative `reverbSend`, `formant` and `spread` mean
    /// "the instrument's own value").
    pub fn range(self) -> (f32, f32) {
        use PartParam::*;
        match self {
            Volume => (-120.0, 24.0),
            Pan => (-1.0, 1.0),
            ReverbSend => (-1.0, 4.0),
            Brightness => (-24.0, 24.0),
            EvenDb => (-60.0, 24.0),
            NoiseDb => (-120.0, 40.0),
            AttackScale | DecayScale => (0.05, 20.0),
            ReleaseScale => (0.01, 20.0),
            VibratoCents => (0.0, 1200.0),
            VibratoRate => (0.0, 40.0),
            VibratoDelay => (0.0, 60.0),
            Expression => (0.0, 2.0),
            Formant | Spread => (-1.0, 1.0),
            Inharmonicity => (0.0, 10.0),
            Humanize => (0.0, 100.0),
            VelocitySens => (0.0, 1.0),
            MaxPartials => (1.0, crate::model::MAX_PARTIALS as f32),
            GainDb => (-120.0, 48.0),
            Jitter | Shimmer => (0.0, 10.0),
            Transpose => (-96.0, 96.0),
            Tune => (-1200.0, 1200.0),
            BendRange => (-48.0, 48.0),
            ModDepth => (-1200.0, 1200.0),
            Mono | Legato | SwellBox => (0.0, 1.0),
            Glide => (0.0, 10.0),
            TremDepth => (0.0, 24.0),
            TremPitch => (0.0, 200.0),
            TremRate => (0.0, 40.0),
            EqLowDb | EqMidDb | EqHighDb => (-24.0, 24.0),
            EqLowHz | EqMidHz | EqHighHz => (10.0, 100_000.0),
            EqMidQ => (0.1, 10.0),
            LowCut | HighCut | DriveTone => (0.0, 100_000.0),
            ChorusMix => (0.0, 1.0),
            ChorusRate => (0.0, 20.0),
            ChorusDepth => (0.0, 50.0),
            DriveAmount => (1.0, 20.0),
            DriveLevel => (0.0, 4.0),
            Leslie => (0.0, 3.0),
            Wind => (0.0, 4.0),
        }
    }

    /// `v` clamped to [`range`](Self::range); `None` for NaN and infinities.
    pub fn sanitize(self, v: f32) -> Option<f32> {
        let (lo, hi) = self.range();
        v.is_finite().then(|| v.clamp(lo, hi))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MasterParam {
    Volume,
    Ceiling,
    ReverbReturn,
    ReverbDecay,
    ReverbLowMult,
    ReverbHighMult,
    ReverbSize,
    ReverbPredelay,
    ReverbDiffusion,
    ReverbEarly,
    ReverbWidth,
    ReverbLowCut,
    ReverbHighCut,
    ReverbModulation,
}

impl MasterParam {
    pub const ALL: &'static [(&'static str, MasterParam)] = &[
        ("volume", MasterParam::Volume),
        ("ceiling", MasterParam::Ceiling),
        ("reverbLevel", MasterParam::ReverbReturn),
        ("reverbDecay", MasterParam::ReverbDecay),
        ("reverbLowDecay", MasterParam::ReverbLowMult),
        ("reverbHighDecay", MasterParam::ReverbHighMult),
        ("reverbSize", MasterParam::ReverbSize),
        ("reverbPredelay", MasterParam::ReverbPredelay),
        ("reverbDiffusion", MasterParam::ReverbDiffusion),
        ("reverbEarly", MasterParam::ReverbEarly),
        ("reverbWidth", MasterParam::ReverbWidth),
        ("reverbLowCut", MasterParam::ReverbLowCut),
        ("reverbHighCut", MasterParam::ReverbHighCut),
        ("reverbModulation", MasterParam::ReverbModulation),
    ];

    pub fn parse(name: &str) -> Option<MasterParam> {
        Self::ALL.iter().find(|(n, _)| *n == name).map(|(_, p)| *p)
    }

    /// `v` clamped to a sane range; `None` for NaN and infinities. (The reverb clamps its own
    /// parameters.)
    pub fn sanitize(self, v: f32) -> Option<f32> {
        let (lo, hi) = match self {
            MasterParam::Volume | MasterParam::ReverbReturn => (-120.0, 24.0),
            MasterParam::Ceiling => (-40.0, 0.0),
            _ => (f32::MIN, f32::MAX),
        };
        v.is_finite().then(|| v.clamp(lo, hi))
    }
}
