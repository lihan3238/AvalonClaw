import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createRoom,
  drainRoomActions,
  getRoomSnapshot,
  joinRoom,
  leaveRoom,
  pushRoomState,
  RoomError,
  setMemberReady,
  startRoom,
  submitRoomAction
} from "./roomStore";

// POST /api/room with a JSON body { op: ... } multiplexes all room operations
// so both the Vite middleware and the production server mount a single path.

export async function handleRoomRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid room request" });
    return;
  }

  try {
    sendJson(res, 200, dispatchRoomOperation(body));
  } catch (error) {
    if (error instanceof RoomError) {
      sendJson(res, statusForRoomError(error), { error: error.message, code: error.code });
      return;
    }
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Room request failed" });
  }
}

function dispatchRoomOperation(body: Record<string, unknown>): unknown {
  const op = typeof body.op === "string" ? body.op : "";
  if (op === "create") {
    return createRoom({
      code: asString(body.code),
      playerCount: asNumber(body.playerCount),
      language: body.language === "en" ? "en" : "zh",
      hostName: asString(body.name)
    });
  }
  if (op === "join") {
    return joinRoom({ code: asString(body.code), name: asString(body.name) });
  }
  if (op === "leave") {
    leaveRoom({ code: asString(body.code), token: asString(body.token) });
    return { ok: true };
  }
  if (op === "ready") {
    return { snapshot: setMemberReady({ code: asString(body.code), token: asString(body.token), ready: body.ready !== false }) };
  }
  if (op === "start") {
    return {
      snapshot: startRoom({
        code: asString(body.code),
        hostToken: asString(body.token),
        state: body.state as Parameters<typeof startRoom>[0]["state"],
        seatByMemberId: (body.seatByMemberId ?? {}) as Record<string, number>
      })
    };
  }
  if (op === "push-state") {
    pushRoomState({
      code: asString(body.code),
      hostToken: asString(body.token),
      state: body.state as Parameters<typeof pushRoomState>[0]["state"]
    });
    return { ok: true };
  }
  if (op === "snapshot") {
    return {
      snapshot: getRoomSnapshot({
        code: asString(body.code),
        token: asString(body.token),
        sinceVersion: typeof body.sinceVersion === "number" ? body.sinceVersion : undefined
      })
    };
  }
  if (op === "submit-action") {
    submitRoomAction({
      code: asString(body.code),
      token: asString(body.token),
      action: body.action as Parameters<typeof submitRoomAction>[0]["action"],
      talk: typeof body.talk === "string" ? body.talk : undefined
    });
    return { ok: true };
  }
  if (op === "drain-actions") {
    return { actions: drainRoomActions({ code: asString(body.code), hostToken: asString(body.token) }) };
  }

  throw new RoomError("invalid", `Unknown room operation ${op || "(missing)"}`);
}

function statusForRoomError(error: RoomError): number {
  if (error.code === "not-found") {
    return 404;
  }
  if (error.code === "forbidden") {
    return 403;
  }
  if (error.code === "room-full" || error.code === "already-started") {
    return 409;
  }
  return 400;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
