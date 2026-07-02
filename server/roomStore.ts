import type { LegalAction, PublicTalkEntry, TableLanguage } from "../src/ai/types";
import { redactGameForSeat, type RedactedGameView } from "../src/game/multiplayerView";
import type { SavedLogEntry } from "../src/game/sessionStore";
import type { GameState } from "../src/game/types";

// In-memory multiplayer room registry. The host browser stays the game driver:
// it pushes full authoritative state here, guests poll per-seat redacted views,
// and guest actions queue here until the host drains and applies them.

export type RoomStatus = "lobby" | "playing" | "ended";

export interface RoomMember {
  id: string;
  token: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  seat: number | null;
  joinedAt: number;
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

interface Room {
  code: string;
  status: RoomStatus;
  playerCount: number;
  language: TableLanguage;
  members: RoomMember[];
  nextMemberId: number;
  state: RoomStatePayload | null;
  pendingActions: PendingRoomAction[];
  nextActionId: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoomMemberSummary {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  seat: number | null;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  playerCount: number;
  language: TableLanguage;
  members: RoomMemberSummary[];
  you: { id: string; name: string; isHost: boolean; ready: boolean; seat: number | null };
  version: number;
  state?: {
    game: RedactedGameView["game"];
    knowledge: RedactedGameView["knowledge"];
    tableTalk: PublicTalkEntry[];
    log: SavedLogEntry[];
    version: number;
  };
}

export class RoomError extends Error {
  code: "not-found" | "forbidden" | "room-full" | "already-started" | "invalid";

  constructor(code: RoomError["code"], message: string) {
    super(message);
    this.name = "RoomError";
    this.code = code;
  }
}

const ROOM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{4,31}$/u;
const MAX_ROOMS = 200;
const LOBBY_TTL_MS = 3 * 60 * 60 * 1000;
const ENDED_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_ACTIONS = 64;
const MAX_NAME_CHARS = 24;

const rooms = new Map<string, Room>();

export function resetRooms(): void {
  rooms.clear();
}

export function createRoom(input: {
  code: string;
  playerCount: number;
  language: TableLanguage;
  hostName: string;
  now?: number;
}): { hostToken: string; snapshot: RoomSnapshot } {
  const now = input.now ?? Date.now();
  sweepRooms(now);
  const code = normalizeRoomCode(input.code);
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new RoomError("invalid", `Invalid room code ${input.code}`);
  }
  if (!Number.isInteger(input.playerCount) || input.playerCount < 5 || input.playerCount > 10) {
    throw new RoomError("invalid", "Room player count must be 5-10");
  }
  if (rooms.has(code)) {
    throw new RoomError("invalid", `Room ${code} already exists`);
  }
  if (rooms.size >= MAX_ROOMS) {
    throw new RoomError("invalid", "Too many active rooms");
  }

