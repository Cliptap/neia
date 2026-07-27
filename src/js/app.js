const { invoke } = window.__TAURI__.core;
import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';

const SIGNALING_URL = 'ws://localhost:9876';

const views = {
  landing: document.getElementById('landing-view'),
  room: document.getElementById('room-view'),
};

const elements = {
  nicknameForm: document.getElementById('nickname-form'),
  nicknameInput: document.getElementById('nickname-input'),
  createRoomBtn: document.getElementById('create-room-btn'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  joinRoomSection: document.getElementById('join-room-section'),
  joinForm: document.getElementById('join-form'),
  roomCodeInput: document.getElementById('room-code-input'),
  roomCodeDisplay: document.getElementById('room-code-display'),
  copyRoomLinkBtn: document.getElementById('copy-room-link-btn'),
  leaveRoomBtn: document.getElementById('leave-room-btn'),
  muteBtn: document.getElementById('mute-btn'),
  muteIcon: document.getElementById('mute-icon'),
  muteText: document.getElementById('mute-text'),
  verifyKeysBtn: document.getElementById('verify-keys-btn'),
  verificationModal: document.getElementById('verification-modal'),
  fingerprintCode: document.getElementById('fingerprint-code'),
  verifyConfirmBtn: document.getElementById('verify-confirm-btn'),
  verifyCancelBtn: document.getElementById('verify-cancel-btn'),
  peersList: document.getElementById('peers-list'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  chatMessages: document.getElementById('chat-messages'),
  notifications: document.getElementById('notifications'),
  statsBtn: document.getElementById('stats-btn'),
  statsModal: document.getElementById('stats-modal'),
  statsCloseBtn: document.getElementById('stats-close-btn'),
  statRtt: document.getElementById('stat-rtt'),
  statJitter: document.getElementById('stat-jitter'),
  statLoss: document.getElementById('stat-loss'),
  statHealth: document.getElementById('stat-health'),
};

let state = {
  nickname: '',
  roomCode: null,
  isMuted: false,
  myPeerId: null,
  peers: new Map(),
  peerStreams: new Map(),
  signaling: null,
  webrtc: null,
  audioContext: null,
  localAnalyser: null,
  vadInterval: null,
  statsInterval: null,
  recentMessages: new Set(),
};

function showView(viewName) {
  Object.values(views).forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  views[viewName].classList.remove('hidden');
  views[viewName].classList.add('active');
}

function notify(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  elements.notifications.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

function renderLocalUser() {
  let selfPeer = elements.peersList.querySelector('[data-peer-id="local"]');
  if (!selfPeer) {
    selfPeer = document.createElement('div');
    selfPeer.className = 'peer-item self';
    selfPeer.dataset.peerId = 'local';
    elements.peersList.appendChild(selfPeer);
  }
  const initial = (state.nickname || 'Y').charAt(0).toUpperCase();
  selfPeer.innerHTML = `
    <div class="peer-avatar" style="background-color: #00d9a6;">${initial}</div>
    <span class="peer-name">You (${state.nickname})</span>
    <div class="peer-status"><div class="speaking-indicator"></div></div>
  `;
}

async function createRoom() {
  try {
    const nickname = elements.nicknameInput.value.trim();
    if (!nickname) {
      notify('Please enter a nickname');
      return;
    }

    state.nickname = await invoke('set_nickname', { nickname });
    const roomCode = await invoke('create_room');

    state.roomCode = roomCode;
    elements.roomCodeDisplay.textContent = roomCode;

    await initializeMedia(roomCode);
    renderLocalUser();
    showView('room');
    notify(`Room created: ${roomCode}`);
  } catch (error) {
    notify(`Error: ${error}`);
  }
}

async function joinRoom(roomCode) {
  try {
    const nickname = elements.nicknameInput.value.trim();
    if (!nickname) {
      notify('Please enter a nickname');
      return;
    }

    state.nickname = await invoke('set_nickname', { nickname });
    const validatedCode = await invoke('join_room', { roomCode });

    state.roomCode = validatedCode;
    elements.roomCodeDisplay.textContent = validatedCode;

    await initializeMedia(validatedCode);
    renderLocalUser();
    showView('room');
    notify(`Joined room: ${validatedCode}`);
  } catch (error) {
    notify(`Error: ${error}`);
  }
}

async function initializeMedia(roomCode) {
  state.webrtc = new WebRTCManager();
  state.signaling = new SignalingClient(SIGNALING_URL);

  try {
    await state.webrtc.initLocalStream();
  } catch {
    notify('Microphone access denied');
  }

  state.webrtc.onIceCandidate = (peerId, candidate) => {
    state.signaling.sendIce(peerId, candidate);
  };

  state.webrtc.onPeerConnected = async (peerId, stream) => {
    state.peerStreams.set(peerId, stream);
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.id = `audio-${peerId}`;
    document.body.appendChild(audio);
    notify(`Peer connected: ${peerId.substring(0, 8)}`);

    try {
      const pubkey = await invoke('get_public_key');
      state.webrtc.sendToPeer(peerId, { type: 'key_exchange', pubkey });
    } catch (err) {
      console.error('[Crypto] Failed to send public key:', err);
    }
  };

  state.webrtc.onPeerDisconnected = (peerId) => {
    state.peerStreams.delete(peerId);
    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) audio.remove();
    removePeer(peerId);
    notify(`Peer disconnected: ${peerId.substring(0, 8)}`);
  };

  state.webrtc.onDataMessage = async (peerId, data) => {
    if (data.type === 'chat') {
      const peerInfo = state.peers.get(peerId);
      addPeerMessage(peerId, peerInfo?.nickname || 'Unknown', data.text);
    } else if (data.type === 'vad') {
      updatePeerSpeaking(peerId, data.speaking);
    } else if (data.type === 'key_exchange') {
      console.log('[Crypto] Key exchange received from', peerId, data.pubkey);
      const peerInfo = state.peers.get(peerId) || {};
      peerInfo.pubkey = data.pubkey;
      state.peers.set(peerId, peerInfo);

      try {
        const fp = await invoke('verify_peer_key', { peerKey: data.pubkey });
        console.log('[Crypto] Session safety fingerprint with', peerId, ':', fp);
      } catch (err) {
        console.error('[Crypto] Verification error:', err);
      }
    }
  };

  state.signaling.on('peers', async (msg) => {
    if (msg.my_id) {
      state.myPeerId = msg.my_id;
    }
    for (const peer of msg.peers) {
      if (peer.id === state.myPeerId) continue;
      state.peers.set(peer.id, { nickname: peer.nickname });
      addPeer(peer.id, peer.nickname);

      const offer = await state.webrtc.createOffer(peer.id);
      state.signaling.sendOffer(peer.id, JSON.stringify(offer));
    }
  });

  state.signaling.on('peer_joined', (msg) => {
    const { peer } = msg;
    if (peer.id === state.myPeerId) return;
    state.peers.set(peer.id, { nickname: peer.nickname });
    addPeer(peer.id, peer.nickname);
    notify(`${peer.nickname} joined`);
  });

  state.signaling.on('peer_left', (msg) => {
    const peerInfo = state.peers.get(msg.peer_id);
    state.peers.delete(msg.peer_id);
    state.webrtc.removePeer(msg.peer_id);
    removePeer(msg.peer_id);
    notify(`${peerInfo?.nickname || 'Peer'} left`);
  });

  state.signaling.on('offer', async (msg) => {
    const fromId = msg.from;
    if (!fromId) return;
    state.peers.set(fromId, state.peers.get(fromId) || { nickname: 'Peer' });
    const answer = await state.webrtc.handleOffer(fromId, msg.sdp);
    state.signaling.sendAnswer(fromId, JSON.stringify(answer));
  });

  state.signaling.on('answer', async (msg) => {
    const fromId = msg.from;
    if (!fromId) return;
    await state.webrtc.handleAnswer(fromId, msg.sdp);
  });

  state.signaling.on('ice', async (msg) => {
    const fromId = msg.from;
    if (!fromId) return;
    await state.webrtc.handleIceCandidate(fromId, msg.candidate);
  });

  state.signaling.on('chat_history', (msg) => {
    if (msg.messages && Array.isArray(msg.messages)) {
      msg.messages.forEach(item => {
        addPeerMessage(item.from_id, item.nickname, item.text);
      });
    }
  });

  state.signaling.on('chat', (msg) => {
    if (msg.from_id && msg.from_id !== state.myPeerId) {
      addPeerMessage(msg.from_id, msg.nickname, msg.text);
    }
  });

  await state.signaling.connect(roomCode, state.nickname);

  startVAD();
}

function startVAD() {
  state.audioContext = new AudioContext();
  state.localAnalyser = state.audioContext.createAnalyser();
  state.localAnalyser.fftSize = 2048;

  if (state.webrtc.localStream) {
    const source = state.audioContext.createMediaStreamSource(state.webrtc.localStream);
    source.connect(state.localAnalyser);
  }

  const buffer = new Float32Array(state.localAnalyser.fftSize);

  state.vadInterval = setInterval(() => {
    state.localAnalyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    const isSpeaking = rms > 0.01;

    state.webrtc.broadcast({ type: 'vad', speaking: isSpeaking, level: rms });
    updatePeerSpeaking('local', isSpeaking);
  }, 100);
}

function stopVAD() {
  if (state.vadInterval) {
    clearInterval(state.vadInterval);
    state.vadInterval = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
}

async function leaveRoom() {
  try {
    stopVAD();

    if (state.signaling) {
      state.signaling.disconnect();
      state.signaling = null;
    }

    if (state.webrtc) {
      state.webrtc.destroy();
      state.webrtc = null;
    }

    state.peerStreams.forEach((stream, peerId) => {
      const audio = document.getElementById(`audio-${peerId}`);
      if (audio) audio.remove();
    });
    state.peerStreams.clear();

    state.roomCode = null;
    state.peers.clear();
    state.recentMessages.clear();
    elements.peersList.innerHTML = '';
    elements.chatMessages.innerHTML = '';
    showView('landing');
    notify('Left room');

    await invoke('leave_room');
  } catch (error) {
    notify(`Error: ${error}`);
  }
}

function toggleMute() {
  state.isMuted = !state.isMuted;
  elements.muteIcon.textContent = state.isMuted ? '🔇' : '🎤';
  elements.muteText.textContent = state.isMuted ? 'Unmute' : 'Mute';

  if (state.webrtc) {
    state.webrtc.muteLocal(state.isMuted);
  }
  notify(state.isMuted ? 'Muted' : 'Unmuted');
}

async function copyRoomLink() {
  try {
    const link = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;
    await navigator.clipboard.writeText(link);
    notify('Invite link copied!');
  } catch {
    notify('Failed to copy link');
  }
}

async function showVerification() {
  try {
    let peerKey = null;
    for (const [_, peer] of state.peers) {
      if (peer.pubkey) {
        peerKey = peer.pubkey;
        break;
      }
    }
    const rawFp = await invoke('get_fingerprint', { peerKey: peerKey || undefined });
    const formattedFp = rawFp.length === 6 ? `${rawFp.slice(0, 3)}-${rawFp.slice(3)}` : rawFp;
    elements.fingerprintCode.textContent = formattedFp;
    elements.verificationModal.classList.remove('hidden');
  } catch (error) {
    notify(`Error: ${error}`);
  }
}

function hideVerification() {
  elements.verificationModal.classList.add('hidden');
}

function sendChatMessage(message) {
  renderOwnChatMessage(message);

  if (state.webrtc) {
    state.webrtc.broadcast({ type: 'chat', text: message });
  }

  if (state.signaling) {
    state.signaling.sendChat(state.nickname, message);
  }
}

function renderOwnChatMessage(message) {
  const msgKey = `local:${message}`;
  if (state.recentMessages.has(msgKey)) return;
  state.recentMessages.add(msgKey);
  setTimeout(() => state.recentMessages.delete(msgKey), 5000);

  const messageEl = document.createElement('div');
  messageEl.className = 'chat-message own';

  const textEl = document.createElement('div');
  textEl.className = 'chat-message-text';
  textEl.textContent = message;

  messageEl.appendChild(textEl);
  elements.chatMessages.appendChild(messageEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addPeerMessage(peerId, nickname, message) {
  const msgKey = `${peerId}:${message}`;
  if (state.recentMessages.has(msgKey)) return;
  state.recentMessages.add(msgKey);
  setTimeout(() => state.recentMessages.delete(msgKey), 5000);

  const messageEl = document.createElement('div');
  messageEl.className = 'chat-message';

  const authorEl = document.createElement('div');
  authorEl.className = 'chat-message-author';
  authorEl.textContent = nickname;

  const textEl = document.createElement('div');
  textEl.className = 'chat-message-text';
  textEl.textContent = message;

  messageEl.appendChild(authorEl);
  messageEl.appendChild(textEl);
  elements.chatMessages.appendChild(messageEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addPeer(peerId, nickname) {
  if (peerId === 'local' || peerId === state.myPeerId) return;
  if (elements.peersList.querySelector(`[data-peer-id="${peerId}"]`)) return;

  const peerEl = document.createElement('div');
  peerEl.className = 'peer-item';
  peerEl.dataset.peerId = peerId;

  const avatar = document.createElement('div');
  avatar.className = 'peer-avatar';
  avatar.textContent = nickname.charAt(0).toUpperCase();

  const name = document.createElement('span');
  name.className = 'peer-name';
  name.textContent = nickname;

  const status = document.createElement('div');
  status.className = 'peer-status';
  const indicator = document.createElement('div');
  indicator.className = 'speaking-indicator';
  status.appendChild(indicator);

  peerEl.appendChild(avatar);
  peerEl.appendChild(name);
  peerEl.appendChild(status);
  elements.peersList.appendChild(peerEl);
}

function removePeer(peerId) {
  const peerEl = elements.peersList.querySelector(`[data-peer-id="${peerId}"]`);
  if (peerEl) peerEl.remove();
}

function updatePeerSpeaking(peerId, isSpeaking) {
  let el;
  if (peerId === 'local') {
    el = elements.peersList.querySelector('[data-peer-id="local"]');
  } else {
    el = elements.peersList.querySelector(`[data-peer-id="${peerId}"]`);
  }

  if (el) {
    const indicator = el.querySelector('.speaking-indicator');
    if (indicator) {
      if (isSpeaking) indicator.classList.add('active');
      else indicator.classList.remove('active');
    }
  }
}

async function showStatsModal() {
  elements.statsModal.classList.remove('hidden');
  await updateLiveStats();
  if (!state.statsInterval) {
    state.statsInterval = setInterval(updateLiveStats, 1000);
  }
}

function hideStatsModal() {
  elements.statsModal.classList.add('hidden');
  if (state.statsInterval) {
    clearInterval(state.statsInterval);
    state.statsInterval = null;
  }
}

async function updateLiveStats() {
  if (!state.webrtc) return;

  let firstPeerId = null;
  for (const [peerId] of state.peers) {
    firstPeerId = peerId;
    break;
  }

  if (!firstPeerId) {
    elements.statRtt.textContent = '0 ms';
    elements.statJitter.textContent = '0 ms';
    elements.statLoss.textContent = '0.0 %';
    setHealthBadge('Optimal');
    return;
  }

  const metrics = await state.webrtc.getPeerMetrics(firstPeerId);
  if (metrics) {
    elements.statRtt.textContent = `${metrics.rtt} ms`;
    elements.statJitter.textContent = `${metrics.jitter} ms`;
    elements.statLoss.textContent = `${metrics.packetLossRate} %`;

    let health = 'Optimal';
    if (metrics.rtt > 200 || parseFloat(metrics.packetLossRate) > 5) {
      health = 'Poor';
    } else if (metrics.rtt > 100 || parseFloat(metrics.packetLossRate) > 1) {
      health = 'Fair';
    }
    setHealthBadge(health);
  }
}

function setHealthBadge(health) {
  elements.statHealth.textContent = health;
  elements.statHealth.className = 'stat-value health-badge';
  if (health === 'Fair') elements.statHealth.classList.add('fair');
  else if (health === 'Poor') elements.statHealth.classList.add('poor');
}

elements.createRoomBtn.addEventListener('click', createRoom);

elements.joinRoomBtn.addEventListener('click', () => {
  elements.joinRoomSection.classList.toggle('hidden');
});

elements.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = elements.roomCodeInput.value.trim().toUpperCase();
  if (code) joinRoom(code);
});

elements.leaveRoomBtn.addEventListener('click', leaveRoom);
elements.muteBtn.addEventListener('click', toggleMute);
elements.copyRoomLinkBtn.addEventListener('click', copyRoomLink);
elements.statsBtn.addEventListener('click', showStatsModal);
elements.statsCloseBtn.addEventListener('click', hideStatsModal);
elements.verifyKeysBtn.addEventListener('click', showVerification);
elements.verifyCancelBtn.addEventListener('click', hideVerification);
elements.verifyConfirmBtn.addEventListener('click', () => {
  notify('Encryption verified!');
  hideVerification();
});

elements.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = elements.chatInput.value.trim();
  if (message) {
    sendChatMessage(message);
    elements.chatInput.value = '';
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    elements.roomCodeInput.value = roomParam.toUpperCase();
    elements.joinRoomSection.classList.remove('hidden');
  }

  showView('landing');
});
