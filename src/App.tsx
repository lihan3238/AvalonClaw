import { Crown, History, LogIn, MessageCircle, RotateCcw, ScrollText, Send, Shield, Sparkles, Swords, Users, Vote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestAiAction } from "./ai/client";
import type { AiActionKind, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./ai/types";
import { getLegalActionsForPlayer } from "./game/legalActions";
import {
  assassinateMerlin,
  castVote,
  createInitialGame,
  getFailedQuestCount,
  getDefaultRoles,
  getQuestConfig,
  getRoleKnowledge,
  getSuccessfulQuestCount,
  proposeTeam,
  ROLE_DEFINITIONS,
  submitQuestCard
} from "./game/rules";
import { createSessionId, listSessions, loadSession, saveSession, type SavedLogEntry, type SavedSession } from "./game/sessionStore";
import type { GameState, Player, QuestCard } from "./game/types";

type LogEntry = SavedLogEntry;
type Theme = "dark" | "light";
type PublicLogEvent = Pick<LogEntry, "text" | "tone">;

const THEME_STORAGE_KEY = "avalon-claw:theme";

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
    noSavedGames: "No saved games yet.",
    start: "Start game",
    reset: "Reset",
    yourRole: "Your Role",
    roleSkill: "Role skill",
    privateInfo: "Private information",
    speak: "Speak",
    sendTalk: "Send speech",
    publicTalk: "Table Talk",
    leaderMarker: "Leader",
    countdown: "Phase countdown",
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
    fallback: "fallback",
    wins: "wins"
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
    noSavedGames: "暂无已保存对局。",
    start: "开始游戏",
    reset: "重置",
    yourRole: "你的身份",
    roleSkill: "职业技能",
    privateInfo: "私密信息",
    speak: "发言",
    sendTalk: "发送发言",
    publicTalk: "牌桌发言",
    leaderMarker: "队长",
    countdown: "流程倒计时",
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
    fallback: "fallback",
    wins: "获胜"
  }
} satisfies Record<TableLanguage, Record<string, string>>;

