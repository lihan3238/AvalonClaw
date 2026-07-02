import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { createAiActionResult, effectiveReasoningEffortForAction } from "./aiEndpoint";
import { hasUsableOpenAIConfig, readOpenAIConfigFromEnv } from "./env";
import { appendRealApiResultJsonl, auditRealApiGame, summarizeRealApiTrace, type RealApiTraceModelTier } from "./realApiTrace";
import { getLegalActionsForPlayer } from "../src/game/legalActions";
import {
  assassinateMerlin,
  advanceDiscussionTurn,
  castVote,
  createInitialGame,
  getFailedQuestCount,
  getSuccessfulQuestCount,
  proposeTeam,
  submitQuestCard
} from "../src/game/rules";
import type { AiActionKind, AiApiTiming, AiApiUsage, AiDecisionResult, AiFallbackDetail, AiFallbackReason, AiPromptMetrics, AiSpeechRepairReason, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "../src/ai/types";
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
  requestedReasoningEffort: ReasoningEffort;
  reasoningEffort: ReasoningEffort;
  actionKind: AiActionKind;
  source: AiDecisionResult["source"];
  fallbackReason?: AiFallbackReason;
  fallbackDetail?: AiFallbackDetail;
  fallbackDiagnostic?: string;
  speechRepairReason?: AiSpeechRepairReason;
  promptMetrics?: AiPromptMetrics;
  apiUsage?: AiApiUsage;
  apiTiming?: AiApiTiming;
  rawModelContent?: string;
  modelTier: ModelTier;
  action: LegalAction;
  speech: string;
}

type RealApiScenario =
  | "uniform"
  | "all-strong"
  | "all-weak"
  | "random"
  | "strong-human-vs-weak-ai"
  | "weak-human-vs-strong-ai"
  | "strong-good-vs-weak-evil"
  | "weak-good-vs-strong-evil";
type ModelTier = RealApiTraceModelTier;

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
    const includeRawModelContent = process.env.AVALON_REAL_API_INCLUDE_RAW === "1";
    const streamSteps = process.env.AVALON_REAL_API_STREAM === "1";
    const outputPath = process.env.AVALON_REAL_API_OUTPUT?.trim();
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
          streamSteps,
          includeRawModelContent
        });

        expect(result.final.phase).toBe("gameOver");
        expect(result.final.winner).toMatch(/good|evil/);
        expect(result.steps).toBeLessThan(180);

        const diagnostics = summarizeRealApiTrace(result.trace);
        const fallbackCount = diagnostics.fallbackCount;
        const simulatedUser = result.final.players[humanSeat];
        const simulatedUserWon = result.final.winner === simulatedUser.allegiance;
        const modelAssignments = result.final.players.map((player) => ({
          playerId: player.id,
          seat: player.seat,
          role: player.role,
          allegiance: player.allegiance,
          isSimulatedUser: player.id === simulatedUser.id,
          ...modelProfileForPlayer(scenario, scenarioConfig, simulatedUser.id, player.id, seed, player.allegiance)
        }));
        const audit = auditRealApiGame({ modelAssignments, trace: result.trace });
        const report = {
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
          modelActions: diagnostics.modelActions,
          localActions: diagnostics.localActions,
          fallbackCount,
          diagnostics,
          audit,
          trace: includeTrace ? result.trace : undefined
        };
        process.stdout.write(`\nAVALON_REAL_API_RESULT ${JSON.stringify(report)}\n`);
        if (outputPath) {
          appendRealApiResultJsonl(outputPath, report);
        }
      }
    }
  }, realApiTimeoutMs);
});

describe("manual real API scenario routing", () => {
  const scenarioConfig: ScenarioConfig = {
    strongModel: "strong-model",
    weakModel: "weak-model",
    uniformModel: "uniform-model",
    strongReasoningEffort: "medium",
    weakReasoningEffort: "low",
    uniformReasoningEffort: "low"
  };

  it("supports model-strength scenarios split by Good and Evil allegiance", () => {
    expect(isRealApiScenario("strong-good-vs-weak-evil")).toBe(true);
    expect(isRealApiScenario("weak-good-vs-strong-evil")).toBe(true);

    expect(modelProfileForPlayer("strong-good-vs-weak-evil" as RealApiScenario, scenarioConfig, "p1", "p2", 7, "good")).toEqual({
      model: "strong-model",
      reasoningEffort: "medium",
      modelTier: "strong"
    });
    expect(modelProfileForPlayer("strong-good-vs-weak-evil" as RealApiScenario, scenarioConfig, "p1", "p4", 7, "evil")).toEqual({
      model: "weak-model",
      reasoningEffort: "low",
      modelTier: "weak"
    });
    expect(modelProfileForPlayer("weak-good-vs-strong-evil" as RealApiScenario, scenarioConfig, "p1", "p2", 7, "good")).toEqual({
      model: "weak-model",
      reasoningEffort: "low",
      modelTier: "weak"
    });
    expect(modelProfileForPlayer("weak-good-vs-strong-evil" as RealApiScenario, scenarioConfig, "p1", "p4", 7, "evil")).toEqual({
      model: "strong-model",
      reasoningEffort: "medium",
      modelTier: "strong"
    });
  });
});

