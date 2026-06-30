# AI Avalon Design

Date: 2026-06-30

## Goal

Build a first playable local AI Avalon app: one human at the same browser and several AI-controlled players can play a complete The Resistance: Avalon game with legal role knowledge, team proposals, votes, quests, assassination, table talk, OpenAI-compatible AI calls, and a professional compact frontend.

The user's "开工吧" objective is treated as approval for this first-version design.

## Scope

Version 1 supports 5-10 players, one local human, AI seats for all other players, the core Avalon flow, and common special roles: Merlin, Percival, Loyal Servant, Assassin, Morgana, Mordred, Oberon, and Minion of Mordred. It does not implement expansions such as Lancelot, Excalibur, plot cards, Sorcerers, Rogues, or online multiplayer.

## Architecture

- `src/game/*` contains a deterministic rule engine and pure helpers. It owns roles, visibility, legal actions, transitions, and win conditions.
- `src/ai/*` contains shared AI action types, prompt construction, response parsing, and fallback strategy.
- `server/*` contains local-only OpenAI-compatible API integration and Vite dev API endpoints. It reads `.env`, never exposes secrets to the client, and retries without unsupported reasoning parameters.
- `src/components/*` and `src/App.tsx` render the playable table, controls, history, role panel, and settings.

## Data Flow

The browser holds current game state in React. When an AI seat must act, the browser sends sanitized game state, action type, player id, model, and reasoning effort to `/api/ai-action`. The server rebuilds the AI prompt with private knowledge for that player, calls the configured OpenAI-compatible endpoint, validates JSON, and returns a legal action or a fallback action. The browser applies the action through the rule engine.

## AI Player Design

Each AI has a stable persona vector: caution, aggression, talkativeness, trust bias, and deception comfort. These values influence prompts and fallback choices but do not override legal rules. The prompt asks for concise public table talk plus a JSON action. It forbids leaking hidden information as certainty unless the role would plausibly infer it from public evidence.

The prompt separates:

- Immutable rules.
- Private role knowledge.
- Public history.
- Current legal action options.
- Role strategy brief.
- Output schema.

## Error Handling

- Missing API config: use heuristic fallback and show an API status badge.
- Network/API error: retry once without `reasoning_effort`, then fallback.
- Invalid JSON: extract the first JSON object if possible, validate, then fallback.
- Illegal action: replace with fallback legal action and log the correction.
- Human illegal input: disable impossible controls and show concise inline feedback.

## Frontend Design

The first screen is the game tool itself, not a landing page. The layout uses a restrained dashboard: left role/controls rail, central table and current decision area, right event log and vote/quest track. Colors distinguish Good/Evil only where the human is allowed to know them. Hidden roles remain visually neutral in public table views.

Controls use familiar components: toggles for binary settings, sliders/selects for player count and thinking strength, icon buttons for restart/settings/log collapse, and compact player chips for team selection.

## Testing

- Unit tests cover quest tables, role assignment counts, role visibility, vote thresholds, quest fail thresholds, assassination, five rejected proposals, prompt redaction, AI JSON parsing, and fallback legality.
- UI tests cover starting a game, selecting a legal team as human leader, voting, and rendering a terminal game result.
- Verification commands: `npm test`, `npm run build`, and a local dev-server smoke test.