const phaseLabels = {
  en: {
    proposal: "Team proposal",
    voting: "Approval vote",
    quest: "Quest resolution",
    assassination: "Assassination"
  },
  zh: {
    proposal: "组队提案",
    voting: "队伍投票",
    quest: "任务结算",
    assassination: "刺杀梅林"
  }
} satisfies Record<TableLanguage, Record<Exclude<GameState["phase"], "gameOver">, string>>;

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [playerCount, setPlayerCount] = useState(5);
  const [humanSeat, setHumanSeat] = useState<number | "random">("random");
  const [language, setLanguage] = useState<TableLanguage>("zh");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [model, setModel] = useState("gpt-5.4-mini");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(() => listSessions());
  const [restoreId, setRestoreId] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [pendingAi, setPendingAi] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tableTalk, setTableTalk] = useState<PublicTalkEntry[]>([]);
  const [talkInput, setTalkInput] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [phaseDeadline, setPhaseDeadline] = useState(() => Date.now() + 60_000);
  const sessionIdRef = useRef<string | null>(null);
  const gameRef = useRef<GameState | null>(null);

  sessionIdRef.current = sessionId;
  gameRef.current = game;

  const human = game?.players.find((player) => player.isHuman);
  const leader = game ? game.players[game.leaderIndex] : null;
  const questConfig = game ? getQuestConfig(game.playerCount)[game.questIndex] : null;
  const humanKnowledge = game && human ? getRoleKnowledge(game, human.id) : null;
  const currentHumanAction = game && human ? getHumanAction(game, human.id) : null;
  const phaseKey = game ? getPhaseKey(game) : "setup";
  const countdownSeconds = game && game.phase !== "gameOver" ? Math.max(0, Math.ceil((phaseDeadline - clockNow) / 1000)) : null;
  const pendingAiPlayer = game && pendingAi ? getPendingAiPlayer(game, pendingAi) : null;

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

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
    if (!game || !sessionId || pendingAi || game.phase === "gameOver") {
      return;
    }

    const next = getNextAiAction(game);
    if (!next) {
      return;
    }

    const key = `${next.playerId}:${next.actionKind}:${game.phase}:${Object.keys(game.votes).length}:${Object.keys(game.questCards).length}`;
    const requestSessionId = sessionId;
    setPendingAi(key);
    const legalActions = getLegalActionsForPlayer(game, next.playerId, next.actionKind);
    void requestAiAction({ state: game, playerId: next.playerId, actionKind: next.actionKind, legalActions, tableTalk, reasoningEffort, language, model }).then((decision) => {
      if (sessionIdRef.current !== requestSessionId) {
        return;
      }
      const current = gameRef.current;
      if (!current || current.phase === "gameOver") {
        setPendingAi((active) => active === key ? null : active);
        return;
      }
      try {
        const nextGame = applyDecision(current, next.playerId, decision.action);
        appendTableTalk(
          next.playerId,
          playerName(current, next.playerId),
          decision.source === "fallback" ? `${decision.speech} (${copy[language].fallback})` : decision.speech
        );
        for (const entry of describePublicActionEvents(current, nextGame, next.playerId, decision.action, language)) {
          appendLog(entry.text, entry.tone);
        }
        setGame(nextGame);
      } catch {
        // Ignore illegal/stale AI actions; fallback prompting will retry from the current state.
      }
      setPendingAi((current) => current === key ? null : current);
    });
  }, [game, sessionId, pendingAi, tableTalk, reasoningEffort, language, model]);

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
    setGame(newGame);
    setSelectedTeam([newGame.players[newGame.leaderIndex].id]);
    setRestoreError("");
    setRestoreId("");
    setTableTalk([]);
    setTalkInput("");
    setLog([
      {
        id: Date.now(),
        tone: "system",
        text: `${copy[language].started}. ${copy[language].yourRole}: ${ROLE_DEFINITIONS[newGame.players[resolvedHumanSeat].role].label}.`
      }
    ]);
  }

  function restartGame() {
    setSessionId(null);
    setGame(null);
    setSelectedTeam([]);
    setPendingAi(null);
    setLog([]);
    setTableTalk([]);
    setTalkInput("");
    setRestoreError("");
    setSavedSessions(listSessions());
  }

  function restoreGameById(id = restoreId) {
    const saved = loadSession(id);
    if (!saved) {
      setRestoreError(copy[language].restoreMissing);
      return;
    }

    setSessionId(saved.id);
    setPlayerCount(saved.game.playerCount);
    setHumanSeat(saved.game.humanSeat);
    setLanguage(saved.language);
    setReasoningEffort(saved.reasoningEffort);
    setModel(saved.model);
    setGame(saved.game);
    setSelectedTeam(saved.selectedTeam);
    setLog(saved.log);
    setTableTalk(saved.tableTalk ?? []);
    setTalkInput("");
    setPendingAi(null);
    setRestoreId(saved.id);
    setRestoreError("");
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

  function submitHumanTalk() {
    if (!game || !human) {
      return;
    }
    const text = talkInput.trim();
    if (!text) {
      return;
    }
    appendTableTalk(human.id, human.name, text);
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
    const nextGame = proposeTeam(game, human.id, selectedTeam);
    setGame(nextGame);
    for (const entry of describePublicActionEvents(game, nextGame, human.id, { type: "proposeTeam", teamIds: selectedTeam }, language)) {
      appendLog(entry.text, entry.tone);
    }
  }

  function submitHumanVote(approve: boolean) {
    if (!game || !human) {
      return;
    }
    const action: LegalAction = { type: "vote", approve };
    const nextGame = castVote(game, human.id, approve);
    setGame(nextGame);
    for (const entry of describePublicActionEvents(game, nextGame, human.id, action, language)) {
      appendLog(entry.text, entry.tone);
    }
  }

  function submitHumanQuest(card: QuestCard) {
    if (!game || !human) {
      return;
    }
    const action: LegalAction = { type: "quest", card };
    const nextGame = submitQuestCard(game, human.id, card);
    setGame(nextGame);
    for (const entry of describePublicActionEvents(game, nextGame, human.id, action, language)) {
      appendLog(entry.text, entry.tone);
    }
  }

  function submitHumanAssassination(targetId: string) {
    if (!game || !human) {
      return;
    }
    const action: LegalAction = { type: "assassinate", targetId };
    const nextGame = assassinateMerlin(game, human.id, targetId);
    setGame(nextGame);
    for (const entry of describePublicActionEvents(game, nextGame, human.id, action, language)) {
      appendLog(entry.text, entry.tone);
    }
  }

  const roleSummary = useMemo(() => {
    if (!game || !human || !humanKnowledge) {
      return null;
    }
    const knownEvil = humanKnowledge.knownEvilIds.length
      ? humanKnowledge.knownEvilIds.map((id) => describeKnownPlayer(game, id, true, language))
      : [copy[language].none];
    const merlinCandidates = humanKnowledge.merlinCandidateIds.length
      ? humanKnowledge.merlinCandidateIds.map((id) => describeKnownPlayer(game, id, false, language))
      : [copy[language].none];
    return [
      `${copy[language].knownEvil}:`,
      ...knownEvil,
      `${copy[language].merlinCandidates}:`,
      ...merlinCandidates
    ];
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
            </select>
          </label>
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
              {savedSessions.length ? (
                <div className="saved-session-list">
                  {savedSessions.map((session) => (
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
            </div>
          )}
          <div className="button-row">
            <button className="primary" onClick={startGame} disabled={Boolean(game)}><Send size={16} /> {copy[language].start}</button>
            <button className="secondary icon-text" onClick={restartGame}><RotateCcw size={16} /> {copy[language].reset}</button>
          </div>
        </div>

        {game && human && (
          <div className={`panel role-panel ${human.allegiance}`}>
            <div className="panel-title"><Shield size={16} /> {copy[language].yourRole}</div>
            <h2>{ROLE_DEFINITIONS[human.role].label}</h2>
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
            {countdownSeconds !== null && <span>{copy[language].countdown} {countdownSeconds}{copy[language].seconds}</span>}
          </div>}
        </header>

        {game ? (
          <>
            <QuestTrack game={game} language={language} />
            <div className="table-card">
              <div className="table-center">
                <div className="leader-chip"><Crown size={16} /> {copy[language].leader}: {leader?.name}</div>
                <div className={`phase-chip ${pendingAi ? "thinking" : ""}`}>
                  {pendingAiPlayer ? `${pendingAiPlayer.name} ${copy[language].thinkingNow}` : currentHumanAction ? copy[language].yourDecision : copy[language].resolving}
                </div>
              </div>
              <div className="players-grid">
                {game.players.map((player) => (
                  <button
                    type="button"
                    key={player.id}
                    className={`player-seat ${player.isHuman ? "human" : ""} ${leader?.id === player.id ? "leader" : ""} ${selectedTeam.includes(player.id) ? "selected" : ""} ${playerToneClass(player)}`}
                    onClick={() => game.phase === "proposal" && leader?.isHuman ? toggleTeam(player.id) : undefined}
                  >
                    <span><b>{player.id}</b> {player.name} {leader?.id === player.id && <em>{copy[language].leaderMarker}</em>}</span>
                    <small>{visibleRole(game, player, human, language)}</small>
                  </button>
                ))}
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
              <textarea value={talkInput} onChange={(event) => setTalkInput(event.target.value)} rows={3} />
              <button type="button" className="primary" onClick={submitHumanTalk} disabled={!talkInput.trim()}><Send size={16} /> {copy[language].sendTalk}</button>
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
        <span>{roles.map((role) => ROLE_DEFINITIONS[role.role].label).join(" · ")}</span>
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
    return <div className="decision-panel result-panel"><strong>{props.game.winner?.toUpperCase()} {props.labels.wins}</strong><span>{props.game.winReason}</span></div>;
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
        {props.game.players.filter((player) => player.id !== props.human?.id).map((player) => (
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
            <small>{quest.failsRequired} {failLabel}{language === "en" && quest.failsRequired > 1 ? "s" : ""}</small>
          </div>
        );
      })}
    </div>
  );
}

function getHumanAction(game: GameState, humanId: string): AiActionKind | null {
  if (game.phase === "proposal" && game.players[game.leaderIndex].id === humanId) {
    return "proposeTeam";
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

function getNextAiAction(game: GameState): { playerId: string; actionKind: AiActionKind } | null {
  if (game.phase === "proposal") {
    const leader = game.players[game.leaderIndex];
    return leader.isHuman ? null : { playerId: leader.id, actionKind: "proposeTeam" };
  }
  if (game.phase === "voting") {
    const voter = game.players.find((player) => !player.isHuman && !game.votes[player.id]);
    return voter ? { playerId: voter.id, actionKind: "vote" } : null;
  }
  if (game.phase === "quest") {
    const quester = game.players.find((player) => !player.isHuman && game.proposal?.teamIds.includes(player.id) && !game.questCards[player.id]);
    return quester ? { playerId: quester.id, actionKind: "quest" } : null;
  }
  if (game.phase === "assassination") {
    const assassin = game.players.find((player) => player.role === "assassin");
    return assassin && !assassin.isHuman ? { playerId: assassin.id, actionKind: "assassinate" } : null;
  }

  return null;
}

function applyDecision(game: GameState, playerId: string, action: LegalAction): GameState {
  if (action.type === "proposeTeam") {
    return proposeTeam(game, playerId, action.teamIds);
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

function formatLatestQuestResult(game: GameState, language: TableLanguage): string {
  const latest = game.questResults[game.questResults.length - 1];
  const separator = language === "zh" ? "：" : ": ";
  return `${copy[language].questResult}${separator}${latest.failCards}${copy[language].failCardCount}`;
}

function visibleRole(game: GameState, player: Player, human: Player | undefined, language: TableLanguage): string {
  if (game.phase === "gameOver" || player.id === human?.id) {
    return ROLE_DEFINITIONS[player.role].label;
  }
  return player.isHuman ? copy[language].you : copy[language].unknownRole;
}

function roleSkillText(player: Player, language: TableLanguage): string {
  if (language === "zh") {
    if (player.role === "merlin") {
      return "你知道除 Mordred 外的邪恶方；需要暗中带好人避开坏人，同时别让 Assassin 看出你是 Merlin。";
    }
    if (player.role === "percival") {
      return "你会看到 Merlin/Morgana 两名候选，但无法区分真假；你的目标是保护真 Merlin。";
    }
    if (player.role === "assassin") {
      return "邪恶方成员。若好人完成三次任务，你可以刺杀 Merlin，刺中则邪恶方翻盘。";
    }
    if (player.role === "morgana") {
      return "邪恶方成员，并会伪装成 Percival 眼中的 Merlin 候选，扰乱好人判断。";
    }
    if (player.role === "mordred") {
      return "邪恶方成员，并且不会被 Merlin 看见。";
    }
    if (player.role === "oberon") {
      return "邪恶方成员，但你不知道其他邪恶方，其他邪恶方也不知道你。";
    }
    if (player.role === "minion") {
      return "邪恶方成员。配合同伴混入队伍、制造失败任务，并帮助 Assassin 找 Merlin。";
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

function describeKnownPlayer(game: GameState, playerId: string, revealRole: boolean, language: TableLanguage): string {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return playerId;
  }
  const suffix = revealRole
    ? ROLE_DEFINITIONS[player.role].label
    : language === "zh" ? "Merlin/Morgana 候选" : "Merlin/Morgana candidate";
  return `${player.id} · ${player.name} · ${suffix}`;
}

function playerToneClass(player: Player): string {
  return `player-tone-${player.seat % 10}`;
}

function playerToneClassById(playerId: string): string {
  const match = /^p(\d+)$/.exec(playerId);
  const seat = match ? Number(match[1]) - 1 : 0;
  return `player-tone-${Math.max(0, seat) % 10}`;
}

function playerName(game: GameState, playerId: string): string {
  return game.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function describePublicActionEvents(previous: GameState, next: GameState, playerId: string, action: LegalAction, language: TableLanguage): PublicLogEvent[] {
  const labels = copy[language];
  const actor = playerName(previous, playerId);
  const actorTone = previous.players.find((player) => player.id === playerId)?.allegiance ?? "system";

  if (action.type === "proposeTeam") {
    return [{ text: `${actor} ${labels.proposed}: ${action.teamIds.join(", ")}.`, tone: actorTone }];
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
    game.proposal?.teamIds.join(",") ?? ""
  ].join(":");
}

function getPendingAiPlayer(game: GameState, pendingAi: string): Player | null {
  const [playerId] = pendingAi.split(":");
  return game.players.find((player) => player.id === playerId) ?? null;
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
