export class WebTorrentSignalingClient {
  constructor(trackers = []) {
    this.trackers = trackers.length > 0 ? trackers : [
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.files.fm:7002/announce',
    ];
    this.currentTrackerIndex = 0;
    this.ws = null;
    this.handlers = {};
    this.roomCode = null;
    this.secretKey = null;
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
    const hashArray = Array.from(new Uint8Array(sig));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async encryptPayload(dataObj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const jsonStr = JSON.stringify(dataObj);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      enc.encode(jsonStr)
    );

    const encryptedArray = new Uint8Array(encrypted);
    const combined = new Uint8Array(iv.length + encryptedArray.length);
    combined.set(iv, 0);
    combined.set(encryptedArray, iv.length);

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
    if (!valid) throw new Error('Signaling HMAC signature verification failed');

    const binaryStr = atob(encryptedObj.payload);
    const combined = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      combined[i] = binaryStr.charCodeAt(i);
    }

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      ciphertext
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  }

  hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  async connect(roomCode, secretKey, nickname) {
    this.roomCode = roomCode;
    this.secretKey = secretKey;
    await this.initKeys(secretKey);
    this.blindTopic = await this.computeBlindTopic(roomCode);
    this.myPeerId = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(b => b.toString(16).padStart(2, '0')).join('');

    return new Promise((resolve, reject) => {
      const trackerUrl = this.trackers[this.currentTrackerIndex];
      console.log(`[WebTorrent-Signaling] Connecting to swarm tracker: ${trackerUrl}`);
      this.ws = new WebSocket(trackerUrl);

      this.ws.onopen = async () => {
        console.log(`[WebTorrent-Signaling] Connected to ${trackerUrl}`);
        this.sendAnnounce('started');
        resolve();
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.offer && msg.offer.payload) {
            const inner = await this.decryptPayload(msg.offer);
            this.dispatch(inner);
          } else if (msg.answer && msg.answer.payload) {
            const inner = await this.decryptPayload(msg.answer);
            this.dispatch(inner);
          } else if (msg.type) {
            this.dispatch(msg);
          }
        } catch (err) {
          console.warn('[WebTorrent-Signaling] Ignored invalid or unauthenticated packet:', err.message);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WebTorrent-Signaling] Tracker error:', err);
        if (this.currentTrackerIndex < this.trackers.length - 1) {
          this.currentTrackerIndex++;
          this.connect(roomCode, secretKey, nickname).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      };
    });
  }

  sendAnnounce(event = 'update') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'announce',
        info_hash: this.blindTopic.substring(0, 40),
        peer_id: this.myPeerId,
        event,
      }));
    }
  }

  async sendOffer(to, sdp) {
    const encrypted = await this.encryptPayload({ type: 'offer', from: this.myPeerId, to, sdp });
    this.send({ action: 'announce', info_hash: this.blindTopic.substring(0, 40), offer: encrypted, to_peer_id: to });
  }

  async sendAnswer(to, sdp) {
    const encrypted = await this.encryptPayload({ type: 'answer', from: this.myPeerId, to, sdp });
    this.send({ action: 'announce', info_hash: this.blindTopic.substring(0, 40), answer: encrypted, to_peer_id: to });
  }

  async sendIce(to, candidate) {
    const encrypted = await this.encryptPayload({ type: 'ice', from: this.myPeerId, to, candidate: JSON.stringify(candidate) });
    this.send({ action: 'announce', info_hash: this.blindTopic.substring(0, 40), offer: encrypted, to_peer_id: to });
  }

  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  dispatch(msg) {
    const handlers = this.handlers[msg.type] || [];
    handlers.forEach(h => h(msg));
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.sendAnnounce('stopped');
      this.ws.close();
      this.ws = null;
    }
  }
}
