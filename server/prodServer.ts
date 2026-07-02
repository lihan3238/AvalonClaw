import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { handleAiActionRequest } from "./aiEndpoint";

export interface ProdServerConfig {
  host: string;
  port: number;
  distDir: string;
}

interface CreateProdRequestHandlerOptions {
  distDir: string;
  aiHandler?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export function readProdServerConfig(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): ProdServerConfig {
  const parsedPort = Number.parseInt(env.PORT ?? "", 10);
  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3238,
    distDir: env.DIST_DIR ? resolve(cwd, env.DIST_DIR) : join(cwd, "dist")
  };
}

export function createProdRequestHandler(options: CreateProdRequestHandlerOptions) {
  const distDir = resolve(options.distDir);
  const aiHandler = options.aiHandler ?? handleAiActionRequest;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/ai-action") {
      await aiHandler(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method not allowed", "text/plain; charset=utf-8", req.method === "HEAD");
      return;
    }

    await serveStaticOrIndex(req, res, distDir, url.pathname);
  };
}

export function createProdServer(config: ProdServerConfig = readProdServerConfig()) {
  return createServer(createProdRequestHandler({ distDir: config.distDir }));
}

export function isDirectExecution(argvPath: string | undefined, moduleUrl = import.meta.url): boolean {
  if (!argvPath) {
    return false;
  }
  return pathToFileURL(resolveEntrypointPath(argvPath)).href === moduleUrl;
}

async function serveStaticOrIndex(req: IncomingMessage, res: ServerResponse, distDir: string, pathname: string): Promise<void> {
  const decodedPath = safeDecodePath(pathname);
  if (decodedPath === null) {
    sendText(res, 400, "Bad request", "text/plain; charset=utf-8", req.method === "HEAD");
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : `.${decodedPath}`;
  const filePath = resolve(distDir, relativePath);
  if (!isInsideDirectory(distDir, filePath)) {
    sendText(res, 403, "Forbidden", "text/plain; charset=utf-8", req.method === "HEAD");
    return;
  }

  const served = await tryServeFile(req, res, filePath);
  if (served) {
    return;
  }

  if (!extname(decodedPath)) {
    const indexPath = join(distDir, "index.html");
    await tryServeFile(req, res, indexPath, 200, "text/html; charset=utf-8");
    return;
  }

  sendText(res, 404, "Not found", "text/plain; charset=utf-8", req.method === "HEAD");
}

async function tryServeFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  statusCode = 200,
  forcedContentType?: string
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return false;
    }
    const contentType = forcedContentType ?? contentTypeForPath(filePath);
    const body = req.method === "HEAD" ? null : await readFile(filePath);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", filePath.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    if (body) {
      res.setHeader("Content-Length", body.byteLength);
      res.end(body);
      return true;
    }
    res.end();
    return true;
  } catch {
    return false;
  }
}

function safeDecodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isInsideDirectory(directory: string, filePath: string): boolean {
  const root = resolve(directory);
  const target = resolve(filePath);
  return target === root || target.startsWith(`${root}${sep}`);
}

function contentTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}

function sendText(res: ServerResponse, statusCode: number, text: string, contentType: string, headOnly = false): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  if (headOnly) {
    res.end();
    return;
  }
  res.end(text);
}

function resolveEntrypointPath(argvPath: string): string {
  try {
    return realpathSync(argvPath);
  } catch {
    return resolve(argvPath);
  }
}

if (isDirectExecution(process.argv[1])) {
  const config = readProdServerConfig();
  const server = createProdServer(config);
  server.listen(config.port, config.host, () => {
    process.stdout.write(`Avalon Claw production server listening on http://${config.host}:${config.port}/\n`);
  });
}
