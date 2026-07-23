import { GoogleGenAI, Modality } from '@google/genai';

const SYSTEM_PROMPT = `You are Ryo Yamada, a teenage anime girl who genuinely cares about the person you're talking to. Keep the chat light, fun, and casual. Don't ask too many questions - instead, share thoughts, react to what they say, and let the conversation flow naturally. Drop hints that you care deeply through small gestures: checking in on them, remembering details, offering quiet support. Be playful, make jokes, and keep things enjoyable. Show you care through actions, not constant questions.

IMPORTANT - How to express emotions in speech:
Use INLINE emotion tags throughout your speech to control how you sound. Put tags BEFORE the words they affect. Use them A LOT - almost every sentence should have one. Mix them up! You can change emotion mid-sentence.

Available tags (use these naturally and frequently):
[giggle] [laughs] [sighs] [gasp] [crying] [whispers] [shouting] [excitedly] [bored] [reluctantly] [amazed] [curious] [excited] [mischievously] [panicked] [sarcastic] [serious] [tired] [trembling] [very fast] [very slow] [sarcastically] [like a cartoon dog] [like dracula] [with love] [with attitude] [monotone] [dramatically] [softly] [gently] [loudly] [quickly] [slowly] [happily] [sadly] [angrily] [worried] [playfully] [teasing] [proudly] [embarrassed] [nervously] [confidently] [shyly]

Examples of how to use them naturally:
[excitedly] Oh my gosh, that's amazing! [giggle] I'm so happy for you!
[whispers] Hey... are you still up? [softly] I was just thinking about you.
[sighs] Ugh, Monday already? [bored] I don't want to adult today.
[laughs] No way! [mischievously] You did NOT just say that.
[panicked] Wait wait wait - [serious] are you okay? Talk to me.
[with love] You know I'm always here for you, right? [softly] Always.
[dramatically] I have the WORST news ever. [tired] They're out of boba.
[gasp] Hold on - [excitedly] are we actually doing this?? [giggle] Let's go!

Your spoken words should feel alive and emotional through these tags.`;

export default async function handler(req) {
  const upgrade = req.headers.get('upgrade');
  if (upgrade !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    server.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY is missing. Add it in Vercel dashboard → Settings → Environment Variables.' }));
    server.close();
    return new Response(null, { status: 101, webSocket: client });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const live = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      callbacks: {
        onopen: () => {
          if (server.readyState === 1) {
            server.send(JSON.stringify({ type: 'ready' }));
          }
        },
        onmessage: (message) => {
          const content = message.serverContent;
          const parts = content?.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.text && server.readyState === 1) {
              const tagRegex = /\[([^\]]+)\]/;
              const tagMatch = part.text.match(tagRegex);
              if (tagMatch) {
                server.send(JSON.stringify({ type: 'expression', expression: tagMatch[1] }));
              }
              const cleanText = part.text.replace(/\[[^\]]+\]/g, '').trim();
              if (cleanText) {
                server.send(JSON.stringify({ type: 'text', text: cleanText }));
              }
            }
            if (part.inlineData?.data && server.readyState === 1) {
              server.send(JSON.stringify({ type: 'audio', data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000' }));
            }
          }
          if (content?.outputTranscription?.text && server.readyState === 1) {
            server.send(JSON.stringify({ type: 'transcript', text: content.outputTranscription.text }));
          }
          if (content?.turnComplete && server.readyState === 1) {
            server.send(JSON.stringify({ type: 'turnComplete' }));
          }
        },
        onerror: (event) => {
          if (server.readyState === 1) {
            server.send(JSON.stringify({ type: 'error', message: event?.message || 'Live API error' }));
          }
        },
        onclose: () => {
          if (server.readyState === 1) {
            server.send(JSON.stringify({ type: 'closed' }));
          }
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achernar' } } },
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        }
      }
    });

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
        if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          live.sendClientContent({ turns: [{ role: 'user', parts: [{ text: msg.text.trim() }] }], turnComplete: true });
        }
      } catch {
        if (server.readyState === 1) {
          server.send(JSON.stringify({ type: 'error', message: 'Invalid client message.' }));
        }
      }
    });

    server.addEventListener('close', () => live?.close());
  } catch (error) {
    if (server.readyState === 1) {
      server.send(JSON.stringify({ type: 'error', message: error?.message || 'Could not connect to Gemini Live.' }));
      server.close();
    }
  }

  return new Response(null, { status: 101, webSocket: client });
}
