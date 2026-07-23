const $ = (s) => document.querySelector(s);
const messages = $('#messages');
const avatar = $('#avatar');
const avatarImage = $('#avatarImage');
const status = $('#status');
const voiceToggle = $('#voiceToggle');
const talkBtn = $('#talkBtn');
const muteBtn = $('#muteBtn');
const liveModeBtn = $('#liveModeBtn');
const pushModeBtn = $('#pushModeBtn');
const soundOnIcon = $('#soundOnIcon');
const soundOffIcon = $('#soundOffIcon');
const hintText = $('#hintText');
const silenceTimeoutSelect = $('#silenceTimeout');
const messageInput = $('#messageInput');

const mouthFrames = ['assets/neutral.png', 'assets/neutral2.png', 'assets/neutral3.png'];
const expressionMap = {
  'giggle': 'assets/neutral2.png', 'laughs': 'assets/neutral2.png',
  'sighs': 'assets/neutral3.png', 'gasp': 'assets/neutral.png',
  'crying': 'assets/neutral3.png', 'whispers': 'assets/neutral.png',
  'shouting': 'assets/neutral.png', 'excitedly': 'assets/neutral2.png',
  'bored': 'assets/neutral3.png', 'reluctantly': 'assets/neutral3.png',
  'amazed': 'assets/neutral.png', 'curious': 'assets/neutral.png',
  'excited': 'assets/neutral2.png', 'mischievously': 'assets/neutral2.png',
  'panicked': 'assets/neutral.png', 'sarcastic': 'assets/neutral3.png',
  'serious': 'assets/neutral.png', 'tired': 'assets/neutral3.png',
  'trembling': 'assets/neutral3.png', 'very fast': 'assets/neutral2.png',
  'very slow': 'assets/neutral3.png', 'sarcastically': 'assets/neutral3.png',
  'with love': 'assets/neutral2.png', 'with attitude': 'assets/neutral.png',
  'monotone': 'assets/neutral.png', 'dramatically': 'assets/neutral.png',
  'softly': 'assets/neutral.png', 'gently': 'assets/neutral2.png',
  'loudly': 'assets/neutral.png', 'quickly': 'assets/neutral2.png',
  'slowly': 'assets/neutral3.png', 'happily': 'assets/neutral2.png',
  'sadly': 'assets/neutral3.png', 'angrily': 'assets/neutral.png',
  'worried': 'assets/neutral3.png', 'playfully': 'assets/neutral2.png',
  'teasing': 'assets/neutral2.png', 'proudly': 'assets/neutral2.png',
  'embarrassed': 'assets/neutral3.png', 'nervously': 'assets/neutral3.png',
  'confidently': 'assets/neutral2.png', 'shyly': 'assets/neutral3.png'
};

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// ── State ──
let socket, frameTimer, audioContext, playhead = 0;
let isMuted = false;
let outputGain = null;
let voiceMode = 'live';
let ryoBubble = null;

// Push-to-talk state
let pushActive = false;
let pushMediaStream = null;
let pushAudioCtx = null;
let pushProcessor = null;
let pushAnalyser = null;
let pushChunks = [];
let pushAnimFrame = null;
let pushRec = null;
let pushRecText = '';

// Live mode state (VAD-based)
let liveActive = false;
let liveMediaStream = null;
let liveAudioCtx = null;
let liveProcessor = null;
let liveVadBuffer = [];
let liveSilenceStart = 0;
let liveSpeaking = false;
let liveVoiceStart = 0;
let liveVoiceConfirmed = false;
let liveCooldown = 0;
let liveRec = null;
let liveRecText = '';

// ── VAD Tuning ──
const VAD_VOICE_THRESHOLD = 0.04;
const VAD_CONTINUE_THRESHOLD = 0.025;
const VAD_MIN_SPEECH_MS = 400;
const VAD_MIN_AUDIO_SAMPLES = 16000;
const VAD_COOLDOWN_MS = 1500;

// ── Session (single infinite conversation) ──
// gemini-3.1-flash-live-preview has a 1M token context window (~4M chars)
const STORAGE_KEY = 'ryo_session';
const MAX_CHARS = 4000000;
let sessionMessages = [];

