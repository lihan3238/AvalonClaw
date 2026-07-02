# Avalon Research Notes

Last updated: 2026-07-01.

## Local Source Copies

- `docs/research/sources/the-resistance-avalon-rules.pdf` - downloaded rulebook copy from `https://avalon.fun/pdfs/rules.pdf`. The PDF is an image scan, so extracted text is not reliable.
- `docs/research/sources/indie-boards-the-resistance-avalon.html` - local copy of the Indie Boards and Cards product page.
- `docs/research/sources/indie-boards-avalon-big-box.html` - local copy of the Indie Boards and Cards Avalon Big Box page.
- `docs/research/sources/avalonbench-2310.05036.pdf` - AvalonBench paper from arXiv `2310.05036`.
- `docs/research/sources/llm-agent-society-avalon-2310.14985.pdf` - LLM-based Avalon agent society paper from arXiv `2310.14985`.

## External Sources Used

- Indie Boards and Cards product page: `https://indieboardsandcards.com/our-games/the-resistance-avalon/`
- Indie Boards and Cards Avalon Big Box page: `https://indieboardsandcards.com/our-games/avalon-big-box/`
- OpenAI Chat Completions API reference: `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/`
- OpenAI reasoning guide: `https://developers.openai.com/api/docs/guides/reasoning`
- OpenAI prompt caching guide: `https://developers.openai.com/api/docs/guides/prompt-caching`
- OpenAI structured outputs guide: `https://developers.openai.com/api/docs/guides/structured-outputs`
- Avalon online rulebook mirror: `https://avalon.fun/pdfs/rules.pdf`
- Dized rules, game end and winning: `https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/K_MlLyWiS_yuZsA5erj9nA/game-end-and-winning`
- Dized rules, discussion and secret information: `https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/wSUXl7DMRYChqUEfD0eXUQ/discussion-and-secret-information`
- Dized rules, casting votes: `https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/CHJOFZ5YTo-uqMwKaxtIzw/casting-votes`
- Dized rules, result of voting: `https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/V3eSkuHJSIi-qfEWDXPTAw/result-of-voting`
- BoardGameGeek rules discussion quoting Assassin card wording: `https://boardgamegeek.com/thread/1210990/two-rule-questions-additional-roles-and-assassin-c`
- BoardGames StackExchange endgame answer quoting the same rulebook wording: `https://boardgames.stackexchange.com/questions/21425/end-of-game-questions`
- BoardGameGeek strategy threads:
  - `https://boardgamegeek.com/thread/1433790/avalon-strategy-guide`
  - `https://boardgamegeek.com/thread/2190616/avalon-strategy-deep-dive`
  - `https://boardgamegeek.com/thread/894136/strategy-for-merlin-in-a-5-player-game`
  - `https://boardgamegeek.com/thread/1716215/is-percys-revealing-policy-good-strategy-if-it-is`
- Reddit discussion used as a community sanity check: `https://www.reddit.com/r/boardgames/comments/19v662/game_of_the_week_the_resistance/`

## Rule Facts To Encode

- Player count: 5-10.
- Teams: Good and Evil. Good needs three successful quests. Evil wins if three quests fail, five consecutive team proposals are rejected, or Assassin identifies Merlin after three successful quests.
- Team proposal flow: current leader proposes a quest team of exact required size, all players publicly vote approve/reject, strict majority approves.
- Discussion/speech order: the rulebook only requires "appropriate discussion" before the leader calls for the team vote; it does not require one fixed clockwise speech round, nor a separate mandatory speech phase before team selection.
- Quest flow: selected team members secretly submit success/fail. Good roles must submit success. Evil roles may submit success or fail. One fail fails most quests; in 7-10 player games, quest 4 requires two fail cards.
- Vote track interpretation: Evil wins after five consecutive rejected team votes in one round. Some online Avalon variants describe the fifth leader as choosing without a vote; this project follows the original Avalon rulebook/Dized wording.
- Assassination interpretation: after three successful quests, the Assassin names one Good player as Merlin. The legal target list excludes Evil players, including hidden Evil roles such as Oberon.
- Quest team sizes:

