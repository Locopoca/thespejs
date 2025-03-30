const socket = io(window.location.origin);
let state = {
  roomId: null,
  userId: null,
  messages: [],
  participants: [],
  foldedReplies: new Set(),
  isRoomCreator: false,
  lastMessageTime: null
};
let peers = {};
let stream;
let recorder;
let recordedChunks = [];
let isRecording = false;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  state.roomId = urlParams.get('room');
  state.userId = decodeURIComponent(urlParams.get('user'));
  
  if (!state.roomId || !state.userId) {
    window.location.href = '/index.html';
    return;
  }

  document.getElementById('room-info').textContent = `ROOM: ${state.roomId} | USER: ${state.userId}${state.isRoomCreator ? ' [CREATOR]' : ''}`;
  document.getElementById('prompt').textContent = `${state.userId}@spejs:~$ `;
  setupAudio();
  setupChatInput();
  joinRoom();
});

async function setupAudio() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    console.error('Failed to access microphone:', error);
    alert('Failed to access microphone. Please allow permissions and refresh.');
  }
}

function setupChatInput() {
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const message = chatInput.value.trim();
      if (message) {
        sendMessage(null, message);
      }
    }
  });
}

function joinRoom() {
  socket.emit('join-room', state.roomId, state.userId);

  socket.on('message-update', (roomMessages) => {
    console.log('Received message-update:', JSON.stringify(roomMessages, null, 2));
    state.messages = roomMessages;
    renderMessages();
  });

  socket.on('participants-update', (roomParticipants) => {
    state.participants = roomParticipants;
    renderParticipants();
  });

  socket.on('user-connected', (peerId) => {
    console.log(`User connected: ${peerId}`);
    addPeer(peerId);
  });

  socket.on('user-disconnected', (peerId) => {
    console.log(`User disconnected: ${peerId}`);
    if (peers[peerId]) {
      peers[peerId].close();
      delete peers[peerId];
    }
    renderParticipants();
  });

  socket.on('offer', async (offer) => {
    console.log('Received offer');
    const peer = createPeer(null);
    try {
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('answer', state.roomId, answer);
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  });

  socket.on('answer', (answer) => {
    const peerId = Object.keys(peers)[0];
    const peer = peers[peerId];
    if (peer) {
      console.log('Received answer');
      peer.setRemoteDescription(new RTCSessionDescription(answer)).catch(err => console.error('Error setting answer:', err));
    } else {
      console.warn('No peer found for answer');
    }
  });

  socket.on('ice-candidate', (candidate) => {
    const peerId = Object.keys(peers)[0];
    const peer = peers[peerId];
    if (peer && peer.signalingState !== 'closed') {
      console.log('Received ICE candidate');
      peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => console.error('Error adding ICE candidate:', err));
    } else {
      console.warn('No valid peer for ICE candidate');
    }
  });

  socket.on('set-room-creator', (isCreator) => {
    state.isRoomCreator = isCreator;
    document.getElementById('room-info').textContent = `ROOM: ${state.roomId} | USER: ${state.userId}${state.isRoomCreator ? ' [CREATOR]' : ''}`;
    renderParticipants();
  });

  socket.on('mute-user', (peerId) => {
    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) audio.muted = true;
    renderParticipants();
  });

  document.getElementById('messages').addEventListener('click', (event) => {
    const thread = event.target.closest('.thread');
    if (thread && !event.target.closest('button')) {
      const msgId = thread.dataset.id;
      toggleThread(msgId);
    }

    const replyBtn = event.target.closest('.reply-btn');
    if (replyBtn) {
      const msgId = replyBtn.dataset.msgId;
      console.log(`Reply button clicked for msgId: ${msgId}`);
      replyTo(msgId);
    }
  });

  socket.emit('fetch-messages', state.roomId);
  socket.emit('fetch-participants', state.roomId);
}

