use cpal::Host;

#[derive(Debug, Clone, PartialEq)]
pub enum BackendKind {
    Auto,
    CoreAudio,
    Wasapi,
    Alsa,
    Jack,
    PulseAudio,
    PipeWire,
}

impl BackendKind {
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "coreaudio" => BackendKind::CoreAudio,
            "wasapi" => BackendKind::Wasapi,
            "alsa" => BackendKind::Alsa,
            "jack" => BackendKind::Jack,
            "pulseaudio" => BackendKind::PulseAudio,
            "pipewire" => BackendKind::PipeWire,
            _ => BackendKind::Auto,
        }
    }

    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            BackendKind::Auto => "auto",
            BackendKind::CoreAudio => "coreaudio",
            BackendKind::Wasapi => "wasapi",
            BackendKind::Alsa => "alsa",
            BackendKind::Jack => "jack",
            BackendKind::PulseAudio => "pulseaudio",
            BackendKind::PipeWire => "pipewire",
        }
    }
}

pub fn list_available_backends() -> Vec<String> {
    cpal::available_hosts()
        .iter()
        .map(|id| format!("{:?}", id).to_lowercase())
        .collect()
}

pub fn get_host(backend: &BackendKind) -> Host {
    #[cfg(target_os = "linux")]
    {
        use cpal::HostId;
        match backend {
            BackendKind::Jack => {
                if let Ok(host) = cpal::host_from_id(HostId::Jack) {
                    return host;
                }
                eprintln!("supersynth: JACK not available, falling back to default");
            }
            BackendKind::Alsa => {
                if let Ok(host) = cpal::host_from_id(HostId::Alsa) {
                    return host;
                }
            }
            _ => {}
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = backend;
    cpal::default_host()
}
