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

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing. Add it in Vercel dashboard → Settings → Environment Variables.' });
  }

  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Build conversation contents
    const contents = [
      ...history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      })),
      { role: 'user', parts: [{ text: message.trim() }] }
    ];

    sendEvent({ type: 'ready' });

    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        }
      }
    });

    let fullText = '';

    for await (const chunk of response) {
      const text = chunk.text || '';
      if (text) {
        fullText += text;
        sendEvent({ type: 'chunk', text });
      }
    }

    // Extract expression from first inline tag
    const tagMatch = fullText.match(/\[([^\]]+)\]/);
    if (tagMatch) {
      sendEvent({ type: 'expression', expression: tagMatch[1] });
    }

    // Strip ALL tags from display text
    const cleanText = fullText.replace(/\[[^\]]+\]/g, '').trim();

    sendEvent({ type: 'text', text: cleanText });
    sendEvent({ type: 'turnComplete' });
    sendEvent({ type: 'done' });

    res.end();
  } catch (error) {
    console.error('Gemini API error:', error);
    sendEvent({ type: 'error', message: error?.message || 'Failed to get response from Gemini.' });
    res.end();
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb'
    }
  }
};