function createPeer(peerId) {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  if (stream) {
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  }

  peer.ontrack = (event) => {
    const audio = document.createElement('audio');
    audio.id = `audio-${peerId || Math.random().toString(36).substring(2)}`;
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
    audio.muted = false;
    document.body.appendChild(audio);
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate from ${peerId || 'new peer'}`);
      socket.emit('ice-candidate', state.roomId, event.candidate);
    }
  };

  if (peerId) peers[peerId] = peer;
  return peer;
}

async function addPeer(peerId) {
  const peer = createPeer(peerId);
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(`Sending offer for peer: ${peerId}`);
    socket.emit('offer', state.roomId, offer);
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

function renderMessages() {
  const messagesDiv = document.getElementById('messages');
  const roomMessages = [...state.messages];
  console.log(`Rendering ${roomMessages.length} messages`);

  if (roomMessages.length === 0) {
    messagesDiv.innerHTML = '<p>No messages yet.</p>';
    return;
  }

  const topMessage = roomMessages.reduce((max, msg) => (msg.score > max.score ? msg : max), roomMessages[0]);
  const otherMessages = roomMessages.filter(msg => msg.id !== topMessage.id);

  messagesDiv.innerHTML = `
    <div class="thread ${state.foldedReplies.has(topMessage.id) ? 'collapsed' : ''}" data-id="${topMessage.id}">
      <div class="meta">
        <span>${topMessage.userId} [${topMessage.timestamp}]</span>
        <span class="score">${topMessage.score}</span>
        <button onclick="vote('${topMessage.id}', 'up')">↑</button>
        <button onclick="vote('${topMessage.id}', 'down')">↓</button>
        <button class="reply-btn" data-msg-id="${topMessage.id}">REPLY (${(topMessage.replies || []).length})</button>
        ${(topMessage.replies || []).length ? '<span class="expand-indicator">▶</span>' : ''}
      </div>
      <p>${topMessage.message}</p>
      <div id="replies-${topMessage.id}" class="replies ${state.foldedReplies.has(topMessage.id) ? '' : 'expanded'}">
        ${renderMessageTree(topMessage.replies || [], 1)}
      </div>
    </div>
    ${renderMessageTree(otherMessages, 0)}
  `;

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderMessageTree(messages, level) {
  console.log(`Rendering messages at level ${level}:`, JSON.stringify(messages, null, 2));
  return messages.map(msg => `
    <div class="thread ${state.foldedReplies.has(msg.id) ? 'collapsed' : ''}" data-id="${msg.id}">
      <div class="meta">
        <span>${msg.userId} [${msg.timestamp}]</span>
        <span class="score">${msg.score}</span>
        <button onclick="vote('${msg.id}', 'up')">↑</button>
        <button onclick="vote('${msg.id}', 'down')">↓</button>
        <button class="reply-btn" data-msg-id="${msg.id}">REPLY (${(msg.replies || []).length})</button>
        ${(msg.replies || []).length ? '<span class="expand-indicator">▶</span>' : ''}
      </div>
      <p>${msg.message || 'No message content'}</p>
      <div id="replies-${msg.id}" class="replies ${state.foldedReplies.has(msg.id) ? '' : 'expanded'}">
        ${renderMessageTree(msg.replies || [], level + 1)}
      </div>
    </div>
  `).join('');
}

function renderParticipants() {
  const participantsDiv = document.getElementById('participants');
  participantsDiv.innerHTML = state.participants.map(p => `
    <div class="participant">
      <span>${p}${p === state.userId ? ' (You)' : ''}</span>
      ${state.isRoomCreator && p !== state.userId ? `<button onclick="muteUser('${p}')">${document.getElementById('audio-${p}')?.muted ? 'UNMUTE' : 'MUTE'}</button>` : ''}
    </div>
  `).join('');
}

function sendMessage(parentId = null, message = '') {
  const now = Date.now();
  if (state.lastMessageTime && (now - state.lastMessageTime) < 12000) {
    alert(`Please wait ${Math.ceil(12 - (now - state.lastMessageTime) / 1000)} seconds before sending another message.`);
    return;
  }

  if (!message) return;

  console.log(`Preparing to send: roomId=${state.roomId}, userId=${state.userId}, message=${message}, parentId=${parentId}`);
  socket.emit('chat-message', state.roomId, state.userId, message, parentId);
  console.log(`Emitted chat-message event for parentId: ${parentId}`);
  state.lastMessageTime = now;
}

function vote(msgId, direction) {
  console.log(`Voting ${direction} on msgId: ${msgId}`);
  socket.emit('vote', state.roomId, msgId, state.userId, direction);
}

function toggleThread(msgId) {
  const repliesDiv = document.getElementById(`replies-${msgId}`);
  const thread = document.querySelector(`.thread[data-id="${msgId}"]`);
  if (state.foldedReplies.has(msgId)) {
    state.foldedReplies.delete(msgId);
    repliesDiv.classList.add('expanded');
    thread.classList.remove('collapsed');
  } else {
    state.foldedReplies.add(msgId);
    repliesDiv.classList.remove('expanded');
    thread.classList.add('collapsed');
  }
}

function replyTo(msgId) {
  const message = prompt('Enter your reply:');
  if (message) {
    console.log(`Replying to msgId: ${msgId} with message: ${message}`);
    sendMessage(msgId, message);
    toggleThread(msgId);
    state.foldedReplies.delete(msgId);
    renderMessages();
  } else {
    console.log('Reply cancelled');
  }
}

function muteUser(peerId) {
  socket.emit('mute-user', state.roomId, peerId);
}

function toggleRecording() {
  const recordBtn = document.getElementById('record-btn');
  if (!stream) {
    alert('Audio stream not available. Please allow microphone access and refresh.');
    return;
  }
  if (!isRecording) {
    startRecording();
    recordBtn.textContent = 'STOP';
    recordBtn.classList.add('active');
    isRecording = true;
  } else {
    stopRecording();
    recordBtn.textContent = 'RECORD';
    recordBtn.classList.remove('active');
    isRecording = false;
  }
}

function startRecording() {
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => recordedChunks.push(event.data);
  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `REC-${Date.now()}.webm`;
    a.click();
    recordedChunks = [];
  };
  recorder.start();
}

function stopRecording() {
  recorder.stop();
}