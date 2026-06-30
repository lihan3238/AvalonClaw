describe("test tooling", () => {
  it("runs Vitest with jsdom", () => {
    const node = document.createElement("div");
    node.textContent = "Avalon";

    expect(node).toHaveTextContent("Avalon");
  });
});
