import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import App from "./App";
import { createInitialGame } from "./game/rules";

function pendingResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
    expect(screen.getByText(/Merlin/)).toBeInTheDocument();
    expect(screen.getByText(/Assassin/)).toBeInTheDocument();
    expect(screen.getByText(/Q1.*2人.*1失败牌/)).toBeInTheDocument();
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
    expect(screen.getByText(/你知道除 Mordred 外的邪恶方/)).toBeInTheDocument();
    expect(screen.getByText(/p3 · AI 3 · Morgana/)).toBeInTheDocument();
    expect(screen.getByText(/p4 · AI 4 · Assassin/)).toBeInTheDocument();
  });

  it("lets the human speak and sends public talk to AI decisions", async () => {
    const delayed = pendingResponse();
    vi.stubGlobal("fetch", vi.fn(() => delayed.promise));

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.change(screen.getByLabelText(/发言/), { target: { value: "我觉得先验一队" } });
    fireEvent.click(screen.getByRole("button", { name: /发送发言/ }));

    expect(screen.getByText(/你: 我觉得先验一队/)).toBeInTheDocument();
    expect(screen.getByText(/你: 我觉得先验一队/).closest(".talk-entry")).toHaveClass("player-tone-0");

    fireEvent.click(screen.getByRole("button", { name: /AI 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const requestBody = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(requestBody.tableTalk).toContainEqual(expect.objectContaining({ speakerId: "p1", speakerName: "你", text: "我觉得先验一队" }));
  });

  it("keeps voting hidden until all votes are submitted", async () => {
    const delayedFirstVote = pendingResponse();
    let delayedUsed = false;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.playerId === "p2" && !delayedUsed) {
        delayedUsed = true;
        return delayedFirstVote.promise;
      }
      const approve = body.playerId !== "p4";
      return Promise.resolve(new Response(JSON.stringify({
        source: "model",
        speech: approve ? "可以过。" : "我保留一点怀疑。",
        action: { type: "vote", approve }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));

    fireEvent.click(screen.getByRole("button", { name: /同意/ }));

    expect(screen.getByText(/投票已提交：1\/5/)).toBeInTheDocument();
    expect(screen.queryByText(/p1.*同意/)).not.toBeInTheDocument();

    delayedFirstVote.resolve(new Response(JSON.stringify({
      source: "model",
      speech: "这队有信息量。",
      action: { type: "vote", approve: true }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await delayedFirstVote.promise;

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByText(/投票结果：4同意 \/ 1拒绝/)).toBeInTheDocument());
    expect(screen.getByText(/p1: 同意/)).toBeInTheDocument();
    expect(screen.getByText(/p4: 拒绝/)).toBeInTheDocument();
  });

  it("keeps quest cards hidden and only reveals fail-card counts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    const delayedQuest = pendingResponse();
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.actionKind === "quest") {
        return delayedQuest.promise;
      }
      return Promise.resolve(new Response(JSON.stringify({
        source: "model",
        speech: "可以过。",
        action: { type: "vote", approve: true }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 4/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交队伍/ }));
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

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(screen.getAllByText(/任务结果：1张失败牌/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/p4.*失败/)).not.toBeInTheDocument();
  });

  it("shows a phase countdown and the specific AI thinking indicator", async () => {
    const delayed = pendingResponse();
    vi.stubGlobal("fetch", vi.fn(() => delayed.promise));
    vi.spyOn(Date, "now").mockReturnValue(10);

    render(<App />);

    fireEvent.change(screen.getByLabelText(/你的座位/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /开始游戏|Start game/i }));

    expect(screen.getByText(/流程倒计时/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/AI 1 思考中/)).toBeInTheDocument());
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

    fireEvent.click(screen.getByRole("button", { name: /AV-20260701-TEST/ }));

    expect(screen.getByText(/终局复盘/)).toBeInTheDocument();
    expect(screen.getAllByText(/AI 2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 4/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 5/).length).toBeGreaterThan(0);
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
