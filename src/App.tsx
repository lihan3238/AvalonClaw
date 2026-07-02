import { Crown, History, KeyRound, LogIn, MessageCircle, RotateCcw, ScrollText, Send, Shield, Sparkles, Swords, Users, Vote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestAiAction } from "./ai/client";
import type { AiActionKind, AiDecisionResult, AiRuntimeConfig, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./ai/types";
import { getLegalActionsForPlayer } from "./game/legalActions";
import {
  assassinateMerlin,
  castVote,
  createInitialGame,
  advanceDiscussionTurn,
  getFailedQuestCount,
  getDefaultRoles,
  getQuestConfig,
  getRoleKnowledge,
  getSuccessfulQuestCount,
  proposeTeam,
  ROLE_DEFINITIONS,
  submitQuestCard
} from "./game/rules";
import { createSessionId, isRestorableSession, listSessions, loadSession, saveSession, type SavedLogEntry, type SavedSession } from "./game/sessionStore";
import type { GameState, Player, QuestCard, Role, RoleKnowledge } from "./game/types";
import {
  createRoomOnServer,
  drainRoomActionsFromServer,
  fetchRoomSnapshot,
  joinRoomOnServer,
  leaveRoomOnServer,
  pushRoomStateToServer,
  setRoomReady,
  startRoomOnServer,
  submitRoomActionToServer,
  type PendingRoomAction,
  type RoomSnapshot
} from "./multiplayer/roomClient";

type LogEntry = SavedLogEntry;
type Theme = "dark" | "light";
type PublicLogEvent = Pick<LogEntry, "text" | "tone">;

const THEME_STORAGE_KEY = "avalon-claw:theme";
const AI_CONFIG_STORAGE_KEY = "avalon-claw:ai-config";
const DEFAULT_AI_CONFIG: AiRuntimeConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: ""
};

const copy = {
  en: {
    localTable: "Local AI table",
    setup: "Setup",
    players: "Players",
    yourSeat: "Your Seat",
    random: "Random",
    seat: "Seat",
    language: "Language",
    english: "English",
    chinese: "中文",
    thinking: "Thinking",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    aiEndpoint: "AI endpoint",
    baseUrl: "Base URL",
    apiKey: "API key",
    model: "Model",
    darkMode: "Dark mode",
    tableConfig: "Table config",
    rolesInGame: "Roles in game",
    questConfig: "Quest config",
    currentGameId: "Current game ID",
    savedGames: "Saved games",
    manualGameId: "Game ID",
    restoreGame: "Restore game",
    restore: "Restore",
    restoreMissing: "No saved game found for that ID.",
    restoreEnded: "That game is already over. Open the full list to review it.",
    noSavedGames: "No unfinished saved games yet.",
    fullList: "Full list",
    fullSavedGames: "All saved games",
    close: "Close",
    view: "View",
    ended: "ended",
    start: "Start game",
    reset: "Reset",
    yourRole: "Your Role",
    roleSkill: "Role skill",
    privateInfo: "Private information",
    speak: "Speak",
    sendTalk: "Send speech",
    publicTalk: "Table Talk",
    leaderMarker: "Leader",
    countdown: "countdown",
    seconds: "s",
    thinkingNow: "thinking",
    voteSubmittedStatus: "Votes submitted",
    questSubmittedStatus: "Quest cards submitted",
    voteResult: "Vote result",
    questResult: "Quest result",
    approveCount: "approve",
    rejectCount: "reject",
    failCardCount: "fail card",
    epilogue: "Final table talk",
    knownEvil: "Known evil",
    merlinCandidates: "Merlin candidates",
    none: "none",
    quest: "Quest",
    success: "Success",
    fail: "Fail",
    reject: "Reject",
    newTable: "New table",
    configure: "Configure the table",
    leader: "Leader",
    aiThinking: "AI thinking",
    yourDecision: "Your decision",
    resolving: "Resolving table",
    tableLog: "Table Log",
    noEvents: "No table events yet.",
    selectPlayers: "Select players",
    noTeam: "No team selected",
    proposeTeam: "Propose team",
    voteOn: "Vote on",
    approve: "Approve",
    submitQuest: "Submit quest card",
    chooseMerlin: "Choose Merlin target",
    waiting: "Waiting for AI seats.",
    you: "You",
    unknownRole: "Unknown role",
    started: "Game started",
    proposed: "proposed",
    voted: "voted",
    approved: "approve",
    rejected: "reject",
    submitted: "submitted a quest card",
    assassinated: "chose Merlin target",
    fallback: "local fallback",
    fallbackNotice: "returned no usable action; local fallback took over.",
    wins: "wins",
    multiplayer: "Multiplayer",
    createRoom: "Create room",
    joinRoom: "Join room",
    roomCode: "Room code",
    yourName: "Your name",
    lobbyTitle: "Game lobby",
    shareCode: "Share this room code; friends enter it on this page to join.",
    readyBtn: "Ready",
    cancelReady: "Cancel ready",
    readyState: "Ready",
    notReadyState: "Not ready",
    hostBadge: "Host",
    startMatch: "Start match",
    leaveRoom: "Leave room",
    waitingHost: "Waiting for the host to start the match...",
    waitingAllReady: "Waiting for every player to ready up.",
    aiSeatsNote: "Empty seats will be filled by AI players.",
    humanPlayer: "Human",
    roomUnavailable: "Room service unavailable; check the server and try again.",
    actionSubmitted: "Action submitted; waiting for the table.",
    inRoom: "Room"
  },
  zh: {
    localTable: "本机 AI 牌桌",
    setup: "设置",
    players: "人数",
    yourSeat: "你的座位",
    random: "随机",
    seat: "座位",
    language: "语言",
    english: "English",
    chinese: "中文",
    thinking: "思考强度",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    aiEndpoint: "AI 接口",
    baseUrl: "Base URL",
    apiKey: "API key",
    model: "模型",
    darkMode: "黑夜模式",
    tableConfig: "局配置",
    rolesInGame: "本局职业",
    questConfig: "任务配置",
    currentGameId: "当前局号",
    savedGames: "已有对局",
    manualGameId: "输入局号",
    restoreGame: "恢复对局",
    restore: "恢复",
    restoreMissing: "没有找到这个局号对应的存档。",
    restoreEnded: "这局已经终局；可在完整列表里查看复盘。",
    noSavedGames: "暂无可恢复的未终局对局。",
    fullList: "完整列表",
    fullSavedGames: "完整存档",
    close: "关闭",
    view: "查看",
    ended: "已终局",
    start: "开始游戏",
    reset: "重置",
    yourRole: "你的身份",
    roleSkill: "职业技能",
    privateInfo: "私密信息",
    speak: "发言",
    sendTalk: "发送发言",
    publicTalk: "牌桌发言",
    leaderMarker: "队长",
    countdown: "倒计时",
    seconds: "秒",
    thinkingNow: "思考中",
    voteSubmittedStatus: "投票已提交",
    questSubmittedStatus: "任务牌已提交",
    voteResult: "投票结果",
    questResult: "任务结果",
    approveCount: "同意",
    rejectCount: "拒绝",
    failCardCount: "张失败牌",
    epilogue: "终局复盘",
    knownEvil: "已知邪恶",
    merlinCandidates: "梅林候选",
    none: "无",
    quest: "任务",
    success: "成功",
    fail: "失败",
    reject: "拒绝",
    newTable: "新牌桌",
    configure: "配置牌桌",
    leader: "队长",
    aiThinking: "AI 思考中",
    yourDecision: "等待你决策",
    resolving: "牌桌结算中",
    tableLog: "牌桌记录",
    noEvents: "暂无牌桌事件。",
    selectPlayers: "选择玩家",
    noTeam: "尚未选队伍",
    proposeTeam: "提交队伍",
    voteOn: "投票队伍",
    approve: "同意",
    submitQuest: "提交任务牌",
    chooseMerlin: "选择梅林目标",
    waiting: "等待 AI 玩家。",
    you: "你",
    unknownRole: "未知身份",
    started: "游戏开始",
    proposed: "提议队伍",
    voted: "投票",
    approved: "同意",
    rejected: "拒绝",
    submitted: "提交了任务牌",
    assassinated: "选择刺杀目标",
    fallback: "本地兜底",
    fallbackNotice: "没有给出可用行动，已使用本地兜底。",
    wins: "获胜",
    multiplayer: "多人对局",
    createRoom: "创建多人房间",
    joinRoom: "加入房间",
    roomCode: "房间号",
    yourName: "昵称",
    lobbyTitle: "准备大厅",
    shareCode: "把房间号发给朋友，对方在本页输入即可加入。",
    readyBtn: "准备",
    cancelReady: "取消准备",
    readyState: "已准备",
    notReadyState: "未准备",
    hostBadge: "房主",
    startMatch: "开始对局",
    leaveRoom: "离开房间",
    waitingHost: "等待房主开始对局…",
    waitingAllReady: "等待所有玩家准备完成。",
    aiSeatsNote: "空余座位将由 AI 玩家补齐。",
    humanPlayer: "真人",
    roomUnavailable: "房间服务不可用，请检查服务器后重试。",
    actionSubmitted: "操作已提交，等待牌桌同步。",
    inRoom: "房间"
  }
} satisfies Record<TableLanguage, Record<string, string>>;

