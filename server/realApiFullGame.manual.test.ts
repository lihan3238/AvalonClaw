import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { createAiActionResult } from "./aiEndpoint";
import { hasUsableOpenAIConfig, readOpenAIConfigFromEnv } from "./env";
import { getLegalActionsForPlayer } from "../src/game/legalActions";
import {
  assassinateMerlin,
  castVote,
  createInitialGame,
  getFailedQuestCount,
  getSuccessfulQuestCount,
  proposeTeam,
  submitQuestCard
} from "../src/game/rules";
import type { AiActionKind, LegalAction, ReasoningEffort, TableLanguage } from "../src/ai/types";
import type { GameState } from "../src/game/types";

dotenv.config();

const runRealApi = process.env.AVALON_REAL_API_GAMES === "1";
const maybeDescribe = runRealApi ? describe : describe.skip;
const realApiTimeoutMs = readPositiveInt("AVALON_REAL_API_TIMEOUT_MS", 1_800_000);

interface TraceEntry {
  step: number;
  phase: GameState["phase"];
  quest: number;
  playerId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  actionKind: AiActionKind;
  source: "model" | "fallback";
  modelTier: ModelTier;
  action: LegalAction;
  speech: string;
}

type RealApiScenario = "uniform" | "all-strong" | "all-weak" | "random" | "strong-human-vs-weak-ai" | "weak-human-vs-strong-ai";
type ModelTier = "strong" | "weak" | "uniform";

interface ScenarioConfig {
  strongModel: string;
  weakModel: string;
  uniformModel: string;
  strongReasoningEffort: ReasoningEffort;
  weakReasoningEffort: ReasoningEffort;
  uniformReasoningEffort: ReasoningEffort;
}

maybeDescribe("manual real API full-game smoke", () => {
  it("plays complete Avalon games through the OpenAI-compatible endpoint", async () => {
    const config = readOpenAIConfigFromEnv();
    expect(hasUsableOpenAIConfig(config)).toBe(true);

    const games = readPositiveInt("AVALON_REAL_API_GAME_COUNT", 1);
    const playerCount = readPositiveInt("AVALON_REAL_API_PLAYER_COUNT", 5);
    const language = readLanguage();
    const scenarioConfig = readScenarioConfig(config.model);
    const scenarios = readScenarios();
    const includeTrace = process.env.AVALON_REAL_API_INCLUDE_TRACE !== "0";
    const streamSteps = process.env.AVALON_REAL_API_STREAM === "1";
    const maxSteps = readPositiveInt("AVALON_REAL_API_MAX_STEPS", 180);
    const baseSeed = readPositiveInt("AVALON_REAL_API_SEED", Date.now() % 1_000_000);

    for (const scenario of scenarios) {
      for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
        const seed = baseSeed + gameIndex;
        const humanSeat = readHumanSeat(playerCount, seed);
        const result = await playRealApiGame({
          playerCount,
          seed,
          humanSeat,
          scenario,
          scenarioConfig,
          language,
          maxSteps,
          streamSteps
        });

        expect(result.final.phase).toBe("gameOver");
        expect(result.final.winner).toMatch(/good|evil/);
        expect(result.steps).toBeLessThan(180);

        const fallbackCount = result.trace.filter((entry) => entry.source === "fallback").length;
        const simulatedUser = result.final.players[humanSeat];
        const simulatedUserWon = result.final.winner === simulatedUser.allegiance;
        const modelAssignments = result.final.players.map((player) => ({
          playerId: player.id,
          seat: player.seat,
          role: player.role,
          allegiance: player.allegiance,
          isSimulatedUser: player.id === simulatedUser.id,
          ...modelProfileForPlayer(scenario, scenarioConfig, simulatedUser.id, player.id, seed)
        }));
        process.stdout.write(`\nAVALON_REAL_API_RESULT ${JSON.stringify({
          scenario,
          game: gameIndex + 1,
          playerCount,
          seed,
          simulatedUserId: simulatedUser.id,
          simulatedUserSeat: humanSeat,
          simulatedUserRole: simulatedUser.role,
          simulatedUserAllegiance: simulatedUser.allegiance,
          simulatedUserWon,
          expectedDirection: scenarioExpectation(scenario),
          strongModel: scenarioConfig.strongModel,
          weakModel: scenarioConfig.weakModel,
          uniformModel: scenarioConfig.uniformModel,
          modelAssignments,
          winner: result.final.winner,
          winReason: result.final.winReason,
          successes: getSuccessfulQuestCount(result.final),
          failures: getFailedQuestCount(result.final),
          steps: result.steps,
          modelActions: result.trace.length - fallbackCount,
          fallbackCount,
          trace: includeTrace ? result.trace : undefined
        })}\n`);
      }
    }
  }, realApiTimeoutMs);
});