  const hostToken = createToken();
  const room: Room = {
    code,
    status: "lobby",
    playerCount: input.playerCount,
    language: input.language === "en" ? "en" : "zh",
    members: [{
      id: "m1",
      token: hostToken,
      name: normalizeMemberName(input.hostName),
      isHost: true,
      ready: true,
      seat: null,
      joinedAt: now
    }],
    nextMemberId: 2,
    state: null,
    pendingActions: [],
    nextActionId: 1,
    createdAt: now,
    updatedAt: now
  };
  rooms.set(code, room);
  return { hostToken, snapshot: snapshotForToken(room, hostToken, -1) };
}

export function joinRoom(input: { code: string; name: string; now?: number }): { token: string; snapshot: RoomSnapshot } {
  const now = input.now ?? Date.now();
  sweepRooms(now);
  const room = requireRoom(input.code);
  if (room.status !== "lobby") {
    throw new RoomError("already-started", `Room ${room.code} already started`);
  }
  if (room.members.length >= room.playerCount) {
    throw new RoomError("room-full", `Room ${room.code} is full`);
  }

  const token = createToken();
  room.members.push({
    id: `m${room.nextMemberId}`,
    token,
    name: normalizeMemberName(input.name),
    isHost: false,
    ready: false,
    seat: null,
    joinedAt: now
  });
  room.nextMemberId += 1;
  room.updatedAt = now;
  return { token, snapshot: snapshotForToken(room, token, -1) };
}

export function leaveRoom(input: { code: string; token: string; now?: number }): void {
  const room = rooms.get(normalizeRoomCode(input.code));
  if (!room) {
    return;
  }
  const member = room.members.find((candidate) => candidate.token === input.token);
  if (!member) {
    return;
  }
  if (member.isHost) {
    rooms.delete(room.code);
    return;
  }
  if (room.status === "lobby") {
    room.members = room.members.filter((candidate) => candidate.token !== input.token);
    room.updatedAt = input.now ?? Date.now();
  }
}

export function setMemberReady(input: { code: string; token: string; ready: boolean; now?: number }): RoomSnapshot {
  const room = requireRoom(input.code);
  const member = requireMember(room, input.token);
  if (room.status !== "lobby") {
    throw new RoomError("already-started", `Room ${room.code} already started`);
  }
  member.ready = member.isHost ? true : input.ready;
  room.updatedAt = input.now ?? Date.now();
  return snapshotForToken(room, input.token, -1);
}

export function startRoom(input: {
  code: string;
  hostToken: string;
  state: RoomStatePayload;
  seatByMemberId: Record<string, number>;
  now?: number;
}): RoomSnapshot {
  const room = requireRoom(input.code);
  const host = requireMember(room, input.hostToken);
  if (!host.isHost) {
    throw new RoomError("forbidden", "Only the host can start the room");
  }
  if (room.status !== "lobby") {
    throw new RoomError("already-started", `Room ${room.code} already started`);
  }
  if (!room.members.every((member) => member.isHost || member.ready)) {
    throw new RoomError("invalid", "All joined players must be ready before start");
  }

  const usedSeats = new Set<number>();
  for (const member of room.members) {
    const seat = input.seatByMemberId[member.id];
    if (!Number.isInteger(seat) || seat < 0 || seat >= input.state.game.players.length || usedSeats.has(seat)) {
      throw new RoomError("invalid", `Missing or duplicate seat for member ${member.name}`);
    }
    usedSeats.add(seat);
    member.seat = seat;
  }

  room.state = cloneStatePayload(input.state);
  room.status = "playing";
  room.updatedAt = input.now ?? Date.now();
  return snapshotForToken(room, input.hostToken, -1);
}

export function pushRoomState(input: { code: string; hostToken: string; state: RoomStatePayload; now?: number }): void {
  const room = requireRoom(input.code);
  const host = requireMember(room, input.hostToken);
  if (!host.isHost) {
    throw new RoomError("forbidden", "Only the host can push room state");
  }
  if (room.status === "lobby") {
    throw new RoomError("invalid", "Room has not started");
  }
  if (room.state && input.state.version <= room.state.version) {
    return;
  }
  room.state = cloneStatePayload(input.state);
  if (input.state.game.phase === "gameOver") {
    room.status = "ended";
  }
  room.updatedAt = input.now ?? Date.now();
}

export function getRoomSnapshot(input: { code: string; token: string; sinceVersion?: number; now?: number }): RoomSnapshot {
  sweepRooms(input.now ?? Date.now());
  const room = requireRoom(input.code);
  requireMember(room, input.token);
  return snapshotForToken(room, input.token, input.sinceVersion ?? -1);
}

export function submitRoomAction(input: {
  code: string;
  token: string;
  action?: LegalAction;
  talk?: string;
  now?: number;
}): void {
  const room = requireRoom(input.code);
  const member = requireMember(room, input.token);
  if (room.status !== "playing") {
    throw new RoomError("invalid", "Room is not in a playable state");
  }
  if (member.seat === null) {
    throw new RoomError("forbidden", "Member has no seat in this game");
  }
  if (!input.action && !normalizeTalk(input.talk)) {
    throw new RoomError("invalid", "Action submissions need an action or talk text");
  }
  if (room.pendingActions.length >= MAX_PENDING_ACTIONS) {
    throw new RoomError("invalid", "Too many queued actions");
  }

  room.pendingActions.push({
    id: room.nextActionId,
    seat: member.seat,
    ...(input.action ? { action: input.action } : {}),
    ...(normalizeTalk(input.talk) ? { talk: normalizeTalk(input.talk) } : {}),
    submittedAt: input.now ?? Date.now()
  });
  room.nextActionId += 1;
  room.updatedAt = input.now ?? Date.now();
}

export function drainRoomActions(input: { code: string; hostToken: string; now?: number }): PendingRoomAction[] {
  const room = requireRoom(input.code);
  const host = requireMember(room, input.hostToken);
  if (!host.isHost) {
    throw new RoomError("forbidden", "Only the host can drain room actions");
  }
  const drained = room.pendingActions;
  room.pendingActions = [];
  if (drained.length) {
    room.updatedAt = input.now ?? Date.now();
  }
  return drained;
}

function snapshotForToken(room: Room, token: string, sinceVersion: number): RoomSnapshot {
  const member = requireMember(room, token);
  const snapshot: RoomSnapshot = {
    code: room.code,
    status: room.status,
    playerCount: room.playerCount,
    language: room.language,
    members: room.members.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      isHost: candidate.isHost,
      ready: candidate.ready,
      seat: candidate.seat
    })),
    you: { id: member.id, name: member.name, isHost: member.isHost, ready: member.ready, seat: member.seat },
    version: room.state?.version ?? 0
  };

  if (room.state && member.seat !== null && room.state.version > sinceVersion) {
    const redacted = member.isHost
      ? { game: room.state.game, knowledge: { knownEvilIds: [], merlinCandidateIds: [] } }
      : redactGameForSeat(room.state.game, member.seat);
    snapshot.state = {
      game: redacted.game,
      knowledge: redacted.knowledge,
      tableTalk: room.state.tableTalk,
      log: room.state.log,
      version: room.state.version
    };
  }

  return snapshot;
}

function requireRoom(code: string): Room {
  const room = rooms.get(normalizeRoomCode(code));
  if (!room) {
    throw new RoomError("not-found", `Room ${code} not found`);
  }
  return room;
}

function requireMember(room: Room, token: string): RoomMember {
  const member = room.members.find((candidate) => candidate.token === token);
  if (!member) {
    throw new RoomError("forbidden", "Unknown room member token");
  }
  return member;
}

function sweepRooms(now: number): void {
  for (const [code, room] of rooms) {
    const ttl = room.status === "ended" ? ENDED_TTL_MS : LOBBY_TTL_MS;
    if (now - room.updatedAt > ttl) {
      rooms.delete(code);
    }
  }
}

function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeMemberName(name: string): string {
  const trimmed = name.replace(/\s+/gu, " ").trim().slice(0, MAX_NAME_CHARS);
  return trimmed || "Player";
}

function normalizeTalk(talk: string | undefined): string | undefined {
  const trimmed = talk?.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

function cloneStatePayload(state: RoomStatePayload): RoomStatePayload {
  return structuredClone(state);
}

function createToken(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }
  return `t-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
