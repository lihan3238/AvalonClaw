import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import App from "./App";
import { advanceDiscussionTurn, castVote, createInitialGame, proposeTeam } from "./game/rules";
import type { GameState } from "./game/types";

function pendingResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function saveSession(id: string, game: GameState) {
  localStorage.setItem("avalon-claw:sessions:v1", JSON.stringify({
    [id]: {
      id,
      game,
      selectedTeam: [],
      log: [],
      tableTalk: [],
      language: "zh",
      reasoningEffort: "medium",
      model: "gpt-5.4-mini",
      updatedAt: 1
    }
  }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function submitTalk(text: string) {
  fireEvent.change(screen.getByLabelText(/发言/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /发送发言/ }));
}

async function waitForHumanSpeaking() {
  await waitFor(() => expect(screen.getByRole("button", { name: /你/s })).toHaveClass("speaking"));
}

async function submitHumanDiscussionSpeech(text = "我先说完这一轮。") {
  await waitForHumanSpeaking();
  submitTalk(text);
}

function modelSpeakDecision(playerId: string) {
  return jsonResponse({
    source: "model",
    speech: `${playerId} 先给一段公开判断。`,
    action: { type: "speak" }
  });
}

function createVotingGameWithHumanVote() {
  let game = createInitialGame({
    playerCount: 5,
    humanSeat: 0,
    roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
  });
  game = proposeTeam(game, "p1", ["p1", "p2"]);
  while (game.phase === "discussion") {
    const speaker = game.players[game.discussion?.nextSpeakerIndex ?? 0];
    game = advanceDiscussionTurn(game, speaker.id);
  }
  return castVote(game, "p1", true);
}

describe("Avalon app", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("starts a local human plus AI game", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /Avalon Claw/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    expect(screen.getByText(/任务\s*1|Quest 1/i)).toBeInTheDocument();
    expect(screen.getAllByText(/你的身份|Your Role/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI/i).length).toBeGreaterThan(0);
  });

  it("can switch the table UI to English before starting", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/语言/), { target: { value: "en" } });

    expect(screen.getByRole("button", { name: /Start game/i })).toBeInTheDocument();
    expect(screen.getByText(/Configure the table/i)).toBeInTheDocument();
  });

  it("offers xhigh thinking strength", () => {
    render(<App />);

    expect(screen.getByLabelText(/思考强度/)).toHaveTextContent("极高");
    fireEvent.change(screen.getByLabelText(/思考强度/), { target: { value: "xhigh" } });

    expect(screen.getByLabelText(/思考强度/)).toHaveValue("xhigh");
  });

  it("sends manually entered AI endpoint config with AI requests", async () => {
    const delayed = pendingResponse();
    vi.stubGlobal("fetch", vi.fn(() => delayed.promise));
    render(<App />);

    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: "https://manual.example/v1/" } });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "sk-manual" } });
    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const requestBody = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(requestBody.aiConfig).toEqual({
      baseURL: "https://manual.example/v1/",
      apiKey: "sk-manual"
    });
  });

  it("prefills AI endpoint config from local browser storage", () => {
    localStorage.setItem("avalon-claw:ai-config", JSON.stringify({
      baseURL: "https://cached.example/v1",
      apiKey: "sk-cached"
    }));

    render(<App />);

    expect(screen.getByLabelText(/Base URL/)).toHaveValue("https://cached.example/v1");
    expect(screen.getByLabelText(/API key/)).toHaveValue("sk-cached");
  });

  it("defaults to dark mode and can switch to light mode", () => {
    render(<App />);

    expect(document.querySelector(".app-shell")).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("checkbox", { name: /黑夜模式/ }));

    expect(document.querySelector(".app-shell")).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("avalon-claw:theme")).toBe("light");
  });

  it("saves a new game under a visible game id and restores it manually", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    let savedId = "";
    await waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem("avalon-claw:sessions:v1") ?? "{}") as Record<string, unknown>;
      const ids = Object.keys(sessions);
      expect(ids).toHaveLength(1);
      savedId = ids[0];
      expect(screen.getByText(savedId)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /重置|Reset/i }));

    expect(screen.getByText(savedId)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/输入局号/), { target: { value: savedId } });
    fireEvent.click(screen.getByRole("button", { name: /恢复对局/ }));

    expect(screen.getByText(savedId)).toBeInTheDocument();
    expect(screen.getAllByText(/你的身份|Your Role/i).length).toBeGreaterThan(0);
  });

  it("formats saved game summaries in English", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/语言/), { target: { value: "en" } });
    fireEvent.change(screen.getByLabelText(/Your Seat/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Start game/i }));

    await waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem("avalon-claw:sessions:v1") ?? "{}") as Record<string, unknown>;
      expect(Object.keys(sessions)).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: /Reset/i }));

    expect(screen.getByText(/5 players · Quest 1 · Team proposal/)).toBeInTheDocument();
  });

  it("shows the current role lineup and quest configuration", () => {
    render(<App />);

    expect(screen.getByText(/局配置/)).toBeInTheDocument();
    expect(screen.getByText(/梅林/)).toBeInTheDocument();
    expect(screen.getByText(/刺客/)).toBeInTheDocument();
    expect(screen.getByText(/Q1.*2人.*1失败牌/)).toBeInTheDocument();
  });

  it("uses Chinese role names in Chinese UI configuration and role panels", () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    render(<App />);

    expect(screen.getByText(/梅林/)).toBeInTheDocument();
    expect(screen.getByText(/派西维尔/)).toBeInTheDocument();
    expect(screen.getByText(/忠臣/)).toBeInTheDocument();
    expect(screen.getByText(/刺客/)).toBeInTheDocument();
    expect(screen.getByText(/莫甘娜/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    expect(screen.getByRole("heading", { name: /^梅林$/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Merlin$/ })).not.toBeInTheDocument();
  });

  it("shows player ids and marks the current leader on seats", () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    const leaderSeat = screen.getByRole("button", { name: /p1.*你.*队长/s });
    const secondSeat = screen.getByRole("button", { name: /p2.*AI 2/s });
    expect(leaderSeat).toHaveClass("leader", "player-tone-0");
    expect(secondSeat).toHaveClass("player-tone-1");
  });

  it("shows role skills and Merlin private information with player ids and names", () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    expect(screen.getByText(/职业技能/)).toBeInTheDocument();
    expect(screen.getByText(/你知道除莫德雷德外的邪恶方/)).toBeInTheDocument();
    expect(screen.getByText(/p3 · AI 3 · 已知邪恶/)).toBeInTheDocument();
    expect(screen.getByText(/p4 · AI 4 · 已知邪恶/)).toBeInTheDocument();
    expect(screen.queryByText(/梅林候选/)).not.toBeInTheDocument();
    expect(screen.queryByText(/p3 · AI 3 · Morgana/)).not.toBeInTheDocument();
    expect(screen.queryByText(/p4 · AI 4 · Assassin/)).not.toBeInTheDocument();
  });

  it("blocks active-game speech outside the ordered speaking turn and sends legal speech to AI decisions", async () => {
    const delayedNextAiSpeech = pendingResponse();
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "proposeTeam") {
        return Promise.resolve(jsonResponse({
          source: "model",
          speech: "先开 p1+p2。",
          action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
        }));
      }
      if (body.actionKind === "speak" && body.playerId === "p1") {
        return Promise.resolve(modelSpeakDecision(body.playerId));
      }
      return delayedNextAiSpeech.promise;
    }));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.change(screen.getByLabelText(/发言/), { target: { value: "我想偷跑发言" } });
    expect(screen.getByRole("button", { name: /发送发言/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /发送发言/ }));
    expect(screen.queryByText(/你: 我想偷跑发言/)).not.toBeInTheDocument();

    await submitHumanDiscussionSpeech("我先解释一下这队。");

    expect(screen.getByText(/你: 我先解释一下这队。/)).toBeInTheDocument();
    expect(screen.getByText(/你: 我先解释一下这队。/).closest(".talk-entry")).toHaveClass("player-tone-1");

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const requestBody = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[2][1].body);
    expect(requestBody.tableTalk).toContainEqual(expect.objectContaining({ speakerId: "p2", speakerName: "你", text: "我先解释一下这队。" }));
    expect(requestBody.tableTalk).not.toContainEqual(expect.objectContaining({ text: "我想偷跑发言" }));
  });

  it("keeps voting hidden until all votes are submitted", async () => {
    const delayedFirstVote = pendingResponse();
    let delayedUsed = false;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "speak") {
        return Promise.resolve(modelSpeakDecision(body.playerId));
      }
      if (body.actionKind === "vote" && body.playerId === "p2" && !delayedUsed) {
        delayedUsed = true;
        return delayedFirstVote.promise;
      }
      const approve = body.playerId !== "p4";
      return Promise.resolve(jsonResponse({
        source: "model",
        speech: approve ? "可以过。" : "我保留一点怀疑。",
        action: { type: "vote", approve }
      }));
    }));
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));
    await submitHumanDiscussionSpeech("我先解释一下这队。");
    await waitFor(() => expect(screen.getByRole("button", { name: /同意/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /同意/ }));

    expect(screen.getByText(/投票已提交：[1-4]\/5/)).toBeInTheDocument();
    expect(screen.queryByText(/p1.*同意/)).not.toBeInTheDocument();
    await waitFor(() => {
      const voteBodies = (fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => JSON.parse(call[1].body))
        .filter((body) => body.actionKind === "vote");
      expect(voteBodies).toHaveLength(4);
      for (const body of voteBodies) {
        expect(body.tableTalk).toEqual(expect.arrayContaining([
          expect.objectContaining({ speakerId: "p1", speakerName: "你", text: "我先解释一下这队。" }),
          expect.objectContaining({ speakerId: "p2", text: "p2 先给一段公开判断。" }),
          expect.objectContaining({ speakerId: "p3", text: "p3 先给一段公开判断。" }),
          expect.objectContaining({ speakerId: "p4", text: "p4 先给一段公开判断。" }),
          expect.objectContaining({ speakerId: "p5", text: "p5 先给一段公开判断。" })
        ]));
      }
    });

    delayedFirstVote.resolve(new Response(JSON.stringify({
      source: "model",
      speech: "这队有信息量。",
      action: { type: "vote", approve: true }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await delayedFirstVote.promise;

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
    await waitFor(() => expect(screen.getByText(/投票结果：4同意 \/ 1拒绝/)).toBeInTheDocument());
    expect(screen.getByText(/p1: 同意/)).toBeInTheDocument();
    expect(screen.getByText(/p4: 拒绝/)).toBeInTheDocument();
  });

  it("uses neutral log styling for public player actions before roles are revealed", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      source: "model",
      speech: "I prefer this opening pair.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    const proposalLog = await screen.findByText(/AI 1 提议队伍: p1, p2\./);
    expect(proposalLog).toHaveClass("ai");
    expect(proposalLog).not.toHaveClass("good");
    expect(proposalLog).not.toHaveClass("evil");
  });

  it("highlights the active proposal instead of a stale human draft", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "speak") {
        return Promise.resolve(modelSpeakDecision(body.playerId));
      }
      if (body.actionKind === "vote") {
        return Promise.resolve(jsonResponse({
          source: "model",
          speech: "Rejecting to see another leader.",
          action: { type: "vote", approve: false }
        }));
      }
      return Promise.resolve(jsonResponse({
        source: "model",
        speech: "I want to test this pair.",
        action: { type: "proposeTeam", teamIds: ["p3", "p4"] }
      }));
    }));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));
    await submitHumanDiscussionSpeech("我先解释一下这队。");
    await waitFor(() => expect(screen.getByRole("button", { name: /拒绝/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /拒绝/ }));

    await submitHumanDiscussionSpeech("这次我看新队伍。");
    await waitFor(() => expect(screen.getByText(/投票队伍: p3, p4/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /p1.*你/s })).not.toHaveClass("selected");
    expect(screen.getByRole("button", { name: /p2.*AI 2/s })).not.toHaveClass("selected");
    expect(screen.getByRole("button", { name: /p3.*AI 3/s })).toHaveClass("selected");
    expect(screen.getByRole("button", { name: /p4.*AI 4/s })).toHaveClass("selected");
  });

  it("keeps quest cards hidden and only reveals fail-card counts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    const delayedQuest = pendingResponse();
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "speak") {
        return Promise.resolve(modelSpeakDecision(body.playerId));
      }
      if (body.actionKind === "quest") {
        return delayedQuest.promise;
      }
      return Promise.resolve(jsonResponse({
        source: "model",
        speech: "可以过。",
        action: { type: "vote", approve: true }
      }));
    }));
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 4/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));
    await submitHumanDiscussionSpeech("我先解释一下这队。");
    await waitFor(() => expect(screen.getByRole("button", { name: /同意/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /同意/ }));

    await waitFor(() => expect(screen.getByText(/提交任务牌/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /成功/ }));

    expect(screen.getByText(/任务牌已提交：1\/2/)).toBeInTheDocument();
    expect(screen.queryByText(/p1.*成功/)).not.toBeInTheDocument();

    delayedQuest.resolve(new Response(JSON.stringify({
      source: "model",
      speech: "任务会给答案。",
      action: { type: "quest", card: "fail" }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await delayedQuest.promise;

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(9));
    await waitFor(() => expect(screen.getAllByText(/任务结果：1张失败牌/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/p4.*失败/)).not.toBeInTheDocument();
  });

  it("shows a phase countdown with the current phase and the specific AI thinking indicator", async () => {
    const delayed = pendingResponse();
    vi.stubGlobal("fetch", vi.fn(() => delayed.promise));
    vi.spyOn(Date, "now").mockReturnValue(10);

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    expect(screen.getByText(/组队提案倒计时/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/AI 1 思考中/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: /p1.*AI 1.*思考中/s })).toHaveClass("thinking"));
  });

  it("requests all outstanding AI votes in parallel and marks every voter as thinking", async () => {
    const pendingVotes = new Map<string, ReturnType<typeof pendingResponse>>();
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "vote") {
        const pending = pendingResponse();
        pendingVotes.set(body.playerId, pending);
        return pending.promise;
      }
      return Promise.resolve(jsonResponse({
        source: "model",
        speech: "ok",
        action: { type: body.actionKind === "speak" ? "speak" : "vote", approve: true }
      }));
    }));
    saveSession("AV-20260701-VOTE", createVotingGameWithHumanVote());

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /AV-20260701-VOTE/ }));

    await waitFor(() => expect(pendingVotes.size).toBe(4));
    for (const id of ["p2", "p3", "p4", "p5"]) {
      expect(screen.getByRole("button", { name: new RegExp(`${id}.*思考中`, "s") })).toHaveClass("thinking");
    }

    for (const [playerId, pending] of pendingVotes) {
      pending.resolve(jsonResponse({
        source: "model",
        speech: `${playerId} 同意。`,
        action: { type: "vote", approve: true }
      }));
    }

    await waitFor(() => expect(screen.getByText(/投票结果：5同意 \/ 0拒绝/)).toBeInTheDocument());
    expect(screen.queryByText(/AI 2: p2 同意。/)).not.toBeInTheDocument();
  });

  it("shows a player-friendly warning when an AI action falls back locally", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    await waitFor(() => expect(screen.getByText(/AI 1 网络请求失败，已使用本地兜底。/)).toBeInTheDocument());
    expect(screen.getAllByText(/本地兜底/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 1 网络请求失败/)[0].closest("p")).toHaveClass("warning");
  });

  it("shows a specific player-friendly reason when the AI endpoint falls back", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      source: "fallback",
      fallbackReason: "api-timeout",
      speech: "I will keep this team straightforward and readable.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    await waitFor(() => expect(screen.getAllByText(/AI 1 超时了，已使用本地兜底。/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/AI 1 超时了，已使用本地兜底。/)[0].closest("p")).toHaveClass("warning");
  });

  it("only shows good players as human Assassin targets", () => {
    const game = createInitialGame({
      playerCount: 5,
      humanSeat: 3,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p2", "p3"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p3"], failCards: 0, succeeded: true }
      ]
    });
    saveSession("AV-20260701-ASSASSIN", game);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /AV-20260701-ASSASSIN/ }));

    expect(screen.getByRole("button", { name: /^AI 1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^AI 2$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^AI 3$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^AI 5$/ })).not.toBeInTheDocument();
  });

  it("lets an evil human keep talking during assassination before choosing a target", () => {
    const game = createInitialGame({
      playerCount: 5,
      humanSeat: 3,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p2", "p3"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p3"], failCards: 0, succeeded: true }
      ]
    });
    game.players = game.players.map((player) => ({ ...player, name: player.isHuman ? "AI 4" : `AI ${player.seat + 1}` }));
    saveSession("AV-20260701-EVILTALK", game);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /AV-20260701-EVILTALK/ }));
    submitTalk("先别急，我觉得 p2 更像梅林。");
    submitTalk("再看 p1，可能是在替 p2 挡刀。");

    expect(screen.getByText(/AI 4: 先别急/)).toBeInTheDocument();
    expect(screen.getByText(/AI 4: 再看 p1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^AI 1$/ }));
    expect(screen.getAllByText(/EVIL 获胜/).length).toBeGreaterThan(0);
  });

  it("does not let a stale second human vote overwrite the first vote", async () => {
    const delayed = pendingResponse();
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "speak") {
        return Promise.resolve(modelSpeakDecision(body.playerId));
      }
      if (body.actionKind === "vote" && body.playerId === "p2") {
        return delayed.promise;
      }
      return Promise.resolve(jsonResponse({
        source: "model",
        speech: "同意。",
        action: { type: "vote", approve: true }
      }));
    }));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));
    await submitHumanDiscussionSpeech("我先解释一下这队。");
    await waitFor(() => expect(screen.getByRole("button", { name: /同意/ })).toBeInTheDocument());

    const approve = screen.getByRole("button", { name: /同意/ });
    const reject = screen.getByRole("button", { name: /拒绝/ });
    fireEvent.click(approve);
    fireEvent.click(reject);

    expect(screen.getByText(/投票已提交：[1-4]\/5/)).toBeInTheDocument();

    delayed.resolve(new Response(JSON.stringify({
      source: "model",
      speech: "同意。",
      action: { type: "vote", approve: true }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await delayed.promise;

    await waitFor(() => expect(screen.getByText(/p1: 同意/)).toBeInTheDocument());
    expect(screen.queryByText(/p1: 拒绝/)).not.toBeInTheDocument();
  });

  it("shows one entertaining AI epilogue line for each AI after game over", () => {
    const game = createInitialGame({
      playerCount: 5,
      humanSeat: 0,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "gameOver"
    });
    game.winner = "good";
    game.winReason = "questSuccesses";
    game.players = game.players.map((player) => ({ ...player, name: player.isHuman ? "你" : `AI ${player.seat + 1}` }));
    localStorage.setItem("avalon-claw:sessions:v1", JSON.stringify({
      "AV-20260701-TEST": {
        id: "AV-20260701-TEST",
        game,
        selectedTeam: [],
        log: [],
        tableTalk: [],
        language: "zh",
        reasoningEffort: "medium",
        model: "gpt-5.4-mini",
        updatedAt: 1
      }
    }));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /完整列表/ }));
    fireEvent.click(screen.getByRole("button", { name: /查看/ }));

    expect(screen.getByText(/终局复盘/)).toBeInTheDocument();
    expect(screen.getAllByText(/AI 2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 4/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 5/).length).toBeGreaterThan(0);
  });

  it("lets the human keep talking after game over", () => {
    const game = createInitialGame({
      playerCount: 5,
      humanSeat: 0,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "gameOver"
    });
    game.winner = "good";
    game.winReason = "questSuccesses";
    game.players = game.players.map((player) => ({ ...player, name: player.isHuman ? "你" : `AI ${player.seat + 1}` }));
    saveSession("AV-20260701-CHAT", game);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /完整列表/ }));
    fireEvent.click(screen.getByRole("button", { name: /查看/ }));
    fireEvent.change(screen.getByLabelText(/发言/), { target: { value: "这局 p4 也太会演了" } });
    fireEvent.click(screen.getByRole("button", { name: /发送发言/ }));

    expect(screen.getByText(/你: 这局 p4 也太会演了/)).toBeInTheDocument();
  });

  it("shows only unfinished games in the quick restore list and opens a full saved-game dialog", () => {
    const unfinished = createInitialGame({
      playerCount: 5,
      humanSeat: 0,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    const finished = createInitialGame({
      playerCount: 5,
      humanSeat: 0,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "gameOver"
    });
    finished.winner = "evil";
    finished.winReason = "questFailures";
    localStorage.setItem("avalon-claw:sessions:v1", JSON.stringify({
      "AV-20260701-LIVE": {
        id: "AV-20260701-LIVE",
        game: unfinished,
        selectedTeam: [],
        log: [],
        tableTalk: [],
        language: "zh",
        reasoningEffort: "medium",
        model: "gpt-5.4-mini",
        updatedAt: 2
      },
      "AV-20260701-DONE": {
        id: "AV-20260701-DONE",
        game: finished,
        selectedTeam: [],
        log: [],
        tableTalk: [],
        language: "zh",
        reasoningEffort: "medium",
        model: "gpt-5.4-mini",
        updatedAt: 1
      }
    }));

    render(<App />);

    expect(screen.getByRole("button", { name: /AV-20260701-LIVE/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AV-20260701-DONE/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /完整列表/ }));

    const dialog = screen.getByRole("dialog", { name: /完整存档/ });
    expect(dialog).toHaveTextContent("AV-20260701-LIVE");
    expect(dialog).toHaveTextContent("AV-20260701-DONE");
    expect(screen.getByRole("button", { name: /查看/ })).toBeEnabled();
  });

  it("does not restore a terminal game by manual id", () => {
    const finished = createInitialGame({
      playerCount: 5,
      humanSeat: 0,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "gameOver"
    });
    finished.winner = "good";
    finished.winReason = "questSuccesses";
    saveSession("AV-20260701-DONE", finished);

    render(<App />);

    fireEvent.change(screen.getByLabelText(/输入局号/), { target: { value: "AV-20260701-DONE" } });
    fireEvent.click(screen.getByRole("button", { name: /恢复对局/ }));

    expect(screen.getByText(/这局已经终局/)).toBeInTheDocument();
    expect(screen.queryByText(/你的身份/)).not.toBeInTheDocument();
  });

  it("ignores an old AI response after starting another game", async () => {
    const delayed = pendingResponse();
    vi.stubGlobal("fetch", vi.fn(() => delayed.promise));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /重置|Reset/i }));
    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    await act(async () => {
      delayed.resolve(new Response(JSON.stringify({
        source: "model",
        speech: "old stale proposal",
        action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await delayed.promise;
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /提交队伍/ })).toBeInTheDocument();
    expect(screen.queryByText(/old stale proposal/)).not.toBeInTheDocument();
  });
});
