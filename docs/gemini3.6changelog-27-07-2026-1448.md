# Walkthrough - NEIA Desktop Integration & Verification

We have completed the backend and frontend wiring for **NEIA**, the anonymous P2P voice chat application.

## Key Changes Made

### 1. Embedded Signaling Server & Tauri State Management
- Updated [lib.rs](file:///c:/Users/andre/Documents/VSC%20Projects/neia-project/src-tauri/src/lib.rs) to:
  - Automatically launch the WebSocket signaling server in `tauri::async_runtime::spawn` on `127.0.0.1:9876` during app startup (`.setup()` hook).
  - Register `CryptoState` with `tauri::Builder` so `KeyManager` state is preserved throughout the session.
  - Expose `get_public_key`, `get_fingerprint`, and `verify_peer_key` to the frontend via `invoke_handler`.

### 2. End-to-End Key Fingerprint Verification
- Implemented `get_public_key`, `get_fingerprint`, and `verify_peer_key` in [crypto_commands.rs](file:///c:/Users/andre/Documents/VSC%20Projects/neia-project/src-tauri/src/commands/crypto_commands.rs).
- Uses X25519 Diffie-Hellman, HKDF-SHA256, and SHA-256 fingerprinting for Signal-style 6-digit Safety Numbers (formatted as `XXX-XXX`).
- Updated [app.js](file:///c:/Users/andre/Documents/VSC%20Projects/neia-project/src/js/app.js) to automatically exchange public keys on peer connection and compute/display safety fingerprints in the modal UI.

### 3. Window Configuration & Build Cleanliness
- Added `"label": "main"` in [tauri.conf.json](file:///c:/Users/andre/Documents/VSC%20Projects/neia-project/src-tauri/tauri.conf.json) to align with capabilities.
- Fixed query parameter parser for room code links (`?room=ABC123`).

---

## Verification Results

### Automated Tests
- Executed `cargo test` in `src-tauri`:
  - `crypto::tests::test_key_generation` - **PASSED**
  - `crypto::tests::test_fingerprint` - **PASSED**
  - `crypto::tests::test_session_establishment` - **PASSED**
  - `crypto::tests::test_encrypt_decrypt` - **PASSED**
  - `room::code::tests::test_generate_code_charset` - **PASSED**
  - `room::code::tests::test_generate_code_length` - **PASSED**
  - `room::code::tests::test_validate_ambiguous_chars` - **PASSED**
  - `room::code::tests::test_validate_invalid_length` - **PASSED**
  - `room::code::tests::test_validate_valid_code` - **PASSED**

---

## How to Run the App Locally

To start the desktop application in development mode:
```bash
cd "c:/Users/andre/Documents/VSC Projects/neia-project"
npm run tauri dev
```
