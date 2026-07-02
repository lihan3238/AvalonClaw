# Agent Freedom And Production Deploy Design

Date: 2026-07-02

## Goal

Keep Avalon agents constrained by game legality and information visibility, but stop using hard-coded prompt strategy and speech matching to force a preferred play style. Add a separate production runtime that serves the built app and `/api/ai-action` from `0.0.0.0` on a stable port while development stays local.

## AI Boundary

The rule engine and `getLegalActionsForPlayer` remain the source of truth for legal actions. Model output must still be valid JSON, parse into a known action shape, and match a legal action for the current state. Illegal or malformed actions still fall back so the game flow cannot break.

Public speech is no longer judged for strategic quality. The parser may normalize whitespace, clip overlong speech, replace quest-card speech, and block direct prompt-code or private-side leaks. It must not replace a model response merely because it is short, odd, strategically weak, or appears to mismatch a vote/proposal explanation.

Prompts should give agents correct current information: private role knowledge, public state, public facts, table talk, current phase, and legal actions. Prompts should not command a fixed strategy such as evil always keeping a known evil path, good always selecting public-good teams, or votes defaulting a particular way beyond legality.

## Deployment Boundary

Development remains Vite on `127.0.0.1`. Production uses a separate Node HTTP server that serves `dist/` assets and mounts the same `/api/ai-action` handler used by development. Production defaults to `HOST=0.0.0.0` and `PORT=3238`. OpenAI-compatible `baseURL` and `apiKey` are entered in the browser left rail at runtime, not deployed as server environment values.

The stable promotion flow is:

```bash
npm run test:run
npm run build
HOST=0.0.0.0 PORT=3238 npm run prod:start
```

`prod:start` must run only built assets. It must not depend on Vite dev middleware.

## Testing

Tests should prove three boundaries:

- Legal but strange speech remains model-sourced.
- Strategy-prescriptive prompt lines are absent, while legality and public/private information lines remain.
- The production server can serve `index.html` and respond through `/api/ai-action`.