function loadSession() {
  try { sessionMessages = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { sessionMessages = []; }
}

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionMessages));
}

function getSessionChars() {
  let total = 0;
  for (const m of sessionMessages) total += (m.text || '').length;
  return total;
}

function updateContextBar() {
  const bar = $('#contextBar');
  const label = $('#contextText');
  if (!bar || !label) return;
  const used = getSessionChars();
  const pct = Math.min(100, (used / MAX_CHARS) * 100);
  bar.style.width = pct + '%';
  bar.className = 'context-bar-fill' + (pct > 80 ? ' full' : pct > 60 ? ' high' : pct > 40 ? ' mid' : '');
  const usedK = (used / 1000).toFixed(1);
  const maxK = (MAX_CHARS / 1000).toFixed(0);
  label.textContent = `${usedK}k / ${maxK}k chars`;
}

function trimSession() {
  if (sessionMessages.length <= 6) return; // too few to trim
  // Keep first 2 and last 2, remove ~30% from the middle
  const head = sessionMessages.slice(0, 2);
  const tail = sessionMessages.slice(-2);
  const middle = sessionMessages.slice(2, -2);
  const removeCount = Math.max(1, Math.floor(middle.length * 0.3));
  // Remove from the oldest part of the middle
  const trimmed = middle.slice(removeCount);
  sessionMessages = [...head, ...trimmed, ...tail];
  saveSession();
  renderSession();
  updateContextBar();
}

function clearSession() {
  sessionMessages = [];
  saveSession();
  renderSession();
  updateContextBar();
}

function renderSession() {
  messages.innerHTML = '';
  if (sessionMessages.length === 0) {
    addBubble('...', 'ryo', false);
    return;
  }
  for (const m of sessionMessages) {
    addBubble(m.text, m.who, false);
  }
}

// ── Bubbles & Expressions ──
function addBubble(text, who, save = true) {
  const el = document.createElement('article');
  el.className = `bubble ${who}`;
  el.textContent = text;
  messages.append(el);
  messages.scrollTop = messages.scrollHeight;
  if (save && text) {
    sessionMessages.push({ text, who, time: new Date().toISOString() });
    saveSession();
    updateContextBar();
  }
  return el;
}

function setExpression(expression) {
  if (expressionMap[expression]) avatarImage.src = expressionMap[expression];
}

function animateMouth(active) {
  clearInterval(frameTimer);
  avatar.classList.toggle('talking', active);
  avatarImage.src = mouthFrames[0];
  if (active) {
    let i = 0;
    frameTimer = setInterval(() => avatarImage.src = mouthFrames[++i % mouthFrames.length], 1000);
  }
}

// ── Audio Output (Mute/Unmute) ──
function ensureAudioContext(rate) {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: rate });
    outputGain = audioContext.createGain();
    outputGain.connect(audioContext.destination);
  }
  return audioContext;
}