async function playRealApiGame(input: {
  playerCount: number;
  seed: number;
  humanSeat: number;
  scenario: RealApiScenario;
  scenarioConfig: ScenarioConfig;
  language: TableLanguage;
  maxSteps: number;
  streamSteps: boolean;
}): Promise<{ final: GameState; steps: number; trace: TraceEntry[] }> {
  let state = createInitialGame({
    playerCount: input.playerCount,
    humanSeat: input.humanSeat,
    seed: input.seed
  });
  const trace: TraceEntry[] = [];

  for (let step = 0; step < input.maxSteps; step += 1) {
    if (state.phase === "gameOver") {
      return { final: state, steps: step, trace };
    }

    const next = getNextAutoplayAction(state);
    const playerProfile = modelProfileForPlayer(input.scenario, input.scenarioConfig, state.players[input.humanSeat].id, next.playerId, input.seed);
    const legalActions = getLegalActionsForPlayer(state, next.playerId, next.actionKind);
    const decision = await createAiActionResult({
      body: {
        state,
        playerId: next.playerId,
        actionKind: next.actionKind,
        legalActions,
        reasoningEffort: playerProfile.reasoningEffort,
        language: input.language,
        model: playerProfile.model
      }
    });

    const traceEntry: TraceEntry = {
      step,
      phase: state.phase,
      quest: state.questIndex + 1,
      playerId: next.playerId,
      model: playerProfile.model,
      reasoningEffort: playerProfile.reasoningEffort,
      modelTier: playerProfile.modelTier,
      actionKind: next.actionKind,
      source: decision.source,
      action: decision.action,
      speech: decision.speech
    };
    trace.push(traceEntry);
    if (input.streamSteps) {
      process.stdout.write(`\nAVALON_REAL_API_STEP ${JSON.stringify(traceEntry)}\n`);
    }
    state = applyLegalAction(state, next.playerId, decision.action);
  }

  throw new Error(`Real API game did not finish within ${input.maxSteps} actions for ${input.playerCount} players, seed ${input.seed}`);
}

function getNextAutoplayAction(state: GameState): { playerId: string; actionKind: AiActionKind } {
  if (state.phase === "proposal") {
    return { playerId: state.players[state.leaderIndex].id, actionKind: "proposeTeam" };
  }
  if (state.phase === "voting") {
    const voter = state.players.find((player) => !state.votes[player.id]);
    if (!voter) {
      throw new Error("Voting phase has no remaining voter");
    }
    return { playerId: voter.id, actionKind: "vote" };
  }
  if (state.phase === "quest") {
    const quester = state.players.find((player) => state.proposal?.teamIds.includes(player.id) && !state.questCards[player.id]);
    if (!quester) {
      throw new Error("Quest phase has no remaining quester");
    }
    return { playerId: quester.id, actionKind: "quest" };
  }

  const assassin = state.players.find((player) => player.role === "assassin");
  if (!assassin) {
    throw new Error("Assassination phase requires an Assassin");
  }
  return { playerId: assassin.id, actionKind: "assassinate" };
}

function applyLegalAction(state: GameState, playerId: string, action: LegalAction): GameState {
  if (action.type === "proposeTeam") {
    return proposeTeam(state, playerId, action.teamIds);
  }
  if (action.type === "vote") {
    return castVote(state, playerId, action.approve);
  }
  if (action.type === "quest") {
    return submitQuestCard(state, playerId, action.card);
  }
  return assassinateMerlin(state, playerId, action.targetId);
}

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readReasoningEffort(name: string, fallback: ReasoningEffort): ReasoningEffort {
  const value = process.env[name];
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return fallback;
}

