export class WebRTCManager {
  constructor(config = {}) {
    this.localStream = null;
    this.peers = new Map();
    this.dataChannels = new Map();
    this.config = {
      iceServers: config.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onDataMessage = null;
    this.onSpeakingChange = null;
  }

  async initLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      return this.localStream;
    } catch (err) {
      console.error('[WebRTC] Failed to get audio:', err);
      throw err;
    }
  }

  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(this.config);
    this.peers.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] ICE candidate for', peerId);
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track from', peerId);
      if (this.onPeerConnected) {
        this.onPeerConnected(peerId, event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state for', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (this.onPeerDisconnected) {
          this.onPeerDisconnected(peerId);
        }
      }
    };

    const dc = pc.createDataChannel('neia', {
      ordered: true,
    });
    this.setupDataChannel(peerId, dc);

    return pc;
  }

  handleIncomingConnection(peerId, pc) {
    this.peers.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] ICE candidate for', peerId);
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track from', peerId);
      if (this.onPeerConnected) {
        this.onPeerConnected(peerId, event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state for', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (this.onPeerDisconnected) {
          this.onPeerDisconnected(peerId);
        }
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }
  }

  setupDataChannel(peerId, channel) {
    channel.onopen = () => {
      console.log('[WebRTC] DataChannel open for', peerId);
      this.dataChannels.set(peerId, channel);
    };

    channel.onmessage = (event) => {
      if (this.onDataMessage) {
        try {
          const data = JSON.parse(event.data);
          this.onDataMessage(peerId, data);
        } catch {
          this.onDataMessage(peerId, { text: event.data });
        }
      }
    };

    channel.onclose = () => {
      console.log('[WebRTC] DataChannel closed for', peerId);
      this.dataChannels.delete(peerId);
    };
  }

  async createOffer(peerId) {
    const pc = this.peers.get(peerId) || this.createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return pc.localDescription;
  }

  async handleOffer(peerId, sdp) {
    let pc = this.peers.get(peerId);
    if (!pc) {
      pc = new RTCPeerConnection(this.config);
      this.handleIncomingConnection(peerId, pc);
    }
    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription;
  }

  async handleAnswer(peerId, sdp) {
    const pc = this.peers.get(peerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)));
    }
  }

  async handleIceCandidate(peerId, candidate) {
    const pc = this.peers.get(peerId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
    }
  }

  sendToPeer(peerId, data) {
    const channel = this.dataChannels.get(peerId);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  broadcast(data) {
    let sent = 0;
    for (const [peerId, channel] of this.dataChannels) {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(data));
        sent++;
      }
    }
    return sent;
  }

  muteLocal(muted) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
  }

  removePeer(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
    this.dataChannels.delete(peerId);
  }

  getPeerCount() {
    return this.peers.size;
  }

  async getPeerMetrics(peerId) {
    const pc = this.peers.get(peerId);
    if (!pc) return null;

    try {
      const stats = await pc.getStats();
      let metrics = {
        rtt: 0,
        jitter: 0,
        packetsLost: 0,
        packetsReceived: 0,
        packetLossRate: '0.0',
        audioLevel: '0',
        connectionState: pc.connectionState,
      };

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          metrics.jitter = Math.round((report.jitter || 0) * 1000);
          metrics.packetsLost = report.packetsLost || 0;
          metrics.packetsReceived = report.packetsReceived || 0;
          const total = metrics.packetsLost + metrics.packetsReceived;
          metrics.packetLossRate = total > 0 ? ((metrics.packetsLost / total) * 100).toFixed(1) : '0.0';
          if (report.audioLevel !== undefined) {
            metrics.audioLevel = (report.audioLevel * 100).toFixed(0);
          }
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          metrics.rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
        }
      });

      return metrics;
    } catch (err) {
      console.error('[WebRTC] Failed to get stats for', peerId, err);
      return null;
    }
  }

  destroy() {
    for (const [peerId, pc] of this.peers) {
      pc.close();
    }
    this.peers.clear();
    this.dataChannels.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