async function queuePcm(base64, rate) {
  const ctx = ensureAudioContext(rate);
  if (ctx.state === 'suspended') await ctx.resume();
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const pcm = new Int16Array(raw.buffer);
  const buffer = ctx.createBuffer(1, pcm.length, rate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(outputGain);
  playhead = Math.max(playhead, ctx.currentTime + .03);
  source.start(playhead);
  playhead += buffer.duration;
  animateMouth(true);
}

function setMuted(muted) {
  isMuted = muted;
  if (outputGain) outputGain.gain.value = muted ? 0 : 1;
  muteBtn.classList.toggle('muted', muted);
  soundOnIcon.style.display = muted ? 'none' : 'block';
  soundOffIcon.style.display = muted ? 'block' : 'none';
}

// ── WebSocket ──
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/live`);
  status.textContent = 'Connecting…';
  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'ready') {
      status.textContent = 'Online';
      // Replay conversation history so Gemini remembers context
      if (sessionMessages.length > 0) {
        socket.send(JSON.stringify({ type: 'history', messages: sessionMessages }));
      }
    }
    if (msg.type === 'error') { status.textContent = 'Error'; addBubble(msg.message, 'ryo'); }
    if (msg.type === 'expression') setExpression(msg.expression);
    if (msg.type === 'audio' && voiceToggle.checked) await queuePcm(msg.data, 24000);

    if (msg.type === 'text' && msg.text) {
      if (!ryoBubble) ryoBubble = addBubble('', 'ryo', false);
      ryoBubble.textContent += msg.text;
      messages.scrollTop = messages.scrollHeight;
    }
    if (msg.type === 'transcript' && msg.text) {
      if (!ryoBubble) ryoBubble = addBubble('', 'ryo', false);
      ryoBubble.textContent += msg.text;
      messages.scrollTop = messages.scrollHeight;
    }
    if (msg.type === 'turnComplete') {
      if (ryoBubble) {
        const fullText = ryoBubble.textContent.trim();
        if (fullText) {
          // Save the complete response
          sessionMessages.push({ text: fullText, who: 'ryo', time: new Date().toISOString() });
          saveSession();
          updateContextBar();
        } else {
          ryoBubble.remove();
        }
        ryoBubble = null;
      }
      const wait = Math.max(0, (playhead - (audioContext?.currentTime || 0)) * 1000);
      setTimeout(() => animateMouth(false), wait + 100);
    }
  };
  socket.onclose = () => { status.textContent = 'Offline'; setTimeout(connect, 2000); };
}

function sendText(text) {
  if (!text || socket?.readyState !== WebSocket.OPEN) return;
  addBubble(text, 'user');
  socket.send(JSON.stringify({ type: 'text', text }));
}

function sendAudio(base64) {
  if (!base64 || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'audio', data: base64, mimeType: 'audio/pcm;rate=16000' }));
}

// ── Text Input ──
$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  sendText(text);
  messageInput.value = '';
});

// ── Helpers ──
function mergePcmChunks(chunks) {
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged;
}

function pcmToBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function showUserBubble(srText) {
  const text = srText.trim();
  if (text) {
    addBubble(text, 'user');
  } else {
    addBubble('(voice message)', 'user');
  }
  messageInput.value = '';
}

function cleanupPush() {
  pushActive = false;
  talkBtn.classList.remove('recording');
  talkBtn.style.boxShadow = '';
  cancelAnimationFrame(pushAnimFrame);
  if (pushProcessor) { try { pushProcessor.disconnect(); } catch {} pushProcessor = null; }
  if (pushAudioCtx) { try { pushAudioCtx.close(); } catch {} pushAudioCtx = null; }
  if (pushMediaStream) { pushMediaStream.getTracks().forEach(t => t.stop()); pushMediaStream = null; }
  pushAnalyser = null;
  if (pushRec) { try { pushRec.stop(); } catch {} pushRec = null; }
}

function cleanupLive() {
  liveActive = false;
  liveSpeaking = false;
  liveVoiceConfirmed = false;
  liveVadBuffer = [];
  talkBtn.classList.remove('live-active', 'recording');
  if (liveProcessor) { try { liveProcessor.disconnect(); } catch {} liveProcessor = null; }
  if (liveAudioCtx) { try { liveAudioCtx.close(); } catch {} liveAudioCtx = null; }
  if (liveMediaStream) { liveMediaStream.getTracks().forEach(t => t.stop()); liveMediaStream = null; }
  if (liveRec) { try { liveRec.stop(); } catch {} liveRec = null; }
}

// ── Push to Talk ──
async function startPush() {
  if (pushActive) return;
  try {
    pushMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    hintText.textContent = 'Microphone access denied.';
    return;
  }

  pushActive = true;
  pushChunks = [];
  pushRecText = '';
  talkBtn.classList.add('recording');
  hintText.textContent = 'Recording… release to send.';

  pushAudioCtx = new AudioContext({ sampleRate: 16000 });
  const source = pushAudioCtx.createMediaStreamSource(pushMediaStream);
  pushAnalyser = pushAudioCtx.createAnalyser();
  pushAnalyser.fftSize = 512;
  source.connect(pushAnalyser);

  const processor = pushAudioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!pushActive) return;
    const input = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    pushChunks.push(pcm);
  };
  source.connect(processor);
  processor.connect(pushAudioCtx.destination);
  pushProcessor = processor;

  function updateVisual() {
    if (!pushActive || !pushAnalyser) return;
    const data = new Uint8Array(pushAnalyser.frequencyBinCount);
    pushAnalyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const intensity = Math.min(1, avg / 60);
    talkBtn.style.boxShadow = `0 0 ${20 + intensity * 30}px rgba(255, 68, 102, ${0.4 + intensity * 0.4})`;
    pushAnimFrame = requestAnimationFrame(updateVisual);
  }
  updateVisual();

  if (SR) {
    pushRec = new SR();
    pushRec.continuous = true;
    pushRec.interimResults = true;
    pushRec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      pushRecText = text;
      messageInput.value = text;
    };
    pushRec.onerror = (e) => console.warn('Push SR error:', e.error);
    pushRec.onend = () => { if (pushActive) try { pushRec.start(); } catch {} };
    try { pushRec.start(); } catch (err) { console.warn('Push SR start failed:', err); }
  }
}

function stopPush() {
  if (!pushActive) return;
  const chunks = [...pushChunks];
  const recText = pushRecText;
  cleanupPush();

  if (chunks.length > 0) {
    const merged = mergePcmChunks(chunks);
    const base64 = pcmToBase64(merged);
    if (base64.length > 100) {
      sendAudio(base64);
      showUserBubble(recText);
      hintText.textContent = 'Audio sent!';
    } else {
      hintText.textContent = 'Too short — hold longer.';
    }
    setTimeout(() => { hintText.textContent = 'Hold the mic to talk.'; }, 1500);
  }
}

// ── Live Mode (VAD-based) ──
async function startLive() {
  if (liveActive) return;
  try {
    liveMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    hintText.textContent = 'Microphone access denied.';
    return;
  }

  liveActive = true;
  liveVadBuffer = [];
  liveSilenceStart = 0;
  liveSpeaking = false;
  liveVoiceStart = 0;
  liveVoiceConfirmed = false;
  liveCooldown = 0;
  liveRecText = '';
  talkBtn.classList.add('live-active');
  hintText.textContent = 'Live mode — speak naturally, auto-sends on silence.';

  liveAudioCtx = new AudioContext({ sampleRate: 16000 });
  const source = liveAudioCtx.createMediaStreamSource(liveMediaStream);
  liveProcessor = liveAudioCtx.createScriptProcessor(4096, 1, 1);

  liveProcessor.onaudioprocess = (e) => {
    if (!liveActive) return;
    const input = e.inputBuffer.getChannelData(0);
    const now = Date.now();

    if (now < liveCooldown) return;

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    const silenceMs = parseInt(silenceTimeoutSelect.value) || 2000;
    const threshold = liveSpeaking ? VAD_CONTINUE_THRESHOLD : VAD_VOICE_THRESHOLD;

    if (rms > threshold) {
      if (!liveSpeaking) {
        liveSpeaking = true;
        liveVadBuffer = [];
        liveSilenceStart = 0;
        liveVoiceStart = now;
        liveVoiceConfirmed = false;
      }

      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      liveVadBuffer.push(pcm);

      if (!liveVoiceConfirmed && (now - liveVoiceStart) > VAD_MIN_SPEECH_MS) {
        liveVoiceConfirmed = true;
        status.textContent = 'Listening…';
        talkBtn.classList.add('recording');
      }

      liveSilenceStart = 0;
    } else if (liveSpeaking) {
      if (liveSilenceStart === 0) liveSilenceStart = now;
      if ((now - liveSilenceStart) > silenceMs) {
        liveSpeaking = false;
        talkBtn.classList.remove('recording');
        status.textContent = 'Online';

        if (liveVoiceConfirmed && liveVadBuffer.length > 0) {
          const merged = mergePcmChunks(liveVadBuffer);
          liveVadBuffer = [];

          if (merged.length >= VAD_MIN_AUDIO_SAMPLES) {
            const base64 = pcmToBase64(merged);
            if (base64.length > 100) {
              sendAudio(base64);
              showUserBubble(liveRecText);
              liveRecText = '';
              liveCooldown = Date.now() + VAD_COOLDOWN_MS;
            }
          }
        } else {
          liveVadBuffer = [];
        }

        liveVoiceConfirmed = false;
      }
    }
  };

  source.connect(liveProcessor);
  liveProcessor.connect(liveAudioCtx.destination);

  if (SR) {
    liveRec = new SR();
    liveRec.continuous = true;
    liveRec.interimResults = true;
    liveRec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      liveRecText = text;
      messageInput.value = text;
    };
    liveRec.onerror = (e) => console.warn('Live SR error:', e.error);
    liveRec.onend = () => { if (liveActive) try { liveRec.start(); } catch {} };
    try { liveRec.start(); } catch (err) { console.warn('Live SR start failed:', err); }
  }
}

function stopLive() {
  if (!liveActive) return;
  if (liveSpeaking && liveVoiceConfirmed && liveVadBuffer.length > 0) {
    const merged = mergePcmChunks(liveVadBuffer);
    if (merged.length >= VAD_MIN_AUDIO_SAMPLES) {
      const base64 = pcmToBase64(merged);
      if (base64.length > 100) {
        sendAudio(base64);
        showUserBubble(liveRecText);
        liveRecText = '';
      }
    }
  }
  if (messageInput.value.trim()) {
    addBubble(messageInput.value.trim(), 'user');
    messageInput.value = '';
  }
  cleanupLive();
  hintText.textContent = 'Click the mic to start talking, or type below.';
  status.textContent = 'Online';
}

// ── Talk Button Logic ──
talkBtn.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (voiceMode === 'push') { startPush(); }
  else { liveActive ? stopLive() : startLive(); }
});

talkBtn.addEventListener('mouseup', (e) => {
  e.preventDefault();
  if (voiceMode === 'push') stopPush();
});

talkBtn.addEventListener('mouseleave', () => {
  if (voiceMode === 'push') stopPush();
});

talkBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (voiceMode === 'push') { startPush(); }
  else { liveActive ? stopLive() : startLive(); }
});

talkBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (voiceMode === 'push') stopPush();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && voiceMode === 'push' && !pushActive) {
    e.preventDefault();
    startPush();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && voiceMode === 'push' && pushActive) {
    e.preventDefault();
    stopPush();
  }
});

// ── Mute Button ──
muteBtn.addEventListener('click', () => setMuted(!isMuted));

// ── Mode Switch ──
function setMode(mode) {
  if (liveActive) stopLive();
  if (pushActive) stopPush();
  voiceMode = mode;
  liveModeBtn.classList.toggle('active', mode === 'live');
  pushModeBtn.classList.toggle('active', mode === 'push');
  hintText.textContent = mode === 'live'
    ? 'Click the mic to start talking, or type below.'
    : 'Hold the mic to talk, or type below.';
}

liveModeBtn.addEventListener('click', () => setMode('live'));
pushModeBtn.addEventListener('click', () => setMode('push'));

// ── Settings ──
$('#settingsBtn').onclick = () => {
  updateContextBar();
  $('#settings').showModal();
};
$('#background').onchange = (e) => document.body.dataset.background = e.target.value;
$('#outfit').onchange = (e) => avatar.className = `avatar outfit-${e.target.value}`;

// Trim button
$('#trimBtn').onclick = () => {
  const before = sessionMessages.length;
  trimSession();
  const after = sessionMessages.length;
  const removed = before - after;
  if (removed > 0) {
    hintText.textContent = `Trimmed ${removed} messages.`;
    setTimeout(() => { hintText.textContent = ''; }, 3000);
  } else {
    hintText.textContent = 'Nothing to trim.';
    setTimeout(() => { hintText.textContent = ''; }, 3000);
  }
};

// Clear everything button → opens confirm dialog
$('#clearAllBtn').onclick = () => {
  const dialog = $('#confirmDialog');
  dialog.showModal();
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') {
      clearSession();
      hintText.textContent = 'Session cleared.';
      setTimeout(() => { hintText.textContent = ''; }, 3000);
    }
  }, { once: true });
};

// ── Init ──
loadSession();
renderSession();
updateContextBar();
connect();
