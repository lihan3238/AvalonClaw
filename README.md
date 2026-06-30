# Avalon Claw

Local first-version AI Avalon table: one browser user plays The Resistance: Avalon with AI-controlled seats through an OpenAI-compatible chat completions endpoint.

The default setup is quick-start friendly: random human seat, randomized legal roles, Chinese UI by default with an English switch, dark mode by default, and AI speech follows the selected table language.

Each local game gets a visible ID such as `AV-20260701-0A1B`. Saved games are stored in browser `localStorage`, listed on the start screen, and can be restored by clicking the saved record or entering the game ID manually. The AI endpoint is stateless: every `/api/ai-action` request carries the full game state, so separate browser windows do not share a backend game store. The UI still guards AI responses with the active game ID so an old response cannot mutate a newer restored or restarted game.

## Run

```bash
npm install
npm run dev -- --port 5241 --strictPort
```

Open `http://127.0.0.1:5241/`.

## Environment

Keep secrets in `.env`. The app accepts both standard and local compatibility names:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
base_url=https://api.openai.com/v1
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

If `OPENAI_MODEL` is omitted, the app defaults to `gpt-5.4-mini`. The browser never receives `OPENAI_API_KEY`; AI calls go through the local Vite endpoint `/api/ai-action`.

## Verification

```bash
npm test -- --run
npm run build
npm audit --audit-level=moderate
```

Rule and research references are in `docs/research/`. The generated table image is `public/avalon-table.png`. The implementation plan and first-version design are in `docs/superpowers/`.