function readScenarios(): RealApiScenario[] {
  const raw = process.env.AVALON_REAL_API_SCENARIOS ?? process.env.AVALON_REAL_API_SCENARIO ?? "uniform";
  const scenarios = raw.split(",").map((value) => value.trim()).filter(isRealApiScenario);
  return scenarios.length ? scenarios : ["uniform"];
}

function isRealApiScenario(value: string): value is RealApiScenario {
  return value === "uniform"
    || value === "all-strong"
    || value === "all-weak"
    || value === "random"
    || value === "strong-human-vs-weak-ai"
    || value === "weak-human-vs-strong-ai";
}

function readScenarioConfig(defaultModel: string): ScenarioConfig {
  const uniformModel = process.env.AVALON_REAL_API_MODEL?.trim() || defaultModel;
  return {
    strongModel: process.env.AVALON_REAL_API_STRONG_MODEL?.trim() || uniformModel,
    weakModel: process.env.AVALON_REAL_API_WEAK_MODEL?.trim() || uniformModel,
    uniformModel,
    strongReasoningEffort: readReasoningEffort("AVALON_REAL_API_STRONG_REASONING_EFFORT", "high"),
    weakReasoningEffort: readReasoningEffort("AVALON_REAL_API_WEAK_REASONING_EFFORT", "low"),
    uniformReasoningEffort: readReasoningEffort("AVALON_REAL_API_REASONING_EFFORT", "low")
  };
}

function readHumanSeat(playerCount: number, seed: number): number {
  const raw = process.env.AVALON_REAL_API_HUMAN_SEAT;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < playerCount ? parsed : seed % playerCount;
}

function modelProfileForPlayer(
  scenario: RealApiScenario,
  config: ScenarioConfig,
  simulatedUserId: string,
  playerId: string,
  seed: number
): { model: string; reasoningEffort: ReasoningEffort; modelTier: ModelTier } {
  if (scenario === "all-strong") {
    return { model: config.strongModel, reasoningEffort: config.strongReasoningEffort, modelTier: "strong" };
  }
  if (scenario === "all-weak") {
    return { model: config.weakModel, reasoningEffort: config.weakReasoningEffort, modelTier: "weak" };
  }
  if (scenario === "random") {
    return seededTier(seed, playerId) === "strong"
      ? { model: config.strongModel, reasoningEffort: config.strongReasoningEffort, modelTier: "strong" }
      : { model: config.weakModel, reasoningEffort: config.weakReasoningEffort, modelTier: "weak" };
  }
  if (scenario === "strong-human-vs-weak-ai") {
    return playerId === simulatedUserId
      ? { model: config.strongModel, reasoningEffort: config.strongReasoningEffort, modelTier: "strong" }
      : { model: config.weakModel, reasoningEffort: config.weakReasoningEffort, modelTier: "weak" };
  }
  if (scenario === "weak-human-vs-strong-ai") {
    return playerId === simulatedUserId
      ? { model: config.weakModel, reasoningEffort: config.weakReasoningEffort, modelTier: "weak" }
      : { model: config.strongModel, reasoningEffort: config.strongReasoningEffort, modelTier: "strong" };
  }

  return { model: config.uniformModel, reasoningEffort: config.uniformReasoningEffort, modelTier: "uniform" };
}

function scenarioExpectation(scenario: RealApiScenario): string {
  if (scenario === "strong-human-vs-weak-ai") {
    return "simulated user should trend toward wins across repeated games";
  }
  if (scenario === "weak-human-vs-strong-ai") {
    return "simulated user should trend toward losses across repeated games";
  }
  if (scenario === "all-strong") {
    return "all seats use the strong model; expect stronger table-level play and low fallback";
  }
  if (scenario === "all-weak") {
    return "all seats use the weak model; expect lower-quality play but full rules compliance";
  }
  if (scenario === "random") {
    return "strong and weak models are assigned per seat by seed for mixed-table robustness";
  }
  return "baseline full-table model compliance and flow";
}

function seededTier(seed: number, playerId: string): Exclude<ModelTier, "uniform"> {
  let hash = seed >>> 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash ^= playerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash % 2 === 0 ? "strong" : "weak";
}

function readLanguage(): TableLanguage {
  return process.env.AVALON_REAL_API_LANGUAGE === "zh" ? "zh" : "en";
}
