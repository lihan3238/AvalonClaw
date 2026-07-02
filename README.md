# Avalon Claw

Local first-version AI Avalon table: one browser user plays The Resistance: Avalon with AI-controlled seats through an OpenAI-compatible chat completions endpoint.

The default setup is quick-start friendly: random human seat, randomized legal roles, Chinese UI by default with an English switch, dark mode by default, and AI speech follows the selected table language.

Each local game gets a visible ID such as `AV-20260701-0A1B`. Saved games are stored in browser `localStorage`, listed on the start screen, and can be restored by clicking the saved record or entering the game ID manually. The AI endpoint is stateless: every `/api/ai-action` request carries the full game state, so separate browser windows do not share a backend game store. The UI still guards AI responses with the active game ID so an old response cannot mutate a newer restored or restarted game.

## Development

```bash
npm install
npm run dev -- --port 5241 --strictPort
```

Open `http://127.0.0.1:5241/`.

Development intentionally binds to `127.0.0.1`. It uses Vite middleware for
`/api/ai-action`.

## Production

Build a stable version and serve it from the standalone Node server:

```bash
npm run test:run
npm run build
HOST=0.0.0.0 PORT=3238 npm run prod:start
```

Open `http://127.0.0.1:3238/` locally, or `http://srv998135.hstgr.cloud:3238/`
after deploying to the production server. The production server serves `dist/`
and `/api/ai-action`; it does not
depend on Vite dev middleware. Keep development on `5241` and promote a stable
build to the production server after verification.

## Environment

Do not deploy OpenAI-compatible `baseURL` or `apiKey` values in `.env`. Enter
them in the left setup rail in the browser. The browser stores that runtime
config locally and sends it with each `/api/ai-action` request to the same
server-side proxy.

Deployment environment is only for the production server binding:

```bash
HOST=0.0.0.0
PORT=3238
```

If the model field is left unchanged, the app defaults to `gpt-5.4-mini`.

## Verification

```bash
npm test -- --run
npm run build
npm audit --audit-level=moderate
```

Rule and research references are in `docs/research/`. The generated table image is `public/avalon-table.png`. The implementation plan and first-version design are in `docs/superpowers/`.
