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
};

let state = {
  nickname: '',
  roomCode: null,
  isMuted: false,
  peers: new Map(),
  peerStreams: new Map(),
  signaling: null,
  webrtc: null,
  audioContext: null,
  localAnalyser: null,
  vadInterval: null,
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
    for (const peer of msg.peers) {
      state.peers.set(peer.id, { nickname: peer.nickname });
      addPeer(peer.id, peer.nickname);

      const offer = await state.webrtc.createOffer(peer.id);
      state.signaling.sendOffer(peer.id, JSON.stringify(offer));
    }
  });

  state.signaling.on('peer_joined', (msg) => {
    const { peer } = msg;
    state.peers.set(peer.id, { nickname: peer.nickname });
    addPeer(peer.id, peer.nickname);
    notify(`${peer.nickname} joined`);
  });

  state.signaling.on('peer_left', (msg) => {
    state.peers.delete(msg.peer_id);
    state.webrtc.removePeer(msg.peer_id);
    removePeer(msg.peer_id);
    const peerInfo = state.peers.get(msg.peer_id);
    notify(`${peerInfo?.nickname || 'Peer'} left`);
  });

  state.signaling.on('offer', async (msg) => {
    const answer = await state.webrtc.handleOffer(msg.to, msg.sdp);
    state.signaling.sendAnswer(msg.to, JSON.stringify(answer));
  });

  state.signaling.on('answer', async (msg) => {
    await state.webrtc.handleAnswer(msg.to, msg.sdp);
  });

  state.signaling.on('ice', async (msg) => {
    await state.webrtc.handleIceCandidate(msg.to, msg.candidate);
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
    const link = `neia://join?room=${state.roomCode}`;
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
  const messageEl = document.createElement('div');
  messageEl.className = 'chat-message own';

  const textEl = document.createElement('div');
  textEl.className = 'chat-message-text';
  textEl.textContent = message;

  messageEl.appendChild(textEl);
  elements.chatMessages.appendChild(messageEl);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

  if (state.webrtc) {
    state.webrtc.broadcast({ type: 'chat', text: message });
  }
}

function addPeerMessage(peerId, nickname, message) {
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
    if (!el) {
      const existingSelf = elements.peersList.querySelector('.peer-item.self');
      if (existingSelf) el = existingSelf;
    }
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
  const selfPeer = document.createElement('div');
  selfPeer.className = 'peer-item self';
  selfPeer.dataset.peerId = 'local';
  selfPeer.innerHTML = `
    <div class="peer-avatar" style="background-color: #00d9a6;">Y</div>
    <span class="peer-name">You</span>
    <div class="peer-status"><div class="speaking-indicator"></div></div>
  `;
  elements.peersList.appendChild(selfPeer);

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    elements.roomCodeInput.value = roomParam.toUpperCase();
    elements.joinRoomSection.classList.remove('hidden');
  }

  showView('landing');
});

