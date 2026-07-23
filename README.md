# Ryo Roleplay App

A deliberately lightweight roleplaying web app with:

- Gemini Live native audio replies
- Text chat and browser speech-to-text input
- Expression-based avatar animation
- Switchable CSS backgrounds and outfit tints
- A tiny Node/Express server so the Gemini API key never ships to the browser

## Security first

The key pasted into the original request is **not included**. Treat it as exposed: revoke it in Google AI Studio / Google Cloud and create a new one.

## Run

```bash
npm install
cp .env.example .env
# Edit .env and put your NEW Gemini key there
npm run dev
```

Open <http://localhost:3000>. Chrome or Edge provides the best browser speech-recognition support.

## Character: Ryo Yamada

A warm, caring teenage anime girl who genuinely cares about you. She keeps things light and fun, but drops hints of deep care through small gestures. She doesn't ask too many questions - instead, she shares thoughts, reacts naturally, and lets the conversation flow. She uses expression tags like [excited], [happy], [sad] for TTS. She's the kind of friend everyone wishes they had - supportive, fun, and genuinely interested in your life.

## Avatar expressions

The avatar uses these expression images from `public/assets/`:

- `neutral.png` - Default state
- `neutral2.png` - Second expression
- `neutral3.png` - Third expression

You can replace these with your own expression images.

## Notes

- Voice input is converted to text by the browser, then sent to Gemini Live. This keeps the frontend small.
- Gemini audio is raw 24 kHz PCM and is scheduled in the Web Audio API for gapless playback.
- The app uses `gemini-3.1-flash-live-preview`; preview model names can change, so update `server.js` if Google retires it.
- Gemini Live supports inline TTS emotion tags like `[whispers]`, `[excitedly]`, `[shouting]` etc. These are stripped from display text but kept for TTS delivery.
- Avatar expression is controlled by `[EMOTION:xxx]` tags at the end of responses.
