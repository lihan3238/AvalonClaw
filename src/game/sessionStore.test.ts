import { beforeEach, describe, expect, it } from "vitest";
import { createInitialGame, proposeTeam } from "./rules";
import { createSessionId, isRestorableSession, listRestorableSessions, listSessions, loadSession, loadRestorableSession, saveSession, SESSIONS_STORAGE_KEY } from "./sessionStore";

describe("sessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a readable game id that avoids existing saved ids", () => {
    const existingId = "AV-20260701-0000";
    saveSession({
      id: existingId,
      game: createInitialGame({ playerCount: 5, humanSeat: 0, seed: 1 }),
      selectedTeam: ["p1"],
      log: [],
      language: "zh",
      reasoningEffort: "medium",
      model: "gpt-5.4-mini",
      updatedAt: 1
    });

    const id = createSessionId(new Date("2026-07-01T01:02:03Z"), () => 0);

    expect(id).toMatch(/^AV-20260701-[A-Z0-9]{4}$/);
    expect(id).not.toBe(existingId);
  });

  it("saves, loads, and lists sessions newest first", () => {
    const older = createInitialGame({ playerCount: 5, humanSeat: 0, seed: 1 });
    const newer = createInitialGame({ playerCount: 7, humanSeat: 2, seed: 2 });

    saveSession({
      id: "AV-20260701-OLD1",
      game: older,
      selectedTeam: ["p1"],
      log: [{ id: 1, tone: "system", text: "older" }],
      language: "zh",
      reasoningEffort: "medium",
      model: "gpt-5.4-mini",
      updatedAt: 10
    });
    saveSession({
      id: "AV-20260701-NEW1",
      game: newer,
      selectedTeam: ["p1", "p2"],
      log: [{ id: 2, tone: "ai", text: "newer" }],
      language: "en",
      reasoningEffort: "xhigh",
      model: "gpt-5.4",
      updatedAt: 20
    });

    expect(loadSession("AV-20260701-NEW1")?.game.playerCount).toBe(7);
    expect(loadSession("AV-20260701-NEW1")?.reasoningEffort).toBe("xhigh");
    expect(loadSession("missing")).toBeNull();
    expect(listSessions().map((session) => session.id)).toEqual(["AV-20260701-NEW1", "AV-20260701-OLD1"]);
  });

  it("filters restorable sessions to unfinished games only", () => {
    const live = createInitialGame({ playerCount: 5, humanSeat: 0, seed: 1 });
    const done = createInitialGame({ playerCount: 5, humanSeat: 0, phase: "gameOver", seed: 2 });
    done.winner = "good";
    done.winReason = "questSuccesses";

    saveSession({
      id: "AV-20260701-LIVE",
      game: live,
      selectedTeam: ["p1"],
      log: [],
      language: "zh",
      reasoningEffort: "medium",
      model: "gpt-5.4-mini",
      updatedAt: 10
    });
    saveSession({
      id: "AV-20260701-DONE",
      game: done,
      selectedTeam: [],
      log: [],
      language: "zh",
      reasoningEffort: "medium",
      model: "gpt-5.4-mini",
      updatedAt: 20
    });

    expect(listSessions().map((session) => session.id)).toEqual(["AV-20260701-DONE", "AV-20260701-LIVE"]);
    expect(listRestorableSessions().map((session) => session.id)).toEqual(["AV-20260701-LIVE"]);
    expect(loadRestorableSession("AV-20260701-LIVE")?.id).toBe("AV-20260701-LIVE");
    expect(loadRestorableSession("AV-20260701-DONE")).toBeNull();
    expect(isRestorableSession(loadSession("AV-20260701-LIVE"))).toBe(true);
    expect(isRestorableSession(loadSession("AV-20260701-DONE"))).toBe(false);
  });

  it("loads valid ordered discussion sessions and ignores malformed discussion state", () => {
    const live = proposeTeam(createInitialGame({ playerCount: 5, humanSeat: 0, seed: 1 }), "p1", ["p1", "p2"]);
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify({
      "AV-20260701-LIVE": {
        id: "AV-20260701-LIVE",
        game: live,
        selectedTeam: ["p1", "p2"],
        log: [],
        tableTalk: [],
        language: "zh",
        reasoningEffort: "medium",
        model: "gpt-5.4-mini",
        updatedAt: 10
      },
      "AV-20260701-BAD1": {
        id: "AV-20260701-BAD1",
        game: { ...live, discussion: { nextSpeakerIndex: "p1", spokenIds: [] } },
        selectedTeam: ["p1", "p2"],
        log: [],
        language: "zh",
        reasoningEffort: "medium",
        model: "gpt-5.4-mini",
        updatedAt: 20
      }
    }));

    expect(loadSession("AV-20260701-LIVE")?.game.phase).toBe("discussion");
    expect(loadSession("AV-20260701-BAD1")).toBeNull();
  });

  it("ignores malformed saved session records", () => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify({
      broken: 42,
      partial: { id: "partial" }
    }));

    expect(loadSession("broken")).toBeNull();
    expect(listSessions()).toEqual([]);
  });
});
