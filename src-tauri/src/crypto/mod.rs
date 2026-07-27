use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

pub struct KeyManager {
    secret: StaticSecret,
    public: PublicKey,
    session_key: Option<[u8; 32]>,
    counter: u64,
}

impl KeyManager {
    pub fn new() -> Self {
        let mut rng = rand::thread_rng();
        let secret = StaticSecret::random_from_rng(&mut rng);
        let public = PublicKey::from(&secret);

        Self {
            secret,
            public,
            session_key: None,
            counter: 0,
        }
    }

    pub fn public_key(&self) -> PublicKey {
        self.public
    }

    pub fn public_key_base64(&self) -> String {
        base64_encode(self.public.as_bytes())
    }

    pub fn establish_session(&mut self, peer_public_key: &[u8; 32]) {
        let peer_public = PublicKey::from(*peer_public_key);
        let shared_secret = self.secret.diffie_hellman(&peer_public);

        let hkdf = Hkdf::<Sha256>::new(Some(b"neia-v1"), shared_secret.as_bytes());
        let mut session_key = [0u8; 32];
        hkdf.expand(b"session", &mut session_key).unwrap();

        self.session_key = Some(session_key);
        self.counter = 0;
    }

    pub fn fingerprint(&self, peer_public_key: &[u8; 32]) -> String {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(self.public.as_bytes());
        hasher.update(peer_public_key);
        let result = hasher.finalize();

        let mut fingerprint = String::new();
        for i in 0..6 {
            let digit = result[i] % 10;
            fingerprint.push_str(&digit.to_string());
        }
        fingerprint
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let session_key = self
            .session_key
            .ok_or_else(|| "Session key not established".to_string())?;

        let cipher = Aes256Gcm::new_from_slice(&session_key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;

        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[..8].copy_from_slice(&self.counter.to_le_bytes());
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failed: {}", e))?;

        self.counter += 1;
        Ok(ciphertext)
    }

    pub fn decrypt(&self, ciphertext: &[u8], nonce_bytes: &[u8; 12]) -> Result<Vec<u8>, String> {
        let session_key = self
            .session_key
            .ok_or_else(|| "Session key not established".to_string())?;

        let cipher = Aes256Gcm::new_from_slice(&session_key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;

        let nonce = Nonce::from_slice(nonce_bytes);

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {}", e))
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARSET[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARSET[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARSET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARSET[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_generation() {
        let km = KeyManager::new();
        let pubkey = km.public_key();
        assert_eq!(pubkey.as_bytes().len(), 32);
    }

    #[test]
    fn test_session_establishment() {
        let mut alice = KeyManager::new();
        let mut bob = KeyManager::new();

        let alice_pub = *alice.public_key().as_bytes();
        let bob_pub = *bob.public_key().as_bytes();

        alice.establish_session(&bob_pub);
        bob.establish_session(&alice_pub);

        assert!(alice.session_key.is_some());
        assert!(bob.session_key.is_some());

        assert_eq!(alice.session_key.unwrap(), bob.session_key.unwrap());
    }

    #[test]
    fn test_fingerprint() {
        let alice = KeyManager::new();
        let bob = KeyManager::new();

        let bob_pub = *bob.public_key().as_bytes();
        let fingerprint = alice.fingerprint(&bob_pub);

        assert_eq!(fingerprint.len(), 6);
        assert!(fingerprint.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_encrypt_decrypt() {
        let mut alice = KeyManager::new();
        let mut bob = KeyManager::new();

        let alice_pub = *alice.public_key().as_bytes();
        let bob_pub = *bob.public_key().as_bytes();

        alice.establish_session(&bob_pub);
        bob.establish_session(&alice_pub);

        let plaintext = b"Hello, NEIA!";
        let ciphertext = alice.encrypt(plaintext).unwrap();

        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[..8].copy_from_slice(&0u64.to_le_bytes());

        let decrypted = bob.decrypt(&ciphertext, &nonce_bytes).unwrap();
        assert_eq!(decrypted, plaintext);
    }
}