describe("manual real API table talk context", () => {
  it("records previous AI speeches as table talk for later prompts", () => {
    const first = appendTraceTableTalk([], { step: 3, playerId: "p1", speech: "先看 p2 的站边。" }, "AI 1");
    const second = appendTraceTableTalk(first, { step: 4, playerId: "p2", speech: "我反对这队。" }, "AI 2");

    expect(second).toEqual([
      { id: 3, speakerId: "p1", speakerName: "AI 1", text: "先看 p2 的站边。" },
      { id: 4, speakerId: "p2", speakerName: "AI 2", text: "我反对这队。" }
    ]);
  });
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
  includeRawModelContent: boolean;
}): Promise<{ final: GameState; steps: number; trace: TraceEntry[] }> {
  let state = createInitialGame({
    playerCount: input.playerCount,
    humanSeat: input.humanSeat,
    seed: input.seed
  });
  const trace: TraceEntry[] = [];
  let tableTalk: PublicTalkEntry[] = [];

  for (let step = 0; step < input.maxSteps; step += 1) {
    if (state.phase === "gameOver") {
      return { final: state, steps: step, trace };
    }

    const next = getNextAutoplayAction(state);
    const player = state.players.find((candidate) => candidate.id === next.playerId);
    const playerProfile = modelProfileForPlayer(input.scenario, input.scenarioConfig, state.players[input.humanSeat].id, next.playerId, input.seed, player?.allegiance);
    const reasoningEffort = effectiveReasoningEffortForAction(next.actionKind, playerProfile.reasoningEffort);
    const legalActions = getLegalActionsForPlayer(state, next.playerId, next.actionKind);
    const decision = await createAiActionResult({
      body: {
        state,
        playerId: next.playerId,
        actionKind: next.actionKind,
        legalActions,
        tableTalk,
        reasoningEffort: playerProfile.reasoningEffort,
        language: input.language,
        model: playerProfile.model
      },
      includeRawModelContent: input.includeRawModelContent
    });

    const traceEntry: TraceEntry = {
      step,
      phase: state.phase,
      quest: state.questIndex + 1,
      playerId: next.playerId,
      model: playerProfile.model,
      requestedReasoningEffort: playerProfile.reasoningEffort,
      reasoningEffort,
      modelTier: playerProfile.modelTier,
      actionKind: next.actionKind,
      source: decision.source,
      fallbackReason: decision.fallbackReason,
      fallbackDetail: decision.fallbackDetail,
      fallbackDiagnostic: decision.fallbackDiagnostic,
      speechRepairReason: decision.speechRepairReason,
      promptMetrics: decision.promptMetrics,
      apiUsage: decision.apiUsage,
      apiTiming: decision.apiTiming,
      rawModelContent: input.includeRawModelContent ? decision.rawModelContent : undefined,
      action: decision.action,
      speech: decision.speech
    };
    trace.push(traceEntry);
    if (input.streamSteps) {
      process.stdout.write(`\nAVALON_REAL_API_STEP ${JSON.stringify(traceEntry)}\n`);
    }
    tableTalk = appendTraceTableTalk(tableTalk, traceEntry, player?.name ?? next.playerId);
    state = applyLegalAction(state, next.playerId, decision.action);
  }

  throw new Error(`Real API game did not finish within ${input.maxSteps} actions for ${input.playerCount} players, seed ${input.seed}`);
}

function getNextAutoplayAction(state: GameState): { playerId: string; actionKind: AiActionKind } {
  if (state.phase === "proposal") {
    return { playerId: state.players[state.leaderIndex].id, actionKind: "proposeTeam" };
  }
  if (state.phase === "discussion" && state.discussion) {
    const speaker = state.players[state.discussion.nextSpeakerIndex];
    return { playerId: speaker.id, actionKind: "speak" };
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
  if (action.type === "speak") {
    return advanceDiscussionTurn(state, playerId);
  }
  if (action.type === "vote") {
    return castVote(state, playerId, action.approve);
  }
  if (action.type === "quest") {
    return submitQuestCard(state, playerId, action.card);
  }
  return assassinateMerlin(state, playerId, action.targetId);
}

function appendTraceTableTalk(
  tableTalk: PublicTalkEntry[],
  traceEntry: Pick<TraceEntry, "step" | "playerId" | "speech">,
  speakerName: string
): PublicTalkEntry[] {
  const text = traceEntry.speech.trim();
  if (!text) {
    return tableTalk;
  }
  return [
    ...tableTalk,
    { id: traceEntry.step, speakerId: traceEntry.playerId, speakerName, text }
  ].slice(-120);
}

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readReasoningEffort(name: string, fallback: ReasoningEffort): ReasoningEffort {
  const value = process.env[name];
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
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
    || value === "weak-human-vs-strong-ai"
    || value === "strong-good-vs-weak-evil"
    || value === "weak-good-vs-strong-evil";
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
  seed: number,
  playerAllegiance?: "good" | "evil"
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
  if (scenario === "strong-good-vs-weak-evil") {
    return playerAllegiance === "evil"
      ? { model: config.weakModel, reasoningEffort: config.weakReasoningEffort, modelTier: "weak" }
      : { model: config.strongModel, reasoningEffort: config.strongReasoningEffort, modelTier: "strong" };
  }
  if (scenario === "weak-good-vs-strong-evil") {
    return playerAllegiance === "evil"
      ? { model: config.strongModel, reasoningEffort: config.strongReasoningEffort, modelTier: "strong" }
      : { model: config.weakModel, reasoningEffort: config.weakReasoningEffort, modelTier: "weak" };
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
  if (scenario === "strong-good-vs-weak-evil") {
    return "Good seats use the strong model and Evil seats use the weak model; expect Good-favored strategic pressure with full rules compliance";
  }
  if (scenario === "weak-good-vs-strong-evil") {
    return "Good seats use the weak model and Evil seats use the strong model; expect Evil-favored pressure with full rules compliance";
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
