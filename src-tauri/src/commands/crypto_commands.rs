use crate::crypto::KeyManager;
use std::sync::Mutex;
use tauri::State;

pub struct CryptoState(pub Mutex<KeyManager>);

impl CryptoState {
    pub fn new() -> Self {
        Self(Mutex::new(KeyManager::new()))
    }
}

#[tauri::command]
pub fn get_public_key(state: State<'_, CryptoState>) -> Result<String, String> {
    let km = state.0.lock().map_err(|e| e.to_string())?;
    Ok(km.public_key_base64())
}

#[tauri::command]
pub fn get_fingerprint(peer_key: Option<String>, state: State<'_, CryptoState>) -> Result<String, String> {
    let mut km = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(peer_key_str) = peer_key {
        let bytes = base64_decode(&peer_key_str)?;
        if bytes.len() != 32 {
            return Err("Invalid public key length".to_string());
        }
        let mut key_arr = [0u8; 32];
        key_arr.copy_from_slice(&bytes);
        km.establish_session(&key_arr);
        Ok(km.fingerprint(&key_arr))
    } else {
        let self_pub = km.public_key_base64();
        Ok(self_pub[..6.min(self_pub.len())].to_string())
    }
}

#[tauri::command]
pub fn verify_peer_key(peer_key: String, state: State<'_, CryptoState>) -> Result<String, String> {
    let mut km = state.0.lock().map_err(|e| e.to_string())?;
    let bytes = base64_decode(&peer_key)?;
    if bytes.len() != 32 {
        return Err("Invalid public key length".to_string());
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&bytes);
    km.establish_session(&key_arr);
    let fp = km.fingerprint(&key_arr);
    Ok(fp)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let clean = input.trim_end_matches('=');
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;

    for byte in clean.bytes() {
        let val = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("Invalid base64 character".to_string()),
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