const phaseLabels = {
  en: {
    proposal: "Team proposal",
    discussion: "Ordered discussion",
    voting: "Approval vote",
    quest: "Quest resolution",
    assassination: "Assassination"
  },
  zh: {
    proposal: "组队提案",
    discussion: "顺序发言",
    voting: "队伍投票",
    quest: "任务结算",
    assassination: "刺杀梅林"
  }
} satisfies Record<TableLanguage, Record<Exclude<GameState["phase"], "gameOver">, string>>;

const roleLabels = {
  en: {
    merlin: "Merlin",
    percival: "Percival",
    loyal: "Loyal Servant",
    assassin: "Assassin",
    morgana: "Morgana",
    mordred: "Mordred",
    oberon: "Oberon",
    minion: "Minion of Mordred"
  },
  zh: {
    merlin: "梅林",
    percival: "派西维尔",
    loyal: "忠臣",
    assassin: "刺客",
    morgana: "莫甘娜",
    mordred: "莫德雷德",
    oberon: "奥伯伦",
    minion: "邪恶爪牙"
  }
} satisfies Record<TableLanguage, Record<Role, string>>;

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [playerCount, setPlayerCount] = useState(5);
  const [humanSeat, setHumanSeat] = useState<number | "random">("random");
  const [language, setLanguage] = useState<TableLanguage>("zh");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [model, setModel] = useState("gpt-5.4-mini");
  const [aiConfig, setAiConfig] = useState<AiRuntimeConfig>(() => readStoredAiConfig());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(() => listSessions());
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [restoreId, setRestoreId] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [pendingAi, setPendingAi] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tableTalk, setTableTalk] = useState<PublicTalkEntry[]>([]);
  const [talkInput, setTalkInput] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [phaseDeadline, setPhaseDeadline] = useState(() => Date.now() + 60_000);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [roomError, setRoomError] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);
  const [playerNameInput, setPlayerNameInput] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [guestKnowledge, setGuestKnowledge] = useState<RoleKnowledge | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const activeAiKeysRef = useRef<Set<string>>(new Set());
  const roomVersionRef = useRef(1);
  const guestVersionRef = useRef(0);

  const roomRole: "host" | "guest" | null = room ? (room.you.isHost ? "host" : "guest") : null;
  // players[humanSeat] is always "me": the host's own seat locally, and the
  // viewer's seat inside a redacted multiplayer guest view.
  const human = game ? game.players[game.humanSeat] : undefined;
  const leader = game ? game.players[game.leaderIndex] : null;
  const questConfig = game ? getQuestConfig(game.playerCount)[game.questIndex] : null;
  const humanKnowledge = roomRole === "guest"
    ? guestKnowledge
    : game && human ? getRoleKnowledge(game, human.id) : null;
  const currentHumanAction = game && human ? getHumanAction(game, human.id) : null;
  const phaseKey = game ? getPhaseKey(game) : "setup";
  const countdownSeconds = game && game.phase !== "gameOver" ? Math.max(0, Math.ceil((phaseDeadline - clockNow) / 1000)) : null;
  const pendingAiPlayers = game && sessionId ? getPendingAiPlayers(game, pendingAi, sessionId) : [];
  const pendingAiPlayerIds = new Set(pendingAiPlayers.map((player) => player.id));
  const highlightedTeam = game?.phase === "proposal" && leader?.isHuman ? selectedTeam : game?.proposal?.teamIds ?? [];
  const currentDiscussionSpeaker = game?.phase === "discussion" && game.discussion ? game.players[game.discussion.nextSpeakerIndex] : null;
  const canHumanTalk = Boolean(
    game
    && human
    && (
      game.phase === "gameOver"
      || (game.phase === "discussion" && currentHumanAction === "speak")
      || (game.phase === "assassination" && human.allegiance === "evil")
    )
  );
  const talkDisabled = Boolean(game && human && !canHumanTalk);
  const restorableSessions = useMemo(() => savedSessions.filter(isRestorableSession), [savedSessions]);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistAiConfig(aiConfig);
  }, [aiConfig]);

  useEffect(() => {
    const now = Date.now();
    setClockNow(now);
    setPhaseDeadline(now + 60_000);
  }, [phaseKey]);

  useEffect(() => {
    if (!game || game.phase === "gameOver") {
      return;
    }

    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [game?.phase]);

  useEffect(() => {
    if (!game || !sessionId) {
      return;
    }

    saveSession({
      id: sessionId,
      game,
      selectedTeam,
      log,
      tableTalk,
      language,
      reasoningEffort,
      model,
      updatedAt: Date.now()
    });
    setSavedSessions(listSessions());
  }, [game, selectedTeam, log, tableTalk, language, reasoningEffort, model, sessionId]);

  useEffect(() => {
    if (!game || !sessionId || game.phase === "gameOver") {
      return;
    }
    if (roomRole === "guest") {
      return;
    }

    const nextActions = getNextAiActions(game)
      .map((action) => ({ ...action, key: buildAiRequestKey(game, action, sessionId) }))
      .filter((action) => !activeAiKeysRef.current.has(action.key));
    if (!nextActions.length) {
      return;
    }

    const requestSessionId = sessionId;
    for (const action of nextActions) {
      activeAiKeysRef.current.add(action.key);
    }
    setPendingAi(Array.from(activeAiKeysRef.current));

    for (const next of nextActions) {
      let legalActions: LegalAction[];
      try {
        legalActions = getLegalActionsForPlayer(game, next.playerId, next.actionKind);
      } catch {
        finishPendingAi(next.key);
        continue;
      }

      void requestAiAction({ sessionId, state: game, playerId: next.playerId, actionKind: next.actionKind, legalActions, tableTalk, reasoningEffort, language, model, aiConfig }).then((decision) => {
        if (sessionIdRef.current !== requestSessionId) {
          return;
        }
        const applied = commitGameUpdate((current) => {
          if (current.phase === "gameOver") {
            throw new Error("Game is already over");
          }
          return applyDecision(current, next.playerId, decision.action);
        });
        if (!applied) {
          // Stale/illegal response; the effect retries from the latest state after finishPendingAi.
          return;
        }
        if (decision.source === "fallback") {
          appendLog(fallbackLogText(playerName(applied.previous, next.playerId), decision, language), "warning");
        }
        if (decision.action.type === "speak") {
          appendTableTalk(
            next.playerId,
            playerName(applied.previous, next.playerId),
            decision.source === "fallback" ? `${decision.speech} (${copy[language].fallback})` : decision.speech
          );
        }
        for (const entry of describePublicActionEvents(applied.previous, applied.next, next.playerId, decision.action, language)) {
          appendLog(entry.text, entry.tone);
        }
      }).finally(() => finishPendingAi(next.key));
    }
  }, [game, sessionId, pendingAi, tableTalk, reasoningEffort, language, model, aiConfig, roomRole]);

  // Host: mirror the authoritative state to the room service whenever it changes.
  useEffect(() => {
    if (roomRole !== "host" || !room || !roomToken || !game || room.status === "lobby") {
      return;
    }
    roomVersionRef.current += 1;
    void pushRoomStateToServer({
      code: room.code,
      token: roomToken,
      state: { game, tableTalk, log, version: roomVersionRef.current }
    });
  }, [game, tableTalk, log, roomRole, roomToken, room?.code, room?.status]);

  // Host: drain queued guest actions and apply them to the latest state.
  useEffect(() => {
    if (roomRole !== "host" || !room || !roomToken || !game || game.phase === "gameOver") {
      return;
    }
    const timer = window.setInterval(async () => {
      const actions = await drainRoomActionsFromServer({ code: room.code, token: roomToken });
      for (const pending of actions) {
        applyRemoteAction(pending);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [roomRole, room?.code, roomToken, game?.phase]);

  // Lobby members and guests: poll the room snapshot.
  useEffect(() => {
    if (!room || !roomToken) {
      return;
    }
    const isLobby = room.status === "lobby";
    const isGuest = roomRole === "guest";
    if (!isLobby && !isGuest) {
      return;
    }
    const timer = window.setInterval(async () => {
      const snapshot = await fetchRoomSnapshot({
        code: room.code,
        token: roomToken,
        sinceVersion: isGuest ? guestVersionRef.current : undefined
      });
      if (!snapshot) {
        return;
      }
      setRoom(snapshot);
      if (isGuest && snapshot.state && snapshot.state.version > guestVersionRef.current) {
        guestVersionRef.current = snapshot.state.version;
        gameRef.current = snapshot.state.game;
        setGame(snapshot.state.game);
        setGuestKnowledge(snapshot.state.knowledge);
        setTableTalk(snapshot.state.tableTalk);
        setLog(snapshot.state.log);
      }
    }, isGuest ? 1_000 : 1_500);
    return () => window.clearInterval(timer);
  }, [room?.code, room?.status, roomRole, roomToken]);

  function applyRemoteAction(pending: PendingRoomAction): void {
    const current = gameRef.current;
    if (!current) {
      return;
    }
    const actor = current.players[pending.seat];
    if (!actor) {
      return;
    }
    if (pending.talk) {
      appendTableTalk(actor.id, actor.name, pending.talk);
    }
    if (!pending.action) {
      return;
    }
    const action = pending.action;
    const applied = commitGameUpdate((state) => applyDecision(state, actor.id, action));
    if (!applied) {
      return;
    }
    for (const entry of describePublicActionEvents(applied.previous, applied.next, actor.id, action, language)) {
      appendLog(entry.text, entry.tone);
    }
  }

  function startGame() {
    const resolvedHumanSeat = humanSeat === "random" ? Math.floor(Math.random() * playerCount) : humanSeat;
    const newSessionId = createSessionId();
    const newGame = createInitialGame({
      playerCount,
      humanSeat: resolvedHumanSeat,
      seed: Date.now()
    });
    newGame.players = newGame.players.map((player) => ({
      ...player,
      name: player.isHuman ? copy[language].you : `AI ${player.seat + 1}`
    }));
    setSessionId(newSessionId);
    sessionIdRef.current = newSessionId;
    setGame(newGame);
    gameRef.current = newGame;
    clearPendingAi();
    setSelectedTeam([newGame.players[newGame.leaderIndex].id]);
    setRestoreError("");
    setRestoreId("");
    setShowAllSessions(false);
    setTableTalk([]);
    setTalkInput("");
    setLog([
      {
        id: Date.now(),
        tone: "system",
        text: `${copy[language].started}. ${copy[language].yourRole}: ${roleLabel(newGame.players[resolvedHumanSeat].role, language)}.`
      }
    ]);
  }

  function restartGame() {
    if (room && roomToken) {
      void leaveRoomOnServer({ code: room.code, token: roomToken });
    }
    setRoom(null);
    setRoomToken(null);
    setRoomError("");
    setGuestKnowledge(null);
    guestVersionRef.current = 0;
    roomVersionRef.current = 1;
    setSessionId(null);
    sessionIdRef.current = null;
    setGame(null);
    gameRef.current = null;
    setSelectedTeam([]);
    clearPendingAi();
    setLog([]);
    setTableTalk([]);
    setTalkInput("");
    setRestoreError("");
    setShowAllSessions(false);
    setSavedSessions(listSessions());
  }

  async function createMultiplayerRoom() {
    setRoomError("");
    setRoomBusy(true);
    try {
      const code = createSessionId();
      const created = await createRoomOnServer({
        code,
        playerCount,
        language,
        name: playerNameInput || copy[language].you
      });
      if (!created) {
        setRoomError(copy[language].roomUnavailable);
        return;
      }
      setRoom(created.snapshot);
      setRoomToken(created.hostToken);
    } finally {
      setRoomBusy(false);
    }
  }

  async function joinMultiplayerRoom() {
    setRoomError("");
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      return;
    }
    setRoomBusy(true);
    try {
      const joined = await joinRoomOnServer({ code, name: playerNameInput || copy[language].you });
      if (!joined) {
        setRoomError(copy[language].roomUnavailable);
        return;
      }
      if ("error" in joined) {
        setRoomError(joined.error);
        return;
      }
      setRoom(joined.snapshot);
      setRoomToken(joined.token);
      setLanguage(joined.snapshot.language);
    } finally {
      setRoomBusy(false);
    }
  }

  async function toggleRoomReady() {
    if (!room || !roomToken) {
      return;
    }
    const snapshot = await setRoomReady({ code: room.code, token: roomToken, ready: !room.you.ready });
    if (snapshot) {
      setRoom(snapshot);
    }
  }

  function leaveMultiplayerRoom() {
    if (room && roomToken) {
      void leaveRoomOnServer({ code: room.code, token: roomToken });
    }
    setRoom(null);
    setRoomToken(null);
    setRoomError("");
    setGuestKnowledge(null);
    guestVersionRef.current = 0;
  }

  async function startMultiplayerMatch() {
    if (!room || !roomToken || roomRole !== "host") {
      return;
    }
    setRoomError("");
    setRoomBusy(true);
    try {
      const humans = room.members;
      const seatCount = Math.max(room.playerCount, humans.length);
      const seats = shuffledSeats(seatCount);
      const seatByMemberId: Record<string, number> = {};
      humans.forEach((member, index) => {
        seatByMemberId[member.id] = seats[index];
      });

      const newGame = createInitialGame({
        playerCount: seatCount,
        humanSeat: seatByMemberId[room.you.id],
        seed: Date.now()
      });
      const nameBySeat = new Map<number, string>(humans.map((member) => [seatByMemberId[member.id], member.name]));
      newGame.players = newGame.players.map((player) => ({
        ...player,
        isHuman: nameBySeat.has(player.seat),
        name: nameBySeat.get(player.seat) ?? `AI ${player.seat + 1}`
      }));

      const startLog: LogEntry[] = [{
        id: Date.now(),
        tone: "system",
        text: `${copy[language].started}. ${copy[language].yourRole}: ${roleLabel(newGame.players[newGame.humanSeat].role, language)}.`
      }];
      roomVersionRef.current = 1;
      const result = await startRoomOnServer({
        code: room.code,
        token: roomToken,
        state: { game: newGame, tableTalk: [], log: startLog, version: 1 },
        seatByMemberId
      });
      if (!result) {
        setRoomError(copy[language].roomUnavailable);
        return;
      }
      if ("error" in result) {
        setRoomError(result.error);
        return;
      }

      setRoom(result);
      setSessionId(room.code);
      sessionIdRef.current = room.code;
      setGame(newGame);
      gameRef.current = newGame;
      clearPendingAi();
      setSelectedTeam([]);
      setTableTalk([]);
      setTalkInput("");
      setLog(startLog);
    } finally {
      setRoomBusy(false);
    }
  }

  function restoreGameById(id = restoreId, allowTerminalView = false) {
    const saved = loadSession(id);
    if (!saved) {
      setRestoreError(copy[language].restoreMissing);
      return;
    }
    if (!allowTerminalView && !isRestorableSession(saved)) {
      setRestoreError(copy[language].restoreEnded);
      return;
    }

    setSessionId(saved.id);
    sessionIdRef.current = saved.id;
    setPlayerCount(saved.game.playerCount);
    setHumanSeat(saved.game.humanSeat);
    setLanguage(saved.language);
    setReasoningEffort(saved.reasoningEffort);
    setModel(saved.model);
    setGame(saved.game);
    gameRef.current = saved.game;
    setSelectedTeam(saved.selectedTeam);
    setLog(saved.log);
    setTableTalk(saved.tableTalk ?? []);
    setTalkInput("");
    clearPendingAi();
    setRestoreId(saved.id);
    setRestoreError("");
    setShowAllSessions(false);
    setSavedSessions(listSessions());
  }

  function appendLog(text: string, tone: LogEntry["tone"] = "system") {
    setLog((entries) => [...entries, { id: Date.now() + Math.random(), text, tone }].slice(-80));
  }

  function appendTableTalk(speakerId: string, speakerName: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setTableTalk((entries) => [...entries, { id: Date.now() + Math.random(), speakerId, speakerName, text: trimmed }].slice(-120));
  }

  function finishPendingAi(key: string) {
    activeAiKeysRef.current.delete(key);
    setPendingAi(Array.from(activeAiKeysRef.current));
  }

  function clearPendingAi() {
    activeAiKeysRef.current.clear();
    setPendingAi([]);
  }

  // All game-state writes go through the authoritative ref first so parallel AI
  // responses and human actions never overwrite each other's applied actions.
  // Returns null when there is no game or the rules engine rejects the action.
  function commitGameUpdate(producer: (current: GameState) => GameState): { previous: GameState; next: GameState } | null {
    const current = gameRef.current;
    if (!current) {
      return null;
    }
    let next: GameState;
    try {
      next = producer(current);
    } catch {
      return null;
    }
    gameRef.current = next;
    setGame(next);
    return { previous: current, next };
  }

  // Single-player and multiplayer host apply human actions locally; guests
  // submit them to the room queue and wait for the host's next state push.
  function dispatchHumanAction(action: LegalAction, talk?: string): void {
    if (!game || !human) {
      return;
    }
    if (roomRole === "guest" && room && roomToken) {
      void submitRoomActionToServer({ code: room.code, token: roomToken, action, ...(talk ? { talk } : {}) });
      appendLog(copy[language].actionSubmitted, "system");
      return;
    }
    const applied = commitGameUpdate((current) => applyDecision(current, human.id, action));
    if (!applied) {
      return;
    }
    if (talk) {
      appendTableTalk(human.id, human.name, talk);
    }
    for (const entry of describePublicActionEvents(applied.previous, applied.next, human.id, action, language)) {
      appendLog(entry.text, entry.tone);
    }
  }

  function submitHumanTalk() {
    if (!game || !human) {
      return;
    }
    const text = talkInput.trim();
    if (!text) {
      return;
    }
    const canSubmitTalk = game.phase === "gameOver"
      || (game.phase === "discussion" && currentHumanAction === "speak")
      || (game.phase === "assassination" && human.allegiance === "evil");
    if (!canSubmitTalk) {
      return;
    }
    if (game.phase === "discussion" && currentHumanAction === "speak") {
      dispatchHumanAction({ type: "speak" }, text);
      setTalkInput("");
      return;
    }
    if (roomRole === "guest" && room && roomToken) {
      void submitRoomActionToServer({ code: room.code, token: roomToken, talk: text });
    } else {
      appendTableTalk(human.id, human.name, text);
    }
    setTalkInput("");
  }

  function toggleTeam(playerId: string) {
    if (!questConfig) {
      return;
    }
    setSelectedTeam((team) => {
      if (team.includes(playerId)) {
        return team.filter((id) => id !== playerId);
      }
      if (team.length >= questConfig.teamSize) {
        return team;
      }
      return [...team, playerId];
    });
  }

  function submitHumanProposal() {
    if (!game || !human || selectedTeam.length !== questConfig?.teamSize) {
      return;
    }
    dispatchHumanAction({ type: "proposeTeam", teamIds: selectedTeam });
  }

  function submitHumanVote(approve: boolean) {
    if (!game || !human) {
      return;
    }
    dispatchHumanAction({ type: "vote", approve });
  }

  function submitHumanQuest(card: QuestCard) {
    if (!game || !human) {
      return;
    }
    dispatchHumanAction({ type: "quest", card });
  }

  function submitHumanAssassination(targetId: string) {
    if (!game || !human) {
      return;
    }
    dispatchHumanAction({ type: "assassinate", targetId });
  }

  const roleSummary = useMemo(() => {
    if (!game || !human || !humanKnowledge) {
      return null;
    }
    const lines: string[] = [];
    if (human.role === "merlin" || human.allegiance === "evil" && human.role !== "oberon") {
      const knownEvil = humanKnowledge.knownEvilIds.length
        ? humanKnowledge.knownEvilIds.map((id) => describeKnownPlayer(game, id, knownEvilLabel(human, language)))
        : [copy[language].none];
      lines.push(`${copy[language].knownEvil}:`, ...knownEvil);
    }
    if (human.role === "percival") {
      const merlinCandidates = humanKnowledge.merlinCandidateIds.length
        ? humanKnowledge.merlinCandidateIds.map((id) => describeKnownPlayer(game, id, language === "zh" ? "梅林/莫甘娜候选" : "Merlin/Morgana candidate"))
        : [copy[language].none];
      lines.push(`${copy[language].merlinCandidates}:`, ...merlinCandidates);
    }
    return lines.length ? lines : [copy[language].none];
  }, [game, human, humanKnowledge, language]);

  return (
    <main className="app-shell" data-theme={theme}>
      <section className="left-rail">
        <div className="brand-block">
          <div className="brand-mark"><Crown size={22} /></div>
          <div>
            <h1>Avalon Claw</h1>
            <span>{copy[language].localTable}</span>
          </div>
        </div>

        <div className="panel setup-panel">
          <div className="panel-title"><Sparkles size={16} /> {copy[language].setup}</div>
          <label>
            <span>{copy[language].players}</span>
            <input type="range" min="5" max="10" value={playerCount} disabled={Boolean(game)} onChange={(event) => {
              const count = Number(event.target.value);
              setPlayerCount(count);
              setHumanSeat((seat) => seat === "random" ? "random" : Math.min(seat, count - 1));
            }} />
            <strong>{playerCount}</strong>
          </label>
          <label>
            <span>{copy[language].yourSeat}</span>
            <select value={humanSeat} disabled={Boolean(game)} onChange={(event) => setHumanSeat(event.target.value === "random" ? "random" : Number(event.target.value))}>
              <option value="random">{copy[language].random}</option>
              {Array.from({ length: playerCount }, (_, index) => <option key={index} value={index}>{copy[language].seat} {index + 1}</option>)}
            </select>
          </label>
          <label>
            <span>{copy[language].language}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as TableLanguage)}>
              <option value="zh">{copy[language].chinese}</option>
              <option value="en">{copy[language].english}</option>
            </select>
          </label>
          <label>
            <span>{copy[language].thinking}</span>
            <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}>
              <option value="low">{copy[language].low}</option>
              <option value="medium">{copy[language].medium}</option>
              <option value="high">{copy[language].high}</option>
              <option value="xhigh">{copy[language].xhigh}</option>
            </select>
          </label>
          <form className="config-panel ai-config-panel" onSubmit={(event) => event.preventDefault()}>
            <div className="config-title"><KeyRound size={15} /> {copy[language].aiEndpoint}</div>
            <label>
              <span>{copy[language].baseUrl}</span>
              <input
                type="url"
                value={aiConfig.baseURL}
                onChange={(event) => setAiConfig((current) => ({ ...current, baseURL: event.target.value }))}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </label>
            <label>
              <span>{copy[language].apiKey}</span>
              <input
                type="password"
                value={aiConfig.apiKey}
                onChange={(event) => setAiConfig((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </form>
          <label>
            <span>{copy[language].model}</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="OPENAI_MODEL" />
          </label>
          <label>
            <span>{copy[language].darkMode}</span>
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={(event) => setTheme(event.target.checked ? "dark" : "light")}
            />
          </label>
          <div className="button-row">
            <button className="primary" onClick={startGame} disabled={Boolean(game) || Boolean(room)}><Send size={16} /> {copy[language].start}</button>
            <button className="secondary icon-text" onClick={restartGame}><RotateCcw size={16} /> {copy[language].reset}</button>
          </div>
          {!game && !room && (
            <div className="config-panel multiplayer-panel">
              <div className="config-title"><Users size={15} /> {copy[language].multiplayer}</div>
              <label>
                <span>{copy[language].yourName}</span>
                <input value={playerNameInput} onChange={(event) => setPlayerNameInput(event.target.value)} maxLength={24} />
              </label>
              <button type="button" className="secondary icon-text" disabled={roomBusy} onClick={() => void createMultiplayerRoom()}>
                <Users size={16} /> {copy[language].createRoom}
              </button>
              <label>
                <span>{copy[language].roomCode}</span>
                <input value={joinCodeInput} onChange={(event) => setJoinCodeInput(event.target.value.trim().toUpperCase())} placeholder="AV-YYYYMMDD-0000" />
              </label>
              <button type="button" className="secondary icon-text" disabled={roomBusy || !joinCodeInput.trim()} onClick={() => void joinMultiplayerRoom()}>
                <LogIn size={16} /> {copy[language].joinRoom}
              </button>
              {roomError && <p className="restore-error">{roomError}</p>}
            </div>
          )}
          <ConfigPanel playerCount={playerCount} language={language} labels={copy[language]} />
          {sessionId && (
            <div className="session-current">
              <span>{copy[language].currentGameId}</span>
              <strong>{sessionId}</strong>
            </div>
          )}
          {!game && (
            <div className="restore-box">
              <div className="restore-title"><History size={15} /> {copy[language].savedGames}</div>
              <label className="restore-input">
                <span>{copy[language].manualGameId}</span>
                <input value={restoreId} onChange={(event) => setRestoreId(event.target.value.trim().toUpperCase())} placeholder="AV-YYYYMMDD-0000" />
              </label>
              <button type="button" className="secondary icon-text" onClick={() => restoreGameById()}><LogIn size={16} /> {copy[language].restoreGame}</button>
              {restoreError && <p className="restore-error">{restoreError}</p>}
              <button type="button" className="secondary icon-text" onClick={() => setShowAllSessions(true)}><History size={16} /> {copy[language].fullList}</button>
              {restorableSessions.length ? (
                <div className="saved-session-list">
                  {restorableSessions.map((session) => (
                    <div className="saved-session" key={session.id}>
                      <button type="button" className="session-id-button" onClick={() => restoreGameById(session.id)}>{session.id}</button>
                      <span>{formatSessionSummary(session, language)}</span>
                      <button type="button" className="secondary small-button" onClick={() => restoreGameById(session.id)}><LogIn size={14} /> {copy[language].restore}</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-text">{copy[language].noSavedGames}</p>
              )}
              {showAllSessions && (
                <SavedSessionsDialog
                  sessions={savedSessions}
                  language={language}
                  labels={copy[language]}
                  onClose={() => setShowAllSessions(false)}
                  onOpen={(session) => restoreGameById(session.id, true)}
                />
              )}
            </div>
          )}
        </div>

        {game && human && (
          <div className={`panel role-panel ${human.allegiance}`}>
            <div className="panel-title"><Shield size={16} /> {copy[language].yourRole}</div>
            <h2>{roleLabel(human.role, language)}</h2>
            <span className="allegiance">{human.allegiance.toUpperCase()}</span>
            <div className="role-detail">
              <strong>{copy[language].roleSkill}</strong>
              <p>{roleSkillText(human, language)}</p>
            </div>
            <div className="role-detail">
              <strong>{copy[language].privateInfo}</strong>
              {roleSummary?.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
            </div>
          </div>
        )}
      </section>

      <section className="table-zone">
        <header className="table-header">
          <div>
            <span className="eyebrow">{copy[language].quest} {game ? Math.min(game.questIndex + 1, 5) : 1}</span>
            <h2>{phaseTitle(game, language)}</h2>
          </div>
          {game && <div className="score-strip">
            <span>{copy[language].success} {getSuccessfulQuestCount(game)}</span>
            <span>{copy[language].fail} {getFailedQuestCount(game)}</span>
            <span>{copy[language].reject} {game.failedVotes}/5</span>
            {game.questResults.length > 0 && <span>{formatLatestQuestResult(game, language)}</span>}
            {countdownSeconds !== null && <span>{formatPhaseCountdown(game, countdownSeconds, language)}</span>}
          </div>}
        </header>

        {game ? (
          <>
            <QuestTrack game={game} language={language} />
            <div className="table-card">
              <div className="table-center">
                <div className="leader-chip"><Crown size={16} /> {copy[language].leader}: {leader?.name}</div>
                <div className={`phase-chip ${pendingAiPlayers.length ? "thinking" : ""}`}>
                  {pendingAiPlayers.length ? formatPendingAiStatus(pendingAiPlayers, language) : currentHumanAction ? copy[language].yourDecision : copy[language].resolving}
                </div>
              </div>
              <div className="players-grid">
                {game.players.map((player) => {
                  const isThinking = pendingAiPlayerIds.has(player.id);
                  const isSpeaking = currentDiscussionSpeaker?.id === player.id;
                  return (
                    <button
                      type="button"
                      key={player.id}
                      className={`player-seat ${player.isHuman ? "human" : ""} ${leader?.id === player.id ? "leader" : ""} ${highlightedTeam.includes(player.id) ? "selected" : ""} ${isThinking ? "thinking" : ""} ${isSpeaking ? "speaking" : ""} ${playerToneClass(player)}`}
                      onClick={() => game.phase === "proposal" && leader?.isHuman ? toggleTeam(player.id) : undefined}
                    >
                      <span>
                        <b>{player.id}</b> {player.name}
                        {leader?.id === player.id && <em>{copy[language].leaderMarker}</em>}
                        {isThinking && <em className="thinking-badge">{copy[language].thinkingNow}</em>}
                      </span>
                      <small>{visibleRole(game, player, human, language)}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <DecisionPanel
              game={game}
              human={human}
              currentAction={currentHumanAction}
              selectedTeam={selectedTeam}
              questTeamSize={questConfig?.teamSize ?? 0}
              onProposal={submitHumanProposal}
              onVote={submitHumanVote}
              onQuest={submitHumanQuest}
              onAssassinate={submitHumanAssassination}
              labels={copy[language]}
            />
            {game.phase === "gameOver" && <EpiloguePanel game={game} human={human} language={language} labels={copy[language]} />}
          </>
        ) : room && room.status === "lobby" ? (
          <RoomLobbyPanel
            room={room}
            busy={roomBusy}
            error={roomError}
            labels={copy[language]}
            onToggleReady={() => void toggleRoomReady()}
            onStart={() => void startMultiplayerMatch()}
            onLeave={leaveMultiplayerRoom}
          />
        ) : (
          <div className="empty-table">
            <Swords size={32} />
            <h2>{copy[language].configure}</h2>
          </div>
        )}
      </section>

      <aside className="right-rail">
        <div className="panel talk-panel">
          <div className="panel-title"><MessageCircle size={16} /> {copy[language].publicTalk}</div>
          {game && human && (
            <label className="talk-input">
              <span>{copy[language].speak}</span>
              <textarea value={talkInput} onChange={(event) => setTalkInput(event.target.value)} rows={3} disabled={talkDisabled} />
              <button type="button" className="primary" onClick={submitHumanTalk} disabled={!talkInput.trim() || talkDisabled}><Send size={16} /> {copy[language].sendTalk}</button>
            </label>
          )}
          <div className="talk-list">
            {tableTalk.length ? tableTalk.map((entry) => (
              <p key={entry.id} className={`talk-entry ${playerToneClassById(entry.speakerId)}`}>
                {entry.speakerName}: {entry.text}
              </p>
            )) : <p className="muted-text">{copy[language].noEvents}</p>}
          </div>
        </div>
        <div className="panel log-panel">
          <div className="panel-title"><Vote size={16} /> {copy[language].tableLog}</div>
          <div className="log-list">
            {log.length ? log.map((entry) => <p key={entry.id} className={entry.tone}>{entry.text}</p>) : <p className="system">{copy[language].noEvents}</p>}
          </div>
        </div>
      </aside>
    </main>
  );
}

function RoomLobbyPanel(props: {
  room: RoomSnapshot;
  busy: boolean;
  error: string;
  labels: typeof copy.en;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const { room, labels } = props;
  const allReady = room.members.every((member) => member.isHost || member.ready);
  const humanCount = room.members.length;
  return (
    <div className="lobby-panel">
      <div className="lobby-header">
        <Users size={22} />
        <div>
          <h2>{labels.lobbyTitle}</h2>
          <p className="muted-text">{labels.shareCode}</p>
        </div>
      </div>
      <div className="lobby-code">
        <span>{labels.roomCode}</span>
        <strong>{room.code}</strong>
      </div>
      <div className="lobby-members">
        {room.members.map((member) => (
          <div key={member.id} className={`lobby-member ${member.ready || member.isHost ? "ready" : ""}`}>
            <span className="lobby-member-name">
              {member.name}
              {member.isHost && <em>{labels.hostBadge}</em>}
            </span>
            <span className="lobby-member-state">{member.isHost || member.ready ? labels.readyState : labels.notReadyState}</span>
          </div>
        ))}
        {Array.from({ length: Math.max(0, room.playerCount - humanCount) }, (_, index) => (
          <div key={`ai-${index}`} className="lobby-member ai-seat">
            <span className="lobby-member-name">AI</span>
            <span className="lobby-member-state">{labels.aiSeatsNote}</span>
          </div>
        ))}
      </div>
      <div className="button-row">
        {!room.you.isHost && (
          <button type="button" className={room.you.ready ? "secondary" : "primary"} onClick={props.onToggleReady}>
            {room.you.ready ? labels.cancelReady : labels.readyBtn}
          </button>
        )}
        {room.you.isHost && (
          <button type="button" className="primary" disabled={!allReady || props.busy} onClick={props.onStart}>
            <Send size={16} /> {labels.startMatch}
          </button>
        )}
        <button type="button" className="secondary" onClick={props.onLeave}>{labels.leaveRoom}</button>
      </div>
      {!room.you.isHost && <p className="muted-text">{labels.waitingHost}</p>}
      {room.you.isHost && !allReady && <p className="muted-text">{labels.waitingAllReady}</p>}
      {props.error && <p className="restore-error">{props.error}</p>}
    </div>
  );
}

function ConfigPanel({ playerCount, language, labels }: { playerCount: number; language: TableLanguage; labels: typeof copy.en }) {
  const roles = getDefaultRoles(playerCount);
  const quests = getQuestConfig(playerCount);
  const goodCount = roles.filter((role) => role.allegiance === "good").length;
  const evilCount = roles.length - goodCount;
  const people = language === "zh" ? "人" : " players";
  const failCard = language === "zh" ? "失败牌" : "fail card";
  const goodLabel = language === "zh" ? "好人" : "good";
  const evilLabel = language === "zh" ? "邪恶" : "evil";

  return (
    <div className="config-panel">
      <div className="config-title"><Users size={15} /> {labels.tableConfig}</div>
      <div className="config-block">
        <strong>{labels.rolesInGame}</strong>
        <span>{roles.map((role) => roleLabel(role.role, language)).join(" · ")}</span>
        <small>{goodCount} {goodLabel} / {evilCount} {evilLabel}</small>
      </div>
      <div className="config-block">
        <strong><ScrollText size={14} /> {labels.questConfig}</strong>
        <div className="config-quests">
          {quests.map((quest, index) => (
            <span key={index}>Q{index + 1} {quest.teamSize}{people} {quest.failsRequired}{failCard}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SavedSessionsDialog(props: {
  sessions: SavedSession[];
  language: TableLanguage;
  labels: typeof copy.en;
  onClose: () => void;
  onOpen: (session: SavedSession) => void;
}) {
  return (
    <div className="dialog-backdrop">
      <div className="saved-dialog" role="dialog" aria-modal="true" aria-label={props.labels.fullSavedGames}>
        <div className="dialog-header">
          <strong>{props.labels.fullSavedGames}</strong>
          <button type="button" className="secondary small-button" onClick={props.onClose}>{props.labels.close}</button>
        </div>
        {props.sessions.length ? (
          <div className="saved-session-list full">
            {props.sessions.map((session) => {
              const restorable = isRestorableSession(session);
              return (
                <div className={`saved-session ${restorable ? "" : "ended"}`} key={session.id}>
                  <span className="session-id-text">{session.id}</span>
                  <span>{formatSessionSummary(session, props.language)}</span>
                  <button type="button" className="secondary small-button" onClick={() => props.onOpen(session)}>
                    {restorable ? <LogIn size={14} /> : <ScrollText size={14} />} {restorable ? props.labels.restore : props.labels.view}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted-text">{props.labels.noSavedGames}</p>
        )}
      </div>
    </div>
  );
}

function DecisionPanel(props: {
  game: GameState;
  human?: Player;
  currentAction: AiActionKind | null;
  selectedTeam: string[];
  questTeamSize: number;
  onProposal: () => void;
  onVote: (approve: boolean) => void;
  onQuest: (card: QuestCard) => void;
  onAssassinate: (targetId: string) => void;
  labels: typeof copy.en;
}) {
  if (!props.human || props.game.phase === "gameOver") {
    const winnerLabel = props.game.winner
      ? props.labels.approveCount === "同意"
        ? props.game.winner === "good" ? "好人阵营" : "邪恶阵营"
        : props.game.winner.toUpperCase()
      : "";
    return (
      <div className="decision-panel result-panel">
        <strong>{winnerLabel} {props.labels.wins}</strong>
        <span>{winReasonLabel(props.game.winReason, props.labels)}</span>
      </div>
    );
  }
  if (props.currentAction === "proposeTeam") {
    return (
      <div className="decision-panel">
        <strong>{props.labels.selectPlayers}: {props.questTeamSize}</strong>
        <span>{props.selectedTeam.join(", ") || props.labels.noTeam}</span>
        <button className="primary" disabled={props.selectedTeam.length !== props.questTeamSize} onClick={props.onProposal}><Send size={16} /> {props.labels.proposeTeam}</button>
      </div>
    );
  }
  if (props.currentAction === "speak") {
    return (
      <div className="decision-panel">
        <strong>{props.labels.speak}</strong>
        <span>{props.game.proposal?.teamIds.join(", ")}</span>
      </div>
    );
  }
  if (props.currentAction === "vote") {
    return (
      <div className="decision-panel">
        <strong>{props.labels.voteOn}: {props.game.proposal?.teamIds.join(", ")}</strong>
        <div className="button-row"><button className="primary" onClick={() => props.onVote(true)}>{props.labels.approve}</button><button className="secondary" onClick={() => props.onVote(false)}>{props.labels.reject}</button></div>
      </div>
    );
  }
  if (props.currentAction === "quest") {
    return (
      <div className="decision-panel">
        <strong>{props.labels.submitQuest}</strong>
        <div className="button-row">
          <button className="primary" onClick={() => props.onQuest("success")}>{props.labels.success}</button>
          {props.human.allegiance === "evil" && <button className="danger" onClick={() => props.onQuest("fail")}>{props.labels.fail}</button>}
        </div>
      </div>
    );
  }
  if (props.currentAction === "assassinate") {
    return (
      <div className="decision-panel target-grid">
        <strong>{props.labels.chooseMerlin}</strong>
        {props.game.players.filter((player) => player.allegiance === "good").map((player) => (
          <button key={player.id} className="secondary" onClick={() => props.onAssassinate(player.id)}>{player.name}</button>
        ))}
      </div>
    );
  }

  if (props.game.phase === "voting") {
    const separator = props.labels.approveCount === "同意" ? "：" : ": ";
    return (
      <div className="decision-panel muted">
        <strong>{props.labels.voteSubmittedStatus}{separator}{Object.keys(props.game.votes).length}/{props.game.players.length}</strong>
        <span>{props.labels.waiting}</span>
      </div>
    );
  }

  if (props.game.phase === "quest" && props.game.proposal) {
    const separator = props.labels.approveCount === "同意" ? "：" : ": ";
    return (
      <div className="decision-panel muted">
        <strong>{props.labels.questSubmittedStatus}{separator}{Object.keys(props.game.questCards).length}/{props.game.proposal.teamIds.length}</strong>
        <span>{props.labels.waiting}</span>
      </div>
    );
  }

  return <div className="decision-panel muted">{props.labels.waiting}</div>;
}

function QuestTrack({ game, language }: { game: GameState; language: TableLanguage }) {
  const config = getQuestConfig(game.playerCount);
  const seatsLabel = language === "zh" ? "人" : "seats";
  const failLabel = language === "zh" ? "失败牌" : "fail";
  return (
    <div className="quest-track">
      {config.map((quest, index) => {
        const result = game.questResults[index];
        return (
          <div key={index} className={`quest-node ${result ? result.succeeded ? "success" : "fail" : index === game.questIndex ? "current" : ""}`}>
            <strong>Q{index + 1}</strong>
            <span>{quest.teamSize} {seatsLabel}</span>
            <small>
              {result
                ? `${result.failCards} ${failLabel}${language === "en" && result.failCards !== 1 ? "s" : ""}`
                : `${quest.failsRequired} ${failLabel}${language === "en" && quest.failsRequired > 1 ? "s" : ""}`}
            </small>
          </div>
        );
      })}
      <div className="vote-track" title={language === "zh" ? "连续否决轨道" : "Rejected vote track"}>
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className={`vote-track-dot ${index < game.failedVotes ? "used" : ""}`} />
        ))}
      </div>
    </div>
  );
}

function getHumanAction(game: GameState, humanId: string): AiActionKind | null {
  if (game.phase === "proposal" && game.players[game.leaderIndex].id === humanId) {
    return "proposeTeam";
  }
  if (game.phase === "discussion" && game.discussion && game.players[game.discussion.nextSpeakerIndex]?.id === humanId) {
    return "speak";
  }
  if (game.phase === "voting" && !game.votes[humanId]) {
    return "vote";
  }
  if (game.phase === "quest" && game.proposal?.teamIds.includes(humanId) && !game.questCards[humanId]) {
    return "quest";
  }
  if (game.phase === "assassination" && game.players.find((player) => player.id === humanId)?.role === "assassin") {
    return "assassinate";
  }

  return null;
}

function getNextAiActions(game: GameState): { playerId: string; actionKind: AiActionKind }[] {
  if (game.phase === "proposal") {
    const leader = game.players[game.leaderIndex];
    return leader.isHuman ? [] : [{ playerId: leader.id, actionKind: "proposeTeam" }];
  }
  if (game.phase === "discussion" && game.discussion) {
    const speaker = game.players[game.discussion.nextSpeakerIndex];
    return speaker && !speaker.isHuman ? [{ playerId: speaker.id, actionKind: "speak" }] : [];
  }
  if (game.phase === "voting") {
    return game.players
      .filter((player) => !player.isHuman && !game.votes[player.id])
      .map((player) => ({ playerId: player.id, actionKind: "vote" as const }));
  }
  if (game.phase === "quest") {
    return game.players
      .filter((player) => !player.isHuman && game.proposal?.teamIds.includes(player.id) && !game.questCards[player.id])
      .map((player) => ({ playerId: player.id, actionKind: "quest" as const }));
  }
  if (game.phase === "assassination") {
    const assassin = game.players.find((player) => player.role === "assassin");
    return assassin && !assassin.isHuman ? [{ playerId: assassin.id, actionKind: "assassinate" }] : [];
  }

  return [];
}

function applyDecision(game: GameState, playerId: string, action: LegalAction): GameState {
  if (action.type === "proposeTeam") {
    return proposeTeam(game, playerId, action.teamIds);
  }
  if (action.type === "speak") {
    return advanceDiscussionTurn(game, playerId);
  }
  if (action.type === "vote") {
    return castVote(game, playerId, action.approve);
  }
  if (action.type === "quest") {
    return submitQuestCard(game, playerId, action.card);
  }
  return assassinateMerlin(game, playerId, action.targetId);
}

function phaseTitle(game: GameState | null, language: TableLanguage): string {
  if (!game) {
    return copy[language].newTable;
  }
  if (game.phase === "gameOver") {
    return `${game.winner?.toUpperCase()} ${copy[language].wins}`;
  }
  return phaseLabels[language][game.phase];
}

function formatPhaseCountdown(game: GameState, seconds: number, language: TableLanguage): string {
  if (game.phase === "gameOver") {
    return "";
  }
  const separator = language === "zh" ? "" : " ";
  return `${phaseLabels[language][game.phase]}${separator}${copy[language].countdown} ${seconds}${copy[language].seconds}`;
}

function roleLabel(role: Role, language: TableLanguage): string {
  return roleLabels[language][role];
}

function formatLatestQuestResult(game: GameState, language: TableLanguage): string {
  const latest = game.questResults[game.questResults.length - 1];
  const separator = language === "zh" ? "：" : ": ";
  return `${copy[language].questResult}${separator}${latest.failCards}${copy[language].failCardCount}`;
}

function visibleRole(game: GameState, player: Player, human: Player | undefined, language: TableLanguage): string {
  if (game.phase === "gameOver" || player.id === human?.id) {
    return roleLabel(player.role, language);
  }
  return player.isHuman ? copy[language].humanPlayer : copy[language].unknownRole;
}

function roleSkillText(player: Player, language: TableLanguage): string {
  if (language === "zh") {
    if (player.role === "merlin") {
      return "你知道除莫德雷德外的邪恶方；需要暗中带好人避开坏人，同时别让刺客看出你是梅林。";
    }
    if (player.role === "percival") {
      return "你会看到梅林/莫甘娜候选，但无法区分真假；你的目标是保护真梅林。";
    }
    if (player.role === "assassin") {
      return "邪恶方成员。若好人完成三次任务，你可以刺杀梅林，刺中则邪恶方翻盘。";
    }
    if (player.role === "morgana") {
      return "邪恶方成员，并会伪装成派西维尔眼中的梅林候选，扰乱好人判断。";
    }
    if (player.role === "mordred") {
      return "邪恶方成员，并且不会被梅林看见。";
    }
    if (player.role === "oberon") {
      return "邪恶方成员，但你不知道其他邪恶方，其他邪恶方也不知道你。";
    }
    if (player.role === "minion") {
      return "邪恶方成员。配合同伴混入队伍、制造失败任务，并帮助刺客找梅林。";
    }
    return "普通好人。你没有额外私密信息，需要根据发言、投票、队伍和任务结果推理。";
  }

  if (player.role === "merlin") {
    return "You know evil players except Mordred. Guide Good subtly without looking like Merlin to the Assassin.";
  }
  if (player.role === "percival") {
    return "You see Merlin/Morgana candidates but cannot tell which is real. Protect the real Merlin.";
  }
  if (player.role === "assassin") {
    return "You are evil. If Good completes three quests, assassinate Merlin to steal the win.";
  }
  if (player.role === "morgana") {
    return "You are evil and appear as a Merlin candidate to Percival.";
  }
  if (player.role === "mordred") {
    return "You are evil and hidden from Merlin.";
  }
  if (player.role === "oberon") {
    return "You are evil, but neither side of evil knows the other.";
  }
  if (player.role === "minion") {
    return "You are evil. Blend in, sabotage at the right time, and help the Assassin find Merlin.";
  }
  return "You have no private role power. Read proposals, votes, teams, and quest outcomes.";
}

function knownEvilLabel(human: Player, language: TableLanguage): string {
  if (language === "zh") {
    return human.allegiance === "evil" ? "邪恶同伴" : "已知邪恶";
  }
  return human.allegiance === "evil" ? "evil teammate" : "known evil";
}

function describeKnownPlayer(game: GameState, playerId: string, detail: string): string {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return playerId;
  }
  return `${player.id} · ${player.name} · ${detail}`;
}

function playerToneClass(player: Player): string {
  return `player-tone-${player.seat % 10}`;
}

function playerToneClassById(playerId: string): string {
  const match = /^p(\d+)$/.exec(playerId);
  const seat = match ? Number(match[1]) - 1 : 0;
  return `player-tone-${Math.max(0, seat) % 10}`;
}

function winReasonLabel(reason: GameState["winReason"], labels: typeof copy.en): string {
  const zh = labels.approveCount === "同意";
  if (reason === "questSuccesses") {
    return zh ? "三次任务成功，刺杀未命中梅林" : "Three quests succeeded and Merlin survived";
  }
  if (reason === "questFailures") {
    return zh ? "三次任务失败" : "Three quests failed";
  }
  if (reason === "voteTrack") {
    return zh ? "连续五次否决队伍" : "Five consecutive rejected proposals";
  }
  if (reason === "assassination") {
    return zh ? "刺客成功刺杀梅林" : "The Assassin found Merlin";
  }
  return "";
}

function playerName(game: GameState, playerId: string): string {
  return game.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function shuffledSeats(count: number): number[] {
  const seats = Array.from({ length: count }, (_, index) => index);
  for (let index = seats.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [seats[index], seats[swapIndex]] = [seats[swapIndex], seats[index]];
  }
  return seats;
}

function fallbackLogText(name: string, decision: AiDecisionResult, language: TableLanguage): string {
  if (language === "zh") {
    if (decision.fallbackReason === "api-timeout") {
      return `${name} 超时了，已使用本地兜底。`;
    }
    if (decision.fallbackReason === "missing-config") {
      return `${name} 没有可用 API 配置，已使用本地兜底。`;
    }
    if (decision.fallbackReason === "network-error") {
      return `${name} 网络请求失败，已使用本地兜底。`;
    }
    if (
      decision.fallbackReason === "invalid-json"
      || decision.fallbackReason === "illegal-action"
      || decision.fallbackReason?.startsWith("api-")
    ) {
      return `${name} 的 AI 输出不可用，已使用本地兜底。`;
    }
    return `${name} ${copy.zh.fallbackNotice}`;
  }

  if (decision.fallbackReason === "api-timeout") {
    return `${name} timed out; local fallback took over.`;
  }
  if (decision.fallbackReason === "missing-config") {
    return `${name} has no usable API config; local fallback took over.`;
  }
  if (decision.fallbackReason === "network-error") {
    return `${name} network request failed; local fallback took over.`;
  }
  if (
    decision.fallbackReason === "invalid-json"
    || decision.fallbackReason === "illegal-action"
    || decision.fallbackReason?.startsWith("api-")
  ) {
    return `${name} returned unusable AI output; local fallback took over.`;
  }
  return `${name} ${copy.en.fallbackNotice}`;
}

function describePublicActionEvents(previous: GameState, next: GameState, playerId: string, action: LegalAction, language: TableLanguage): PublicLogEvent[] {
  const labels = copy[language];
  const actor = playerName(previous, playerId);
  if (action.type === "proposeTeam") {
    return [{ text: `${actor} ${labels.proposed}: ${action.teamIds.join(", ")}.`, tone: "ai" }];
  }

  if (action.type === "speak") {
    return [];
  }

  if (action.type === "vote") {
    const votes = { ...previous.votes, [playerId]: action.approve ? "approve" as const : "reject" as const };
    if (Object.keys(votes).length < previous.players.length) {
      return [];
    }
    const approvals = Object.values(votes).filter((vote) => vote === "approve").length;
    const rejects = previous.players.length - approvals;
    const detail = previous.players.map((player) => `${player.id}: ${voteLabel(votes[player.id], language)}`).join(" · ");
    const separator = language === "zh" ? "：" : ": ";
    return [
      { text: `${labels.voteResult}${separator}${approvals}${labels.approveCount} / ${rejects}${labels.rejectCount}`, tone: "system" },
      { text: detail, tone: "system" }
    ];
  }

  if (action.type === "quest") {
    if (previous.phase !== "quest" || next.phase === "quest" || !next.questResults.length) {
      return [];
    }
    const result = next.questResults[next.questResults.length - 1];
    const separator = language === "zh" ? "：" : ": ";
    return [{ text: `${labels.questResult}${separator}${result.failCards}${labels.failCardCount}`, tone: result.succeeded ? "good" : "evil" }];
  }

  return [{ text: `${actor} ${labels.assassinated}: ${action.targetId}.`, tone: "evil" }];
}

function voteLabel(vote: "approve" | "reject" | undefined, language: TableLanguage): string {
  if (vote === "approve") {
    return copy[language].approved;
  }
  if (vote === "reject") {
    return copy[language].rejected;
  }
  return copy[language].none;
}

function getPhaseKey(game: GameState): string {
  return [
    game.phase,
    game.questIndex,
    game.failedVotes,
    game.leaderIndex,
    game.proposal?.leaderId ?? "",
    game.proposal?.teamIds.join(",") ?? "",
    game.discussion?.nextSpeakerIndex ?? "",
    game.discussion?.spokenIds.join(",") ?? ""
  ].join(":");
}

function buildAiRequestKey(game: GameState, action: { playerId: string; actionKind: AiActionKind }, sessionId: string): string {
  return [
    action.playerId,
    action.actionKind,
    sessionId,
    game.phase,
    game.questIndex,
    game.failedVotes,
    game.leaderIndex,
    game.proposal?.leaderId ?? "",
    game.proposal?.teamIds.join(",") ?? "",
    game.discussion?.nextSpeakerIndex ?? ""
  ].join(":");
}

function getPendingAiPlayers(game: GameState, pendingAi: string[], sessionId: string): Player[] {
  const ids = new Set(
    pendingAi
      .map((key) => key.split(":"))
      .filter((parts) => parts[2] === sessionId)
      .map((parts) => parts[0])
      .filter(Boolean)
  );
  return game.players.filter((player) => ids.has(player.id));
}

function formatPendingAiStatus(players: Player[], language: TableLanguage): string {
  if (players.length === 1) {
    return `${players[0].name} ${copy[language].thinkingNow}`;
  }
  return language === "zh" ? `${players.length} 位 AI ${copy[language].thinkingNow}` : `${players.length} AI ${copy[language].thinkingNow}`;
}

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is optional; rendering should keep working without storage.
  }

  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }
}

function readStoredAiConfig(): AiRuntimeConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AI_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<AiRuntimeConfig>;
    return {
      baseURL: typeof parsed.baseURL === "string" ? parsed.baseURL : DEFAULT_AI_CONFIG.baseURL,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : DEFAULT_AI_CONFIG.apiKey
    };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

function persistAiConfig(config: AiRuntimeConfig): void {
  try {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // AI config persistence is optional; users can still enter it for the current page.
  }
}

function EpiloguePanel({ game, human, language, labels }: { game: GameState; human?: Player; language: TableLanguage; labels: typeof copy.en }) {
  const aiPlayers = game.players.filter((player) => player.id !== human?.id);
  return (
    <div className="epilogue-panel">
      <div className="panel-title"><MessageCircle size={16} /> {labels.epilogue}</div>
      <div className="epilogue-list">
        {aiPlayers.map((player) => (
          <p key={player.id} className={`talk-entry ${playerToneClass(player)}`}>
            <strong>{player.name}</strong>
            <span>{epilogueLine(player, game, language)}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function epilogueLine(player: Player, game: GameState, language: TableLanguage): string {
  const won = player.allegiance === game.winner;
  if (language === "zh") {
    if (player.role === "assassin" && game.winReason === "assassination" && won) {
      return "最后那刀我盯了很久，带队太稳的人总会露一点痕迹。";
    }
    if (player.role === "merlin" && won) {
      return "这局我一直在绕着说，能把队伍带过去还没被抓出来，够险。";
    }
    if (player.allegiance === "evil" && won) {
      return "你们怀疑得太晚了，我前面那几次装好人票就是为了这一刻。";
    }
    if (player.allegiance === "evil") {
      return "差一点就把节奏搅乱了，下次我会更早把锅甩出去。";
    }
    if (won) {
      return "前面几轮信息终于串起来了，这次我没有白白紧张。";
    }
    return "可惜最后判断慢了一拍，有几处发言现在回看很不对劲。";
  }

  if (player.role === "assassin" && game.winReason === "assassination" && won) {
    return "I watched for the steady hidden hand, and the final blade found it.";
  }
  if (player.role === "merlin" && won) {
    return "I had to steer without sounding certain. That was closer than it looked.";
  }
  if (player.allegiance === "evil" && won) {
    return "You started doubting too late. Those clean votes were bait.";
  }
  if (player.allegiance === "evil") {
    return "Almost had the table tangled. Next time I throw the blame earlier.";
  }
  if (won) {
    return "The vote trail finally lined up. The nerves were useful for once.";
  }
  return "We were a step slow. A few speeches look much worse in hindsight.";
}

function formatSessionSummary(session: SavedSession, language: TableLanguage): string {
  const labels = copy[language];
  const phase = session.game.phase === "gameOver"
    ? `${session.game.winner?.toUpperCase()} ${labels.wins}`
    : phaseLabels[language][session.game.phase];
  const playerCount = language === "zh" ? `${session.game.playerCount}人` : `${session.game.playerCount} players`;
  const updatedAt = new Date(session.updatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${playerCount} · ${labels.quest} ${Math.min(session.game.questIndex + 1, 5)} · ${phase} · ${updatedAt}`;
}
