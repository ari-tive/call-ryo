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

// ── State ──
let socket, frameTimer, audioContext, playhead = 0, transcript = '';
let isMuted = false;
let outputGain = null; // GainNode for mute/unmute
let voiceMode = 'live'; // 'live' or 'push'
let isRecording = false;
let isLiveActive = false;
let mediaStream = null;
let pushRecorder = null;
let pushAudioChunks = [];
let silenceTimer = null;
let recognition = null;
let pushAnalyser = null;
let pushAnimFrame = null;

// ── Bubbles & Expressions ──
function addBubble(text, who) {
  const el = document.createElement('article');
  el.className = `bubble ${who}`;
  el.textContent = text;
  messages.append(el);
  messages.scrollTop = messages.scrollHeight;
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
  source.connect(outputGain); // Connect through gain node
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
    if (msg.type === 'ready') status.textContent = 'Online';
    if (msg.type === 'error') { status.textContent = 'Error'; addBubble(msg.message, 'ryo'); }
    if (msg.type === 'expression') setExpression(msg.expression);
    if (msg.type === 'audio' && voiceToggle.checked) await queuePcm(msg.data, 24000);
    if (msg.type === 'transcript') transcript += msg.text;
    if (msg.type === 'text') transcript += msg.text;
    if (msg.type === 'turnComplete') {
      if (transcript.trim()) addBubble(transcript.trim(), 'ryo');
      transcript = '';
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
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text) return;
  sendText(text);
  input.value = '';
});

// ── Speech Recognition (Live Mode) ──
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function initSpeechRecognition() {
  if (!SpeechRecognition) {
    hintText.textContent = 'Speech recognition not supported — type instead.';
    return null;
  }
  const rec = new SpeechRecognition();
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    status.textContent = 'Listening…';
    talkBtn.classList.add('recording');
  };

  rec.onresult = (e) => {
    let finalText = '';
    let interimText = '';
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        finalText += e.results[i][0].transcript;
      } else {
        interimText += e.results[i][0].transcript;
      }
    }
    // Show interim in input
    $('#messageInput').value = interimText || finalText;

    if (finalText) {
      // Reset silence timer on final result
      resetSilenceTimer(finalText);
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // normal
    console.warn('Speech recognition error:', e.error);
  };

  rec.onend = () => {
    // Auto-restart if live mode is still active
    if (isLiveActive) {
      try { rec.start(); } catch {}
    } else {
      talkBtn.classList.remove('recording');
      status.textContent = 'Online';
    }
  };

  return rec;
}

function resetSilenceTimer(text) {
  clearTimeout(silenceTimer);
  const timeout = parseInt(silenceTimeoutSelect.value) || 2000;
  silenceTimer = setTimeout(() => {
    if (text && text.trim()) {
      sendText(text.trim());
      $('#messageInput').value = '';
    }
  }, timeout);
}

// ── Live Mode ──
function startLiveMode() {
  if (!recognition) recognition = initSpeechRecognition();
  if (!recognition) return;
  isLiveActive = true;
  talkBtn.classList.add('live-active');
  talkBtn.classList.remove('recording');
  hintText.textContent = 'Live mode active — speak naturally, auto-sends on silence.';
  try { recognition.start(); } catch {}
}

function stopLiveMode() {
  isLiveActive = false;
  talkBtn.classList.remove('live-active', 'recording');
  clearTimeout(silenceTimer);
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  // Send any remaining text
  const remaining = $('#messageInput').value.trim();
  if (remaining) {
    sendText(remaining);
    $('#messageInput').value = '';
  }
  hintText.textContent = 'Click the mic to start talking, or type below.';
  status.textContent = 'Online';
}

// ── Push to Talk ──
async function startPushRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
  } catch (err) {
    console.error('Mic access denied:', err);
    hintText.textContent = 'Microphone access denied. Check browser permissions.';
    return;
  }

  isRecording = true;
  talkBtn.classList.add('recording');
  hintText.textContent = 'Recording… release to send.';

  // Use ScriptProcessorNode to capture raw PCM
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(mediaStream);
  pushAnalyser = ctx.createAnalyser();
  pushAnalyser.fftSize = 512;
  source.connect(pushAnalyser);

  // Also set up ScriptProcessor for raw capture
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  pushAudioChunks = [];

  processor.onaudioprocess = (e) => {
    if (!isRecording) return;
    const inputData = e.inputBuffer.getChannelData(0);
    // Convert float32 to int16 PCM
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    pushAudioChunks.push(pcm16);
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  // Store refs for cleanup
  pushRecorder = { ctx, source, processor, stream: mediaStream };

  // Visual feedback with analyser
  updatePushVisual();
}

