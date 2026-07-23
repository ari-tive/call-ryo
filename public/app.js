const $ = (s) => document.querySelector(s);
const messages = $('#messages');
const avatar = $('#avatar');
const avatarImage = $('#avatarImage');
const status = $('#status');
const voiceToggle = $('#voiceToggle');
const mouthFrames = ['assets/neutral.png','assets/neutral2.png','assets/neutral3.png'];
const expressionMap = {
  'giggle': 'assets/neutral2.png',
  'laughs': 'assets/neutral2.png',
  'sighs': 'assets/neutral3.png',
  'gasp': 'assets/neutral.png',
  'crying': 'assets/neutral3.png',
  'whispers': 'assets/neutral.png',
  'shouting': 'assets/neutral.png',
  'excitedly': 'assets/neutral2.png',
  'bored': 'assets/neutral3.png',
  'reluctantly': 'assets/neutral3.png',
  'amazed': 'assets/neutral.png',
  'curious': 'assets/neutral.png',
  'excited': 'assets/neutral2.png',
  'mischievously': 'assets/neutral2.png',
  'panicked': 'assets/neutral.png',
  'sarcastic': 'assets/neutral3.png',
  'serious': 'assets/neutral.png',
  'tired': 'assets/neutral3.png',
  'trembling': 'assets/neutral3.png',
  'very fast': 'assets/neutral2.png',
  'very slow': 'assets/neutral3.png',
  'sarcastically': 'assets/neutral3.png',
  'with love': 'assets/neutral2.png',
  'with attitude': 'assets/neutral.png',
  'monotone': 'assets/neutral.png',
  'dramatically': 'assets/neutral.png',
  'softly': 'assets/neutral.png',
  'gently': 'assets/neutral2.png',
  'loudly': 'assets/neutral.png',
  'quickly': 'assets/neutral2.png',
  'slowly': 'assets/neutral3.png',
  'happily': 'assets/neutral2.png',
  'sadly': 'assets/neutral3.png',
  'angrily': 'assets/neutral.png',
  'worried': 'assets/neutral3.png',
  'playfully': 'assets/neutral2.png',
  'teasing': 'assets/neutral2.png',
  'proudly': 'assets/neutral2.png',
  'embarrassed': 'assets/neutral3.png',
  'nervously': 'assets/neutral3.png',
  'confidently': 'assets/neutral2.png',
  'shyly': 'assets/neutral3.png'
};
let socket, frameTimer, audioContext, playhead = 0, transcript = '';

function addBubble(text, who) {
  const el = document.createElement('article');
  el.className = `bubble ${who}`;
  el.textContent = text;
  messages.append(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function setExpression(expression) {
  if (expressionMap[expression]) {
    avatarImage.src = expressionMap[expression];
  }
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

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/api/live`);
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

async function queuePcm(base64, rate) {
  audioContext ||= new AudioContext({ sampleRate: rate });
  if (audioContext.state === 'suspended') await audioContext.resume();
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const pcm = new Int16Array(raw.buffer);
  const buffer = audioContext.createBuffer(1, pcm.length, rate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  playhead = Math.max(playhead, audioContext.currentTime + .03);
  source.start(playhead);
  playhead += buffer.duration;
  animateMouth(true);
}

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text || socket?.readyState !== WebSocket.OPEN) return;
  addBubble(text, 'user');
  socket.send(JSON.stringify({ type: 'text', text }));
  input.value = '';
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => { $('#micBtn').classList.add('listening'); status.textContent = 'Listening…'; };
  recognition.onresult = (e) => $('#messageInput').value = Array.from(e.results).map(r => r[0].transcript).join('');
  recognition.onend = () => { $('#micBtn').classList.remove('listening'); status.textContent = 'Online'; if ($('#messageInput').value.trim()) $('#chatForm').requestSubmit(); };
  $('#micBtn').onclick = () => recognition.start();
} else {
  $('#micBtn').disabled = true;
  $('#micBtn').title = 'Speech recognition is not supported in this browser.';
}

$('#settingsBtn').onclick = () => $('#settings').showModal();
$('#background').onchange = (e) => document.body.dataset.background = e.target.value;
$('#outfit').onchange = (e) => avatar.className = `avatar outfit-${e.target.value}`;
connect();
