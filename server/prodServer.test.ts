import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createProdRequestHandler, isDirectExecution, readProdServerConfig } from "./prodServer";

describe("production server", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "avalon-prod-"));
    await mkdir(join(tempRoot, "assets"), { recursive: true });
    await writeFile(join(tempRoot, "index.html"), "<!doctype html><div id=\"root\">Avalon</div>", "utf8");
    await writeFile(join(tempRoot, "assets", "app.js"), "console.log('avalon');", "utf8");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("serves built static assets and falls back to index.html for app routes", async () => {
    await withServer(tempRoot, async (baseUrl) => {
      const root = await fetch(`${baseUrl}/`);
      await expect(root.text()).resolves.toContain("Avalon");
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toContain("text/html");

      const asset = await fetch(`${baseUrl}/assets/app.js`);
      await expect(asset.text()).resolves.toContain("console.log");
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("text/javascript");

      const route = await fetch(`${baseUrl}/saved/game`);
      await expect(route.text()).resolves.toContain("Avalon");
      expect(route.status).toBe(200);
    });
  });

  it("delegates /api/ai-action requests to the shared AI handler", async () => {
    const aiHandler = vi.fn((req: IncomingMessage, res: ServerResponse) => {
      expect(req.method).toBe("POST");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ source: "fallback", ok: true }));
    });
    await withServer(tempRoot, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ai-action`, { method: "POST", body: "{}" });

      await expect(response.json()).resolves.toEqual({ source: "fallback", ok: true });
    }, aiHandler);
    expect(aiHandler).toHaveBeenCalledTimes(1);
  });

  it("uses 0.0.0.0:3238 defaults for production binding", () => {
    expect(readProdServerConfig({}, "/repo")).toEqual({
      host: "0.0.0.0",
      port: 3238,
      distDir: join("/repo", "dist")
    });
    expect(readProdServerConfig({ HOST: "127.0.0.1", PORT: "6000" }, "/repo")).toMatchObject({
      host: "127.0.0.1",
      port: 6000
    });
  });

  it("treats a symlinked entrypoint as direct execution", async () => {
    const realEntry = join(tempRoot, "release-entry.js");
    const linkedEntry = join(tempRoot, "current-entry.js");
    await writeFile(realEntry, "export {};", "utf8");
    await symlink(realEntry, linkedEntry);

    expect(isDirectExecution(linkedEntry, pathToFileURL(realEntry).href)).toBe(true);
  });
});

async function withServer(
  distDir: string,
  useBaseUrl: (baseUrl: string) => Promise<void>,
  aiHandler?: (req: IncomingMessage, res: ServerResponse) => void
): Promise<void> {
  const server = createServer(createProdRequestHandler({ distDir, aiHandler }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }
    await useBaseUrl(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
