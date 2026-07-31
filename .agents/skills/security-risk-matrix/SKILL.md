---
name: security-risk-matrix
description: Automatically maintain, update, and audit the Cybersecurity Risk Matrix (docs/SECURITY_RISK_MATRIX.md) whenever security, cryptography, WebRTC, P2P signaling, or architectural changes are planned or implemented in the NEIA codebase.
---

# Cybersecurity & Architecture Risk Matrix Maintenance Skill

## Purpose
This skill ensures that **NEIA** maintains an up-to-date, rigorous, and formal **Cybersecurity Risk Matrix & Architectural Decision Record (ADR)**. Every technical modification, new feature, or architectural evolution must automatically update the threat matrix with its associated attack vectors, risk severities, and cryptographic/systemic mitigations.

---

## When This Skill Triggers
This skill activates whenever:
1. Adding, modifying, or reviewing cryptographic protocols (X25519, HKDF, AES-GCM, HMAC, Fingerprints).
2. Changing WebRTC signaling mechanisms (Signaling server, WebTorrent trackers, Cloudflare Workers, Nostr).
3. Modifying data handling, local storage, session state, or IPC commands in Rust/Tauri.
4. Implementing new network layers, P2P mesh logic, or audio stream handling.
5. Performing security audits or reviewing potential vulnerability vectors.

---

## Instructions for the Agent

### 1. Risk Matrix Structure
Whenever documenting a new feature or architectural change, add an entry to [docs/SECURITY_RISK_MATRIX.md](file:///c:/Users/andre/Documents/VSC%20Projects/neia-project/docs/SECURITY_RISK_MATRIX.md) using the following standard template:

```markdown
### [SEC-XXX] Feature / Architectural Decision Name

- **Component**: Frontend / Rust Backend / Signaling / WebRTC / Crypto
- **Threat Model & Attack Vectors**:
  - Attack Vector 1 (e.g., Eavesdropping, MITM, DoS, Replay)
  - Attack Vector 2 (e.g., Topic Sniffing, Brute Force)
- **Risk Rating**: Critical / High / Medium / Low
- **Cryptographic & Systemic Mitigations**:
  - Mitigation 1 (Exact algorithm, key length, or architecture pattern)
  - Mitigation 2 (Implementation details and verification procedure)
- **Verification & Audit Procedure**:
  - Automated tests (e.g., cargo test, npm run test:e2e, test:mos)
```

### 2. Mandatory Rules
- **No Unmitigated Risks**: Never introduce a new feature or network protocol without analyzing its threat vectors and documenting its mitigation.
- **Zero-Knowledge Principle**: Ensure all architectural decisions maintain NEIA's zero-account, zero-server-log, and end-to-end encrypted design.
- **Traceability**: Link every risk matrix entry directly to the source code files implementing the mitigation (e.g., `src-tauri/src/crypto/mod.rs`, `src/js/webrtc.js`).