function updatePushVisual() {
  if (!isRecording || !pushAnalyser) return;
  const data = new Uint8Array(pushAnalyser.frequencyBinCount);
  pushAnalyser.getByteFrequencyData(data);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  // Scale talk button glow based on volume
  const intensity = Math.min(1, avg / 60);
  talkBtn.style.boxShadow = `0 0 ${20 + intensity * 30}px rgba(255, 68, 102, ${0.4 + intensity * 0.4})`;
  pushAnimFrame = requestAnimationFrame(updatePushVisual);
}

function stopPushRecording() {
  if (!isRecording) return;
  isRecording = false;
  talkBtn.classList.remove('recording');
  talkBtn.style.boxShadow = '';
  cancelAnimationFrame(pushAnimFrame);

  if (pushRecorder) {
    pushRecorder.processor.disconnect();
    pushRecorder.source.disconnect();
    pushRecorder.stream.getTracks().forEach(t => t.stop());
    pushRecorder.ctx.close();
    pushRecorder = null;
    pushAnalyser = null;
  }

  // Merge all chunks and send
  if (pushAudioChunks.length > 0) {
    const totalLength = pushAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of pushAudioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pushAudioChunks = [];

    // Convert to base64
    const bytes = new Uint8Array(merged.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    if (base64.length > 100) { // Only send if there's actual audio
      sendAudio(base64);
      hintText.textContent = 'Audio sent!';
      setTimeout(() => { hintText.textContent = 'Hold the mic to talk.'; }, 1500);
    } else {
      hintText.textContent = 'Too short — hold longer.';
      setTimeout(() => { hintText.textContent = 'Hold the mic to talk.'; }, 1500);
    }
  }
}

// ── Talk Button Logic ──
talkBtn.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (voiceMode === 'push') {
    startPushRecording();
  } else {
    // Live mode: toggle
    if (isLiveActive) {
      stopLiveMode();
    } else {
      startLiveMode();
    }
  }
});

talkBtn.addEventListener('mouseup', (e) => {
  e.preventDefault();
  if (voiceMode === 'push' && isRecording) {
    stopPushRecording();
  }
});

talkBtn.addEventListener('mouseleave', (e) => {
  if (voiceMode === 'push' && isRecording) {
    stopPushRecording();
  }
});

// Touch events for mobile
talkBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (voiceMode === 'push') {
    startPushRecording();
  } else {
    if (isLiveActive) {
      stopLiveMode();
    } else {
      startLiveMode();
    }
  }
});

talkBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (voiceMode === 'push' && isRecording) {
    stopPushRecording();
  }
});

// Keyboard: spacebar for push-to-talk
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && voiceMode === 'push' && !isRecording) {
    e.preventDefault();
    startPushRecording();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && voiceMode === 'push' && isRecording) {
    e.preventDefault();
    stopPushRecording();
  }
});

// ── Mute Button ──
muteBtn.addEventListener('click', () => setMuted(!isMuted));

// ── Mode Switch ──
function setMode(mode) {
  // Stop any active recording first
  if (isLiveActive) stopLiveMode();
  if (isRecording) stopPushRecording();

  voiceMode = mode;
  liveModeBtn.classList.toggle('active', mode === 'live');
  pushModeBtn.classList.toggle('active', mode === 'push');

  if (mode === 'live') {
    hintText.textContent = 'Click the mic to start talking, or type below.';
  } else {
    hintText.textContent = 'Hold the mic to talk, or type below.';
  }
}

liveModeBtn.addEventListener('click', () => setMode('live'));
pushModeBtn.addEventListener('click', () => setMode('push'));

// ── Settings ──
$('#settingsBtn').onclick = () => $('#settings').showModal();
$('#background').onchange = (e) => document.body.dataset.background = e.target.value;
$('#outfit').onchange = (e) => avatar.className = `avatar outfit-${e.target.value}`;

// ── Init ──
connect();
