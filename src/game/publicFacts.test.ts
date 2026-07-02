import { derivePublicFacts } from "./publicFacts";

describe("public hard-fact inference", () => {
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];

  it("marks a two-player two-fail quest as all public-evil and everyone outside as public-good", () => {
    expect(derivePublicFacts({
      playerIds,
      evilCount: 2,
      questResults: [{ teamIds: ["p2", "p3"], failCards: 2, succeeded: false }]
    })).toMatchObject({
      publicGood: ["p1", "p4", "p5"],
      publicEvil: ["p2", "p3"],
      possibleWorldCount: 1
    });
  });

  it("does not mark a three-player two-fail quest as all public-evil when only two evil exist", () => {
    expect(derivePublicFacts({
      playerIds,
      evilCount: 2,
      questResults: [{ teamIds: ["p2", "p3", "p4"], failCards: 2, succeeded: false }]
    })).toMatchObject({
      publicGood: ["p1", "p5"],
      publicEvil: [],
      possibleWorldCount: 3
    });
  });

  it("does not turn partial fail or zero-fail quest history into public alignments", () => {
    expect(derivePublicFacts({
      playerIds,
      evilCount: 2,
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p3"], failCards: 1, succeeded: false }
      ]
    })).toMatchObject({
      publicGood: [],
      publicEvil: []
    });
  });

  it("combines multiple failed quests instead of relying on one-step rules only", () => {
    expect(derivePublicFacts({
      playerIds,
      evilCount: 2,
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 1, succeeded: false },
        { teamIds: ["p1", "p3"], failCards: 1, succeeded: false },
        { teamIds: ["p2", "p3"], failCards: 1, succeeded: false }
      ]
    })).toMatchObject({
      publicGood: ["p4", "p5"],
      publicEvil: [],
      possibleWorldCount: 3
    });
  });
});
