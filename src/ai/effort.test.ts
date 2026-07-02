import { clientAiTimeoutMsFor, effectiveReasoningEffortForAction, upstreamTimeoutMsForEffort } from "./effort";

describe("reasoning effort policy", () => {
  it("caps short actions while keeping strategic actions at the requested effort", () => {
    expect(effectiveReasoningEffortForAction("quest", "xhigh")).toBe("low");
    expect(effectiveReasoningEffortForAction("speak", "high")).toBe("medium");
    expect(effectiveReasoningEffortForAction("vote", "xhigh")).toBe("medium");
    expect(effectiveReasoningEffortForAction("proposeTeam", "xhigh")).toBe("high");
    expect(effectiveReasoningEffortForAction("proposeTeam", "high")).toBe("high");
    expect(effectiveReasoningEffortForAction("assassinate", "xhigh")).toBe("high");
    expect(effectiveReasoningEffortForAction("assassinate", "high")).toBe("high");
  });

  it("scales the upstream request window with reasoning effort", () => {
    expect(upstreamTimeoutMsForEffort("low")).toBe(45_000);
    expect(upstreamTimeoutMsForEffort("medium")).toBe(60_000);
    expect(upstreamTimeoutMsForEffort("high")).toBe(90_000);
    expect(upstreamTimeoutMsForEffort("xhigh")).toBe(150_000);
  });

  it("keeps the browser ceiling above the server window for the effective effort", () => {
    expect(clientAiTimeoutMsFor("proposeTeam", "xhigh")).toBe(120_000);
    expect(clientAiTimeoutMsFor("vote", "xhigh")).toBe(90_000);
    expect(clientAiTimeoutMsFor("quest", "xhigh")).toBe(75_000);
    expect(clientAiTimeoutMsFor("proposeTeam", "low")).toBe(75_000);
    expect(clientAiTimeoutMsFor("assassinate", "xhigh")).toBe(120_000);
  });
});
