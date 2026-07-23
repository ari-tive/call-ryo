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

let frameTimer, audioContext, playhead = 0;
let chatHistory = [];
let isGenerating = false;

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

async function sendMessage(text) {
  if (isGenerating || !text.trim()) return;

  isGenerating = true;
  status.textContent = 'Thinking...';
  addBubble(text, 'user');

  // Add to history
  chatHistory.push({ role: 'user', text: text.trim() });

  // Keep history manageable (last 20 messages)
  if (chatHistory.length > 20) {
    chatHistory = chatHistory.slice(-20);
  }

  const input = $('#messageInput');
  input.value = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text.trim(),
        history: chatHistory.slice(0, -1) // Don't include current message in history
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'ready') {
              status.textContent = 'Online';
            }

            if (data.type === 'chunk') {
              fullText += data.text;
              animateMouth(true);
            }

            if (data.type === 'expression') {
              setExpression(data.expression);
            }

            if (data.type === 'text') {
              // Add the final clean text as a bubble
              if (data.text && data.text.trim()) {
                addBubble(data.text.trim(), 'ryo');
                chatHistory.push({ role: 'model', text: data.text.trim() });
              }
            }

            if (data.type === 'turnComplete') {
              animateMouth(false);
            }

            if (data.type === 'error') {
              status.textContent = 'Error';
              addBubble(data.message, 'ryo');
            }

            if (data.type === 'done') {
              status.textContent = 'Online';
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Send failed:', error);
    status.textContent = 'Error';
    addBubble('Oops! Something went wrong. Please try again.', 'ryo');
  } finally {
    isGenerating = false;
    animateMouth(false);
    status.textContent = 'Online';
  }
}

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#messageInput');
  const text = input.value.trim();
  if (text) sendMessage(text);
});

// Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => { $('#micBtn').classList.add('listening'); status.textContent = 'Listening...'; };
  recognition.onresult = (e) => $('#messageInput').value = Array.from(e.results).map(r => r[0].transcript).join('');
  recognition.onend = () => { $('#micBtn').classList.remove('listening'); status.textContent = 'Online'; if ($('#messageInput').value.trim()) $('#chatForm').requestSubmit(); };
  $('#micBtn').onclick = () => recognition.start();
} else {
  $('#micBtn').disabled = true;
  $('#micBtn').title = 'Speech recognition is not supported in this browser.';
}

// Settings
$('#settingsBtn').onclick = () => $('#settings').showModal();
$('#background').onchange = (e) => document.body.dataset.background = e.target.value;
$('#outfit').onchange = (e) => avatar.className = `avatar outfit-${e.target.value}`;

// Initial status
status.textContent = 'Online';
