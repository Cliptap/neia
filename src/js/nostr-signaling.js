export class NostrSignalingClient {
  constructor(relays = []) {
    this.relays = relays.length > 0 ? relays : [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
    ];
    this.currentRelayIndex = 0;
    this.ws = null;
    this.handlers = {};
    this.blindTopic = null;
    this.cryptoKey = null;
    this.hmacKey = null;
    this.myPeerId = null;
  }

  async initKeys(secretKeyBase64) {
    const enc = new TextEncoder();
    const keyData = enc.encode(secretKeyBase64);

    this.cryptoKey = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest('SHA-256', keyData),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    this.hmacKey = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest('SHA-256', keyData),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  async computeBlindTopic(roomCode) {
    const enc = new TextEncoder();
    const sig = await crypto.subtle.sign('HMAC', this.hmacKey, enc.encode(roomCode));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async encryptPayload(dataObj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      enc.encode(JSON.stringify(dataObj))
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    const base64Payload = btoa(String.fromCharCode(...combined));
    const hmacSig = await crypto.subtle.sign('HMAC', this.hmacKey, enc.encode(base64Payload));
    const hmacHex = Array.from(new Uint8Array(hmacSig)).map(b => b.toString(16).padStart(2, '0')).join('');

    return { payload: base64Payload, sig: hmacHex };
  }

  async decryptPayload(encryptedObj) {
    const enc = new TextEncoder();
    const valid = await crypto.subtle.verify(
      'HMAC',
      this.hmacKey,
      this.hexToBytes(encryptedObj.sig),
      enc.encode(encryptedObj.payload)
    );
    if (!valid) throw new Error('Nostr HMAC signature verification failed');

    const binaryStr = atob(encryptedObj.payload);
    const combined = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) combined[i] = binaryStr.charCodeAt(i);

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      ciphertext
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i] = parseInt(hex.substr(i, 2), 16);
    return bytes;
  }

  async connect(roomCode, secretKey, nickname) {
    await this.initKeys(secretKey);
    this.blindTopic = await this.computeBlindTopic(roomCode);
    this.myPeerId = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(b => b.toString(16).padStart(2, '0')).join('');

    return new Promise((resolve, reject) => {
      const relayUrl = this.relays[this.currentRelayIndex];
      console.log(`[Nostr-Signaling] Connecting to relay: ${relayUrl}`);
      this.ws = new WebSocket(relayUrl);

      this.ws.onopen = () => {
        console.log(`[Nostr-Signaling] Connected to relay ${relayUrl}`);
        this.subscribeToTopic();
        resolve();
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg[0] === 'EVENT' && msg[2] && msg[2].content) {
            const inner = await this.decryptPayload(JSON.parse(msg[2].content));
            if (inner.to === this.myPeerId || inner.to === 'all') {
              this.dispatch(inner);
            }
          }
        } catch (err) {
          console.warn('[Nostr-Signaling] Packet parse error:', err.message);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Nostr-Signaling] Relay error:', err);
        if (this.currentRelayIndex < this.relays.length - 1) {
          this.currentRelayIndex++;
          this.connect(roomCode, secretKey, nickname).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      };
    });
  }

  subscribeToTopic() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const subMsg = ['REQ', 'neia-sub', { kinds: [20000], '#t': [this.blindTopic.substring(0, 32)] }];
      this.ws.send(JSON.stringify(subMsg));
    }
  }

  async publishEvent(dataObj) {
    const encrypted = await this.encryptPayload(dataObj);
    const event = {
      kind: 20000,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', this.blindTopic.substring(0, 32)]],
      content: JSON.stringify(encrypted),
      pubkey: this.blindTopic.substring(0, 64),
      id: Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''),
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['EVENT', event]));
    }
  }

  async sendOffer(to, sdp) {
    await this.publishEvent({ type: 'offer', from: this.myPeerId, to, sdp });
  }

  async sendAnswer(to, sdp) {
    await this.publishEvent({ type: 'answer', from: this.myPeerId, to, sdp });
  }

  async sendIce(to, candidate) {
    await this.publishEvent({ type: 'ice', from: this.myPeerId, to, candidate: JSON.stringify(candidate) });
  }

  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  dispatch(msg) {
    const handlers = this.handlers[msg.type] || [];
    handlers.forEach(h => h(msg));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
