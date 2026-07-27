export class SignalingClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }

  connect(room, nickname) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('[Signaling] Connected');
        this.reconnectAttempts = 0;
        this.send({ type: 'join', room, nickname });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.dispatch(msg);
        } catch (err) {
          console.error('[Signaling] Parse error:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[Signaling] Disconnected');
        this.tryReconnect(room, nickname);
      };

      this.ws.onerror = (err) => {
        console.error('[Signaling] Error:', err);
        reject(err);
      };
    });
  }

  on(type, handler) {
    if (!this.handlers[type]) {
      this.handlers[type] = [];
    }
    this.handlers[type].push(handler);
  }

  off(type, handler) {
    if (this.handlers[type]) {
      this.handlers[type] = this.handlers[type].filter(h => h !== handler);
    }
  }

  dispatch(msg) {
    const handlers = this.handlers[msg.type] || [];
    handlers.forEach(handler => handler(msg));

    const allHandlers = this.handlers['*'] || [];
    allHandlers.forEach(handler => handler(msg));
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendOffer(to, sdp) {
    this.send({ type: 'offer', to, sdp });
  }

  sendAnswer(to, sdp) {
    this.send({ type: 'answer', to, sdp });
  }

  sendIce(to, candidate) {
    this.send({ type: 'ice', to, candidate: JSON.stringify(candidate) });
  }

  sendChat(nickname, text) {
    this.send({ type: 'chat', nickname, text, timestamp: Date.now() });
  }

  tryReconnect(room, nickname) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Signaling] Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[Signaling] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(room, nickname), delay);
  }

  disconnect() {
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
