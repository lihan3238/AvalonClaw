import type { PublicTalkEntry, ReasoningEffort, TableLanguage } from "../ai/types";
import type { GameState } from "./types";

export const SESSIONS_STORAGE_KEY = "avalon-claw:sessions:v1";

export interface SavedLogEntry {
  id: number;
  tone: "system" | "good" | "evil" | "ai" | "warning";
  text: string;
}

export interface SavedSession {
  id: string;
  game: GameState;
  selectedTeam: string[];
  log: SavedLogEntry[];
  tableTalk?: PublicTalkEntry[];
  language: TableLanguage;
  reasoningEffort: ReasoningEffort;
  model: string;
  updatedAt: number;
}

type SavedSessionMap = Record<string, SavedSession>;

const ID_SPACE = 36 ** 4;

export function createSessionId(now = new Date(), random = Math.random): string {
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const saved = readSessionMap();
  const start = Math.floor(random() * ID_SPACE) % ID_SPACE;

  for (let offset = 0; offset < ID_SPACE; offset += 1) {
    const token = ((start + offset) % ID_SPACE).toString(36).toUpperCase().padStart(4, "0");
    const id = `AV-${datePart}-${token}`;
    if (!saved[id]) {
      return id;
    }
  }

  throw new Error("No free Avalon session ids remain for today");
}

export function saveSession(session: SavedSession): void {
  const sessions = readSessionMap();
  sessions[session.id] = cloneSession(session);
  writeSessionMap(sessions);
}

export function loadSession(id: string): SavedSession | null {
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }

  const session = readSessionMap()[trimmed];
  return session ? cloneSession(session) : null;
}

export function listSessions(): SavedSession[] {
  return Object.values(readSessionMap())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(cloneSession);
}

function readSessionMap(): SavedSessionMap {
  const storage = getStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const sessions: SavedSessionMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isSavedSession(value) && value.id === id) {
        sessions[id] = { ...value, tableTalk: value.tableTalk ?? [] };
      }
    }
    return sessions;
  } catch {
    return {};
  }
}

function writeSessionMap(sessions: SavedSessionMap): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSavedSession(value: unknown): value is SavedSession {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "string"
    && isGameState(value.game)
    && Array.isArray(value.selectedTeam)
    && value.selectedTeam.every((id) => typeof id === "string")
    && Array.isArray(value.log)
    && value.log.every(isSavedLogEntry)
    && (value.tableTalk === undefined || (Array.isArray(value.tableTalk) && value.tableTalk.every(isPublicTalkEntry)))
    && (value.language === "zh" || value.language === "en")
    && (value.reasoningEffort === "low" || value.reasoningEffort === "medium" || value.reasoningEffort === "high")
    && typeof value.model === "string"
    && typeof value.updatedAt === "number";
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.playerCount === "number"
    && Array.isArray(value.players)
    && typeof value.humanSeat === "number"
    && typeof value.phase === "string"
    && typeof value.leaderIndex === "number"
    && typeof value.questIndex === "number"
    && typeof value.failedVotes === "number"
    && isRecord(value.votes)
    && isRecord(value.questCards)
    && Array.isArray(value.questResults);
}

function isSavedLogEntry(value: unknown): value is SavedLogEntry {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "number"
    && (value.tone === "system" || value.tone === "good" || value.tone === "evil" || value.tone === "ai" || value.tone === "warning")
    && typeof value.text === "string";
}

function isPublicTalkEntry(value: unknown): value is PublicTalkEntry {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "number"
    && typeof value.speakerId === "string"
    && typeof value.speakerName === "string"
    && typeof value.text === "string";
}

function cloneSession(session: SavedSession): SavedSession {
  return {
    ...session,
    game: structuredClone(session.game),
    selectedTeam: [...session.selectedTeam],
    log: session.log.map((entry) => ({ ...entry })),
    tableTalk: (session.tableTalk ?? []).map((entry) => ({ ...entry }))
  };
}
