import type { LegalAction, PublicTalkEntry, TableLanguage } from "../ai/types";
import type { SavedLogEntry } from "../game/sessionStore";
import type { GameState, RoleKnowledge } from "../game/types";

// Thin browser client for /api/room. Every helper resolves to null on
// network/protocol failure so multiplayer stays optional: the table keeps
// working locally when the room service is unreachable.

export type RoomStatus = "lobby" | "playing" | "ended";

export interface RoomMemberSummary {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  seat: number | null;
}

export interface RoomStateSlice {
  game: GameState;
  knowledge: RoleKnowledge;
  tableTalk: PublicTalkEntry[];
  log: SavedLogEntry[];
  version: number;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  playerCount: number;
  language: TableLanguage;
  members: RoomMemberSummary[];
  you: { id: string; name: string; isHost: boolean; ready: boolean; seat: number | null };
  version: number;
  state?: RoomStateSlice;
}

export interface RoomStatePayload {
  game: GameState;
  tableTalk: PublicTalkEntry[];
  log: SavedLogEntry[];
  version: number;
}

export interface PendingRoomAction {
  id: number;
  seat: number;
  action?: LegalAction;
  talk?: string;
  submittedAt: number;
}

export interface RoomErrorInfo {
  error: string;
  code?: string;
}

export async function createRoomOnServer(input: {
  code: string;
  playerCount: number;
  language: TableLanguage;
  name: string;
}): Promise<{ hostToken: string; snapshot: RoomSnapshot } | null> {
  const result = await postRoom({ op: "create", ...input });
  return isRecord(result) && typeof result.hostToken === "string" && isRecord(result.snapshot)
    ? { hostToken: result.hostToken, snapshot: result.snapshot as unknown as RoomSnapshot }
    : null;
}

export async function joinRoomOnServer(input: { code: string; name: string }): Promise<{ token: string; snapshot: RoomSnapshot } | RoomErrorInfo | null> {
  const result = await postRoom({ op: "join", ...input });
  if (isRecord(result) && typeof result.token === "string" && isRecord(result.snapshot)) {
    return { token: result.token, snapshot: result.snapshot as unknown as RoomSnapshot };
  }
  if (isRecord(result) && typeof result.error === "string") {
    return { error: result.error, code: typeof result.code === "string" ? result.code : undefined };
  }
  return null;
}

export async function leaveRoomOnServer(input: { code: string; token: string }): Promise<void> {
  await postRoom({ op: "leave", ...input });
}

export async function setRoomReady(input: { code: string; token: string; ready: boolean }): Promise<RoomSnapshot | null> {
  const result = await postRoom({ op: "ready", ...input });
  return isRecord(result) && isRecord(result.snapshot) ? result.snapshot as unknown as RoomSnapshot : null;
}

export async function startRoomOnServer(input: {
  code: string;
  token: string;
  state: RoomStatePayload;
  seatByMemberId: Record<string, number>;
}): Promise<RoomSnapshot | RoomErrorInfo | null> {
  const result = await postRoom({ op: "start", ...input });
  if (isRecord(result) && isRecord(result.snapshot)) {
    return result.snapshot as unknown as RoomSnapshot;
  }
  if (isRecord(result) && typeof result.error === "string") {
    return { error: result.error, code: typeof result.code === "string" ? result.code : undefined };
  }
  return null;
}

export async function pushRoomStateToServer(input: { code: string; token: string; state: RoomStatePayload }): Promise<void> {
  await postRoom({ op: "push-state", ...input });
}

export async function fetchRoomSnapshot(input: { code: string; token: string; sinceVersion?: number }): Promise<RoomSnapshot | null> {
  const result = await postRoom({ op: "snapshot", ...input });
  return isRecord(result) && isRecord(result.snapshot) ? result.snapshot as unknown as RoomSnapshot : null;
}

export async function submitRoomActionToServer(input: {
  code: string;
  token: string;
  action?: LegalAction;
  talk?: string;
}): Promise<boolean> {
  const result = await postRoom({ op: "submit-action", ...input });
  return isRecord(result) && result.ok === true;
}

export async function drainRoomActionsFromServer(input: { code: string; token: string }): Promise<PendingRoomAction[]> {
  const result = await postRoom({ op: "drain-actions", code: input.code, token: input.token });
  return isRecord(result) && Array.isArray(result.actions) ? result.actions as PendingRoomAction[] : [];
}

async function postRoom(body: Record<string, unknown>): Promise<unknown> {
  try {
    const response = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
