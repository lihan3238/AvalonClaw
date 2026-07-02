# AvalonClaw Project Instructions

Canonical project instructions, readable by AGENTS.md-aware tools. `CLAUDE.md`
is a one-line `@AGENTS.md` import; edit this file for shared project memory.

lihan-cards mode: engineering

## Runtime Configuration

- OpenAI-compatible `baseURL` and `apiKey` are entered manually in the browser
  left setup rail. Do not require or deploy these as server environment values.
- The browser stores the runtime AI config locally and sends it with each
  `/api/ai-action` request to the server-side proxy.
- The model field remains a browser-side setup control; the default is
  `gpt-5.4-mini`.

## Production Deployment

- Production target: `srv998135.hstgr.cloud`
- Public app URL: `http://srv998135.hstgr.cloud:3238/`
- Production port: `3238`
- Clean deployment root: `/opt/avalon-claw`
- Release symlink: `/opt/avalon-claw/current`
- App-local Node runtime: `/opt/avalon-claw/runtime/node-v20.20.2-linux-x64`
- Preferred service name: `avalon-claw.service`
- Production command from the release directory:
  `HOST=0.0.0.0 PORT=3238 npm run prod:start`

## Development

- Local development stays on Vite bound to `127.0.0.1`; use
  `npm run dev -- --port 5241 --strictPort`.
- Before promoting a build, run `npm test -- --run` and `npm run build`.
