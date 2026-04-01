#[derive(Debug, Clone, PartialEq)]
pub enum MidiMessageKind {
    NoteOff,
    NoteOn,
    ControlChange,
    ProgramChange,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct MidiMessage {
    #[allow(dead_code)]
    pub channel: u8,
    pub kind: MidiMessageKind,
    pub data1: u8,
    pub data2: u8,
}

impl MidiMessage {
    /// Parse a 3-byte MIDI message. Returns None if the message is not recognized.
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return None;
        }
        let status = bytes[0];
        let kind_nibble = status & 0xF0;
        let channel = (status & 0x0F) + 1; // convert to 1-indexed

        let b1 = bytes.get(1).copied().unwrap_or(0);
        let b2 = bytes.get(2).copied().unwrap_or(0);

        let kind = match kind_nibble {
            0x80 => MidiMessageKind::NoteOff,
            0x90 => {
                // velocity=0 treated as note off
                if b2 == 0 { MidiMessageKind::NoteOff } else { MidiMessageKind::NoteOn }
            }
            0xB0 => MidiMessageKind::ControlChange,
            0xC0 => MidiMessageKind::ProgramChange,
            _ => MidiMessageKind::Unknown,
        };

        Some(Self { channel, kind, data1: b1, data2: b2 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_note_on() {
        let msg = MidiMessage::parse(&[0x90, 69, 100]).unwrap();
        assert_eq!(msg.kind, MidiMessageKind::NoteOn);
        assert_eq!(msg.channel, 1);
        assert_eq!(msg.data1, 69);
        assert_eq!(msg.data2, 100);
    }

    #[test]
    fn parse_note_off() {
        let msg = MidiMessage::parse(&[0x80, 69, 0]).unwrap();
        assert_eq!(msg.kind, MidiMessageKind::NoteOff);
    }

    #[test]
    fn note_on_velocity_zero_is_note_off() {
        let msg = MidiMessage::parse(&[0x90, 60, 0]).unwrap();
        assert_eq!(msg.kind, MidiMessageKind::NoteOff);
    }

    #[test]
    fn parse_control_change() {
        let msg = MidiMessage::parse(&[0xB1, 21, 127]).unwrap();
        assert_eq!(msg.kind, MidiMessageKind::ControlChange);
        assert_eq!(msg.channel, 2);
        assert_eq!(msg.data1, 21);
        assert_eq!(msg.data2, 127);
    }

    #[test]
    fn channel_is_one_indexed() {
        let msg = MidiMessage::parse(&[0x9F, 60, 80]).unwrap(); // channel 16
        assert_eq!(msg.channel, 16);
    }

    #[test]
    fn empty_bytes_returns_none() {
        assert!(MidiMessage::parse(&[]).is_none());
    }
}
