# Avalon Research Notes

Last updated: 2026-06-30.

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
- Quest flow: selected team members secretly submit success/fail. Good roles must submit success. Evil roles may submit success or fail. One fail fails most quests; in 7-10 player games, quest 4 requires two fail cards.
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
- Community strategy discussions converge on the same practical constraints:
  - Merlin must guide without making the Assassin's job easy.
  - Percival and Loyal Servants should sometimes create cover for Merlin.
  - Evil players should not sabotage mechanically every time; they need plausible timing and voting patterns.
  - A good AI player needs variation in temperament and risk tolerance, otherwise table talk becomes repetitive and predictable.

## Implementation Decisions

- Keep the rule engine deterministic and fully local. The LLM never changes rules directly; it only proposes actions from a legal action list.
- Keep OpenAI-compatible calls on the local Node/Vite server side. The browser never receives `OPENAI_API_KEY`.
- Default to Chat Completions for broad compatibility with OpenAI-compatible providers, while passing `reasoning_effort` when configured and retrying without it if the provider rejects that parameter.
- Expose a UI control for thinking strength. It changes both the prompt budget instructions and the API reasoning effort value.
- Validate every AI response. If the response is malformed, illegal, too slow, or unavailable, use a local heuristic fallback and record that fallback in the table log.
