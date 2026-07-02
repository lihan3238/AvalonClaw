import { createInitialGame } from "../src/game/rules";
import {
  createRoom,
  drainRoomActions,
  getRoomSnapshot,
  joinRoom,
  leaveRoom,
  pushRoomState,
  resetRooms,
  RoomError,
  setMemberReady,
  startRoom,
  submitRoomAction,
  type RoomStatePayload
} from "./roomStore";

function buildStatePayload(version = 1): RoomStatePayload {
  return {
    game: createInitialGame({ playerCount: 5, humanSeat: 0, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] }),
    tableTalk: [],
    log: [],
    version
  };
}

describe("multiplayer room store", () => {
  beforeEach(() => {
    resetRooms();
  });

  it("creates a lobby, lets guests join by code, and tracks ready state", () => {
    const { hostToken, snapshot } = createRoom({ code: "AV-20260702-ROOM", playerCount: 5, language: "zh", hostName: "Host" });
    expect(snapshot.status).toBe("lobby");
    expect(snapshot.members).toEqual([{ id: "m1", name: "Host", isHost: true, ready: true, seat: null }]);

    const guest = joinRoom({ code: "av-20260702-room", name: "Guest One" });
    expect(guest.snapshot.members).toHaveLength(2);

    const readied = setMemberReady({ code: "AV-20260702-ROOM", token: guest.token, ready: true });
    expect(readied.members.find((member) => member.name === "Guest One")?.ready).toBe(true);

    const hostView = getRoomSnapshot({ code: "AV-20260702-ROOM", token: hostToken });
    expect(hostView.members.find((member) => member.name === "Guest One")?.ready).toBe(true);
  });

  it("rejects joining a full or started room and unknown codes", () => {
    const { hostToken } = createRoom({ code: "AV-ROOM1", playerCount: 5, language: "zh", hostName: "Host" });
    const guests = ["A", "B", "C", "D"].map((name) => joinRoom({ code: "AV-ROOM1", name }));
    expect(() => joinRoom({ code: "AV-ROOM1", name: "E" })).toThrow(RoomError);

    for (const guest of guests) {
      setMemberReady({ code: "AV-ROOM1", token: guest.token, ready: true });
    }
    startRoom({
      code: "AV-ROOM1",
      hostToken,
      state: buildStatePayload(),
      seatByMemberId: Object.fromEntries([["m1", 0], ...guests.map((_guest, index) => [`m${index + 2}`, index + 1])])
    });

    expect(() => joinRoom({ code: "AV-ROOM1", name: "Late" })).toThrow(/already started/);
    expect(() => getRoomSnapshot({ code: "AV-MISSING", token: "x" })).toThrow(/not found/);
  });

  it("blocks start until every guest is ready and validates seats", () => {
    const { hostToken } = createRoom({ code: "AV-ROOM2", playerCount: 5, language: "zh", hostName: "Host" });
    const guest = joinRoom({ code: "AV-ROOM2", name: "Guest" });

    expect(() => startRoom({
      code: "AV-ROOM2",
      hostToken,
      state: buildStatePayload(),
      seatByMemberId: { m1: 0, m2: 1 }
    })).toThrow(/ready/);

    setMemberReady({ code: "AV-ROOM2", token: guest.token, ready: true });
    expect(() => startRoom({
      code: "AV-ROOM2",
      hostToken,
      state: buildStatePayload(),
      seatByMemberId: { m1: 0, m2: 0 }
    })).toThrow(/seat/);

    const started = startRoom({
      code: "AV-ROOM2",
      hostToken,
      state: buildStatePayload(),
      seatByMemberId: { m1: 0, m2: 3 }
    });
    expect(started.status).toBe("playing");
    expect(started.members.find((member) => !member.isHost)?.seat).toBe(3);
  });

  it("serves guests seat-redacted state and hides other roles", () => {
    const { hostToken } = createRoom({ code: "AV-ROOM3", playerCount: 5, language: "zh", hostName: "Host" });
    const guest = joinRoom({ code: "AV-ROOM3", name: "Guest" });
    setMemberReady({ code: "AV-ROOM3", token: guest.token, ready: true });
    startRoom({
      code: "AV-ROOM3",
      hostToken,
      state: buildStatePayload(),
      seatByMemberId: { m1: 0, m2: 3 }
    });

    const guestView = getRoomSnapshot({ code: "AV-ROOM3", token: guest.token });
    expect(guestView.state).toBeDefined();
    expect(guestView.state?.game.humanSeat).toBe(3);
    expect(guestView.state?.game.players[3].role).toBe("assassin");
    expect(guestView.state?.game.players[0].role).toBe("loyal");
    expect(guestView.state?.knowledge.knownEvilIds).toEqual(["p5"]);

    const unchanged = getRoomSnapshot({ code: "AV-ROOM3", token: guest.token, sinceVersion: 1 });
    expect(unchanged.state).toBeUndefined();
    expect(unchanged.version).toBe(1);
  });

  it("queues guest actions for the host and drains them once", () => {
    const { hostToken } = createRoom({ code: "AV-ROOM4", playerCount: 5, language: "zh", hostName: "Host" });
    const guest = joinRoom({ code: "AV-ROOM4", name: "Guest" });
    setMemberReady({ code: "AV-ROOM4", token: guest.token, ready: true });
    startRoom({
      code: "AV-ROOM4",
      hostToken,
      state: buildStatePayload(),
      seatByMemberId: { m1: 0, m2: 1 }
    });

    submitRoomAction({ code: "AV-ROOM4", token: guest.token, action: { type: "vote", approve: true } });
    submitRoomAction({ code: "AV-ROOM4", token: guest.token, talk: "我觉得这队可以。" });

    expect(() => drainRoomActions({ code: "AV-ROOM4", hostToken: guest.token })).toThrow(/host/);

    const drained = drainRoomActions({ code: "AV-ROOM4", hostToken });
    expect(drained).toHaveLength(2);
    expect(drained[0]).toMatchObject({ seat: 1, action: { type: "vote", approve: true } });
    expect(drained[1]).toMatchObject({ seat: 1, talk: "我觉得这队可以。" });
    expect(drainRoomActions({ code: "AV-ROOM4", hostToken })).toHaveLength(0);
  });

  it("accepts newer host state pushes, ignores stale ones, and ends the room at game over", () => {
    const { hostToken } = createRoom({ code: "AV-ROOM5", playerCount: 5, language: "zh", hostName: "Host" });
    const guest = joinRoom({ code: "AV-ROOM5", name: "Guest" });
    setMemberReady({ code: "AV-ROOM5", token: guest.token, ready: true });
    startRoom({
      code: "AV-ROOM5",
      hostToken,
      state: buildStatePayload(1),
      seatByMemberId: { m1: 0, m2: 1 }
    });

    const newer = buildStatePayload(2);
    newer.tableTalk = [{ id: 1, speakerId: "p1", speakerName: "Host", text: "hello" }];
    pushRoomState({ code: "AV-ROOM5", hostToken, state: newer });

    const stale = buildStatePayload(1);
    stale.tableTalk = [{ id: 9, speakerId: "p1", speakerName: "Host", text: "stale" }];
    pushRoomState({ code: "AV-ROOM5", hostToken, state: stale });

    const view = getRoomSnapshot({ code: "AV-ROOM5", token: guest.token });
    expect(view.state?.version).toBe(2);
    expect(view.state?.tableTalk[0]?.text).toBe("hello");

    const finished = buildStatePayload(3);
    finished.game.phase = "gameOver";
    finished.game.winner = "good";
    finished.game.winReason = "questSuccesses";
    pushRoomState({ code: "AV-ROOM5", hostToken, state: finished });

    expect(getRoomSnapshot({ code: "AV-ROOM5", token: guest.token }).status).toBe("ended");
    expect(getRoomSnapshot({ code: "AV-ROOM5", token: guest.token }).state?.game.players[0].role).toBe("merlin");
  });

  it("removes the room when the host leaves and removes lobby guests who leave", () => {
    const { hostToken } = createRoom({ code: "AV-ROOM6", playerCount: 5, language: "zh", hostName: "Host" });
    const guest = joinRoom({ code: "AV-ROOM6", name: "Guest" });

    leaveRoom({ code: "AV-ROOM6", token: guest.token });
    expect(getRoomSnapshot({ code: "AV-ROOM6", token: hostToken }).members).toHaveLength(1);

    leaveRoom({ code: "AV-ROOM6", token: hostToken });
    expect(() => getRoomSnapshot({ code: "AV-ROOM6", token: hostToken })).toThrow(/not found/);
  });
});