| Players | Q1 | Q2 | Q3 | Q4 | Q5 | Q4 Fail Cards |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 2 | 3 | 2 | 3 | 3 | 1 |
| 6 | 2 | 3 | 4 | 3 | 4 | 1 |
| 7 | 2 | 3 | 3 | 4 | 4 | 2 |
| 8 | 3 | 4 | 4 | 5 | 5 | 2 |
| 9 | 3 | 4 | 4 | 5 | 5 | 2 |
| 10 | 3 | 4 | 4 | 5 | 5 | 2 |

## Role Knowledge Model

- Merlin is Good and sees Evil players except Mordred.
- Percival is Good and sees Merlin and Morgana as ambiguous Merlin candidates.
- Loyal Servants have no private role knowledge.
- Assassin, Morgana, Mordred, and ordinary Minions know Evil teammates, except Oberon does not know or appear to other Evil players.
- Mordred is hidden from Merlin.
- Morgana appears to Percival as a possible Merlin.

## Prompting Lessons

- AvalonBench frames Avalon as a language-heavy hidden-information game requiring deduction, coordination, persuasion, and deception. The prompt should force each AI to use legal actions grounded in public history, not private omniscience.
- The 2024 LLM-agent paper emphasizes memory, analysis, planning, action generation, and experience updates. First version implements a compact per-action prompt with: public history, private role knowledge, a role strategy brief, legal action schema, and an output-only JSON contract.
- AvalonBench used a separate parser LLM to reach reliable action extraction in pilot tests. This project keeps parser work local instead: compact JSON aliases, compatibility only for raw observed shapes, and a hard legal-action gate after parsing. This avoids an extra model call per action.
- Both AvalonBench and the 2024 agent-society paper identify history growth as a token and reasoning problem. Current implementation keeps resolved quest/vote history structured, includes only recent table talk with explicit chronological order, and avoids replaying full rule text every action.
- OpenAI prompt-caching guidance favors stable repeated prefixes. Keep invariant agent rules in the stable system message; keep dynamic game state in the user message. Do not add per-player prose to the system message.
- OpenAI structured outputs are preferred for strict schema enforcement when a provider supports them. The current Chat Completions path keeps `json_object` for OpenAI-compatible provider breadth, then enforces the action schema and legal-action list locally.
- `reasoning_effort` is an explicit cost/latency lever. Use high effort for expensive strategic seats or real evaluation scenarios, low effort for weak-agent simulations, and skip the API entirely when the action is deterministic, such as a Good player with only `quest:success` legal.
- Community strategy discussions converge on the same practical constraints:
  - Merlin must guide without making the Assassin's job easy.
  - Percival and Loyal Servants should sometimes create cover for Merlin.
  - Evil players should not sabotage mechanically every time; they need plausible timing and voting patterns.
  - A good AI player needs variation in temperament and risk tolerance, otherwise table talk becomes repetitive and predictable.

## Implementation Decisions

- Keep the rule engine deterministic and fully local. The LLM never changes rules directly; it only proposes actions from a legal action list.
- Keep OpenAI-compatible calls on the local Node/Vite server side. The browser owns the user-entered `baseURL` and `apiKey` runtime config and sends it with each `/api/ai-action` request; deployment does not provide `OPENAI_API_KEY`.
- Default to Chat Completions for broad compatibility with OpenAI-compatible providers, while passing `reasoning_effort` when configured and retrying without it if the provider rejects that parameter.
- Expose a UI control for thinking strength. It changes both the prompt budget instructions and the API reasoning effort value.
- Validate every AI response. If the response is malformed, illegal, too slow, or unavailable, use a local heuristic fallback and record that fallback in the table log.
