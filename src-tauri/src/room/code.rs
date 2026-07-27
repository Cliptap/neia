use rand::Rng;

const CHARSET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH: usize = 6;

pub fn generate_room_code() -> String {
    let mut rng = rand::thread_rng();
    (0..CODE_LENGTH)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

pub fn validate_room_code(code: &str) -> bool {
    if code.len() != CODE_LENGTH {
        return false;
    }
    code.chars()
        .all(|c| CHARSET.contains(&(c as u8)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_code_length() {
        let code = generate_room_code();
        assert_eq!(code.len(), CODE_LENGTH);
    }

    #[test]
    fn test_generate_code_charset() {
        let code = generate_room_code();
        assert!(code.chars().all(|c| CHARSET.contains(&(c as u8))));
    }

    #[test]
    fn test_validate_valid_code() {
        let code = generate_room_code();
        assert!(validate_room_code(&code));
    }

    #[test]
    fn test_validate_invalid_length() {
        assert!(!validate_room_code("ABC"));
        assert!(!validate_room_code("ABCDEFG"));
    }

    #[test]
    fn test_validate_ambiguous_chars() {
        assert!(!validate_room_code("000000"));
        assert!(!validate_room_code("111111"));
        assert!(!validate_room_code("OOOOOO"));
        assert!(!validate_room_code("IIIIII"));
    }
}
