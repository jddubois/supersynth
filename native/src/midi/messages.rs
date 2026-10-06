//! Splitting a byte stream into whole MIDI messages.

/// Data bytes that follow a status byte, or `None` for a System Exclusive message (which runs
/// to its `0xF7`).
fn data_len(status: u8) -> Option<usize> {
    Some(match status {
        0x80..=0xBF | 0xE0..=0xEF => 2,
        0xC0..=0xDF => 1,
        0xF0 => return None,
        0xF1 | 0xF3 => 1,
        0xF2 => 2,
        _ => 0, // 0xF4–0xFF: tune request, end of exclusive, real-time messages
    })
}

/// The complete messages in `bytes`, in order. Running status is not accepted: every message
/// starts with its status byte. Fails on a data byte where a status byte should be and on a
/// message cut short.
pub fn split(bytes: &[u8]) -> Result<Vec<&[u8]>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let status = bytes[i];
        if status < 0x80 {
            return Err(format!("byte {i} (0x{status:02X}) is not a MIDI status byte"));
        }
        let end = match data_len(status) {
            Some(n) => i + 1 + n,
            None => match bytes[i..].iter().position(|&b| b == 0xF7) {
                Some(p) => i + p + 1,
                None => return Err("a System Exclusive message (0xF0) does not end with 0xF7".into()),
            },
        };
        if end > bytes.len() {
            return Err(format!("the message at byte {i} (status 0x{status:02X}) is incomplete"));
        }
        if status != 0xF0 {
            if let Some(p) = bytes[i + 1..end].iter().position(|&b| b >= 0x80) {
                return Err(format!("byte {} (0x{:02X}) is not a MIDI data byte", i + 1 + p, bytes[i + 1 + p]));
            }
        }
        out.push(&bytes[i..end]);
        i = end;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_messages() {
        let local_off: Vec<u8> = (0..16u8).flat_map(|c| [0xB0 | c, 122, 0]).collect();
        let msgs = split(&local_off).unwrap();
        assert_eq!(msgs.len(), 16);
        assert_eq!(msgs[15], [0xBF, 122, 0]);
        assert_eq!(split(&[0xC0, 5, 0x90, 60, 100, 0xF8, 0xF0, 1, 2, 0xF7, 0xE0, 0, 64]).unwrap(), [&[0xC0, 5][..], &[0x90, 60, 100], &[0xF8], &[0xF0, 1, 2, 0xF7], &[0xE0, 0, 64]]);
        assert!(split(&[]).unwrap().is_empty());
    }

    #[test]
    fn refuses_what_is_not_whole_messages() {
        assert!(split(&[60, 100]).is_err());
        assert!(split(&[0x90, 60]).is_err());
        assert!(split(&[0x90, 60, 0x80]).is_err());
        assert!(split(&[0xF0, 1, 2]).is_err());
    }
}
